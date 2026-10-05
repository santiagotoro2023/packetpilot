// PacketPilot Simulations-Engine: ereignisgesteuert, ohne DOM
import { BCAST, VXLAN_PORT, PROTO, STP_MAC, isGroupMac, macFor, inNet, parseCidr, isIp,
  netOf, intToIp, hashFlow, framePayloadLen, clone, IP_HDR, ICMP_HDR, TCP_HDR } from './net.js';
import { ethFrame, arpPacket, ipPacket, icmp, udp, tcp, ipChecksum, summary, icmpName, fmtBid } from './packets.js';

export const PORTS = {
  pc: ['eth1'], server: ['eth1'],
  router: ['eth1', 'eth2', 'eth3', 'eth4'],
  switch: ['eth1', 'eth2', 'eth3', 'eth4', 'eth5', 'eth6', 'eth7', 'eth8'],
  vtep: ['eth1', 'eth2', 'eth3', 'eth4']
};
export const TYPE_NAMES = { pc: 'PC', server: 'Server', router: 'Router', switch: 'Switch', vtep: 'VTEP' };

const T = { linkDelay: 0.1, arpTimeout: 1000, arpRetries: 3, pingInterval: 1000, replyTimeout: 4000, reachable: 30000,
  nudDelay: 5000, nudProbes: 3, tcpSyn: [1000, 2000, 4000], tcpStall: 10000, dnsTimeout: 5000, loopHalt: 8 };
export const TIMING = T;
export const STP_PRESETS = { standard: { hello: 2, fwd: 15, maxAge: 20 }, schnell: { hello: 1, fwd: 4, maxAge: 6 } };

// ---------------------------------------------------------------- Simulation
export class Sim {
  constructor(topo) {
    this.topo = topo;
    topo.zones ??= [];
    this.time = 0; this.queue = []; this.seq = 0; this.inflight = []; this.log = []; this.logSeq = 0;
    this.listeners = new Set(); this.devices = new Map(); this.halted = null; this.rnd = 12345;
    for (const d of topo.devices) this._mk(d);
    for (const d of this.devices.values()) d.start?.();
  }
  random() { this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) >>> 0; return this.rnd / 4294967296; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  _mk(cfg) {
    normalizeDevice(cfg);
    const C = { pc: Host, server: Host, router: Router, switch: Switch, vtep: Vtep }[cfg.type];
    const d = new C(this, cfg);
    this.devices.set(cfg.id, d);
    return d;
  }
  dev(idOrName) { return this.devices.get(idOrName) || [...this.devices.values()].find(d => d.name === idOrName); }
  addDevice(cfg) { this.topo.devices.push(cfg); const d = this._mk(cfg); d.start?.(); this.emit('topology'); return d; }
  removeDevice(id) {
    const gone = this.topo.links.filter(l => l.a.dev === id || l.b.dev === id);
    this.topo.links = this.topo.links.filter(l => !gone.includes(l));
    this.topo.devices = this.topo.devices.filter(d => d.id !== id);
    this.devices.get(id)?.stop?.();
    this.devices.delete(id);
    this.inflight = this.inflight.filter(f => f.from !== id && f.to !== id);
    for (const l of gone) this._linkNotify(l, false);
    this.emit('topology');
  }
  addLink(cfg) { cfg.mtu ??= 1500; cfg.up ??= true; this.topo.links.push(cfg); this._linkNotify(cfg, cfg.up); this.emit('topology'); return cfg; }
  removeLink(id) {
    const l = this.topo.links.find(x => x.id === id);
    this.topo.links = this.topo.links.filter(x => x.id !== id);
    this.inflight = this.inflight.filter(f => f.link.id !== id);
    if (l) this._linkNotify(l, false);
    this.emit('topology');
  }
  setLinkUp(l, up) {
    if (l.up === up) return;
    l.up = up;
    if (!up) this.inflight = this.inflight.filter(f => f.link !== l);
    const A = this.devices.get(l.a.dev), B = this.devices.get(l.b.dev);
    this.record(A, up ? 'info' : 'err', `Link ${A?.name} ${l.a.if} ↔ ${B?.name} ${l.b.if} ist ${up ? 'wieder aktiv' : 'unterbrochen'}`, { tag: up ? 'link-up' : 'link-down' });
    this._linkNotify(l, up);
    this.emit('topology');
  }
  _linkNotify(l, up) {
    for (const end of [l.a, l.b]) this.devices.get(end.dev)?.onLink?.(end.if, up);
  }
  configChanged(devId) { this.devices.get(devId)?.onConfig?.(); this.emit('config', devId); }
  linkAt(devId, ifname) {
    return this.topo.links.find(l => (l.a.dev === devId && l.a.if === ifname) || (l.b.dev === devId && l.b.if === ifname));
  }
  mtuOf(devId, ifname) { const l = this.linkAt(devId, ifname); return l ? l.mtu : 1500; }
  freePort(devId) { const d = this.devices.get(devId); return PORTS[d.cfg.type].find(p => !this.linkAt(devId, p)) || null; }

  schedule(delay, fn) {
    const ev = { t: this.time + Math.max(0, delay), n: this.seq++, fn };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > ev.t || (this.queue[i - 1].t === ev.t && this.queue[i - 1].n > ev.n))) i--;
    this.queue.splice(i, 0, ev);
    return ev;
  }
  cancel(ev) { if (!ev) return; const i = this.queue.indexOf(ev); if (i >= 0) this.queue.splice(i, 1); }
  nextTime() { return this.queue.length && !this.halted ? this.queue[0].t : null; }
  step() {
    if (this.halted) return false;
    const ev = this.queue.shift();
    if (!ev) return false;
    this.time = Math.max(this.time, ev.t);
    ev.fn();
    this.emit('tick');
    return true;
  }
  runUntil(t) {
    let n = 0;
    while (!this.halted && this.queue.length && this.queue[0].t <= t && n < 50000) { this.step(); n++; }
    if (!this.halted) this.time = Math.max(this.time, t);
    return n;
  }
  runFor(ms) { return this.runUntil(this.time + ms); }
  runToIdle(maxMs = 120000) {
    const end = this.time + maxMs;
    let n = 0;
    while (!this.halted && this.queue.length && this.queue[0].t <= end && n < 400000) { this.step(); n++; }
    return n;
  }
  reset() {
    this.queue = []; this.inflight = []; this.log = []; this.time = 0; this.halted = null;
    for (const d of this.devices.values()) d.resetState();
    for (const d of this.devices.values()) d.start?.();
    this.emit('reset');
  }
  halt(dev, text) {
    if (this.halted) return;
    this.record(dev, 'err', text, { tag: 'storm' });
    this.halted = { dev: dev.name, text, t: this.time };
    this.emit('halted', this.halted);
  }

  transmit(dev, ifname, frame) {
    const link = this.linkAt(dev.id, ifname);
    const quiet = frame.type === 'stp';
    if (!link) { if (!quiet) this.record(dev, 'drop', `${ifname} ist nicht verbunden, Frame geht verloren`, { frame }); return; }
    if (!link.up) { if (!quiet) this.record(dev, 'drop', `Link an ${ifname} ist unterbrochen, Frame geht verloren`, { frame, tag: 'link-down-drop' }); return; }
    const plen = framePayloadLen(frame);
    if (plen > link.mtu) {
      this.record(dev, 'drop', `Frame passt nicht durch den Link an ${ifname} (Nutzlast ${plen} > MTU ${link.mtu}), still verworfen`, { frame, tag: 'link-mtu-drop' });
      return;
    }
    const peer = link.a.dev === dev.id && link.a.if === ifname ? link.b : link.a;
    const f = clone(frame);
    const fl = { id: f.id + ':' + this.seq, frame: f, link, from: dev.id, fromIf: ifname, to: peer.dev, toIf: peer.if, t0: this.time, t1: this.time + T.linkDelay };
    this.inflight.push(fl);
    this.record(dev, 'send', `sendet über ${ifname}: ${summary(f)}`, { frame: f, tag: quiet ? 'bpdu-sent' : null });
    this.schedule(T.linkDelay, () => {
      this.inflight = this.inflight.filter(x => x !== fl);
      const target = this.devices.get(peer.dev);
      if (!target || !this.topo.links.includes(link) || !link.up) return;
      target.receive(peer.if, f);
    });
  }

  record(dev, kind, text, extra = {}) {
    const e = { seq: ++this.logSeq, t: this.time, dev: dev ? dev.name : '', devId: dev ? dev.id : null, kind, text,
      tag: extra.tag || null, data: extra.data || null, frame: extra.frame ? clone(extra.frame) : null,
      trace: extra.frame ? traceOf(extra.frame) : (extra.trace ?? null), stp: extra.frame?.type === 'stp' || (extra.tag || '').startsWith('stp') || extra.tag === 'bpdu-sent' };
    this.log.push(e);
    if (this.log.length > 5000) this.log.splice(0, this.log.length - 5000);
    this.emit('log', e);
    return e;
  }
  print(dev, text) {
    dev.consoleLines.push(text);
    if (dev.consoleLines.length > 500) dev.consoleLines.shift();
    this.emit('console', { devId: dev.id, text });
  }
  hasTag(tag, pred = () => true) { return this.log.some(e => e.tag === tag && pred(e.data || {}, e)); }
}

export function traceOf(f) {
  if (!f || f.type !== 'ipv4') return null;
  const l4 = f.payload.l4;
  if (l4?.kind === 'udp' && l4.payload?.kind === 'vxlan') return traceOf(l4.payload.frame) ?? f.payload.trace;
  return f.payload.trace;
}

const DEFAULT_SERVICES = { server: [{ proto: 'tcp', port: 80, name: 'http', size: 2000 }, { proto: 'tcp', port: 22, name: 'ssh', size: 40 }], pc: [] };
export function normalizeDevice(cfg) {
  const t = cfg.type;
  cfg.ifaces ??= {};
  if (t === 'pc' || t === 'server') {
    cfg.ifaces.eth1 ??= { ip: '', prefix: 24, vlan: null };
    cfg.gw ??= '';
    cfg.services ??= clone(DEFAULT_SERVICES[t]);
    cfg.dns ??= [];
    cfg.resolver ??= '';
  }
  if (t === 'router') {
    for (const p of PORTS.router) cfg.ifaces[p] ??= { ip: '', prefix: 24 };
    cfg.ifaces.lo ??= { ip: '', prefix: 32 };
    cfg.routes ??= []; cfg.acl ??= []; cfg.forwarding ??= true;
  }
  if (t === 'switch') {
    cfg.ports ??= {};
    for (const p of PORTS.switch) cfg.ports[p] = { mode: 'access', vlan: 1, allowed: '1-4094', native: 1, edge: false, cost: 4, ...(cfg.ports[p] || {}) };
    cfg.ageing ??= 300;
    cfg.stp = { enabled: false, priority: 32768, timers: 'standard', ...(cfg.stp || {}) };
  }
  if (t === 'vtep') {
    cfg.ifaces.eth1 ??= { ip: '', prefix: 24 };
    cfg.ifaces.lo ??= { ip: '', prefix: 32 };
    cfg.routes ??= []; cfg.vxlans ??= [];
    cfg.ports ??= {};
    for (const p of ['eth2', 'eth3', 'eth4']) cfg.ports[p] ??= { mode: 'access', vlan: 10, allowed: '1-4094', native: 1 };
    cfg.ageing ??= 300;
  }
  return cfg;
}

