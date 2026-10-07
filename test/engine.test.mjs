import { Sim } from '../src/js/engine.js';
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name); console.log(e); process.exitCode = 1; }
}
const L = (a, ai, b, bi, mtu = 1500) => ({ id: `${a}-${ai}-${b}-${bi}`, a: { dev: a, if: ai }, b: { dev: b, if: bi }, mtu, up: true });
const pc = (id, ip, gw = '', prefix = 24, vlan = null) => ({ id, type: 'pc', name: id, x: 0, y: 0, ifaces: { eth1: { ip, prefix, vlan } }, gw });
const out = (sim, id) => sim.dev(id).consoleLines.join('\n');

test('ARP and ping across a switch', () => {
  const sim = new Sim({ devices: [pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.2'), pc('pc3', '10.0.0.3'),
    { id: 'sw1', type: 'switch', name: 'sw1' }],
  links: [L('pc1', 'eth1', 'sw1', 'eth1'), L('pc2', 'eth1', 'sw1', 'eth2'), L('pc3', 'eth1', 'sw1', 'eth3')] });
  sim.dev('pc1').ping('10.0.0.2', { count: 2 });
  sim.runToIdle();
  const o = out(sim, 'pc1');
  assert.match(o, /2 packets transmitted, 2 received/);
  assert.equal(sim.dev('sw1').bridge.table().length, 2);
  assert.ok(sim.hasTag('frame-not-mine', (d, e) => e.dev === 'pc3' && d.type === 'arp') === false, 'the broadcast is meant for pc3');
  assert.ok(sim.log.some(e => e.dev === 'pc3' && e.tag === 'arp-ignored'));
  assert.ok(!sim.log.some(e => e.dev === 'pc3' && e.tag === 'frame-not-mine'), 'pc3 does not see unicast');
  // Hub mode
  sim.dev('sw1').cfg.ageing = 0;
  sim.dev('pc1').l3.arp.clear();
  sim.dev('pc1').ping('10.0.0.2', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.log.some(e => e.dev === 'pc3' && e.tag === 'frame-not-mine' && e.data.kind === 'icmp'), 'pc3 sees ICMP in hub mode');
});

const routed = () => new Sim({ devices: [pc('pc1', '192.168.10.10', '192.168.10.1'), pc('pc3', '192.168.20.20', '192.168.20.1'),
  { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '192.168.10.1', prefix: 24 }, eth2: { ip: '192.168.20.1', prefix: 24 } } },
  { id: 'sw1', type: 'switch', name: 'sw1' }],
links: [L('pc1', 'eth1', 'sw1', 'eth1'), L('r1', 'eth1', 'sw1', 'eth4'), L('r1', 'eth2', 'pc3', 'eth1')] });

test('Ping across a router, TTL and MAC rewrite', () => {
  const sim = routed();
  sim.dev('pc1').ping('192.168.20.20', { count: 2 });
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /2 received/);
  assert.match(out(sim, 'pc1'), /ttl=63/);
  const r1 = sim.dev('r1');
  const sentOnEth2 = sim.log.find(e => e.dev === 'r1' && e.kind === 'send' && e.frame?.type === 'ipv4' && e.frame.payload.l4?.type === 8);
  assert.equal(sentOnEth2.frame.src, r1.mac('eth2'));
  assert.equal(sentOnEth2.frame.payload.ttl, 63);
});

test('Missing gateway at the destination', () => {
  const sim = routed();
  sim.dev('pc3').cfg.gw = '';
  sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /0 received/);
  assert.ok(sim.hasTag('echo-request-received'));
});

test('Netmask too large: Host Unreachable from the own host', () => {
  const sim = routed();
  sim.dev('pc1').cfg.ifaces.eth1.prefix = 16;
  sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /From 192\.168\.10\.10 icmp_seq=1 Destination Host Unreachable/);
});

test('Forwarding off', () => {
  const sim = routed();
  sim.dev('r1').cfg.forwarding = false;
  sim.dev('pc1').ping('192.168.20.1', { count: 1 });
  sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  sim.runToIdle();
  const o = out(sim, 'pc1');
  assert.match(o, /bytes from 192\.168\.20\.1/);
  assert.ok(sim.hasTag('not-forwarding'));
});

test('MTU, DF, PMTUD and fragmentation', () => {
  const sim = routed();
  sim.topo.links[2].mtu = 1400;
  sim.dev('pc1').ping('192.168.20.20', { count: 2, size: 1472, df: true });
  sim.runToIdle();
  let o = out(sim, 'pc1');
  assert.match(o, /Frag needed and DF set \(mtu = 1400\)/);
  assert.match(o, /local error: message too long, mtu=1400/);
  sim.dev('pc1').ping('192.168.20.20', { count: 1, size: 1472, df: false });
  sim.runToIdle();
  o = out(sim, 'pc1');
  assert.ok(sim.hasTag('fragmented'));
  assert.ok(sim.hasTag('reassembled'));
  assert.match(o, /1480 bytes from 192\.168\.20\.20/);
});

