import { note, tag } from './helpers.js';
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
<p><code>::</code> may appear only once, otherwise nobody knows how many zeros each one stands for. A LAN is always a <b>/64</b>: the first 64 bits are the network (prefix), the last 64 bits identify the interface. A company typically gets a /48, a home a /56: thousands of /64 networks.</p>
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

    { id: 'm12-l2', title: 'Neighbor Discovery instead of ARP', minutes: 16, steps: [
      { type: 'theory', title: 'Finding neighbors and routers', html: `
<p>ARP is gone. Its job is done by <b>Neighbor Discovery (NDP)</b>, which is part of ICMPv6:</p>
<table><tr><th>Message</th><th>Type</th><th>Job</th></tr>
<tr><td>Neighbor Solicitation (NS)</td><td>135</td><td>"Who has 2001:db8:1::20? Tell me your MAC", like an ARP request</td></tr>
<tr><td>Neighbor Advertisement (NA)</td><td>136</td><td>"2001:db8:1::20 is at aa:c1:…", like an ARP reply</td></tr>
<tr><td>Router Solicitation (RS)</td><td>133</td><td>a host asks: "routers, are you there?"</td></tr>
<tr><td>Router Advertisement (RA)</td><td>134</td><td>a router announces itself, its prefixes and optionally a DNS server</td></tr></table>
<h2>Solicited-node multicast</h2>
<p>An ARP request goes to every device. An NS only goes to the <b>solicited-node group</b> of the wanted address: <code>ff02::1:ff</code> plus its last 24 bits. Only devices whose address ends the same way have joined this group, so everyone else's network card filters the frame away without bothering the CPU.</p>
<pre>wanted:   2001:db8:1::a8c1:abff:fe12:3456
group:    ff02::1:ff12:3456
MAC:      33:33:ff:12:34:56   (33:33 + last 32 bits of the group)</pre>
<h2>SLAAC: addresses without DHCP</h2>
<ol><li>The interface forms its link-local address <code>fe80::</code> + interface ID.</li>
<li><b>Duplicate address detection</b> (DAD): it sends an NS for this address from <code>::</code>. If nobody answers within a second, the address is unique.</li>
<li>It sends an RS to <code>ff02::2</code>. The router answers with an RA: prefix <code>2001:db8:1::/64</code>, "use me as your default router", maybe a DNS server (RDNSS).</li>
<li>The host appends its interface ID to the prefix, runs DAD again, done.</li></ol>
<p>The interface ID comes from the MAC (<b>EUI-64</b>): flip the 7th bit of the first byte and insert <code>ff:fe</code> in the middle. <code>aa:c1:ab:12:34:56</code> becomes <code>a8c1:abff:fe12:3456</code>. Modern systems use random IDs instead (privacy extensions), so a device cannot be tracked by its address.</p>
${note('The default gateway in IPv6 is the <b>link-local</b> address of the router, learned from the RA. That is why <code>ip -6 route</code> shows <code>default via fe80::…</code>.')}` },
      { type: 'stack', title: 'A PC boots into an IPv6 LAN', hint: 'From power on to the first ping to a server. The top is the first step.',
        items: [{ name: 'Form the link-local address fe80::…', kind: 'ip' }, { name: 'DAD: NS for the link-local address from ::', kind: 'icmp' },
          { name: 'RS to ff02::2', kind: 'icmp' }, { name: 'RA from the router: prefix 2001:db8:1::/64', kind: 'icmp' },
          { name: 'Form 2001:db8:1::<interface ID> (SLAAC)', kind: 'ip' }, { name: 'DAD for the global address', kind: 'icmp' },
          { name: 'NS to the solicited-node group of the router', kind: 'icmp' }, { name: 'Echo Request to the server via the router', kind: 'icmp' }],
        explain: 'Every address is tested before use. The router is known from the RA, but its MAC still has to be resolved with NS/NA before the first packet can leave.' },
      { type: 'build', title: 'Build the Neighbor Solicitation', blocks: ['eth', 'vlan', 'arp', 'ip', 'ipv6', 'icmp', 'icmp6', 'udp', 'data'],
        task: `<p><b>pc1</b> (${A('pc1')}) wants to ping <b>pc2</b> (${A('pc2')}) in the same LAN, but does not know its MAC yet. Build the frame pc1 sends first.</p>`,
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: mcastMac6(solicitedNode(A('pc2'))), src: M('pc1'), type: '0x86dd' } },
          { block: 'ipv6', fields: { src: A('pc1'), dst: solicitedNode(A('pc2')), proto: '58', ttl: '255' } },
          { block: 'icmp6', fields: { type: '135', target: A('pc2') } }],
        explain: 'The NS goes to the solicited-node group of pc2 (ff02::1:ff + the last 24 bits), on the MAC 33:33 + the last 32 bits of the group. The hop limit is always 255: a receiver drops NDP messages with a lower value, so they cannot come from outside the link.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which solicited-node group belongs to 2001:db8:1::42:abcd?', input: ['ff02::1:ff42:abcd'] },
        { q: 'From which source address does a host send the NS for duplicate address detection?', options: ['Its link-local address', '::', 'ff02::1', 'The address it is testing'], correct: 1,
          explain: 'The address is not yet allowed to be used, so the NS comes from the unspecified address.' },
        { q: 'Where does a host get its IPv6 default gateway from with SLAAC?', options: ['From DHCP', 'From the Router Advertisement', 'From DNS', 'It is always ::1'], correct: 1 },
        { q: 'Interface ID by EUI-64 for the MAC 00:11:22:33:44:55?', input: ['211:22ff:fe33:4455', '0211:22ff:fe33:4455'], explain: '00 with the 7th bit flipped is 02, then ff:fe goes in the middle: 0211:22ff:fe33:4455.' }] }
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
