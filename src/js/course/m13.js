import { note, tag, inspected, pingOk } from './helpers.js';
import { vpnTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = (id, port = 'eth1') => macFor(id + '/' + port);
const ADDR = {
  mac: [[M('gwA', 'eth2'), 'gwA eth2 (internet side)'], [M('gwA'), 'gwA eth1 (LAN side)'], [M('isp'), 'isp eth1'], [M('pcA'), 'pcA'], [M('gwB'), 'gwB eth1']],
  ip: [['10.1.0.10', 'pcA'], ['10.2.0.10', 'srvB'], ['198.51.100.1', 'gwA (public)'], ['203.0.113.1', 'gwB (public)'], ['198.51.100.254', 'isp'], ['10.99.0.1', 'gwA wg0'], ['10.99.0.2', 'gwB wg0']]
};
const isWgData = f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'wg' && !!f.payload.l4.payload.inner;
const failed = (from, to) => tag(from, 'ping-done', d => d.dst === to && d.received === 0);

export default {
  id: 'm13', title: 'VPN: WireGuard and IPsec', bands: ['ip', 'udp', 'vpn'],
  text: 'Private networks across the internet: tunnels, keys, the packet inside the packet, and why the MTU shrinks.',
  lessons: [
    { id: 'm13-l1', title: 'A private network across the internet', minutes: 12, steps: [
      { type: 'theory', title: 'The packet inside the packet', html: `
<p>Two sites use private addresses (10.1.0.0/24 and 10.2.0.0/24). The internet does not route them, and anyone on the way could read along. A <b>VPN</b> solves both: the gateway packs the private packet, encrypted, into a new packet between the public addresses of the two gateways.</p>
<pre>inner:  10.1.0.10  →  10.2.0.10       ICMP Echo Request    (encrypted)
outer:  198.51.100.1 → 203.0.113.1   UDP 51820            (visible to everyone)</pre>
<table><tr><th>Kind</th><th>Example</th></tr>
<tr><td>Site-to-site</td><td>Two offices: the gateways hold the tunnel, the PCs notice nothing</td></tr>
<tr><td>Remote access</td><td>A laptop in a hotel connects to the company network</td></tr></table>
<h2>What a VPN protects</h2>
<table><tr><th>Property</th><th>Meaning</th></tr>
<tr><td>Confidentiality</td><td>nobody on the way can read the inner packet, not even its addresses</td></tr>
<tr><td>Integrity</td><td>a changed byte is noticed, the packet is dropped</td></tr>
<tr><td>Authenticity</td><td>only someone with the right key can send into the tunnel</td></tr></table>
<h2>The cost: bytes</h2>
<p>Every packet carries a second IP header, a UDP header and the VPN header with its authentication tag. With WireGuard over IPv4 that is up to 60 bytes, over IPv6 80 bytes. That is why the tunnel interface gets a smaller MTU, usually <b>1420</b>: a 1420-byte inner packet plus 80 bytes still fits into 1500.</p>
${note('A VPN encrypts between the gateways. Inside each site the traffic is as readable as before; for end-to-end protection use TLS on top.')}
<h2>The usual protocols</h2>
<table><tr><th></th><th>WireGuard</th><th>IPsec (IKEv2 + ESP)</th><th>OpenVPN</th></tr>
<tr><td>Transport</td><td>UDP, one port</td><td>IP protocol 50 (ESP), with NAT in UDP 4500</td><td>UDP or TCP</td></tr>
<tr><td>Setup</td><td>keys only, one handshake</td><td>many proposals and phases</td><td>certificates, TLS</td></tr>
<tr><td>Code size</td><td>about 4000 lines</td><td>large, but in every firewall</td><td>large</td></tr></table>` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which addresses does a router on the internet see in a site-to-site VPN packet?', options: ['The private addresses of the PCs', 'The public addresses of the two gateways', 'Both', 'None'], correct: 1 },
        { q: 'Why does a tunnel interface have an MTU of 1420 instead of 1500?', options: ['WireGuard is slower', 'The outer headers need room, otherwise the outer packet would not fit into 1500', 'It is a historical value', 'Encryption makes packets smaller'], correct: 1 },
        { q: 'What does a VPN between two gateways not protect?', options: ['The inner addresses', 'The content on the internet', 'The traffic inside each site', 'Integrity'], correct: 2 }] }
    ] },

    { id: 'm13-l2', title: 'WireGuard', minutes: 16, steps: [
      { type: 'theory', title: 'Keys, peers and allowed IPs', html: `
<p>WireGuard needs no certificates and no negotiation. Every side has a <b>key pair</b> (Curve25519): the private key never leaves the device, the public key is given to the other side.</p>
<pre>[Interface]                         # on gwA
PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=
Address    = 10.99.0.1/24
ListenPort = 51820

[Peer]                              # gwB
PublicKey  = xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=
Endpoint   = 203.0.113.1:51820
AllowedIPs = 10.99.0.2/32, 10.2.0.0/24
PersistentKeepalive = 25</pre>
<h2>Cryptokey routing</h2>
<p><b>AllowedIPs</b> work in both directions:</p>
<ul><li><b>Sending</b>: a packet to 10.2.0.10 matches the allowed IPs of gwB, so it is encrypted with gwB's key and sent to gwB's endpoint. wg-quick also adds a route for every allowed IP into wg0.</li>
<li><b>Receiving</b>: after decrypting, the source of the inner packet must be in the allowed IPs of the peer that sent it. Otherwise it is dropped. A key thus decides which addresses a peer may use.</li></ul>
<h2>Handshake and silence</h2>
<p>Before the first data packet, one round trip creates the session keys: <i>handshake initiation</i> (148 bytes) and <i>response</i> (92 bytes). They are renewed every two minutes. A WireGuard port never answers strangers: a wrong key gets no error, just silence. That makes WireGuard invisible to port scanners, and makes troubleshooting a little harder.</p>
<h2>Roaming and NAT</h2>
<p>The endpoint is updated with every valid packet. A laptop that changes from Wi-Fi to mobile keeps its tunnel. A device behind NAT sends a <b>keepalive</b> every 25 seconds, so the NAT entry stays open and the other side can reach it at any time.</p>
${note('The packets on the wire show only UDP. In the packet inspector PacketPilot shows you the decrypted inner packet anyway, marked as encrypted.')}` },
      { type: 'build', title: 'Build the tunnel packet', blocks: ['eth', 'ip', 'icmp', 'udp', 'tcp', 'wg', 'data'],
        task: '<p>pcA (10.1.0.10) pings srvB (10.2.0.10). The handshake between gwA and gwB is done. Build the frame as gwA sends it on its internet side (eth2) to the provider router <b>isp</b>.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('isp'), src: M('gwA', 'eth2'), type: '0x0800' } },
          { block: 'ip', fields: { src: '198.51.100.1', dst: '203.0.113.1', proto: '17' } },
          { block: 'udp', fields: { sport: '51820', dport: '51820' } },
          { block: 'wg', fields: { type: '4' } },
          { block: 'ip', fields: { src: '10.1.0.10', dst: '10.2.0.10', proto: '1', ttl: '63' } },
          { block: 'icmp', fields: { type: '8' } }],
        explain: 'Outside: the public addresses of the gateways and UDP 51820. Inside, encrypted: the original packet. Its TTL is already 63, because gwA routed it once before it went into the tunnel.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'gwB receives a valid packet from gwA. Inside it is a packet from 10.5.0.1. The allowed IPs of gwA on gwB are 10.1.0.0/24. What happens?', options: ['It is forwarded', 'It is dropped', 'gwB sends an error to gwA', 'The tunnel is closed'], correct: 1 },
        { q: 'Someone sends a handshake with a wrong key to a WireGuard port. What does he get back?', options: ['An error message', 'ICMP Port Unreachable', 'Nothing at all', 'A new key'], correct: 2 },
        { q: 'A laptop behind a home router (NAT) should always be reachable through the tunnel. What does it need?', options: ['A fixed endpoint', 'PersistentKeepalive', 'A larger MTU', 'Nothing'], correct: 1 }] }
    ] },

    { id: 'm13-l3', title: 'A site-to-site tunnel in the lab', minutes: 18, steps: [
      { type: 'lab', title: 'Connect the two sites', topo: () => vpnTopo({ peerB: false }), edit: 'config',
        intro: '<p>gwA is fully configured, with gwB as its peer. gwB has WireGuard turned on and its own keys, but it does not know gwA yet. The provider router isp only knows the public networks.</p>',
        presets: { pcA: ['ping -c 3 10.2.0.10', 'traceroute 10.2.0.10'], gwA: ['wg show', 'ip route'], gwB: ['wg show', 'wg show wg0 public-key'], isp: ['ip route'] },
        goals: [
          { text: 'Ping srvB (10.2.0.10) from pcA. It does not work yet.', check: failed('pcA', '10.2.0.10') },
          { text: 'In the log of gwB: what happens to the handshake of gwA? Which public key does gwA use? Copy it from <code>wg show</code> on gwA (or its configuration) and add gwA as a peer on gwB, with the allowed IPs 10.1.0.0/24 and 10.99.0.1/32. Then ping again.', check: pingOk('pcA', '10.2.0.10') },
          { text: 'Which destination IP address does the isp router see in your ping packets from pcA?', ask: true, expect: () => ['203.0.113.1'] },
          { text: 'Click an encrypted ping in the log and look at it in the packet inspector.', check: inspected(isWgData) },
          { text: 'The ping is an 84-byte IP packet. How large is the outer IP packet the isp router forwards? (bytes)', ask: true, expect: () => ['156'], placeholder: 'bytes' }],
        hints: ['gwB answers the handshake of a key it does not know with silence. Its log says so.', 'On gwB: Configuration, WireGuard VPN, Peer. The endpoint may stay empty: gwB learns it from gwA\'s handshake.', 'The inspector shows the byte count of every layer: IP 20, UDP 8, WireGuard header 16, the inner packet padded to a multiple of 16, the tag 16.'],
        outro: '<p>The isp router only ever saw 198.51.100.1 and 203.0.113.1. The 84-byte ping grew to 156 bytes: 20 IP, 8 UDP, 16 WireGuard header, 96 bytes of padded, encrypted ping and a 16-byte tag. gwB did not even need gwA\'s address: it learned the endpoint from the handshake.</p>' }
    ] },

    { id: 'm13-l4', title: 'Allowed IPs decide', minutes: 14, steps: [
      { type: 'lab', title: 'One PC gets through, the other one does not', topo: () => vpnTopo({ allowedB: '10.99.0.1/32, 10.1.0.0/25' }), edit: 'config',
        intro: '<p>The tunnel is up. pcA (10.1.0.10) reaches srvB, but pcA2 (10.1.0.200) on the same LAN does not.</p>',
        presets: { pcA: ['ping -c 2 10.2.0.10'], pcA2: ['ping -c 2 10.2.0.10'], gwA: ['wg show', 'ip route'], gwB: ['wg show'] },
        goals: [
          { text: 'Ping srvB from pcA and from pcA2.', check: sim => pingOk('pcA', '10.2.0.10')(sim) && failed('pcA2', '10.2.0.10')(sim) },
          { text: 'Which device drops the packets of pcA2?', ask: true, expect: () => ['gwb'] },
          { text: 'Fix it, so that pcA2 reaches srvB too.', check: pingOk('pcA2', '10.2.0.10') },
          { text: 'On gwA, <code>ip route</code> shows how packets to 10.2.0.0/24 get into the tunnel. Which device (dev) does that route use?', ask: true, expect: () => ['wg0'] }],
        hints: ['Filter the log to gwB and look for "not in its allowed IPs".', '10.1.0.0/25 covers 10.1.0.0 to 10.1.0.127.'],
        outro: '<p>gwB decrypted the packet of pcA2 correctly, but its source 10.1.0.200 was not in the allowed IPs of gwA. The key of a peer only covers the addresses listed for it: that is cryptokey routing. On the sending side, the same list became the routes into wg0.</p>' }
    ] },

    { id: 'm13-l5', title: 'IPsec', minutes: 12, steps: [
      { type: 'theory', title: 'The classic in every firewall', html: `
<p>IPsec is older than WireGuard and part of almost every firewall and router. It has two parts:</p>
<table><tr><th>Part</th><th>Job</th></tr>
<tr><td><b>IKEv2</b> (UDP 500)</td><td>the peers authenticate each other (pre-shared key or certificates), agree on algorithms and create the keys</td></tr>
<tr><td><b>ESP</b> (IP protocol 50)</td><td>carries the encrypted packets</td></tr></table>
<p>The result of IKE is a pair of <b>security associations</b> (SA), one per direction, each with a number, the <b>SPI</b>. Every ESP packet carries the SPI, so the receiver knows which keys to use, just like the receiver index of WireGuard.</p>
<h2>Tunnel or transport mode</h2>
<table><tr><th>Mode</th><th>Packet</th><th>Use</th></tr>
<tr><td>Tunnel</td><td>new IP header + ESP + the whole original packet</td><td>site-to-site between gateways</td></tr>
<tr><td>Transport</td><td>original IP header + ESP + only the payload</td><td>end to end between two hosts</td></tr></table>
<h2>NAT traversal</h2>
<p>ESP has no ports, so a NAT router cannot translate it. When IKE notices a NAT on the way, both sides switch to <b>UDP 4500</b> and put ESP inside UDP (NAT-T). Firewalls for IPsec therefore have to allow UDP 500, UDP 4500 and protocol 50.</p>
${note('The most common IPsec problem is a mismatch: one side proposes AES-256 with SHA-256 and DH group 14, the other only accepts group 19. IKE then fails with NO_PROPOSAL_CHOSEN, and the logs of both sides tell different halves of the story.', true)}
<p>In the <b>Frames</b> page there is a template "Ping through IPsec" next to "Ping through WireGuard": compare the overhead.</p>` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which protocol does IPsec use to agree on keys?', options: ['ESP', 'IKE', 'AH', 'TLS'], correct: 1 },
        { q: 'Which ports and protocols does a firewall have to allow for IPsec with NAT traversal?', options: ['TCP 443', 'UDP 500, UDP 4500 and IP protocol 50', 'UDP 51820', 'Only ICMP'], correct: 1 },
        { q: 'What is the SPI in an ESP packet for?', options: ['Encryption', 'It tells the receiver which security association (keys) to use', 'Routing', 'Compression'], correct: 1 },
        { q: 'Two gateways connect two office networks. Which IPsec mode do they use?', options: ['Transport', 'Tunnel'], correct: 1 }] }
    ] }
  ]
};
