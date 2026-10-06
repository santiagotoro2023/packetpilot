// PacketPilot simulation engine: event-driven, no DOM
import { BCAST, VXLAN_PORT, PROTO, STP_MAC, isGroupMac, macFor, inNet, parseCidr, isIp,
  netOf, intToIp, hashFlow, framePayloadLen, clone, IP_HDR, ICMP_HDR, TCP_HDR, isMcastIp } from './net.js';
import { ethFrame, arpPacket, ipPacket, icmp, udp, tcp, ipChecksum, summary, icmpName, fmtBid } from './packets.js';
import { dhcpOn67, natIn, natOut, Vrrp, Ospf, DHCP_TIMING, vrrpMac } from './services.js';

export const PORTS = {
  pc: ['eth1'], server: ['eth1'],
  router: ['eth1', 'eth2', 'eth3', 'eth4'],
  switch: ['eth1', 'eth2', 'eth3', 'eth4', 'eth5', 'eth6', 'eth7', 'eth8'],
  vtep: ['eth1', 'eth2', 'eth3', 'eth4']
};
export const TYPE_NAMES = { pc: 'PC', server: 'Server', router: 'Router', switch: 'Switch', vtep: 'VTEP' };

const T = { linkDelay: 0.1, arpTimeout: 1000, arpRetries: 3, pingInterval: 1000, replyTimeout: 4000, reachable: 30000,
  nudDelay: 5000, nudProbes: 3, tcpSyn: [1000, 2000, 4000], tcpRto: 1000, tcpStall: 10000, dnsTimeout: 5000, loopHalt: 8 };