export function parseVlanList(s) {
  const out = new Set();
  for (const part of String(s ?? '').split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (b - a > 5000) continue;
    for (let i = a; i <= b; i++) if (i >= 1 && i <= 4094) out.add(i);
  }
  return out;
}

// ---------------------------------------------------------------- Geräte
class Device {
  constructor(sim, cfg) { this.sim = sim; this.cfg = cfg; this.id = cfg.id; this.consoleLines = []; }
  get name() { return this.cfg.name; }
  get type() { return this.cfg.type; }
  mac(ifname) {
    const base = this.cfg.ifaces?.[ifname]?.parent || ifname;
    return this.cfg.macs?.[base] || macFor(this.id + '/' + base);
  }
  record(kind, text, extra) { return this.sim.record(this, kind, text, extra); }
  print(text) { this.sim.print(this, text); }
  resetState() { this.consoleLines = []; this.l3?.resetState(); this.bridge?.resetState(); }
  transmit(ifname, frame) { this.sim.transmit(this, ifname, frame); }
}

let ISN = 1000;
const nextIsn = sim => (Math.floor(sim.random() * 4e9) + (ISN += 64000)) >>> 0;

// ---------------------------------------------------------------- Layer 3
class L3 {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.resetState(); }
  resetState() {
    this.arp = new Map(); this.pending = new Map(); this.pmtu = new Map();
    this.reasm = new Map(); this.sessions = new Set(); this.tcp = new Map();
  }
  get cfg() { return this.dev.cfg; }
  get forwarding() { return this.cfg.type === 'router' ? this.cfg.forwarding !== false : false; }
  ifaces() {
    return Object.entries(this.cfg.ifaces || {})
      .filter(([, v]) => v && isIp(v.ip))
      .map(([name, v]) => ({ name, ip: v.ip, prefix: Number(v.prefix ?? 24), vlan: v.vlan ? Number(v.vlan) : null, phys: v.parent || name }));
  }
  phys(ifname) { return this.cfg.ifaces?.[ifname]?.parent || ifname; }
  logicalFor(phys, vid) {
    for (const [k, v] of Object.entries(this.cfg.ifaces || {})) {
      if ((v.parent || k) !== phys) continue;
      if (Number(v.vlan || 0) === (vid || 0)) return k;
    }
    return null;
  }
  isOwn(ip) { return this.ifaces().some(i => i.ip === ip); }
  ifIp(ifname) { return this.ifaces().find(i => i.name === ifname)?.ip || null; }
  mtu(ifname) { return ifname === 'lo' ? 65536 : this.sim.mtuOf(this.dev.id, this.phys(ifname)); }
  linkUp(ifname) { if (ifname === 'lo') return true; const l = this.sim.linkAt(this.dev.id, this.phys(ifname)); return !!l && l.up; }

  routes() {
    const out = [];
    for (const i of this.ifaces()) {
      if (i.name === 'lo') continue;
      out.push({ net: intToIp(netOf(i.ip, i.prefix)), len: i.prefix, via: null, dev: i.name, proto: 'C', src: i.ip });
    }
    const statics = [...(this.cfg.routes || [])];
    if ((this.cfg.type === 'pc' || this.cfg.type === 'server') && isIp(this.cfg.gw)) statics.push({ dst: 'default', via: this.cfg.gw, auto: true });
    for (const r of statics) {
      const p = parseCidr(r.dst);
      if (!p || !isIp(r.via)) continue;
      const nh = out.find(c => c.proto === 'C' && inNet(r.via, c.net, c.len));
      out.push({ net: p.net, len: p.len, via: r.via, dev: nh ? nh.dev : null, proto: 'S', active: !!nh, auto: r.auto });
    }
    return out;
  }
  lookup(dst) {
    let best = null;
    for (const r of this.routes()) {
      if (r.proto === 'S' && !r.dev) continue;
      if (!inNet(dst, r.net, r.len)) continue;
      if (!best || r.len > best.len || (r.len === best.len && best.proto === 'S' && r.proto === 'C')) best = r;
    }
    return best;
  }
  srcFor(dst) {
    const r = this.lookup(dst);
    if (r) return this.ifIp(r.dev) || this.ifaces()[0]?.ip;
    return this.ifaces()[0]?.ip || '0.0.0.0';
  }

  // ---- Senden
  output(pkt, ctx = {}) {
    if (this.isOwn(pkt.dst)) { this.sim.schedule(0.01, () => this.deliver(pkt, 'lo')); return { ok: true }; }
    const r = this.lookup(pkt.dst);
    if (!r) {
      if (ctx.forwarded) {
        this.dev.record('drop', `keine Route zu ${pkt.dst}, sendet ICMP Network Unreachable an ${pkt.src}`, { tag: 'no-route', data: { dst: pkt.dst } });
        this.icmpError(pkt, 3, 0);
      } else this.dev.record('err', `keine Route zu ${pkt.dst}: Network is unreachable`, { tag: 'no-route', data: { dst: pkt.dst } });
      return { ok: false, error: 'Network is unreachable' };
    }
    const mtu = this.mtu(r.dev);
    if (pkt.totalLength > mtu) {
      if (pkt.df) {
        if (ctx.forwarded) {
          this.dev.record('drop', `Paket (${pkt.totalLength} Byte) grösser als MTU ${mtu} von ${r.dev} und DF gesetzt: verworfen, ICMP Fragmentation Needed an ${pkt.src}`, { tag: 'frag-needed-sent', data: { mtu } });
          this.icmpError(pkt, 3, 4, { mtu });
        }
        return { ok: false, error: `message too long, mtu=${mtu}`, mtu };
      }
      const frags = this.fragment(pkt, mtu);
      this.dev.record('info', `Paket (${pkt.totalLength} Byte) grösser als MTU ${mtu}: zerlegt in ${frags.length} Fragmente`, { tag: 'fragmented', data: { count: frags.length, mtu } });
      for (const f of frags) this.l2send(f, r.dev, r.via || pkt.dst);
      return { ok: true };
    }
    this.l2send(pkt, r.dev, r.via || pkt.dst);
    return { ok: true };
  }
  fragment(pkt, mtu) {
    const total = pkt.totalLength - IP_HDR;
    const chunk = Math.floor((mtu - IP_HDR) / 8) * 8;
    const base = pkt.fragOffset || 0;
    const isFirstSrc = !pkt.frag || pkt.frag.first;
    const origL4 = pkt.l4 || pkt.frag?.origL4;
    const fullTotal = pkt.frag ? pkt.frag.total : total;
    const out = [];
    for (let off = 0; off < total; off += chunk) {
      const len = Math.min(chunk, total - off);
      const last = off + len >= total;
      const first = isFirstSrc && off === 0;
      const f = { ...clone(pkt), fragOffset: base + off, mf: last ? pkt.mf : true,
        l4: first ? clone(origL4) : null, frag: { first, len, total: fullTotal, origL4: clone(origL4) } };
      f.totalLength = IP_HDR + len;
      f.checksum = ipChecksum(f);
      out.push(f);
    }
    return out;
  }
  l2send(pkt, egress, nh) {
    const e = this.arp.get(nh);
    if (e && e.mac && e.ifname === egress && e.state !== 'INCOMPLETE' && e.state !== 'FAILED') {
      this.sendFrame(egress, e.mac, 'ipv4', pkt);
      this.nudCheck(nh, e);
      return;
    }
    if (!this.pending.has(nh)) this.pending.set(nh, []);
    this.pending.get(nh).push({ pkt, egress });
    if (!e || e.state !== 'INCOMPLETE') this.startArp(nh, egress);
  }
  sendFrame(egress, dstMac, type, payload) {
    const c = this.cfg.ifaces?.[egress];
    const phys = c?.parent || egress;
    const vlanId = c?.vlan;
    const frame = ethFrame(this.dev.mac(phys), dstMac, type, payload, vlanId ? { vid: Number(vlanId), pcp: 0 } : null);
    this.dev.transmit(phys, frame);
  }
  startArp(nh, egress) {
    const myIp = this.ifIp(egress);
    const entry = { mac: null, ifname: egress, t: this.sim.time, state: 'INCOMPLETE', tries: 0 };
    this.arp.set(nh, entry);
    const ask = () => {
      if (this.arp.get(nh) !== entry || entry.mac) return;
      if (entry.tries >= T.arpRetries) {
        entry.state = 'FAILED';
        this.dev.record('err', `keine ARP-Antwort von ${nh} nach ${T.arpRetries} Versuchen`, { tag: 'arp-failed', data: { ip: nh } });
        const q = this.pending.get(nh) || [];
        this.pending.delete(nh);
        for (const { pkt } of q) {
          if (this.isOwn(pkt.src)) for (const s of [...this.sessions]) s.onArpFail?.(pkt);
          else this.icmpError(pkt, 3, 1);
        }
        return;
      }
      entry.tries++;
      this.dev.record('info', `kennt die MAC von ${nh} nicht und fragt per ARP (Versuch ${entry.tries})`, { tag: 'arp-request-sent', data: { ip: nh } });
      this.sendFrame(egress, BCAST, 'arp', arpPacket(1, this.dev.mac(egress), myIp, null, nh));
      this.sim.schedule(T.arpTimeout, ask);
    };
    ask();
  }
  // Neighbor Unreachability Detection: veraltete Einträge prüfen
  nudCheck(nh, e) {
    if (this.sim.time - e.t <= T.reachable || e.probing) return;
    e.probing = true; e.state = 'DELAY';
    this.sim.schedule(T.nudDelay, () => {
      if (this.arp.get(nh) !== e) return;
      if (this.sim.time - e.t <= T.reachable) { e.probing = false; e.state = 'REACHABLE'; return; }
      e.state = 'PROBE';
      let n = 0;
      const probe = () => {
        if (this.arp.get(nh) !== e) return;
        if (this.sim.time - e.t <= T.reachable) { e.probing = false; e.state = 'REACHABLE'; return; }
        if (n++ >= T.nudProbes) {
          this.arp.delete(nh);
          this.dev.record('err', `${nh} antwortet nicht mehr unter ${e.mac}: ARP-Eintrag gelöscht (FAILED). Das nächste Paket löst eine neue ARP-Anfrage aus.`, { tag: 'nud-failed', data: { ip: nh } });
          return;
        }
        this.dev.record('info', `prüft per Unicast-ARP, ob ${nh} noch bei ${e.mac} erreichbar ist (Probe ${n})`, { tag: 'nud-probe', data: { ip: nh } });
        this.sendFrame(e.ifname, e.mac, 'arp', arpPacket(1, this.dev.mac(e.ifname), this.ifIp(e.ifname), null, nh));
        this.sim.schedule(1000, probe);
      };
      probe();
    });
  }
  learnArp(ip, mac, ifname, how, quiet = false) {
    const old = this.arp.get(ip);
    const changed = !old || old.mac !== mac;
    this.arp.set(ip, { mac, ifname, t: this.sim.time, state: 'REACHABLE' });
    if (changed && !quiet) this.dev.record('learn', `trägt ${ip} → ${mac} in die ARP-Tabelle ein (${how})`, { tag: 'arp-learned', data: { ip, mac } });
    const q = this.pending.get(ip);
    if (q) { this.pending.delete(ip); for (const { pkt, egress } of q) this.sendFrame(egress, mac, 'ipv4', pkt); }
  }
  arpTable() {
    return [...this.arp.entries()].map(([ip, e]) => ({ ip, mac: e.mac, ifname: e.ifname,
      state: e.state === 'REACHABLE' && this.sim.time - e.t > T.reachable ? 'STALE' : e.state }));
  }

  // ---- Empfangen
  receive(phys, frame) {
    if (frame.type === 'stp') return;
    const vid = frame.vlan ? frame.vlan.vid : 0;
    const ifname = this.logicalFor(phys, vid);
    if (!ifname) {
      this.dev.record('drop', vid ? `verwirft Frame mit VLAN-Tag ${vid} auf ${phys}: kein passendes (Sub-)Interface` : `verwirft Frame ohne VLAN-Tag auf ${phys}: Interface erwartet einen Tag`,
        { frame, tag: 'vlan-mismatch' });
      return;
    }
    const myMac = this.dev.mac(phys);
    if (frame.dst !== myMac && frame.dst !== BCAST) {
      this.dev.record('ignore', `sieht einen Frame an ${frame.dst} auf ${phys}: nicht für mich, verworfen`,
        { frame, tag: 'frame-not-mine', data: { type: frame.type, kind: frame.type === 'ipv4' ? frame.payload.l4?.kind : 'arp' } });
      return;
    }
    // Erreichbarkeit bestätigen: Verkehr vom Nachbarn hält den ARP-Eintrag frisch
    for (const e of this.arp.values()) if (e.mac === frame.src && e.ifname === ifname && e.state !== 'INCOMPLETE') { e.t = this.sim.time; e.state = 'REACHABLE'; e.probing = false; }
    if (frame.type === 'arp') return this.rxArp(ifname, frame);
    if (frame.type === 'ipv4') return this.rxIp(ifname, frame.payload, frame);
  }
  rxArp(ifname, frame) {
    const a = frame.payload;
    const myIp = this.ifIp(ifname);
    const myMac = this.dev.mac(ifname);
    for (const s of [...this.sessions]) s.onArp?.(a, ifname);
    if (a.spa === a.tpa && a.spa !== '0.0.0.0') {
      if (myIp && a.spa === myIp && a.sha !== myMac) {
        this.dev.record('err', `Adresskonflikt: ${a.sha} meldet ebenfalls ${myIp}`, { frame, tag: 'ip-conflict' });
        return;
      }
      const e = this.arp.get(a.spa);
      if (e && e.mac) {
        if (e.mac !== a.sha) this.dev.record('learn', `aktualisiert ${a.spa}: ${e.mac} → ${a.sha} (Gratuitous ARP)`, { frame, tag: 'garp-updated', data: { ip: a.spa, mac: a.sha } });
        this.learnArp(a.spa, a.sha, ifname, 'Gratuitous ARP', true);
      } else this.dev.record('ignore', `Gratuitous ARP von ${a.spa}: kein Eintrag vorhanden, nichts zu aktualisieren`, { frame, tag: 'garp-ignored' });
      return;
    }
    if (a.op === 1 && a.spa === '0.0.0.0') {
      if (myIp && a.tpa === myIp) {
        this.dev.record('info', `beantwortet eine ARP-Probe: ${myIp} ist bereits vergeben`, { frame, tag: 'dad-reply' });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, '0.0.0.0'));
      }
      return;
    }
    if (a.op === 1) {
      if (myIp && a.tpa === myIp) {
        this.learnArp(a.spa, a.sha, ifname, 'aus der Anfrage gelernt');
        this.dev.record('info', `beantwortet die ARP-Anfrage: ${myIp} ist bei ${myMac}`, { tag: 'arp-reply-sent', data: { ip: myIp } });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, a.spa));
      } else this.dev.record('ignore', `ARP-Anfrage für ${a.tpa} ist nicht für mich, ignoriert`, { frame, tag: 'arp-ignored' });
    } else if (a.op === 2) {
      if (a.tpa === '0.0.0.0') return;
      if (this.arp.has(a.spa) || this.pending.has(a.spa)) this.learnArp(a.spa, a.sha, ifname, 'aus der Antwort');
      else this.dev.record('ignore', `ungefragte ARP-Antwort von ${a.spa} ignoriert`, { frame, tag: 'arp-unsolicited' });
    }
  }
  rxIp(ifname, ip, frame) {
    if (this.isOwn(ip.dst)) {
      if (ip.frag) return this.reassemble(ip, ifname);
      return this.deliver(ip, ifname, frame);
    }
    if (!this.forwarding) {
      this.dev.record('drop', `Paket an ${ip.dst} ist nicht für mich, und ich leite nicht weiter (ip_forward=0)`, { frame, tag: 'not-forwarding' });
      return;
    }
    this.forward(ip, ifname, frame);
  }
  aclMatch(ip) {
    const rules = this.cfg.acl || [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const proto = r.proto || 'any';
      const pn = { icmp: PROTO.ICMP, udp: PROTO.UDP, tcp: PROTO.TCP }[proto];
      if (proto !== 'any' && ip.proto !== pn) continue;
      if (proto === 'icmp' && r.icmpType !== undefined && r.icmpType !== '' && r.icmpType !== null) {
        if (!ip.l4 || ip.l4.type !== Number(r.icmpType)) continue;
      }
      if ((proto === 'tcp' || proto === 'udp') && r.port) {
        if (!ip.l4 || ip.l4.dport !== Number(r.port)) continue;
      }
      const s = parseCidr(r.src || 'any'), d = parseCidr(r.dst || 'any');
      if (s && !inNet(ip.src, s.net, s.len)) continue;
      if (d && !inNet(ip.dst, d.net, d.len)) continue;
      return { rule: r, index: i + 1 };
    }
    return null;
  }
  forward(ip, inIf, frame) {
    const m = this.aclMatch(ip);
    if (m && m.rule.action !== 'allow') {
      this.dev.record('drop', `Regel ${m.index} (${m.rule.action === 'reject' ? 'ablehnen' : 'verwerfen'}) trifft: Paket ${ip.src} > ${ip.dst} wird nicht weitergeleitet`, { frame, tag: 'acl-drop', data: { rule: m.index } });
      if (m.rule.action === 'reject') {
        if (ip.proto === PROTO.TCP && ip.l4?.flags?.SYN) this.sendTcp(ip.src, tcp(ip.l4.dport, ip.l4.sport, 0, ip.l4.seq + 1, { RST: true, ACK: true }), ip.dst);
        else this.icmpError(ip, 3, 13);
      }
      return;
    }
    if (ip.ttl <= 1) {
      this.dev.record('drop', `TTL von ${ip.src} > ${ip.dst} ist abgelaufen, sendet ICMP Time Exceeded an ${ip.src}`, { frame, tag: 'ttl-expired' });
      this.icmpError(ip, 11, 0);
      return;
    }
    const r = this.lookup(ip.dst);
    const out = clone(ip);
    out.ttl = ip.ttl - 1;
    const clamp = Number(this.cfg.mssClamp || 0);
    if (clamp && out.proto === PROTO.TCP && out.l4?.flags?.SYN && out.l4.mss > clamp) {
      this.dev.record('info', `passt die MSS im SYN von ${out.l4.mss} auf ${clamp} an (MSS Clamping)`, { frame, tag: 'mss-clamped', data: { from: out.l4.mss, to: clamp } });
      out.l4.mss = clamp;
    }
    out.checksum = ipChecksum(out);
    if (r) this.dev.record('fwd', `leitet ${ip.src} > ${ip.dst} weiter: Route ${r.net}/${r.len}${r.via ? ' via ' + r.via : ' direkt'} über ${r.dev}, TTL ${ip.ttl} → ${out.ttl}`,
      { frame, tag: 'forwarded', data: { dst: ip.dst, route: `${r.net}/${r.len}`, from: inIf, to: r.dev } });
    this.output(out, { forwarded: true, inIf });
  }
  icmpError(orig, type, code, extra = {}) {
    if (orig.proto === PROTO.ICMP && orig.l4 && ![0, 8].includes(orig.l4.type)) return;
    if (orig.frag && !orig.frag.first) return;
    const src = this.srcFor(orig.src);
    const o = orig.l4 || {};
    const pkt = ipPacket({ src, dst: orig.src, proto: PROTO.ICMP,
      l4: icmp(type, code, { dataLen: 28, mtu: extra.mtu,
        orig: { src: orig.src, dst: orig.dst, proto: orig.proto, ident: o.ident, seq: o.seq, sport: o.sport, dport: o.dport } }) });
    this.output(pkt, {});
  }
  reassemble(ip, ifname) {
    const key = `${ip.src}|${ip.id}`;
    let r = this.reasm.get(key);
    if (!r) { r = { parts: [], got: 0 }; this.reasm.set(key, r); }
    r.parts.push(ip); r.got += ip.frag.len;
    if (r.got >= ip.frag.total && r.parts.some(p => !p.mf)) {
      this.reasm.delete(key);
      const first = r.parts.find(p => p.frag.first) || r.parts[0];
      const full = clone(first);
      full.l4 = clone(first.frag.origL4);
      delete full.frag;
      full.mf = false; full.fragOffset = 0; full.totalLength = IP_HDR + ip.frag.total;
      this.dev.record('info', `setzt ${r.parts.length} Fragmente wieder zu einem Paket mit ${full.totalLength} Byte zusammen`, { tag: 'reassembled' });
      this.deliver(full, ifname);
    }
  }
  service(proto, port) { return (this.cfg.services || []).find(s => s.proto === proto && Number(s.port) === port); }
  deliver(ip, ifname, frame) {
    const l4 = ip.l4;
    if (!l4) return;
    if (l4.kind === 'icmp') {
      if (l4.type === 8) {
        this.dev.record('ok', `erhält Echo Request von ${ip.src} (seq ${l4.seq}) und antwortet`, { frame, tag: 'echo-request-received', data: { from: ip.src } });
        this.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.ICMP, df: ip.df, trace: ip.trace, l4: icmp(0, 0, { ident: l4.ident, seq: l4.seq, dataLen: l4.dataLen }) }), {});
        return;
      }
      if (l4.type === 0) {
        this.dev.record('ok', `erhält Echo Reply von ${ip.src} (seq ${l4.seq})`, { frame, tag: 'echo-reply-received', data: { from: ip.src, size: l4.dataLen } });
        for (const s of [...this.sessions]) s.onEchoReply?.(ip);
        return;
      }
      if (l4.type === 3 || l4.type === 11) {
        if (l4.type === 3 && l4.code === 4 && l4.mtu && l4.orig) {
          this.pmtu.set(l4.orig.dst, l4.mtu);
          this.dev.record('learn', `merkt sich: Weg zu ${l4.orig.dst} hat MTU ${l4.mtu} (Path MTU Discovery)`, { frame, tag: 'pmtu-learned', data: { mtu: l4.mtu } });
          if (l4.orig.proto === PROTO.TCP) this.tcpPmtu(l4.orig, l4.mtu);
        } else this.dev.record('err', `erhält ICMP ${icmpName(l4.type, l4.code)} von ${ip.src}`, { frame, tag: 'icmp-error-received', data: { type: l4.type, code: l4.code } });
        for (const s of [...this.sessions]) s.onIcmpError?.(ip);
      }
      return;
    }
    if (l4.kind === 'tcp') return this.onTcp(ip, frame);
    if (l4.kind === 'udp') {
      if (this.dev.onUdp?.(ip, ifname, frame)) return;
      for (const s of [...this.sessions]) if (s.onUdp?.(ip)) return;
      const svc = this.service('udp', l4.dport);
      if (svc) {
        if (l4.payload?.kind === 'dns' && !l4.payload.qr) return this.answerDns(ip, svc, frame);
        this.dev.record('ok', `empfängt ein UDP-Datagramm von ${ip.src}:${l4.sport} an Port ${l4.dport} (${svc.name || 'Dienst'})`, { frame, tag: 'udp-received', data: { port: l4.dport, from: ip.src } });
        return;
      }
      this.dev.record('info', `UDP-Port ${l4.dport} ist geschlossen, sendet ICMP Port Unreachable an ${ip.src}`, { frame, tag: 'port-unreachable-sent', data: { port: l4.dport } });
      this.icmpError(ip, 3, 3);
    }
  }
  answerDns(ip, svc, frame) {
    const q = ip.l4.payload;
    const name = q.qname.toLowerCase().replace(/\.$/, '');
    const recs = (this.cfg.dns || []).filter(r => String(r.name).toLowerCase().replace(/\.$/, '') === name && isIp(r.ip));
    const ans = { kind: 'dns', id: q.id, qr: 1, qname: q.qname, answers: recs.map(r => ({ name: q.qname, ip: r.ip })), rcode: recs.length ? 'NOERROR' : 'NXDOMAIN' };
    this.dev.record('ok', `beantwortet die DNS-Anfrage für ${q.qname}: ${recs.length ? recs.map(r => r.ip).join(', ') : 'NXDOMAIN (unbekannt)'}`, { frame, tag: 'dns-answered', data: { name: q.qname, found: !!recs.length } });
    this.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.UDP, trace: ip.trace, l4: udp(ip.l4.dport, ip.l4.sport, ans) }), {});
  }

  // ---- TCP
  sendResponse(c, mss, from) {
    const end = c.resp.start + c.resp.total;
    c.curMss = mss;
    let seq = from;
    while (seq < end) {
      const len = Math.min(mss, end - seq);
      this.sendTcp(c.rip, tcp(c.lport, c.rport, seq, c.rcvNxt, { ACK: true, PSH: seq + len >= end }, { dataLen: len, app: seq === c.resp.start ? c.resp.app : null, total: c.resp.total }), c.local);
      seq += len;
    }
    c.sndNxt = Math.max(c.sndNxt, end);
  }
  // Nach ICMP Fragmentation Needed: nicht bestätigte Daten mit kleinerer MSS neu senden
  tcpPmtu(orig, mtu) {
    for (const c of this.tcp.values()) {
      if (c.client || !c.resp || c.lport !== orig.sport || c.rip !== orig.dst || c.rport !== orig.dport) continue;
      const mss = Math.min(c.peerMss, mtu - 40);
      if (mss >= c.curMss || c.acked >= c.resp.start + c.resp.total) continue;
      this.dev.record('info', `sendet die nicht bestätigten Daten ab Byte ${c.acked - c.resp.start} neu, jetzt in Segmenten zu ${mss} Byte`, { tag: 'tcp-retransmit', data: { mss } });
      this.sendResponse(c, mss, c.acked);
    }
  }
  sendTcp(dst, seg, src) {
    seg.dataLen ??= 0;
    const pkt = ipPacket({ src: src || this.srcFor(dst), dst, proto: PROTO.TCP, df: true, l4: seg });
    return this.output(pkt, {});
  }
  mssFor(dst) { const r = this.lookup(dst); return (r ? this.mtu(r.dev) : 1500) - 40; }
  onTcp(ip, frame) {
    const s = ip.l4;
    const key = `${s.dport}|${ip.src}|${s.sport}`;
    const c = this.tcp.get(key);
    if (c?.client) return c.client.onSegment(ip, frame);
    if (!c) {
      if (s.flags.SYN && !s.flags.ACK) {
        const svc = this.service('tcp', s.dport);
        if (!svc) {
          this.dev.record('info', `kein Dienst auf TCP-Port ${s.dport}: antwortet mit RST`, { frame, tag: 'tcp-rst-sent', data: { port: s.dport } });
          this.sendTcp(ip.src, tcp(s.dport, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
          return;
        }
        const conn = { state: 'SYN_RECEIVED', lport: s.dport, rip: ip.src, rport: s.sport, iss: nextIsn(this.sim), rcvNxt: s.seq + 1, peerMss: s.mss || 536, svc, local: ip.dst };
        conn.sndNxt = conn.iss + 1;
        this.tcp.set(key, conn);
        this.dev.record('info', `Dienst ${svc.name || ''} auf Port ${s.dport} nimmt die Verbindung an: SYN/ACK`, { frame, tag: 'tcp-synack-sent', data: { port: s.dport } });
        this.sendTcp(ip.src, tcp(s.dport, s.sport, conn.iss, conn.rcvNxt, { SYN: true, ACK: true }, { mss: this.mssFor(ip.src) }), ip.dst);
        return;
      }
      if (!s.flags.RST) this.sendTcp(ip.src, tcp(s.dport, s.sport, s.ack, s.seq + (s.dataLen || 0), { RST: true, ACK: true }), ip.dst);
      return;
    }
    if (s.flags.RST) { this.tcp.delete(key); this.dev.record('info', `Verbindung zu ${ip.src}:${s.sport} durch RST beendet`, { frame, tag: 'tcp-reset' }); return; }
    if (c.state === 'SYN_RECEIVED' && s.flags.ACK && s.ack === c.sndNxt) {
      c.state = 'ESTABLISHED';
      this.dev.record('ok', `Verbindung mit ${ip.src}:${s.sport} aufgebaut (ESTABLISHED)`, { frame, tag: 'tcp-established', data: { port: c.lport } });
    }
    if (s.dataLen > 0 && s.seq === c.rcvNxt) {
      c.rcvNxt += s.dataLen;
      const total = Number(c.svc.size ?? 2000);
      const mss = Math.min(c.peerMss, this.mssFor(ip.src), (this.pmtu.get(ip.src) || 65535) - 40);
      const n = Math.max(1, Math.ceil(total / mss));
      this.dev.record('info', `erhält ${s.dataLen} Byte${s.app ? ' (' + s.app + ')' : ''} und antwortet mit ${total} Byte in ${n} Segment${n > 1 ? 'en' : ''} (MSS ${mss})`,
        { frame, tag: 'tcp-response', data: { segments: n, bytes: total, mss } });
      c.resp = { start: c.sndNxt, total, app: c.svc.name === 'http' ? `HTTP/1.1 200 OK, ${total} Byte` : c.svc.name === 'ssh' ? 'SSH-2.0-OpenSSH_9.6' : `${c.svc.name || 'Antwort'}` };
      c.acked = c.sndNxt;
      this.sendResponse(c, mss, c.sndNxt);
      return;
    }
    if (c.resp && s.flags.ACK && s.ack > (c.acked ?? 0)) c.acked = s.ack;
    if (s.flags.FIN) {
      c.rcvNxt += 1;
      this.sendTcp(ip.src, tcp(c.lport, c.rport, c.sndNxt, c.rcvNxt, { FIN: true, ACK: true }), c.local);
      c.sndNxt += 1; c.state = 'LAST_ACK';
      this.dev.record('info', `${ip.src} beendet die Verbindung: FIN/ACK zurück`, { frame, tag: 'tcp-fin' });
      return;
    }
    if (c.state === 'LAST_ACK' && s.flags.ACK && s.ack === c.sndNxt) {
      this.tcp.delete(key);
      this.dev.record('ok', `Verbindung mit ${ip.src}:${s.sport} geschlossen`, { frame, tag: 'tcp-closed' });
    }
  }
}

// ---------------------------------------------------------------- Sitzungen
let IDENT = 100;
const pad2 = n => String(n).padStart(2);
class Session {
  constructor(l3) { this.l3 = l3; this.dev = l3.dev; this.sim = l3.sim; this.done = false; }
  begin() { this.l3.sessions.add(this); }
  end() { this.done = true; this.l3.sessions.delete(this); }
}

class PingSession extends Session {
  constructor(l3, dst, o) {
    super(l3);
    Object.assign(this, { dst, count: o.count ?? 4, size: o.size ?? 56, df: !!o.df, ttl: o.ttl ?? 64, noEcho: !!o.noEcho });
    this.ident = IDENT++; this.seq = 0; this.sent = 0; this.received = 0; this.errors = 0; this.open = new Map();
  }
  start() {
    this.begin();
    if (!this.noEcho) this.dev.print(`$ ping -c ${this.count}${this.size !== 56 ? ' -s ' + this.size : ''}${this.df ? ' -M do' : ''}${this.ttl !== 64 ? ' -t ' + this.ttl : ''} ${this.dst}`);
    this.dev.print(`PING ${this.dst}: ${this.size} Byte Daten, ${IP_HDR + ICMP_HDR + this.size} Byte IP-Paket`);
    this.sendNext();
  }
  sendNext() {
    if (this.done) return;
    const seq = ++this.seq;
    const total = IP_HDR + ICMP_HDR + this.size;
    const r = this.l3.lookup(this.dst);
    if (!r && !this.l3.isOwn(this.dst)) { this.dev.print('ping: connect: Network is unreachable'); this.dev.record('err', `ping ${this.dst}: keine Route`, { tag: 'no-route' }); return this.finish(true); }
    const lim = Math.min(this.l3.pmtu.get(this.dst) || Infinity, r ? this.l3.mtu(r.dev) : 65536);
    this.sent++;
    if (this.df && total > lim) {
      this.dev.print(`ping: local error: message too long, mtu=${lim}`);
      this.dev.record('err', `Paket mit ${total} Byte und DF passt nicht (MTU ${lim}), lokal abgelehnt`, { tag: 'local-mtu-error', data: { mtu: lim } });
      this.errors++;
    } else {
      const pkt = ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, ttl: this.ttl, proto: PROTO.ICMP, df: this.df, l4: icmp(8, 0, { ident: this.ident, seq, dataLen: this.size }) });
      const t0 = this.sim.time;
      const ev = this.sim.schedule(T.replyTimeout, () => { if (this.open.has(seq)) { this.open.delete(seq); this.dev.print(`icmp_seq=${seq}: keine Antwort (Timeout)`); this.checkEnd(); } });
      this.open.set(seq, { t0, ev });
      this.l3.output(pkt, {});
    }
    if (this.seq < this.count) this.sim.schedule(T.pingInterval, () => this.sendNext());
    else this.checkEnd();
  }
  take(seq) { const o = this.open.get(seq); if (!o) return null; this.open.delete(seq); this.sim.cancel(o.ev); return o; }
  onEchoReply(ip) {
    const l4 = ip.l4;
    if (l4.ident !== this.ident) return;
    const o = this.take(l4.seq); if (!o) return;
    this.received++;
    this.dev.print(`${ICMP_HDR + l4.dataLen} Byte von ${ip.src}: icmp_seq=${l4.seq} ttl=${ip.ttl} Zeit=${(this.sim.time - o.t0).toFixed(2)} ms`);
    this.checkEnd();
  }
  onIcmpError(ip) {
    const l4 = ip.l4, o = l4.orig;
    if (!o || o.ident !== this.ident || !this.take(o.seq)) return;
    this.errors++;
    const txt = l4.type === 11 ? 'Time to live exceeded' : l4.code === 0 ? 'Destination Net Unreachable' : l4.code === 1 ? 'Destination Host Unreachable'
      : l4.code === 3 ? 'Destination Port Unreachable' : l4.code === 4 ? `Frag needed and DF set (mtu = ${l4.mtu})` : l4.code === 13 ? 'Packet filtered' : icmpName(l4.type, l4.code);
    this.dev.print(`From ${ip.src} icmp_seq=${o.seq} ${txt}`);
    this.checkEnd();
  }
  onArpFail(pkt) {
    const l4 = pkt.l4;
    if (!l4 || l4.kind !== 'icmp' || l4.ident !== this.ident || !this.take(l4.seq)) return;
    this.errors++;
    this.dev.print(`From ${pkt.src} icmp_seq=${l4.seq} Destination Host Unreachable`);
    this.checkEnd();
  }
  checkEnd() { if (this.seq >= this.count && this.open.size === 0) this.finish(); }
  finish(aborted = false) {
    if (this.done) return;
    this.end();
    const loss = this.sent ? Math.round((1 - this.received / this.sent) * 100) : 100;
    if (!aborted) { this.dev.print(`--- ${this.dst} Statistik ---`); this.dev.print(`${this.sent} gesendet, ${this.received} empfangen${this.errors ? `, ${this.errors} Fehler` : ''}, ${loss} % Verlust`); }
    this.dev.record(this.received ? 'ok' : 'err', `ping an ${this.dst} beendet: ${this.received} von ${this.sent} beantwortet`,
      { tag: 'ping-done', data: { dst: this.dst, sent: this.sent, received: this.received, size: this.size, df: this.df } });
  }
}

