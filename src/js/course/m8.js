import { note, tag, pingOk, pingOkAfter, linkBetween } from './helpers.js';
import { ospfTopo } from '../presets.js';

const fullCount = (sim, id) => (sim.dev(id).ospf?.neighborTable() || []).filter(n => n.state === 'Full').length;
const routeTo = (sim, id, net) => sim.dev(id).ospf?.routes.find(r => `${r.net}/${r.len}` === net);

export default {
  id: 'm8', title: 'Dynamic routing with OSPF', bands: ['ip', 'rt'],
  text: 'Routers that find their neighbors, share a map of the network and compute the shortest paths themselves, and react when a link fails.',
  lessons: [
    { id: 'm8-l1', title: 'How link-state routing works', minutes: 12, steps: [
      { type: 'theory', title: 'From static routes to a shared map', html: `
<p>With static routes, every router needs a route to every network, and every change means editing several routers by hand. Worse: if a link fails, the static route stays and traffic runs into nowhere. <b>OSPF</b> (Open Shortest Path First) automates this. It is a <b>link-state</b> protocol: every router describes its own links, all routers collect these descriptions into the same map, and each computes its shortest paths from it.</p>
<h2>Four steps</h2>
<table><tr><th>Step</th><th>What happens</th></tr>
<tr><td>1. Find neighbors</td><td>Every few seconds a <b>hello</b> goes to the multicast address 224.0.0.5. A router that sees its own router ID in a neighbor's hello knows the link works in both directions.</td></tr>
<tr><td>2. Exchange the map</td><td>Neighbors synchronize their <b>link-state database</b> (LSDB). Each router contributes one <b>router LSA</b>: "I am 10.1.0.1, I have neighbors X and Y, and these networks".</td></tr>
<tr><td>3. Flood changes</td><td>When a link changes, the router sends a new version of its LSA (higher sequence number), and everyone passes it on.</td></tr>
<tr><td>4. Compute</td><td>Each router runs Dijkstra's <b>SPF</b> algorithm over the map, with itself at the root, and installs the shortest paths as routes.</td></tr></table>
<h2>Neighbor states</h2>
<pre>Down → Init       a hello arrived
Init → 2-Way      my router ID is in the neighbor's hello
2-Way → Exchange  the databases are compared and exchanged
Exchange → Full   both have the same map</pre>
<p>Real routers show two more states in between: <b>ExStart</b> before Exchange (the two agree who leads the exchange) and <b>Loading</b> before Full (missing parts of the map are fetched). A neighbor stuck in ExStart usually means different MTUs on the link. On a LAN with several routers, two routers that are neither DR nor BDR stay in 2-Way, and that is normal.</p>
<h2>Cost</h2>
<p>Every interface has a <b>cost</b>, the sum along a path counts. By default it follows the bandwidth (reference 100 Mbit/s divided by the link speed). Here every link costs 10. The route with the lowest total cost wins, regardless of the number of hops.</p>
<p>An interface towards hosts only is set to <b>passive</b>: OSPF still announces its network, but sends no hellos there and forms no neighbors, so nobody on that LAN can pose as an OSPF router.</p>
${note('Hello and dead interval must match on both sides, as must the subnet. If they do not, the routers ignore each other\'s hellos and never become neighbors. In FRR the defaults are hello 10 s and dead 40 s. The lab uses 1 s and 4 s so you do not have to wait.')}
${note('A route can be known from several sources. Then the administrative distance decides: connected 0, static 1, OSPF 110. A forgotten static route therefore always beats OSPF.')}` },
      { type: 'stack', title: 'Put the neighbor states in order', hint: 'The top is the first state.',
        items: [{ name: 'Down: nothing heard yet', kind: 'rt' }, { name: 'Init: a hello arrived', kind: 'rt' }, { name: '2-Way: the neighbor sees me too', kind: 'rt' },
          { name: 'Exchange: the databases are exchanged', kind: 'rt' }, { name: 'Full: same map on both sides', kind: 'rt' }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'To which address are OSPF hellos sent?', input: ['224.0.0.5'] },
        { q: 'Path A has three links with cost 10, path B one link with cost 50. Which does OSPF use?', options: ['A, total cost 30', 'B, fewer hops', 'Both alternately'], correct: 0 },
        { q: 'Two routers never become neighbors: show ip ospf neighbor stays empty on both. What is a likely cause?', options: ['Different hello or dead intervals', 'Too many routes', 'The routers have the same cost', 'The link is too fast'], correct: 0,
          explain: 'With mismatched timers each router throws the other\'s hellos away, so the neighbor does not even reach Init. Different subnets on the link have the same effect. Init means that hellos only get through in one direction.' }] }
    ] },

    { id: 'm8-l2', title: 'Turn on OSPF', minutes: 15, steps: [
      { type: 'lab', title: 'Bring o3 into the network', topo: () => ospfTopo({ configured: ['o1', 'o2'] }), edit: 'config',
        intro: '<p>o1 and o2 already run OSPF and are neighbors. o3 has no routes and no OSPF yet, so srv3 is unreachable. None of the routers has a single static route.</p>',
        presets: { pc1: ['ping -c 1 10.3.0.10', 'traceroute 10.3.0.10'], o1: ['show ip ospf neighbor', 'show ip route', 'show ip ospf database'], o3: ['show ip ospf neighbor', 'show ip route'] },
        goals: [
          { text: 'pc1 cannot reach srv3 (10.3.0.10) yet.', check: sim => sim.log.some(e => e.dev === 'pc1' && e.tag === 'ping-done' && e.data.dst === '10.3.0.10' && e.data.received === 0) },
          { text: 'On o3, turn on OSPF and enable it on eth1, eth2 and eth3 (eth3 passive, only srv3 is there). o3 becomes Full with both neighbors.', check: sim => fullCount(sim, 'o3') === 2 },
          { text: 'Ping srv3 from pc1 again.', check: pingOk('pc1', '10.3.0.10') },
          { text: 'Which OSPF cost does o1 have to 10.3.0.0/24?', ask: true, expect: sim => [String(routeTo(sim, 'o1', '10.3.0.0/24')?.cost ?? '')].filter(Boolean) },
          { text: 'Which router ID does o1 have? (show ip ospf neighbor on o3)', ask: true, expect: sim => [sim.dev('o1').ospf.rid] }],
        hints: ['Configuration → OSPF on o3: check "OSPF enabled", then the OSPF box for each interface, and "Passive" for eth3.', 'Without a router ID set by hand, OSPF takes the highest interface address.'],
        outro: '<p>Nobody configured a route to srv3: o3 told the others about 10.3.0.0/24 in its router LSA, and every router computed its own path. Have a look at show ip ospf database: all three routers have the same map.</p>' }
    ] },

    { id: 'm8-l3', title: 'Failover and costs', minutes: 15, steps: [
      { type: 'lab', title: 'Pull a cable, steer with costs', topo: () => ospfTopo(), edit: 'config',
        intro: '<p>All three routers run OSPF. pc1 reaches srv3 directly via o1 → o3. What happens when that link fails?</p>',
        presets: { pc1: ['ping -c 10 10.3.0.10', 'traceroute 10.3.0.10'], o1: ['show ip route', 'ip link set eth2 down', 'ip link set eth2 up'] },
        goals: [
          { text: 'pc1 reaches srv3.', check: pingOk('pc1', '10.3.0.10') },
          { text: 'Disconnect the link between o1 and o3 and ping again. It still works.', check: pingOkAfter('pc1', '10.3.0.10', e => e.tag === 'link-down') },
          { text: 'Through which router does the path go now?', ask: true, expect: () => ['o2'] },
          { text: 'Reconnect the link. Then give o1 eth2 the cost 50: o1 keeps going through o2 even with the direct link up.', check: sim => linkBetween(sim, 'o1', 'o3')?.up && routeTo(sim, 'o1', '10.3.0.0/24')?.via === '10.0.12.2' }],
        hints: ['Click the cable between o1 and o3 and uncheck "Link up", or use ip link set eth2 down on o1.', 'Via o2 costs 10 + 10 + 10 = 30, the direct way with cost 50 costs 50 + 10 = 60.'],
        outro: '<p>With the cost you decide which link carries the traffic and which one is the backup, the same idea as port costs in spanning tree. When a link fails, OSPF notices it immediately if the interface goes down, otherwise only after the dead interval.</p>' }
    ] },

    { id: 'm8-l4', title: 'Neighbors that do not get along', minutes: 12, steps: [
      { type: 'lab', title: 'Find out why o2 is alone', topo: () => ospfTopo({ timers: { o2: 'standard' } }), edit: 'config',
        intro: '<p>All three routers run OSPF, but pc2 cannot reach the other sites. Find out why.</p>',
        presets: { pc2: ['ping -c 1 10.1.0.10'], o2: ['show ip ospf neighbor', 'show ip ospf interface'], o1: ['show ip ospf neighbor', 'show ip ospf interface'] },
        goals: [
          { text: 'Which router has no OSPF neighbor?', ask: true, expect: () => ['o2'] },
          { text: 'Find the log message that explains why the hellos are ignored.', check: tag(null, 'ospf-mismatch') },
          { text: 'Fix it: all three routers have two Full neighbors.', check: sim => ['o1', 'o2', 'o3'].every(id => fullCount(sim, id) === 2) },
          { text: 'pc2 reaches pc1.', check: pingOk('pc2', '10.1.0.10') }],
        hints: ['Compare show ip ospf interface on o1 and o2.', 'The timers are in Configuration → OSPF.'],
        outro: '<p>Mismatched timers, a different subnet on the link, or an interface accidentally set to passive: these are the classic reasons why OSPF neighbors do not come up. For mismatched timers or subnets, the log of the receiving router says why it ignores a hello. A passive interface sends no hellos at all: check <code>show ip ospf interface</code>.</p>' }
    ] }
  ]
};