export const TIMING = T;
export const STP_PRESETS = { standard: { hello: 2, fwd: 15, maxAge: 20 }, fast: { hello: 1, fwd: 4, maxAge: 6 } };
// Networks saved by older versions still use the German name of the fast timers
STP_PRESETS.schnell = STP_PRESETS.fast;

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
    this.record(A, up ? 'info' : 'err', `Link ${A?.name} ${l.a.if} ↔ ${B?.name} ${l.b.if} is ${up ? 'up again' : 'down'}`, { tag: up ? 'link-up' : 'link-down' });
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
    const hello = isHello(frame);
    const quiet = frame.type === 'stp' || hello;
    if (!link) { if (!quiet) this.record(dev, 'drop', `${ifname} is not connected, frame is lost`, { frame }); return; }
    if (!link.up) { if (!quiet) this.record(dev, 'drop', `Link on ${ifname} is down, frame is lost`, { frame, tag: 'link-down-drop' }); return; }
    const plen = framePayloadLen(frame);
    if (plen > link.mtu) {
      this.record(dev, 'drop', `Frame does not fit through the link on ${ifname} (payload ${plen} > MTU ${link.mtu}), silently dropped`, { frame, tag: 'link-mtu-drop' });
      return;
    }
    const peer = link.a.dev === dev.id && link.a.if === ifname ? link.b : link.a;
    const f = clone(frame);
    // Per link: extra one-way latency in ms and a loss rate in percent
    const delay = T.linkDelay + Math.max(0, Number(link.delay) || 0);
    const lost = Number(link.loss) > 0 && this.random() * 100 < Number(link.loss);
    const fl = { id: f.id + ':' + this.seq, frame: f, link, from: dev.id, fromIf: ifname, to: peer.dev, toIf: peer.if, t0: this.time, t1: this.time + delay, lost };
    this.inflight.push(fl);
    this.record(dev, 'send', `sends via ${ifname}: ${summary(f)}`, { frame: f, tag: frame.type === 'stp' ? 'bpdu-sent' : hello ? 'hello-sent' : null });
    this.schedule(delay, () => {
      this.inflight = this.inflight.filter(x => x !== fl);
      const target = this.devices.get(peer.dev);
      if (!target || !this.topo.links.includes(link) || !link.up) return;
      if (lost) { this.record(dev, 'drop', `Frame lost on the link ${ifname} → ${target.name} (packet loss ${link.loss} %)`, { frame: f, tag: 'link-loss' }); return; }
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

/** Periodic control frames that would flood the log: VRRP advertisements and OSPF hellos */
export function isHello(f) {
  const l4 = f?.type === 'ipv4' ? f.payload.l4 : null;
  return !!l4 && (l4.kind === 'vrrp' || (l4.kind === 'ospf' && l4.type === 'hello'));
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
    cfg.vrrp ??= [];
    cfg.nat = { outside: '', masquerade: true, forwards: [], ...(cfg.nat || {}) };
    cfg.ospf = { enabled: false, timers: 'fast', rid: '', ...(cfg.ospf || {}) };
    cfg.ospf.ifaces ??= {};
  }
  if (t === 'router' || t === 'server') cfg.dhcpServer = { enabled: false, pools: [], ...(cfg.dhcpServer || {}) };
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

// ---------------------------------------------------------------- Devices
class Device {
  constructor(sim, cfg) { this.sim = sim; this.cfg = cfg; this.id = cfg.id; this.consoleLines = []; }
  get name() { return this.cfg.name; }
  /** Commands started from the console that are still running (ping, traceroute, curl …) */
  running() { return this.l3 ? [...this.l3.sessions] : []; }
  interrupt() {
    const list = this.running();
    if (!list.length) return false;
    this.print('^C');
    for (const s of list) s.interrupt();
    return true;
  }
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
    this.lease = null; this.natTable = []; this.dhcpLeases = new Map();
  }
  get cfg() { return this.dev.cfg; }
  get forwarding() { return this.cfg.type === 'router' ? this.cfg.forwarding !== false : false; }
  ifaces() {
    // An interface in DHCP mode uses the address from its lease, if there is one
    return Object.entries(this.cfg.ifaces || {})
      .map(([name, v]) => v?.dhcp ? [name, { ...v, ip: this.lease?.ifname === name ? this.lease.ip : '', prefix: this.lease?.prefix ?? 24 }] : [name, v])
      .filter(([, v]) => v && isIp(v.ip))
      .map(([name, v]) => ({ name, ip: v.ip, prefix: Number(v.prefix ?? 24), vlan: v.vlan ? Number(v.vlan) : null, phys: v.parent || name }));
  }
  gateway() { return isIp(this.cfg.gw) ? this.cfg.gw : this.lease?.router || ''; }
  resolver() { return isIp(this.cfg.resolver) ? this.cfg.resolver : this.lease?.dns || ''; }
  phys(ifname) { return this.cfg.ifaces?.[ifname]?.parent || ifname; }
  logicalFor(phys, vid) {
    for (const [k, v] of Object.entries(this.cfg.ifaces || {})) {
      if ((v.parent || k) !== phys) continue;
      if (Number(v.vlan || 0) === (vid || 0)) return k;
    }
    return null;
  }
  isOwn(ip) { return this.ifaces().some(i => i.ip === ip) || !!this.dev.vrrp?.ownsIp(ip); }
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
    const gw = (this.cfg.type === 'pc' || this.cfg.type === 'server') ? this.gateway() : '';
    if (gw) statics.push({ dst: 'default', via: gw, auto: true, dhcp: !isIp(this.cfg.gw) });
    for (const r of statics) {
      const p = parseCidr(r.dst);
      if (!p || !isIp(r.via)) continue;
      const nh = out.find(c => c.proto === 'C' && inNet(r.via, c.net, c.len));
      out.push({ net: p.net, len: p.len, via: r.via, dev: nh ? nh.dev : null, proto: 'S', active: !!nh, auto: r.auto, dhcp: r.dhcp });
    }
    for (const r of this.dev.ospf?.routes || []) out.push({ net: r.net, len: r.len, via: r.via, dev: r.dev, proto: 'O', metric: r.cost });
    return out;
  }
  lookup(dst) {
    // Longest prefix first, then the administrative distance: connected 0, static 1, OSPF 110
    const AD = { C: 0, S: 1, O: 110 };
    let best = null;
    for (const r of this.routes()) {
      if (r.proto === 'S' && !r.dev) continue;
      if (!inNet(dst, r.net, r.len)) continue;
      if (!best || r.len > best.len || (r.len === best.len && AD[r.proto] < AD[best.proto])) best = r;
    }
    return best;
  }
  srcFor(dst) {
    const r = this.lookup(dst);
    if (r) return this.ifIp(r.dev) || this.ifaces()[0]?.ip;
    return this.ifaces()[0]?.ip || '0.0.0.0';
  }

  // ---- Sending
  output(pkt, ctx = {}) {
    if (this.isOwn(pkt.dst)) { this.sim.schedule(0.01, () => this.deliver(pkt, 'lo')); return { ok: true }; }
    const r = this.lookup(pkt.dst);
    if (!r) {
      if (ctx.forwarded) {
        this.dev.record('drop', `no route to ${pkt.dst}, sends ICMP Network Unreachable to ${pkt.src}`, { tag: 'no-route', data: { dst: pkt.dst } });
        this.icmpError(pkt, 3, 0);
      } else this.dev.record('err', `no route to ${pkt.dst}: Network is unreachable`, { tag: 'no-route', data: { dst: pkt.dst } });
      return { ok: false, error: 'Network is unreachable' };
    }
    const mtu = this.mtu(r.dev);
    if (pkt.totalLength > mtu) {
      if (pkt.df) {
        if (ctx.forwarded) {
          this.dev.record('drop', `Packet (${pkt.totalLength} bytes) larger than MTU ${mtu} of ${r.dev} and DF set: dropped, ICMP Fragmentation Needed to ${pkt.src}`, { tag: 'frag-needed-sent', data: { mtu } });
          this.icmpError(pkt, 3, 4, { mtu });
        }
        return { ok: false, error: `message too long, mtu=${mtu}`, mtu };
      }
      const frags = this.fragment(pkt, mtu);
      this.dev.record('info', `Packet (${pkt.totalLength} bytes) larger than MTU ${mtu}: split into ${frags.length} fragments`, { tag: 'fragmented', data: { count: frags.length, mtu } });
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
  sendFrame(egress, dstMac, type, payload, srcMac = null) {
    const c = this.cfg.ifaces?.[egress];
    const phys = c?.parent || egress;
    const vlanId = c?.vlan;
    const frame = ethFrame(srcMac || this.dev.mac(phys), dstMac, type, payload, vlanId ? { vid: Number(vlanId), pcp: 0 } : null);
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
        this.dev.record('err', `no ARP reply from ${nh} after ${T.arpRetries} attempts`, { tag: 'arp-failed', data: { ip: nh } });
        const q = this.pending.get(nh) || [];
        this.pending.delete(nh);
        for (const { pkt } of q) {
          if (this.isOwn(pkt.src)) for (const s of [...this.sessions]) s.onArpFail?.(pkt);
          else this.icmpError(pkt, 3, 1);
        }
        return;
      }
      entry.tries++;
      this.dev.record('info', `does not know the MAC of ${nh} and asks via ARP (attempt ${entry.tries})`, { tag: 'arp-request-sent', data: { ip: nh } });
      this.sendFrame(egress, BCAST, 'arp', arpPacket(1, this.dev.mac(egress), myIp, null, nh));
      this.sim.schedule(T.arpTimeout, ask);
    };
    ask();
  }
  // Neighbor Unreachability Detection: verify stale entries
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
          this.dev.record('err', `${nh} no longer answers at ${e.mac}: ARP entry deleted (FAILED). The next packet triggers a new ARP request.`, { tag: 'nud-failed', data: { ip: nh } });
          return;
        }
        this.dev.record('info', `checks via unicast ARP whether ${nh} is still reachable at ${e.mac} (probe ${n})`, { tag: 'nud-probe', data: { ip: nh } });
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
    if (changed && !quiet) this.dev.record('learn', `adds ${ip} → ${mac} to the ARP table (${how})`, { tag: 'arp-learned', data: { ip, mac } });
    const q = this.pending.get(ip);
    if (q) { this.pending.delete(ip); for (const { pkt, egress } of q) this.sendFrame(egress, mac, 'ipv4', pkt); }
  }
  arpTable() {
    return [...this.arp.entries()].map(([ip, e]) => ({ ip, mac: e.mac, ifname: e.ifname,
      state: e.state === 'REACHABLE' && this.sim.time - e.t > T.reachable ? 'STALE' : e.state }));
  }

  // ---- Receiving
  receive(phys, frame) {
    if (frame.type === 'stp') return;
    const vid = frame.vlan ? frame.vlan.vid : 0;
    const ifname = this.logicalFor(phys, vid);
    if (!ifname) {
      this.dev.record('drop', vid ? `drops frame with VLAN tag ${vid} on ${phys}: no matching (sub)interface` : `drops untagged frame on ${phys}: interface expects a tag`,
        { frame, tag: 'vlan-mismatch' });
      return;
    }
    const myMac = this.dev.mac(phys);
    const forVip = this.dev.vrrp?.accepts(ifname, frame.dst);
    if (frame.dst !== myMac && frame.dst !== BCAST && !forVip) {
      if (isGroupMac(frame.dst)) {
        // Multicast: only routers running VRRP or OSPF listen, everyone else ignores it quietly
        const k = frame.type === 'ipv4' ? frame.payload.l4?.kind : null;
        if (!((k === 'vrrp' && this.dev.vrrp) || (k === 'ospf' && this.dev.ospf?.enabled))) return;
      } else {
      this.dev.record('ignore', `sees a frame to ${frame.dst} on ${phys}: not for me, dropped`,
        { frame, tag: 'frame-not-mine', data: { type: frame.type, kind: frame.type === 'ipv4' ? frame.payload.l4?.kind : 'arp' } });
      return;
      }
    }
    // Confirm reachability: traffic from the neighbor keeps the ARP entry fresh
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
        this.dev.record('err', `Address conflict: ${a.sha} also claims ${myIp}`, { frame, tag: 'ip-conflict' });
        return;
      }
      const e = this.arp.get(a.spa);
      if (e && e.mac) {
        if (e.mac !== a.sha) this.dev.record('learn', `updates ${a.spa}: ${e.mac} → ${a.sha} (gratuitous ARP)`, { frame, tag: 'garp-updated', data: { ip: a.spa, mac: a.sha } });
        this.learnArp(a.spa, a.sha, ifname, 'gratuitous ARP', true);
      } else this.dev.record('ignore', `Gratuitous ARP from ${a.spa}: no entry present, nothing to update`, { frame, tag: 'garp-ignored' });
      return;
    }
    if (a.op === 1 && a.spa === '0.0.0.0') {
      if (myIp && a.tpa === myIp) {
        this.dev.record('info', `answers an ARP probe: ${myIp} is already in use`, { frame, tag: 'dad-reply' });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, '0.0.0.0'));
      }
      return;
    }
    const vg = a.op === 1 && this.dev.vrrp?.vipGroup(a.tpa, ifname);
    if (vg) {
      const vm = vrrpMac(vg.vrid);
      this.learnArp(a.spa, a.sha, ifname, 'learned from the request');
      this.dev.record('info', `answers the ARP request for the virtual IP: ${a.tpa} is at ${vm} (VRRP ${vg.vrid} master)`, { tag: 'arp-reply-sent', data: { ip: a.tpa, vrrp: true } });
      this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, vm, a.tpa, a.sha, a.spa), vm);
      return;
    }
    if (a.op === 1) {
      if (myIp && a.tpa === myIp) {
        this.learnArp(a.spa, a.sha, ifname, 'learned from the request');
        this.dev.record('info', `answers the ARP request: ${myIp} is at ${myMac}`, { tag: 'arp-reply-sent', data: { ip: myIp } });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, a.spa));
      } else this.dev.record('ignore', `ARP request for ${a.tpa} is not for me, ignored`, { frame, tag: 'arp-ignored' });
    } else if (a.op === 2) {
      if (a.tpa === '0.0.0.0') return;
      if (this.arp.has(a.spa) || this.pending.has(a.spa)) this.learnArp(a.spa, a.sha, ifname, 'from the reply');
      else this.dev.record('ignore', `unsolicited ARP reply from ${a.spa} ignored`, { frame, tag: 'arp-unsolicited' });
    }
  }
  rxIp(ifname, ip, frame) {
    const nat = this.cfg.nat;
    if (nat?.outside === ifname && this.forwarding) {
      const t = natIn(this, ip, frame);
      if (t) return this.forward(t, ifname, frame);
    }
    // Limited broadcast and multicast are delivered locally and never forwarded
    if (ip.dst === '255.255.255.255' || isMcastIp(ip.dst)) return this.deliver(ip, ifname, frame);
    if (this.isOwn(ip.dst)) {
      if (ip.frag) return this.reassemble(ip, ifname);
      return this.deliver(ip, ifname, frame);
    }
    if (!this.forwarding) {
      this.dev.record('drop', `Packet to ${ip.dst} is not for me, and I do not forward (ip_forward=0)`, { frame, tag: 'not-forwarding' });
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
      this.dev.record('drop', `Rule ${m.index} (${m.rule.action === 'reject' ? 'reject' : 'drop'}) matches: packet ${ip.src} > ${ip.dst} is not forwarded`, { frame, tag: 'acl-drop', data: { rule: m.index } });
      if (m.rule.action === 'reject') {
        if (ip.proto === PROTO.TCP && ip.l4?.flags?.SYN) this.sendTcp(ip.src, tcp(ip.l4.dport, ip.l4.sport, 0, ip.l4.seq + 1, { RST: true, ACK: true }), ip.dst);
        else this.icmpError(ip, 3, 13);
      }
      return;
    }
    if (ip.ttl <= 1) {
      this.dev.record('drop', `TTL of ${ip.src} > ${ip.dst} expired, sends ICMP Time Exceeded to ${ip.src}`, { frame, tag: 'ttl-expired' });
      this.icmpError(ip, 11, 0);
      return;
    }
    const r = this.lookup(ip.dst);
    const out = clone(ip);
    out.ttl = ip.ttl - 1;
    const clamp = Number(this.cfg.mssClamp || 0);
    if (clamp && out.proto === PROTO.TCP && out.l4?.flags?.SYN && out.l4.mss > clamp) {
      this.dev.record('info', `adjusts the MSS in the SYN from ${out.l4.mss} to ${clamp} (MSS clamping)`, { frame, tag: 'mss-clamped', data: { from: out.l4.mss, to: clamp } });
      out.l4.mss = clamp;
    }
    const nat = this.cfg.nat;
    if (nat?.outside && r?.dev === nat.outside && inIf !== nat.outside) natOut(this, out, frame);
    out.checksum = ipChecksum(out);
    if (r) this.dev.record('fwd', `forwards ${ip.src} > ${ip.dst}: route ${r.net}/${r.len}${r.via ? ' via ' + r.via : ' direct'} out ${r.dev}, TTL ${ip.ttl} → ${out.ttl}`,
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
      this.dev.record('info', `reassembles ${r.parts.length} fragments into one packet of ${full.totalLength} bytes`, { tag: 'reassembled' });
      this.deliver(full, ifname);
    }
  }
  service(proto, port) { return (this.cfg.services || []).find(s => s.proto === proto && Number(s.port) === port); }
  deliver(ip, ifname, frame) {
    const l4 = ip.l4;
    if (!l4) return;
    const toGroup = ip.dst === '255.255.255.255' || isMcastIp(ip.dst);
    if (l4.kind === 'vrrp') return this.dev.vrrp?.onAdvert(ip, ifname, frame);
    if (l4.kind === 'ospf') return this.dev.ospf?.onPacket(ip, ifname, frame);
    // Like Linux: no answers to pings sent to a broadcast or multicast address
    if (toGroup && l4.kind !== 'udp') return;
    if (l4.kind === 'icmp') {
      if (l4.type === 8) {
        this.dev.record('ok', `receives Echo Request from ${ip.src} (seq ${l4.seq}) and replies`, { frame, tag: 'echo-request-received', data: { from: ip.src } });
        this.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.ICMP, df: ip.df, trace: ip.trace, l4: icmp(0, 0, { ident: l4.ident, seq: l4.seq, dataLen: l4.dataLen }) }), {});
        return;
      }
      if (l4.type === 0) {
        this.dev.record('ok', `receives Echo Reply from ${ip.src} (seq ${l4.seq})`, { frame, tag: 'echo-reply-received', data: { from: ip.src, size: l4.dataLen } });
        for (const s of [...this.sessions]) s.onEchoReply?.(ip);
        return;
      }
      if (l4.type === 3 || l4.type === 11) {
        if (l4.type === 3 && l4.code === 4 && l4.mtu && l4.orig) {
          this.pmtu.set(l4.orig.dst, l4.mtu);
          this.dev.record('learn', `remembers: path to ${l4.orig.dst} has MTU ${l4.mtu} (Path MTU Discovery)`, { frame, tag: 'pmtu-learned', data: { mtu: l4.mtu } });
          if (l4.orig.proto === PROTO.TCP) this.tcpPmtu(l4.orig, l4.mtu);
        } else this.dev.record('err', `receives ICMP ${icmpName(l4.type, l4.code)} from ${ip.src}`, { frame, tag: 'icmp-error-received', data: { type: l4.type, code: l4.code } });
        for (const s of [...this.sessions]) s.onIcmpError?.(ip);
      }
      return;
    }
    if (l4.kind === 'tcp') return this.onTcp(ip, frame);
    if (l4.kind === 'udp') {
      if (l4.dport === 67 && l4.payload?.kind === 'dhcp' && dhcpOn67(this, ip, ifname, frame)) return;
      if (this.dev.onUdp?.(ip, ifname, frame)) return;
      for (const s of [...this.sessions]) if (s.onUdp?.(ip)) return;
      const svc = this.service('udp', l4.dport);
      if (svc) {
        if (l4.payload?.kind === 'dns' && !l4.payload.qr) return this.answerDns(ip, svc, frame);
        this.dev.record('ok', `receives a UDP datagram from ${ip.src}:${l4.sport} on port ${l4.dport} (${svc.name || 'service'})`, { frame, tag: 'udp-received', data: { port: l4.dport, from: ip.src } });
        return;
      }
      if (toGroup) return;
      this.dev.record('info', `UDP port ${l4.dport} is closed, sends ICMP Port Unreachable to ${ip.src}`, { frame, tag: 'port-unreachable-sent', data: { port: l4.dport } });
      this.icmpError(ip, 3, 3);
    }
  }
  answerDns(ip, svc, frame) {
    const q = ip.l4.payload;
    const name = q.qname.toLowerCase().replace(/\.$/, '');
    const recs = (this.cfg.dns || []).filter(r => String(r.name).toLowerCase().replace(/\.$/, '') === name && isIp(r.ip));
    const ans = { kind: 'dns', id: q.id, qr: 1, qname: q.qname, answers: recs.map(r => ({ name: q.qname, ip: r.ip })), rcode: recs.length ? 'NOERROR' : 'NXDOMAIN' };
    this.dev.record('ok', `answers the DNS query for ${q.qname}: ${recs.length ? recs.map(r => r.ip).join(', ') : 'NXDOMAIN (unknown)'}`, { frame, tag: 'dns-answered', data: { name: q.qname, found: !!recs.length } });
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
    this.armRto(c);
  }
  // Retransmission timeout with exponential backoff (1, 2, 4 … s), gives up after 6 attempts
  armRto(c) {
    this.sim.cancel(c.rto);
    const end = c.resp.start + c.resp.total;
    if (c.acked >= end) return;
    const rto = Math.max(T.tcpRto, 2 * (c.rtt || 0)) * 2 ** (c.retries || 0);
    c.rto = this.sim.schedule(rto, () => {
      if (this.tcp.get(c.key) !== c || c.acked >= end) return;
      c.retries = (c.retries || 0) + 1;
      if (c.retries > 6) { this.dev.record('err', `gives up on ${c.rip}:${c.rport} after 6 retransmissions`, { tag: 'tcp-giveup' }); this.tcp.delete(c.key); return; }
      this.dev.record('info', `no acknowledgment from ${c.rip} for ${Math.round(rto)} ms: retransmits from byte ${c.acked - c.resp.start} (attempt ${c.retries})`, { tag: 'tcp-rto', data: { mss: c.curMss, attempt: c.retries } });
      this.sendResponse(c, c.curMss, c.acked);
    });
  }
  // After ICMP Fragmentation Needed: resend unacknowledged data with a smaller MSS
  tcpPmtu(orig, mtu) {
    for (const c of this.tcp.values()) {
      if (c.client || !c.resp || c.lport !== orig.sport || c.rip !== orig.dst || c.rport !== orig.dport) continue;
      const mss = Math.min(c.peerMss, mtu - 40);
      if (mss >= c.curMss || c.acked >= c.resp.start + c.resp.total) continue;
      this.dev.record('info', `resends the unacknowledged data from byte ${c.acked - c.resp.start}, now in segments of ${mss} bytes`, { tag: 'tcp-retransmit', data: { mss } });
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
          this.dev.record('info', `no service on TCP port ${s.dport}: replies with RST`, { frame, tag: 'tcp-rst-sent', data: { port: s.dport } });
          this.sendTcp(ip.src, tcp(s.dport, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
          return;
        }
        const conn = { key, state: 'SYN_RECEIVED', lport: s.dport, rip: ip.src, rport: s.sport, iss: nextIsn(this.sim), rcvNxt: s.seq + 1, peerMss: s.mss || 536, svc, local: ip.dst, synT: this.sim.time };
        conn.sndNxt = conn.iss + 1;
        this.tcp.set(key, conn);
        this.dev.record('info', `Service ${svc.name || ''} on port ${s.dport} accepts the connection: SYN/ACK`, { frame, tag: 'tcp-synack-sent', data: { port: s.dport } });
        this.sendTcp(ip.src, tcp(s.dport, s.sport, conn.iss, conn.rcvNxt, { SYN: true, ACK: true }, { mss: this.mssFor(ip.src) }), ip.dst);
        return;
      }
      if (!s.flags.RST) this.sendTcp(ip.src, tcp(s.dport, s.sport, s.ack, s.seq + (s.dataLen || 0), { RST: true, ACK: true }), ip.dst);
      return;
    }
    if (s.flags.RST) { this.sim.cancel(c.rto); this.tcp.delete(key); this.dev.record('info', `Connection to ${ip.src}:${s.sport} terminated by RST`, { frame, tag: 'tcp-reset' }); return; }
    // The SYN/ACK got lost and the client repeats its SYN: answer again
    if (c.state === 'SYN_RECEIVED' && s.flags.SYN && !s.flags.ACK) {
      this.sendTcp(ip.src, tcp(s.dport, s.sport, c.iss, c.rcvNxt, { SYN: true, ACK: true }, { mss: this.mssFor(ip.src) }), ip.dst);
      return;
    }
    if (c.state === 'SYN_RECEIVED' && s.flags.ACK && s.ack === c.sndNxt) {
      c.state = 'ESTABLISHED';
      c.rtt = this.sim.time - c.synT;
      this.dev.record('ok', `Connection with ${ip.src}:${s.sport} established (ESTABLISHED)`, { frame, tag: 'tcp-established', data: { port: c.lport } });
    }
    if (s.dataLen > 0 && s.seq === c.rcvNxt) {
      c.rcvNxt += s.dataLen;
      const total = Number(c.svc.size ?? 2000);
      const mss = Math.min(c.peerMss, this.mssFor(ip.src), (this.pmtu.get(ip.src) || 65535) - 40);
      const n = Math.max(1, Math.ceil(total / mss));
      this.dev.record('info', `receives ${s.dataLen} bytes${s.app ? ' (' + s.app + ')' : ''} and replies with ${total} bytes in ${n} segment${n > 1 ? 's' : ''} (MSS ${mss})`,
        { frame, tag: 'tcp-response', data: { segments: n, bytes: total, mss } });
      c.resp = { start: c.sndNxt, total, app: c.svc.name === 'http' ? `HTTP/1.1 200 OK, ${total} bytes` : c.svc.name === 'ssh' ? 'SSH-2.0-OpenSSH_9.6' : `${c.svc.name || 'response'}` };
      c.acked = c.sndNxt;
      this.sendResponse(c, mss, c.sndNxt);
      return;
    }
    if (c.resp && s.flags.ACK && s.ack > (c.acked ?? 0)) { c.acked = s.ack; c.retries = 0; this.armRto(c); }
    if (s.flags.FIN) {
      c.rcvNxt += 1;
      this.sendTcp(ip.src, tcp(c.lport, c.rport, c.sndNxt, c.rcvNxt, { FIN: true, ACK: true }), c.local);
      c.sndNxt += 1; c.state = 'LAST_ACK';
      this.dev.record('info', `${ip.src} closes the connection: FIN/ACK back`, { frame, tag: 'tcp-fin' });
      return;
    }
    if (c.state === 'LAST_ACK' && s.flags.ACK && s.ack === c.sndNxt) {
      this.sim.cancel(c.rto);
      this.tcp.delete(key);
      this.dev.record('ok', `Connection with ${ip.src}:${s.sport} closed`, { frame, tag: 'tcp-closed' });
    }
  }
}