test('Traceroute across three routers', () => {
  const sim = new Sim({ devices: [pc('pc1', '10.0.1.10', '10.0.1.1'), pc('srv', '10.0.4.10', '10.0.4.1'),
    { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '10.0.1.1', prefix: 24 }, eth2: { ip: '10.0.12.1', prefix: 24 } }, routes: [{ dst: '0.0.0.0/0', via: '10.0.12.2' }] },
    { id: 'r2', type: 'router', name: 'r2', ifaces: { eth1: { ip: '10.0.12.2', prefix: 24 }, eth2: { ip: '10.0.23.2', prefix: 24 } }, routes: [{ dst: '10.0.1.0/24', via: '10.0.12.1' }, { dst: '10.0.4.0/24', via: '10.0.23.3' }] },
    { id: 'r3', type: 'router', name: 'r3', ifaces: { eth1: { ip: '10.0.23.3', prefix: 24 }, eth2: { ip: '10.0.4.1', prefix: 24 } }, routes: [{ dst: '0.0.0.0/0', via: '10.0.23.2' }] }],
  links: [L('pc1', 'eth1', 'r1', 'eth1'), L('r1', 'eth2', 'r2', 'eth1'), L('r2', 'eth2', 'r3', 'eth1'), L('r3', 'eth2', 'srv', 'eth1')] });
  sim.dev('pc1').traceroute('10.0.4.10');
  sim.runToIdle();
  const o = out(sim, 'pc1');
  assert.match(o, / 1 {2}10\.0\.1\.1/);
  assert.match(o, / 3 {2}10\.0\.23\.3/);
  assert.match(o, / 4 {2}10\.0\.4\.10/);
  assert.ok(sim.hasTag('trace-done', d => d.reached && d.hops === 4));
});

test('ACL blocks ICMP and creates a PMTUD blackhole', () => {
  const sim = routed();
  sim.topo.links[2].mtu = 1400;
  sim.dev('r1').cfg.acl = [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }];
  sim.dev('pc1').ping('192.168.20.20', { count: 1, size: 100 });
  sim.runToIdle();
  assert.ok(sim.hasTag('acl-drop'));
  assert.match(out(sim, 'pc1'), /0 received/);
});

function vxTopo(o = {}) {
  const vt = (id, uplink, lo, remote, nh, vni = 10010, dstport = 4789) => ({ id, type: 'vtep', name: id,
    ifaces: { eth1: { ip: uplink, prefix: 24 }, lo: { ip: lo, prefix: 32 } }, routes: [{ dst: remote + '/32', via: nh }],
    ports: { eth2: { mode: 'access', vlan: 10 } }, vxlans: [{ vni, vlan: 10, flood: [remote], dstport }] });
  return new Sim({ devices: [
    pc('srv1', '192.168.10.11'), pc('srv2', '192.168.10.12'),
    vt('vtep1', '10.0.1.2', '10.255.0.1', '10.255.0.2', '10.0.1.1'),
    vt('vtep2', '10.0.2.2', '10.255.0.2', '10.255.0.1', '10.0.2.1', o.vni2 ?? 10010, o.port2 ?? 4789),
    { id: 'core', type: 'router', name: 'core', ifaces: { eth1: { ip: '10.0.1.1', prefix: 24 }, eth2: { ip: '10.0.2.1', prefix: 24 } },
      routes: [{ dst: '10.255.0.1/32', via: '10.0.1.2' }, { dst: '10.255.0.2/32', via: '10.0.2.2' }] }],
  links: [L('vtep1', 'eth1', 'core', 'eth1', o.mtu ?? 1500), L('vtep2', 'eth1', 'core', 'eth2', o.mtu ?? 1500),
    L('srv1', 'eth1', 'vtep1', 'eth2'), L('srv2', 'eth1', 'vtep2', 'eth2')] });
}

test('VXLAN: ping across the underlay', () => {
  const sim = vxTopo();
  sim.dev('srv1').ping('192.168.10.12', { count: 2 });
  sim.runToIdle();
  assert.match(out(sim, 'srv1'), /2 received/);
  assert.ok(sim.hasTag('vxlan-encap'));
  assert.ok(sim.hasTag('vxlan-decap'));
  const onCore = sim.log.find(e => e.dev === 'core' && e.kind === 'send' && e.frame.payload.l4?.payload?.kind === 'vxlan');
  assert.equal(onCore.frame.payload.l4.dport, 4789);
  assert.equal(onCore.frame.payload.l4.payload.vni, 10010);
  assert.ok(sim.dev('vtep1').bridge.table().some(r => r.remote === '10.255.0.2'));
  assert.equal(sim.dev('core').l3.lookup('192.168.10.12'), null);
});

test('VXLAN: MTU trap and fix', () => {
  const sim = vxTopo();
  sim.dev('srv1').ping('192.168.10.12', { count: 1, size: 1472, df: true });
  sim.runToIdle();
  assert.ok(sim.hasTag('vxlan-mtu-drop'));
  assert.match(out(sim, 'srv1'), /0 received/);
  for (const l of sim.topo.links.slice(0, 2)) l.mtu = 1550;
  sim.dev('srv1').ping('192.168.10.12', { count: 1, size: 1472, df: true });
  sim.runToIdle();
  assert.match(out(sim, 'srv1'), /1480 bytes from 192\.168\.10\.12/);
});

test('VXLAN: wrong VNI and wrong port', () => {
  let sim = vxTopo({ vni2: 10011 });
  sim.dev('srv1').ping('192.168.10.12', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.hasTag('vxlan-vni-unknown'));
  sim = vxTopo({ port2: 8472 });
  sim.dev('srv2').ping('192.168.10.11', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.log.some(e => e.dev === 'vtep1' && e.tag === 'port-unreachable-sent'));
});

test('VLAN trunk between two switches', () => {
  const sw = (id, trunk) => ({ id, type: 'switch', name: id, ports: { eth1: { mode: 'access', vlan: 10 }, eth2: { mode: 'access', vlan: 20 },
    eth8: trunk ? { mode: 'trunk', allowed: '10,20', native: 1 } : { mode: 'access', vlan: 1 } } });
  const mk = trunk => new Sim({ devices: [pc('a10', '10.10.0.1'), pc('a20', '10.20.0.1'), pc('b10', '10.10.0.2'), pc('b20', '10.20.0.2'), sw('s1', trunk), sw('s2', trunk)],
    links: [L('a10', 'eth1', 's1', 'eth1'), L('a20', 'eth1', 's1', 'eth2'), L('b10', 'eth1', 's2', 'eth1'), L('b20', 'eth1', 's2', 'eth2'), L('s1', 'eth8', 's2', 'eth8')] });
  let sim = mk(false);
  sim.dev('a10').ping('10.10.0.2', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'a10'), /0 received/);
  sim = mk(true);
  sim.dev('a10').ping('10.10.0.2', { count: 1 }); sim.dev('a20').ping('10.20.0.2', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'a10'), /1 received/);
  assert.match(out(sim, 'a20'), /1 received/);
  assert.ok(sim.log.some(e => e.dev === 's1' && e.kind === 'send' && e.frame.vlan?.vid === 10));
});