class TraceSession extends Session {
  constructor(l3, dst, o) { super(l3); Object.assign(this, { dst, max: o.maxHops ?? 8 }); this.ttl = 0; this.port = 33433; this.hops = []; }
  start() { this.begin(); this.dev.print(`$ traceroute -n ${this.dst}`); this.dev.print(`traceroute zu ${this.dst}, höchstens ${this.max} Hops`); this.next(); }
  next() {
    if (this.done) return;
    if (this.ttl >= this.max) return this.finish();
    this.ttl++; this.port++;
    const pkt = ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, ttl: this.ttl, proto: PROTO.UDP, l4: udp(hashFlow(this.dst + this.ttl), this.port, { kind: 'data', len: 32 }) });
    this.t0 = this.sim.time;
    const port = this.port;
    this.timer = this.sim.schedule(T.replyTimeout, () => { if (this.done || this.port !== port) return; this.dev.print(`${pad2(this.ttl)}  *`); this.hops.push('*'); this.next(); });
    const res = this.l3.output(pkt, {});
    if (!res.ok) { this.sim.cancel(this.timer); this.dev.print(`traceroute: ${res.error}`); this.finish(); }
  }
  onIcmpError(ip) {
    const l4 = ip.l4, o = l4.orig;
    if (!o || o.dport !== this.port || this.done) return;
    this.sim.cancel(this.timer);
    const rtt = (this.sim.time - this.t0).toFixed(2);
    this.hops.push(ip.src);
    if (l4.type === 11) { this.dev.print(`${pad2(this.ttl)}  ${ip.src}  ${rtt} ms`); return this.next(); }
    const mark = l4.code === 3 ? '' : l4.code === 0 ? ' !N' : l4.code === 1 ? ' !H' : l4.code === 13 ? ' !X' : ' !';
    this.dev.print(`${pad2(this.ttl)}  ${ip.src}  ${rtt} ms${mark}`);
    this.finish(l4.code === 3);
  }
  onArpFail(pkt) { if (pkt.l4?.dport !== this.port || this.done) return; this.sim.cancel(this.timer); this.dev.print(`${pad2(this.ttl)}  ${pkt.src}  !H`); this.finish(); }
  finish(reached = false) {
    if (this.done) return;
    this.end();
    this.dev.record(reached ? 'ok' : 'err', `traceroute zu ${this.dst} beendet${reached ? ', Ziel erreicht' : ''}`, { tag: 'trace-done', data: { dst: this.dst, reached, hops: this.hops.length, path: this.hops } });
  }
}

