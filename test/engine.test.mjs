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

test('ARP und Ping über einen Switch', () => {
  const sim = new Sim({ devices: [pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.2'), pc('pc3', '10.0.0.3'),
    { id: 'sw1', type: 'switch', name: 'sw1' }],
  links: [L('pc1', 'eth1', 'sw1', 'eth1'), L('pc2', 'eth1', 'sw1', 'eth2'), L('pc3', 'eth1', 'sw1', 'eth3')] });
  sim.dev('pc1').ping('10.0.0.2', { count: 2 });
  sim.runToIdle();
  const o = out(sim, 'pc1');
  assert.match(o, /2 gesendet, 2 empfangen/);
  assert.equal(sim.dev('sw1').bridge.table().length, 2);
  assert.ok(sim.hasTag('frame-not-mine', (d, e) => e.dev === 'pc3' && d.type === 'arp') === false, 'Broadcast ist für pc3 bestimmt');
  assert.ok(sim.log.some(e => e.dev === 'pc3' && e.tag === 'arp-ignored'));
  assert.ok(!sim.log.some(e => e.dev === 'pc3' && e.tag === 'frame-not-mine'), 'pc3 sieht keinen Unicast');
  // Hub-Modus
  sim.dev('sw1').cfg.ageing = 0;
  sim.dev('pc1').l3.arp.clear();
  sim.dev('pc1').ping('10.0.0.2', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.log.some(e => e.dev === 'pc3' && e.tag === 'frame-not-mine' && e.data.kind === 'icmp'), 'pc3 sieht ICMP im Hub-Modus');
});

const routed = () => new Sim({ devices: [pc('pc1', '192.168.10.10', '192.168.10.1'), pc('pc3', '192.168.20.20', '192.168.20.1'),
  { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '192.168.10.1', prefix: 24 }, eth2: { ip: '192.168.20.1', prefix: 24 } } },
  { id: 'sw1', type: 'switch', name: 'sw1' }],
links: [L('pc1', 'eth1', 'sw1', 'eth1'), L('r1', 'eth1', 'sw1', 'eth4'), L('r1', 'eth2', 'pc3', 'eth1')] });

test('Ping über einen Router, TTL und MAC-Wechsel', () => {
  const sim = routed();
  sim.dev('pc1').ping('192.168.20.20', { count: 2 });
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /2 empfangen/);
  assert.match(out(sim, 'pc1'), /ttl=63/);
  const r1 = sim.dev('r1');
  const sentOnEth2 = sim.log.find(e => e.dev === 'r1' && e.kind === 'send' && e.frame?.type === 'ipv4' && e.frame.payload.l4?.type === 8);
  assert.equal(sentOnEth2.frame.src, r1.mac('eth2'));
  assert.equal(sentOnEth2.frame.payload.ttl, 63);
});

test('Fehlendes Gateway beim Ziel', () => {
  const sim = routed();
  sim.dev('pc3').cfg.gw = '';
  sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /0 empfangen/);
  assert.ok(sim.hasTag('echo-request-received'));
});

test('Zu grosse Netzmaske: Host Unreachable vom eigenen Host', () => {
  const sim = routed();
  sim.dev('pc1').cfg.ifaces.eth1.prefix = 16;
  sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  sim.runToIdle();
  assert.match(out(sim, 'pc1'), /From 192\.168\.10\.10 icmp_seq=1 Destination Host Unreachable/);
});

test('Forwarding aus', () => {
  const sim = routed();
  sim.dev('r1').cfg.forwarding = false;
  sim.dev('pc1').ping('192.168.20.1', { count: 1 });
  sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  sim.runToIdle();
  const o = out(sim, 'pc1');
  assert.match(o, /Byte von 192\.168\.20\.1/);
  assert.ok(sim.hasTag('not-forwarding'));
});

test('MTU, DF, PMTUD und Fragmentierung', () => {
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
  assert.match(o, /1480 Byte von 192\.168\.20\.20/);
});