test('Duplicate IP address', () => {
  const sim = new Sim({ devices: [pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.1'), pc('pc3', '10.0.0.3'), { id: 'sw1', type: 'switch', name: 'sw1' }],
    links: [L('pc1', 'eth1', 'sw1', 'eth1'), L('pc2', 'eth1', 'sw1', 'eth2'), L('pc3', 'eth1', 'sw1', 'eth3')] });
  sim.dev('pc3').ping('10.0.0.1', { count: 1 }); sim.runToIdle();
  assert.equal(sim.log.filter(e => e.tag === 'arp-reply-sent').length, 2);
});

// ---------------------------------------------------------------- newer features
const swStp = (id, prio = 32768, extra = {}) => ({ id, type: 'switch', name: id, stp: { enabled: true, priority: prio, timers: 'fast' }, ...extra });
function triangle(stp = true) {
  const mk = (id, prio) => stp ? swStp(id, prio) : { id, type: 'switch', name: id };
  return new Sim({ devices: [mk('s1', 4096), mk('s2', 32768), mk('s3', 32768), pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.2')],
    links: [L('s1', 'eth1', 's2', 'eth1'), L('s2', 'eth2', 's3', 'eth2'), L('s3', 'eth1', 's1', 'eth2'),
      L('pc1', 'eth1', 's2', 'eth5'), L('pc2', 'eth1', 's3', 'eth5')] });
}

test('STP: root election, roles and one blocked port', () => {
  const sim = triangle();
  sim.runFor(20000);
  const t1 = sim.dev('s1').bridge.stpTable(), t2 = sim.dev('s2').bridge.stpTable(), t3 = sim.dev('s3').bridge.stpTable();
  assert.ok(t1.isRoot, 's1 has the lowest priority');
  assert.equal(t2.rootPort, 'eth1'); assert.equal(t3.rootPort, 'eth1');
  assert.equal(t2.rootCost, 4);
  // s2 and s3 have the same cost to the root; exactly one port in the triangle blocks
  const alt = [...t2.ports, ...t3.ports].filter(p => p.role === 'alternate');
  assert.equal(alt.length, 1);
  const s2bid = sim.dev('s2').bridge.myId(), s3bid = sim.dev('s3').bridge.myId();
  const loser = s2bid.mac < s3bid.mac ? 's3' : 's2';
  assert.equal(sim.dev(loser).bridge.roleOf('eth2'), 'alternate');
  assert.equal(sim.dev(loser).bridge.stateOf('eth2'), 'blocking');
  assert.ok(t1.ports.every(p => p.role === 'designated' && p.state === 'forwarding'));
  sim.dev('pc1').ping('10.0.0.2', { count: 2 });
  sim.runFor(5000);
  assert.match(out(sim, 'pc1'), /2 received/);
  assert.ok(!sim.halted);
});

test('STP: without STP there is a broadcast storm', () => {
  const sim = triangle(false);
  sim.dev('pc1').ping('10.0.0.2', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.halted, 'simulation halted');
  assert.ok(sim.hasTag('loop-detected'));
  assert.ok(sim.hasTag('storm'));
});

test('STP: port states, PortFast and failure of the root port', () => {
  const sim = triangle();
  sim.runFor(1000);
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'listening');
  sim.runFor(4000);
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'learning');
  sim.runFor(5000);
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'forwarding');
  // Failure s1-s2: s2 has to go via s3, the blocked port is released
  sim.runFor(10000);
  const loser = sim.dev('s2').bridge.roleOf('eth2') === 'alternate' ? 's2' : 's3';
  sim.setLinkUp(sim.topo.links[0], false);
  sim.runFor(20000);
  assert.equal(sim.dev('s2').bridge.stpTable().rootPort, 'eth2');
  assert.equal(sim.dev('s2').bridge.stpTable().rootCost, 8);
  assert.ok(sim.hasTag('stp-tc') || sim.hasTag('stp-tc-flush'));
  assert.equal(sim.dev('s3').bridge.stateOf('eth2'), 'forwarding');
  assert.equal(sim.dev(loser).bridge.stateOf('eth2'), 'forwarding');
  sim.dev('pc1').ping('10.0.0.2', { count: 1 });
  sim.runFor(5000);
  assert.match(out(sim, 'pc1'), /1 received/);
  // Edge port
  const s = triangle();
  s.dev('s2').cfg.ports.eth5.edge = true;
  s.reset();
  s.runFor(100);
  assert.equal(s.dev('s2').bridge.stateOf('eth5'), 'forwarding');
  assert.equal(s.dev('s3').bridge.stateOf('eth5'), 'listening');
});

