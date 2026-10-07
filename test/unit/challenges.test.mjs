// Every troubleshooting variant must be broken at the start and solvable with the intended fix
import { Sim } from '../../src/js/engine.js';
import { CHALLENGES, challengeTopo } from '../../src/js/challenges.js';
import { runCommand } from '../../src/js/cli.js';
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
  dnstree: sim => { run(sim, 'client', 'curl http://www.firma.lab/', 20000); run(sim, 'client', 'dig portal.partner.lab', 20000); },
  dnsstale: sim => run(sim, 'client', 'curl http://www.firma.lab/', 30000),
  ipv6slaac: sim => { sim.runFor(5000); run(sim, 'pc1', 'ping -6 -c 1 2001:db8:2::80', 6000); },
  ipv6route: sim => { sim.runFor(5000); run(sim, 'pc1', 'ping -6 -c 1 2001:db8:2::80', 8000); },
  ipv6dual: sim => { sim.runFor(5000); run(sim, 'pc1', 'curl http://www.lab/', 25000); },
  vpn: sim => { sim.runFor(1000); run(sim, 'pcA', 'ping -c 2 10.2.0.10', 30000); },
  bgpebgp: sim => { sim.runFor(10000); run(sim, 'pc1', 'ping -c 1 10.2.0.10', 5000); },
  bgpibgp: sim => { sim.runFor(15000); run(sim, 'pc3', 'ping -c 1 198.51.100.80', 5000); },
  bgppolicy: sim => { sim.runFor(15000); run(sim, 'pc2', 'traceroute 198.51.100.80', 10000); },
  evpn: sim => { sim.runFor(8000); run(sim, 'srv1', 'ping -c 1 192.168.10.13', 4000); run(sim, 'srv2', 'ping -c 1 192.168.10.13', 4000); },
  ospf: sim => { sim.runFor(8000); run(sim, 'pc1', 'ping -c 1 10.3.0.10'); run(sim, 'pc2', 'ping -c 1 10.3.0.10'); },
  vrrp: sim => { sim.runFor(8000); runCommand(sim.dev('pc1'), 'ping -c 40 10.50.0.5'); sim.runFor(3000); runCommand(sim.dev('ra'), 'ip link set eth1 down'); sim.runFor(40000); },
  slow: sim => run(sim, 'client', 'curl http://web.lab/', 60000),
  mtu: sim => run(sim, 'client', 'curl http://10.0.2.80/', 30000),
  ecmp: sim => { sim.runFor(12000); run(sim, 'c1', 'ping -c 1 10.4.0.10'); run(sim, 'c2', 'ping -c 1 10.4.0.10'); },
  bfd: sim => { sim.runFor(15000); runCommand(sim.dev('pc1'), 'ping -c 40 10.2.0.10'); sim.runFor(3500); linkOf(sim, 'prov', 'r2').loss = 100; sim.runFor(50000); },
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
  dnstree: [sim => { cfg(sim, 'nic').dns.push({ name: 'firma.lab', type: 'NS', value: 'ns1.firma.lab', ttl: 86400 }); runCommand(sim.dev('resolver'), 'unbound-control flush_all'); },
    sim => { cfg(sim, 'nic').dns.find(r => r.name === 'ns1.firma.lab').ip = '203.0.113.53'; runCommand(sim.dev('resolver'), 'unbound-control flush_all'); },
    sim => { cfg(sim, 'resolver').recursion.roots = '198.41.0.4'; }, sim => { cfg(sim, 'r1').acl = []; }, sim => { cfg(sim, 'ns1').dnsZone = 'firma.lab'; }, sim => { cfg(sim, 'client').resolver = '10.1.0.53'; }],
  dnsstale: [sim => runCommand(sim.dev('resolver'), 'unbound-control flush_all'), sim => { cfg(sim, 'ns1').dns.find(r => r.name === 'www.firma.lab').ip = '203.0.113.81'; },
    sim => { cfg(sim, 'ns1').dns = cfg(sim, 'ns1').dns.filter(r => !(r.name === 'www.firma.lab' && r.ip === '203.0.113.80')); }],
  ipv6slaac: [sim => { cfg(sim, 'r1').ipv6.ra = ['eth1']; changed(sim, 'r1'); }, sim => { cfg(sim, 'r1').ipv6.ra = ['eth1']; changed(sim, 'r1'); },
    sim => { cfg(sim, 'r1').ifaces.eth1.ip6 = ['2001:db8:1::1/64']; changed(sim, 'r1'); }, sim => { cfg(sim, 'pc1').ipv6.slaac = true; changed(sim, 'pc1'); }],
  ipv6route: [sim => { cfg(sim, 'r2').routes.push({ dst: '2001:db8:1::/64', via: '2001:db8:12::1' }); }, sim => { cfg(sim, 'r1').routes.find(r => String(r.dst).includes(':')).via = '2001:db8:12::2'; },
    sim => { cfg(sim, 'web').ipv6.gw = '2001:db8:2::1'; }, sim => { cfg(sim, 'r2').ipv6.enabled = true; changed(sim, 'r2'); }],
  ipv6dual: [sim => { cfg(sim, 'dns').dns.find(r => r.type === 'AAAA').ip = '2001:db8:2::80'; }, sim => { cfg(sim, 'web').ifaces.eth1.ip6 = ['2001:db8:2::80/64']; cfg(sim, 'web').ipv6.enabled = true; changed(sim, 'web'); },
    sim => { cfg(sim, 'web').ipv6.gw = '2001:db8:2::1'; }],
  vpn: [sim => { cfg(sim, 'gwB').wg.peers[0].publicKey = sim.dev('gwA').wg.pub; changed(sim, 'gwB'); }, sim => { cfg(sim, 'gwA').wg.peers[0].publicKey = sim.dev('gwB').wg.pub; changed(sim, 'gwA'); },
    sim => { cfg(sim, 'gwA').wg.peers[0].endpoint = '203.0.113.1:51820'; changed(sim, 'gwA'); }, sim => { cfg(sim, 'gwB').wg.peers[0].allowedIps = '10.99.0.1/32, 10.1.0.0/24'; changed(sim, 'gwB'); },
    sim => { cfg(sim, 'gwA').wg.peers[0].allowedIps = '10.99.0.2/32, 10.2.0.0/24'; changed(sim, 'gwA'); }, sim => { cfg(sim, 'isp').acl = []; }],
  bgpebgp: [sim => { cfg(sim, 'r2').bgp.neighbors[0].remoteAs = 65001; changed(sim, 'r2'); }, sim => { cfg(sim, 'r2').bgp.neighbors[0].ip = '10.0.12.1'; changed(sim, 'r2'); },
    sim => { cfg(sim, 'r2').bgp.networks = ['10.2.0.0/24']; changed(sim, 'r2'); }, sim => { cfg(sim, 'r1').bgp.neighbors[0].ip = '10.0.12.2'; changed(sim, 'r1'); }],
  bgpibgp: [sim => { for (const n of cfg(sim, 'r1').bgp.neighbors) if (n.remoteAs === 65001) n.nextHopSelf = true; changed(sim, 'r1'); },
    sim => { cfg(sim, 'r3').bgp.neighbors.find(n => n.ip === '10.255.0.1').updateSource = 'lo'; changed(sim, 'r3'); },
    sim => { cfg(sim, 'r3').bgp.networks = ['10.3.0.0/24']; changed(sim, 'r3'); }, sim => { cfg(sim, 'r1').ospf.ifaces.lo = { enabled: true, cost: 10, passive: true }; changed(sim, 'r1'); },
    sim => { cfg(sim, 'isp').bgp.neighbors[0].remoteAs = 65001; changed(sim, 'isp'); }],
  bgppolicy: [sim => { cfg(sim, 'r3').bgp.neighbors.find(n => n.ip === '192.0.2.5').localPref = 200; changed(sim, 'r3'); },
    sim => { cfg(sim, 'r3').bgp.neighbors.find(n => n.ip === '192.0.2.5').localPref = 200; changed(sim, 'r3'); },
    sim => { cfg(sim, 'r1').bgp.neighbors.find(n => n.ip === '192.0.2.1').localPref = ''; changed(sim, 'r1'); }],
  evpn: [sim => { cfg(sim, 'vtep3').vxlans[0].vni = 10010; changed(sim, 'vtep3'); }, sim => { for (const n of cfg(sim, 'spine').bgp.neighbors) n.rrClient = true; changed(sim, 'spine'); },
    sim => { cfg(sim, 'spine').bgp.neighbors.find(n => n.ip === '10.255.0.3').evpn = true; changed(sim, 'spine'); }, sim => { cfg(sim, 'vtep3').routes = [{ dst: '10.255.0.0/24', via: '10.0.3.1' }]; changed(sim, 'vtep3'); },
    sim => { cfg(sim, 'vtep3').vxlans[0].evpn = true; changed(sim, 'vtep3'); }],
  ospf: [sim => { cfg(sim, 'o3').ospf.ifaces.eth3.enabled = true; changed(sim, 'o3'); }, sim => { cfg(sim, 'o3').ospf.timers = 'fast'; changed(sim, 'o3'); },
    sim => { cfg(sim, 'o3').ospf.ifaces.eth1.passive = false; cfg(sim, 'o3').ospf.ifaces.eth2.passive = false; changed(sim, 'o3'); }],
  vrrp: [sim => { cfg(sim, 'rb').vrrp[0].ifname = 'eth1'; changed(sim, 'rb'); }, sim => { cfg(sim, 'rb').ospf.ifaces.eth1.enabled = true; changed(sim, 'rb'); },
    sim => { cfg(sim, 'rb').vrrp = [{ ifname: 'eth1', vrid: 1, vip: '10.0.0.1', priority: 100, preempt: true }]; changed(sim, 'rb'); }],
  slow: [sim => { delete linkOf(sim, 'r1', 'sw1').loss; }, sim => { const l = linkOf(sim, 'client', 'r1'); delete l.loss; delete l.delay; }],
  mtu: [sim => { cfg(sim, 'r1').mssClamp = 1360; }, sim => { cfg(sim, 'fw').acl.unshift({ action: 'allow', proto: 'icmp', icmpType: 3, src: 'any', dst: 'any' }); }],
  ecmp: [sim => { cfg(sim, 'r1').maxPaths = 4; changed(sim, 'r1'); },
    sim => { cfg(sim, 'r1').ospf.ifaces.eth2.cost = 10; changed(sim, 'r1'); },
    sim => { cfg(sim, 'r3').ospf.ifaces.eth2.cost = 10; changed(sim, 'r3'); }],
  bfd: [sim => { cfg(sim, 'r2').bfd.enabled = true; changed(sim, 'r2'); },
    sim => { for (const id of ['r1', 'r2']) { cfg(sim, id).bfd.ospf = true; changed(sim, id); } },
    sim => { cfg(sim, 'r2').bfd = { enabled: true, interval: 300, mult: 3, ospf: true }; changed(sim, 'r2'); }],
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
