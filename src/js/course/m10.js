import { note, pingOk, tag, pingOkAfter, linkBetween } from './helpers.js';
import { ecmpTopo, bfdTopo } from '../presets.js';

// Via which router a forwarded packet of a client left r1
const pathOf = (sim, src) => {
  const e = sim.log.find(x => x.dev === 'r1' && x.tag === 'forwarded' && x.data?.dst === '10.4.0.10' && x.frame?.payload?.src === src);
  if (!e) return [];
  const owner = sim.topo.devices.find(d => Object.values(d.ifaces || {}).some(i => i.ip === e.data.via));
  return owner ? [owner.name] : [];
};
// TCP connections of c1 that r1 spread over both paths with the L4 hash
const synVias = sim => new Set(sim.log.filter(e => e.dev === 'r1' && e.tag === 'forwarded' && e.data?.ecmp && e.frame?.payload?.src === '10.1.0.10' && e.frame.payload.l4?.flags?.SYN).map(e => e.data.via));
const bfdUpBoth = sim => ['r1', 'r2'].every(id => (sim.dev(id).bfd?.table() || []).some(s => s.state === 'Up' && ['10.0.12.1', '10.0.12.2'].includes(s.peer)));
const provCut = sim => sim.log.some(e => e.tag === 'link-loss');
// BFD hellos fill the capped log quickly, so the moments r1 declared a neighbor dead are remembered here
const bfdDowns = new WeakMap();
const fastFailover = sim => {
  const seen = bfdDowns.get(sim) || new Set(); bfdDowns.set(sim, seen);
  for (const e of sim.log) if (e.tag === 'bfd-state' && e.dev === 'r1' && e.data?.state === 'Down') seen.add(e.t);
  // a ping of pc1 that was running when BFD fired and lost at most two replies
  return sim.log.some(d => d.tag === 'ping-done' && d.dev === 'pc1' && d.data.sent >= 5 && d.data.sent - d.data.received <= 2
    && [...seen].some(t => t < d.t && t > d.t - d.data.sent * 1000 - 1500));
};