class ArpingSession extends Session {
  constructor(l3, target, o) { super(l3); Object.assign(this, { target, mode: o.mode || 'normal', count: o.count ?? (o.mode === 'normal' ? 3 : o.mode === 'dad' ? 2 : 1), ifname: o.ifname }); this.sent = 0; this.replies = 0; }
  start() {
    this.begin();
    const ifn = this.ifname || this.l3.ifaces().find(i => i.name !== 'lo')?.name;
    this.ifname = ifn;
    const myIp = this.l3.ifIp(ifn);
    if (!ifn || !myIp) { this.dev.print('arping: kein Interface mit IP-Adresse'); return this.end(); }
    const flag = { normal: '', gratuitous: '-U ', reply: '-A ', dad: '-D ' }[this.mode];
    this.dev.print(`$ arping ${flag}-c ${this.count} -I ${ifn} ${this.target}`);
    this.dev.print(`ARPING ${this.target} von ${this.mode === 'dad' ? '0.0.0.0' : myIp} ${ifn}`);
    const mac = this.dev.mac(ifn);
    const tick = () => {
      if (this.done) return;
      if (this.sent >= this.count) return this.finish();
      this.sent++;
      let pkt, label;
      if (this.mode === 'gratuitous') { pkt = arpPacket(1, mac, myIp, null, myIp); label = 'gratuitous-sent'; }
      else if (this.mode === 'reply') { pkt = arpPacket(2, mac, myIp, BCAST, myIp); label = 'gratuitous-sent'; }
      else if (this.mode === 'dad') { pkt = arpPacket(1, mac, '0.0.0.0', null, this.target); label = 'dad-sent'; }
      else { pkt = arpPacket(1, mac, myIp, null, this.target); label = 'arping-sent'; }
      this.t0 = this.sim.time;
      this.dev.record('info', this.mode === 'gratuitous' || this.mode === 'reply' ? `kündigt ${myIp} bei ${mac} ungefragt an (Gratuitous ARP)` : this.mode === 'dad' ? `prüft per ARP-Probe, ob ${this.target} schon vergeben ist` : `fragt per arping nach ${this.target}`,
        { tag: label, data: { ip: this.mode === 'dad' ? this.target : myIp } });
      this.l3.sendFrame(ifn, BCAST, 'arp', pkt);
      this.sim.schedule(1000, tick);
    };
    tick();
  }
  onArp(a) {
    if (this.done || a.op !== 2 || a.spa !== this.target || this.mode === 'gratuitous' || this.mode === 'reply') return;
    this.replies++;
    this.dev.print(`Unicast reply from ${a.spa} [${a.sha.toUpperCase()}]  ${(this.sim.time - this.t0).toFixed(2)} ms`);
  }
  finish() {
    if (this.done) return;
    this.end();
    this.dev.print(`${this.sent} Pakete gesendet${this.mode === 'gratuitous' || this.mode === 'reply' ? '' : `, ${this.replies} Antworten`}`);
    if (this.mode === 'dad') this.dev.print(this.replies ? `Adresse ${this.target} ist bereits vergeben (Konflikt).` : `Adresse ${this.target} ist frei.`);
    this.dev.record(this.mode === 'dad' && this.replies ? 'err' : 'ok', `arping beendet (${this.mode})`, { tag: 'arping-done', data: { mode: this.mode, target: this.target, replies: this.replies } });
  }
}

