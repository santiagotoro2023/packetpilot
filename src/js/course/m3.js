import { bar, note, pingOk, tag, inspected, isVxlan } from './helpers.js';
import { vlanTopo, vxlanTopo, stickTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const subif = (sim, vid, ip) => Object.values(sim.dev('r1').cfg.ifaces).some(i => i.parent === 'eth1' && Number(i.vlan) === vid && i.ip === ip);

export default {
  id: 'm3', title: 'VLAN and VXLAN', bands: ['vlan', 'udp', 'vxlan'],
  text: 'Separate layer 2 segments with 802.1Q, understand trunks and stretch segments across a routed network with VXLAN.',
  lessons: [
    { id: 'm3-l1', title: 'VLANs and the 802.1Q tag', minutes: 10, steps: [
      { type: 'theory', title: 'Several switches in one', html: `
<p>A <b>VLAN</b> splits a switch into several logical switches. Each VLAN is its own broadcast domain. There is no layer 2 connection between VLANs, only through a router.</p>
<p>So that switches can still tell which VLAN a frame belongs to, a 4 byte <b>tag</b> is inserted after the source MAC:</p>
${bar([['Dest. MAC', '6', 'eth', 1.1], ['Source MAC', '6', 'eth', 1.1], ['TPID 0x8100', '2', 'vlan', 1.2], ['PCP DEI VID', '2', 'vlan', 1.2], ['EtherType', '2', 'eth', .9], ['Payload', 'up to 1500', 'ip', 2.4], ['FCS', '4', 'eth', .7]], 'The frame gets 4 bytes longer, the MTU stays 1500.')}
<table><tr><th>Field</th><th>Bits</th><th>Meaning</th></tr>
<tr><td>TPID</td><td>16</td><td><code>0x8100</code> sits where the EtherType would otherwise be</td></tr>
<tr><td>PCP</td><td>3</td><td>Priority 0 to 7</td></tr><tr><td>DEI</td><td>1</td><td>may be dropped first under congestion</td></tr>
<tr><td>VID</td><td>12</td><td>VLAN number, usable 1 to 4094</td></tr></table>` },
      { type: 'label', title: 'Label the tag', distractors: ['TTL', 'VNI'],
        slots: [{ label: 'TPID', size: '16 bits', kind: 'vlan', w: 210 }, { label: 'PCP', size: '3 bits', kind: 'vlan', w: 74 }, { label: 'DEI', size: '1 bit', kind: 'vlan', w: 58 }, { label: 'VID', size: '12 bits', kind: 'vlan', w: 170 }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'How many VLANs can you use with 12 bits?', input: ['4094'], explain: '2<sup>12</sup> = 4096, of which 0 and 4095 are reserved.' },
        { q: 'Which value is in the TPID?', input: ['0x8100', '8100'] }] }
    ] },

    { id: 'm3-l2', title: 'Access port and trunk', minutes: 15, steps: [
      { type: 'theory', title: 'When frames carry a tag', html: `
<table><tr><th>Port</th><th>On the wire</th><th>Typical for</th></tr>
<tr><td><b>Access</b></td><td>without a tag, the port belongs to exactly one VLAN</td><td>PC, printer, server with one network</td></tr>
<tr><td><b>Trunk</b></td><td>with a tag, several VLANs over one cable</td><td>switch to switch, router, hypervisor</td></tr></table>
<p>On a trunk, one VLAN may additionally run without a tag, the <b>native VLAN</b>. If it does not match on both sides, two VLANs get connected. Some switches warn about it (Cisco CDP: native VLAN mismatch), but the traffic leaks either way.</p>
${note('Your VMs on ESXi know this: for the VM, the port group is an access port. The vSwitch only adds the tag when the frame leaves the host via the uplink (a trunk).')}` },
      { type: 'lab', title: 'Connect two switches properly', topo: () => vlanTopo(false), edit: 'config',
        intro: '<p>a10 and b10 belong in VLAN 10, a20 and b20 in VLAN 20. But the cable between s1 and s2 is an access port in VLAN 1 on both sides. Turn it into a trunk.</p>',
        presets: { a10: ['ping -c 1 10.10.0.2'], a20: ['ping -c 1 10.20.0.2'] },
        goals: [
          { text: 'a10 reaches b10 (10.10.0.2).', check: pingOk('a10', '10.10.0.2') },
          { text: 'a20 reaches b20 (10.20.0.2).', check: pingOk('a20', '10.20.0.2') },
          { text: 'Click a frame in the log that s1 sends out of eth8, and find the tag in the packet inspector.', check: inspected(f => !!f.vlan) },
          { text: 'Which VID do the frames from a20 carry on the trunk?', ask: true, expect: () => ['20'] }],
        hints: ['On s1 and s2 under Configuration: set eth8 to trunk, allowed VLANs 10,20.'] }
    ] },

    { id: 'm3-stick', title: 'Routing between VLANs: router on a stick', minutes: 18, steps: [
      { type: 'theory', title: 'One cable, many networks', html: `
<p>Between VLANs you need a router. With a dedicated router port per VLAN, you quickly run out of ports with ten VLANs. The solution: the router is attached to a trunk with <b>one</b> cable and has a <b>subinterface</b> per VLAN instead. Each subinterface only sends and receives frames with its VLAN tag and has its own IP address, the gateway of the respective VLAN.</p>
<pre># Linux
ip link add link eth1 name eth1.10 type vlan id 10
ip addr add 10.10.0.1/24 dev eth1.10
ip link add link eth1 name eth1.20 type vlan id 20
ip addr add 10.20.0.1/24 dev eth1.20

# Cisco IOS
interface GigabitEthernet0/0.10
 encapsulation dot1Q 10
 ip address 10.10.0.1 255.255.255.0</pre>
<h2>The path of a packet from a1 (VLAN 10) to b1 (VLAN 20)</h2>
<pre>a1 → sw1      untagged, access port in VLAN 10
sw1 → r1      tag 10 on the trunk
r1            accepts it on eth1.10, routes, sends out of eth1.20
r1 → sw1      tag 20 on the trunk, same cable back
sw1 → b1      untagged, access port in VLAN 20</pre>
${note('All subinterfaces share the MAC address of the physical interface. That is no problem because each VLAN is its own segment.')}
${note('Every routed packet crosses the same cable twice. With a lot of traffic between VLANs this link becomes a bottleneck. Larger networks therefore route directly in the switch (layer 3 switch with one SVI per VLAN).', true)}` },
      { type: 'lab', title: 'Set up the subinterfaces', topo: () => stickTopo(false), edit: 'config',
        intro: '<p>sw1 is fully configured: a1 and a2 in VLAN 10, b1 and b2 in VLAN 20, eth8 as a trunk to r1. On r1 everything is missing. Create the two subinterfaces, under Configuration (Add a feature, Subinterfaces) or in the console.</p>',
        presets: { r1: ['ip link add link eth1 name eth1.10 type vlan id 10', 'ip link add link eth1 name eth1.20 type vlan id 20', 'ip addr add 10.10.0.1/24 dev eth1.10', 'ip addr add 10.20.0.1/24 dev eth1.20', 'ip -br a'], a1: ['ping -c 2 10.20.0.11'] },
        goals: [
          { text: 'r1 has a subinterface for VLAN 10 with 10.10.0.1/24.', check: sim => subif(sim, 10, '10.10.0.1') },
          { text: 'r1 has a subinterface for VLAN 20 with 10.20.0.1/24.', check: sim => subif(sim, 20, '10.20.0.1') },
          { text: 'Ping b1 (10.20.0.11) from a1.', check: pingOk('a1', '10.20.0.11') },
          { text: 'Click a frame that r1 sends with tag 20.', check: inspected(f => f.vlan?.vid === 20 && f.type === 'ipv4') },
          { text: 'How many times does the ping from a1 cross the cable between sw1 and r1 on its way to b1?', ask: true, expect: () => ['2', 'twice'] },
          { text: 'Which source MAC does the frame have that r1 sends in VLAN 20?', ask: true, expect: sim => [sim.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' }],
        hints: ['The commands are available as buttons in the console of r1.', 'Under Configuration: Subinterfaces, parent eth1, enter the VLAN, Create. Then enter the IP.'],
        outro: '<p>The source MAC is that of eth1, no matter which subinterface r1 sends through. The only thing that distinguishes the VLANs is the tag.</p>' },
      { type: 'build', title: 'Build the frame on the trunk', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp'],
        task: `<p>a1 (10.10.0.11) pings b1 (10.20.0.11). Build the echo request as <b>r1</b> sends it over the trunk towards b1. MAC of r1 eth1: <code>${M('r1')}</code>.</p>`,
        addresses: { mac: [[M('a1'), 'a1'], [M('b1'), 'b1'], [M('r1'), 'r1 eth1'], [M('sw1'), 'sw1']], ip: [['10.10.0.11', 'a1'], ['10.20.0.11', 'b1'], ['10.10.0.1', 'r1 eth1.10'], ['10.20.0.1', 'r1 eth1.20']] },
        expected: [
          { block: 'eth', fields: { dst: M('b1'), src: M('r1'), type: '0x8100' } },
          { block: 'vlan', fields: { vid: '20', type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.11', dst: '10.20.0.11', proto: '1', ttl: '63' } },
          { block: 'icmp', fields: { type: '8' } }],
        explain: 'The EtherType in the Ethernet header is 0x8100 and announces the tag. Only after the tag does the actual EtherType 0x0800 follow. r1 decremented the TTL by one, the IP addresses stay the same.' }
    ] },

    { id: 'm3-l3', title: 'VXLAN: Ethernet in UDP', minutes: 12, steps: [
      { type: 'theory', title: 'Layer 2 across a routed network', html: `
<p>VLANs need a continuous layer 2 path and are limited to 4094. Modern data centers therefore route every link and lay layer 2 segments on top as an <b>overlay</b>. The standard protocol for this is <b>VXLAN</b> (RFC 7348): it wraps an entire Ethernet frame in a UDP packet.</p>
${bar([['Ethernet', '14', 'eth', 1], ['IPv4', '20', 'ip', 1.1], ['UDP 4789', '8', 'udp', 1], ['VXLAN', '8', 'vxlan', 1], ['Ethernet', '14', 'eth', 1], ['Host IP packet', 'up to 1500', 'ip', 2.6]], 'The underlay on the outside, the host\'s unchanged frame on the inside.')}
<table><tr><th>Term</th><th>Meaning</th></tr>
<tr><td>Underlay</td><td>the routed network, only knows the addresses of the VTEPs</td></tr>
<tr><td>Overlay</td><td>the layer 2 segments on top</td></tr>
<tr><td>VTEP</td><td>wraps and unwraps frames (VXLAN Tunnel Endpoint)</td></tr>
<tr><td>VNI</td><td>number of the segment, 24 bits, over 16 million</td></tr></table>
${note('Why UDP? UDP goes through any IP network. And the VTEP computes the UDP source port from the inner frame: different connections get different ports, and routers with several equally good paths (ECMP) spread them across those paths.')}
${note('If you do not specify one, Linux uses the old port <b>8472</b>. Always specify <code>dstport 4789</code>, otherwise two VTEPs talk past each other.', true)}
<p>For broadcasts and unknown destinations (BUM traffic), a VTEP sends a copy to every VTEP in its <b>flood list</b> (head-end replication). From the frames it unwraps, it learns which MAC is behind which VTEP: <b>flood and learn</b>.</p>` },
      { type: 'stack', title: 'Assemble the VXLAN packet', retry: 'Remember: which layer goes onto the wire first?', hint: 'The top is what goes over the underlay wire first.',
        items: [{ name: 'Outer Ethernet header', size: '14 bytes', kind: 'eth' }, { name: 'Outer IPv4 header (VTEP → VTEP)', size: '20 bytes', kind: 'ip' }, { name: 'UDP, destination port 4789', size: '8 bytes', kind: 'udp' },
          { name: 'VXLAN header with VNI', size: '8 bytes', kind: 'vxlan' }, { name: 'Inner Ethernet header (srv1 → srv2)', size: '14 bytes', kind: 'eth' }, { name: 'Inner IPv4 header', size: '20 bytes', kind: 'ip' }, { name: 'ICMP Echo Request', size: '64 bytes', kind: 'icmp' }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'How many bytes does VXLAN put in front of the host\'s IP packet (without the outer Ethernet header)?', input: ['50'], unit: 'bytes', explain: '20 (IP) + 8 (UDP) + 8 (VXLAN) + 14 (inner Ethernet header).' },
        { q: 'Which UDP destination port is assigned to VXLAN?', input: ['4789'] },
        { q: 'A router in the underlay has no route to the servers\' networks. Does VXLAN still work?', options: ['No', 'Yes, it only has to reach the addresses of the VTEPs', 'Only with multicast'], correct: 1 }] }
    ] },

    { id: 'm3-l4', title: 'VXLAN in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Take a VXLAN frame apart', topo: () => vxlanTopo(), edit: 'view',
        intro: '<p>srv1 and srv2 are in the same subnet, but on different VTEPs. core routes in between. Turn the speed down and watch how the packet gets a second envelope along the way.</p>',
        presets: { srv1: ['ping -c 2 192.168.10.12'], vtep1: ['bridge fdb', 'show vxlan'], core: ['ip route'] },
        goals: [
          { text: 'Ping srv2 (192.168.10.12) from srv1.', check: pingOk('srv1', '192.168.10.12') },
          { text: 'Click a VXLAN frame between vtep1 and core and expand all layers.', check: inspected(isVxlan) },
          { text: 'Which source IP does the outer IP packet from vtep1 have?', ask: true, expect: () => ['10.255.0.1'] },
          { text: 'Which VNI does the frame carry?', ask: true, expect: () => ['10010'] },
          { text: 'Does core know a route to 192.168.10.0/24? (yes or no)', ask: true, expect: () => ['no'] }],
        outro: '<p>The MAC table of vtep1 lists srv2 with the note <code>dst 10.255.0.2</code>: vtep1 learned from the unwrapped frame which VTEP srv2 is behind.</p>' }
    ] },

    { id: 'm3-l5', title: 'Troubleshooting the overlay', minutes: 12, steps: [
      { type: 'theory', title: 'From the bottom up', html: `
<p>If an overlay does not work, always check in this order:</p>
<ol><li><b>Underlay:</b> Can the VTEPs reach each other? Ping between the loopbacks.</li>
<li><b>Do VXLAN packets arrive?</b> Filter the log at the receiving VTEP.</li>
<li><b>Are they unwrapped?</b> VNI and UDP port must be the same on both sides.</li>
<li><b>Local:</b> Is the VLAN correct on the port to the server?</li></ol>` },
      { type: 'lab', title: 'Something is wrong', topo: () => vxlanTopo({ vni2: 10011 }), edit: 'config',
        intro: '<p>The connection between srv1 and srv2 is broken. Find the fault and fix it.</p>',
        presets: { srv1: ['ping -c 1 192.168.10.12'], vtep1: ['ping -c 1 10.255.0.2', 'show vxlan'], vtep2: ['show vxlan'] },
        goals: [
          { text: 'The ping from srv1 to srv2 fails.', check: tag('srv1', 'ping-done', d => d.received === 0) },
          { text: 'Find the message in the log that explains why vtep2 drops the packets.', check: tag('vtep2', 'vxlan-vni-unknown') },
          { text: 'Fix the fault until the ping works.', check: pingOk('srv1', '192.168.10.12') }],
        hints: ['Compare the VXLAN segments on vtep1 and vtep2 under Configuration.'] }
    ] },

    { id: 'm3-l6', title: 'The MTU trap', minutes: 12, steps: [
      { type: 'theory', title: '50 bytes that break everything', html: `
<p>VXLAN puts 50 bytes in front of every packet. A full packet of 1500 bytes becomes 1550 bytes in the underlay. Linux therefore sets the MTU of a VXLAN interface to the MTU of the uplink minus 50 when the interface is created.</p>
${note('If a frame does not fit, it is <b>silently dropped</b>. To the hosts the VTEP is a switch, and a switch does not send ICMP messages; it does not even have an IP address in the segment. Ping works, large transfers hang.', true)}
<table><tr><th>Solution</th><th>Assessment</th></tr>
<tr><td>Underlay MTU of 1550 or jumbo frames (9000)</td><td>Standard in the data center, the hosts notice nothing</td></tr>
<tr><td>Hosts in the overlay on MTU 1450</td><td>Necessary if the underlay cannot be adjusted</td></tr></table>` },
      { type: 'lab', title: 'Stumble and fix it', topo: () => vxlanTopo(), edit: 'config',
        intro: '<p>Send a large packet with DF from srv1 to srv2 and watch closely where it disappears.</p>',
        presets: { srv1: ['ping -c 1 -M do -s 1472 192.168.10.12', 'ping -c 1 -M do -s 1422 192.168.10.12'], vtep1: ['show vxlan'] },
        goals: [
          { text: 'Send ping -c 1 -M do -s 1472 192.168.10.12 on srv1. The packet disappears without a message.', check: tag('vtep1', 'vxlan-mtu-drop') },
          { text: 'Which MTU does the VXLAN interface of vtep1 have?', ask: true, expect: () => ['1450'] },
          { text: 'Raise the MTU of both underlay cables to 1550 (click the cable) and send the ping again.', check: pingOk('srv1', '192.168.10.12', { size: 1472, df: true }) }],
        hints: ['The underlay cables are vtep1 ↔ core and vtep2 ↔ core.'],
        outro: '<p>With 1550 in the underlay, the VXLAN interface can carry 1500 again, and the servers notice nothing of the encapsulation. In the lab its MTU follows the uplink automatically. On a real Linux VTEP, raise it yourself as well (<code>ip link set vxlan10 mtu 1500</code>), because Linux only computes it when the interface is created.</p>' }
    ] }
  ]
};