// ---------------------------------------------------------------- Sessions
let IDENT = 100;
const pad2 = n => String(n).padStart(2);
class Session {
  constructor(l3) { this.l3 = l3; this.dev = l3.dev; this.sim = l3.sim; this.done = false; }
  begin() { this.l3.sessions.add(this); this.sim.emit('console', { devId: this.dev.id }); }
  end() { this.done = true; this.l3.sessions.delete(this); this.sim.emit('console', { devId: this.dev.id }); }
  // Ctrl+C in the console: stop timers and wrap up like the real tool would
  interrupt() { this.sim.cancel(this.timer); this.finish ? this.finish(false) : this.end(); }
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
    this.dev.print(`PING ${this.dst}: ${this.size} bytes of data, ${IP_HDR + ICMP_HDR + this.size} byte IP packet`);
    this.sendNext();
  }
  sendNext() {
    if (this.done) return;
    const seq = ++this.seq;
    const total = IP_HDR + ICMP_HDR + this.size;
    const r = this.l3.lookup(this.dst);
    if (!r && !this.l3.isOwn(this.dst)) { this.dev.print('ping: connect: Network is unreachable'); this.dev.record('err', `ping ${this.dst}: no route`, { tag: 'no-route' }); return this.finish(true); }
    const lim = Math.min(this.l3.pmtu.get(this.dst) || Infinity, r ? this.l3.mtu(r.dev) : 65536);
    this.sent++;
    if (this.df && total > lim) {
      this.dev.print(`ping: local error: message too long, mtu=${lim}`);
      this.dev.record('err', `Packet of ${total} bytes with DF does not fit (MTU ${lim}), rejected locally`, { tag: 'local-mtu-error', data: { mtu: lim } });
      this.errors++;
    } else {
      const pkt = ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, ttl: this.ttl, proto: PROTO.ICMP, df: this.df, l4: icmp(8, 0, { ident: this.ident, seq, dataLen: this.size }) });
      const t0 = this.sim.time;
      const ev = this.sim.schedule(T.replyTimeout, () => { if (this.open.has(seq)) { this.open.delete(seq); this.dev.print(`icmp_seq=${seq}: no answer (timeout)`); this.checkEnd(); } });
      this.open.set(seq, { t0, ev });
      this.l3.output(pkt, {});
    }
    if (this.seq < this.count) this.sim.schedule(T.pingInterval, () => this.sendNext());
    else this.checkEnd();
  }
  interrupt() {
    for (const o of this.open.values()) this.sim.cancel(o.ev);
    this.open.clear();
    this.finish();
  }
  take(seq) { const o = this.open.get(seq); if (!o) return null; this.open.delete(seq); this.sim.cancel(o.ev); return o; }
  onEchoReply(ip) {
    const l4 = ip.l4;
    if (l4.ident !== this.ident) return;
    const o = this.take(l4.seq); if (!o) return;
    this.received++;
    this.dev.print(`${ICMP_HDR + l4.dataLen} bytes from ${ip.src}: icmp_seq=${l4.seq} ttl=${ip.ttl} time=${(this.sim.time - o.t0).toFixed(2)} ms`);
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
    if (!aborted) { this.dev.print(`--- ${this.dst} ping statistics ---`); this.dev.print(`${this.sent} packets transmitted, ${this.received} received${this.errors ? `, ${this.errors} errors` : ''}, ${loss}% packet loss`); }
    this.dev.record(this.received ? 'ok' : 'err', `ping to ${this.dst} finished: ${this.received} of ${this.sent} answered`,
      { tag: 'ping-done', data: { dst: this.dst, sent: this.sent, received: this.received, size: this.size, df: this.df } });
  }
}