class TcpClient extends Session {
  constructor(l3, dst, port, mode, o = {}) {
    super(l3); Object.assign(this, { dst, port, mode, noEcho: !!o.noEcho });
    this.lport = 49152 + Math.floor(this.sim.random() * 16000); this.state = 'CLOSED'; this.bytes = 0; this.segments = 0; this.expected = null; this.tries = 0;
  }
  get tool() { return this.mode === 'probe' ? 'nc' : 'curl'; }
  start() {
    this.begin();
    if (!this.noEcho) this.dev.print(this.mode === 'probe' ? `$ nc -zv ${this.dst} ${this.port}` : `$ curl http://${this.dst}${this.port !== 80 ? ':' + this.port : ''}/`);
    if (!this.l3.lookup(this.dst) && !this.l3.isOwn(this.dst)) { this.dev.print(`${this.tool}: Network is unreachable`); return this.finish(false); }
    this.key = `${this.lport}|${this.dst}|${this.port}`;
    this.l3.tcp.set(this.key, { client: this, state: 'SYN_SENT', lport: this.lport, rip: this.dst, rport: this.port });
    this.iss = nextIsn(this.sim);
    this.state = 'SYN_SENT';
    this.syn();
  }
  conn() { return this.l3.tcp.get(this.key); }
  setState(s) { this.state = s; const c = this.conn(); if (c) c.state = s; }
  syn() {
    if (this.done || this.state !== 'SYN_SENT') return;
    if (this.tries >= T.tcpSyn.length) {
      this.dev.print(this.mode === 'probe' ? `nc: connect to ${this.dst} port ${this.port} (tcp) timed out` : `curl: (28) Failed to connect to ${this.dst} port ${this.port}: Connection timed out`);
      this.dev.record('err', `TCP-Verbindung zu ${this.dst}:${this.port}: keine Antwort auf SYN (gefiltert?)`, { tag: 'tcp-timeout', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    const wait = T.tcpSyn[this.tries++];
    this.dev.record('info', `öffnet eine TCP-Verbindung zu ${this.dst}:${this.port}: SYN${this.tries > 1 ? ' (Wiederholung ' + (this.tries - 1) + ')' : ''}`, { tag: 'tcp-syn-sent', data: { dst: this.dst, port: this.port } });
    this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.iss, 0, { SYN: true }, { mss: this.l3.mssFor(this.dst) }));
    this.t0 = this.sim.time;
    this.timer = this.sim.schedule(wait, () => this.syn());
  }
  onSegment(ip) {
    const s = ip.l4;
    if (this.done) return;
    if (s.flags.RST) {
      this.sim.cancel(this.timer);
      this.dev.print(this.mode === 'probe' ? `nc: connect to ${this.dst} port ${this.port} (tcp) failed: Connection refused` : `curl: (7) Failed to connect to ${this.dst} port ${this.port}: Connection refused`);
      this.dev.record('err', `${this.dst}:${this.port} lehnt ab (RST): Port geschlossen oder Verbindung abgelehnt`, { tag: 'tcp-refused', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    if (this.state === 'SYN_SENT' && s.flags.SYN && s.flags.ACK && s.ack === this.iss + 1) {
      this.sim.cancel(this.timer);
      this.rcvNxt = s.seq + 1; this.sndNxt = this.iss + 1; this.peerMss = s.mss;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.setState('ESTABLISHED');
      this.dev.record('ok', `Drei-Wege-Handshake mit ${this.dst}:${this.port} abgeschlossen (ESTABLISHED)`, { tag: 'tcp-established', data: { dst: this.dst, port: this.port, client: true } });
      if (this.mode === 'probe') { this.dev.print(`Connection to ${this.dst} ${this.port} port [tcp] succeeded!`); return this.close(); }
      const req = 78;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true, PSH: true }, { dataLen: req, app: 'GET / HTTP/1.1' }));
      this.sndNxt += req;
      this.armStall();
      return;
    }
    if (this.state === 'ESTABLISHED' && s.dataLen > 0 && s.seq === this.rcvNxt) {
      this.rcvNxt += s.dataLen; this.bytes += s.dataLen; this.segments++;
      if (s.total) this.expected = s.total;
      if (s.app) this.dev.print(`< ${s.app}`);
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.armStall();
      if (this.expected !== null && this.bytes >= this.expected) {
        this.dev.print(`${this.bytes} Byte in ${this.segments} Segment${this.segments > 1 ? 'en' : ''} empfangen (MSS ${Math.max(...[s.dataLen, this.firstLen || 0])})`);
        this.close();
      }
      this.firstLen ??= s.dataLen;
      return;
    }
    if (this.state === 'FIN_WAIT' && s.flags.FIN) {
      this.rcvNxt += 1;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.dev.record('ok', `Verbindung zu ${this.dst}:${this.port} sauber geschlossen`, { tag: 'tcp-closed', data: { client: true } });
      this.finish(true);
    }
  }
  armStall() {
    this.sim.cancel(this.timer);
    this.timer = this.sim.schedule(T.tcpStall, () => {
      if (this.done || this.state !== 'ESTABLISHED') return;
      this.dev.print(`curl: (28) Operation timed out after ${T.tcpStall} milliseconds with ${this.bytes} bytes received`);
      this.dev.record('err', `Verbindung zu ${this.dst}:${this.port} steht, aber die Antwort kommt nicht an (${this.bytes} Byte erhalten)`, { tag: 'tcp-stalled', data: { dst: this.dst, port: this.port, bytes: this.bytes } });
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { RST: true, ACK: true }));
      this.finish(false);
    });
  }
  close() {
    this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { FIN: true, ACK: true }));
    this.sndNxt += 1;
    this.setState('FIN_WAIT');
    this.timer = this.sim.schedule(T.replyTimeout, () => this.finish(true));
  }
  onIcmpError(ip) {
    const l4 = ip.l4, o = l4.orig;
    if (!o || o.sport !== this.lport || this.done) return;
    this.sim.cancel(this.timer);
    const txt = l4.type === 11 ? 'TTL abgelaufen' : l4.code === 13 ? 'Communication administratively prohibited' : l4.code === 3 ? 'Connection refused' : 'No route to host';
    this.dev.print(`${this.tool}: ${this.dst} port ${this.port}: ${txt} (ICMP von ${ip.src})`);
    this.finish(false);
  }
  onArpFail(pkt) {
    if (pkt.l4?.kind !== 'tcp' || pkt.l4.sport !== this.lport || this.done) return;
    this.sim.cancel(this.timer);
    this.dev.print(`${this.tool}: ${this.dst} port ${this.port}: No route to host`);
    this.finish(false);
  }
  finish(ok) {
    if (this.done) return;
    this.sim.cancel(this.timer);
    this.end();
    this.l3.tcp.delete(this.key);
    this.dev.record(ok ? 'ok' : 'err', `${this.tool} ${this.dst}:${this.port} beendet`, { tag: 'tcp-done', data: { dst: this.dst, port: this.port, ok: !!ok, bytes: this.bytes, segments: this.segments, mode: this.mode } });
  }
}

