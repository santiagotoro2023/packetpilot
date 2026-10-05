// Spielt jede Labor-Lektion mit einer Musterlösung durch und prüft alle Ziele
import { Sim } from '../src/js/engine.js';
import { MODULES } from '../src/js/course/index.js';
import { runCommand } from '../src/js/cli.js';
import assert from 'node:assert/strict';
import { macFor } from '../src/js/net.js';

const labs = new Map();
for (const m of MODULES) for (const l of m.lessons) {
  let n = 0;
  l.steps.forEach(s => { if (s.type === 'lab') { n++; labs.set(n === 1 ? l.id : `${l.id}#${n}`, s); } });
}
const stpRun = (sim, ms = 12000) => sim.runFor(ms);
const runT = (sim, dev, cmd, ms = 12000) => { runCommand(sim.dev(dev), cmd); sim.runFor(ms); };

const run = (sim, dev, cmd) => { runCommand(sim.dev(dev), cmd); sim.runToIdle(); };
const findFrame = (sim, pred) => sim.log.find(e => e.frame && pred(e.frame));

let r0 = null;
const SQ = {};
const blocked = sim => [...sim.devices.values()].flatMap(d => (d.bridge?.stpTable()?.ports || []).filter(p => p.role === 'alternate').map(p => `${d.name} ${p.port}`))[0];
const SOLUTIONS = {
  'm1-garp': { answers: [null, null, null, 'PROBE', null], act: sim => {
    runCommand(sim.dev('client'), 'ping -c 60 10.0.0.100'); sim.runFor(3500);
    runT(sim, 'srvA', 'ip link set eth1 down', 10); runT(sim, 'srvB', 'ip addr add 10.0.0.100/24 dev eth1', 10);
    sim.runToIdle(); } },
  'm1-garp#2': { answers: [null, null, null, '10.0.0.100'], act: sim => {
    run(sim, 'srvB', 'arping -D -c 2 10.0.0.100');
    runCommand(sim.dev('client'), 'ping -c 30 10.0.0.100'); sim.runFor(3500);
    runT(sim, 'srvA', 'ip link set eth1 down', 10); runT(sim, 'srvB', 'ip addr add 10.0.0.100/24 dev eth1', 10); runT(sim, 'srvB', 'arping -U -c 1 10.0.0.100', 10);
    sim.runToIdle();
    const d = sim.log.filter(e => e.tag === 'ping-done').pop();
    assert.ok(d.data.sent - d.data.received <= 1, 'höchstens ein Ping verloren'); } },
  'm3-stick': { answers: sim => [null, null, null, null, '2', sim.dev('r1').mac('eth1')], act: (sim, ctx) => {
    for (const c of ['ip link add link eth1 name eth1.10 type vlan id 10', 'ip link add link eth1 name eth1.20 type vlan id 20', 'ip addr add 10.10.0.1/24 dev eth1.10', 'ip addr add 10.20.0.1/24 dev eth1.20']) run(sim, 'r1', c);
    run(sim, 'a1', 'ping -c 2 10.20.0.11');
    ctx.inspected.push(sim.log.find(e => e.dev === 'r1' && e.kind === 'send' && e.frame?.vlan?.vid === 20 && e.frame.type === 'ipv4')); } },
  'm4-l1': { answers: [null, 'ARP', null, null], act: (sim, ctx) => {
    run(sim, 'pc1', 'ping -c 1 10.0.0.2');
    assert.ok(sim.halted);
    ctx.snap();
    sim.reset();
    for (const id of ['sw1', 'sw2', 'sw3']) { sim.dev(id).cfg.stp.enabled = true; sim.configChanged(id); }
    stpRun(sim); runT(sim, 'pc1', 'ping -c 2 10.0.0.2'); } },
  'm4-l2': { answers: [], act: (sim, ctx) => {
    stpRun(sim);
    r0 = ['sw1', 'sw2', 'sw3'].find(id => sim.dev(id).bridge.stpTable().isRoot);
    ctx.ask(0, r0); ctx.ask(1, macFor(r0 + '/bridge'));
    const target = ['sw1', 'sw2', 'sw3'].sort((a, b) => macFor(b + '/bridge').localeCompare(macFor(a + '/bridge')))[0];
    assert.notEqual(target, r0);
    run(sim, target, 'spanning-tree priority 4096'); stpRun(sim); } },
  'm4-l3': { answers: [], act: (sim, ctx) => {
    stpRun(sim);
    const t = sim.dev('sw3').bridge.stpTable();
    assert.equal(t.rootPort, 'eth2', 'sw3 erreicht die Root zuerst über sw4');
    ctx.ask(0, blocked(sim)); ctx.ask(1, 'sw4');
    run(sim, 'sw3', 'spanning-tree cost eth2 19'); stpRun(sim);
    ctx.ask(3, blocked(sim));
    runT(sim, 'pc1', 'ping -c 2 10.0.0.3'); } },
  'm4-l4': { answers: [null, '30', null, 'Learning'], act: sim => {
    stpRun(sim, 35000);
    run(sim, 'sw3', 'spanning-tree portfast eth5 on');
    const l = sim.linkAt('sw3', 'eth5'); sim.setLinkUp(l, false); sim.runFor(100); sim.setLinkUp(l, true); sim.runFor(100); } },
  'm4-l5': { answers: sim => [null, SQ.blocker, null, sim.dev('sw2').bridge.stpTable().rootPort, null], act: (sim, ctx) => {
    stpRun(sim); runT(sim, 'pc1', 'ping -c 1 10.0.0.2');
    SQ.blocker = blocked(sim).split(' ')[0];
    run(sim, 'sw2', 'ip link set eth1 down'); stpRun(sim); runT(sim, 'pc1', 'ping -c 2 10.0.0.2'); } },
  'm5-l2': { answers: sim => [null, null, String(sim.log.find(e => e.dev === 'client' && e.kind === 'send' && e.frame?.payload?.l4?.payload?.kind === 'dns').frame.payload.l4.sport), 'NXDOMAIN', null],
    act: (sim, ctx) => { run(sim, 'client', 'dig @10.20.0.53 web.lab'); ctx.inspected.push(sim.log.find(e => e.frame?.payload?.l4?.payload?.kind === 'dns'));
      run(sim, 'client', 'dig @10.20.0.53 gibtsnicht.lab'); assert.match(sim.dev('client').consoleLines.join('\n'), /NXDOMAIN/); run(sim, 'client', 'nc -u 10.20.0.53 5353'); } },
  'm5-l4': { answers: [null, null, '1460', '3', 'SYN, ACK'], act: (sim, ctx) => {
    run(sim, 'client', 'curl http://web.lab/');
    ctx.inspected.push(sim.log.find(e => e.frame?.payload?.l4?.flags?.SYN && !e.frame.payload.l4.flags.ACK)); } },
  'm5-l5': { answers: [null, null, null, 'r1', null], act: sim => {
    run(sim, 'client', 'nc -zv 10.20.0.80 22'); run(sim, 'client', 'nc -zv 10.20.0.80 80'); run(sim, 'client', 'nc -zv 10.20.0.80 443');
    assert.ok(sim.log.some(e => e.dev === 'r1' && e.tag === 'acl-drop' && e.data.rule === 2));
    sim.dev('r1').cfg.acl.shift(); run(sim, 'client', 'curl http://web.lab/'); } },
  'm5-l6': { answers: [null, 'r2', '1360'], act: sim => { run(sim, 'client', 'curl http://10.0.2.80/'); } },
  'm5-l6#2': { answers: [null, 'ja', null], act: sim => { run(sim, 'client', 'curl http://10.0.2.80/'); sim.dev('r1').cfg.mssClamp = 1360; run(sim, 'client', 'curl http://10.0.2.80/'); } },

  'm1-l4': { answers: [null, 'eth2', null], act: sim => { run(sim, 'pc1', 'ping -c 2 10.0.0.2'); sim.dev('sw1').cfg.ageing = 0; run(sim, 'pc1', 'ping -c 1 10.0.0.2'); } },
  'm1-l5': { answers: [null, null, '00:00:00:00:00:00', null, '10.0.0.2'], act: (sim, ctx) => { run(sim, 'pc1', 'ping -c 1 10.0.0.3'); ctx.inspected.push(findFrame(sim, f => f.type === 'arp' && f.payload.op === 1)); run(sim, 'pc2', 'ping -c 1 10.0.0.99'); } },
  'm1-l6': { answers: sim => [null, '192.168.10.1', sim.dev('r1').mac('eth1'), sim.dev('r1').mac('eth2'), '63', '192.168.20.20'],
    act: sim => { run(sim, 'pc1', 'ping -c 1 192.168.20.20');
      const lanB = sim.log.find(e => e.dev === 'r1' && e.kind === 'send' && e.frame?.payload?.l4?.type === 8);
      assert.equal(lanB.frame.payload.ttl, 63); assert.equal(lanB.frame.src, sim.dev('r1').mac('eth2'));
      sim.dev('pc1').cfg.ifaces.eth1.prefix = 16; sim.dev('pc1').l3.arp.clear(); run(sim, 'pc1', 'ping -c 1 192.168.20.20');
      assert.ok(sim.log.some(e => e.dev === 'pc1' && e.tag === 'arp-request-sent' && e.data.ip === '192.168.20.20')); } },
  'm2-l3': { answers: [null, '10.0.12.2', 'r2', '61'], act: sim => {
    run(sim, 'pc1', 'traceroute 10.0.4.10'); run(sim, 'pc1', 'ping -c 1 -t 2 10.0.4.10'); run(sim, 'pc1', 'ping -c 1 10.0.4.10');
    const out = sim.dev('pc1').consoleLines.join('\n');
    assert.match(out, / 2 {2}10\.0\.12\.2/); assert.match(out, /From 10\.0\.12\.2 icmp_seq=1 Time to live exceeded/); assert.match(out, /ttl=61/); } },
  'm2-l4': { answers: [null, null, 'r2'], act: sim => { run(sim, 'pc1', 'ping -c 2 10.0.4.10'); run(sim, 'r2', 'ip route add 10.0.1.0/24 via 10.0.12.1'); run(sim, 'pc1', 'ping -c 2 10.0.4.10'); } },
  'm2-l5': { answers: ['1400', null, null, '2', '1372'], act: sim => {
    run(sim, 'pc1', 'ping -c 2 -M do -s 1472 10.0.2.20'); run(sim, 'pc1', 'ping -c 1 -M dont -s 1472 10.0.2.20'); run(sim, 'pc1', 'ping -c 1 -M do -s 1372 10.0.2.20');
    assert.ok(sim.log.some(e => e.tag === 'fragmented' && e.data.count === 2));
    assert.match(sim.dev('pc1').consoleLines.join('\n'), /mtu = 1400/);
    assert.ok(sim.log.some(e => e.tag === 'ping-done' && e.data.size === 1372 && e.data.received === 1)); } },
  'm2-l6': { answers: [], act: sim => {
    run(sim, 'pc1', 'ping -c 1 10.0.2.20'); run(sim, 'pc1', 'ping -c 1 -M do -s 1472 10.0.2.20');
    sim.dev('r1').cfg.acl.unshift({ action: 'allow', proto: 'icmp', icmpType: 3, src: 'any', dst: 'any' });
    run(sim, 'pc1', 'ping -c 1 -M do -s 1472 10.0.2.20'); run(sim, 'pc1', 'ping -c 1 -M do -s 1372 10.0.2.20'); } },
  'm3-l2': { answers: [null, null, null, '20'], act: (sim, ctx) => {
    for (const s of ['s1', 's2']) sim.dev(s).cfg.ports.eth8 = { mode: 'trunk', allowed: '10,20', native: 1 };
    run(sim, 'a10', 'ping -c 1 10.10.0.2'); run(sim, 'a20', 'ping -c 1 10.20.0.2');
    const f = findFrame(sim, f => !!f.vlan); ctx.inspected.push(f); } },
  'm3-l4': { answers: [null, null, '10.255.0.1', '10010', 'nein'], act: (sim, ctx) => {
    run(sim, 'srv1', 'ping -c 2 192.168.10.12');
    const e = sim.log.find(x => x.dev === 'vtep1' && x.kind === 'send' && x.frame.payload?.l4?.payload?.kind === 'vxlan');
    assert.equal(e.frame.payload.src, '10.255.0.1'); assert.equal(e.frame.payload.l4.payload.vni, 10010);
    ctx.inspected.push(e); } },
  'm3-l5': { answers: [], act: sim => { run(sim, 'srv1', 'ping -c 1 192.168.10.12'); sim.dev('vtep2').cfg.vxlans[0].vni = 10010; run(sim, 'srv1', 'ping -c 1 192.168.10.12'); } },
  'm3-l6': { answers: [null, '1450'], act: sim => {
    run(sim, 'srv1', 'ping -c 1 -M do -s 1472 192.168.10.12');
    assert.equal(sim.dev('vtep1').vxlanMtu(sim.dev('vtep1').cfg.vxlans[0]), 1450);
    for (const l of sim.topo.links) if (['vtep1', 'vtep2'].includes(l.a.dev) && l.b.dev === 'core') l.mtu = 1550;
    run(sim, 'srv1', 'ping -c 1 -M do -s 1472 192.168.10.12'); } }
};

