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
const rstpOn = ids => sim => ids.every(id => sim.dev(id)?.bridge?.stp?.rstp);
// Did all switches run RSTP at the moment of a log event? (the last start of each one counts)
const rstpAt = (sim, ids, ev) => ids.every(id => { const s = sim.log.filter(e => e.dev === id && e.tag === 'stp-start' && e.seq < ev.seq).pop(); return !!s?.data?.rstp; });
const isCut = (a, b) => e => e.tag === 'link-down' && e.text.includes(` ${a} `) && e.text.includes(` ${b} `);
// The ping of `from` that was running when the event happened
const pingAcross = (sim, from, ev) => sim.log.find(e => e.tag === 'ping-done' && e.dev === from && e.seq > ev.seq && e.t - e.data.sent * 1000 - 1500 < ev.t);
const lossAt = (sim, from, ev) => { const d = ev && pingAcross(sim, from, ev); return d ? d.data.sent - d.data.received : null; };
const firstStpCut = sim => sim.log.find(e => isCut('sw1', 'sw2')(e) && !rstpAt(sim, TRI, e));
const rstpCuts = sim => sim.log.filter(e => isCut('sw1', 'sw2')(e) && rstpAt(sim, TRI, e));
const SQR = ['sw1', 'sw2', 'sw3', 'sw4'];