class DigSession extends Session {
  constructor(l3, server, name, then = null) { super(l3); Object.assign(this, { server, name, then }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); this.id = Math.floor(this.sim.random() * 65535); }
  print(t) { if (!this.then) this.dev.print(t); }
  start() {
    this.begin();
    this.print(`$ dig @${this.server} ${this.name}`);
    this.t0 = this.sim.time;
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.server), dst: this.server, proto: PROTO.UDP, l4: udp(this.sport, 53, { kind: 'dns', id: this.id, qr: 0, qname: this.name }) }), {});
    if (!res.ok) { this.print(`;; ${res.error}`); return this.finish(false); }
    this.dev.record('info', `fragt ${this.server} per DNS (UDP 53) nach ${this.name}`, { tag: 'dns-query', data: { name: this.name } });
    this.timer = this.sim.schedule(T.dnsTimeout, () => { this.print(';; connection timed out; no servers could be reached'); this.finish(false); });
  }
  onUdp(ip) {
    const l4 = ip.l4;
    if (this.done || l4.dport !== this.sport || l4.payload?.kind !== 'dns' || l4.payload.id !== this.id) return false;
    this.sim.cancel(this.timer);
    const d = l4.payload;
    this.print(`;; ->>HEADER<<- opcode: QUERY, status: ${d.rcode}, id: ${d.id}`);
    if (d.answers.length) { this.print(';; ANSWER SECTION:'); for (const a of d.answers) this.print(`${a.name}.\t300\tIN\tA\t${a.ip}`); }
    this.print(`;; Query time: ${(this.sim.time - this.t0).toFixed(2)} msec`);
    this.print(`;; SERVER: ${this.server}#53(UDP)`);
    this.finish(d.rcode === 'NOERROR', d);
    return true;
  }
  onIcmpError(ip) {
    const o = ip.l4.orig;
    if (!o || o.sport !== this.sport || this.done) return;
    this.sim.cancel(this.timer);
    this.print(`;; communications error to ${this.server}#53: ${ip.l4.code === 3 ? 'connection refused' : 'host unreachable'}`);
    this.finish(false);
  }
  onArpFail(pkt) { if (pkt.l4?.sport === this.sport && !this.done) { this.sim.cancel(this.timer); this.print(`;; communications error to ${this.server}#53: host unreachable`); this.finish(false); } }
  finish(ok, d) {
    if (this.done) return;
    this.end();
    const answer = d?.answers?.[0]?.ip || null;
    this.dev.record(ok ? 'ok' : 'err', ok ? `DNS: ${this.name} ist ${answer}` : `DNS-Abfrage ${this.name} ohne Ergebnis`, { tag: 'dns-done', data: { name: this.name, ok, answer } });
    if (this.then) { if (answer) this.dev.print(`${this.name} → ${answer} (DNS über ${this.server})`); this.then(answer); }
  }
}

class UdpSend extends Session {
  constructor(l3, dst, port, len) { super(l3); Object.assign(this, { dst, port, len }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); }
  start() {
    this.begin();
    this.dev.print(`$ echo test | nc -u -w1 ${this.dst} ${this.port}`);
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, proto: PROTO.UDP, l4: udp(this.sport, this.port, { kind: 'data', len: this.len }) }), {});
    if (!res.ok) { this.dev.print(`nc: ${res.error}`); return this.end(); }
    this.dev.print(`${this.len} Byte als UDP-Datagramm gesendet. UDP wartet auf keine Bestätigung.`);
    this.sim.schedule(2000, () => this.end());
  }
  onIcmpError(ip) { const o = ip.l4.orig; if (!o || o.sport !== this.sport || this.done) return; this.dev.print(`Hinweis: ICMP ${icmpName(ip.l4.type, ip.l4.code)} von ${ip.src} erhalten`); this.end(); }
}

// ---------------------------------------------------------------- Hosts und Router
class Host extends Device {
  constructor(sim, cfg) { super(sim, cfg); this.l3 = new L3(this); }
  receive(ifname, frame) { this.l3.receive(ifname, frame); }
  ping(dst, o = {}) { const s = new PingSession(this.l3, dst, o); s.start(); return s; }
  traceroute(dst, o = {}) { const s = new TraceSession(this.l3, dst, o); s.start(); return s; }
  arping(target, o = {}) { const s = new ArpingSession(this.l3, target, o); s.start(); return s; }
  curl(dst, port = 80, o = {}) { const s = new TcpClient(this.l3, dst, port, 'http', o); s.start(); return s; }
  ncz(dst, port) { const s = new TcpClient(this.l3, dst, port, 'probe'); s.start(); return s; }
  dig(server, name) { const s = new DigSession(this.l3, server, name); s.start(); return s; }
  resolve(name, cb) {
    if (isIp(name)) return cb(name);
    if (!isIp(this.cfg.resolver)) { this.print(`${name}: kein DNS-Server eingetragen`); this.record('err', `kann ${name} nicht auflösen: kein DNS-Server konfiguriert`, { tag: 'dns-no-resolver' }); return cb(null); }
    const s = new DigSession(this.l3, this.cfg.resolver, name, cb); s.start(); return s;
  }
  udpSend(dst, port, len = 32) { const s = new UdpSend(this.l3, dst, port, len); s.start(); return s; }
}
class Router extends Host {}

// ---------------------------------------------------------------- Bridge mit Spanning Tree
const cmpBid = (a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac);
const cmpPort = (a, b) => { const [ap, an] = a.split('.').map(Number), [bp, bn] = b.split('.').map(Number); return (ap - bp) || (an - bn); };
function cmpVec(a, b) {
  return cmpBid(a.root, b.root) || (a.cost - b.cost) || cmpBid(a.bridge, b.bridge) || cmpPort(a.port, b.port) || (a.rx && b.rx ? cmpPort(a.rx, b.rx) : 0);
}
const ROLE_DE = { root: 'Root-Port', designated: 'Designated', alternate: 'Alternate (blockiert)', disabled: 'deaktiviert' };
const STATE_DE = { blocking: 'Blocking', listening: 'Listening', learning: 'Learning', forwarding: 'Forwarding', disabled: 'Disabled' };