class TraceSession extends Session {
  constructor(l3, dst, o) { super(l3); Object.assign(this, { dst, max: o.maxHops ?? 8 }); this.ttl = 0; this.port = 33433; this.hops = []; }
  start() { this.begin(); this.dev.print(`$ traceroute -n ${this.dst}`); this.dev.print(`traceroute to ${this.dst}, ${this.max} hops max`); this.next(); }
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
    this.dev.record(reached ? 'ok' : 'err', `traceroute to ${this.dst} finished${reached ? ', destination reached' : ''}`, { tag: 'trace-done', data: { dst: this.dst, reached, hops: this.hops.length, path: this.hops } });
  }
}

class ArpingSession extends Session {
  constructor(l3, target, o) { super(l3); Object.assign(this, { target, mode: o.mode || 'normal', count: o.count ?? (o.mode === 'normal' ? 3 : o.mode === 'dad' ? 2 : 1), ifname: o.ifname }); this.sent = 0; this.replies = 0; }
  start() {
    this.begin();
    const ifn = this.ifname || this.l3.ifaces().find(i => i.name !== 'lo')?.name;
    this.ifname = ifn;
    const myIp = this.l3.ifIp(ifn);
    if (!ifn || !myIp) { this.dev.print('arping: no interface with an IP address'); return this.end(); }
    const flag = { normal: '', gratuitous: '-U ', reply: '-A ', dad: '-D ' }[this.mode];
    this.dev.print(`$ arping ${flag}-c ${this.count} -I ${ifn} ${this.target}`);
    this.dev.print(`ARPING ${this.target} from ${this.mode === 'dad' ? '0.0.0.0' : myIp} ${ifn}`);
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
      this.dev.record('info', this.mode === 'gratuitous' || this.mode === 'reply' ? `announces ${myIp} at ${mac} unsolicited (gratuitous ARP)` : this.mode === 'dad' ? `checks via ARP probe whether ${this.target} is already in use` : `asks for ${this.target} via arping`,
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
    this.dev.print(`Sent ${this.sent} probes${this.mode === 'gratuitous' || this.mode === 'reply' ? '' : `, received ${this.replies} responses`}`);
    if (this.mode === 'dad') this.dev.print(this.replies ? `Address ${this.target} is already in use (conflict).` : `Address ${this.target} is free.`);
    this.dev.record(this.mode === 'dad' && this.replies ? 'err' : 'ok', `arping finished (${this.mode})`, { tag: 'arping-done', data: { mode: this.mode, target: this.target, replies: this.replies } });
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
      this.dev.record('err', `TCP connection to ${this.dst}:${this.port}: no answer to SYN (filtered?)`, { tag: 'tcp-timeout', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    const wait = T.tcpSyn[this.tries++];
    this.dev.record('info', `opens a TCP connection to ${this.dst}:${this.port}: SYN${this.tries > 1 ? ' (retry ' + (this.tries - 1) + ')' : ''}`, { tag: 'tcp-syn-sent', data: { dst: this.dst, port: this.port } });
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
      this.dev.record('err', `${this.dst}:${this.port} refuses (RST): port closed or connection rejected`, { tag: 'tcp-refused', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    if (this.state === 'SYN_SENT' && s.flags.SYN && s.flags.ACK && s.ack === this.iss + 1) {
      this.sim.cancel(this.timer);
      this.rcvNxt = s.seq + 1; this.sndNxt = this.iss + 1; this.peerMss = s.mss;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.setState('ESTABLISHED');
      this.dev.record('ok', `Three-way handshake with ${this.dst}:${this.port} complete (ESTABLISHED)`, { tag: 'tcp-established', data: { dst: this.dst, port: this.port, client: true } });
      if (this.mode === 'probe') { this.dev.print(`Connection to ${this.dst} ${this.port} port [tcp] succeeded!`); return this.close(); }
      const req = 78;
      this.reqSeq = this.sndNxt;
      this.sendRequest();
      this.sndNxt += req;
      this.armStall();
      return;
    }
    // A segment arrived out of order (an earlier one was lost): repeat the last acknowledgment
    if (this.state === 'ESTABLISHED' && s.dataLen > 0 && s.seq !== this.rcvNxt) {
      this.dev.record('info', `segment from byte ${s.seq - (this.firstSeq ?? s.seq)} arrives out of order, acknowledges ${this.rcvNxt} again (duplicate ACK)`, { tag: 'tcp-dupack' });
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      return;
    }
    if (this.state === 'ESTABLISHED' && s.dataLen > 0 && s.seq === this.rcvNxt) {
      this.sim.cancel(this.reqTimer);
      this.firstSeq ??= s.seq;
      this.rcvNxt += s.dataLen; this.bytes += s.dataLen; this.segments++;
      if (s.total) this.expected = s.total;
      if (s.app) this.dev.print(`< ${s.app}`);
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.armStall();
      if (this.expected !== null && this.bytes >= this.expected) {
        this.dev.print(`${this.bytes} bytes received in ${this.segments} segment${this.segments > 1 ? 's' : ''} (MSS ${Math.max(...[s.dataLen, this.firstLen || 0])})`);
        this.close();
      }
      this.firstLen ??= s.dataLen;
      return;
    }
    if (this.state === 'FIN_WAIT' && s.flags.FIN) {
      this.rcvNxt += 1;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.dev.record('ok', `Connection to ${this.dst}:${this.port} closed cleanly`, { tag: 'tcp-closed', data: { client: true } });
      this.finish(true);
    }
  }
  // The request is sent again if no answer comes within a second (it may have been lost)
  sendRequest(n = 0) {
    this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.reqSeq, this.rcvNxt, { ACK: true, PSH: true }, { dataLen: 78, app: 'GET / HTTP/1.1' }));
    this.sim.cancel(this.reqTimer);
    this.reqTimer = n < 3 ? this.sim.schedule(T.tcpRto * (n + 1), () => {
      if (this.done || this.state !== 'ESTABLISHED' || this.bytes > 0) return;
      this.dev.record('info', `no answer to the request yet, sends it again (attempt ${n + 1})`, { tag: 'tcp-rto', data: { client: true } });
      this.sendRequest(n + 1);
    }) : null;
  }
  armStall() {
    this.sim.cancel(this.timer);
    this.timer = this.sim.schedule(T.tcpStall, () => {
      if (this.done || this.state !== 'ESTABLISHED') return;
      this.dev.print(`curl: (28) Operation timed out after ${T.tcpStall} milliseconds with ${this.bytes} bytes received`);
      this.dev.record('err', `Connection to ${this.dst}:${this.port} is up, but the response does not arrive (${this.bytes} bytes received)`, { tag: 'tcp-stalled', data: { dst: this.dst, port: this.port, bytes: this.bytes } });
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
    const txt = l4.type === 11 ? 'TTL exceeded' : l4.code === 13 ? 'Communication administratively prohibited' : l4.code === 3 ? 'Connection refused' : 'No route to host';
    this.dev.print(`${this.tool}: ${this.dst} port ${this.port}: ${txt} (ICMP from ${ip.src})`);
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
    this.sim.cancel(this.reqTimer);
    this.end();
    this.l3.tcp.delete(this.key);
    this.dev.record(ok ? 'ok' : 'err', `${this.tool} ${this.dst}:${this.port} finished`, { tag: 'tcp-done', data: { dst: this.dst, port: this.port, ok: !!ok, bytes: this.bytes, segments: this.segments, mode: this.mode } });
  }
}

class DigSession extends Session {
  constructor(l3, server, name, then = null) { super(l3); Object.assign(this, { server, name, then }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); this.id = Math.floor(this.sim.random() * 65535); }
  print(t) { if (!this.then) this.dev.print(t); }
  // A name lookup for curl or ping is cancelled silently, the command after it never starts
  interrupt() { this.sim.cancel(this.timer); if (this.then) { this.then = null; this.end(); } else this.finish(false); }
  start() {
    this.begin();
    this.print(`$ dig @${this.server} ${this.name}`);
    this.t0 = this.sim.time;
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.server), dst: this.server, proto: PROTO.UDP, l4: udp(this.sport, 53, { kind: 'dns', id: this.id, qr: 0, qname: this.name }) }), {});
    if (!res.ok) { this.print(`;; ${res.error}`); return this.finish(false); }
    this.dev.record('info', `asks ${this.server} via DNS (UDP 53) for ${this.name}`, { tag: 'dns-query', data: { name: this.name } });
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
    this.dev.record(ok ? 'ok' : 'err', ok ? `DNS: ${this.name} is ${answer}` : `DNS lookup ${this.name} without result`, { tag: 'dns-done', data: { name: this.name, ok, answer } });
    if (this.then) { if (answer) this.dev.print(`${this.name} → ${answer} (DNS via ${this.server})`); this.then(answer); }
  }
}

class UdpSend extends Session {
  constructor(l3, dst, port, len) { super(l3); Object.assign(this, { dst, port, len }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); }
  start() {
    this.begin();
    this.dev.print(`$ echo test | nc -u -w1 ${this.dst} ${this.port}`);
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, proto: PROTO.UDP, l4: udp(this.sport, this.port, { kind: 'data', len: this.len }) }), {});
    if (!res.ok) { this.dev.print(`nc: ${res.error}`); return this.end(); }
    this.dev.print(`${this.len} bytes sent as a UDP datagram. UDP does not wait for any acknowledgment.`);
    this.sim.schedule(2000, () => this.end());
  }
  onIcmpError(ip) { const o = ip.l4.orig; if (!o || o.sport !== this.sport || this.done) return; this.dev.print(`Note: received ICMP ${icmpName(ip.l4.type, ip.l4.code)} from ${ip.src}`); this.end(); }
}