test('Router on a stick with subinterfaces', () => {
  const sim = new Sim({ devices: [pc('a', '10.10.0.10', '10.10.0.1'), pc('b', '10.20.0.10', '10.20.0.1'),
    { id: 'sw', type: 'switch', name: 'sw', ports: { eth1: { mode: 'access', vlan: 10 }, eth2: { mode: 'access', vlan: 20 }, eth8: { mode: 'trunk', allowed: '10,20', native: 1 } } },
    { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '', prefix: 24 }, 'eth1.10': { parent: 'eth1', vlan: 10, ip: '10.10.0.1', prefix: 24 }, 'eth1.20': { parent: 'eth1', vlan: 20, ip: '10.20.0.1', prefix: 24 } } }],
  links: [L('a', 'eth1', 'sw', 'eth1'), L('b', 'eth1', 'sw', 'eth2'), L('r1', 'eth1', 'sw', 'eth8')] });
  sim.dev('a').ping('10.20.0.10', { count: 2 });
  sim.runToIdle();
  assert.match(out(sim, 'a'), /2 received/);
  assert.match(out(sim, 'a'), /ttl=63/);
  const tagged = sim.log.filter(e => e.dev === 'r1' && e.kind === 'send' && e.frame?.vlan);
  assert.ok(tagged.some(e => e.frame.vlan.vid === 10) && tagged.some(e => e.frame.vlan.vid === 20));
  assert.equal(sim.dev('r1').mac('eth1.10'), sim.dev('r1').mac('eth1'));
  // wrong VLAN tag on the subinterface
  sim.dev('r1').cfg.ifaces['eth1.20'].vlan = 21;
  sim.dev('r1').l3.arp.clear(); sim.dev('b').l3.arp.clear();
  sim.dev('b').ping('10.20.0.1', { count: 1 });
  sim.runToIdle();
  assert.match(out(sim, 'b'), /0 received/);
  assert.ok(sim.hasTag('vlan-mismatch'));
});

const svcNet = () => new Sim({ devices: [pc('pc1', '10.0.1.10', '10.0.1.1'),
  { id: 'srv', type: 'server', name: 'srv', ifaces: { eth1: { ip: '10.0.2.10', prefix: 24 } }, gw: '10.0.2.1',
    services: [{ proto: 'tcp', port: 80, name: 'http', size: 4000 }, { proto: 'udp', port: 53, name: 'dns' }], dns: [{ name: 'web.lab', ip: '10.0.2.10' }] },
  { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '10.0.1.1', prefix: 24 }, eth2: { ip: '10.0.2.1', prefix: 24 } } }],
links: [L('pc1', 'eth1', 'r1', 'eth1'), L('r1', 'eth2', 'srv', 'eth1')] });

test('TCP: handshake, segments, teardown', () => {
  const sim = svcNet();
  sim.dev('pc1').curl('10.0.2.10', 80);
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-done', d => d.ok && d.bytes === 4000 && d.segments === 3));
  assert.ok(sim.hasTag('tcp-synack-sent'));
  assert.ok(sim.log.some(e => e.dev === 'srv' && e.tag === 'tcp-closed'));
  const syn = sim.log.find(e => e.dev === 'pc1' && e.kind === 'send' && e.frame?.payload?.l4?.flags?.SYN);
  assert.equal(syn.frame.payload.l4.mss, 1460);
  assert.match(out(sim, 'pc1'), /HTTP\/1\.1 200 OK/);
  assert.equal(sim.dev('pc1').l3.tcp.size, 0);
  assert.equal(sim.dev('srv').l3.tcp.size, 0);
  // smaller MTU: smaller MSS, more segments
  sim.topo.links[1].mtu = 1000;
  sim.dev('pc1').curl('10.0.2.10', 80);
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-response', d => d.mss === 960 && d.segments === 5));
});

test('TCP: closed port, filter and reject', () => {
  let sim = svcNet();
  sim.dev('pc1').ncz('10.0.2.10', 22);
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-refused'));
  assert.match(out(sim, 'pc1'), /Connection refused/);
  sim = svcNet();
  sim.dev('r1').cfg.acl = [{ action: 'drop', proto: 'tcp', port: 80, src: 'any', dst: 'any' }];
  sim.dev('pc1').ncz('10.0.2.10', 80);
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-timeout'));
  assert.equal(sim.log.filter(e => e.tag === 'tcp-syn-sent').length, 3);
  assert.match(out(sim, 'pc1'), /timed out/);
  sim = svcNet();
  sim.dev('r1').cfg.acl = [{ action: 'reject', proto: 'tcp', port: 80, src: 'any', dst: 'any' }];
  sim.dev('pc1').curl('10.0.2.10', 80);
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-refused'));
  sim.dev('r1').cfg.acl = [{ action: 'reject', proto: 'udp', port: 53, src: 'any', dst: 'any' }];
  sim.dev('pc1').dig('10.0.2.10', 'web.lab');
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /communications error/);
});

test('UDP and DNS', () => {
  const sim = svcNet();
  sim.dev('pc1').dig('10.0.2.10', 'web.lab');
  sim.runToIdle();
  assert.ok(sim.hasTag('dns-done', d => d.ok && d.answer === '10.0.2.10'));
  assert.match(out(sim, 'pc1'), /web\.lab\.\s+300\s+IN\s+A\s+10\.0\.2\.10/);
  sim.dev('pc1').dig('10.0.2.10', 'doesnotexist.lab');
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /NXDOMAIN/);
  sim.dev('pc1').dig('10.0.1.1', 'web.lab');
  sim.runToIdle();
  assert.ok(sim.log.some(e => e.dev === 'r1' && e.tag === 'port-unreachable-sent'));
  sim.dev('pc1').udpSend('10.0.2.10', 53, 20);
  sim.runToIdle();
  sim.dev('pc1').udpSend('10.0.2.10', 5000, 20);
  sim.runToIdle();
  assert.ok(sim.hasTag('udp-received'));
  assert.match(out(sim, 'pc1'), /Port Unreachable/);
});

