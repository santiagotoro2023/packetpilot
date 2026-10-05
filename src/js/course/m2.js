import { bar, note, pingOk, pingFailed, tag } from './helpers.js';
import { PRESETS, chainTopo, topo, host, server, router, link } from '../presets.js';

const mtuTopo = () => PRESETS.find(p => p.id === 'mtu').make();
const brokenReturn = () => { const t = chainTopo(); t.name = 'Missing return path'; t.devices.find(d => d.id === 'r2').routes = [{ dst: '10.0.4.0/24', via: '10.0.23.3' }]; return t; };
const blackhole = () => topo('PMTUD blackhole', [
  host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'),
  router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']], {
    acl: [{ action: 'allow', proto: 'icmp', icmpType: 8, src: 'any', dst: 'any' }, { action: 'allow', proto: 'icmp', icmpType: 0, src: 'any', dst: 'any' },
      { action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }),
  router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]),
  server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
[link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'srv1', 'eth1', 1400)]);

export default {
  id: 'm2', title: 'IP and routing', bands: ['ip', 'icmp', 'udp'],
  text: 'The IPv4 header, how routers decide, TTL and traceroute, the return path, MTU with Path MTU Discovery and rules on routers.',
  lessons: [
    { id: 'm2-l1', title: 'The IPv4 header', minutes: 12, steps: [
      { type: 'theory', title: 'What every IP packet contains', html: `
<p>Every IPv4 packet starts with at least 20 bytes of header. Every router reads it, and even changes two fields.</p>
<table><tr><th>Field</th><th>Bits</th><th>Purpose</th></tr>
<tr><td>Version, IHL</td><td>4 + 4</td><td>4 and the header length in 32-bit words (usually 5 = 20 bytes)</td></tr>
<tr><td>TOS (DSCP, ECN)</td><td>8</td><td>Priority for QoS and congestion notification</td></tr>
<tr><td>Total Length</td><td>16</td><td>Length including the header, at most 65,535</td></tr>
<tr><td>Identification, Flags, Offset</td><td>16 + 3 + 13</td><td>Fragmentation. The <b>DF</b> flag forbids splitting</td></tr>
<tr><td><b>TTL</b></td><td>8</td><td>Every router subtracts 1, at 0 the packet is dropped</td></tr>
<tr><td>Protocol</td><td>8</td><td>1 ICMP, 6 TCP, 17 UDP, 50 ESP, 89 OSPF</td></tr>
<tr><td><b>Header Checksum</b></td><td>16</td><td>Covers only the header. Recomputed at every hop because of the TTL</td></tr>
<tr><td>Source IP, destination IP</td><td>32 + 32</td><td>Stay the same end to end (without NAT)</td></tr></table>
${note('The <b>Protocol</b> field plays the same role as the EtherType in the Ethernet frame: it says how to read the payload. OSPF runs directly on IP with protocol 89, BGP on the other hand over TCP port 179.')}` },
      { type: 'label', title: 'Label the IPv4 header', distractors: ['Dest. MAC', 'Port', 'VNI'],
        rows: [
          [{ label: 'Version', size: '4 bits', kind: 'ip', w: 70 }, { label: 'IHL', size: '4 bits', kind: 'ip', w: 70 }, { label: 'TOS', size: '8 bits', kind: 'ip', w: 130 }, { label: 'Total Length', size: '16 bits', kind: 'ip', w: 250 }],
          [{ label: 'Identification', size: '16 bits', kind: 'ip', w: 250 }, { label: 'Flags', size: '3 bits', kind: 'ip', w: 70 }, { label: 'Fragment Offset', size: '13 bits', kind: 'ip', w: 198 }],
          [{ label: 'TTL', size: '8 bits', kind: 'ip', w: 130 }, { label: 'Protocol', size: '8 bits', kind: 'ip', w: 136 }, { label: 'Header Checksum', size: '16 bits', kind: 'ip', w: 256 }],
          [{ label: 'Source IP', size: '32 bits', kind: 'ip', w: 530 }],
          [{ label: 'Destination IP', size: '32 bits', kind: 'ip', w: 530 }]],
        explain: 'Each row has 32 bits. The first five rows are the 20 bytes of the standard header.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which protocol number does UDP have?', input: ['17'], explain: '1 ICMP, 6 TCP, 17 UDP.' },
        { q: 'Why does a router have to recompute the header checksum for every packet?', options: ['Because the destination IP changes', 'Because it changes the TTL and the checksum covers the header', 'Because Ethernet requires it', 'It does not have to'], correct: 1,
          explain: 'The TTL is part of the header. When it changes, the old checksum no longer matches.' }] }
    ] },

    { id: 'm2-l2', title: 'The routing decision', minutes: 12, steps: [
      { type: 'theory', title: 'Routing table and longest prefix match', html: `
<p>Hosts and routers decide using the same procedure. A router simply also forwards packets that are not addressed to itself.</p>
<pre>$ ip route
default via 192.168.10.1 dev eth1                         ← default route
10.20.0.0/16 via 192.168.10.254 dev eth1                  ← static route
192.168.10.0/24 dev eth1 proto kernel scope link          ← connected route</pre>
<table><tr><th>Entry</th><th>ARP asks for</th></tr>
<tr><td>Connected route (directly attached)</td><td>the <b>destination</b> itself</td></tr>
<tr><td>Route with <code>via</code></td><td>the <b>next hop</b></td></tr></table>
${note('<b>Longest prefix match:</b> if several entries match, the most specific one wins, i.e. the one with the longest prefix. The order in the table does not matter. For prefixes of equal length, the origin decides: connected before static.')}
<p>On Linux, <code>ip route get &lt;destination&gt;</code> shows the decision for a destination without sending a packet. You can try this in every console in the lab, too.</p>` },
      { type: 'lpm', title: 'Where does the packet go?', table: [['10.0.0.0/8', 'A'], ['10.1.0.0/16', 'B'], ['10.1.2.0/24', 'C'], ['10.1.2.64/26', 'D'], ['0.0.0.0/0', 'E']],
        dests: ['10.1.2.77', '10.1.2.200', '10.9.9.9', '10.1.3.1', '172.16.5.5'] },
      { type: 'lpm', title: 'And without a default route?', table: [['192.168.0.0/16', 'R1'], ['192.168.10.0/24', 'R2'], ['192.168.10.128/25', 'R3']],
        dests: ['192.168.10.130', '192.168.10.5', '192.168.11.5', '8.8.8.8'] }
    ] },

    { id: 'm2-l3', title: 'TTL and traceroute', minutes: 12, steps: [
      { type: 'theory', title: 'How traceroute reveals the routers', html: `
<p>The TTL prevents a packet from circling forever when there is a routing error. The router that sets it to 0 drops the packet and sends <b>ICMP Time Exceeded</b> to the sender.</p>
<p><code>traceroute</code> takes advantage of this: it sends packets with TTL 1, 2, 3 … Every router along the way gives itself away with its Time Exceeded message. Linux sends UDP to high ports (from 33434) for this, and at the end the destination answers with <b>Port Unreachable</b>.</p>
<pre> 1  10.0.1.1    0.4 ms     ← TTL 1 expired at r1
 2  10.0.12.2   0.6 ms     ← TTL 2 expired at r2
 3  10.0.23.3   0.8 ms
 4  10.0.4.10   1.0 ms     ← destination: Port Unreachable</pre>
${note('A <code>*</code> only means that no answer came from this hop. Many routers rate-limit Time Exceeded but forward without any problem. The initial TTL often reveals the system: Linux 64, Windows 128, many network devices 255.')}` },
      { type: 'lab', title: 'Trace the path', topo: chainTopo, edit: 'view',
        intro: '<p>pc1 reaches srv1 via three routers. Start a traceroute on pc1 and watch at which router each packet dies.</p>',
        presets: { pc1: ['traceroute 10.0.4.10', 'ping -c 1 -t 2 10.0.4.10'] },
        goals: [
          { text: 'Run traceroute 10.0.4.10 on pc1.', check: tag('pc1', 'trace-done', d => d.reached) },
          { text: 'Which address answers at the second hop?', ask: true, expect: () => ['10.0.12.2'] },
          { text: 'Send a ping with TTL 2 (ping -c 1 -t 2 10.0.4.10). Which router reports Time Exceeded?', ask: true, expect: () => ['r2', '10.0.12.2'] },
          { text: 'With which TTL does the reply from srv1 arrive for a normal ping?', ask: true, expect: () => ['61'] }],
        outro: '<p>Three routers, so 64 - 3 = 61. The answer at the second hop comes from the address of the interface through which r2 sends the message back to pc1.</p>' }
    ] },

    { id: 'm2-l4', title: 'The return path counts just as much', minutes: 15, steps: [
      { type: 'theory', title: 'Routing only ever applies in one direction', html: `
<p>Every router on the way needs a route to the destination, and every router on the way back needs a route to the <b>source</b>. If the return path is missing, the ping reaches the destination but the reply never comes back. This is the most common mistake with static routing.</p>
${note('How to troubleshoot: <b>1.</b> Does the packet reach the destination? <b>2.</b> Does the destination have a route back? <b>3.</b> Does every router on the way back have a route to the source? Check with <code>ip route get</code> on every device.')}
<p>When the forward and return traffic take different paths, this is called <b>asymmetric routing</b>. It is allowed, but stateful firewalls drop such connections because they only see one direction.</p>` },
      { type: 'lab', title: 'Find the missing return path', topo: brokenReturn, edit: 'config',
        intro: '<p>pc1 cannot reach srv1. Find out where the problem is and fix it with a static route.</p>',
        presets: { pc1: ['ping -c 2 10.0.4.10'], r2: ['ip route', 'ip route get 10.0.1.10'] },
        goals: [
          { text: 'Ping srv1 from pc1 and observe: the ping fails.', check: pingFailed('pc1', '10.0.4.10') },
          { text: 'Show that the echo request still reaches srv1 (filter the log: Only srv1).', check: tag('srv1', 'echo-request-received') },
          { text: 'Which router has no route back to 10.0.1.0/24?', ask: true, expect: () => ['r2'] },
          { text: 'Add the missing route and ping again until it works.', check: pingOk('pc1', '10.0.4.10') }],
        hints: ['Look under Tables on r2 to see which networks it knows.', 'r2 is missing: destination 10.0.1.0/24 via 10.0.12.1. In the console: ip route add 10.0.1.0/24 via 10.0.12.1'] }
    ] },

    { id: 'm2-l5', title: 'MTU and Path MTU Discovery', minutes: 15, steps: [
      { type: 'theory', title: 'Too large for the path', html: `
<p>If a packet is larger than the MTU of the next link, a router has two options:</p>
<table><tr><th>DF flag</th><th>What the router does</th></tr>
<tr><td>not set</td><td>Splits the packet into <b>fragments</b>. Only the destination reassembles them. If one fragment is lost, everything is lost.</td></tr>
<tr><td>set</td><td>Drops the packet and sends back <b>ICMP Fragmentation Needed</b> with the matching MTU. The sender remembers the MTU and sends smaller packets. This is <b>Path MTU Discovery</b>.</td></tr></table>
<pre>ping -M do -s 1472 dest     1472 + 8 (ICMP) + 20 (IP) = 1500 bytes, DF set
ping -M dont -s 1472 dest   same size, fragmentation allowed</pre>
${note('After a Fragmentation Needed message, Linux already rejects packets that are too large locally: <code>ping: local error: message too long, mtu=1400</code>. With <code>ip route get</code> you can see the learned MTU.')}` },
      { type: 'lab', title: 'The bottleneck', topo: mtuTopo, edit: 'view',
        intro: '<p>The link between r1 and r2 only has MTU 1400. Test it from pc1.</p>',
        presets: { pc1: ['ping -c 2 -M do -s 1472 10.0.2.20', 'ping -c 1 -M dont -s 1472 10.0.2.20', 'ip route get 10.0.2.20'] },
        goals: [
          { text: 'Send a ping with 1472 bytes and DF (-M do). Which MTU does r1 report back?', ask: true, expect: () => ['1400'] },
          { text: 'pc1 remembers the MTU of the path.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Send the same ping without DF (-M dont). r1 fragments the packet, and the ping gets through.', check: pingOk('pc1', '10.0.2.20', { size: 1472, df: false }) },
          { text: 'Into how many fragments did r1 split the packet?', ask: true, expect: () => ['2'] },
          { text: 'What is the largest value for -s with which the ping works with -M do?', ask: true, expect: () => ['1372'] }],
        outro: '<p>1372 + 8 + 20 = 1400. That is exactly how large an IP packet may be across the narrowest link.</p>' }
    ] },

    { id: 'm2-l6', title: 'Rules and the PMTUD blackhole', minutes: 15, steps: [
      { type: 'theory', title: 'Rules on routers', html: `
<p>Routers and firewalls filter packets with <b>rules</b>. The rules are checked from top to bottom, and the <b>first matching</b> one applies. Typical actions are allow, drop (silently) and reject (with an ICMP message).</p>
<p>A common mistake: ICMP is blocked completely except for ping because it is supposedly "insecure". This also makes <b>Fragmentation Needed</b> (ICMP type 3) disappear. Small packets get through, large ones vanish without a trace: SSH works, large downloads hang. This is called a <b>PMTUD blackhole</b>.</p>
<table><tr><th>ICMP type</th><th>Meaning</th><th>Block it?</th></tr>
<tr><td>8 / 0</td><td>Echo Request / Reply</td><td>rate-limiting it from outside is acceptable</td></tr>
<tr><td>3</td><td>Destination Unreachable, incl. Fragmentation Needed</td><td><b>never</b></td></tr>
<tr><td>11</td><td>Time Exceeded</td><td>better not, otherwise traceroute stops working</td></tr></table>` },
      { type: 'lab', title: 'Fix the blackhole', topo: blackhole, edit: 'config',
        intro: '<p>r1 only allows ping (types 8 and 0) and drops all other ICMP. The MTU between r2 and srv1 is 1400.</p>',
        presets: { pc1: ['ping -c 1 10.0.2.20', 'ping -c 1 -M do -s 1472 10.0.2.20', 'ping -c 1 -M do -s 1372 10.0.2.20'] },
        goals: [
          { text: 'A normal ping from pc1 to srv1 works.', check: pingOk('pc1', '10.0.2.20') },
          { text: 'A ping with -M do -s 1472 vanishes without any message. Find in the log where the ICMP message from r2 ends up.', check: tag('r1', 'acl-drop') },
          { text: 'Add a rule on r1 that allows ICMP type 3, and place it above the drop rule. Now pc1 learns the MTU.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Send a ping with -M do -s 1372.', check: pingOk('pc1', '10.0.2.20', { size: 1372, df: true }) }],
        hints: ['You will find the rules under Configuration on r1. New rule: allow, ICMP, type 3, then move it up with the arrow.'] }
    ] },

    { id: 'm2-l7', title: 'Control plane and data plane', minutes: 6, steps: [
      { type: 'theory', title: 'Who decides, who forwards?', html: `
<table><tr><th></th><th>Control plane</th><th>Data plane</th></tr>
<tr><td>Task</td><td>Find out which paths exist</td><td>Forward every packet</td></tr>
<tr><td>How often</td><td>on changes in the network</td><td>millions of times per second</td></tr>
<tr><td>Linux with FRR</td><td>FRR: ospfd, bgpd, zebra</td><td>the kernel</td></tr>
<tr><td>Result</td><td>Entries in the routing table</td><td>Packets on the right interface</td></tr></table>
<p>If the router knows the same route from several sources, the lowest <b>administrative distance</b> wins: connected 0, static 1, eBGP 20, OSPF 110, iBGP 200.</p>
${note('If the control plane hangs, the data plane keeps forwarding with the existing routes. It just no longer reacts to changes. You know the same principle from Kubernetes: the API server and scheduler decide, kubelet and kube-proxy carry it out.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A route to 10.0.0.0/24 is static and is also known via OSPF. Which one wins?', options: ['OSPF, because it is dynamic', 'The static one, distance 1 instead of 110', 'The one with the lower metric', 'Both alternately'], correct: 1, explain: 'For the same prefix, the administrative distance decides.' },
        { q: 'Which distance does an OSPF route have in FRR?', input: ['110'] }] }
    ] }
  ]
};
