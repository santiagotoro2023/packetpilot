import { bar, note, tag, inspected, isTcpSyn, isDns } from './helpers.js';
import { servicesTopo, tcpPathTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const ADDR = {
  mac: [[M('client'), 'client'], [M('r1'), 'r1 eth1 (gateway)'], [M('web'), 'web'], [M('dns'), 'dns']],
  ip: [['10.10.0.10', 'client'], ['10.10.0.1', 'r1 eth1'], ['10.20.0.80', 'web'], ['10.20.0.53', 'dns']],
  name: ['web.lab', 'dns.lab', 'client.lab']
};
const EPHEMERAL = { range: [1024, 65535] };
const tcpDoneAfter = (evTag, port) => sim => {
  const ev = sim.log.find(e => e.tag === evTag);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.tag === 'tcp-done' && e.data.ok && (!port || e.data.port === port));
};

export default {
  id: 'm5', title: 'Transport: UDP, TCP and services', bands: ['ip', 'udp', 'tcp'],
  text: 'Ports and sockets, DNS over UDP, the three-way handshake, refused and filtered connections, MSS and the path MTU from TCP\'s point of view.',
  lessons: [
    { id: 'm5-l1', title: 'Ports, sockets and UDP', minutes: 10, steps: [
      { type: 'theory', title: 'Who gets the packet?', html: `
<p>The IP address brings a packet to the right host. But many programs run on the host at the same time. Which one gets the data is decided by the transport layer using <b>ports</b>: 16-bit numbers from 0 to 65535.</p>
<table><tr><th>Range</th><th>Name</th><th>Examples</th></tr>
<tr><td>0 to 1023</td><td>Well-known ports, on Linux only with root privileges</td><td>22 SSH, 53 DNS, 80 HTTP, 443 HTTPS</td></tr>
<tr><td>1024 to 49151</td><td>registered ports</td><td>3306 MySQL, 5432 PostgreSQL, 4789 VXLAN</td></tr>
<tr><td>49152 to 65535</td><td>dynamic ports for clients (IANA)</td><td>Linux uses 32768 to 60999 by default</td></tr></table>
<p>A server <b>listens</b> on a fixed port. A client gets a random <b>source port</b> from the operating system. The combination of protocol, source IP, source port, destination IP and destination port (the <b>5-tuple</b>) uniquely determines which connection a packet belongs to. That is why a browser can have ten connections open to the same web server.</p>
<h2>UDP: simple and fast</h2>
${bar([['Source port', '2', 'udp', 1], ['Dest. port', '2', 'udp', 1], ['Length', '2', 'udp', 1], ['Checksum', '2', 'udp', 1], ['Data', 'any size', 'data', 2.6]], 'The UDP header is only 8 bytes.')}
<p>UDP delivers datagrams without a connection, without acknowledgment, without retransmission and without ordering. Whatever gets lost is gone, unless the application takes care of it itself. That is intentional: DNS, DHCP, NTP, syslog, VoIP, VXLAN, WireGuard and QUIC (HTTP/3) use UDP because they want to be fast or handle reliability themselves.</p>
${note('If a UDP datagram arrives on a port where nothing is listening, the host replies with ICMP <b>Port Unreachable</b> (type 3, code 3). <code>ss -tuln</code> shows which ports are open on a Linux host.')}` },
      { type: 'label', title: 'Label the UDP header', distractors: ['TTL', 'Sequence number', 'Flags'],
        slots: [{ label: 'Source port', size: '16 bits', kind: 'udp', w: 130 }, { label: 'Dest. port', size: '16 bits', kind: 'udp', w: 130 }, { label: 'Length', size: '16 bits', kind: 'udp', w: 130 }, { label: 'Checksum', size: '16 bits', kind: 'udp', w: 130 }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A client queries a DNS server. Which port is the destination port on the way there?', options: ['A random high port', '53', '80', '67'], correct: 1, explain: 'In the reply the ports are swapped: source 53, destination the client\'s random port.' },
        { q: 'What happens if a UDP datagram is lost on the way?', options: ['UDP resends it after a timeout', 'Nothing, unless the application asks again', 'The router sends it again', 'The receiver requests it'], correct: 1 },
        { q: 'How long is the UDP header?', input: ['8'], unit: 'bytes' }] }
    ] },

    { id: 'm5-l2', title: 'DNS over UDP', minutes: 15, steps: [
      { type: 'theory', title: 'One question, one answer', html: `
<p>DNS translates names into addresses. A query almost always fits into a single UDP datagram, and so does the answer. If no answer comes, the client simply asks again after a few seconds.</p>
<pre>client  →  dns   UDP 51234 → 53   query: A record for web.lab?
dns     →  client UDP 53 → 51234  answer: web.lab A 10.20.0.80</pre>
<table><tr><th>Response code</th><th>Meaning</th></tr>
<tr><td>NOERROR</td><td>Name found, address in the answer section</td></tr>
<tr><td>NXDOMAIN</td><td>the name does not exist</td></tr>
<tr><td>SERVFAIL</td><td>the server could not answer the question</td></tr></table>
<p><code>dig @10.20.0.53 web.lab</code> queries a specific server. Without <code>@</code>, dig uses the configured DNS server (on Linux from <code>/etc/resolv.conf</code>). Programs like <code>curl</code> or <code>ping</code> first resolve a name and only then send the actual packet.</p>
${note('Answers over 512 bytes (e.g. with DNSSEC) switch to TCP port 53. A firewall that only allows UDP 53 therefore sometimes causes strange errors.')}` },
      { type: 'build', title: 'Build the DNS query', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dns'],
        task: '<p>The <b>client</b> (10.10.0.10, gateway 10.10.0.1) asks the DNS server <b>dns</b> (10.20.0.53) for <code>web.lab</code>. The DNS server is in a different subnet. Build the frame as it leaves the client\'s cable.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.53', proto: '17', ttl: '64' } },
          { block: 'udp', fields: { sport: EPHEMERAL, dport: '53' } },
          { block: 'dns', fields: { qr: '0', name: 'web.lab' } }],
        explain: 'The destination MAC is that of the gateway, because the DNS server is in a different network. The IP addresses are valid end to end. The source port is any high port chosen by the operating system.' },
      { type: 'lab', title: 'Resolve names', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>The client asks the server dns. Open the client\'s console and look at the query and the answer in the packet inspector.</p>',
        presets: { client: ['dig @10.20.0.53 web.lab', 'dig @10.20.0.53 doesnotexist.lab', 'nc -u 10.20.0.53 5353'], dns: ['ss -tuln'] },
        goals: [
          { text: 'Use dig to ask the server 10.20.0.53 for web.lab.', check: tag('client', 'dns-done', d => d.ok && d.name === 'web.lab') },
          { text: 'Click the DNS query in the log and expand it in the packet inspector.', check: inspected(isDns) },
          { text: 'Which source port does the client\'s query have?', ask: true,
            expect: sim => sim.log.filter(e => e.dev === 'client' && e.kind === 'send' && e.frame && isDns(e.frame) && !e.frame.payload.l4.payload.qr).map(e => String(e.frame.payload.l4.sport)) },
          { text: 'Ask for a name that does not exist. Which status does dig report?', ask: true, expect: () => ['nxdomain'] },
          { text: 'Use nc -u to send a UDP datagram to a port on which dns is not listening.', check: tag('dns', 'port-unreachable-sent') }],
        hints: ['The status is in the ->>HEADER<<- line of the dig output.'],
        outro: '<p>dns answers the closed port with ICMP Port Unreachable. This way the client learns that nobody is listening there. Without this message, for example because a firewall drops it, a closed UDP port looks exactly like a lost packet.</p>' }
    ] },

    { id: 'm5-l3', title: 'TCP: the three-way handshake', minutes: 18, steps: [
      { type: 'theory', title: 'Reliable over an unreliable network', html: `
<p>TCP turns individual IP packets into a reliable <b>byte stream</b>: every byte is numbered, the receiver acknowledges what it has received, and anything missing is sent again. Before data flows, both sides agree on their starting numbers.</p>
${bar([['Ports', '4', 'tcp', 1], ['Sequence number', '4', 'tcp', 1.2], ['Acknowledgment', '4', 'tcp', 1.2], ['Length, flags', '2', 'tcp', 1], ['Window', '2', 'tcp', .8], ['Checksum, urgent', '4', 'tcp', 1.1], ['Options', '0 to 40', 'tcp', 1], ['Data', '', 'data', 1.6]], 'At least 20 bytes of header, up to 60 bytes with options.')}
<table><tr><th>Flag</th><th>Meaning</th></tr>
<tr><td>SYN</td><td>Open a connection, set the starting number</td></tr>
<tr><td>ACK</td><td>The acknowledgment field is valid. Always set from the second segment on.</td></tr>
<tr><td>PSH</td><td>Hand the data to the application immediately</td></tr>
<tr><td>FIN</td><td>I will not send anything more, clean end</td></tr>
<tr><td>RST</td><td>Abort: port closed or connection unknown</td></tr></table>
<h2>Setup and teardown</h2>
<pre>client                                 web:80
  SYN       seq=1000          MSS 1460  →          LISTEN
            ←  SYN, ACK  seq=5000 ack=1001  MSS 1460
  ACK       seq=1001 ack=5001           →          ESTABLISHED
  PSH, ACK  GET / HTTP/1.1 (78 bytes)   →
            ←  ACK, data: HTTP/1.1 200 OK …
  FIN, ACK                              →
            ←  FIN, ACK
  ACK                                   →          closed</pre>
<p>SYN and FIN count as one byte, which is why the server acknowledges the 1000 with 1001. The starting numbers are random so that nobody can inject foreign segments into a connection. The SYN also contains the <b>MSS</b> (maximum segment size): the maximum number of data bytes a segment may carry, normally the MTU minus 40.</p>
${note('A router reads none of this. To it, a TCP segment is an IP packet like any other. Only stateful firewalls and load balancers look at ports and flags.')}` },
      { type: 'label', title: 'Label the TCP header', distractors: ['TTL', 'VNI', 'Length (UDP)'],
        rows: [[{ label: 'Source port', size: '16 bits', kind: 'tcp', w: 200 }, { label: 'Dest. port', size: '16 bits', kind: 'tcp', w: 200 }],
          [{ label: 'Sequence number', size: '32 bits', kind: 'tcp', w: 406 }],
          [{ label: 'Acknowledgment number', size: '32 bits', kind: 'tcp', w: 406 }],
          [{ label: 'Header length', size: '4 bits', kind: 'tcp', w: 100 }, { label: 'Flags', size: '12 bits', kind: 'tcp', w: 96 }, { label: 'Window', size: '16 bits', kind: 'tcp', w: 200 }],
          [{ label: 'Checksum', size: '16 bits', kind: 'tcp', w: 200 }, { label: 'Urgent pointer', size: '16 bits', kind: 'tcp', w: 200 }]],
        explain: 'The window says how many bytes the receiver can still take in. This lets it slow down a sender that is too fast (flow control).' },
      { type: 'stack', title: 'Put the segments in the right order', hint: 'The top is the first segment of a short HTTP connection.',
        items: [{ name: 'client → web: SYN', kind: 'tcp' }, { name: 'web → client: SYN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' },
          { name: 'client → web: PSH, ACK with GET /', kind: 'data' }, { name: 'web → client: ACK with HTTP/1.1 200 OK', kind: 'data' },
          { name: 'client → web: FIN, ACK', kind: 'tcp' }, { name: 'web → client: FIN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' }] },
      { type: 'build', title: 'Build the first segment', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'http'],
        task: '<p>The <b>client</b> (10.10.0.10) opens a connection to the web server <b>web</b> (10.20.0.80, port 80) in a different subnet. Build the first frame of this connection as it leaves the client\'s cable.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.80', proto: '6', ttl: '64' } },
          { block: 'tcp', fields: { sport: EPHEMERAL, dport: '80', flags: 'SYN' } }],
        explain: 'The first segment only carries the SYN flag and no data yet. The HTTP request only follows after the handshake.' }
    ] },

    { id: 'm5-l4', title: 'TCP in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Fetch a web page', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>Fetch the page <code>http://web.lab/</code> from the client. curl first resolves the name via DNS and then opens the TCP connection. Turn the speed down and follow the segments.</p>',
        presets: { client: ['curl http://web.lab/', 'curl http://10.20.0.80/'], web: ['ss -tuln', 'ss -tan'] },
        goals: [
          { text: 'Fetch http://web.lab/.', check: tag('client', 'tcp-done', d => d.ok && d.mode === 'http') },
          { text: 'Click the first SYN segment and look at its options.', check: inspected(isTcpSyn) },
          { text: 'Which MSS does the client announce in the SYN?', ask: true, expect: () => ['1460'] },
          { text: 'In how many segments does web send the response?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-response').map(e => String(e.data.segments)) },
          { text: 'Which flags does the second segment of the handshake have?', ask: true, expect: () => ['syn, ack', 'syn,ack', 'syn ack', 'syn/ack', 'synack', 'syn-ack', 'ack, syn', 'ack,syn'] }],
        hints: ['In the log the segments are called SYN, SYN/ACK and so on. Filter to "Only client".', 'The response is 3000 bytes. Calculate with the MSS.'],
        outro: '<p>The 3000 byte response does not fit into one segment: web splits it according to the MSS. The client acknowledges every segment. In real networks it often only acknowledges every second one (delayed ACK), and the sender sends several segments without waiting for acknowledgments (window).</p>' }
    ] },

    { id: 'm5-l5', title: 'Refused, filtered, prohibited', minutes: 15, steps: [
      { type: 'theory', title: 'Three ways a connection fails', html: `
<table><tr><th>What you see</th><th>What happened</th><th>Typical cause</th></tr>
<tr><td><code>Connection refused</code> immediately</td><td>An RST came back in response to the SYN</td><td>Nothing is listening on the port, or a firewall rejects with RST</td></tr>
<tr><td><code>timed out</code> after seconds</td><td>Nothing at all came back in response to the SYN, the client repeats it several times</td><td>A firewall drops silently (DROP), or the host is gone</td></tr>
<tr><td><code>No route to host</code> or <code>prohibited</code></td><td>An ICMP error came back</td><td>No ARP for the destination, or a firewall rejects with ICMP</td></tr></table>
<p><code>nc -zv host port</code> only tests the connection setup and is well suited to distinguish these cases.</p>
${note('A firewall that rejects with RST uses the server\'s address as the sender. To the client, a rejected port therefore looks exactly like a closed one. Only the firewall\'s log or a capture on both sides shows the difference.')}
${note('DROP or REJECT? DROP reveals less, but makes every client wait until the timeout. For internal networks REJECT is often friendlier; at the border to the internet DROP is usually used.')}` },
      { type: 'lab', title: 'Find out what stops the connection', topo: () => servicesTopo({ acl: [
        { action: 'drop', proto: 'tcp', port: 80, src: 'any', dst: '10.20.0.80/32' },
        { action: 'reject', proto: 'tcp', port: 443, src: 'any', dst: '10.20.0.80/32' }] }), edit: 'config',
        intro: '<p>A colleague reports: "web.lab does not work". web runs HTTP (80) and HTTPS (443), SSH (22) is not installed. Examine the three ports from the client.</p>',
        presets: { client: ['nc -zv 10.20.0.80 22', 'nc -zv 10.20.0.80 80', 'nc -zv 10.20.0.80 443', 'curl http://web.lab/'], web: ['ss -tuln'] },
        goals: [
          { text: 'Test port 22. The connection is refused immediately.', check: tag('client', 'tcp-refused', d => d.port === 22) },
          { text: 'Test port 80. This time the connection times out.', check: tag('client', 'tcp-timeout', d => d.port === 80) },
          { text: 'Test port 443. Here too: refused, even though the service is running.', check: tag('client', 'tcp-refused', d => d.port === 443) },
          { text: 'Which device actually sent the RST for port 443?', ask: true, expect: () => ['r1'] },
          { text: 'Change the rules on r1 so that HTTP to web is allowed, and fetch http://web.lab/.', check: tag('client', 'tcp-done', d => d.ok && d.port === 80 && d.mode === 'http') }],
        hints: ['How often did the client send its SYN for port 80? The log shows it.', 'You will find the rules under Configuration on r1. The first matching one applies.'],
        outro: '<p>Port 22 and port 443 looked the same to the client, but the cause was completely different: once no service, once a rule on r1. The log of r1 gives it away with "Rule 2 (reject) matches".</p>' }
    ] },

    { id: 'm5-l6', title: 'Segments, MSS and the path MTU', minutes: 18, steps: [
      { type: 'theory', title: 'TCP does not fragment, TCP segments', html: `
<p>TCP sets the DF bit in every packet. Instead of IP fragments it uses smaller segments. How large they may be is negotiated by both sides in the handshake with the MSS: each side announces the MTU of its interface minus 40 (20 IP, 20 TCP). But both only know their own link.</p>
<pre>client ── r1 ══ MTU 1400 ══ r2 ── fw ── web
MSS in the handshake: 1460 and 1460 → web sends segments of 1500 bytes
r2 cannot forward them (DF set) → ICMP Fragmentation Needed, MTU 1400 to web
web remembers the path MTU and resends the data, now with 1360 bytes per segment</pre>
<p>This is <b>Path MTU Discovery</b> (module IP and routing) from TCP's point of view. If the ICMP message does not arrive, the infamous <b>PMTUD blackhole</b> appears:</p>
<table><tr><th>Symptom</th><th>Explanation</th></tr>
<tr><td>The connection is established, then it hangs</td><td>SYN, SYN/ACK and ACK are small and fit, the full data segments do not</td></tr>
<tr><td>SSH login works, at the first <code>ls</code> in a large directory it freezes</td><td>small packets get through, large ones do not</td></tr>
<tr><td>Web pages load halfway</td><td>the beginning fits into small segments, the rest does not</td></tr></table>
<h2>Remedy</h2>
<p>The clean solution: do not filter ICMP type 3 code 4. Where that is out of your hands, <b>MSS clamping</b> on the router in front of the narrow spot helps. It rewrites the MSS in every forwarded SYN, so both sides send small segments from the start:</p>
<pre>iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
         -j TCPMSS --set-mss 1360</pre>
${note('Typical places for this are VPN tunnels, PPPoE (MTU 1492) and VXLAN without jumbo frames in the underlay.')}` },
      { type: 'lab', title: 'Path MTU Discovery with TCP', topo: () => tcpPathTopo(), edit: 'config',
        intro: '<p>Between r1 and r2 there is a section with MTU 1400. The response from web is 6000 bytes. Fetch it and watch how web adjusts its segments.</p>',
        presets: { client: ['curl http://10.0.2.80/'], web: ['ip route get 10.0.1.10'] },
        goals: [
          { text: 'Fetch http://10.0.2.80/ from the client.', check: tag('client', 'tcp-done', d => d.ok) },
          { text: 'Which router sent ICMP Fragmentation Needed?', ask: true, expect: sim => sim.log.filter(e => e.tag === 'frag-needed-sent').map(e => e.dev) },
          { text: 'With which MSS does web resend the data?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-retransmit').map(e => String(e.data.mss)) }],
        outro: '<p>In the console, web now also has an entry <code>cache mtu 1400</code> with <code>ip route get 10.0.1.10</code>. This is how Linux remembers the path MTU per destination.</p>' },
      { type: 'lab', title: 'The blackhole and MSS clamping', topo: () => tcpPathTopo({ fwAcl: [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }), edit: 'config',
        intro: '<p>Someone has blocked all ICMP on fw. Fetch the page again and compare. Then fix the problem without touching the rule on fw.</p>',
        presets: { client: ['curl http://10.0.2.80/'], r1: ['show ip route'] },
        goals: [
          { text: 'Fetch http://10.0.2.80/. The connection is up, but the data does not arrive.', check: tag('client', 'tcp-stalled') },
          { text: 'Was the three-way handshake completed? (yes or no)', ask: true, expect: () => ['yes'] },
          { text: 'Set up MSS clamping on r1 so that the segments fit through the narrow spot, and fetch the page again.', check: tcpDoneAfter('tcp-stalled') }],
        hints: ['You will find MSS clamping on r1 under Configuration, below IP forwarding.', 'MTU 1400 minus 40 bytes for IP and TCP.'],
        outro: '<p>With MSS clamping, the client only announces 1360 in the SYN, and the SYN/ACK from web is also adjusted on the way back. Neither side sends a segment that is too large any more, ICMP is not needed at all.</p>' }
    ] }
  ]
};