class Bridge {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.resetState(); }
  resetState() { this.fdb = new Map(); this.seen = new Map(); this.stp = null; }
  get cfg() { return this.dev.cfg; }
  get ageingMs() { return Number(this.cfg.ageing ?? 300) * 1000; }
  portCfg(p) { return this.dev.portCfg(p); }
  allPorts() { return this.dev.bridgePorts(); }
  stpOn() { return !!this.stp; }
  vidIn(p, frame) {
    const c = this.portCfg(p);
    if (!c) return null;
    if (c.mode === 'trunk') {
      if (frame.vlan) return parseVlanList(c.allowed).has(frame.vlan.vid) ? frame.vlan.vid : null;
      return c.native ? Number(c.native) : null;
    }
    return frame.vlan ? null : Number(c.vlan || 1);
  }
  carries(p, vid) {
    const c = this.portCfg(p);
    if (!c) return false;
    if (this.stp && !p.startsWith('vxlan') && this.stp.ports.get(p)?.state !== 'forwarding') return false;
    if (c.mode === 'trunk') return parseVlanList(c.allowed).has(vid) || Number(c.native) === vid;
    return Number(c.vlan || 1) === vid;
  }
  entry(vid, mac) {
    const e = this.fdb.get(vid + '|' + mac);
    if (!e) return null;
    if (this.sim.time - e.t > this.ageingMs) { this.fdb.delete(vid + '|' + mac); return null; }
    return e;
  }
  table() {
    const out = [];
    for (const [k, e] of this.fdb) {
      const [vid, mac] = k.split('|');
      const age = (this.sim.time - e.t) / 1000;
      if (age * 1000 > this.ageingMs) continue;
      out.push({ vid: Number(vid), mac, port: e.port, remote: e.remote || null, age });
    }
    return out.sort((a, b) => a.vid - b.vid || a.port.localeCompare(b.port));
  }
  receive(p, frame, from = {}) {
    if (frame.type === 'stp') { if (this.stp) this.stpReceive(p, frame); return; }
    const ps = this.stp && !p.startsWith('vxlan') ? this.stp.ports.get(p) : null;
    if (ps && (ps.state === 'blocking' || ps.state === 'listening' || ps.state === 'disabled')) {
      this.dev.record('drop', `${p} ist im Zustand ${STATE_DE[ps.state]} (STP): Frame verworfen`, { frame, tag: 'stp-drop', data: { port: p, state: ps.state } });
      return;
    }
    const vid = from.vid ?? this.vidIn(p, frame);
    if (vid === null) {
      this.dev.record('drop', `Frame auf ${p} passt zu keinem erlaubten VLAN (${frame.vlan ? 'Tag ' + frame.vlan.vid : 'ohne Tag'}), verworfen`, { frame, tag: 'vlan-drop', data: { port: p } });
      return;
    }
    const inner = clone(frame); inner.vlan = null;
    if (this.ageingMs > 0 && !isGroupMac(frame.src) && from.learning !== false) {
      const key = vid + '|' + frame.src;
      const old = this.fdb.get(key);
      this.fdb.set(key, { port: p, t: this.sim.time, remote: from.remote || null });
      if (!old || old.port !== p || old.remote !== (from.remote || null)) {
        const flap = old && old.port !== p && this.sim.time - old.t < 1000;
        this.dev.record('learn', flap ? `MAC-Flapping: ${frame.src} springt von ${old.port} zu ${p}` : `lernt: ${frame.src} ist in VLAN ${vid} an ${p}${from.remote ? ' (hinter VTEP ' + from.remote + ')' : ''}`,
          { tag: flap ? 'mac-flap' : 'mac-learned', data: { mac: frame.src, port: p, vid, remote: from.remote || null } });
      }
    }
    if (ps && ps.state === 'learning') { this.dev.record('drop', `${p} ist im Zustand Learning: MAC gelernt, Frame aber nicht weitergeleitet`, { frame, tag: 'stp-learning' }); return; }
    const e = !isGroupMac(frame.dst) && this.ageingMs > 0 ? this.entry(vid, frame.dst) : null;
    if (e && (!this.stp || e.port.startsWith('vxlan') || this.stp.ports.get(e.port)?.state === 'forwarding')) {
      if (e.port === p) { this.dev.record('drop', `Ziel ${frame.dst} liegt am selben Port ${p}, Frame wird gefiltert`, { frame, tag: 'filtered' }); return; }
      this.dev.record('fwd', `leitet an ${e.port} weiter (MAC-Tabelle: ${frame.dst})`, { frame, tag: 'switched', data: { port: e.port } });
      this.egress(e.port, inner, vid, e.remote);
      return;
    }
    // Schleifenerkennung: derselbe Broadcast kommt immer wieder
    if (isGroupMac(frame.dst) || !e) {
      const n = (this.seen.get(frame.id) || 0) + 1;
      this.seen.set(frame.id, n);
      if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
      if (n === 2) this.dev.record('err', `sieht denselben Frame (${frame.type === 'arp' ? 'ARP' : 'IP'} von ${frame.src}) zum zweiten Mal: Das Netz hat eine Schleife!`, { frame, tag: 'loop-detected' });
      if (n >= T.loopHalt) return this.sim.halt(this.dev, `Broadcast-Sturm: ${this.dev.name} hat denselben Frame ${n}-mal geflutet. Ethernet hat keine TTL, ohne Spanning Tree kreist er ewig. Simulation angehalten.`);
    }
    const why = frame.dst === BCAST ? 'Broadcast' : isGroupMac(frame.dst) ? 'Multicast' : this.ageingMs === 0 ? 'Aging 0: lernt nichts, flutet alles' : `Ziel ${frame.dst} unbekannt`;
    const targets = this.allPorts().filter(x => x !== p && this.carries(x, vid) && !(from.remote && x.startsWith('vxlan')));
    this.dev.record('fwd', targets.length ? `flutet an ${targets.join(', ')} (${why})` : `kein weiterer Port in VLAN ${vid} (${why})`, { frame, tag: 'flooded', data: { ports: targets, why } });
    for (const t of targets) this.egress(t, inner, vid, null);
  }
  egress(p, inner, vid, remote) {
    if (p.startsWith('vxlan')) return this.dev.vxlanOut(p, inner, remote);
    const c = this.portCfg(p);
    const f = clone(inner);
    if (c.mode === 'trunk' && Number(c.native) !== vid) f.vlan = { vid, pcp: 0 };
    this.dev.transmit(p, f);
  }

  // ---------- Spanning Tree (IEEE 802.1D, vereinfacht)
  timers() { return STP_PRESETS[this.cfg.stp.timers] || STP_PRESETS.standard; }
  myId() { return { prio: Number(this.cfg.stp.priority ?? 32768), mac: macFor(this.dev.id + '/bridge') }; }
  portId(p) { return `128.${PORTS.switch.indexOf(p) + 1}`; }
  physUp(p) { const l = this.sim.linkAt(this.dev.id, p); return !!l && l.up; }
  stpStart() {
    if (this.stp) return;
    this.stp = { ports: new Map(), rootPort: null, rootId: this.myId(), rootCost: 0, tcUntil: 0, lastFlush: -1e9, timer: null };
    this.dev.record('info', `startet Spanning Tree (Bridge ID ${fmtBid(this.myId())}) und hält sich zunächst selbst für die Root`, { tag: 'stp-start' });
    for (const p of PORTS.switch) this.stp.ports.set(p, { role: 'disabled', state: 'disabled', info: null, timer: null, edge: false });
    this.stpRecompute(true);
    const tick = () => { if (!this.stp) return; this.stpHello(); this.stp.timer = this.sim.schedule(this.timers().hello * 1000, tick); };
    this.stp.timer = this.sim.schedule(5 + this.sim.random() * 20, tick);
  }
  stpStop() {
    if (!this.stp) return;
    this.sim.cancel(this.stp.timer);
    for (const ps of this.stp.ports.values()) this.sim.cancel(ps.timer);
    this.stp = null;
    this.dev.record('info', 'Spanning Tree ausgeschaltet: alle Ports leiten sofort weiter', { tag: 'stp-stop' });
  }
  stpHello() {
    const now = this.sim.time, { maxAge } = this.timers();
    let changed = false;
    for (const [p, ps] of this.stp.ports) {
      if (ps.info && now - ps.info.t > maxAge * 1000) {
        ps.info = null; changed = true;
        this.dev.record('err', `${p}: seit ${maxAge} s keine BPDU mehr (Max Age), die gespeicherte Information verfällt`, { tag: 'stp-maxage', data: { port: p } });
      }
    }
    if (changed) this.stpRecompute();
    const { hello, fwd } = this.timers();
    const amRoot = !this.stp.rootPort;
    const rootInfo = this.stp.rootPort ? this.stp.ports.get(this.stp.rootPort).info : null;
    for (const [p, ps] of this.stp.ports) {
      if (ps.role !== 'designated' || !this.physUp(p)) continue;
      const bpdu = { root: this.stp.rootId, cost: this.stp.rootCost, bridge: this.myId(), port: this.portId(p), age: amRoot ? 0 : (rootInfo?.age ?? 0) + 1,
        maxAge, hello, fwd, tc: now < this.stp.tcUntil };
      this.dev.transmit(p, ethFrame(this.dev.mac(p), STP_MAC, 'stp', bpdu));
    }
  }
  stpReceive(p, frame) {
    const ps = this.stp.ports.get(p);
    if (!ps || !this.physUp(p)) return;
    const b = frame.payload;
    if (ps.edge) { ps.edge = false; ps.edgeLost = true; this.dev.record('err', `${p} ist als Edge-Port konfiguriert, empfängt aber eine BPDU: verliert den Edge-Status`, { frame, tag: 'stp-edge-lost', data: { port: p } }); }
    const isNew = !ps.info || cmpBid(ps.info.root, b.root) || ps.info.cost !== b.cost || cmpBid(ps.info.bridge, b.bridge);
    ps.info = { root: b.root, cost: b.cost, bridge: b.bridge, port: b.port, age: b.age, t: this.sim.time };
    if (isNew) this.dev.record('learn', `${p} empfängt BPDU: Root ${fmtBid(b.root)}, Kosten ${b.cost}, von ${fmtBid(b.bridge)}`, { frame, tag: 'stp-bpdu', data: { port: p } });
    if (b.tc && p === this.stp.rootPort && this.sim.time - this.stp.lastFlush > 5000) {
      this.stp.lastFlush = this.sim.time;
      this.fdb.clear();
      this.stp.tcUntil = Math.max(this.stp.tcUntil, this.sim.time + this.timers().fwd * 1000);
      this.dev.record('info', 'Topologieänderung gemeldet: MAC-Tabelle geleert, Adressen werden neu gelernt', { tag: 'stp-tc-flush' });
    }
    this.stpRecompute();
  }
  stpRecompute(initial = false) {
    const st = this.stp, me = this.myId();
    let best = null, rootPort = null;
    for (const [p, ps] of st.ports) {
      if (!ps.info || !this.physUp(p)) continue;
      const cost = Number(this.portCfg(p).cost || 4);
      const cand = { root: ps.info.root, cost: ps.info.cost + cost, bridge: ps.info.bridge, port: ps.info.port, rx: this.portId(p) };
      if (cmpBid(cand.root, me) >= 0) continue;
      if (!best || cmpVec(cand, best) < 0) { best = cand; rootPort = p; }
    }
    const oldRoot = st.rootId;
    st.rootPort = rootPort;
    st.rootId = best ? best.root : me;
    st.rootCost = best ? best.cost : 0;
    if (cmpBid(oldRoot, st.rootId) !== 0 && !initial) {
      this.dev.record('info', rootPort ? `neue Root Bridge: ${fmtBid(st.rootId)}, Root-Port ${rootPort}, Kosten ${st.rootCost}` : 'ist jetzt selbst die Root Bridge', { tag: 'stp-root', data: { root: fmtBid(st.rootId), rootPort } });
    }
    for (const [p, ps] of st.ports) {
      let role;
      if (!this.physUp(p)) role = 'disabled';
      else if (p === rootPort) role = 'root';
      else {
        const offer = { root: st.rootId, cost: st.rootCost, bridge: me, port: this.portId(p) };
        role = !ps.info || cmpVec(offer, ps.info) < 0 ? 'designated' : 'alternate';
      }
      this.setRole(p, ps, role, initial);
    }
  }
  setRole(p, ps, role, initial) {
    const prev = ps.role;
    ps.role = role;
    const cfgEdge = !!this.portCfg(p).edge;
    if (role === 'disabled') { this.sim.cancel(ps.timer); ps.state = 'disabled'; ps.edge = false; ps.edgeLost = false; return; }
    ps.edge = cfgEdge && !ps.edgeLost;
    if (role !== prev && !initial) this.dev.record('info', `${p} wird ${ROLE_DE[role]}`, { tag: 'stp-role', data: { port: p, role } });
    if (role === 'alternate') {
      if (ps.state !== 'blocking') {
        const wasFwd = ps.state === 'forwarding';
        this.sim.cancel(ps.timer); ps.state = 'blocking';
        this.dev.record('info', `${p}: Zustand Blocking (verhindert eine Schleife)`, { tag: 'stp-state', data: { port: p, state: 'blocking' } });
        if (wasFwd) this.topologyChange();
      }
      return;
    }
    if (ps.edge && role === 'designated') {
      if (ps.state !== 'forwarding') { this.sim.cancel(ps.timer); ps.state = 'forwarding'; this.dev.record('info', `${p} ist Edge-Port (PortFast): sofort Forwarding`, { tag: 'stp-state', data: { port: p, state: 'forwarding', edge: true } }); }
      return;
    }
    if (ps.state === 'blocking' || ps.state === 'disabled') {
      ps.state = 'listening';
      this.dev.record('info', `${p}: Zustand Listening (${this.timers().fwd} s, leitet noch nichts weiter)`, { tag: 'stp-state', data: { port: p, state: 'listening' } });
      const fwd = this.timers().fwd * 1000;
      ps.timer = this.sim.schedule(fwd, () => {
        if (!this.stp || ps.state !== 'listening') return;
        ps.state = 'learning';
        this.dev.record('info', `${p}: Zustand Learning (${this.timers().fwd} s, lernt MAC-Adressen, leitet noch nicht weiter)`, { tag: 'stp-state', data: { port: p, state: 'learning' } });
        ps.timer = this.sim.schedule(fwd, () => {
          if (!this.stp || ps.state !== 'learning') return;
          ps.state = 'forwarding';
          this.dev.record('ok', `${p}: Zustand Forwarding, leitet jetzt weiter`, { tag: 'stp-state', data: { port: p, state: 'forwarding' } });
          this.topologyChange();
        });
      });
    }
  }
  topologyChange() {
    if (!this.stp) return;
    this.stp.tcUntil = this.sim.time + (this.timers().maxAge + this.timers().fwd) * 1000;
    if (this.sim.time - this.stp.lastFlush > 5000) {
      this.stp.lastFlush = this.sim.time;
      this.fdb.clear();
      this.dev.record('info', 'Topologieänderung: MAC-Tabelle geleert und Änderung per BPDU gemeldet', { tag: 'stp-tc', data: {} });
    }
  }
  stpTable() {
    if (!this.stp) return null;
    const ports = [];
    for (const [p, ps] of this.stp.ports) {
      if (!this.sim.linkAt(this.dev.id, p)) continue;
      ports.push({ port: p, id: this.portId(p), role: ps.role, state: ps.state, cost: Number(this.portCfg(p).cost || 4), edge: ps.edge,
        designated: ps.role === 'designated' ? fmtBid(this.myId()) : ps.info ? fmtBid(ps.info.bridge) : '' });
    }
    return { bridge: fmtBid(this.myId()), root: fmtBid(this.stp.rootId), isRoot: !this.stp.rootPort, rootPort: this.stp.rootPort, rootCost: this.stp.rootCost, ports };
  }
  roleOf(p) { return this.stp?.ports.get(p)?.role || null; }
  stateOf(p) { return this.stp?.ports.get(p)?.state || null; }
}
export const STP_TEXT = { ROLE_DE, STATE_DE };