// ---------------------------------------------------------------- Hosts and routers
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
    const dns = this.l3.resolver();
    if (!dns) { this.print(`${name}: no DNS server configured`); this.record('err', `cannot resolve ${name}: no DNS server configured`, { tag: 'dns-no-resolver' }); return cb(null); }
    const s = new DigSession(this.l3, dns, name, cb); s.start(); return s;
  }
  udpSend(dst, port, len = 32) { const s = new UdpSend(this.l3, dst, port, len); s.start(); return s; }
  // Interfaces in DHCP mode ask for an address shortly after the device starts
  start() {
    for (const [n, v] of Object.entries(this.cfg.ifaces || {})) {
      if (v?.dhcp) this.sim.schedule(600 + this.sim.random() * 600, () => { if (!this.l3.lease && !this.dhcpRunning(n)) this.dhclient(n, { boot: true }); });
    }
  }
  dhcpRunning(ifname) { return [...this.l3.sessions].some(s => s instanceof DhcpClient && s.ifname === ifname); }
  dhclient(ifname = 'eth1', o = {}) { const s = new DhcpClient(this.l3, ifname, o); s.start(); return s; }
  dhcpRelease(ifname = 'eth1') {
    const l = this.l3.lease;
    this.print(`$ dhclient -r ${ifname}`);
    if (!l || l.ifname !== ifname) return this.print('dhclient: no lease to release');
    this.l3.output(ipPacket({ src: l.ip, dst: l.server, proto: PROTO.UDP, l4: udp(68, 67, { kind: 'dhcp', op: 'RELEASE', xid: 1, chaddr: this.mac(ifname), ciaddr: l.ip, yiaddr: '0.0.0.0', giaddr: '0.0.0.0', hops: 0 }) }), {});
    this.l3.lease = null;
    this.print(`DHCPRELEASE of ${l.ip} on ${ifname} to ${l.server} port 67`);
    this.record('info', `releases ${l.ip} and has no address on ${ifname} now`, { tag: 'dhcp-released-client' });
    this.sim.emit('config', this.id);
  }
}
class Router extends Host {
  // VRRP and OSPF only restart when their own settings change, not on every configuration change
  start() {
    super.start();
    this.vrrp?.stop(); this.ospf?.stop();
    this.vrrp = new Vrrp(this); this.vrrp.start(); this.vrrpSnap = JSON.stringify(this.cfg.vrrp);
    this.ospf = new Ospf(this); this.ospf.start(); this.ospfSnap = JSON.stringify(this.cfg.ospf);
    this.addrSnap = JSON.stringify(this.l3.ifaces());
  }
  stop() { this.vrrp?.stop(); this.ospf?.stop(); }
  onConfig() {
    const v = JSON.stringify(this.cfg.vrrp), o = JSON.stringify(this.cfg.ospf), a = JSON.stringify(this.l3.ifaces());
    if (v !== this.vrrpSnap) { this.vrrpSnap = v; this.vrrp.start(); }
    if (o !== this.ospfSnap) { this.ospfSnap = o; this.ospf.start(); }
    else if (a !== this.addrSnap) this.ospf.originate();
    this.addrSnap = a;
  }
  onLink(ifname, up) { this.vrrp?.onLink(ifname, up); this.ospf?.onLink(ifname, up); }
}