export default {
  id: 'm10', title: 'ECMP and BFD', bands: ['ip', 'rt'],
  text: 'Using several equal paths at once, and noticing in under a second when a path dies, even when the cable stays plugged in.',
  lessons: [
    { id: 'm10-l1', title: 'Several equal paths: ECMP', minutes: 12, steps: [
      { type: 'theory', title: 'Why use only one path?', html: `
<p>Until now, every router had exactly one best route to a network. When two paths are equally good, that wastes half the capacity. <b>ECMP</b> (Equal-Cost Multi-Path) puts all equally good routes into the routing table and uses them at the same time.</p>
<p>Routes count as equal when the prefix, the source (administrative distance) and the metric are the same. In OSPF that happens when two paths add up to the same cost, with static routes when you give a network several next hops.</p>
<pre>$ ip route
10.4.0.0/24 proto ospf metric 30
        nexthop via 10.0.12.2 dev eth1 weight 1
        nexthop via 10.0.13.3 dev eth2 weight 1</pre>
<h2>Per flow, not per packet</h2>
<p>If the router alternated packet by packet, the packets of one TCP connection would take paths of different length and overtake each other. TCP takes reordering for loss and slows down. That is why the router computes a <b>hash</b> over fields of each packet and picks the path with it. All packets of a flow have the same fields, so they always take the same path.</p>
<table><tr><th>Hash policy</th><th>Fields</th><th>Effect</th></tr>
<tr><td>Layer 3 (Linux default)</td><td>source and destination IP</td><td>everything between two hosts takes one path</td></tr>
<tr><td>Layer 4</td><td>plus protocol and ports</td><td>every connection can take a different path</td></tr></table>
${note('ECMP spreads <i>flows</i>, not bytes. A single large download always uses only one path. With few hosts and the layer 3 hash, the distribution can be very uneven; data centers use the layer 4 hash and many paths for that reason.')}
<p>On Linux the hash is chosen with <code>sysctl net.ipv4.fib_multipath_hash_policy</code> (0 layer 3, 1 layer 4), in FRR the number of paths with <code>maximum-paths</code>.</p>` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Two OSPF paths to a network cost 30 and 40. How many does ECMP use?', options: ['Both', 'Only the one with cost 30', 'Only the one with cost 40', 'Alternately'], correct: 1,
          explain: 'ECMP only applies to equal routes. Different cost means one best route.' },
        { q: 'Why does a router not simply alternate between the paths packet by packet?', options: ['It would need more memory', 'The packets of a connection would overtake each other, TCP sees that as loss', 'The switches would get confused', 'It does not matter'], correct: 1 },
        { q: 'Hash over source and destination IP: host A downloads from server S over 5 connections at once. How many paths do they use?', input: ['1', 'one'], explain: 'All 5 connections have the same two IP addresses, so the same hash. Only the layer 4 hash would spread them.' }] }
    ] },

    { id: 'm10-l2', title: 'ECMP in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Two paths, one network', topo: () => ecmpTopo(), edit: 'config',
        intro: '<p>r1 reaches the server network 10.4.0.0/24 via r2 and via r3, both with OSPF cost 30. Find out how r1 spreads the traffic.</p>',
        presets: { r1: ['show ip route', 'ip route', 'sysctl net.ipv4.fib_multipath_hash_policy=1', 'ip link set eth1 down'], c1: ['ping -c 1 10.4.0.10', 'curl http://10.4.0.10/'], c2: ['ping -c 1 10.4.0.10'] },
        goals: [
          { text: 'Look at the routing table of r1 (show ip route). How many next hops does it have for 10.4.0.0/24?', ask: true, expect: () => ['2', 'two'] },
          { text: 'Ping the server (10.4.0.10) from c1 and from c2.', check: sim => pingOk('c1', '10.4.0.10')(sim) && pingOk('c2', '10.4.0.10')(sim) },
          { text: 'Through which router did the ping of c1 travel? The log of r1 tells you.', ask: true, expect: sim => pathOf(sim, '10.1.0.10'), placeholder: 'r2 or r3' },
          { text: 'And the ping of c2?', ask: true, expect: sim => pathOf(sim, '10.1.0.11'), placeholder: 'r2 or r3' },
          { text: 'With the layer 3 hash, all connections of c1 take one path. Switch r1 to the layer 4 hash and run <code>curl http://10.4.0.10/</code> on c1 a few times until both paths carry a connection.', check: sim => synVias(sim).size >= 2 },
          { text: 'Disconnect the cable r1–r2 and ping from c1 again: everything now runs via r3.', check: sim => linkBetween(sim, 'r1', 'r2')?.up === false && pingOkAfter('c1', '10.4.0.10', e => e.tag === 'link-down')(sim) }],
        hints: ['The hash is under Configuration on r1, Add a feature, Load balancing (ECMP). Or in the console: sysctl net.ipv4.fib_multipath_hash_policy=1', 'Every curl uses a new source port, so a new hash. Filter the log to "Only r1" and look for "ECMP".'],
        outro: '<p>With the layer 3 hash the path depends only on the two addresses, so c1 and c2 happened to take different routers. With the layer 4 hash, even the connections of one client are spread. When a path fails, OSPF removes its next hop and the flows move to the remaining one.</p>' }
    ] },

    { id: 'm10-l3', title: 'BFD: noticing a dead neighbor fast', minutes: 12, steps: [
      { type: 'theory', title: 'When the cable stays plugged in', html: `
<p>If a router's own cable is pulled, it notices immediately. But often there is something in between: a provider switch, a media converter, a radio link. When the far side fails, the local port stays up. The router only finds out when the routing protocol misses its hellos:</p>
<table><tr><th>Protocol</th><th>Detection with default timers</th></tr>
<tr><td>OSPF</td><td>dead interval 40 s</td></tr>
<tr><td>BGP</td><td>hold time 90 to 180 s</td></tr>
<tr><td>Static route</td><td>never, the route stays and traffic disappears</td></tr></table>
<p>Making the hellos faster everywhere costs CPU in every protocol. <b>BFD</b> (Bidirectional Forwarding Detection) solves it once for all of them: two neighbors exchange tiny packets every few hundred milliseconds. If <i>interval × multiplier</i> passes without one, the session goes down, and BFD tells its clients at once.</p>
<pre>interval 300 ms × multiplier 3 = detection after 900 ms</pre>
<h2>How a session comes up</h2>
<table><tr><th>State</th><th>Meaning</th></tr>
<tr><td>Down</td><td>no session yet, or it failed</td></tr>
<tr><td>Init</td><td>I hear the neighbor, but it does not hear me yet</td></tr>
<tr><td>Up</td><td>both hear each other (three-way handshake)</td></tr></table>
<p>Each side picks a random <b>discriminator</b> and finds the other's in the packets, so both know which session a packet belongs to. Single-hop BFD uses UDP port 3784 and TTL 255, so packets from farther away cannot fake a session.</p>
${note('BFD decides nothing itself: it only says "neighbor reachable" or "neighbor gone". OSPF, BGP or a static route are its clients and react. Both neighbors must run BFD, otherwise the session never comes up.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Interval 300 ms and multiplier 3. After how many milliseconds without a packet is the neighbor declared dead?', input: ['900'], unit: 'ms' },
        { q: 'A router sends BFD packets, the neighbor has BFD turned off. Which state does the session stay in?', options: ['Up', 'Init', 'Down'], correct: 2, explain: 'Without packets from the neighbor, the session never even reaches Init.' },
        { q: 'Why does a static route need BFD more than OSPF does?', options: ['Static routes are slower', 'A static route has no hellos at all and never notices a dead next hop behind a switch', 'OSPF cannot use BFD', 'It does not'], correct: 1 }] }
    ] },

    { id: 'm10-l4', title: 'BFD in the lab', minutes: 18, steps: [
      { type: 'lab', title: 'The provider drops everything', topo: () => bfdTopo(), edit: 'config',
        intro: '<p>pc1 reaches the server via r1 and r2. The direct path runs through the switch of a provider (cost 10), the backup via r3 is more expensive. All routers run OSPF with the standard timers (hello 10 s, dead 40 s).</p>',
        presets: { pc1: ['ping -c 1 10.2.0.10', 'ping -c 60 10.2.0.10'], r1: ['show ip route', 'show ip ospf neighbor', 'show bfd peers'], r2: ['show bfd peers'] },
        goals: [
          { text: 'Ping the server (10.2.0.10) from pc1.', check: pingOk('pc1', '10.2.0.10') },
          { text: 'Start a long ping (ping -c 60 10.2.0.10). While it runs, click the cable between prov and r2 and set its packet loss to 100 %: the provider silently drops everything, both ports stay up.', check: provCut },
          { text: 'How long does OSPF wait with the standard timers before it gives up a silent neighbor? (seconds)', ask: true, expect: () => ['40'], placeholder: 'seconds' },
          { text: 'Set the loss back to 0. Turn on BFD on r1 and r2 and let it watch the OSPF neighbors. Wait until show bfd peers says Up on both.', check: bfdUpBoth },
          { text: 'Ping again and set the loss to 100 % once more. This time the ping loses at most two replies.', check: fastFailover },
          { text: 'BFD on r1 runs with interval 300 ms and multiplier 3. After how many milliseconds did it give up the neighbor?', ask: true, expect: () => ['900'], placeholder: 'ms' }],
        hints: ['The fast-forward button helps while OSPF waits its 40 seconds; the ping keeps counting.', 'BFD is under Configuration on each router: Add a feature, BFD. Check "BFD enabled" and "Watch the OSPF neighbors".', 'The loss is in the cable settings: click the cable, Line quality.'],
        outro: '<p>Without BFD the ping lost about 40 replies: OSPF had to wait for its dead interval, because the port of r1 never went down. With BFD the failure was noticed after 900 ms, OSPF dropped the neighbor at once and rerouted via r3.</p>' }
    ] }
  ]
};
