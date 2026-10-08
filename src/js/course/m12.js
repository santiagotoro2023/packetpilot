import { bar, note, tag } from './helpers.js';
import { ipv6Topo } from '../presets.js';
import { macFor, slaacFor, solicitedNode, mcastMac6, linkLocalFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const A = id => slaacFor('2001:db8:1::', M(id));
const ifId = id => A(id).split(':').slice(4).join(':');
const ADDR = {
  mac: [[M('pc1'), 'pc1'], [M('pc2'), 'pc2'], [M('r1'), 'r1 eth1'], [mcastMac6(solicitedNode(A('pc2'))), 'multicast 33:33:ff:…'], ['33:33:00:00:00:01', 'multicast all nodes']],
  ip6: [[A('pc1'), 'pc1 (SLAAC)'], [A('pc2'), 'pc2 (SLAAC)'], [linkLocalFor(M('pc1')), 'pc1 link-local'], [linkLocalFor(M('r1')), 'r1 eth1 link-local'], ['2001:db8:1::1', 'r1 eth1'],
    ['ff02::1', 'all nodes'], ['ff02::2', 'all routers'], [solicitedNode(A('pc2')), 'solicited-node group'], ['::', 'unspecified']]
};
const v6Ping = (from, to) => tag(from, 'ping-done', d => d.dst === to && d.received > 0);
const globalOf = (sim, id) => sim.dev(id)?.l3.v6.allAddrs().some(a => a.scope === 'global' && a.state === 'preferred');
const curl6 = from => tag(from, 'tcp-done', d => d.ok && String(d.dst).includes(':'));

export default {
  id: 'm12', title: 'IPv6', bands: ['ip', 'icmp'],
  text: '128-bit addresses, no broadcast and no ARP: Neighbor Discovery, addresses that configure themselves, and two protocols side by side.',
  lessons: [
    { id: 'm12-l1', title: 'Addresses with 128 bits', minutes: 14, steps: [
      { type: 'theory', title: 'Why a new IP?', html: `
<p>IPv4 has about 4.3 billion addresses, far too few for every phone, PC and sensor. NAT bought time, but it breaks the original idea that every device can reach every other one. IPv6 uses <b>128 bits</b>: enough for every grain of sand, and much more structure.</p>
<h2>Writing an address</h2>
<p>Eight groups of 16 bits in hex, separated by colons. Two rules shorten it:</p>
<table><tr><th>Rule</th><th>Example</th></tr>
<tr><td>Full</td><td><code>2001:0db8:0000:0000:0000:ff00:0042:8329</code></td></tr>
<tr><td>Drop leading zeros in each group</td><td><code>2001:db8:0:0:0:ff00:42:8329</code></td></tr>
<tr><td>Replace <b>one</b> run of zero groups with <code>::</code></td><td><code>2001:db8::ff00:42:8329</code></td></tr></table>
<p><code>::</code> may appear only once, otherwise nobody knows how many zeros each one stands for. So that everybody writes the same address the same way, there are three more rules (RFC 5952):</p>
<table><tr><th>Rule</th><th>Example</th></tr>
<tr><td>Replace the <b>longest</b> run of zero groups</td><td><code>2001:0:0:1:0:0:0:1</code> → <code>2001:0:0:1::1</code></td></tr>
<tr><td>Two runs of equal length: replace the <b>first</b></td><td><code>2001:0:0:5:6:0:0:9</code> → <code>2001::5:6:0:0:9</code></td></tr>
<tr><td>A <b>single</b> zero group stays <code>0</code></td><td><code>2001:db8:1:0:a8c1:abff:fe12:3456</code>, not <code>2001:db8:1::a8c1:…</code></td></tr></table>
<p>Letters are written in lower case. The other forms are not wrong, a device understands them, but tools always show the short form by these rules. A LAN is always a <b>/64</b>: the first 64 bits are the network (prefix), the last 64 bits identify the interface. A company typically gets a /48, which holds 65,536 /64 networks, a home a /56, which holds 256.</p>
<h2>Kinds of addresses</h2>
<table><tr><th>Prefix</th><th>Kind</th><th>Meaning</th></tr>
<tr><td><code>2000::/3</code></td><td>Global unicast</td><td>reachable on the internet, like a public IPv4 address</td></tr>
<tr><td><code>fe80::/10</code></td><td>Link-local</td><td>every interface has one, valid only on its own link, never routed</td></tr>
<tr><td><code>fc00::/7</code></td><td>Unique local (ULA)</td><td>private, like 10.0.0.0/8</td></tr>
<tr><td><code>ff00::/8</code></td><td>Multicast</td><td>to a group, e.g. <code>ff02::1</code> all nodes, <code>ff02::2</code> all routers</td></tr>
<tr><td><code>::1</code> / <code>::</code></td><td>Loopback / unspecified</td><td>127.0.0.1 / "no address yet"</td></tr></table>
${note('IPv6 has <b>no broadcast</b>. Whatever went to everyone in IPv4 now goes to a multicast group, and only the devices that joined it look at it.')}
<h2>A leaner header</h2>
<p>The IPv6 header always has 40 bytes. There is no checksum (layer 2 and TCP/UDP check anyway), and <b>routers never fragment</b>: a packet that is too large is dropped and the sender gets an ICMPv6 <i>Packet Too Big</i>. The TTL is now called <b>hop limit</b>.</p>` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Shorten 2001:0db8:0000:0000:0001:0000:0000:0001 as far as possible.', input: ['2001:db8::1:0:0:1'], explain: 'Only one :: is allowed. With two equal runs, the first one is replaced.' },
        { q: 'Which address is link-local?', options: ['2001:db8::1', 'fe80::a8c1:abff:fe12:3456', 'ff02::1', 'fd00::1'], correct: 1 },
        { q: 'How many bits does the network part of a normal IPv6 LAN have?', input: ['64'] },
        { q: 'A router receives an IPv6 packet of 1500 bytes for a link with MTU 1400. What does it do?', options: ['Fragment it', 'Drop it and send Packet Too Big to the sender', 'Send it anyway', 'Shorten the payload'], correct: 1 },
        { q: 'What replaces the broadcast of IPv4?', options: ['Anycast', 'Multicast to groups like ff02::1', 'Nothing, everything is unicast', 'ARP'], correct: 1 }] }
    ] },

    { id: 'm12-nd', formerly: 'm12-l2', title: 'Neighbor Discovery instead of ARP', minutes: 20, steps: [
      { type: 'theory', title: 'Who is my neighbor?', html: `
<p>Before a device can send an IP packet to a neighbor in its LAN, it needs the neighbor's <b>MAC address</b>: the Ethernet frame around the packet must be addressed to it. In IPv4 that is the job of <b>ARP</b>: "who has 10.0.0.2?" to the broadcast MAC <code>ff:ff:ff:ff:ff:ff</code>, and the owner answers.</p>
<p>IPv6 has <b>no ARP and no broadcast</b>. The job is done by <b>Neighbor Discovery</b> (NDP). NDP is not a protocol of its own: its messages are ICMPv6 messages, the same family as ping.</p>
<table><tr><th>Message</th><th>ICMPv6 type</th><th>Job</th><th>In IPv4</th></tr>
<tr><td>Neighbor Solicitation (NS)</td><td>135</td><td>"Who has 2001:db8:1::20? Tell me your MAC"</td><td>ARP request</td></tr>
<tr><td>Neighbor Advertisement (NA)</td><td>136</td><td>"2001:db8:1::20 is at aa:c1:…"</td><td>ARP reply</td></tr>
<tr><td>Router Solicitation (RS)</td><td>133</td><td>"Routers, are you there?"</td><td>none</td></tr>
<tr><td>Router Advertisement (RA)</td><td>134</td><td>a router announces itself and the prefix of the LAN</td><td>partly DHCP</td></tr></table>
<p>This lesson is about NS and NA. RS and RA follow in the next lesson.</p>
<h2>Multicast instead of broadcast</h2>
<p>Instead of "to everyone", IPv6 sends to a <b>multicast group</b>: an address that stands for all devices that have joined the group. Two groups every IPv6 device knows:</p>
<table><tr><th>Group</th><th>Who has joined</th></tr>
<tr><td><code>ff02::1</code></td><td>all IPv6 devices on the link ("all nodes")</td></tr>
<tr><td><code>ff02::2</code></td><td>all routers on the link</td></tr></table>
<p>A multicast packet needs a multicast <b>MAC</b> too. The rule is simple: <code>33:33</code> followed by the last 32 bits (8 hex digits) of the group address.</p>
<pre>group:     ff02::1
in full:   ff02:0000:0000:0000:0000:0000:<b>0000:0001</b>
MAC:       33:33:<b>00:00:00:01</b></pre>
${note('<code>ff02::</code> means: valid only on this link. A router never forwards these packets to another network.')}` },
      { type: 'theory', title: 'Solicited-node groups', html: `
<p>If an NS went to <code>ff02::1</code>, every device would have to read it, exactly like an ARP broadcast. IPv6 does better: the NS goes to a small group that, in practice, only the wanted device has joined, its <b>solicited-node group</b>.</p>
<p>Every device joins one such group for each of its addresses. The group is formed from the <b>last 24 bits</b> of the address, that is its last <b>6 hex digits</b>:</p>
<pre>address:  2001:db8:1:0:a8c1:abff:fe<b>12:3456</b>
group:    ff02::1:ff<b>12:3456</b>
MAC:      33:33:<b>ff:12:34:56</b></pre>
<p>The group is <code>ff02::1:ff</code> + the last 6 hex digits of the address. Its MAC is, as for every group, <code>33:33</code> + the last 8 hex digits of the group.</p>
<p>The asking device knows the address it wants, so it can compute the group without knowing anything else. The network cards of all other devices see that the MAC is not one of theirs and drop the frame without bothering the CPU.</p>
<h2>Shortened addresses</h2>
<p>When the address is shortened with <code>::</code> or without leading zeros, first write the last two groups with all 4 digits, otherwise the zeros get lost:</p>
<table><tr><th>Step</th><th>Example <code>2001:db8::7:1</code></th></tr>
<tr><td>1. Last two groups with 4 digits each</td><td><code>0007:0001</code></td></tr>
<tr><td>2. The last 6 digits</td><td><code>07 0001</code></td></tr>
<tr><td>3. <code>ff02::1:ff</code> + the first 2 digits, then <code>:</code> + the last 4</td><td><code>ff02::1:ff07:0001</code></td></tr>
<tr><td>4. Shorten as usual</td><td><code>ff02::1:ff07:1</code></td></tr></table>
${note('Two addresses that end in the same 6 digits share a group. That is fine: the NS also names the wanted address in full, and only its owner answers.')}` },
      { type: 'quiz', title: 'Practice: groups and MACs', questions: [
        { q: 'Which solicited-node group belongs to 2001:db8:1:0:a8c1:abff:fe77:8899?', input: ['ff02::1:ff77:8899'], explain: 'The last 6 hex digits are 77 8899: ff02::1:ff + 77, then :8899.' },
        { q: 'Which solicited-node group belongs to 2001:db8::5:2? Watch the leading zeros.', input: ['ff02::1:ff05:2', 'ff02::1:ff05:0002'], explain: 'Written out, the last two groups are 0005:0002. The last 6 digits are 05 0002: ff02::1:ff05:0002, shortened ff02::1:ff05:2.' },
        { q: 'To which MAC address is a packet for the group ff02::1:ff77:8899 sent?', input: ['33:33:ff:77:88:99', '3333.ff77.8899'], explain: '33:33 + the last 8 hex digits of the group (ff77:8899).' },
        { q: 'And a packet for ff02::2, all routers?', input: ['33:33:00:00:00:02', '3333.0000.0002'], explain: 'ff02::2 written out ends in 0000:0002, so the MAC is 33:33:00:00:00:02.' },
        { q: 'An NS for 2001:db8:1:0:a8c1:abff:fe77:8899 arrives at a switch. Which devices read it?', options: ['All devices on the link, like with ARP', 'Only devices with an address ending in 77:8899', 'Only routers', 'Nobody, the switch answers itself'], correct: 1,
          explain: 'Only devices that have joined ff02::1:ff77:8899 accept the frame. A simple switch still delivers it to every port, but the network cards of the others drop it.' }] },
      { type: 'theory', title: 'Anatomy of a Neighbor Solicitation', html: `
<p>A host with the address <code>2001:db8:1::10</code> wants to reach <code>2001:db8:1:0:a8c1:abff:fe12:3456</code> and does not know its MAC. Its NS looks like this:</p>
${bar([['Dest. MAC', '33:33:ff:12:34:56', 'eth', 1.7], ['Source MAC', 'own', 'eth', .9], ['Type', '0x86DD', 'eth', .9], ['Source', 'own address', 'ip', 1.2], ['Destination', 'ff02::1:ff12:3456', 'ip', 1.7], ['Next', '58', 'ip', .6], ['Hop limit', '255', 'ip', .8], ['Type', '135', 'icmp', .6], ['Target', 'in full', 'icmp', 1]], 'Blue: Ethernet, green: IPv6 header (next header, hop limit), teal: ICMPv6 (type, target address).')}
<table><tr><th>Field</th><th>Value</th><th>Why</th></tr>
<tr><td>Destination MAC</td><td>33:33 + last 8 hex digits of the group</td><td>IPv6 has no broadcast, so never <code>ff:ff:ff:ff:ff:ff</code></td></tr>
<tr><td>Source MAC, EtherType</td><td>own MAC, <code>0x86DD</code></td><td>as in every IPv6 frame</td></tr>
<tr><td>Source address</td><td>its own address</td><td>the answer comes back to it</td></tr>
<tr><td>Destination address</td><td>solicited-node group of the <b>wanted</b> address</td><td>only the wanted device reads it</td></tr>
<tr><td>Next header</td><td>58</td><td>ICMPv6, NDP is part of it</td></tr>
<tr><td>Hop limit</td><td><b>255</b>, always</td><td>a router would lower it. Receivers drop NDP messages below 255, so they cannot come from outside the link</td></tr>
<tr><td>Type</td><td>135</td><td>Neighbor Solicitation</td></tr>
<tr><td>Target address</td><td>the wanted address, in full</td><td>the group only contains the last 6 hex digits, the target says exactly whom it asks</td></tr></table>
<p>The NS also carries the asker's MAC, so the answer does not need a question back.</p>
<h2>The answer: Neighbor Advertisement</h2>
<p>The owner of the address answers with an NA, type 136. It goes <b>directly</b> to the asker: to its MAC and its address, no multicast needed. The NA contains the target address and, as an option, the MAC that belongs to it. Both sides now store the other in their <b>neighbor cache</b>, the IPv6 counterpart of the ARP table (<code>ip -6 neigh</code>).</p>
${note('Compared with an ARP request: there the destination is the broadcast MAC, and the wanted address only appears inside the ARP message. In an NS it appears twice: shortened in the group address, in full as the target.')}` },
      { type: 'build', title: 'Build the Neighbor Solicitation', blocks: ['eth', 'vlan', 'arp', 'ip', 'ipv6', 'icmp', 'icmp6', 'udp', 'data'],
        task: `<p><b>pc1</b> (${A('pc1')}) wants to ping <b>pc2</b> (${A('pc2')}) in the same LAN, but does not know its MAC yet. Build the frame pc1 sends first.</p>`,
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: mcastMac6(solicitedNode(A('pc2'))), src: M('pc1'), type: '0x86dd' } },
          { block: 'ipv6', fields: { src: A('pc1'), dst: solicitedNode(A('pc2')), proto: '58', ttl: '255' } },
          { block: 'icmp6', fields: { type: '135', target: A('pc2') } }],
        explain: 'The NS goes to the solicited-node group of pc2 (ff02::1:ff + the last 6 hex digits), on the MAC 33:33 + the last 8 hex digits of the group. The hop limit is always 255: a receiver drops NDP messages with a lower value, so they cannot come from outside the link.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which solicited-node group belongs to 2001:db8:1::42:abcd?', input: ['ff02::1:ff42:abcd'], explain: 'Written out, the last two groups are 0042:abcd, the last 6 digits 42 abcd.' },
        { q: 'Why is the hop limit of every NDP message 255?', options: ['So that it reaches the whole internet', 'A router would lower it, so a receiver knows the message comes from its own link', 'Because ICMPv6 has no TTL', 'It is the default of every IPv6 packet'], correct: 1 },
        { q: 'How is the Neighbor Advertisement sent back?', options: ['To ff02::1, so that everyone learns it', 'Directly to the MAC and address of the asker', 'To the solicited-node group of the asker', 'Via the router'], correct: 1 },
        { q: 'Which command shows the neighbor cache on Linux, the counterpart of the ARP table?', options: ['arp -a', 'ip -6 neigh', 'ip -6 route', 'ping -6'], correct: 1 }] }
    ] },

    { id: 'm12-slaac', formerly: 'm12-l2', title: 'SLAAC: addresses without DHCP', minutes: 20, steps: [
      { type: 'theory', title: 'The link-local address', html: `
<p>In IPv4 a PC without DHCP or manual configuration is practically cut off: at best it picks a 169.254.x.x address after a while, which hardly any network uses. In IPv6 every interface gives itself an address the moment it comes up, and IPv6 really relies on it: the <b>link-local address</b>. It starts with <code>fe80::</code>, is valid only on its own link and is never routed, but it is enough to talk to neighbors and to the router.</p>
<pre>fe80:0000:0000:0000 : a8c1:abff:fe12:3456
└──── prefix ─────┘   └─ interface ID ──┘
     64 bits               64 bits</pre>
<p>The first 64 bits are always <code>fe80:0:0:0</code>. The last 64 bits, the <b>interface ID</b>, the device forms itself, classically from its MAC (<b>EUI-64</b>). 48 bits of MAC become 64 bits of interface ID in three steps:</p>
<table><tr><th>Step</th><th>Example <code>aa:c1:ab:12:34:56</code></th><th>Example <code>52:54:00:12:34:56</code></th></tr>
<tr><td>1. Insert <code>ff:fe</code> in the middle</td><td><code>aa:c1:ab:<b>ff:fe</b>:12:34:56</code></td><td><code>52:54:00:<b>ff:fe</b>:12:34:56</code></td></tr>
<tr><td>2. Flip the bit worth 2 in the first byte</td><td><code>aa</code> = <code>1010 10<b>1</b>0</code> → <code>1010 10<b>0</b>0</code> = <code>a8</code></td><td><code>52</code> = <code>0101 00<b>1</b>0</code> → <code>0101 00<b>0</b>0</code> = <code>50</code></td></tr>
<tr><td>3. Join into groups of 4 digits</td><td><code>a8c1:abff:fe12:3456</code></td><td><code>5054:00ff:fe12:3456</code>, shortened <code>5054:ff:fe12:3456</code></td></tr></table>
<p>Without binary: look at the second hex digit of the first byte. If it is 0, 1, 4, 5, 8, 9, c or d, the bit is 0, so <b>add 2</b>. If it is 2, 3, 6, 7, a, b, e or f, the bit is 1, so <b>subtract 2</b>. The bit says whether a MAC was assigned by the manufacturer or locally, and EUI-64 inverts it.</p>
<p>So the link-local address of <code>aa:c1:ab:12:34:56</code> is <code>fe80::a8c1:abff:fe12:3456</code>.</p>
${note('Modern Windows, macOS and many Linux systems use random interface IDs instead (privacy extensions), so a device cannot be tracked by its address. PacketPilot uses EUI-64, so you can follow every address back to its MAC.')}` },
      { type: 'quiz', title: 'Practice: interface IDs', questions: [
        { q: 'Interface ID by EUI-64 for the MAC 00:11:22:33:44:55?', input: ['211:22ff:fe33:4455', '0211:22ff:fe33:4455'], explain: 'ff:fe goes in the middle. The first byte 00 has a 0 as second digit, so add 2: 02. Result 0211:22ff:fe33:4455, shortened 211:22ff:fe33:4455.' },
        { q: 'Interface ID by EUI-64 for the MAC 06:00:5e:10:20:30?', input: ['400:5eff:fe10:2030', '0400:5eff:fe10:2030'], explain: '06: the second digit 6 means the bit is 1, so subtract 2: 04. Result 0400:5eff:fe10:2030.' },
        { q: 'Which link-local address does a PC with the MAC aa:c1:ab:00:00:10 give itself?', input: ['fe80::a8c1:abff:fe00:10', 'fe80::a8c1:abff:fe00:0010', 'fe80:0:0:0:a8c1:abff:fe00:10'], explain: 'aa becomes a8, ff:fe goes in the middle: interface ID a8c1:abff:fe00:0010, behind fe80::.' }] },
      { type: 'theory', title: 'Is the address free?', html: `
<p>An address that two devices use at the same time breaks both. So before an IPv6 device uses an address, it tests it: <b>duplicate address detection</b> (DAD).</p>
<ol><li>The device sends an NS for its own new address, to the solicited-node group of that address. You know this message from the last lesson.</li>
<li>The sender address is <code>::</code>, the "unspecified" address that belongs to nobody. The new address may not be used before the test, not even as sender.</li>
<li>If another device answers with an NA, the address is taken and the device must not use it.</li>
<li>If nobody answers within about a second, the address is unique and usable.</li></ol>
<pre>pc1 forms fe80::a8c1:abff:fe12:3456
── NS from ::, target fe80::a8c1:abff:fe12:3456 ──▶  ff02::1:ff12:3456
   1 second without an answer: the address is usable</pre>
${note('Every address gets this test: the link-local address at power on, and later every further address.')}` },
      { type: 'theory', title: 'Asking for the router', html: `
<p>With its link-local address the PC can talk to its neighbors, but not yet to the internet. For that it needs a <b>global address</b> and a <b>default router</b>. It asks for both:</p>
<table><tr><th>Message</th><th>From</th><th>To</th><th>Content</th></tr>
<tr><td>Router Solicitation (RS), type 133</td><td>the PC's link-local address</td><td><code>ff02::2</code>, all routers</td><td>"Routers, are you there?"</td></tr>
<tr><td>Router Advertisement (RA), type 134</td><td>the router's link-local address</td><td>the PC, or <code>ff02::1</code></td><td>the prefix of the LAN, how long it is valid, the router's MAC, optionally a DNS server</td></tr></table>
<p>Routers also send RAs on their own every few minutes, so a PC that does not ask still finds them.</p>
<h2>SLAAC: building the global address</h2>
<p>From the RA the PC knows the prefix of the LAN, for example <code>2001:db8:1::/64</code>. A LAN prefix is always 64 bits long, exactly the space left of the interface ID. The PC simply puts its interface ID behind the prefix. This is <b>stateless address autoconfiguration</b> (SLAAC): no server keeps a list of who got which address.</p>
<pre>prefix from the RA:   2001:0db8:0001:0000
interface ID:                             a8c1:abff:fe12:3456
global address:       2001:db8:1:0:a8c1:abff:fe12:3456</pre>
<p>A single zero group stays <code>0</code>, so the address is written <code>2001:db8:1:0:a8c1:…</code> and not with <code>::</code>. That is exactly how <code>ip -6 addr</code> shows it.</p>
<p>Then it runs DAD for the new address, like for the link-local one.</p>
<h2>The default router</h2>
<p>The router that sent the RA becomes the default router, with its <b>link-local</b> address. That is why <code>ip -6 route</code> shows <code>default via fe80::…</code>, not a global address. The RA also carries the router's MAC, so the PC can send packets to it right away.</p>` },
      { type: 'quiz', title: 'Practice: DAD and RA', questions: [
        { q: 'From which source address does a host send the NS for duplicate address detection?', options: ['Its link-local address', '::', 'ff02::1', 'The address it is testing'], correct: 1,
          explain: 'The address is not yet allowed to be used, so the NS comes from the unspecified address.' },
        { q: 'To which address does a PC send its Router Solicitation?', options: ['ff02::1', 'ff02::2', 'The router\'s global address', 'ff:ff:ff:ff:ff:ff'], correct: 1 },
        { q: 'Where does a host get its IPv6 default gateway from with SLAAC?', options: ['From DHCP', 'From the Router Advertisement', 'From DNS', 'It is always ::1'], correct: 1 },
        { q: 'The RA announces 2001:db8:5::/64. The interface ID is 211:22ff:fe33:4455. Which global address does the PC form?', input: ['2001:db8:5::211:22ff:fe33:4455', '2001:db8:5:0:211:22ff:fe33:4455'], explain: 'Prefix and interface ID side by side: 2001:db8:5:0 + 211:22ff:fe33:4455.' }] },
      { type: 'theory', title: 'From power on to the first ping', html: `
<p>Put together, a PC that boots into an IPv6 LAN goes through four phases. Each one needs the result of the one before. pc1 has the MAC <code>aa:c1:ab:12:34:56</code>:</p>
<pre>pc1                                         r1 (router)
<b>1. An address for the link</b>
forms fe80::a8c1:abff:fe12:3456
── NS from ::, "anyone using fe80::…?" ──▶  ff02::1:ff12:3456
   1 second without an answer: the address is unique
<b>2. Find the router</b>
── RS from fe80::…, "routers?" ─────────▶  ff02::2
◀── RA: prefix 2001:db8:1::/64, router fe80::…,
        its MAC, DNS server ───────────────
<b>3. A global address</b>
forms 2001:db8:1:0:a8c1:abff:fe12:3456 (SLAAC)
── NS from ::, DAD again ───────────────▶  ff02::1:ff12:3456
   1 second without an answer: usable
<b>4. The first ping</b>
── Echo Request to 2001:db8:2::80 ──────▶  to the MAC from the RA
                                            r1 forwards it, the reply comes back
◀── NS "who has 2001:db8:1:0:a8c1:…?" ─────  r1 only knows the link-local address
── NA "it is at aa:c1:ab:12:34:56" ─────▶
◀── Echo Reply ────────────────────────────</pre>
<table><tr><th>Order</th><th>Why</th></tr>
<tr><td>DAD before every use</td><td>An address may only be used once it is known to be unique.</td></tr>
<tr><td>Link-local before the RS</td><td>Sent from its link-local address, the RS can carry the PC's MAC, so the router knows the PC right away. An RS from <code>::</code> is allowed too, but tells the router nothing about the PC.</td></tr>
<tr><td>RA before SLAAC</td><td>The PC learns the prefix only from the RA, so it cannot form its global address before.</td></tr>
<tr><td>No NS for the router</td><td>The RA already carries the router's MAC, so the first packet can leave at once. The router is the one that has to ask: from the RS it knows the PC's link-local address, but not the new global one the reply goes to.</td></tr></table>
${note('Both DAD messages go to the same group, ff02::1:ff12:3456: link-local and global address end in the same interface ID. A few seconds after the first ping the PC also checks with a unicast NS whether the router is still there (neighbor unreachability detection). You will see both in the lab of the next lesson.')}` },
      { type: 'stack', title: 'A PC boots into an IPv6 LAN', hint: 'From power on until the reply to the first ping can come back. The top is the first step.',
        items: [{ name: 'Form the link-local address fe80::…', kind: 'ip' }, { name: 'DAD: NS for the link-local address from ::', kind: 'icmp' },
          { name: 'RS to ff02::2', kind: 'icmp' }, { name: 'RA from the router: prefix 2001:db8:1::/64', kind: 'icmp' },
          { name: 'Form 2001:db8:1:0:<interface ID> (SLAAC)', kind: 'ip' }, { name: 'DAD for the global address', kind: 'icmp' },
          { name: 'Echo Request to the server via the router', kind: 'icmp' }, { name: 'The router asks for the global address: NS to its solicited-node group', kind: 'icmp' }],
        explain: 'Every address is tested with DAD before use. The RA already carries the router\'s MAC, so the Echo Request leaves at once. The router only knows the link-local address of the PC from the RS, so before the reply can go back, it asks for the new global address with an NS.' }
    ] },
    { id: 'm12-l3', title: 'IPv6 in the LAN', minutes: 18, steps: [
      { type: 'lab', title: 'Dual stack in action', topo: () => ipv6Topo(), edit: 'config',
        intro: '<p>pc1 and pc2 have an IPv4 address and get IPv6 by themselves: r1 sends router advertisements on the LAN. The servers have static IPv6 addresses, r1 and r2 static IPv6 routes. The name www.lab has an A and an AAAA record.</p>',
        presets: { pc1: ['ip -6 addr', 'ip -6 route', 'rdisc6 eth1', 'ping -6 -c 2 2001:db8:2::80', 'ip -6 neigh', 'ping -6 -c 1 ff02::1%eth1', 'curl http://www.lab/'], r1: ['show ipv6 route', 'ip -6 neigh'] },
        goals: [
          { text: 'Look at the IPv6 addresses of pc1 (<code>ip -6 addr</code>). Which prefix did pc1 get from r1?', ask: true, expect: () => ['2001:db8:1::/64', '2001:db8:1::', '2001:db8:1:0::/64'], placeholder: 'prefix' },
          { text: 'And what is pc1\'s interface ID, the last 64 bits?', ask: true, expect: () => [ifId('pc1'), '::' + ifId('pc1')], placeholder: 'xxxx:xxxx:xxxx:xxxx' },
          { text: 'Ping the web server over IPv6: <code>ping -6 2001:db8:2::80</code>.', check: v6Ping('pc1', '2001:db8:2::80') },
          { text: 'To forward your first ping, r1 had to find r2. To which multicast group did it send its Neighbor Solicitation for 2001:db8:12::2? (filter the log to r1)', ask: true, expect: () => [solicitedNode('2001:db8:12::2')], placeholder: 'ff02::…' },
          { text: 'Ping all nodes of the LAN at once: <code>ping -6 -c 1 ff02::1%eth1</code>.', check: tag('pc1', 'ping-done', d => String(d.dst).startsWith('ff02::1') && (d.from || []).length >= 2) },
          { text: 'Open <code>http://www.lab/</code> with curl. Which address does curl use?', ask: true, expect: () => ['2001:db8:2::80'] }],
        hints: ['ip -6 addr shows "scope global dynamic" for the SLAAC address.', 'The interface ID is everything after 2001:db8:1:0:', 'The NS of r1 says "asks its solicited-node group …".'],
        outro: '<p>pc1 asked DNS for AAAA first, because it has a global IPv6 address and an IPv6 default route, and preferred IPv6, like every modern operating system. The group ff02::1 reached pc2 and r1 at once: multicast replaces the broadcast. And the hop limit of the reply was 62, two routers on the way, just like the TTL in IPv4.</p>' }
    ] },

    { id: 'm12-l4', title: 'Building IPv6 routing yourself', minutes: 20, steps: [
      { type: 'theory', title: 'What a router needs for IPv6', html: `
<p>A router does not pass anything on just because it has IPv6 addresses. Three things are needed:</p>
<table><tr><th>What</th><th>Linux / FRR</th><th>Effect</th></tr>
<tr><td>Router advertisements on the LAN</td><td><code>ipv6 nd prefix 2001:db8:1::/64</code> (radvd, FRR)</td><td>hosts get a prefix and a default router</td></tr>
<tr><td>Routes to the other networks</td><td><code>ip -6 route add 2001:db8:2::/64 via 2001:db8:12::2</code></td><td>like IPv4: static, OSPFv3 or BGP</td></tr>
<tr><td>Optionally DNS in the RA</td><td>RDNSS option</td><td>hosts find a DNS server without DHCPv6</td></tr></table>
<p>The RA has two flags for DHCPv6: <b>M</b> (managed: take addresses from DHCPv6) and <b>O</b> (other: only DNS and similar from DHCPv6). With both off, SLAAC and RDNSS do everything.</p>
${note('IPv6 has no NAT in normal networks: every device has a global address. The firewall of the router decides what may come in, not the lack of a translation entry.', true)}` },
      { type: 'lab', title: 'From link-local to the internet', topo: () => ipv6Topo({ ra: false, rdnss: false, routes6: false }), edit: 'config',
        intro: '<p>The routers have their IPv6 addresses, but that is all: no router advertisements, no IPv6 routes, no DNS for the PCs. pc1 and pc2 only have link-local addresses.</p>',
        presets: { pc1: ['ip -6 addr', 'ip -6 route', 'rdisc6 eth1', 'ping -6 -c 2 2001:db8:2::80', 'curl http://www.lab/'], r1: ['show ipv6 route', 'ip -6 route add 2001:db8:2::/64 via 2001:db8:12::2'], r2: ['show ipv6 route', 'ip -6 route add 2001:db8:1::/64 via 2001:db8:12::1'] },
        goals: [
          { text: 'Turn on router advertisements on r1 eth1 (Configuration, IPv6, check RA). pc1 forms its global address.', check: sim => globalOf(sim, 'pc1') },
          { text: 'Give r1 and r2 the routes to each other\'s networks. pc1 then pings the web server 2001:db8:2::80.', check: v6Ping('pc1', '2001:db8:2::80') },
          { text: 'Put the DNS server 2001:db8:2::53 into the router advertisement of r1. pc1 learns it.', check: sim => (sim.dev('pc1')?.l3.v6.rdnss || []).includes('2001:db8:2::53') },
          { text: 'Open http://www.lab/ on pc1. It goes over IPv6.', check: curl6('pc1') },
          { text: 'Through which router address does pc1 reach everything outside its LAN? (ip -6 route on pc1)', ask: true, expect: sim => [sim.dev('r1') ? linkLocalFor(sim.dev('r1').mac('eth1')) : ''], placeholder: 'fe80::…' }],
        hints: ['A route needs both routers: r1 must know 2001:db8:2::/64 and r2 must know the way back to 2001:db8:1::/64.', 'The router advertisement is repeated every 30 seconds and sent at once after a change.', 'The default route of pc1 points to a link-local address.'],
        outro: '<p>The PCs never got a manual setting: prefix, default router and DNS server all came from the router advertisement. The default router is the link-local address of r1, which stays the same even if the global prefix changes.</p>' }
    ] },

    { id: 'm12-l5', title: 'Dual stack and the way to IPv6', minutes: 10, steps: [
      { type: 'theory', title: 'Two protocols side by side', html: `
<p>The internet will not switch over in one night. Most networks run <b>dual stack</b>: every device has an IPv4 and an IPv6 address, and every application decides which one to use.</p>
<ol><li>The name is resolved for <b>AAAA</b> and <b>A</b>.</li>
<li>If the device has a global IPv6 address and a default route, IPv6 is preferred (RFC 6724).</li>
<li><b>Happy Eyeballs</b>: browsers start IPv6 and, after a short head start of 50 to 250 ms, IPv4 in parallel. Whichever connects first wins. A broken IPv6 path then only costs a fraction of a second.</li></ol>
<h2>When only one side has IPv6</h2>
<table><tr><th>Technique</th><th>Idea</th></tr>
<tr><td>NAT64 + DNS64</td><td>An IPv6-only network reaches IPv4 servers: DNS invents an AAAA record inside <code>64:ff9b::/96</code>, a gateway translates.</td></tr>
<tr><td>464XLAT</td><td>Phones on IPv6-only mobile networks still offer IPv4 to old apps.</td></tr>
<tr><td>Tunnels (6in4)</td><td>IPv6 packets travel inside IPv4 packets across an IPv4-only network.</td></tr></table>
${note('ICMPv6 must not be blocked wholesale. Without Neighbor Discovery nothing works on the LAN, and without <i>Packet Too Big</i> large packets silently disappear, because routers never fragment.', true)}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A PC has 2001:db8:1::10 and a default route via fe80::1. The name has A and AAAA. Which one does it use first?', options: ['A', 'AAAA'], correct: 1 },
        { q: 'A firewall drops all ICMPv6. What breaks first?', options: ['Only ping', 'Neighbor Discovery on the LAN, and Path MTU Discovery across routers', 'Nothing', 'Only DNS'], correct: 1 },
        { q: 'What does DNS64 do?', options: ['Stores IPv6 addresses in 64 bits', 'Synthesizes an AAAA record for an IPv4-only server so that NAT64 can translate', 'Resolves names twice', 'Blocks IPv4'], correct: 1 }] }
    ] }
  ]
};