// ---------------------------------------------------------------- DHCP client (DORA)
class DhcpClient extends Session {
  constructor(l3, ifname, o = {}) { super(l3); this.ifname = ifname; this.boot = !!o.boot; this.xid = Math.floor(this.sim.random() * 0xffffffff) >>> 0; this.tries = 0; this.state = 'INIT'; }
  get mac() { return this.dev.mac(this.ifname); }
  start() {
    for (const s of [...this.l3.sessions]) if (s instanceof DhcpClient && s.ifname === this.ifname) s.end();
    this.begin();
    if (!this.boot) this.dev.print(`$ dhclient -v ${this.ifname}`);
    if (this.l3.lease) { this.dev.print(`drops the old lease ${this.l3.lease.ip}`); this.l3.lease = null; this.sim.emit('config', this.dev.id); }
    this.discover();
  }
  send(m) {
    const pkt = ipPacket({ src: '0.0.0.0', dst: '255.255.255.255', proto: PROTO.UDP,
      l4: udp(68, 67, { kind: 'dhcp', xid: this.xid, chaddr: this.mac, ciaddr: '0.0.0.0', yiaddr: '0.0.0.0', giaddr: '0.0.0.0', hops: 0, ...m }) });
    this.l3.sendFrame(this.ifname, BCAST, 'ipv4', pkt);
  }
  discover() {
    if (this.done) return;
    if (this.tries >= DHCP_TIMING.tries) {
      this.dev.print('No DHCPOFFERS received.');
      this.dev.record('err', `DHCP on ${this.ifname}: no server answered after ${DHCP_TIMING.tries} DISCOVERs`, { tag: 'dhcp-failed' });
      return this.finish(false);
    }
    this.tries++; this.state = 'SELECTING';
    this.dev.print(`DHCPDISCOVER on ${this.ifname} to 255.255.255.255 port 67 interval ${DHCP_TIMING.retry / 1000}`);
    this.dev.record('info', `has no address on ${this.ifname} and asks for one: DHCP DISCOVER as a broadcast (attempt ${this.tries})`, { tag: 'dhcp-discover' });
    this.send({ op: 'DISCOVER' });
    this.timer = this.sim.schedule(DHCP_TIMING.retry, () => { if (this.state === 'SELECTING') this.discover(); });
  }
  onUdp(ip) {
    const d = ip.l4.payload;
    if (d?.kind !== 'dhcp' || ip.l4.dport !== 68 || d.xid !== this.xid || d.chaddr !== this.mac || this.done) return false;
    if (d.op === 'OFFER' && this.state === 'SELECTING') {
      this.sim.cancel(this.timer);
      this.state = 'REQUESTING';
      this.dev.print(`DHCPOFFER of ${d.yiaddr} from ${d.server}`);
      this.dev.print(`DHCPREQUEST for ${d.yiaddr} on ${this.ifname} to 255.255.255.255 port 67`);
      this.dev.record('learn', `gets an offer: ${d.yiaddr}/${d.prefix} from ${d.server}, requests it (DHCP REQUEST)`, { tag: 'dhcp-offer', data: { ip: d.yiaddr, server: d.server } });
      this.send({ op: 'REQUEST', requested: d.yiaddr, server: d.server });
      this.timer = this.sim.schedule(DHCP_TIMING.retry, () => { if (this.state === 'REQUESTING') this.discover(); });
      return true;
    }
    if (d.op === 'ACK' && this.state === 'REQUESTING') {
      this.sim.cancel(this.timer);
      this.l3.lease = { ifname: this.ifname, ip: d.yiaddr, prefix: d.prefix, router: d.router, dns: d.dns, server: d.server, lease: d.lease, t: this.sim.time };
      this.dev.print(`DHCPACK of ${d.yiaddr} from ${d.server}`);
      this.dev.print(`bound to ${d.yiaddr}/${d.prefix}${d.router ? ', gateway ' + d.router : ''}${d.dns ? ', DNS ' + d.dns : ''} -- renewal in ${Math.round(d.lease / 2)} seconds.`);
      this.dev.record('ok', `uses ${d.yiaddr}/${d.prefix} on ${this.ifname} now (gateway ${d.router || 'none'}, DNS ${d.dns || 'none'}, lease ${d.lease} s)`, { tag: 'dhcp-bound', data: { ip: d.yiaddr, router: d.router, dns: d.dns } });
      this.sim.emit('config', this.dev.id);
      this.finish(true);
      return true;
    }
    if (d.op === 'NAK') {
      this.sim.cancel(this.timer);
      this.dev.print(`DHCPNAK from ${d.server}`);
      this.dev.record('err', `the server refuses the requested address (DHCP NAK), starts over`, { tag: 'dhcp-nak' });
      this.tries = 0;
      this.discover();
      return true;
    }
    return true;
  }
  finish() { if (this.done) return; this.sim.cancel(this.timer); this.end(); }
}

