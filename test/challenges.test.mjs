// Every troubleshooting variant must be broken at the start and solvable with the intended fix
import { Sim } from '../src/js/engine.js';
import { CHALLENGES, challengeTopo } from '../src/js/challenges.js';
import { runCommand } from '../src/js/cli.js';
import assert from 'node:assert/strict';

const run = (sim, dev, cmd, ms = 15000) => { runCommand(sim.dev(dev), cmd); sim.runFor(ms); };
const cfg = (sim, id) => sim.dev(id).cfg;
const changed = (sim, id) => sim.configChanged(id);
const linkOf = (sim, a, b) => sim.topo.links.find(l => (l.a.dev === a && l.b.dev === b) || (l.a.dev === b && l.b.dev === a));

// What the learner does to test: triggers the symptom (and after the fix, the success)
const TRY = {
  gateway: sim => run(sim, 'pc1', 'ping -c 1 192.168.20.20'),
  oneway: sim => run(sim, 'pc1', 'ping -c 1 10.0.4.10'),
  storm: sim => { sim.runFor(12000); run(sim, 'pc1', 'ping -c 1 10.0.0.2'); },
  vlan: sim => { run(sim, 'a20', 'ping -c 1 10.20.0.2'); run(sim, 'a10', 'ping -c 1 10.10.0.2'); },
  dhcp: sim => { run(sim, 'client1', 'dhclient', 16000); run(sim, 'client2', 'dhclient', 16000); },
  nat: sim => run(sim, 'pc1', 'curl http://198.51.100.80/'),
  dns: sim => run(sim, 'client', 'curl http://web.lab/', 20000),
  ospf: sim => { sim.runFor(8000); run(sim, 'pc1', 'ping -c 1 10.3.0.10'); run(sim, 'pc2', 'ping -c 1 10.3.0.10'); },
  vrrp: sim => { sim.runFor(8000); runCommand(sim.dev('pc1'), 'ping -c 40 10.50.0.5'); sim.runFor(3000); runCommand(sim.dev('ra'), 'ip link set eth1 down'); sim.runFor(40000); },
  slow: sim => run(sim, 'client', 'curl http://web.lab/', 60000),
  mtu: sim => run(sim, 'client', 'curl http://10.0.2.80/', 30000),
  rstp: sim => { sim.runFor(35000); runCommand(sim.dev('pc1'), 'ping -c 40 10.0.0.3'); sim.runFor(3000); runCommand(sim.dev('sw3'), `ip link set ${sim.dev('sw3').bridge.stpTable().rootPort} down`); sim.runFor(45000); }
};
const FIX = {
  gateway: [sim => { cfg(sim, 'pc1').gw = '192.168.10.1'; }, sim => { cfg(sim, 'pc1').gw = '192.168.10.1'; }, sim => { cfg(sim, 'pc1').ifaces.eth1.prefix = 24; sim.dev('pc1').l3.arp.clear(); }],
  oneway: [sim => { cfg(sim, 'r2').routes.push({ dst: '10.0.1.0/24', via: '10.0.12.1' }); }, sim => { cfg(sim, 'r3').routes = [{ dst: '0.0.0.0/0', via: '10.0.23.2' }]; }, sim => { cfg(sim, 'srv1').gw = '10.0.4.1'; }],
  storm: [sim => { sim.reset(); for (const id of ['sw1', 'sw2', 'sw3']) { cfg(sim, id).stp.enabled = true; changed(sim, id); } }, sim => { sim.reset(); for (const id of ['sw2', 'sw3']) { cfg(sim, id).stp.enabled = true; changed(sim, id); } }],
  vlan: [sim => { cfg(sim, 's2').ports.eth8.allowed = '10,20'; }, sim => { cfg(sim, 's1').ports.eth2 = { ...cfg(sim, 's1').ports.eth2, mode: 'access', vlan: 20 }; }, sim => { cfg(sim, 's1').ports.eth8.allowed = '10,20'; }],
  dhcp: [sim => { cfg(sim, 'r1').ifaces.eth1.helper = '10.20.0.67'; }, sim => { cfg(sim, 'r1').ifaces.eth1.helper = '10.20.0.67'; }, sim => { cfg(sim, 'dhcp').dhcpServer.pools[0].net = '10.10.0.0/24'; }],
  nat: [sim => { cfg(sim, 'home').nat.outside = 'eth2'; }, sim => { cfg(sim, 'home').routes = [{ dst: '0.0.0.0/0', via: '203.0.113.1' }]; }, sim => { cfg(sim, 'home').nat.masquerade = true; }],
  dns: [sim => { cfg(sim, 'client').resolver = '10.20.0.53'; }, sim => { cfg(sim, 'dns').dns.push({ name: 'web.lab', ip: '10.20.0.80' }); }, sim => { cfg(sim, 'r1').acl = []; }],
  ospf: [sim => { cfg(sim, 'o3').ospf.ifaces.eth3.enabled = true; changed(sim, 'o3'); }, sim => { cfg(sim, 'o3').ospf.timers = 'fast'; changed(sim, 'o3'); },
    sim => { cfg(sim, 'o3').ospf.ifaces.eth1.passive = false; cfg(sim, 'o3').ospf.ifaces.eth2.passive = false; changed(sim, 'o3'); }],
  vrrp: [sim => { cfg(sim, 'rb').vrrp[0].ifname = 'eth1'; changed(sim, 'rb'); }, sim => { cfg(sim, 'rb').ospf.ifaces.eth1.enabled = true; changed(sim, 'rb'); },
    sim => { cfg(sim, 'rb').vrrp = [{ ifname: 'eth1', vrid: 1, vip: '10.0.0.1', priority: 100, preempt: true }]; changed(sim, 'rb'); }],
  slow: [sim => { delete linkOf(sim, 'r1', 'sw1').loss; }, sim => { const l = linkOf(sim, 'client', 'r1'); delete l.loss; delete l.delay; }],
  mtu: [sim => { cfg(sim, 'r1').mssClamp = 1360; }, sim => { cfg(sim, 'fw').acl.unshift({ action: 'allow', proto: 'icmp', icmpType: 3, src: 'any', dst: 'any' }); }],
  rstp: [sim => { cfg(sim, 'sw3').stp.mode = 'rstp'; changed(sim, 'sw3'); },
    sim => { for (const id of ['sw2', 'sw4']) if (cfg(sim, id).stp.mode !== 'rstp') { cfg(sim, id).stp.mode = 'rstp'; changed(sim, id); } }]
};
const met = (c, sim) => c.goals.every(g => g.check(sim, { inspected: [] }));

let n = 0, bad = 0;
for (const c of CHALLENGES) {
  assert.ok(TRY[c.id] && FIX[c.id], `test data for ${c.id}`);
  c.variants.forEach((v, vi) => {
    n++;
    try {
      const broken = new Sim(challengeTopo(c, vi));
      TRY[c.id](broken);
      assert.ok(!met(c, broken), 'goal is already met although the fault is there');
      const sim = new Sim(challengeTopo(c, vi));
      sim.runFor(2000);
      FIX[c.id][vi](sim);
      for (const d of sim.devices.values()) d.onConfig?.();
      TRY[c.id](sim);
      c.goals.forEach((g, gi) => assert.ok(g.check(sim, { inspected: [] }), `goal ${gi + 1} not met after the fix: ${g.text.replace(/<[^>]+>/g, '')}`));
      console.log('ok  ', `${c.id}#${vi + 1}`, c.title);
    } catch (e) { bad++; console.log('FAIL', `${c.id}#${vi + 1}`, e.message); process.exitCode = 1; }
  });
}
console.log(`\n${n - bad} of ${n} challenge variants broken at the start and solvable`);