test('Gratuitous ARP, DAD and NUD', () => {
  const sim = new Sim({ devices: [pc('cl', '10.0.0.5'), pc('a', '10.0.0.10'), pc('b', '10.0.0.11'), { id: 'sw', type: 'switch', name: 'sw' }],
    links: [L('cl', 'eth1', 'sw', 'eth1'), L('a', 'eth1', 'sw', 'eth2'), L('b', 'eth1', 'sw', 'eth3')] });
  sim.dev('cl').ping('10.0.0.10', { count: 1 });
  sim.runToIdle();
  assert.equal(sim.dev('cl').l3.arp.get('10.0.0.10').mac, sim.dev('a').mac('eth1'));
  // The address moves to b (as in a failover)
  sim.dev('a').cfg.ifaces.eth1.ip = '10.0.0.99';
  sim.dev('b').cfg.ifaces.eth1.ip = '10.0.0.10';
  sim.dev('b').arping('10.0.0.10', { mode: 'gratuitous', count: 1 });
  sim.runToIdle();
  assert.ok(sim.hasTag('garp-updated', d => d.ip === '10.0.0.10'));
  assert.equal(sim.dev('cl').l3.arp.get('10.0.0.10').mac, sim.dev('b').mac('eth1'));
  assert.ok(sim.log.some(e => e.dev === 'a' && e.tag === 'garp-ignored'));
  // DAD
  sim.dev('a').arping('10.0.0.11', { mode: 'dad' });
  sim.runToIdle();
  assert.ok(sim.hasTag('arping-done', d => d.mode === 'dad' && d.replies === 0));
  sim.dev('a').arping('10.0.0.10', { mode: 'dad' });
  sim.runToIdle();
  assert.ok(sim.hasTag('dad-reply'));
  assert.ok(sim.hasTag('arping-done', d => d.mode === 'dad' && d.replies > 0));
  // NUD: without GARP the old entry stays until the check fails
  const s2 = new Sim({ devices: [pc('cl', '10.0.0.5'), pc('a', '10.0.0.10'), pc('b', '10.0.0.11'), { id: 'sw', type: 'switch', name: 'sw' }],
    links: [L('cl', 'eth1', 'sw', 'eth1'), L('a', 'eth1', 'sw', 'eth2'), L('b', 'eth1', 'sw', 'eth3')] });
  s2.dev('cl').ping('10.0.0.10', { count: 1 }); s2.runToIdle();
  s2.dev('a').cfg.ifaces.eth1.ip = '';
  s2.dev('b').cfg.ifaces.eth1.ip = '10.0.0.10';
  s2.runFor(31000);
  s2.dev('cl').ping('10.0.0.10', { count: 15 });
  s2.runToIdle();
  assert.ok(s2.hasTag('nud-probe'));
  assert.ok(s2.hasTag('nud-failed'));
  const done = s2.log.find(e => e.tag === 'ping-done');
  assert.ok(done.data.received > 0 && done.data.received < 15, 'after the failover, replies come back');
});

test('TCP: PMTUD, blackhole and MSS clamping', () => {
  const mk = () => new Sim({ devices: [pc('pc1', '10.0.1.10', '10.0.1.1'),
    { id: 'srv', type: 'server', name: 'srv', ifaces: { eth1: { ip: '10.0.2.10', prefix: 24 } }, gw: '10.0.2.1', services: [{ proto: 'tcp', port: 80, name: 'http', size: 5000 }] },
    { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '10.0.1.1', prefix: 24 }, eth2: { ip: '10.0.12.1', prefix: 24 } }, routes: [{ dst: '0.0.0.0/0', via: '10.0.12.2' }] },
    { id: 'r2', type: 'router', name: 'r2', ifaces: { eth1: { ip: '10.0.12.2', prefix: 24 }, eth2: { ip: '10.0.23.2', prefix: 24 } }, routes: [{ dst: '10.0.1.0/24', via: '10.0.12.1' }, { dst: '10.0.2.0/24', via: '10.0.23.3' }] },
    { id: 'fw', type: 'router', name: 'fw', ifaces: { eth1: { ip: '10.0.23.3', prefix: 24 }, eth2: { ip: '10.0.2.1', prefix: 24 } }, routes: [{ dst: '0.0.0.0/0', via: '10.0.23.2' }] }],
  links: [L('pc1', 'eth1', 'r1', 'eth1'), L('r1', 'eth2', 'r2', 'eth1', 1400), L('r2', 'eth2', 'fw', 'eth1'), L('fw', 'eth2', 'srv', 'eth1')] });
  let sim = mk();
  sim.dev('pc1').curl('10.0.2.10');
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-retransmit', d => d.mss === 1360));
  assert.ok(sim.hasTag('tcp-done', d => d.ok && d.bytes === 5000));
  sim = mk();
  sim.dev('fw').cfg.acl = [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }];
  sim.dev('pc1').curl('10.0.2.10');
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-established'));
  assert.ok(sim.hasTag('tcp-stalled'));
  assert.match(out(sim, 'pc1'), /Operation timed out/);
  sim.dev('r1').cfg.mssClamp = 1360;
  sim.dev('pc1').curl('10.0.2.10');
  sim.runToIdle();
  assert.ok(sim.hasTag('mss-clamped'));
  assert.ok(sim.hasTag('tcp-done', d => d.ok && d.segments === 4));
});


// ---------------------------------------------------------------- services: DHCP, NAT, VRRP, OSPF, line quality
const R = (id, ifaces, extra = {}) => ({ id, type: 'router', name: id, ifaces: Object.fromEntries(Object.entries(ifaces).map(([k, v]) => [k, { ip: v.split('/')[0], prefix: Number(v.split('/')[1]) }])), ...extra });

