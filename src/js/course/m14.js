import { note, tag, inspected, pingOk } from './helpers.js';
import { bgpPairTopo, ibgpTopo, bgpMultiTopo } from '../presets.js';
import { macFor } from '../net.js';
const M = (id, port) => macFor(id + '/' + port);

const isUpdate = f => f.type === 'ipv4' && f.payload.l4?.bgp?.type === 'UPDATE' && f.payload.l4.bgp.nlri?.length > 0;
const failed = (from, to) => tag(from, 'ping-done', d => d.dst === to && d.received === 0);
const up = (dev, peer) => tag(dev, 'bgp-state', d => d.peer === peer && d.state === 'Established');
const traceVia = (from, hop) => tag(from, 'trace-done', d => (d.path || []).includes(hop) && d.reached);

export default {
  id: 'm14', title: 'BGP: routing between networks', bands: ['tcp', 'rt'],
  text: 'How the internet routes between tens of thousands of networks: autonomous systems, eBGP and iBGP, the next hop, route reflectors and policy with local preference and AS path prepending.',
  lessons: [
    { id: 'm14-l1', title: 'Autonomous systems and eBGP', minutes: 15, steps: [
      { type: 'theory', title: 'The protocol of the internet', html: `
<p>OSPF finds the shortest path inside one network you control. Between networks of different owners that is the wrong question: a provider does not want to carry the traffic of a competitor, a company with two providers wants to decide which one it uses. And the internet has about a million prefixes. This is the job of <b>BGP</b> (Border Gateway Protocol).</p>
<h2>Autonomous systems</h2>
<p>Every network under one administration is an <b>autonomous system</b> (AS) with a number: 3303 Swisscom, 13335 Cloudflare. Private AS numbers 64512 to 65534 are free for internal use, like 10.0.0.0/8 for addresses.</p>
<table><tr><th>Session</th><th>Between</th><th>Example</th></tr>
<tr><td><b>eBGP</b> (external)</td><td>routers in different ASes</td><td>your edge router and your provider</td></tr>
<tr><td><b>iBGP</b> (internal)</td><td>routers in the same AS</td><td>your two edge routers, to share what they learned</td></tr></table>
<h2>A path vector protocol</h2>
<p>BGP does not count hops or costs. Every route carries the list of ASes it passed, the <b>AS_PATH</b>. Each router that passes a route to an eBGP neighbor puts its own AS in front. A router that finds its own AS in a path drops it: that is the loop protection. All else equal, the shortest AS path wins.</p>
<pre>10.2.0.0/24   AS_PATH 65002          learned directly from AS 65002
10.2.0.0/24   AS_PATH 65100 65002    the same network, one AS further away</pre>
<h2>Sessions over TCP</h2>
<p>BGP runs over <b>TCP port 179</b>: reliable, ordered, no own retransmission needed. Neighbors are configured by hand, there is no discovery. Four messages:</p>
<table><tr><th>Message</th><th>Content</th></tr>
<tr><td>OPEN</td><td>my AS, router ID, hold time, capabilities</td></tr>
<tr><td>KEEPALIVE</td><td>"still here", every hold time / 3</td></tr>
<tr><td>UPDATE</td><td>new networks with their attributes, or withdrawn networks</td></tr>
<tr><td>NOTIFICATION</td><td>an error, then the session closes</td></tr></table>
<p>The states of a session: <b>Idle</b> → <b>Connect</b> (TCP is being opened) or <b>Active</b> (waiting for the neighbor) → <b>OpenSent</b> → <b>OpenConfirm</b> → <b>Established</b>. Only in Established are routes exchanged.</p>
${note('BGP announces a network only if it is in the own routing table with exactly that prefix: <code>network 10.1.0.0/24</code> does nothing if the router only knows 10.1.0.0/16.')}` },
      { type: 'stack', title: 'A session comes up', hint: 'From the first packet to the first route. The top is the first message.',
        items: [{ name: 'r1 → r2: TCP SYN to port 179', kind: 'tcp' }, { name: 'r2 → r1: SYN, ACK', kind: 'tcp' }, { name: 'r1 → r2: ACK', kind: 'tcp' },
          { name: 'r1 → r2: OPEN (AS 65001)', kind: 'rt' }, { name: 'r2 → r1: OPEN (AS 65002)', kind: 'rt' }, { name: 'r1 → r2: KEEPALIVE', kind: 'rt' },
          { name: 'r2 → r1: KEEPALIVE, both Established', kind: 'rt' }, { name: 'UPDATE: 10.1.0.0/24, AS_PATH 65001', kind: 'rt' }],
        explain: 'First TCP, then the OPENs, each confirmed with a KEEPALIVE. Only then do the UPDATEs carry the networks.' },
      { type: 'build', title: 'Build the OPEN of r1', blocks: ['eth', 'ip', 'icmp', 'udp', 'tcp', 'bgp', 'data'],
        task: '<p>r1 (AS 65001, 10.0.12.1 on eth2) has opened the TCP connection to its eBGP neighbor r2 (10.0.12.2, AS 65002). Build the frame with the OPEN message r1 sends next.</p>',
        addresses: { mac: [[M('r1', 'eth2'), 'r1 eth2'], [M('r2', 'eth1'), 'r2 eth1'], [M('r1', 'eth1'), 'r1 eth1 (LAN)']], ip: [['10.0.12.1', 'r1 eth2'], ['10.0.12.2', 'r2 eth1'], ['10.1.0.1', 'r1 LAN'], ['10.2.0.1', 'r2 LAN']] },
        expected: [
          { block: 'eth', fields: { dst: M('r2', 'eth1'), src: M('r1', 'eth2'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.0.12.1', dst: '10.0.12.2', proto: '6', ttl: '1' } },
          { block: 'tcp', fields: { sport: { range: [1024, 65535] }, dport: '179', flags: 'PSH,ACK' } },
          { block: 'bgp', fields: { type: 'OPEN' } }],
        explain: 'eBGP sends with TTL 1: the neighbor must be directly connected, a packet from further away would never arrive. r1 opened the connection, so it uses an ephemeral source port and the destination port 179.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which port does BGP use?', input: ['179', 'tcp 179'] },
        { q: 'r3 in AS 65003 receives 10.9.0.0/24 with AS_PATH 65002 65003 65001. What does it do?', options: ['Install it', 'Drop it: its own AS is in the path (loop)', 'Shorten the path', 'Send a NOTIFICATION'], correct: 1 },
        { q: 'A session stays in "Active". What does that mean?', options: ['Everything is fine', 'The router waits for the TCP connection of its neighbor, it is not up', 'Routes are being exchanged', 'The neighbor sent an error'], correct: 1,
          explain: 'Active sounds good, but it means: not established yet. Only Established exchanges routes.' },
        { q: 'Why does the internet use BGP and not OSPF between providers?', options: ['BGP is faster', 'Each AS decides with policy which routes it takes and passes on; OSPF only knows shortest paths in one network', 'OSPF cannot do IPv4', 'BGP needs no configuration'], correct: 1 }] }
    ] },

    { id: 'm14-l2', title: 'eBGP in the lab', minutes: 18, steps: [
      { type: 'lab', title: 'Two companies exchange their networks', topo: () => bgpPairTopo({ r2: false }), edit: 'config',
        intro: '<p>r1 belongs to AS 65001 and is configured: neighbor 10.0.12.2 in AS 65002, network 10.1.0.0/24. On r2 (AS 65002), BGP is still off.</p>',
        presets: { r1: ['show ip bgp summary', 'show ip bgp', 'show ip route'], r2: ['show ip bgp summary', 'show ip bgp'], pc1: ['ping -c 2 10.2.0.10'] },
        goals: [
          { text: 'Look at <code>show ip bgp summary</code> on r1. Which state does the neighbor 10.0.12.2 have?', ask: true, expect: () => ['active', 'connect', 'idle'], placeholder: 'state' },
          { text: 'Turn on BGP on r2: AS 65002, neighbor 10.0.12.1 with remote AS 65001, network 10.2.0.0/24. The session comes up.', check: up('r1', '10.0.12.2') },
          { text: 'pc1 pings srv2 (10.2.0.10).', check: pingOk('pc1', '10.2.0.10') },
          { text: 'Which AS path does r1 see for 10.2.0.0/24?', ask: true, expect: () => ['65002', '65002 i'] },
          { text: 'Click a BGP UPDATE in the log and look at its attributes in the packet inspector.', check: inspected(isUpdate) }],
        hints: ['BGP is under Configuration on r2: Add a feature, BGP.', 'In the log of r1 you see the TCP connection being refused while r2 has BGP off.', 'Networks are entered as 10.2.0.0/24.'],
        outro: '<p>Without BGP on r2, nobody listened on TCP 179: r1 got a reset and stayed in Active. With both sides configured, the session went through OpenSent and OpenConfirm to Established, and each router announced its network with its own AS in the path.</p>' }
    ] },

    { id: 'm14-l3', title: 'iBGP and the next hop', minutes: 15, steps: [
      { type: 'theory', title: 'Carrying external routes through your AS', html: `
<p>A company or provider has several routers. The edge router r1 learns the internet from its provider over eBGP. The other routers inside the AS need these routes too: they get them over <b>iBGP</b>. Three rules make iBGP different:</p>
<h2>1. The next hop stays</h2>
<p>An eBGP router puts its own address as next hop. Over iBGP the next hop is passed on <b>unchanged</b>: r3 learns "198.51.100.0/24 via 192.0.2.1", the address of the provider. r3 does not know 192.0.2.1, so the route is <b>inaccessible</b> and is not installed. Two fixes:</p>
<ul><li><code>next-hop-self</code> on r1 towards its iBGP neighbors: r1 puts its own address.</li>
<li>Or announce the link to the provider in the IGP (OSPF).</li></ul>
<h2>2. iBGP split horizon</h2>
<p>A route learned over iBGP is <b>never passed on to another iBGP neighbor</b>. Inside an AS the AS path does not grow, so loops would go unnoticed. Consequence: every iBGP router needs a session to every other one (<b>full mesh</b>), n·(n-1)/2 sessions. With 100 routers that is 4950.</p>
<p>The way out is a <b>route reflector</b>: a router that may pass iBGP routes on to its <i>clients</i>. It adds ORIGINATOR_ID and CLUSTER_LIST so that a route never comes back to where it started.</p>
<h2>3. Sessions between loopbacks</h2>
<p>iBGP neighbors are usually not directly connected. They peer between their <b>loopback addresses</b>, which OSPF carries through the AS. If one link fails, OSPF finds another way and the session stays up. For that, the session must start from the loopback: <code>update-source lo</code>. Without it, the neighbor sees a connection from an unknown address and refuses it.</p>
<table><tr><th>Source of the route</th><th>Administrative distance</th></tr>
<tr><td>eBGP</td><td>20 (better than OSPF)</td></tr>
<tr><td>OSPF</td><td>110</td></tr>
<tr><td>iBGP</td><td>200 (worse than OSPF)</td></tr></table>
${note('The IGP (OSPF) carries the loopbacks and links of the own AS. BGP carries everything else, including all external routes. Never redistribute the full BGP table into OSPF.', true)}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'r1 learns 8.8.8.0/24 from its provider (next hop 192.0.2.1) and passes it to r3 over iBGP. Which next hop does r3 see without next-hop-self?', input: ['192.0.2.1'] },
        { q: 'r1, r2 and r3 are in the same AS. r1 peers with r2, r2 with r3, no route reflector. Does r3 learn the routes r1 sends to r2?', options: ['Yes', 'No: r2 does not pass iBGP routes to other iBGP neighbors'], correct: 1 },
        { q: 'How many iBGP sessions does a full mesh of 5 routers need?', input: ['10'] },
        { q: 'What is update-source lo for?', options: ['Faster convergence', 'The session uses the loopback address, so it survives the failure of a single link', 'It encrypts the session', 'It sets the next hop'], correct: 1 }] }
    ] },

    { id: 'm14-l4', title: 'iBGP in the lab', minutes: 20, steps: [
      { type: 'lab', title: 'The routes arrive, but they are not used', topo: () => ibgpTopo({ nhs: false }), edit: 'config',
        intro: '<p>AS 65001 has three routers. OSPF carries the loopbacks 10.255.0.1 to .3, iBGP runs as a full mesh between them, r1 talks eBGP to the provider (AS 65100). r1 has no next-hop-self yet.</p>',
        presets: { pc3: ['ping -c 2 198.51.100.80', 'traceroute 198.51.100.80'], r3: ['show ip bgp', 'show ip bgp 198.51.100.0/24', 'show ip route', 'show ip bgp summary'], r1: ['show ip bgp summary', 'show ip bgp neighbors 10.255.0.3 advertised-routes'] },
        goals: [
          { text: 'pc3 pings the web server 198.51.100.80. It does not work.', check: failed('pc3', '198.51.100.80') },
          { text: 'r3 knows the network 198.51.100.0/24 from BGP. What does <code>show ip bgp</code> on r3 say about its next hop?', ask: true, expect: () => ['inaccessible', 'not reachable', 'unreachable'] },
          { text: 'Fix it on r1, so that pc3 reaches the web server.', check: pingOk('pc3', '198.51.100.80') },
          { text: 'Which next hop does r3 now have for 198.51.100.0/24?', ask: true, expect: () => ['10.255.0.1'] },
          { text: 'Which administrative distance does this route have in <code>show ip route</code> on r3?', ask: true, expect: () => ['200'] }],
        hints: ['192.0.2.1 is the provider\'s address. OSPF in AS 65001 does not know that link.', 'On r1: Configuration, BGP, check next-hop-self for both iBGP neighbors (10.255.0.2 and 10.255.0.3).'],
        outro: '<p>With next-hop-self, r1 announces itself (its loopback, the source of the session) as next hop. r3 finds 10.255.0.1 through OSPF and installs the route recursively: BGP says where, OSPF says how. The 200 shows it is an iBGP route; an eBGP route would have 20.</p>' }
    ] },

    { id: 'm14-l5', title: 'Route reflector', minutes: 15, steps: [
      { type: 'lab', title: 'Without a full mesh', topo: () => ibgpTopo({ fullMesh: false }), edit: 'config',
        intro: '<p>The same AS, but r1 and r3 have no session with each other: both only peer with r2 in the middle. Next-hop-self is configured on r1.</p>',
        presets: { pc3: ['ping -c 2 198.51.100.80'], r2: ['show ip bgp', 'show ip bgp summary'], r3: ['show ip bgp summary', 'show ip bgp'], isp: ['show ip bgp'] },
        goals: [
          { text: 'pc3 pings the web server. It does not work.', check: failed('pc3', '198.51.100.80') },
          { text: 'How many prefixes does r3 receive from r2? (show ip bgp summary on r3)', ask: true, expect: () => ['0'] },
          { text: 'Make r2 a route reflector with r1 and r3 as its clients. pc3 reaches the web server.', check: pingOk('pc3', '198.51.100.80') },
          { text: 'Which attribute does r2 add so that it can recognize a reflected route that comes back to the router it started at?', ask: true, expect: () => ['originator_id', 'originator id', 'originator-id', 'cluster_list', 'cluster list', 'cluster-list'] }],
        hints: ['r2 has the route of the provider, but iBGP split horizon forbids passing it to r3.', 'On r2: Configuration, BGP, check "RR client" for both neighbors.', 'Click a reflected UPDATE from r2 in the log.'],
        outro: '<p>Without a reflector, r2 knew everything but kept it to itself: iBGP split horizon. As a route reflector it passes routes between its clients and marks them with ORIGINATOR_ID and CLUSTER_LIST. Large networks have a few reflectors instead of a full mesh.</p>' }
    ] },

    { id: 'm14-l6', title: 'Policy: choosing the way out and in', minutes: 20, steps: [
      { type: 'theory', title: 'Best path selection and how to influence it', html: `
<p>If a router knows several paths to a network, it compares them in a fixed order. The first difference decides:</p>
<table><tr><th>#</th><th>Criterion</th><th>Better</th></tr>
<tr><td>1</td><td>Weight (only on this router)</td><td>higher</td></tr>
<tr><td>2</td><td><b>LOCAL_PREF</b> (inside the AS)</td><td>higher</td></tr>
<tr><td>3</td><td>Originated by this router</td><td>yes</td></tr>
<tr><td>4</td><td><b>AS_PATH</b> length</td><td>shorter</td></tr>
<tr><td>5</td><td>Origin (IGP, EGP, incomplete)</td><td>IGP</td></tr>
<tr><td>6</td><td><b>MED</b> (only from the same neighbor AS)</td><td>lower</td></tr>
<tr><td>7</td><td>eBGP over iBGP</td><td>eBGP</td></tr>
<tr><td>8</td><td>IGP metric to the next hop</td><td>lower</td></tr>
<tr><td>9</td><td>Router ID, neighbor address</td><td>lower</td></tr></table>
<h2>The way out: local preference</h2>
<p>You decide which exit your own traffic takes. Set <b>local preference</b> higher on the routes from the provider you prefer (e.g. 200 instead of the default 100). It is passed to all iBGP neighbors, so the whole AS agrees, and it wins before the AS path length is even looked at.</p>
<h2>The way in: AS path prepending and MED</h2>
<p>How the others reach you is <i>their</i> decision. You can only make one path less attractive: put your own AS several times into the path towards the provider you want to avoid (<b>prepending</b>): <code>65001 65001 65001</code> looks three ASes long. MED is a softer hint, which only works between two connections to the same neighbor AS.</p>
${note('Changing the way out does not change the way back: traffic can leave through provider 2 and return through provider 1. Asymmetric routing is normal on the internet, but stateful firewalls at the edge do not like it.', true)}` },
      { type: 'lab', title: 'The cheaper provider', topo: () => bgpMultiTopo(), edit: 'config',
        intro: '<p>AS 65001 has two providers: provider 1 (AS 65100, at r1) and provider 2 (AS 65200, at r3). The web server is at provider 1. Provider 2 is cheaper, so management wants all outgoing traffic to use it.</p>',
        presets: { pc2: ['traceroute 198.51.100.80'], r2: ['show ip bgp', 'show ip bgp 198.51.100.0/24'], r3: ['show ip bgp 198.51.100.0/24'], isp1: ['show ip bgp 10.2.0.0/24'] },
        goals: [
          { text: 'traceroute from pc2 to the web server. Through which of our edge routers does it go?', ask: true, expect: () => ['r1'] },
          { text: 'Why does r2 prefer that path? (show ip bgp 198.51.100.0/24 on r2 shows the reason)', ask: true, expect: () => ['as path length', 'as path', 'as-path', 'shorter as path', 'as_path'] },
          { text: 'Make the whole AS leave through provider 2: give its routes a higher local preference on r3. Then traceroute again.', check: traceVia('pc2', '10.0.23.3') },
          { text: 'Now look at isp1: <code>show ip bgp 10.2.0.0/24</code>. Through which AS do the answers come back to us?', ask: true, expect: () => ['65001', 'directly', 'r1', 'via r1', 'as 65001'] },
          { text: 'Make provider 1 send the answers through provider 2 as well: prepend AS 65001 twice towards provider 1 on r1. isp1 then prefers the path via AS 65200.', check: sim => (sim.dev('isp1')?.bgp?.table() || []).some(r => r.prefix === '10.2.0.0/24' && r.best && r.asPath[0] === 65200) }],
        hints: ['Local preference is an inbound setting: on r3, neighbor 192.0.2.5 (provider 2), "In: local pref" 200.', 'Prepending is outbound: on r1, neighbor 192.0.2.1, "prepend" 2.', 'Every change takes effect at once (like a soft reset), the sessions stay up.'],
        outro: '<p>Local preference beat the shorter AS path because it comes earlier in the selection, and r3 told the whole AS about it over iBGP. For the way in you could only make the other path look worse: with prepending, provider 1 saw 65001 65001 65001 and preferred the path through provider 2.</p>' }
    ] }
  ]
};