export default {
  id: 'm4', title: 'Spanning tree', bands: ['eth', 'stp'],
  text: 'Redundant cabling without a broadcast storm: how switches elect a root bridge, block ports and fail over after an outage. Then rapid spanning tree, which does the same in milliseconds.',
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
          { text: 'Reset the state and turn on spanning tree on sw1, sw2 and sw3 under Configuration (Add a feature, Spanning tree).', check: stpOn(TRI) },
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
${note('<b>RSTP</b> (802.1w, the standard today) negotiates new ports in fractions of a second instead of waiting for timers. The roles and the root election work the same as here. You will try it at the end of this module.')}` },
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
        outro: '<p>With the fast lab timers, failing over takes 8 seconds, with the standard timers 30. Rapid spanning tree usually manages it in under a second: that is what the next lessons are about.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Why do switches flush their MAC tables after a topology change?', options: ['To save memory', 'Because the entries still point to the old path', 'So that STP restarts', 'They do not'], correct: 1 },
        { q: 'A switch no longer hears BPDUs on its root port, but the link is still up. How long does it wait (802.1D) before discarding the information?', input: ['20'], unit: 'seconds', explain: 'That is max age. After that come listening and learning with 15 seconds each.' },
        { q: 'Which measure shortens failover the most?', options: ['Hello timer at 1 second', 'Rapid spanning tree (802.1w)', 'Higher root priority', 'More redundant cables'], correct: 1 }] }
    ] },
    { id: 'm4-l6', title: 'Rapid spanning tree (RSTP)', minutes: 15, steps: [
      { type: 'theory', title: 'Asking instead of waiting', html: `
<p>Classic spanning tree is slow on purpose. A port that may forward again cannot know whether this closes a loop somewhere, so it simply waits until the news has spread through the whole network: 15 seconds of listening, 15 seconds of learning. <b>Rapid spanning tree</b> (RSTP, IEEE 802.1w, today part of 802.1D-2004) replaces most of this waiting with a short conversation between neighbors.</p>
<p>The good news first: the root election, the bridge ID, the costs and the port roles work exactly as you learned. RSTP changes <i>how fast</i> the tree is built, not <i>which</i> tree.</p>
<table><tr><th></th><th>STP (802.1D)</th><th>RSTP (802.1w)</th></tr>
<tr><td>Port states</td><td>Blocking, Listening, Learning, Forwarding</td><td><b>Discarding</b>, Learning, Forwarding</td></tr>
<tr><td>Roles</td><td>Root, Designated, Alternate</td><td>the same, plus <b>Backup</b></td></tr>
<tr><td>BPDUs</td><td>come from the root, the others relay them</td><td>every switch sends its own every hello, like a keepalive</td></tr>
<tr><td>Neighbor gone</td><td>after max age, 20 s</td><td>after 3 missed hellos, 6 s. A dead link at once</td></tr>
<tr><td>New forwarding port</td><td>30 s of timers</td><td><b>proposal and agreement</b>, milliseconds</td></tr>
<tr><td>Root port fails, alternate exists</td><td>30 to 50 s</td><td>the alternate takes over <b>immediately</b></td></tr>
<tr><td>Topology change</td><td>reported to the root, which tells everyone</td><td>flooded directly by the switch that notices it</td></tr></table>
<h2>Alternate and backup</h2>
<p>An <b>alternate</b> port is a blocked port that leads to the root via <i>another</i> switch. RSTP keeps it ready: if the root port fails, the alternate becomes the root port and forwards at once, it already knows that this path is loop-free. A <b>backup</b> port is a second port of the same switch into the same segment, which only happens with hubs or shared media. You will hardly see it today.</p>
${note('Only three states remain because Blocking and Listening looked the same from the outside: neither forwards nor learns. RSTP calls this <b>Discarding</b>. In the lab, a red dot is a discarding alternate or backup port, a yellow one a port that is still negotiating.')}` },
      { type: 'theory', title: 'Proposal and agreement', html: `
<p>When a designated port wants to forward, it does not wait. It sends a BPDU with the <b>proposal</b> flag: "May I forward right away?" The neighbor may only say yes if this cannot create a loop on its side.</p>
<pre>sw1 (root)                           sw2
eth1: Designated, Discarding
   ── RST BPDU, Proposal ──────────▶  eth1 becomes the root port
                                     <b>Sync:</b> all other non-edge designated
                                     ports go to Discarding (eth2)
   ◀────────── RST BPDU, Agreement ──  "go ahead"
eth1: Forwarding (milliseconds)      eth1 forwards as the root port
                                     eth2 now sends its own proposal
                                     to the next switch …</pre>
<p>The <b>sync</b> is the trick: before sw2 agrees, it blocks its own ports towards the rest of the network. So there is never an open loop, and the handshake travels down the tree like a wave, one link at a time. A blocked alternate port agrees right away because it does not forward anyway.</p>
<h2>When the handshake does not work</h2>
<table><tr><th>Situation</th><th>What happens</th></tr>
<tr><td>Port to an end device without <b>edge</b> setting</td><td>A PC does not answer proposals: the port waits 2 × forward delay, 30 s, as in STP</td></tr>
<tr><td>Neighbor only speaks 802.1D</td><td>It ignores RST BPDUs and sends old ones. The RSTP switch falls back to STP on that port, with timers</td></tr>
<tr><td>Shared link (half duplex, hub)</td><td>The handshake needs a point-to-point link, otherwise timers</td></tr></table>
${note('So the edge setting is more important with RSTP, not less: it is the only way a port to an end device forwards without delay. On Cisco: <code>spanning-tree portfast</code>, on Linux with mstpd: <code>mstpctl setportadminedge</code>.')}
<h2>Topology change</h2>
<p>In RSTP only a port that <b>starts forwarding</b> counts as a topology change, and edge ports never do. The switch that notices it flushes the MAC addresses on its other ports and sends BPDUs with the TC flag on all its root and designated ports at once. Every switch that receives one does the same, so the news spreads in milliseconds without a detour via the root.</p>
<h2>Inside an RST BPDU</h2>
<p>Proposal, agreement, role and state all travel in a single byte. An RST BPDU is 36 bytes long, one byte more than the classic configuration BPDU:</p>
${bar([['Protocol, version, type', '4 bytes', 'stp', 1.5], ['Flags', '1 byte', 'rt', .8], ['Root ID', '8 bytes', 'stp', 1.1], ['Root path cost', '4 bytes', 'stp', 1.2], ['Bridge ID', '8 bytes', 'stp', 1.1], ['Port ID', '2 bytes', 'stp', .8], ['Timers', '8 bytes', 'stp', .9], ['Version 1 length', '1 byte', 'stp', 1.1]], 'Version 2 and type 0x02 make it an RST BPDU. The timers are message age, max age, hello and forward delay, 2 bytes each.')}
${bar([['TC Ack', 'bit 7', 'stp', 1], ['Agreement', 'bit 6', 'stp', 1.25], ['Forwarding', 'bit 5', 'stp', 1.25], ['Learning', 'bit 4', 'stp', 1.15], ['Port role', 'bits 3-2', 'stp', 1.5], ['Proposal', 'bit 1', 'stp', 1.15], ['TC', 'bit 0', 'stp', .85]], 'The flags byte, bit 7 on the left. Classic STP only uses the two outer bits, RSTP fills the six in between.')}
<table><tr><th>Bit</th><th>Flag</th><th>Set when</th></tr>
<tr><td>0</td><td>TC</td><td>the sender reports a topology change, receivers flush their MAC tables</td></tr>
<tr><td>1</td><td>Proposal</td><td>a designated port asks whether it may forward right away</td></tr>
<tr><td style="white-space:nowrap">3-2</td><td>Port role</td><td>role of the sending port: 01 alternate or backup, 10 root, 11 designated</td></tr>
<tr><td>4</td><td>Learning</td><td>the sending port learns MAC addresses</td></tr>
<tr><td>5</td><td>Forwarding</td><td>the sending port forwards</td></tr>
<tr><td>6</td><td>Agreement</td><td>the answer to a proposal: go ahead</td></tr>
<tr><td>7</td><td>TC Ack</td><td>only towards a neighbor that speaks classic STP: confirms its topology change report</td></tr></table>
${note('In the lab, the packet inspector shows these bits for every RST BPDU, together with the role in plain words.')}` },
      { type: 'label', title: 'The flags byte of an RST BPDU', distractors: ['Root ID', 'Max Age', 'Priority'],
        slots: [{ label: 'TC Ack', size: 'bit 7', kind: 'stp', w: 72 }, { label: 'Agreement', size: 'bit 6', kind: 'stp', w: 92 }, { label: 'Forwarding', size: 'bit 5', kind: 'stp', w: 92 },
          { label: 'Learning', size: 'bit 4', kind: 'stp', w: 86 }, { label: 'Port role', size: 'bits 3-2', kind: 'stp', w: 110 }, { label: 'Proposal', size: 'bit 1', kind: 'stp', w: 86 },
          { label: 'TC', size: 'bit 0', kind: 'stp', w: 60 }],
        explain: 'Classic STP only used the two outer bits: TC and TC Ack. RSTP fills the six bits in between. The port role is 01 alternate or backup, 10 root, 11 designated. TC Ack is only used towards a neighbor that speaks classic STP.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which port states does RSTP know?', options: ['Blocking, Listening, Forwarding', 'Discarding, Learning, Forwarding', 'Disabled, Learning, Forwarding', 'Listening, Learning, Forwarding'], correct: 1,
          explain: 'Blocking and Listening became Discarding. Learning and Forwarding stay.' },
        { q: 'A switch loses the link on its root port and has an alternate port. How long until it forwards again?', options: ['About 50 seconds', 'About 30 seconds', 'About 6 seconds', 'Practically immediately'], correct: 3,
          explain: 'The alternate port already is a loop-free path to the root. It becomes the root port and forwards at once.' },
        { q: 'What does a switch do before it answers a proposal on its root port with an agreement?', options: ['It waits 15 seconds', 'It blocks all its other non-edge designated ports (sync)', 'It asks the root', 'It flushes its MAC table only'], correct: 1 },
        { q: 'After how many missed hellos does RSTP discard the information of a neighbor?', input: ['3', 'three'], explain: 'With hello 2 s that is 6 s instead of max age 20 s.' },
        { q: 'In an RSTP network, a PC is plugged into a port without edge setting. How many seconds until the port forwards (standard timers)?', input: ['30'], unit: 'seconds',
          explain: 'The PC never answers the proposal, so only the fallback with 2 × forward delay remains.' }] }
    ] },

    { id: 'm4-l7', title: 'RSTP in the lab: from 30 seconds to zero', minutes: 20, steps: [
      { type: 'lab', title: 'Measure, switch over, measure again', topo: () => stpTriangle({ enabled: true, rootPrio: 4096, timers: 'standard', edge: true }), edit: 'config',
        intro: '<p>The triangle runs classic STP with the standard timers, the ports to the PCs are edge ports. First measure how long a failover takes, then switch to RSTP and measure again. Waiting is faster with the fast-forward button, the ping keeps counting.</p>',
        presets: { pc1: ['ping -c 50 10.0.0.2'], sw2: ['ip link set eth1 down', 'ip link set eth1 up', 'spanning-tree mode rstp', 'show spanning-tree'], sw1: ['spanning-tree mode rstp'], sw3: ['spanning-tree mode rstp'] },
        goals: [
          { text: 'Start a long ping on pc1 (ping -c 50 10.0.0.2) and cut the cable sw1–sw2 while it runs (on sw2: ip link set eth1 down).', check: sim => { const c = firstStpCut(sim); return !!c && lossAt(sim, 'pc1', c) !== null; } },
          { text: 'How many replies did that ping lose? The statistics at the end of the ping show it.', ask: true,
            expect: sim => { const n = lossAt(sim, 'pc1', firstStpCut(sim)); return n === null ? ['30'] : [n, n - 1, n + 1].map(String); } },
          { text: 'Reconnect the cable and switch all three switches to RSTP (Configuration, Protocol, or <code>spanning-tree mode rstp</code>).', check: sim => rstpOn(TRI)(sim) && linkBetween(sim, 'sw1', 'sw2')?.up },
          { text: 'Find the handshake in the log (filter: Spanning tree only): a proposal and the agreement that answers it.', check: tag(null, 'stp-agreement') },
          { text: 'Ping again and cut the same cable. This time the ping may lose at most one reply.',
            check: sim => rstpCuts(sim).some(c => { const n = lossAt(sim, 'pc1', c); return n !== null && n <= 1; }) },
          { text: 'Which role did the port of sw2 that took over have before the cut?', ask: true, expect: () => ['alternate', 'alternate port', 'altn', 'alt'] }],
        hints: ['Before the first ping, let STP converge: with the standard timers that takes 30 seconds, the fast-forward button skips them.',
          'Switching a switch to RSTP restarts its spanning tree. As long as one neighbor still speaks STP, the ports towards it use the timers.',
          'In the log, sw2 reports: "the alternate port takes over as root port immediately".'],
        outro: '<p>Same network, same cable, from about 30 lost pings to none. The alternate port had been waiting with the information that it leads to the root without a loop, so it could take over in the same moment the link died.</p>' }
    ] },

    { id: 'm4-l8', title: 'Edge ports and an old neighbor', minutes: 15, steps: [
      { type: 'lab', title: 'Find what slows RSTP down', topo: () => stpSquare({ mode: { sw1: 'rstp', sw2: 'rstp', sw3: 'rstp', sw4: 'stp' }, timers: 'standard' }), edit: 'config',
        intro: '<p>A ring of four switches, three of them run RSTP. Somewhere there is a switch that only knows classic STP, and the ports to the PCs are plain ports. Find both problems with <code>show spanning-tree</code> and the log, and fix them.</p>',
        presets: { sw1: ['show spanning-tree'], sw3: ['show spanning-tree', 'spanning-tree portfast eth5 on', 'ip link set eth5 down', 'ip link set eth5 up'], sw4: ['show spanning-tree', 'spanning-tree mode rstp'], pc1: ['ping -c 1 10.0.0.3'] },
        goals: [
          { text: 'Which switch only speaks classic STP?', ask: true, expect: () => ['sw4'], placeholder: 'e.g. sw2' },
          { text: 'On which port of a neighbor do you see it (Peer(STP) in show spanning-tree)? Name one, e.g. sw2 eth1.', ask: true, expect: () => portAnswers([['sw1', 'eth2'], ['sw3', 'eth2']]), placeholder: 'sw? eth?' },
          { text: 'Switch sw4 to RSTP. Its neighbors notice by themselves and switch their ports back.', check: sim => rstpOn(['sw4'])(sim) && sim.log.some(e => e.tag === 'stp-migrate' && e.data?.legacy === false) },
          { text: 'Make the ports to pc1 (sw1 eth5) and pc3 (sw3 eth5) edge ports.', check: sim => !!sim.dev('sw1').cfg.ports.eth5.edge && !!sim.dev('sw3').cfg.ports.eth5.edge },
          { text: 'Disconnect the cable of pc3, reconnect it and ping pc3 from pc1 right away. The port forwards immediately and the reply comes.',
            check: sim => { const up = sim.log.filter(e => e.tag === 'link-up' && e.text.includes('pc3')).pop();
              return !!up && sim.log.some(e => e.seq > up.seq && e.dev === 'sw3' && e.tag === 'stp-state' && e.data?.port === 'eth5' && e.data.edge) && pingOkAfter('pc1', '10.0.0.3', e => e === up)(sim); } },
          { text: 'Without the edge setting: how many seconds would the port of pc3 wait with the standard timers?', ask: true, expect: () => ['30'], placeholder: 'seconds' }],
        hints: ['The neighbors of an STP-only switch log: "receives a classic 802.1D BPDU … falls back to STP".', 'The edge setting is in the spanning tree section of the configuration, or: spanning-tree portfast eth5 on'],
        outro: '<p>Two classics from practice. A single old switch makes RSTP slow on all its links, and a missing edge setting makes every PC wait half a minute, even in a modern network. Real switches report the old neighbor as "Peer(STP)", and they also need a nudge to try RSTP again later: on Cisco <code>clear spanning-tree detected-protocols</code>.</p>' }
    ] }
  ]
};
