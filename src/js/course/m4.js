import { bar, note, pingOk, tag, pingOkAfter, linkBetween } from './helpers.js';
import { stpTriangle, stpSquare } from '../presets.js';
import { macFor } from '../net.js';

// Bridge IDs as in the engine: priority plus MAC of the bridge
const bmac = id => macFor(id + '/bridge');
const bidOf = (sim, id) => `${sim.dev(id).cfg.stp.priority}.${bmac(id)}`;
const lowestBid = (sim, ids) => ids.map(id => ({ id, prio: Number(sim.dev(id).cfg.stp.priority), mac: bmac(id) }))
  .sort((a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac))[0].id;
const TRI = ['sw1', 'sw2', 'sw3'];
// With equal priority, the switch with the highest MAC is certainly not the root
const NOT_ROOT = [...TRI].sort((a, b) => bmac(b).localeCompare(bmac(a)))[0];
const blockedPorts = (sim, ids) => ids.flatMap(id => (sim.dev(id).bridge.stpTable()?.ports || []).filter(p => p.role === 'alternate').map(p => [id, p.port]));
const portAnswers = list => list.flatMap(([d, p]) => [`${d} ${p}`, `${d}:${p}`, `${d}/${p}`, `${d}-${p}`]);
const stpOn = ids => sim => ids.every(id => sim.dev(id)?.bridge?.stp);

