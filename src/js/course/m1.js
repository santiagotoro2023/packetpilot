import { bar, note, pingOk, tag, inspected, isArpReq } from './helpers.js';
import { PRESETS, topo, host, sw, link, failoverTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const isGarp = f => f.type === 'arp' && f.payload.spa === f.payload.tpa && f.payload.spa !== '0.0.0.0';

const switch3 = () => PRESETS.find(p => p.id === 'switch3').make();
const routed = () => PRESETS.find(p => p.id === 'routed').make();

export default {
  id: 'm1', title: 'Ethernet, MAC and ARP', bands: ['eth', 'arp', 'vlan'],
  text: 'How data gets wrapped, what a frame looks like byte by byte, how a switch learns and how ARP translates IP addresses into MAC addresses.',
  lessons: [
    { id: 'm1-l1', title: 'Encapsulation: every layer wraps', minutes: 8, steps: [
      { type: 'theory', title: 'Every layer wraps', html: `
<p>Every layer treats whatever it receives from above as payload. It puts its own header in front and hands everything down. Ethernet also appends a checksum at the end. The receiver unwraps in reverse order.</p>
${bar([['Ethernet', '14 bytes', 'eth', 1.2], ['IPv4', '20 bytes', 'ip', 1.4], ['UDP', '8 bytes', 'udp', 1], ['Application data', 'any size', 'data', 3.2], ['FCS', '4 bytes', 'eth', .8]], 'This is how a UDP packet sits on the wire: Ethernet on the outside, the application on the inside.')}
<table><tr><th>Layer</th><th>Data unit</th><th>Addressed by</th><th>Device that decides here</th></tr>
<tr><td>Application</td><td>Message</td><td>Hostname, URL</td><td>Server, client</td></tr>
<tr><td>Transport</td><td>Segment (TCP), datagram (UDP)</td><td>Port</td><td>Firewall, load balancer</td></tr>
<tr><td>Internet</td><td>Packet</td><td>IP address</td><td>Router</td></tr>
<tr><td>Link</td><td>Frame</td><td>MAC address</td><td>Switch</td></tr></table>
${note('<b>Every device only looks as deep as it has to.</b> A switch reads the Ethernet header. A router unwraps the frame, reads the IP header, decides and wraps the packet in a <i>new</i> frame. Neither of them touches anything above that.')}
<p>In the lab you can see this on every packet: the colored stripes on the envelope are its layers, from outside to inside. Clicking a packet takes it apart in the packet inspector.</p>` },
      { type: 'stack', title: 'Put the parts in the right order', retry: 'Remember: which layer goes onto the wire first?', hint: 'The top is what goes over the wire first.',
        items: [{ name: 'Ethernet header', size: '14 bytes', kind: 'eth' }, { name: 'IPv4 header', size: '20 bytes', kind: 'ip' }, { name: 'UDP header', size: '8 bytes', kind: 'udp' },
          { name: 'Application data', size: 'e.g. a DNS query', kind: 'data' }, { name: 'FCS (checksum)', size: '4 bytes', kind: 'eth' }],
        explain: 'The outermost layer comes first so that every device can immediately read what it needs. Only the FCS sits at the end: the network card can only compute it once all bytes have gone by.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which header does a switch read to decide where a frame goes?', options: ['IP header', 'Ethernet header', 'UDP header', 'All headers'], correct: 1,
          explain: 'A switch works on layer 2. It only needs the destination MAC in the Ethernet header.' },
        { q: 'What does a router change in a packet it forwards?', options: ['Nothing, it just passes it on', 'The destination IP address', 'It builds a new Ethernet frame and decrements the TTL in the IP header', 'The UDP port'], correct: 2,
          explain: 'The router strips the old Ethernet header, subtracts one from the TTL and wraps the packet in a new frame for the next segment. IP addresses and ports stay the same (without NAT).' }] }
    ] },

    { id: 'm1-l2', title: 'The Ethernet frame byte by byte', minutes: 12, steps: [
      { type: 'theory', title: 'Structure of an Ethernet II frame', html: `
<p>Almost every network you work with uses <b>Ethernet II</b>. Before and after the actual frame there are additional fields of the physical layer.</p>
${bar([['Preamble', '7', 'frag', .9], ['SFD', '1', 'frag', .5], ['Dest. MAC', '6', 'eth', 1.1], ['Source MAC', '6', 'eth', 1.1], ['Type', '2', 'eth', .7], ['Payload', '46 to 1500', 'ip', 3], ['FCS', '4', 'eth', .7], ['IFG', '12', 'frag', .9]], 'Gray: physical layer, blue: Ethernet, green: payload (e.g. an IP packet). Numbers in bytes.')}
<table><tr><th>Field</th><th>Purpose</th></tr>
<tr><td>Preamble, SFD</td><td>Bit pattern that lets the receiver synchronize, the SFD marks the start. Part of the physical layer.</td></tr>
<tr><td>Destination MAC</td><td>Comes <b>first</b> so that a switch can decide as early as possible.</td></tr>
<tr><td>Source MAC</td><td>Sender. From this the switch learns where each device is connected.</td></tr>
<tr><td>EtherType</td><td>What the payload contains: <code>0x0800</code> IPv4, <code>0x0806</code> ARP, <code>0x86DD</code> IPv6, <code>0x8100</code> VLAN tag.</td></tr>
<tr><td>Payload</td><td>46 to 1500 bytes. A payload that is too short is filled up with zeros (padding). The upper limit is the <b>MTU</b>.</td></tr>
<tr><td>FCS</td><td>CRC-32 over the frame. If it does not match, the frame is <b>silently</b> dropped.</td></tr>
<tr><td>IFG</td><td>Minimum gap before the next frame.</td></tr></table>
${note('A frame is at least <b>64 bytes</b> long (destination MAC through FCS). This dates back to the time when everyone shared one cable: a sender had to notice a collision while it was still transmitting. An ARP message (28 bytes) is therefore padded to 46 bytes of payload.')}
<h2>What is left of 1 Gbit/s</h2>
<pre>On the wire:    8 + 14 + 1500 + 4 + 12          = 1538 bytes per frame
TCP payload:    1500 - 20 (IP) - 20 (TCP) - 12 (timestamps) = 1448 bytes
1448 / 1538 = 94.1 %   →   approx. 941 Mbit/s</pre>
<p>This is exactly the value <code>iperf3</code> measures on a clean gigabit link.</p>` },
      { type: 'label', title: 'Label the frame', distractors: ['TTL', 'Port', 'VNI'],
        slots: [{ label: 'Preamble', size: '7 bytes', kind: 'frag', w: 92 }, { label: 'SFD', size: '1 byte', kind: 'frag', w: 70 },
          { label: 'Dest. MAC', size: '6 bytes', kind: 'eth', w: 100 }, { label: 'Source MAC', size: '6 bytes', kind: 'eth', w: 100 },
          { label: 'EtherType', size: '2 bytes', kind: 'eth', w: 92 }, { label: 'Payload', size: '46 to 1500 bytes', kind: 'ip', w: 150 },
          { label: 'FCS', size: '4 bytes', kind: 'eth', w: 70 }],
        explain: 'You will not see the preamble and SFD in any capture, the network card removes them. Usually the FCS as well.' },
      { type: 'quiz', title: 'Calculating with frames', questions: [
        { q: 'Which EtherType identifies an ARP message?', input: ['0x0806', '806', '0806'], explain: '<code>0x0806</code> is ARP, <code>0x0800</code> IPv4.' },
        { q: 'How many bytes does a full frame (MTU 1500) occupy on the wire, including preamble, SFD and IFG?', input: ['1538'], unit: 'bytes', explain: '8 + 14 + 1500 + 4 + 12 = 1538.' },
        { q: 'An ARP message is 28 bytes long. How many bytes of padding does the network card append?', input: ['18'], unit: 'bytes', explain: 'Minimum payload of 46 bytes minus 28 bytes of ARP = 18 bytes of zeros.' },
        { q: 'A frame arrives with a wrong FCS. What happens?', options: ['The receiver requests it again', 'It is silently dropped, only an error counter on the card goes up', 'The switch corrects it', 'It is processed anyway'], correct: 1,
          explain: 'Ethernet has no retransmission. With <code>ethtool -S eth0</code> you can see the CRC errors. If needed, TCP has to retransmit.' }] }
    ] },

    { id: 'm1-l3', title: 'What a MAC address reveals', minutes: 8, steps: [
      { type: 'theory', title: 'Structure of the MAC address', html: `
<p>A MAC address has 48 bits and is only valid in the local segment. The first 3 bytes are the <b>OUI</b> (Organizationally Unique Identifier), which the IEEE assigns to manufacturers. <code>00:50:56</code> belongs to VMware, which is why the addresses of your VMs on ESXi start with it.</p>
<p>Two bits in the first byte have a special meaning:</p>
<table><tr><th>Bit</th><th>0</th><th>1</th></tr>
<tr><td><b>b0</b> (I/G)</td><td>Unicast: one interface</td><td>Group: multicast or broadcast</td></tr>
<tr><td><b>b1</b> (U/L)</td><td>assigned by the manufacturer</td><td>locally administered (Docker, containerlab, random MAC on a smartphone)</td></tr></table>
${note('You can spot locally administered addresses by the <b>second</b> hex digit: 2, 6, A or E. Examples: <code>02:42:…</code> in older Docker versions, <code>aa:c1:ab:…</code> in containerlab and here in the lab.')}
<table><tr><th>Address</th><th>Meaning</th></tr>
<tr><td><code>ff:ff:ff:ff:ff:ff</code></td><td>Broadcast, everyone in the segment</td></tr>
<tr><td><code>01:00:5e:…</code></td><td>IPv4 multicast, e.g. OSPF to 224.0.0.5</td></tr>
<tr><td><code>33:33:…</code></td><td>IPv6 multicast</td></tr>
<tr><td><code>00:00:5e:00:01:xx</code></td><td>virtual MAC of VRRP (chapter on gateway redundancy)</td></tr></table>` },
      { type: 'mac', title: 'Examine MAC addresses', classify: ['00:50:56:a3:1f:7c', 'aa:c1:ab:12:34:56', '01:00:5e:00:00:05', 'ff:ff:ff:ff:ff:ff', '02:42:ac:11:00:02', '33:33:00:00:00:01'] }
    ] },

    { id: 'm1-l4', title: 'How a switch learns', minutes: 15, steps: [
      { type: 'theory', title: 'MAC table, flooding and aging', html: `
<p>At first a switch knows no devices. It builds its <b>MAC table</b> solely from the <b>source MACs</b> of the frames it receives.</p>
<pre>Frame arrives on port eth3: source aa:aa, destination bb:bb
1. Learn:       aa:aa is on eth3
2. Forward:
   broadcast or multicast         → to all ports except eth3 (flood)
   bb:bb is in the table          → only to that port
   bb:bb is on eth3               → drop (filter)
   bb:bb unknown                  → to all ports except eth3 (flood)</pre>
<p>Entries expire after a while without traffic (<b>aging</b>, usually 300 seconds). This way the switch adapts when a device is plugged in elsewhere.</p>
<table><tr><th>Term</th><th>Meaning</th></tr>
<tr><td>Collision domain</td><td>Devices that share a medium. On a switch in full duplex, every port is its own.</td></tr>
<tr><td>Broadcast domain</td><td>All devices a broadcast reaches. A switch floods broadcasts, a router does not.</td></tr></table>
${note('A <b>hub</b> learns nothing and passes every frame on to everyone. In the next step you turn the switch into a hub by setting the aging time to 0, and see the difference.')}` },
      { type: 'lab', title: 'The switch learns', topo: switch3, edit: 'config',
        intro: '<p>pc1, pc2 and pc3 are connected to sw1. Double-click <b>pc1</b> to open its console and ping pc2.</p>',
        presets: { pc1: ['ping -c 2 10.0.0.2'], pc3: ['ip neigh'] },
        goals: [
          { text: 'Ping pc2 (10.0.0.2) from pc1.', check: pingOk('pc1', '10.0.0.2') },
          { text: 'On which port did sw1 learn the MAC address of pc2? Look it up under Tables on sw1.', ask: true, expect: () => ['eth2'], placeholder: 'e.g. eth1' },
          { text: 'pc3 saw the ARP request, but not a single ping. Set the aging time on sw1 to 0 and ping again. Now pc3 sees the ICMP packets too.',
            check: tag('pc3', 'frame-not-mine', d => d.kind === 'icmp') }],
        hints: ['You will find the aging time on sw1 at the very bottom of Configuration.', 'Filter the log to "Only pc3" to see what arrives at pc3.'],
        outro: '<p>With aging 0 the switch forgets every address immediately and has to flood everything like a hub. Every host then sees other hosts\' traffic: bad for security and for bandwidth. Feel free to set the aging time back to 300 afterwards.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'From what does a switch learn which port a device is connected to?', options: ['From the destination MAC', 'From the source MAC', 'From the IP address', 'From ARP'], correct: 1, explain: 'Only the source MAC reveals who is sending on that port.' },
        { q: 'A switch receives a frame for a MAC that is not in its table. What does it do?', options: ['Drop it', 'Ask via ARP', 'Send it to all ports in the VLAN except the incoming one', 'Send it to the router'], correct: 2,
          explain: 'Unknown unicast flooding. When the destination replies, the switch learns its port, and from then on traffic goes there directly.' }] }
    ] },

    { id: 'm1-l5', title: 'ARP: from IP to MAC', minutes: 15, steps: [
      { type: 'theory', title: 'How ARP works', html: `
<p>An application only knows the IP address of its destination, but an Ethernet frame needs a destination MAC. <b>ARP</b> (Address Resolution Protocol) finds it, and only for addresses in its <b>own</b> subnet.</p>
<pre>pc1 10.0.0.1 wants to send to 10.0.0.3 but does not know the MAC
1. Request (broadcast to ff:ff:ff:ff:ff:ff): Who has 10.0.0.3? Tell 10.0.0.1
2. Reply   (unicast to pc1):                  10.0.0.3 is at aa:c1:ab:…
3. Both add each other to their ARP table, pc3 already on the request.</pre>
${bar([['Ethernet', '14', 'eth', 1.4], ['HW/proto type', '4', 'arp', 1], ['Lengths', '2', 'arp', .7], ['Operation', '2', 'arp', .8], ['Sender MAC/IP', '10', 'arp', 1.6], ['Target MAC/IP', '10', 'arp', 1.6]], 'ARP sits directly in the Ethernet frame (EtherType 0x0806), without an IP header. The message is always 28 bytes.')}
<p>Linux calls the ARP table the <b>neighbor table</b> (<code>ip neigh</code>). An entry is <code>REACHABLE</code> as long as it has been recently confirmed, then <code>STALE</code>. If a request goes unanswered, it becomes <code>FAILED</code>, and the host itself reports <code>Destination Host Unreachable</code>.</p>
${note('A <b>gratuitous ARP</b> announces one\'s own IP unsolicited. VRRP, MetalLB and kube-vip use it during a failover: all neighbors update their table immediately.')}
${note('ARP has <b>no authentication</b>. Any device in the segment can send replies, and most systems believe them. Protection comes from Dynamic ARP Inspection on switches, small segments and encryption on higher layers.', true)}` },
      { type: 'lab', title: 'Watch ARP', topo: switch3, edit: 'config',
        intro: '<p>Feel free to turn the speed down: this way you can see how the request goes to everyone and only one reply comes back.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.3', 'ip neigh'], pc2: ['ping -c 1 10.0.0.99'] },
        goals: [
          { text: 'Ping pc3 (10.0.0.3) from pc1.', check: pingOk('pc1', '10.0.0.3') },
          { text: 'Click the ARP request in the log and look at it in the packet inspector.', check: inspected(isArpReq) },
          { text: 'Which target MAC is in the request?', ask: true, expect: () => ['00:00:00:00:00:00'], placeholder: 'xx:xx:xx:xx:xx:xx' },
          { text: 'From pc2, ping the address 10.0.0.99, which does not exist. Who reports "Destination Host Unreachable"?',
            check: tag('pc2', 'arp-failed', d => d.ip === '10.0.0.99') },
          { text: 'From which IP address did the "Destination Host Unreachable" message come?', ask: true, expect: () => ['10.0.0.2'] }],
        outro: '<p>The message does not come from a router but from pc2 itself: its three ARP requests went unanswered.</p>' },
      { type: 'build', title: 'Build the ARP request yourself', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: '<p><b>pc1</b> (10.0.0.1) wants to reach <b>pc3</b> (10.0.0.3) but does not know its MAC. Build the frame that pc1 sends first.</p>',
        addresses: { mac: [[M('pc1'), 'pc1'], [M('pc2'), 'pc2'], [M('pc3'), 'pc3'], [M('sw1'), 'sw1']], ip: [['10.0.0.1', 'pc1'], ['10.0.0.2', 'pc2'], ['10.0.0.3', 'pc3']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('pc1'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('pc1'), spa: '10.0.0.1', tha: '00:00:00:00:00:00', tpa: '10.0.0.3' } }],
        explain: 'The Ethernet destination is broadcast so that pc3 receives the question at all. In the ARP part the MAC being looked for is still unknown, hence zeros. There is no IP header: ARP sits directly in the Ethernet frame.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'To which destination MAC is an ARP request sent?', options: ['To the MAC of the gateway', 'To ff:ff:ff:ff:ff:ff', 'To 00:00:00:00:00:00', 'To the MAC of the switch'], correct: 1, explain: 'The request is a broadcast, the reply a unicast.' },
        { q: 'Why does pc3 know the MAC of pc1 after the ping, even though pc3 never asked itself?', options: ['The switch told it', 'pc3 learned it from the request (sender MAC and IP)', 'Via DHCP', 'It does not'], correct: 1,
          explain: 'The request contains the sender MAC and sender IP. Whoever is asked adds the asker right away, since it is about to reply to it.' }] }
    ] },

    { id: 'm1-garp', title: 'Gratuitous ARP and failover', minutes: 20, steps: [
      { type: 'theory', title: 'ARP messages nobody asked for', html: `
<p>Besides request and reply, ARP has two special forms that you will see in every capture:</p>
<table><tr><th>Message</th><th>Sender IP</th><th>Target IP</th><th>Purpose</th></tr>
<tr><td><b>Gratuitous ARP</b></td><td>its own</td><td>its own</td><td>"This address is now at my MAC." Neighbors with an entry for the address update it immediately.</td></tr>
<tr><td><b>ARP probe</b></td><td>0.0.0.0</td><td>the desired one</td><td>"Is anyone already using this address?" If someone answers, there is a conflict (RFC 5227).</td></tr></table>
<p>Both are broadcast to everyone. A gratuitous ARP is usually phrased as a request, sometimes as a reply. Linux only uses it to update <b>existing</b> entries and does not create new ones.</p>
<h2>When a device sends a gratuitous ARP</h2>
<ul><li>when an interface comes up, to announce its own address and notice conflicts</li>
<li>during a <b>failover</b>: VRRP, keepalived, kube-vip or MetalLB move a service address to another machine</li>
<li>after a live migration of a VM, so that the switches learn the MAC on the new port</li></ul>
<h2>The neighbor states on Linux</h2>
<table><tr><th>State</th><th>Meaning</th></tr>
<tr><td>REACHABLE</td><td>recently confirmed (around 30 seconds)</td></tr>
<tr><td>STALE</td><td>still in use, but no longer confirmed</td></tr>
<tr><td>DELAY</td><td>a packet went to a STALE entry, wait 5 seconds to see whether a confirmation arrives</td></tr>
<tr><td>PROBE</td><td>three unicast requests directly to the stored MAC</td></tr>
<tr><td>FAILED</td><td>no answer, the entry is discarded, the next packet asks again via broadcast</td></tr></table>
${note('Without a gratuitous ARP, a client keeps sending its packets to the <b>old</b> MAC after a failover until its neighbor check fails. That easily adds up to 30 to 40 seconds of outage. With a gratuitous ARP it is over after milliseconds.')}
<pre>arping -U -c 3 -I eth0 10.0.0.100   # send a gratuitous ARP (like keepalived)
arping -D -I eth0 10.0.0.100        # check whether the address is free</pre>` },
      { type: 'build', title: 'Build the gratuitous ARP', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: `<p>The service address <code>10.0.0.100</code> moves from srvA to <b>srvB</b>. Build the message with which srvB tells all neighbors that 10.0.0.100 is now at its MAC (phrased as a request).</p>`,
        addresses: { mac: [[M('srvA'), 'srvA'], [M('srvB'), 'srvB'], [M('client'), 'client']], ip: [['10.0.0.100', 'service address'], ['10.0.0.12', 'srvB'], ['10.0.0.5', 'client']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('srvB'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('srvB'), spa: '10.0.0.100', tha: ['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'], tpa: '10.0.0.100' } }],
        explain: 'Sender IP and target IP are the same, which makes the message "gratuitous". Nobody has to reply. Everyone who has 10.0.0.100 in their table replaces the old MAC with that of srvB.' },
      { type: 'lab', title: 'Failover without gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: `<p>srvA holds the service address 10.0.0.100. Start a long ping on the client. Then let srvA fail (disconnect the cable) and give srvB the address 10.0.0.100. No gratuitous ARP is sent <b>yet</b>. The speed slider or the fast-forward button makes the waiting go faster.</p>`,
        presets: { client: ['ping -c 60 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['ip addr add 10.0.0.100/24 dev eth1'] },
        goals: [
          { text: 'Start the ping and let srvA fail while it is running.', check: sim => sim.log.some(e => e.tag === 'link-down') && sim.log.some(e => e.dev === 'client' && e.tag === 'arp-learned') },
          { text: 'Give srvB the address 10.0.0.100.', check: sim => sim.dev('srvB').cfg.ifaces.eth1.ip === '10.0.0.100' },
          { text: 'Wait until the client discards the old MAC and asks again.', check: tag('client', 'nud-failed', d => d.ip === '10.0.0.100') },
          { text: 'In which state does the client send unicast requests to the old MAC?', ask: true, expect: () => ['probe'] },
          { text: 'srvB answers the pings.', check: tag('srvB', 'echo-request-received') }],
        hints: ['The commands are available as buttons in the console of each device.', 'In the log under "Only client" you can see how the entry ages and is checked.'],
        outro: '<p>Count the lost pings: for about 35 seconds every packet went to a MAC that no longer existed. This is exactly the gap the gratuitous ARP closes.</p>' },
      { type: 'lab', title: 'Failover with gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: '<p>The same again, but this time srvB announces the address with <code>arping -U</code> after taking it over. First check with an ARP probe whether the address is really free.</p>',
        presets: { client: ['ping -c 30 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['arping -D -c 2 10.0.0.100', 'ip addr add 10.0.0.100/24 dev eth1', 'arping -U -c 1 10.0.0.100'] },
        goals: [
          { text: 'From srvB, use arping -D to check whether 10.0.0.100 is taken while srvA is still running. The probe reports a conflict.', check: tag('srvB', 'arping-done', d => d.mode === 'dad' && d.replies > 0) },
          { text: 'Start the ping, let srvA fail, give srvB the address and send the gratuitous ARP.', check: tag('client', 'garp-updated', d => d.ip === '10.0.0.100') },
          { text: 'srvB answers the pings without the client having to ask again.', check: sim => sim.log.some(e => e.dev === 'srvB' && e.tag === 'echo-request-received') && !sim.log.some(e => e.dev === 'client' && e.tag === 'nud-failed') },
          { text: 'Click the gratuitous ARP in the log. Which sender IP does it carry?', ask: true, expect: () => ['10.0.0.100'] }],
        hints: ['The order matters: first take over the address, then send the gratuitous ARP.'],
        outro: '<p>The client rewrote its entry immediately. This is exactly how keepalived and kube-vip work: whoever takes over the address immediately sends a gratuitous ARP. Along the way, the switches learn which port the MAC of srvB is on.</p>' }
    ] },

    { id: 'm1-l6', title: 'A packet across a router', minutes: 18, steps: [
      { type: 'theory', title: 'MAC hop by hop, IP end to end', html: `
<p>When a host wants to send to an IP address <b>outside</b> its subnet, it does not ask for that address's MAC but for the MAC of its <b>default gateway</b>.</p>
<pre>pc1 192.168.10.10/24 → srv1 192.168.20.20
1. Is 192.168.20.20 in 192.168.10.0/24?  No → to the gateway 192.168.10.1
2. ARP asks for 192.168.10.1, not for 192.168.20.20
3. r1 accepts the frame, reads the destination IP, finds the route, TTL 64 → 63
4. r1 asks via ARP on eth2 for 192.168.20.20 and builds a new frame</pre>
<table><tr><th></th><th>Segment LAN A (pc1 → r1)</th><th>Segment LAN B (r1 → srv1)</th></tr>
<tr><td>Source MAC</td><td>pc1</td><td>r1 eth2</td></tr><tr><td>Destination MAC</td><td>r1 eth1</td><td>srv1</td></tr>
<tr><td>Source IP</td><td>192.168.10.10</td><td>192.168.10.10</td></tr><tr><td>Destination IP</td><td>192.168.20.20</td><td>192.168.20.20</td></tr>
<tr><td>TTL</td><td>64</td><td><b>63</b></td></tr></table>
${note('<b>Remember:</b> MAC addresses are valid hop by hop and are rewritten by every router. IP addresses are valid end to end and stay the same as long as there is no NAT in between.')}
<table><tr><th>Symptom</th><th>Typical cause</th></tr>
<tr><td>Own subnet works, everything beyond it does not</td><td>Gateway wrong or missing</td></tr>
<tr><td>Host asks via ARP for the remote destination instead of the gateway</td><td>Netmask too large, e.g. /16 instead of /24</td></tr>
<tr><td>Packet arrives, the reply does not</td><td>The destination has no gateway, the return path is missing</td></tr></table>` },
      { type: 'lab', title: 'Prove the rule yourself', topo: routed, edit: 'config',
        intro: '<p>Ping srv1 from pc1. Then click the ping packets that r1 sends and receives in the log and read the values in the packet inspector. The filter "Only r1" helps.</p>',
        presets: { pc1: ['ping -c 1 192.168.20.20'] },
        goals: [
          { text: 'Ping srv1 (192.168.20.20) from pc1.', check: pingOk('pc1', '192.168.20.20') },
          { text: 'Which IP address did pc1 ask for via ARP?', ask: true, expect: () => ['192.168.10.1'] },
          { text: 'Which destination MAC does the ping have in LAN A?', ask: true, expect: s => [s.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' },
          { text: 'Which source MAC does the same ping have in LAN B?', ask: true, expect: s => [s.dev('r1').mac('eth2')], placeholder: 'aa:c1:ab:…' },
          { text: 'Which TTL does the ping have in LAN B?', ask: true, expect: () => ['63'] },
          { text: 'Set the prefix on pc1 to 16 and ping again. Which address does pc1 now ask for via ARP?', ask: true, expect: () => ['192.168.20.20'] }],
        hints: ['The MAC addresses of r1 are shown in the Console tab of r1 with the command ip addr.', 'A ping in LAN B is a frame that r1 sends out of eth2.'],
        outro: '<p>With /16, pc1 believes 192.168.20.20 is in its own network and asks for it directly. Nobody answers, and pc1 itself reports "Destination Host Unreachable". Set the prefix back to 24.</p>' }
    ] }
  ]
};