let ok = 0;
for (const [id, step] of labs) {
  const sol = SOLUTIONS[id];
  try {
    assert.ok(sol, `keine Musterlösung für ${id}`);
    const sim = new Sim(step.topo());
    const met = new Set();
    const ctx = { inspected: [] };
    ctx.snap = () => step.goals.forEach((g, i) => { if (g.check && g.check(sim, ctx)) met.add(i); });
    ctx.ask = (gi, a) => {
      const exp = step.goals[gi].expect(sim).map(x => String(x).toLowerCase());
      assert.ok(exp.includes(String(a).toLowerCase()), `${id}: Ziel ${gi + 1} erwartet ${exp}, Lösung ${a}`);
      met.add(gi);
    };
    sol.act(sim, ctx);
    const answers = sol.answersFn ? sol.answersFn(sim) : typeof sol.answers === 'function' ? sol.answers(sim) : sol.answers;
    let ai = 0;
    step.goals.forEach((g, gi) => {
      if (met.has(gi)) { ai++; return; }
      if (g.ask) {
        let a = answers[gi] ?? answers[ai];
        // Antworten sind nach Zielindex abgelegt
        a = answers[gi];
        assert.ok(a, `${id}: keine Antwort für Ziel ${gi + 1}`);
        const exp = g.expect(sim).map(x => String(x).toLowerCase());
        assert.ok(exp.includes(String(a).toLowerCase()), `${id}: Ziel ${gi + 1} erwartet ${exp}, Lösung ${a}`);
      } else {
        assert.ok(g.check(sim, ctx), `${id}: Ziel ${gi + 1} nicht erfüllt: ${g.text.replace(/<[^>]+>/g, '')}`);
      }
      ai++;
    });
    ok++; console.log('ok  ', id, `(${step.goals.length} Ziele)`);
  } catch (e) { console.log('FAIL', id, e.message); process.exitCode = 1; }
}
console.log(`\n${ok} von ${labs.size} Labor-Lektionen lösbar`);