export default {
  id: 'm4', title: 'Spanning tree', bands: ['eth', 'stp'],
  text: 'Redundant cabling without a broadcast storm: how switches elect a root bridge, block ports and fail over after an outage.',
  lessons: [
    { id: 'm4-l1', title: 'Why loops bring a network down', minutes: 12, steps: [
      { type: 'theory', title: 'Redundancy without protection', html: `
<p>A single cable between two switches is a single point of failure. So you cable redundantly: if one path fails, there is a second one. But this creates a <b>loop</b>, and Ethernet is not built for that.</p>
<table><tr><th>IP packet</th><th>Ethernet frame</th></tr>
<tr><td>has a TTL, every router subtracts 1, at 0 it ends</td><td>has <b>no</b> such field, a frame can circle forever</td></tr></table>
<p>What happens in a triangle of three switches when pc1 sends a single ARP request:</p>
<pre>1. sw2 floods the broadcast to sw1 and to sw3
2. sw1 floods it on to sw3, sw3 floods it on to sw1
3. Both copies arrive at sw2 again, which floods them again
4. Every round creates new copies, none disappears</pre>
<p>The consequences are called a <b>broadcast storm</b>: the links fill up, every host has to process every broadcast, and the MAC tables keep jumping back and forth (<b>MAC flapping</b>) because the same source MAC shows up on different ports in turn. Within seconds the whole segment grinds to a halt.</p>
${note('The solution is the <b>Spanning Tree Protocol</b> (STP, IEEE 802.1D). The switches exchange small messages, the <b>BPDUs</b>, and use them to compute a tree without loops. Surplus ports are blocked. If an active path fails, STP releases a blocked port again.')}
${note('A cable that accidentally connects two wall sockets in the same office is enough for a loop. That is why STP is normally turned on on switches, even where nobody intentionally cabled redundantly.', true)}` },
      { type: 'lab', title: 'One ping brings the network down', topo: () => stpTriangle({ enabled: false }), edit: 'config',
        intro: '<p>Three switches in a triangle, spanning tree is off everywhere. Ping pc2 from pc1 and watch what happens to the ARP request. The simulation halts as soon as a switch has seen the same frame too often.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2'], sw2: ['bridge fdb', 'show spanning-tree'] },
        goals: [
          { text: 'Ping pc2 (10.0.0.2) from pc1 and trigger the storm.', check: tag(null, 'storm') },
          { text: 'What kind of frame is circling in the loop?', ask: true, expect: () => ['arp', 'arp request', 'arp-request', 'broadcast', 'arp broadcast'], placeholder: 'e.g. ICMP' },
          { text: 'Reset the state and turn on spanning tree on sw1, sw2 and sw3 under Configuration.', check: stpOn(TRI) },
          { text: 'Wait until the dots on the ports are green or red, and ping again. Now the reply arrives.', check: pingOk('pc1', '10.0.0.2') }],
        hints: ['The button with the circular arrow at the top left resets the state.', 'The timers are set to "fast": a port needs 8 seconds to reach Forwarding. With the fast-forward button it happens immediately.'],
        outro: '<p>A red dot shows a blocked port. It keeps receiving BPDUs but does not forward a single frame. This way the cable stays plugged in as a spare without forming a loop.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Why does an Ethernet frame circle endlessly in a loop, but an IP packet does not?', options: ['Ethernet is faster', 'The Ethernet header has no TTL field', 'Switches do not delete frames', 'IP packets are smaller'], correct: 1,
          explain: 'Routers decrement the TTL and drop the packet at 0. A switch does not change the frame and cannot detect a loop.' },
        { q: 'What does MAC flapping mean?', options: ['A MAC address changes randomly', 'The same source MAC shows up on different ports in turn', 'The switch forgets all addresses', 'Two hosts have the same IP'], correct: 1,
          explain: 'In a loop, the frame from pc1 arrives via several paths. Each time, the switch records pc1 on a different port. Many switches report this in their log, a good indicator of a loop.' }] }
    ] },

    { id: 'm4-l2', title: 'Electing the root bridge', minutes: 15, steps: [
      { type: 'theory', title: 'Bridge ID and BPDUs', html: `
<p>Spanning tree builds the tree from a root, the <b>root bridge</b>. The switch with the lowest <b>bridge ID</b> is elected:</p>
${bar([['Priority', '4 bits', 'stp', 1], ['System ID (VLAN)', '12 bits', 'stp', 1.6], ['MAC address of the bridge', '48 bits', 'eth', 3]], '8 bytes in total. The priority counts first, in case of a tie the MAC.')}
<p>The priority is <b>32768</b> by default and can only be changed in steps of <b>4096</b>, because the lower 12 bits are reserved for the VLAN number. If all switches have the same priority, the lowest MAC address wins, often the oldest switch in the network. That is why the root is chosen deliberately, usually a central switch with priority 4096 or 0.</p>
<h2>How the election works</h2>
<pre>1. Every switch starts up and considers itself the root
2. It sends BPDUs to 01:80:c2:00:00:00 every 2 seconds
3. If it hears a BPDU with a lower root ID, it adopts that root
4. In the end only the root sends its own BPDUs, the others relay them</pre>
<table><tr><th>Field in the BPDU</th><th>Meaning</th></tr>
<tr><td>Root ID</td><td>whom the sender considers the root</td></tr>
<tr><td>Root path cost</td><td>how expensive the sender's path to the root is</td></tr>
<tr><td>Bridge ID, port ID</td><td>who is sending, through which port</td></tr>
<tr><td>Hello, max age, forward delay</td><td>timers the root sets for everyone (2, 20, 15 seconds)</td></tr>
<tr><td>Flags</td><td>among others, topology change</td></tr></table>
${note('BPDUs are not Ethernet II frames. They use the older 802.3 format with a length field instead of an EtherType and an LLC header (DSAP and SSAP 0x42). You can see this in the packet inspector.')}` },
      { type: 'quiz', title: 'Who wins?', questions: [
        { q: 'Three switches: A <code>32768.00:1a:2b:00:00:01</code>, B <code>4096.00:1a:2b:ff:ff:ff</code>, C <code>32768.00:00:00:00:00:02</code>. Who becomes root?', options: ['A', 'B', 'C'], correct: 1,
          explain: 'The priority counts first. 4096 is lower than 32768, so the MAC no longer matters.' },
        { q: 'A and C remain. Which of the two would have the lower bridge ID?', options: ['A', 'C'], correct: 1, explain: 'Same priority, so the MAC decides: 00:00:00:… is lower than 00:1a:2b:….' },
        { q: 'Which priority can you not configure?', options: ['0', '4096', '20000', '61440'], correct: 2, explain: '20000 is not a multiple of 4096.' }] },
      { type: 'build', title: 'Build a BPDU from the root', blocks: ['eth', 'vlan', 'arp', 'stp', 'ip', 'udp', 'data'],
        task: `<p><b>sw1</b> is the root bridge with bridge ID <code>4096.${bmac('sw1')}</code>. Build the BPDU that sw1 sends out of its port eth1 (MAC of eth1: <code>${macFor('sw1/eth1')}</code>).</p>`,
        addresses: { mac: [[macFor('sw1/eth1'), 'sw1 eth1'], [macFor('sw2/eth1'), 'sw2 eth1']], bid: [[`4096.${bmac('sw1')}`, 'sw1'], [`32768.${bmac('sw2')}`, 'sw2'], [`32768.${bmac('sw3')}`, 'sw3']] },
        expected: [
          { block: 'eth', fields: { dst: '01:80:c2:00:00:00', src: macFor('sw1/eth1'), type: 'len' } },
          { block: 'stp', fields: { root: `4096.${bmac('sw1')}`, cost: '0', bridge: `4096.${bmac('sw1')}` } }],
        explain: 'The root has a cost of 0 to itself and is also the sender. The destination MAC is the reserved multicast address for bridges, which no switch forwards. Instead of an EtherType, the header contains the payload length (802.3), followed by the LLC header.' },
      { type: 'lab', title: 'Find the root and pick a new one', topo: () => stpTriangle({ enabled: true }), edit: 'config',
        intro: `<p>All three switches have the default priority 32768. Find out who became root, and then choose a new root yourself. Use <code>show spanning-tree</code> in a switch's console or look under Tables to see the state.</p>`,
        presets: { sw1: ['show spanning-tree'], sw2: ['show spanning-tree'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Which switch is the root bridge?', ask: true, expect: sim => [lowestBid(sim, TRI)], placeholder: 'e.g. sw2' },
          { text: 'Why that one? Which MAC address does its bridge ID have?', ask: true, expect: sim => [bmac(lowestBid(sim, TRI))], placeholder: 'aa:c1:ab:…' },
          { text: `Make <b>${NOT_ROOT}</b> the root bridge by lowering its priority. All switches must recognize it as the root.`,
            check: sim => TRI.every(id => sim.dev(id).bridge.stpTable()?.root === bidOf(sim, NOT_ROOT)) }],
        hints: ['You set the priority under Configuration on the switch, in the Spanning tree section.', 'It also works in the console: spanning-tree priority 4096'],
        outro: '<p>The new root takes over immediately: as soon as the others hear its better BPDU, they adopt the root ID and recompute their ports.</p>' }
    ] },

    { id: 'm4-l3', title: 'Port roles and path costs', minutes: 18, steps: [
      { type: 'theory', title: 'Root port, designated, alternate', html: `
<p>Once the root is settled, every switch assigns roles to its ports. All decisions follow the same chain of comparisons: lower cost, then lower bridge ID of the sender, then lower port ID.</p>
<table><tr><th>Role</th><th>Rule</th><th>State</th></tr>
<tr><td><b>Root port</b></td><td>Every switch except the root has exactly one: the port with the cheapest path to the root.</td><td>Forwarding</td></tr>
<tr><td><b>Designated port</b></td><td>Every cable segment has exactly one: on the switch that offers the cheapest path to the root there. All ports of the root are designated.</td><td>Forwarding</td></tr>
<tr><td><b>Alternate</b></td><td>Everything that is left. A backup path to the root.</td><td>Blocking</td></tr></table>
<h2>Costs</h2>
<p>The root path cost is the sum of the port costs on the way to the root, each counted at the <b>receiving</b> port. Faster links cost less:</p>
<table><tr><th>Speed</th><th>802.1D (short)</th><th>802.1t (long)</th></tr>
<tr><td>10 Mbit/s</td><td>100</td><td>2,000,000</td></tr><tr><td>100 Mbit/s</td><td>19</td><td>200,000</td></tr>
<tr><td>1 Gbit/s</td><td>4</td><td>20,000</td></tr><tr><td>10 Gbit/s</td><td>2</td><td>2,000</td></tr></table>
<h2>Worked through on the ring</h2>
<pre>Ring: sw1 (root) – sw2 – sw3 – sw4 – sw1, all links cost 4
sw2: root port to sw1, cost 4
sw4: root port to sw1, cost 4
sw3: two paths with cost 8, via sw2 or via sw4
     tie → the neighbor with the lower bridge ID wins
Segment sw2–sw3: sw2 offers 4, sw3 offers 8 → sw2 is designated
Segment sw3–sw4: the same, sw4 is designated
→ The port of sw3 towards the "loser" is left over: alternate, blocking</pre>
${note('The roles tell you where traffic flows. A frame from one end of the ring to the other always takes the path via the root, even if a shorter path exists that is currently blocked.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'How many root ports does the root bridge have?', input: ['0', 'none', 'zero'], explain: 'The root does not need a path to itself. All of its ports are designated.' },
        { q: 'A switch reaches the root directly via a 100 Mbit link (cost 19) or via two gigabit hops (4 + 4). Which path becomes the root port?', options: ['The direct 100 Mbit link', 'The path via two gigabit hops', 'Both, STP balances the load'], correct: 1,
          explain: '4 + 4 = 8 is less than 19. STP counts costs, not hops. And STP never balances load across two paths; that would require several instances (MSTP) or layer 3 routing with ECMP.' },
        { q: 'On a segment, both switches offer the same cost to the root. Who gets the designated port?', options: ['The one with the lower bridge ID', 'The one with the higher MAC', 'Both', 'Neither'], correct: 0 }] },
      { type: 'lab', title: 'Predict and move the blocked port', topo: stpSquare, edit: 'config',
        intro: '<p>Four switches in a ring, sw1 is root (priority 4096). Let the network converge briefly and then compare the dots on the ports with your calculation. R stands for root port, D for designated, A for alternate.</p>',
        presets: { sw3: ['show spanning-tree', 'spanning-tree cost eth2 19'], sw2: ['show spanning-tree'], sw4: ['show spanning-tree'], pc1: ['ping -c 2 10.0.0.3'] },
        goals: [
          { text: 'Which port blocks? Answer with switch and port, e.g. sw2 eth1.', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Via which neighbor does sw3 reach the root?', ask: true, expect: sim => { const t = sim.dev('sw3').bridge.stpTable(); const l = sim.linkAt('sw3', t?.rootPort || ''); return l ? [l.a.dev === 'sw3' ? l.b.dev : l.a.dev] : []; } },
          { text: 'Raise a port cost on sw3 so that sw3 reaches the root via <b>sw2</b>.', check: sim => sim.dev('sw3').bridge.stpTable()?.rootPort === 'eth1' },
          { text: 'Which port blocks now?', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Ping pc3 (10.0.0.3) from pc1. The path goes via sw2.', check: pingOk('pc1', '10.0.0.3') }],
        hints: ['sw3 eth1 leads to sw2, sw3 eth2 to sw4.', 'Costs count at the receiving port. Make the path via sw4 more expensive: cost of sw3 eth2 to 19.'],
        outro: '<p>With port costs you control which link is the backup. In practice, costs are usually left at the default and only the root is chosen deliberately. Costs are adjusted when links have different speeds or a specific link should be preferred.</p>' }
    ] },

    { id: 'm4-l4', title: 'Port states, timers and PortFast', minutes: 15, steps: [
      { type: 'theory', title: 'Why a new port needs 30 seconds', html: `
<p>A port that becomes active must not forward right away: it could close a loop before all switches know the new situation. That is why it goes through several states:</p>
<table><tr><th>State</th><th>Duration</th><th>BPDUs</th><th>learns MACs</th><th>forwards</th></tr>
<tr><td>Blocking</td><td>up to 20 s (max age)</td><td>receives</td><td>no</td><td>no</td></tr>
<tr><td>Listening</td><td>15 s (forward delay)</td><td>sends and receives</td><td>no</td><td>no</td></tr>
<tr><td>Learning</td><td>15 s (forward delay)</td><td>sends and receives</td><td><b>yes</b></td><td>no</td></tr>
<tr><td>Forwarding</td><td>permanent</td><td>sends and receives</td><td>yes</td><td><b>yes</b></td></tr></table>
<p>Learning exists so that the switch fills its MAC table before it forwards. Otherwise it would have to flood every frame at first.</p>
${note('The problem in practice: a PC is plugged in, and nothing works for 30 seconds. DHCP times out, a PXE boot fails. The solution is called <b>PortFast</b> (Cisco) or <b>edge port</b> (standard): ports to end devices go to Forwarding immediately.')}
<p>If a BPDU still arrives on an edge port, there is obviously a switch connected there. The port then loses its edge status and takes part in STP normally. With <b>BPDU Guard</b>, such a port is even shut down, a good protection against switches people bring along.</p>
${note('<b>RSTP</b> (802.1w, the standard today) negotiates new ports in fractions of a second instead of waiting for timers. The roles and the root election work the same as here. A Linux bridge only speaks classic STP; for RSTP you need the <code>mstpd</code> service.')}` },
      { type: 'lab', title: 'Watch the states and turn on PortFast', topo: () => stpTriangle({ enabled: true, rootPrio: 4096, timers: 'standard' }), edit: 'config',
        intro: '<p>This time the standard timers are running. Watch the dots on the ports: yellow means Listening or Learning. The log can be filtered to "Spanning tree only". The fast-forward button skips waiting time.</p>',
        presets: { sw2: ['show spanning-tree'], sw3: ['show spanning-tree', 'spanning-tree portfast eth5 on'], pc1: ['ping -c 1 10.0.0.2'] },
        goals: [
          { text: 'Wait until the port of pc1 (sw2 eth5) forwards.', check: tag('sw2', 'stp-state', d => d.port === 'eth5' && d.state === 'forwarding') },
          { text: 'After how many seconds of simulation time was that? (whole number)', ask: true,
            expect: sim => { const e = sim.log.find(x => x.dev === 'sw2' && x.tag === 'stp-state' && x.data?.port === 'eth5' && x.data.state === 'forwarding'); return e ? [String(Math.round(e.t / 1000)), '30'] : ['30']; } },
          { text: 'Turn on PortFast for eth5 on sw3. Then briefly disconnect pc2\'s cable and reconnect it: the port forwards immediately.', check: tag('sw3', 'stp-state', d => d.port === 'eth5' && d.edge) },
          { text: 'In which state does a port learn MAC addresses but not forward anything yet?', ask: true, expect: () => ['learning'] }],
        hints: ['You disconnect a cable by clicking it and unchecking "Link up".'],
        outro: '<p>Edge ports belong on every port to an end device. Between switches they stay off, otherwise a loop could briefly form when plugging in.</p>' }
    ] },

    { id: 'm4-l5', title: 'Failure and convergence', minutes: 15, steps: [
      { type: 'theory', title: 'When a path goes away', html: `
<p>Spanning tree has to distinguish two kinds of failures:</p>
<table><tr><th>Failure</th><th>How the switch notices</th><th>Duration with 802.1D</th></tr>
<tr><td>direct: its own root port loses the link</td><td>immediately</td><td>30 s (listening + learning)</td></tr>
<tr><td>indirect: the path breaks somewhere else</td><td>BPDUs stop arriving, after max age the information expires</td><td>up to 50 s (20 + 15 + 15)</td></tr></table>
<h2>Topology change</h2>
<p>After failing over, the MAC tables are no longer correct: they still point to the old path. Without countermeasures, frames would run into nowhere until aging (300 s). That is why a switch reports a <b>topology change</b> (TC) towards the root, the root sets the TC flag in its BPDUs, and all switches then quickly flush their MAC tables. After that, addresses are learned again via the new path.</p>
${note('A TC also occurs when an ordinary port of an end device goes to Forwarding. Without PortFast, every PC that is switched on briefly triggers a flush of the MAC tables in the entire network. Another reason for edge ports.')}` },
      { type: 'lab', title: 'Pull a cable', topo: () => stpTriangle({ enabled: true, rootPrio: 4096 }), edit: 'config',
        intro: '<p>sw1 is root. Let the network converge and check with a ping that everything works. Then interrupt the cable between sw1 and sw2 and watch how STP releases the backup path.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2', 'ping -c 12 10.0.0.2'], sw2: ['show spanning-tree', 'ip link set eth1 down'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Ping pc2 from pc1 as soon as all ports are green or red.', check: pingOk('pc1', '10.0.0.2') },
          { text: 'Which switch has the blocked port?', ask: true, expect: sim => {
            const cut = sim.log.find(x => x.tag === 'link-down');
            const ev = sim.log.filter(x => x.tag === 'stp-state' && x.data?.state === 'blocking' && (!cut || x.seq < cut.seq));
            return ev.length ? [ev[ev.length - 1].dev] : blockedPorts(sim, TRI).map(([d]) => d);
          } },
          { text: 'Interrupt the cable between sw1 and sw2.', check: sim => linkBetween(sim, 'sw1', 'sw2')?.up === false },
          { text: 'Which port of sw2 is now the root port?', ask: true, expect: sim => [sim.dev('sw2').bridge.stpTable()?.rootPort || ''] },
          { text: 'Ping again until replies come back.', check: pingOkAfter('pc1', '10.0.0.2', e => e.tag === 'link-down') }],
        hints: ['A running ping -c 12 nicely shows how long the interruption lasts.', 'In the log under "Spanning tree only" you can see the topology change and the flushing of the MAC tables.'],
        outro: '<p>With the fast lab timers, failing over takes 8 seconds, with the standard timers 30. Rapid spanning tree usually manages it in under a second. Where failover has to be even faster, you rely on layer 3 with routing instead of large layer 2 domains.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Why do switches flush their MAC tables after a topology change?', options: ['To save memory', 'Because the entries still point to the old path', 'So that STP restarts', 'They do not'], correct: 1 },
        { q: 'A switch no longer hears BPDUs on its root port, but the link is still up. How long does it wait (802.1D) before discarding the information?', input: ['20'], unit: 'seconds', explain: 'That is max age. After that come listening and learning with 15 seconds each.' },
        { q: 'Which measure shortens failover the most?', options: ['Hello timer at 1 second', 'Rapid spanning tree (802.1w)', 'Higher root priority', 'More redundant cables'], correct: 1 }] }
    ] }
  ]
};