class Switch extends Device {
  constructor(sim, cfg) { super(sim, cfg); this.bridge = new Bridge(this); }
  portCfg(p) { return this.cfg.ports[p]; }
  bridgePorts() { return PORTS.switch.filter(p => { const l = this.sim.linkAt(this.id, p); return l && l.up; }); }
  receive(ifname, frame) { this.bridge.receive(ifname, frame); }
  start() { if (this.cfg.stp?.enabled) this.bridge.stpStart(); }
  stop() { this.bridge.stpStop(); }
  onConfig() {
    if (this.cfg.stp?.enabled && !this.bridge.stp) this.bridge.stpStart();
    else if (!this.cfg.stp?.enabled && this.bridge.stp) this.bridge.stpStop();
    else if (this.bridge.stp) this.bridge.stpRecompute();
  }
  onLink(ifname, up) {
    if (!this.bridge.stp) return;
    const ps = this.bridge.stp.ports.get(ifname);
    if (ps && !up) ps.info = null;
    this.bridge.stpRecompute();
  }
}

class Vtep extends Device {
  constructor(sim, cfg) { super(sim, cfg); this.l3 = new L3(this); this.bridge = new Bridge(this); }
  maps() { return (this.cfg.vxlans || []).filter(m => m.vni && m.vlan); }
  portCfg(p) {
    if (p.startsWith('vxlan')) { const m = this.maps().find(x => 'vxlan' + x.vni === p); return m ? { mode: 'access', vlan: Number(m.vlan) } : null; }
    return this.cfg.ports[p];
  }
  bridgePorts() { return ['eth2', 'eth3', 'eth4'].filter(p => { const l = this.sim.linkAt(this.id, p); return l && l.up; }).concat(this.maps().map(m => 'vxlan' + m.vni)); }
  localIp() { return this.cfg.ifaces.lo?.ip || this.cfg.ifaces.eth1?.ip; }
  vxlanMtu(m) { return m.mtu ? Number(m.mtu) : this.sim.mtuOf(this.id, 'eth1') - 50; }
  receive(ifname, frame) {
    if (ifname === 'eth1') return this.l3.receive(ifname, frame);
    this.bridge.receive(ifname, frame);
  }
  vxlanOut(port, inner, remote) {
    const m = this.maps().find(x => 'vxlan' + x.vni === port);
    if (!m) return;
    const plen = framePayloadLen(inner);
    const vm = this.vxlanMtu(m);
    if (plen > vm) {
      this.record('drop', `${port}: Frame mit ${plen} Byte Nutzlast ist grösser als die MTU ${vm} des VXLAN-Interfaces, still verworfen (keine ICMP-Meldung auf Layer 2)`, { frame: inner, tag: 'vxlan-mtu-drop', data: { mtu: vm, len: plen } });
      return;
    }
    const targets = remote ? [remote] : (m.flood || []).filter(isIp);
    if (!targets.length) { this.record('drop', `${port}: Flood-Liste ist leer, Frame geht an keinen VTEP`, { frame: inner, tag: 'vxlan-no-flood' }); return; }
    const src = this.localIp();
    for (const t of targets) {
      const pkt = ipPacket({ src, dst: t, proto: PROTO.UDP, df: false, trace: traceOf(inner) ?? undefined,
        l4: udp(hashFlow(inner.src + inner.dst + (inner.type === 'ipv4' ? inner.payload.src + inner.payload.dst + inner.payload.proto : 'arp')),
          Number(m.dstport || VXLAN_PORT), { kind: 'vxlan', vni: Number(m.vni), frame: clone(inner) }) });
      this.record('info', `kapselt in VXLAN (VNI ${m.vni}) und sendet ${remote ? 'per Unicast' : 'per Head-End Replication'} an VTEP ${t}`, { frame: ethFrame(this.mac('eth1'), '00:00:00:00:00:00', 'ipv4', pkt), tag: 'vxlan-encap', data: { vni: Number(m.vni), dst: t } });
      this.l3.output(pkt, {});
    }
  }
  onUdp(ip) {
    const l4 = ip.l4;
    if (l4.payload?.kind !== 'vxlan') return false;
    const onPort = this.maps().filter(m => Number(m.dstport || VXLAN_PORT) === l4.dport);
    if (!onPort.length) return false;
    const m = onPort.find(x => Number(x.vni) === l4.payload.vni);
    if (!m) { this.record('drop', `VXLAN mit VNI ${l4.payload.vni} von ${ip.src} erhalten, aber kein Segment mit diesem VNI: verworfen`, { tag: 'vxlan-vni-unknown', data: { vni: l4.payload.vni } }); return true; }
    this.record('info', `packt VXLAN von ${ip.src} aus (VNI ${m.vni} → VLAN ${m.vlan})`, { tag: 'vxlan-decap', data: { vni: Number(m.vni), from: ip.src } });
    this.bridge.receive('vxlan' + m.vni, clone(l4.payload.frame), { vid: Number(m.vlan), remote: ip.src, learning: m.learning !== false });
    return true;
  }
  ping(dst, o) { return Host.prototype.ping.call(this, dst, o); }
  traceroute(dst, o) { return Host.prototype.traceroute.call(this, dst, o); }
  arping(t, o) { return Host.prototype.arping.call(this, t, o); }
}

export function newId(prefix = 'd') { return prefix + Math.random().toString(36).slice(2, 9); }
export { TCP_HDR };