test('Traceroute über drei Router', () => {
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

test('ACL blockiert ICMP und erzeugt PMTUD-Blackhole', () => {
  const sim = routed();
  sim.topo.links[2].mtu = 1400;
  sim.dev('r1').cfg.acl = [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }];
  sim.dev('pc1').ping('192.168.20.20', { count: 1, size: 100 });
  sim.runToIdle();
  assert.ok(sim.hasTag('acl-drop'));
  assert.match(out(sim, 'pc1'), /0 empfangen/);
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

test('VXLAN: Ping über das Underlay', () => {
  const sim = vxTopo();
  sim.dev('srv1').ping('192.168.10.12', { count: 2 });
  sim.runToIdle();
  assert.match(out(sim, 'srv1'), /2 empfangen/);
  assert.ok(sim.hasTag('vxlan-encap'));
  assert.ok(sim.hasTag('vxlan-decap'));
  const onCore = sim.log.find(e => e.dev === 'core' && e.kind === 'send' && e.frame.payload.l4?.payload?.kind === 'vxlan');
  assert.equal(onCore.frame.payload.l4.dport, 4789);
  assert.equal(onCore.frame.payload.l4.payload.vni, 10010);
  assert.ok(sim.dev('vtep1').bridge.table().some(r => r.remote === '10.255.0.2'));
  assert.equal(sim.dev('core').l3.lookup('192.168.10.12'), null);
});

test('VXLAN: MTU-Falle und Lösung', () => {
  const sim = vxTopo();
  sim.dev('srv1').ping('192.168.10.12', { count: 1, size: 1472, df: true });
  sim.runToIdle();
  assert.ok(sim.hasTag('vxlan-mtu-drop'));
  assert.match(out(sim, 'srv1'), /0 empfangen/);
  for (const l of sim.topo.links.slice(0, 2)) l.mtu = 1550;
  sim.dev('srv1').ping('192.168.10.12', { count: 1, size: 1472, df: true });
  sim.runToIdle();
  assert.match(out(sim, 'srv1'), /1480 Byte von 192\.168\.10\.12/);
});

test('VXLAN: falscher VNI und falscher Port', () => {
  let sim = vxTopo({ vni2: 10011 });
  sim.dev('srv1').ping('192.168.10.12', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.hasTag('vxlan-vni-unknown'));
  sim = vxTopo({ port2: 8472 });
  sim.dev('srv2').ping('192.168.10.11', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.log.some(e => e.dev === 'vtep1' && e.tag === 'port-unreachable-sent'));
});

test('VLAN-Trunk zwischen zwei Switches', () => {
  const sw = (id, trunk) => ({ id, type: 'switch', name: id, ports: { eth1: { mode: 'access', vlan: 10 }, eth2: { mode: 'access', vlan: 20 },
    eth8: trunk ? { mode: 'trunk', allowed: '10,20', native: 1 } : { mode: 'access', vlan: 1 } } });
  const mk = trunk => new Sim({ devices: [pc('a10', '10.10.0.1'), pc('a20', '10.20.0.1'), pc('b10', '10.10.0.2'), pc('b20', '10.20.0.2'), sw('s1', trunk), sw('s2', trunk)],
    links: [L('a10', 'eth1', 's1', 'eth1'), L('a20', 'eth1', 's1', 'eth2'), L('b10', 'eth1', 's2', 'eth1'), L('b20', 'eth1', 's2', 'eth2'), L('s1', 'eth8', 's2', 'eth8')] });
  let sim = mk(false);
  sim.dev('a10').ping('10.10.0.2', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'a10'), /0 empfangen/);
  sim = mk(true);
  sim.dev('a10').ping('10.10.0.2', { count: 1 }); sim.dev('a20').ping('10.20.0.2', { count: 1 }); sim.runToIdle();
  assert.match(out(sim, 'a10'), /1 empfangen/);
  assert.match(out(sim, 'a20'), /1 empfangen/);
  assert.ok(sim.log.some(e => e.dev === 's1' && e.kind === 'send' && e.frame.vlan?.vid === 10));
});

test('Doppelte IP-Adresse', () => {
  const sim = new Sim({ devices: [pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.1'), pc('pc3', '10.0.0.3'), { id: 'sw1', type: 'switch', name: 'sw1' }],
    links: [L('pc1', 'eth1', 'sw1', 'eth1'), L('pc2', 'eth1', 'sw1', 'eth2'), L('pc3', 'eth1', 'sw1', 'eth3')] });
  sim.dev('pc3').ping('10.0.0.1', { count: 1 }); sim.runToIdle();
  assert.equal(sim.log.filter(e => e.tag === 'arp-reply-sent').length, 2);
});

// ---------------------------------------------------------------- neue Funktionen
const swStp = (id, prio = 32768, extra = {}) => ({ id, type: 'switch', name: id, stp: { enabled: true, priority: prio, timers: 'schnell' }, ...extra });
function triangle(stp = true) {
  const mk = (id, prio) => stp ? swStp(id, prio) : { id, type: 'switch', name: id };
  return new Sim({ devices: [mk('s1', 4096), mk('s2', 32768), mk('s3', 32768), pc('pc1', '10.0.0.1'), pc('pc2', '10.0.0.2')],
    links: [L('s1', 'eth1', 's2', 'eth1'), L('s2', 'eth2', 's3', 'eth2'), L('s3', 'eth1', 's1', 'eth2'),
      L('pc1', 'eth1', 's2', 'eth5'), L('pc2', 'eth1', 's3', 'eth5')] });
}

test('STP: Root-Wahl, Rollen und ein blockierter Port', () => {
  const sim = triangle();
  sim.runFor(20000);
  const t1 = sim.dev('s1').bridge.stpTable(), t2 = sim.dev('s2').bridge.stpTable(), t3 = sim.dev('s3').bridge.stpTable();
  assert.ok(t1.isRoot, 's1 hat die tiefste Priorität');
  assert.equal(t2.rootPort, 'eth1'); assert.equal(t3.rootPort, 'eth1');
  assert.equal(t2.rootCost, 4);
  // s2 und s3 haben gleiche Kosten zur Root, s2 hat die kleinere Bridge-ID? Genau ein Port im Dreieck blockiert
  const alt = [...t2.ports, ...t3.ports].filter(p => p.role === 'alternate');
  assert.equal(alt.length, 1);
  const s2bid = sim.dev('s2').bridge.myId(), s3bid = sim.dev('s3').bridge.myId();
  const loser = s2bid.mac < s3bid.mac ? 's3' : 's2';
  assert.equal(sim.dev(loser).bridge.roleOf('eth2'), 'alternate');
  assert.equal(sim.dev(loser).bridge.stateOf('eth2'), 'blocking');
  assert.ok(t1.ports.every(p => p.role === 'designated' && p.state === 'forwarding'));
  sim.dev('pc1').ping('10.0.0.2', { count: 2 });
  sim.runFor(5000);
  assert.match(out(sim, 'pc1'), /2 empfangen/);
  assert.ok(!sim.halted);
});

test('STP: Ohne STP gibt es einen Broadcast-Sturm', () => {
  const sim = triangle(false);
  sim.dev('pc1').ping('10.0.0.2', { count: 1 });
  sim.runToIdle();
  assert.ok(sim.halted, 'Simulation angehalten');
  assert.ok(sim.hasTag('loop-detected'));
  assert.ok(sim.hasTag('storm'));
});

test('STP: Port-Zustände, PortFast und Ausfall des Root-Ports', () => {
  const sim = triangle();
  sim.runFor(1000);
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'listening');
  sim.runFor(4000);
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'learning');
  sim.runFor(5000);
  assert.equal(sim.dev('s2').bridge.stateOf('eth5'), 'forwarding');
  // Ausfall s1-s2: s2 muss über s3 gehen, der blockierte Port wird freigegeben
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
  assert.match(out(sim, 'pc1'), /1 empfangen/);
  // Edge-Port
  const s = triangle();
  s.dev('s2').cfg.ports.eth5.edge = true;
  s.reset();
  s.runFor(100);
  assert.equal(s.dev('s2').bridge.stateOf('eth5'), 'forwarding');
  assert.equal(s.dev('s3').bridge.stateOf('eth5'), 'listening');
});

test('Router-on-a-Stick mit Subinterfaces', () => {
  const sim = new Sim({ devices: [pc('a', '10.10.0.10', '10.10.0.1'), pc('b', '10.20.0.10', '10.20.0.1'),
    { id: 'sw', type: 'switch', name: 'sw', ports: { eth1: { mode: 'access', vlan: 10 }, eth2: { mode: 'access', vlan: 20 }, eth8: { mode: 'trunk', allowed: '10,20', native: 1 } } },
    { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '', prefix: 24 }, 'eth1.10': { parent: 'eth1', vlan: 10, ip: '10.10.0.1', prefix: 24 }, 'eth1.20': { parent: 'eth1', vlan: 20, ip: '10.20.0.1', prefix: 24 } } }],
  links: [L('a', 'eth1', 'sw', 'eth1'), L('b', 'eth1', 'sw', 'eth2'), L('r1', 'eth1', 'sw', 'eth8')] });
  sim.dev('a').ping('10.20.0.10', { count: 2 });
  sim.runToIdle();
  assert.match(out(sim, 'a'), /2 empfangen/);
  assert.match(out(sim, 'a'), /ttl=63/);
  const tagged = sim.log.filter(e => e.dev === 'r1' && e.kind === 'send' && e.frame?.vlan);
  assert.ok(tagged.some(e => e.frame.vlan.vid === 10) && tagged.some(e => e.frame.vlan.vid === 20));
  assert.equal(sim.dev('r1').mac('eth1.10'), sim.dev('r1').mac('eth1'));
  // falscher VLAN-Tag am Subinterface
  sim.dev('r1').cfg.ifaces['eth1.20'].vlan = 21;
  sim.dev('r1').l3.arp.clear(); sim.dev('b').l3.arp.clear();
  sim.dev('b').ping('10.20.0.1', { count: 1 });
  sim.runToIdle();
  assert.match(out(sim, 'b'), /0 empfangen/);
  assert.ok(sim.hasTag('vlan-mismatch'));
});