// ---------------------------------------------------------------- Bridge with spanning tree
const cmpBid = (a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac);
const cmpPort = (a, b) => { const [ap, an] = a.split('.').map(Number), [bp, bn] = b.split('.').map(Number); return (ap - bp) || (an - bn); };
function cmpVec(a, b) {
  return cmpBid(a.root, b.root) || (a.cost - b.cost) || cmpBid(a.bridge, b.bridge) || cmpPort(a.port, b.port) || (a.rx && b.rx ? cmpPort(a.rx, b.rx) : 0);
}
const ROLE_TEXT = { root: 'Root port', designated: 'Designated', alternate: 'Alternate (blocked)', disabled: 'disabled' };
const STATE_TEXT = { blocking: 'Blocking', listening: 'Listening', learning: 'Learning', forwarding: 'Forwarding', disabled: 'Disabled' };

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
      this.dev.record('drop', `${p} is in state ${STATE_TEXT[ps.state]} (STP): frame dropped`, { frame, tag: 'stp-drop', data: { port: p, state: ps.state } });
      return;
    }
    const vid = from.vid ?? this.vidIn(p, frame);
    if (vid === null) {
      this.dev.record('drop', `Frame on ${p} matches no allowed VLAN (${frame.vlan ? 'tag ' + frame.vlan.vid : 'untagged'}), dropped`, { frame, tag: 'vlan-drop', data: { port: p } });
      return;
    }
    const inner = clone(frame); inner.vlan = null;
    if (this.ageingMs > 0 && !isGroupMac(frame.src) && from.learning !== false) {
      const key = vid + '|' + frame.src;
      const old = this.fdb.get(key);
      this.fdb.set(key, { port: p, t: this.sim.time, remote: from.remote || null });
      if (!old || old.port !== p || old.remote !== (from.remote || null)) {
        const flap = old && old.port !== p && this.sim.time - old.t < 1000;
        this.dev.record('learn', flap ? `MAC flapping: ${frame.src} jumps from ${old.port} to ${p}` : `learns: ${frame.src} is in VLAN ${vid} on ${p}${from.remote ? ' (behind VTEP ' + from.remote + ')' : ''}`,
          { tag: flap ? 'mac-flap' : 'mac-learned', data: { mac: frame.src, port: p, vid, remote: from.remote || null } });
      }
    }
    if (ps && ps.state === 'learning') { this.dev.record('drop', `${p} is in state Learning: MAC learned, but frame not forwarded`, { frame, tag: 'stp-learning' }); return; }
    const e = !isGroupMac(frame.dst) && this.ageingMs > 0 ? this.entry(vid, frame.dst) : null;
    if (e && (!this.stp || e.port.startsWith('vxlan') || this.stp.ports.get(e.port)?.state === 'forwarding')) {
      if (e.port === p) { this.dev.record('drop', `Destination ${frame.dst} is on the same port ${p}, frame is filtered`, { frame, tag: 'filtered' }); return; }
      this.dev.record('fwd', `forwards to ${e.port} (MAC table: ${frame.dst})`, { frame, tag: 'switched', data: { port: e.port } });
      this.egress(e.port, inner, vid, e.remote);
      return;
    }
    // Loop detection: the same broadcast keeps coming back
    if (isGroupMac(frame.dst) || !e) {
      const n = (this.seen.get(frame.id) || 0) + 1;
      this.seen.set(frame.id, n);
      if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
      if (n === 2) this.dev.record('err', `sees the same frame (${frame.type === 'arp' ? 'ARP' : 'IP'} from ${frame.src}) for the second time: the network has a loop!`, { frame, tag: 'loop-detected' });
      if (n >= T.loopHalt) return this.sim.halt(this.dev, `Broadcast storm: ${this.dev.name} has flooded the same frame ${n} times. Ethernet has no TTL, without spanning tree it circles forever. Simulation halted.`);
    }
    const why = frame.dst === BCAST ? 'Broadcast' : isGroupMac(frame.dst) ? 'Multicast' : this.ageingMs === 0 ? 'aging 0: learns nothing, floods everything' : `destination ${frame.dst} unknown`;
    const targets = this.allPorts().filter(x => x !== p && this.carries(x, vid) && !(from.remote && x.startsWith('vxlan')));
    this.dev.record('fwd', targets.length ? `floods to ${targets.join(', ')} (${why})` : `no other port in VLAN ${vid} (${why})`, { frame, tag: 'flooded', data: { ports: targets, why } });
    for (const t of targets) this.egress(t, inner, vid, null);
  }
  egress(p, inner, vid, remote) {
    if (p.startsWith('vxlan')) return this.dev.vxlanOut(p, inner, remote);
    const c = this.portCfg(p);
    const f = clone(inner);
    if (c.mode === 'trunk' && Number(c.native) !== vid) f.vlan = { vid, pcp: 0 };
    this.dev.transmit(p, f);
  }

  // ---------- Spanning tree (IEEE 802.1D, simplified)
  timers() { return STP_PRESETS[this.cfg.stp.timers] || STP_PRESETS.standard; }
  myId() { return { prio: Number(this.cfg.stp.priority ?? 32768), mac: macFor(this.dev.id + '/bridge') }; }
  portId(p) { return `128.${PORTS.switch.indexOf(p) + 1}`; }
  physUp(p) { const l = this.sim.linkAt(this.dev.id, p); return !!l && l.up; }
  stpStart() {
    if (this.stp) return;
    this.stp = { ports: new Map(), rootPort: null, rootId: this.myId(), rootCost: 0, tcUntil: 0, lastFlush: -1e9, timer: null };
    this.dev.record('info', `starts spanning tree (bridge ID ${fmtBid(this.myId())}) and initially considers itself the root`, { tag: 'stp-start' });
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
    this.dev.record('info', 'Spanning tree turned off: all ports forward immediately', { tag: 'stp-stop' });
  }
  stpHello() {
    const now = this.sim.time, { maxAge } = this.timers();
    let changed = false;
    for (const [p, ps] of this.stp.ports) {
      if (ps.info && now - ps.info.t > maxAge * 1000) {
        ps.info = null; changed = true;
        this.dev.record('err', `${p}: no BPDU for ${maxAge} s (max age), the stored information expires`, { tag: 'stp-maxage', data: { port: p } });
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
    if (ps.edge) { ps.edge = false; ps.edgeLost = true; this.dev.record('err', `${p} is configured as an edge port but receives a BPDU: loses edge status`, { frame, tag: 'stp-edge-lost', data: { port: p } }); }
    const isNew = !ps.info || cmpBid(ps.info.root, b.root) || ps.info.cost !== b.cost || cmpBid(ps.info.bridge, b.bridge);
    ps.info = { root: b.root, cost: b.cost, bridge: b.bridge, port: b.port, age: b.age, t: this.sim.time };
    if (isNew) this.dev.record('learn', `${p} receives BPDU: root ${fmtBid(b.root)}, cost ${b.cost}, from ${fmtBid(b.bridge)}`, { frame, tag: 'stp-bpdu', data: { port: p } });
    if (b.tc && p === this.stp.rootPort && this.sim.time - this.stp.lastFlush > 5000) {
      this.stp.lastFlush = this.sim.time;
      this.fdb.clear();
      this.stp.tcUntil = Math.max(this.stp.tcUntil, this.sim.time + this.timers().fwd * 1000);
      this.dev.record('info', 'Topology change reported: MAC table flushed, addresses are learned again', { tag: 'stp-tc-flush' });
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
      this.dev.record('info', rootPort ? `new root bridge: ${fmtBid(st.rootId)}, root port ${rootPort}, cost ${st.rootCost}` : 'is now the root bridge itself', { tag: 'stp-root', data: { root: fmtBid(st.rootId), rootPort } });
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
    if (role !== prev && !initial) this.dev.record('info', `${p} becomes ${ROLE_TEXT[role]}`, { tag: 'stp-role', data: { port: p, role } });
    if (role === 'alternate') {
      if (ps.state !== 'blocking') {
        const wasFwd = ps.state === 'forwarding';
        this.sim.cancel(ps.timer); ps.state = 'blocking';
        this.dev.record('info', `${p}: state Blocking (prevents a loop)`, { tag: 'stp-state', data: { port: p, state: 'blocking' } });
        if (wasFwd) this.topologyChange();
      }
      return;
    }
    if (ps.edge && role === 'designated') {
      if (ps.state !== 'forwarding') { this.sim.cancel(ps.timer); ps.state = 'forwarding'; this.dev.record('info', `${p} is an edge port (PortFast): Forwarding immediately`, { tag: 'stp-state', data: { port: p, state: 'forwarding', edge: true } }); }
      return;
    }
    if (ps.state === 'blocking' || ps.state === 'disabled') {
      ps.state = 'listening';
      this.dev.record('info', `${p}: state Listening (${this.timers().fwd} s, not forwarding anything yet)`, { tag: 'stp-state', data: { port: p, state: 'listening' } });
      const fwd = this.timers().fwd * 1000;
      ps.timer = this.sim.schedule(fwd, () => {
        if (!this.stp || ps.state !== 'listening') return;
        ps.state = 'learning';
        this.dev.record('info', `${p}: state Learning (${this.timers().fwd} s, learns MAC addresses, not forwarding yet)`, { tag: 'stp-state', data: { port: p, state: 'learning' } });
        ps.timer = this.sim.schedule(fwd, () => {
          if (!this.stp || ps.state !== 'learning') return;
          ps.state = 'forwarding';
          this.dev.record('ok', `${p}: state Forwarding, now forwarding`, { tag: 'stp-state', data: { port: p, state: 'forwarding' } });
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
      this.dev.record('info', 'Topology change: MAC table flushed and change reported via BPDU', { tag: 'stp-tc', data: {} });
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
export const STP_TEXT = { ROLE: ROLE_TEXT, STATE: STATE_TEXT };

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
      this.record('drop', `${port}: frame with ${plen} bytes of payload is larger than the MTU ${vm} of the VXLAN interface, silently dropped (no ICMP message on layer 2)`, { frame: inner, tag: 'vxlan-mtu-drop', data: { mtu: vm, len: plen } });
      return;
    }
    const targets = remote ? [remote] : (m.flood || []).filter(isIp);
    if (!targets.length) { this.record('drop', `${port}: flood list is empty, frame goes to no VTEP`, { frame: inner, tag: 'vxlan-no-flood' }); return; }
    const src = this.localIp();
    for (const t of targets) {
      const pkt = ipPacket({ src, dst: t, proto: PROTO.UDP, df: false, trace: traceOf(inner) ?? undefined,
        l4: udp(hashFlow(inner.src + inner.dst + (inner.type === 'ipv4' ? inner.payload.src + inner.payload.dst + inner.payload.proto : 'arp')),
          Number(m.dstport || VXLAN_PORT), { kind: 'vxlan', vni: Number(m.vni), frame: clone(inner) }) });
      this.record('info', `encapsulates in VXLAN (VNI ${m.vni}) and sends ${remote ? 'via unicast' : 'via head-end replication'} to VTEP ${t}`, { frame: ethFrame(this.mac('eth1'), '00:00:00:00:00:00', 'ipv4', pkt), tag: 'vxlan-encap', data: { vni: Number(m.vni), dst: t } });
      this.l3.output(pkt, {});
    }
  }
  onUdp(ip) {
    const l4 = ip.l4;
    if (l4.payload?.kind !== 'vxlan') return false;
    const onPort = this.maps().filter(m => Number(m.dstport || VXLAN_PORT) === l4.dport);
    if (!onPort.length) return false;
    const m = onPort.find(x => Number(x.vni) === l4.payload.vni);
    if (!m) { this.record('drop', `Received VXLAN with VNI ${l4.payload.vni} from ${ip.src}, but no segment with this VNI: dropped`, { tag: 'vxlan-vni-unknown', data: { vni: l4.payload.vni } }); return true; }
    this.record('info', `decapsulates VXLAN from ${ip.src} (VNI ${m.vni} → VLAN ${m.vlan})`, { tag: 'vxlan-decap', data: { vni: Number(m.vni), from: ip.src } });
    this.bridge.receive('vxlan' + m.vni, clone(l4.payload.frame), { vid: Number(m.vlan), remote: ip.src, learning: m.learning !== false });
    return true;
  }
  ping(dst, o) { return Host.prototype.ping.call(this, dst, o); }
  traceroute(dst, o) { return Host.prototype.traceroute.call(this, dst, o); }
  arping(t, o) { return Host.prototype.arping.call(this, t, o); }
}

export function newId(prefix = 'd') { return prefix + Math.random().toString(36).slice(2, 9); }
export { TCP_HDR };