test('DHCP: DORA on the same segment, then through a relay', () => {
  const pool = { net: '10.10.0.0/24', from: '10.10.0.100', to: '10.10.0.101', router: '10.10.0.1', dns: '10.20.0.53' };
  let sim = new Sim({ devices: [{ id: 'c', type: 'pc', name: 'c', ifaces: { eth1: { dhcp: true } } },
    { id: 'd', type: 'server', name: 'd', ifaces: { eth1: { ip: '10.10.0.2', prefix: 24 } }, dhcpServer: { enabled: true, pools: [pool] } }],
  links: [L('c', 'eth1', 'd', 'eth1')] });
  sim.runFor(3000);
  assert.equal(sim.dev('c').l3.lease.ip, '10.10.0.100');
  assert.equal(sim.dev('c').l3.lookup('8.8.8.8').via, '10.10.0.1', 'default route from DHCP');
  assert.equal(sim.dev('c').l3.resolver(), '10.20.0.53');
  assert.match(out(sim, 'c'), /DHCPACK of 10\.10\.0\.100/);
  // Relay
  sim = new Sim({ devices: [{ id: 'c', type: 'pc', name: 'c', ifaces: { eth1: { dhcp: true } } },
    { id: 'd', type: 'server', name: 'd', ifaces: { eth1: { ip: '10.20.0.67', prefix: 24 } }, gw: '10.20.0.1', dhcpServer: { enabled: true, pools: [pool] } },
    R('r', { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' })], links: [L('c', 'eth1', 'r', 'eth1'), L('r', 'eth2', 'd', 'eth1')] });
  sim.runFor(15000);
  assert.ok(sim.hasTag('dhcp-failed'), 'without a relay no answer');
  assert.ok(!sim.log.some(e => e.tag === 'port-unreachable-sent'), 'no ICMP errors for broadcasts');
  sim.dev('r').cfg.ifaces.eth1.helper = '10.20.0.67';
  sim.dev('c').dhclient('eth1'); sim.runFor(3000);
  assert.equal(sim.dev('c').l3.lease?.ip, '10.10.0.100');
  assert.ok(sim.hasTag('dhcp-relayed', d => d.op === 'DISCOVER'));
  sim.dev('c').ping('10.20.0.67', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'c'), /1 received/);
  sim.dev('c').dhcpRelease('eth1'); sim.runFor(500);
  assert.equal(sim.dev('c').l3.lease, null);
  assert.equal(sim.dev('d').l3.dhcpLeases.size, 0);
});

const natNet = () => {
  const sim = new Sim({ devices: [pc('in1', '192.168.1.10', '192.168.1.1'), pc('in2', '192.168.1.11', '192.168.1.1'),
    R('gw', { eth1: '192.168.1.1/24', eth2: '203.0.113.2/30' }, { routes: [{ dst: 'default', via: '203.0.113.1' }], nat: { outside: 'eth2', masquerade: true, forwards: [{ proto: 'tcp', port: 8080, to: '192.168.1.10', toPort: 80 }] } }),
    R('isp', { eth1: '203.0.113.1/30', eth2: '198.51.100.1/24' }), { id: 'web', type: 'server', name: 'web', ifaces: { eth1: { ip: '198.51.100.80', prefix: 24 } }, gw: '198.51.100.1' },
    { id: 'sw', type: 'switch', name: 'sw' }],
  links: [L('in1', 'eth1', 'sw', 'eth1'), L('in2', 'eth1', 'sw', 'eth2'), L('gw', 'eth1', 'sw', 'eth3'), L('gw', 'eth2', 'isp', 'eth1'), L('isp', 'eth2', 'web', 'eth1')] });
  sim.dev('in1').cfg.services = [{ proto: 'tcp', port: 80, name: 'http', size: 1000 }];
  return sim;
};
test('NAT: masquerade, port reuse, port forward and ICMP errors', () => {
  const sim = natNet();
  sim.dev('in1').ping('198.51.100.80', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'in1'), /1 received/);
  assert.ok(sim.log.some(e => e.dev === 'web' && e.tag === 'echo-request-received' && e.data.from === '203.0.113.2'), 'web only sees the outside address');
  sim.dev('in1').curl('198.51.100.80', 80); sim.dev('in2').curl('198.51.100.80', 80); sim.runToIdle();
  assert.equal(sim.log.filter(e => e.tag === 'tcp-done' && e.data.ok).length, 2);
  assert.ok(sim.dev('isp').l3.lookup('192.168.1.10') === null, 'the ISP does not know the private network');
  sim.dev('web').curl('203.0.113.2', 8080); sim.runToIdle();
  assert.ok(sim.hasTag('nat-new', d => d.kind === 'forward'));
  assert.match(out(sim, 'web'), /1000 bytes received/);
  sim.dev('in1').traceroute('198.51.100.80'); sim.runToIdle();
  assert.ok(sim.hasTag('trace-done', d => d.reached && d.hops === 3), 'traceroute works through NAT');
  sim.dev('web').ping('192.168.1.10', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'web'), /0 received/);
});

test('VRRP: master election, virtual MAC and failover', () => {
  const sim = new Sim({ devices: [pc('h', '10.0.0.10', '10.0.0.1'), { id: 'sw', type: 'switch', name: 'sw' },
    R('ra', { eth1: '10.0.0.2/24', eth2: '10.9.0.1/24' }, { vrrp: [{ ifname: 'eth1', vrid: 7, vip: '10.0.0.1', priority: 110 }] }),
    R('rb', { eth1: '10.0.0.3/24', eth2: '10.9.0.2/24' }, { vrrp: [{ ifname: 'eth1', vrid: 7, vip: '10.0.0.1', priority: 100 }] }),
    { id: 's', type: 'server', name: 's', ifaces: { eth1: { ip: '10.9.0.9', prefix: 24 } } }, { id: 'sw2', type: 'switch', name: 'sw2' }],
  links: [L('h', 'eth1', 'sw', 'eth1'), L('ra', 'eth1', 'sw', 'eth2'), L('rb', 'eth1', 'sw', 'eth3'), L('ra', 'eth2', 'sw2', 'eth1'), L('rb', 'eth2', 'sw2', 'eth2'), L('s', 'eth1', 'sw2', 'eth3')] });
  sim.dev('s').cfg.vrrp = undefined;
  sim.runFor(5000);
  assert.deepEqual(sim.dev('ra').vrrp.table().map(g => g.state), ['master']);
  assert.deepEqual(sim.dev('rb').vrrp.table().map(g => g.state), ['backup']);
  sim.dev('h').ping('10.0.0.1', { count: 1 }); sim.runFor(3000);
  assert.equal(sim.dev('h').l3.arp.get('10.0.0.1').mac, '00:00:5e:00:01:07');
  assert.match(out(sim, 'h'), /1 received/);
  assert.ok(!sim.log.some(e => e.dev !== 'ra' && e.dev !== 'rb' && /hello|vrrp/.test(e.tag || '') && e.kind !== 'send'), 'hosts ignore advertisements');
  sim.setLinkUp(sim.topo.links[1], false); sim.runFor(4000);
  assert.equal(sim.dev('rb').vrrp.table()[0].state, 'master');
  assert.equal(sim.dev('sw').bridge.table().find(e => e.mac === '00:00:5e:00:01:07').port, 'eth3', 'switch learned the virtual MAC on the new port');
  sim.dev('h').ping('10.9.0.9', { count: 1 }); sim.runFor(3000);
  assert.match(out(sim, 'h'), /1 received/);
  sim.setLinkUp(sim.topo.links[1], true); sim.runFor(6000);
  assert.equal(sim.dev('ra').vrrp.table()[0].state, 'master', 'preemption: the higher priority takes over again');
  assert.equal(sim.dev('rb').vrrp.table()[0].state, 'backup');
});

const ospfTri = (o = {}) => {
  const oi = (t, ...n) => ({ enabled: true, timers: t, ifaces: Object.fromEntries(n.map(x => [x, { enabled: true, cost: 10 }])) });
  return new Sim({ devices: [R('o1', { eth1: '10.0.12.1/24', eth2: '10.0.13.1/24', eth3: '10.1.0.1/24' }, { ospf: oi('fast', 'eth1', 'eth2', 'eth3') }),
    R('o2', { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, { ospf: oi(o.t2 || 'fast', 'eth1', 'eth2') }),
    R('o3', { eth1: '10.0.13.3/24', eth2: '10.0.23.3/24', eth3: '10.3.0.1/24' }, { ospf: oi('fast', 'eth1', 'eth2', 'eth3') }),
    pc('p1', '10.1.0.10', '10.1.0.1'), pc('p3', '10.3.0.10', '10.3.0.1')],
  links: [L('o1', 'eth1', 'o2', 'eth1'), L('o1', 'eth2', 'o3', 'eth1'), L('o2', 'eth2', 'o3', 'eth2'), L('o1', 'eth3', 'p1', 'eth1'), L('o3', 'eth3', 'p3', 'eth1')] });
};
test('OSPF: adjacencies, SPF, reroute after a failure', () => {
  const sim = ospfTri();
  sim.runFor(6000);
  assert.deepEqual(sim.dev('o1').ospf.neighborTable().map(n => n.state), ['Full', 'Full']);
  const r = sim.dev('o1').l3.lookup('10.3.0.10');
  assert.equal(r.proto, 'O'); assert.equal(r.via, '10.0.13.3'); assert.equal(r.metric, 20);
  sim.dev('p1').ping('10.3.0.10', { count: 1 }); sim.runFor(3000);
  assert.match(out(sim, 'p1'), /1 received/);
  sim.setLinkUp(sim.topo.links[1], false); sim.runFor(2000);
  const r2 = sim.dev('o1').l3.lookup('10.3.0.10');
  assert.equal(r2.via, '10.0.12.2'); assert.equal(r2.metric, 30);
  sim.dev('p1').ping('10.3.0.10', { count: 1 }); sim.runFor(3000);
  assert.match(out(sim, 'p1'), /2 received|1 received, 0%[\s\S]*1 received/);
  // A static route wins over OSPF for the same prefix (distance 1 instead of 110)
  sim.dev('o1').cfg.routes = [{ dst: '10.3.0.0/24', via: '10.0.12.2' }];
  assert.equal(sim.dev('o1').l3.lookup('10.3.0.10').proto, 'S');
});
test('OSPF: mismatched timers prevent the adjacency', () => {
  const sim = ospfTri({ t2: 'standard' });
  sim.runFor(15000);
  assert.ok(sim.hasTag('ospf-mismatch', d => d.what === 'timers'));
  assert.ok(!sim.dev('o2').ospf.neighborTable().some(n => n.state === 'Full'));
  assert.ok(sim.dev('o1').ospf.neighborTable().some(n => n.rid === '10.3.0.1' && n.state === 'Full'));
});

test('Line quality: latency, loss and TCP retransmission', () => {
  const sim = new Sim({ devices: [pc('a', '10.0.0.1'), { ...pc('b', '10.0.0.2'), services: [{ proto: 'tcp', port: 80, name: 'http', size: 20000 }] }],
    links: [{ ...L('a', 'eth1', 'b', 'eth1'), delay: 20 }] });
  sim.dev('a').ping('10.0.0.2', { count: 2 }); sim.runToIdle();
  assert.match(out(sim, 'a'), /time=40\.\d+ ms/);
  sim.topo.links[0].loss = 20;
  sim.dev('a').ping('10.0.0.2', { count: 20 }); sim.runToIdle();
  assert.ok(sim.hasTag('link-loss'));
  const d = sim.log.filter(e => e.tag === 'ping-done').pop().data;
  assert.ok(d.received > 5 && d.received < 20, `some pings lost (${d.received}/20)`);
  sim.dev('a').curl('10.0.0.2', 80); sim.runToIdle();
  assert.ok(sim.hasTag('tcp-done', x => x.ok && x.bytes === 20000), 'TCP gets everything through despite the loss');
  assert.ok(sim.hasTag('tcp-rto') || sim.hasTag('tcp-dupack'));
});

// ---------------------------------------------------------------- RSTP
function rtriangle(modes = {}, timers = 'standard') {
  const mk = (id, prio) => ({ id, type: 'switch', name: id, stp: { enabled: true, mode: modes[id] || 'rstp', priority: prio, timers } });
  return new Sim({ devices: [mk('s1', 4096), mk('s2', 32768), mk('s3', 32768), pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.2')],
    links: [L('s1', 'eth1', 's2', 'eth1'), L('s2', 'eth2', 's3', 'eth2'), L('s3', 'eth1', 's1', 'eth2'),
      L('pc1', 'eth1', 's2', 'eth5'), L('pc2', 'eth1', 's3', 'eth5')] });
}
const lost = (sim, from) => { const d = sim.log.filter(e => e.tag === 'ping-done' && e.dev === from).pop().data; return d.sent - d.received; };

test('RSTP: proposal and agreement converge in milliseconds, same tree as STP', () => {
  const sim = rtriangle();
  sim.runFor(50);
  const t2 = sim.dev('s2').bridge.stpTable(), t3 = sim.dev('s3').bridge.stpTable();
  assert.equal(t2.mode, 'rstp');
  assert.equal(t2.rootPort, 'eth1'); assert.equal(t3.rootPort, 'eth1');
  const links = [['s1', 'eth1'], ['s1', 'eth2'], ['s2', 'eth1'], ['s3', 'eth1']];
  for (const [d, p] of links) assert.equal(sim.dev(d).bridge.stateOf(p), 'forwarding', `${d} ${p} forwards after 50 ms`);
  const alt = [...t2.ports, ...t3.ports].filter(p => p.role === 'alternate');
  assert.equal(alt.length, 1); assert.equal(alt[0].state, 'discarding');
  assert.ok(sim.hasTag('stp-agreement')); assert.ok(sim.hasTag('stp-sync'));
  // RST BPDUs: version 2, 36 bytes, with role and flags
  const b = sim.log.find(e => e.tag === 'bpdu-sent' && e.frame.payload.proposal);
  assert.equal(b.frame.payload.version, 2); assert.equal(b.frame.payload.role, 'designated');
  // Ports to the PCs are not edge ports: without an agreement only the timers help (2 x 15 s)
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'discarding');
  sim.runFor(15000); assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'learning');
  sim.runFor(15100); assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'forwarding');
});

test('RSTP: the alternate port takes over without losing a ping', () => {
  const sim = rtriangle();
  sim.runFor(31000);
  const loser = sim.dev('s2').bridge.roleOf('eth2') === 'alternate' ? 's2' : 's3';
  const cut = loser === 's2' ? sim.topo.links[0] : sim.topo.links[2];
  sim.dev('pc1').ping('10.0.0.2', { count: 10 }); sim.runFor(3500);
  sim.setLinkUp(cut, false); sim.runFor(10000);
  assert.equal(sim.dev(loser).bridge.stpTable().rootPort, 'eth2');
  assert.equal(lost(sim, 'pc1'), 0);
  assert.ok(sim.log.some(e => e.tag === 'stp-tc' && e.data.rstp), 'topology change flooded by the switch itself');
  // The same with classic STP: about 30 seconds of outage
  const old = rtriangle({ s1: 'stp', s2: 'stp', s3: 'stp' });
  old.runFor(31000);
  const l2 = old.dev('s2').bridge.roleOf('eth2') === 'alternate' ? old.topo.links[0] : old.topo.links[2];
  old.dev('pc1').ping('10.0.0.2', { count: 40 }); old.runFor(3000);
  old.setLinkUp(l2, false); old.runFor(45000);
  assert.ok(lost(old, 'pc1') >= 25, `classic STP loses about 30 pings (${lost(old, 'pc1')})`);
});

test('RSTP: indirect failure, a classic STP neighbor and switching back', () => {
  // Indirect: the switch that loses its root port has no alternate, its neighbor reacts at once
  const sim = rtriangle();
  sim.runFor(31000);
  const loser = sim.dev('s2').bridge.roleOf('eth2') === 'alternate' ? 's2' : 's3';
  const other = loser === 's2' ? 's3' : 's2';
  const cut = other === 's2' ? sim.topo.links[0] : sim.topo.links[2];
  sim.setLinkUp(cut, false); sim.runFor(100);
  assert.equal(sim.dev(other).bridge.stpTable().rootPort, 'eth2', `${other} reaches the root via ${loser} within 100 ms`);
  assert.equal(sim.dev(loser).bridge.stateOf('eth2'), 'forwarding');
  // Classic neighbor: s3 speaks 802.1D, the ports towards it fall back and use the timers
  const mix = rtriangle({ s3: 'stp' });
  mix.runFor(1000);
  assert.ok(mix.dev('s1').bridge.stpTable().ports.find(p => p.port === 'eth2').legacy);
  assert.ok(mix.hasTag('stp-rst-ignored') && mix.hasTag('stp-migrate'));
  assert.notEqual(mix.dev('s1').bridge.stateOf('eth2'), 'forwarding');
  mix.runFor(31000);
  assert.equal(mix.dev('s1').bridge.stateOf('eth2'), 'forwarding');
  mix.dev('s3').cfg.stp.mode = 'rstp'; mix.configChanged('s3'); mix.runFor(5000);
  assert.ok(!mix.dev('s1').bridge.stpTable().ports.find(p => p.port === 'eth2').legacy, 's1 switches back to RSTP');
  assert.equal(mix.dev('s3').bridge.stpTable().mode, 'rstp');
  // Edge port forwards at once
  const e = rtriangle(); e.dev('s2').cfg.ports.eth5.edge = true; e.reset(); e.runFor(10);
  assert.equal(e.dev('s2').bridge.stateOf('eth5'), 'forwarding');
});

console.log(`\n${passed} tests passed`);