const svcNet = () => new Sim({ devices: [pc('pc1', '10.0.1.10', '10.0.1.1'),
  { id: 'srv', type: 'server', name: 'srv', ifaces: { eth1: { ip: '10.0.2.10', prefix: 24 } }, gw: '10.0.2.1',
    services: [{ proto: 'tcp', port: 80, name: 'http', size: 4000 }, { proto: 'udp', port: 53, name: 'dns' }], dns: [{ name: 'web.lab', ip: '10.0.2.10' }] },
  { id: 'r1', type: 'router', name: 'r1', ifaces: { eth1: { ip: '10.0.1.1', prefix: 24 }, eth2: { ip: '10.0.2.1', prefix: 24 } } }],
links: [L('pc1', 'eth1', 'r1', 'eth1'), L('r1', 'eth2', 'srv', 'eth1')] });

test('TCP: Handshake, Segmente, Verbindungsabbau', () => {
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
  // kleinere MTU: kleinere MSS, mehr Segmente
  sim.topo.links[1].mtu = 1000;
  sim.dev('pc1').curl('10.0.2.10', 80);
  sim.runToIdle();
  assert.ok(sim.hasTag('tcp-response', d => d.mss === 960 && d.segments === 5));
});

test('TCP: geschlossener Port, Filter und Reject', () => {
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

test('UDP und DNS', () => {
  const sim = svcNet();
  sim.dev('pc1').dig('10.0.2.10', 'web.lab');
  sim.runToIdle();
  assert.ok(sim.hasTag('dns-done', d => d.ok && d.answer === '10.0.2.10'));
  assert.match(out(sim, 'pc1'), /web\.lab\.\s+300\s+IN\s+A\s+10\.0\.2\.10/);
  sim.dev('pc1').dig('10.0.2.10', 'gibtsnicht.lab');
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

test('Gratuitous ARP, DAD und NUD', () => {
  const sim = new Sim({ devices: [pc('cl', '10.0.0.5'), pc('a', '10.0.0.10'), pc('b', '10.0.0.11'), { id: 'sw', type: 'switch', name: 'sw' }],
    links: [L('cl', 'eth1', 'sw', 'eth1'), L('a', 'eth1', 'sw', 'eth2'), L('b', 'eth1', 'sw', 'eth3')] });
  sim.dev('cl').ping('10.0.0.10', { count: 1 });
  sim.runToIdle();
  assert.equal(sim.dev('cl').l3.arp.get('10.0.0.10').mac, sim.dev('a').mac('eth1'));
  // Die Adresse zieht zu b um (wie bei einem Failover)
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
  // NUD: ohne GARP bleibt der alte Eintrag bis die Prüfung scheitert
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
  assert.ok(done.data.received > 0 && done.data.received < 15, 'nach dem Failover kommen wieder Antworten');
});

test('TCP: PMTUD, Blackhole und MSS Clamping', () => {
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

console.log(`\n${passed} Tests bestanden`);
