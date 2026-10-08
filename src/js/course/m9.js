import { bar, note, pingOk } from './helpers.js';
import { vrrpTopo } from '../presets.js';

const stateOf = (sim, id) => sim.dev(id).vrrp?.table()[0]?.state;
const master = sim => ['ra', 'rb'].find(id => stateOf(sim, id) === 'master');
// Ping answered after the master lost its LAN cable
const survives = sim => {
  const cut = sim.log.find(e => e.tag === 'link-down' && /ra eth1/.test(e.text));
  return !!cut && stateOf(sim, 'rb') === 'master' && sim.log.some(e => e.seq > cut.seq && e.dev === 'pc1' && e.tag === 'echo-reply-received');
};

export default {
  id: 'm9', title: 'A gateway that does not fail: VRRP', bands: ['eth', 'ip', 'rt'],
  text: 'Two routers share one gateway address and one virtual MAC. When the master fails, the backup takes over within seconds, and the hosts notice nothing.',
  lessons: [
    { id: 'm9-l1', title: 'One address, two routers', minutes: 10, steps: [
      { type: 'theory', title: 'The gateway as a single point of failure', html: `
<p>Every host knows exactly one default gateway. If that router fails, the whole network is cut off, no matter how many other routers there are. A second router alone does not help: the hosts would all have to change their gateway.</p>
<p>The <b>Virtual Router Redundancy Protocol</b> (VRRP, RFC 5798) solves this with a <b>virtual router</b>: an IP address and a MAC address that do not belong to a single device. Several routers form a group, one of them is <b>master</b> and answers for the virtual address, the others wait as <b>backup</b>.</p>
<table><tr><th>Term</th><th>Meaning</th></tr>
<tr><td>VRID</td><td>Number of the group, 1 to 255</td></tr>
<tr><td>Virtual IP</td><td>The address the hosts use as their gateway</td></tr>
<tr><td>Virtual MAC</td><td><code>00:00:5e:00:01:</code> followed by the VRID in hex. The master answers ARP requests for the virtual IP with it.</td></tr>
<tr><td>Priority</td><td>1 to 254, the highest becomes master. With equal priority, the higher interface address wins.</td></tr>
<tr><td>Advertisement</td><td>The master sends one every second to 224.0.0.18, IP protocol 112</td></tr>
<tr><td>Preempt</td><td>A router with a higher priority takes the master role back when it returns</td></tr></table>
${bar([['Ethernet', 'src 00:00:5e:00:01:01', 'eth', 1.6], ['IPv4 → 224.0.0.18', 'proto 112, TTL 255', 'ip', 1.6], ['VRRP', 'VRID, priority, virtual IP', 'rt', 2]], 'A VRRP advertisement: the master sends it with the virtual MAC as its source, so the switches always know where the virtual MAC is.')}
<h2>The takeover</h2>
<p>If the backups miss about three advertisements, the one with the highest priority becomes master. It sends a <b>gratuitous ARP</b> for the virtual IP with the virtual MAC, and the switches learn its new port. The hosts do not have to do anything: their ARP entry for the gateway (virtual IP → virtual MAC) stays the same.</p>
${note('On Linux, keepalived implements VRRP. By default it uses the router\'s own MAC and updates the hosts with gratuitous ARPs, only with <code>use_vmac</code> does it use the virtual MAC. Cisco\'s HSRP follows the same idea with its own MAC range (<code>0000.0c07.acXX</code>) and with preempt off by default. On the routers, the LAN interface also keeps its own address: the virtual IP comes on top.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which virtual MAC address does VRRP group 5 use?', input: ['00:00:5e:00:01:05', '0000.5e00.0105', '00-00-5e-00-01-05'] },
        { q: 'ra has priority 110, rb priority 100. Which router is master?', options: ['ra', 'rb', 'The one that started first'], correct: 0 },
        { q: 'After a failover, what do the hosts have to change?', options: ['Their default gateway', 'Their ARP entry for the gateway', 'Nothing, IP and MAC of the gateway stay the same'], correct: 2 }] }
    ] },

    { id: 'm9-l2', title: 'Failover in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Pull the master\'s cable', topo: () => vrrpTopo(), edit: 'config',
        intro: '<p>pc1 and pc2 use 10.0.0.1 as gateway. Nobody owns that address: ra and rb form VRRP group 1. Behind them, core learns the way back to 10.0.0.0/24 via OSPF from both routers.</p>',
        presets: { pc1: ['ping -c 30 10.50.0.5', 'ip neigh'], ra: ['show vrrp', 'ip link set eth1 down'], rb: ['show vrrp'], sw1: ['bridge fdb'] },
        goals: [
          { text: 'Which router is master?', ask: true, expect: sim => [master(sim)].filter(Boolean) },
          { text: 'pc1 reaches the server 10.50.0.5.', check: pingOk('pc1', '10.50.0.5') },
          { text: 'Which MAC address does pc1 have for its gateway 10.0.0.1? (ip neigh)', ask: true, expect: () => ['00:00:5e:00:01:01'] },
          { text: 'Start a long ping on pc1 and disconnect ra from sw1 while it runs. rb takes over and the ping continues.', check: survives },
          { text: 'How did sw1 learn the new port of the virtual MAC? Find rb\'s gratuitous ARP in the log and click it.', check: (sim, ctx) => ctx.inspected.some(e => e.frame?.type === 'arp' && e.frame.payload.spa === '10.0.0.1' && e.frame.payload.tpa === '10.0.0.1') }],
        hints: ['ip link set eth1 down on ra, or click the cable between ra and sw1 and uncheck "Link up".', 'Turn the speed up while waiting: rb takes over after about three missed advertisements.'],
        outro: '<p>A few pings were lost while rb waited for the missing advertisements, then everything went on as before. pc1 kept the same ARP entry the whole time. Reconnect ra: with its higher priority and preempt it becomes master again.</p>' }
    ] },

    { id: 'm9-l3', title: 'Configure the second router', minutes: 12, steps: [
      { type: 'lab', title: 'Add rb to the group', topo: () => vrrpTopo({ vrrpB: false }), edit: 'config',
        intro: '<p>So far only ra runs VRRP, so it is master without competition. Add rb to group 1 and then decide with the priority who carries the traffic.</p>',
        presets: { rb: ['show vrrp'], ra: ['show vrrp'], pc1: ['ping -c 3 10.50.0.5', 'ip neigh'] },
        goals: [
          { text: 'On rb, add VRRP group 1 on eth1 with the virtual IP 10.0.0.1 and priority 100.', check: sim => (sim.dev('rb').vrrp?.table() || []).some(g => g.vrid === 1 && g.vip === '10.0.0.1' && g.state !== 'init') },
          { text: 'In which state is rb now?', ask: true, expect: sim => [stateOf(sim, 'rb')].filter(Boolean) },
          { text: 'Give rb the priority 120. It takes over the master role.', check: sim => stateOf(sim, 'rb') === 'master' && stateOf(sim, 'ra') === 'backup' },
          { text: 'pc1 still reaches the server.', check: sim => sim.log.some(e => e.dev === 'pc1' && e.tag === 'ping-done' && e.data.received > 0 && stateOf(sim, 'rb') === 'master') },
          { text: 'Did pc1 have to learn a new MAC address for its gateway? (yes or no)', ask: true, expect: () => ['no'] }],
        hints: ['Configuration → VRRP on rb, "+ Group". Interface eth1, group 1, virtual IP 10.0.0.1.', 'With preempt on, the router with the higher priority ignores the advertisements of a lower master and takes over when its master down timer runs out, after about three advertisement intervals.'],
        outro: '<p>Priorities decide who is master in normal operation, for example the router with the faster uplink. In real networks, the priority is often lowered automatically when the uplink fails (tracking), so the other router takes over.</p>' }
    ] }
  ]
};

