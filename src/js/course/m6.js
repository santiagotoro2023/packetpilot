import { bar, note, tag, inspected } from './helpers.js';
import { dhcpTopo, dhcpLanTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const isDhcp = op => f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'dhcp' && (!op || f.payload.l4.payload.op === op);
const boundAfter = (dev, evTag) => sim => {
  const ev = sim.log.find(e => e.dev === dev && e.tag === evTag);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.dev === dev && e.tag === 'dhcp-bound');
};
const leaseOf = (sim, dev) => sim.dev(dev).l3.lease?.ip;

export default {
  id: 'm6', title: 'DHCP: addresses on demand', bands: ['udp', 'ip', 'data'],
  text: 'How a device without any address gets one: the four DHCP messages, leases and options, and why a router needs a relay to pass them on.',
  lessons: [
    { id: 'm6-l1', title: 'Discover, Offer, Request, ACK', minutes: 10, steps: [
      { type: 'theory', title: 'Getting an address without having one', html: `
<p>Configuring every device by hand does not scale, and two devices with the same address break each other. The <b>Dynamic Host Configuration Protocol</b> hands out addresses automatically. A DHCP server owns a <b>pool</b> of addresses and lends them out for a limited time, the <b>lease</b>.</p>
<p>The tricky part: the client has no address yet, so it cannot send a normal packet. It sends from <code>0.0.0.0</code> to the broadcast address <code>255.255.255.255</code>, so every device in the segment receives it. DHCP runs over UDP: the server listens on port <b>67</b>, the client on port <b>68</b>.</p>
<pre>client                                      server
  DISCOVER  0.0.0.0 → 255.255.255.255     "Is there a DHCP server?"
            ←  OFFER   10.10.0.100           "You can have 10.10.0.100"
  REQUEST   0.0.0.0 → 255.255.255.255     "I take 10.10.0.100 from that server"
            ←  ACK                           "Confirmed, valid for 3600 s"</pre>
<p>The four messages are easy to remember as <b>DORA</b>. The request is a broadcast too: if several servers made an offer, all of them learn which one was chosen, and the others put their address back into the pool.</p>
${bar([['Ethernet', '14', 'eth', 1], ['IPv4', '20', 'ip', 1], ['UDP 68 → 67', '8', 'udp', 1], ['DHCP message with options', 'about 300', 'data', 3]], 'A DHCP message: the client MAC (chaddr) identifies the client, the options carry everything else.')}
<table><tr><th>Option</th><th>Content</th></tr>
<tr><td>1</td><td>Subnet mask</td></tr><tr><td>3</td><td>Router, the default gateway</td></tr>
<tr><td>6</td><td>DNS servers</td></tr><tr><td>51</td><td>Lease time</td></tr><tr><td>53</td><td>Message type (Discover, Offer, …)</td></tr>
<tr><td>54</td><td>Server identifier</td></tr></table>
${note('Halfway through the lease (T1), the client asks the same server directly to extend it. Only if that fails for a long time does it start over with a broadcast. If a client gets no answer at all, Linux keeps the interface without an address, Windows picks one from <code>169.254.0.0/16</code> (APIPA): a sure sign that DHCP failed.')}` },
      { type: 'stack', title: 'Put the DHCP messages in order', hint: 'The top is the first message.',
        items: [{ name: 'DHCP Discover from the client (broadcast)', kind: 'data' }, { name: 'DHCP Offer from the server', kind: 'data' },
          { name: 'DHCP Request from the client (broadcast)', kind: 'data' }, { name: 'DHCP ACK from the server', kind: 'data' }],
        explain: 'DORA: Discover, Offer, Request, ACK. After the ACK the client configures the address, the gateway and the DNS server.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which source IP address does a DHCP Discover have?', input: ['0.0.0.0'], explain: 'The client has no address yet. That is why the server identifies it by its MAC address.' },
        { q: 'On which UDP port does a DHCP server listen?', input: ['67'], explain: 'Server 67, client 68.' },
        { q: 'Why is the Request a broadcast, even though the client already knows the server?', options: ['Because it still has no address', 'So that all servers that made an offer learn which one was chosen', 'Both'], correct: 2,
          explain: 'Both are true: without an address the client cannot send unicast, and the other servers can release their offered addresses.' }] }
    ] },

    { id: 'm6-l2', title: 'DORA in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Watch two clients get their address', topo: dhcpLanTopo, edit: 'config',
        intro: '<p>client1 and client2 are set to DHCP and ask for an address as soon as they start. The server <b>dhcp</b> hands out 10.10.0.100 to 10.10.0.199. Turn the speed down if it is too fast, or let a client ask again.</p>',
        presets: { client1: ['dhclient -r', 'dhclient', 'ip addr', 'ip route'], dhcp: ['show ip dhcp binding'] },
        goals: [
          { text: 'Both clients have an address.', check: sim => !!leaseOf(sim, 'client1') && !!leaseOf(sim, 'client2') },
          { text: 'Click a DHCP Offer in the log and look at its options in the packet inspector.', check: inspected(isDhcp('OFFER')) },
          { text: 'Which destination IP does the Offer have?', ask: true, expect: () => ['255.255.255.255'] },
          { text: 'Release the address of client1 (<code>dhclient -r</code>) and ask again (<code>dhclient</code>).', check: boundAfter('client1', 'dhcp-released-client') },
          { text: 'Which address did client2 get?', ask: true, expect: sim => [leaseOf(sim, 'client2')].filter(Boolean), placeholder: '10.10.0.…' }],
        hints: ['A Discover and a Request come from 0.0.0.0. The server answers to the broadcast address too, because the client cannot receive anything else yet.', 'The server shows its leases with show ip dhcp binding.'],
        outro: '<p>client1 got the same address again: the server remembers which address belongs to which MAC and offers it again. That is why devices often keep their address even though it is assigned dynamically.</p>' },
      { type: 'build', title: 'Build the DHCP Discover', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dhcp'],
        task: '<p><b>client1</b> starts and has no address. Build the first frame it sends.</p>',
        addresses: { mac: [[M('client1'), 'client1'], [M('client2'), 'client2'], [M('dhcp'), 'dhcp']], ip: [['10.10.0.2', 'dhcp'], ['10.10.0.100', 'first address of the pool']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('client1'), type: '0x0800' } },
          { block: 'ip', fields: { src: '0.0.0.0', dst: '255.255.255.255', proto: '17', ttl: '64' } },
          { block: 'udp', fields: { sport: '68', dport: '67' } },
          { block: 'dhcp', fields: { op: 'DISCOVER', chaddr: M('client1') } }],
        explain: 'From nobody to everyone: source 0.0.0.0, destination 255.255.255.255, as an Ethernet broadcast. The only thing that identifies the client is its MAC address in the chaddr field.' }
    ] },

    { id: 'm6-l3', title: 'Across routers: the DHCP relay', minutes: 15, steps: [
      { type: 'theory', title: 'Broadcasts stop at the router', html: `
<p>Routers do not forward broadcasts, which keeps every network quiet. But it also means a DHCP Discover never leaves its own network. Nobody wants a DHCP server in every VLAN, so routers have a <b>relay agent</b> (Cisco: <code>ip helper-address</code>, Linux: <code>dhcrelay</code>).</p>
<pre>client ─── r1 (relay) ─────────── DHCP server
  DISCOVER broadcast →
          r1: Unicast to 10.20.0.67, giaddr = 10.10.0.1 →
                         ← OFFER unicast to the relay (giaddr)
  ← r1: broadcast on the client network</pre>
<p>The relay writes the address of the interface the request came in on into the <b>giaddr</b> field (gateway IP address). The server uses it twice: it picks the <b>pool</b> whose network contains the giaddr, and it sends the answer back to the relay.</p>
${note('One DHCP server can serve dozens of VLANs this way. Every routed interface with clients needs the helper address, and the server needs one pool per network. A forgotten helper on a new VLAN is one of the most common reasons why "DHCP does not work".')}` },
      { type: 'lab', title: 'Set up the relay', topo: () => dhcpTopo({ relay: false }), edit: 'config',
        intro: '<p>The DHCP server is in 10.20.0.0/24, the clients are in 10.10.0.0/24. r1 routes between them, but no relay is configured yet.</p>',
        presets: { client1: ['dhclient', 'ip addr'], dhcp: ['show ip dhcp binding'] },
        goals: [
          { text: 'client1 asks, but nobody answers: "No DHCPOFFERS received". The fast-forward button saves waiting.', check: tag('client1', 'dhcp-failed') },
          { text: 'Configure the relay on r1 (Configuration → DHCP, helper for eth1: 10.20.0.67), then let client1 ask again.', check: sim => isIpSet(sim) && sim.log.some(e => e.dev === 'client1' && e.tag === 'dhcp-bound') },
          { text: 'Click a relayed packet between r1 and the server. Which address is in the giaddr field?', ask: true, expect: () => ['10.10.0.1'] },
          { text: 'client2 gets an address too.', check: sim => !!leaseOf(sim, 'client2') }],
        hints: ['On the server the request now arrives as a normal unicast from 10.10.0.1.', 'client2 asks again with dhclient in its console, or with the button in its configuration.'],
        outro: '<p>The server chose the pool 10.10.0.0/24 because the giaddr 10.10.0.1 is in it. If you add another client network to r1, you only need a helper address there and a second pool on the server.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A new VLAN 30 gets no DHCP addresses, all others work. What is the most likely cause?', options: ['The DHCP server is down', 'The helper address is missing on the VLAN 30 interface of the router, or the pool for VLAN 30 is missing', 'The switch blocks broadcasts', 'DNS is wrong'], correct: 1 },
        { q: 'How does the server know which pool to use for a relayed request?', options: ['From the client MAC', 'From the giaddr field the relay filled in', 'From the source port', 'It always uses the first pool'], correct: 1 }] }
    ] }
  ]
};

function isIpSet(sim) { return /^\d+\.\d+\.\d+\.\d+$/.test(sim.dev('r1').cfg.ifaces.eth1.helper || ''); }
