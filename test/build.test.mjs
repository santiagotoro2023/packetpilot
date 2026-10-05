// Prüft jede Aufgabe «Frame konstruieren» gegen den Frame, den die Simulation wirklich erzeugt
import { Sim } from '../src/js/engine.js';
import { MODULES } from '../src/js/course/index.js';
import { runCommand } from '../src/js/cli.js';
import { checkBuild } from '../src/js/widgets.js';
import { fmtBid } from '../src/js/packets.js';
import { PRESETS, failoverTopo, stickTopo, stpTriangle, servicesTopo } from '../src/js/presets.js';
import assert from 'node:assert/strict';

const flags = f => ['SYN', 'FIN', 'RST', 'PSH', 'ACK'].filter(k => f[k]);
const FLAGSTR = { 'SYN': 'SYN', 'ACK,SYN': 'SYN,ACK', 'ACK': 'ACK', 'ACK,PSH': 'PSH,ACK', 'ACK,FIN': 'FIN,ACK', 'RST': 'RST', 'ACK,RST': 'RST,ACK' };
function toBuild(f) {
  const out = [];
  const et = { arp: '0x0806', ipv4: '0x0800', stp: 'len' }[f.type];
  out.push({ block: 'eth', fields: { dst: f.dst, src: f.src, type: f.vlan ? '0x8100' : et } });
  if (f.vlan) out.push({ block: 'vlan', fields: { vid: String(f.vlan.vid), type: et } });
  const p = f.payload;
  if (f.type === 'arp') out.push({ block: 'arp', fields: { op: String(p.op), sha: p.sha, spa: p.spa, tha: p.tha || '00:00:00:00:00:00', tpa: p.tpa } });
  if (f.type === 'stp') out.push({ block: 'stp', fields: { root: fmtBid(p.root), cost: String(p.cost), bridge: fmtBid(p.bridge) } });
  if (f.type === 'ipv4') {
    out.push({ block: 'ip', fields: { src: p.src, dst: p.dst, proto: String(p.proto), ttl: String(p.ttl) } });
    const l4 = p.l4;
    if (l4.kind === 'icmp') out.push({ block: 'icmp', fields: { type: String(l4.type) } });
    if (l4.kind === 'udp') { out.push({ block: 'udp', fields: { sport: String(l4.sport), dport: String(l4.dport) } });
      if (l4.payload?.kind === 'dns') out.push({ block: 'dns', fields: { qr: String(l4.payload.qr), name: l4.payload.qname } }); }
    if (l4.kind === 'tcp') out.push({ block: 'tcp', fields: { sport: String(l4.sport), dport: String(l4.dport), flags: FLAGSTR[flags(l4.flags).sort().join(',')] } });
  }
  return out;
}
const sent = (sim, dev, pred) => sim.log.find(e => e.dev === dev && e.kind === 'send' && e.frame && pred(e.frame))?.frame;
const go = (sim, dev, cmd, ms = 15000) => { runCommand(sim.dev(dev), cmd); sim.runFor(ms); };

const REAL = {
  'm1-l5': () => { const s = new Sim(PRESETS.find(p => p.id === 'switch3').make()); go(s, 'pc1', 'ping -c 1 10.0.0.3'); return sent(s, 'pc1', f => f.type === 'arp'); },
  'm1-garp': () => { const s = new Sim(failoverTopo()); s.dev('srvB').cfg.ifaces.eth1.ip = '10.0.0.100'; go(s, 'srvB', 'arping -U -c 1 10.0.0.100'); return sent(s, 'srvB', f => f.type === 'arp'); },
  'm3-stick': () => { const s = new Sim(stickTopo(true)); go(s, 'a1', 'ping -c 1 10.20.0.11'); return sent(s, 'r1', f => f.vlan?.vid === 20 && f.payload.l4?.type === 8); },
  'm4-l2': () => { const s = new Sim(stpTriangle({ enabled: true, rootPrio: 4096 })); s.runFor(5000); return s.log.filter(e => e.dev === 'sw1' && e.frame?.type === 'stp' && e.frame.src === s.dev('sw1').mac('eth1')).pop().frame; },
  'm5-l2': () => { const s = new Sim(servicesTopo()); go(s, 'client', 'dig @10.20.0.53 web.lab'); return sent(s, 'client', f => f.payload?.l4?.payload?.kind === 'dns'); },
  'm5-l3': () => { const s = new Sim(servicesTopo()); go(s, 'client', 'curl http://10.20.0.80/'); return sent(s, 'client', f => f.payload?.l4?.flags?.SYN); }
};

let n = 0, bad = 0;
for (const m of MODULES) for (const l of m.lessons) for (const st of l.steps) {
  if (st.type !== 'build') continue;
  n++;
  try {
    const real = REAL[l.id];
    assert.ok(real, `keine Referenz für ${l.id}`);
    const frame = real();
    assert.ok(frame, `${l.id}: kein Frame in der Simulation gefunden`);
    const b = toBuild(frame);
    const r = checkBuild(st.expected, b);
    assert.ok(r.ok, `${l.id}: Simulation und Musterlösung weichen ab: ${JSON.stringify(r)} ${JSON.stringify(b)}`);
    // Leere Antwort darf nie als richtig gelten
    assert.ok(!checkBuild(st.expected, []).ok);
    // Jedes Pflichtfeld muss im Widget auswählbar sein
    console.log('ok  ', l.id, st.title);
  } catch (e) { bad++; console.log('FAIL', e.message); process.exitCode = 1; }
}
console.log(`\n${n - bad} von ${n} Frame-Aufgaben stimmen mit der Simulation überein`);
