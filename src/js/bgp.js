// BGP-4: sessions over TCP 179 with the real state machine, eBGP and iBGP, path attributes,
// best path selection, route reflection and the EVPN address family for VXLAN.
import { PROTO, isIp, parseCidr, inNet, ipToInt } from './net.js';
import { ipPacket, tcp } from './packets.js';

export const BGP_PORT = 179;
export const BGP_TIMERS = { fast: { keepalive: 3, hold: 9, retry: 5 }, standard: { keepalive: 60, hold: 180, retry: 30 } };
const ipCmp = (a, b) => (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0);
const pfx = c => `${c.net}/${c.len}`;
const NOTIF = { '2/2': 'OPEN Message Error: Bad Peer AS', '2/3': 'OPEN Message Error: Bad BGP Identifier', '4/0': 'Hold Timer Expired', '6/2': 'Cease: Administrative Shutdown', '6/4': 'Cease: Administrative Reset' };
export const notifText = (c, s) => NOTIF[`${c}/${s}`] || `code ${c}/${s}`;

/** Message length on the wire: 19 byte header plus the body */
export function bgpLen(m) {
  if (m.type === 'KEEPALIVE') return 19;
  if (m.type === 'OPEN') return 29 + 8 * (m.caps?.length || 1);
  if (m.type === 'NOTIFICATION') return 21;
  const attrs = m.nlri?.length || m.evpn?.length ? 4 + 4 + 4 * (m.attrs?.asPath?.length || 0) + 7 + (m.attrs?.localPref != null ? 7 : 0) + (m.attrs?.med != null ? 7 : 0) + (m.attrs?.originatorId ? 7 : 0) + (m.attrs?.clusterList?.length ? 3 + 4 * m.attrs.clusterList.length : 0) : 0;
  return 23 + 4 * (m.withdrawn?.length || 0) + attrs + 4 * (m.nlri?.length || 0) + 40 * ((m.evpn?.length || 0) + (m.evpnWithdrawn?.length || 0));
}
export const asPathText = p => (p?.length ? p.join(' ') : '');

export class Bgp {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.l3 = dev.l3; this.peers = new Map(); this.best = new Map(); this.evpnBest = new Map(); this.timers = []; this.gen = 0; }
  get cfg() { return this.dev.cfg.bgp || {}; }
  get enabled() { return !!this.cfg.enabled && Number(this.cfg.asn) > 0; }
  get asn() { return Number(this.cfg.asn); }
  timersCfg() { return BGP_TIMERS[this.cfg.timers] || BGP_TIMERS.fast; }
  get rid() {
    if (isIp(this.cfg.rid)) return this.cfg.rid;
    const lo = this.l3.ifaces().find(i => i.name === 'lo');
    const ips = this.l3.ifaces().map(i => i.ip).sort(ipCmp);
    return lo?.ip || ips[ips.length - 1] || '0.0.0.0';
  }
  rec(kind, text, extra) { return this.dev.record(kind, text, extra); }
  later(ms, fn) { const g = this.gen; const ev = this.sim.schedule(ms, () => { this.timers = this.timers.filter(x => x !== ev); if (g === this.gen) fn(); }); this.timers.push(ev); return ev; }
  nbrs() { return (this.cfg.neighbors || []).filter(n => isIp(n.ip) && n.enabled !== false); }
  isRR() { return this.nbrs().some(n => n.rrClient); }
  ebgp(n) { return Number(n.remoteAs) !== this.asn; }
  localIp(n) {
    if (n.updateSource) return this.l3.ifaces().find(i => i.name === n.updateSource)?.ip || null;
    const r = this.l3.lookup(n.ip);
    return r ? this.l3.ifIp(r.dev) : null;
  }

  // ---- Life cycle
  start() {
    this.stop();
    this.snap = this.snapshot();
    if (!this.enabled) return;
    this.rec('info', `BGP starts: AS ${this.asn}, router ID ${this.rid}, ${this.nbrs().length} neighbor${this.nbrs().length === 1 ? '' : 's'}`, { tag: 'bgp-start' });
    for (const n of this.nbrs()) {
      const p = this.peer(n);
      this.later(100 + this.sim.random() * 300, () => this.connect(p));
    }
    const scan = () => { this.recompute(); this.later(1000, scan); };
    this.later(500, scan);
  }
  stop() {
    this.gen++;
    for (const t of this.timers) this.sim.cancel(t);
    this.timers = [];
    this.peers.clear(); this.best.clear(); this.evpnBest.clear(); this.routesCache = [];
  }
  snapshot() { return JSON.stringify(this.cfg); }
  onConfig() {
    const s = this.snapshot();
    if (s === this.snap) return;
    const old = this.snap ? JSON.parse(this.snap) : null;
    this.snap = s;
    // AS or router ID changed: everything starts over. Otherwise only the neighbors that changed.
    if (!old || old.enabled !== this.cfg.enabled || Number(old.asn) !== this.asn || old.rid !== this.cfg.rid || old.timers !== this.cfg.timers || !this.enabled) return this.start();
    const was = new Map((old.neighbors || []).map(n => [n.ip, JSON.stringify(n)]));
    for (const n of this.nbrs()) {
      const p = this.peers.get(n.ip);
      if (!p) { this.later(100, () => this.connect(this.peer(n))); continue; }
      const prev = was.get(n.ip) ? JSON.parse(was.get(n.ip)) : null;
      p.cfg = n;
      // Policy changes (local preference, MED, next-hop-self, reflection) take effect without a reset, like a soft clear
      const hard = !prev || ['remoteAs', 'updateSource', 'multihop', 'evpn'].some(k => String(prev[k] ?? '') !== String(n[k] ?? ''));
      if (hard && p.state !== 'Idle') this.reset(p, 'neighbor configuration changed', true);
    }
    for (const [ip, p] of [...this.peers]) if (!this.nbrs().some(n => n.ip === ip)) { if (p.state === 'Established') this.notify(p, 6, 2); this.down(p, 'neighbor removed', false); this.peers.delete(ip); }
    this.recompute();
  }
  peer(n) {
    if (!this.peers.has(n.ip)) this.peers.set(n.ip, { ip: n.ip, cfg: n, state: 'Idle', sock: null, rx: new Map(), rxEvpn: new Map(), out: new Map(), outEvpn: new Map(), msgsIn: 0, msgsOut: 0, upSince: null, hold: null, ka: null, retry: null, holdTime: 0, remoteRid: null, lastError: '' });
    const p = this.peers.get(n.ip); p.cfg = n; return p;
  }
  setState(p, st, why = '') {
    if (p.state === st) return;
    const old = p.state; p.state = st;
    this.rec(st === 'Established' ? 'ok' : st === 'Idle' && old === 'Established' ? 'err' : 'info', `BGP neighbor ${p.ip} (AS ${p.cfg.remoteAs}): ${old} → ${st}${why ? ', ' + why : ''}`, { tag: 'bgp-state', data: { peer: p.ip, state: st, from: old } });
    this.sim.emit('config', this.dev.id);
  }

  // ---- Connecting
  connect(p) {
    if (!this.enabled || !this.peers.has(p.ip) || ['OpenSent', 'OpenConfirm', 'Established'].includes(p.state)) return;
    const n = p.cfg, t = this.timersCfg();
    this.sim.cancel(p.retry);
    p.retry = this.later(t.retry * 1000, () => { if (!['OpenSent', 'OpenConfirm', 'Established'].includes(p.state)) this.connect(p); });
    if (!Number(n.remoteAs)) { p.lastError = 'no remote AS configured'; return; }
    const local = this.localIp(n);
    if (!this.l3.lookup(n.ip) || !local) {
      p.lastError = n.updateSource && !local ? `update source ${n.updateSource} has no address` : `no route to ${n.ip}`;
      if (p.state !== 'Idle') this.setState(p, 'Idle', p.lastError);
      else if (!p.warned) { p.warned = true; this.rec('err', `BGP neighbor ${n.ip}: ${p.lastError}, waiting`, { tag: 'bgp-noroute', data: { peer: n.ip } }); }
      return;
    }
    // eBGP neighbors must be directly connected, unless ebgp-multihop allows more hops (TTL)
    if (this.ebgp(n) && !Number(n.multihop) && !this.l3.ifaces().some(i => i.name !== 'lo' && inNet(n.ip, i.ip, i.prefix))) {
      p.lastError = 'eBGP neighbor is not directly connected (ebgp-multihop missing)';
      if (!p.warned) { p.warned = true; this.rec('err', `BGP neighbor ${n.ip} is an eBGP neighbor, but not on a directly connected network: no session without ebgp-multihop`, { tag: 'bgp-noconnect', data: { peer: n.ip } }); }
      if (p.state !== 'Idle') this.setState(p, 'Idle', p.lastError);
      return;
    }
    p.warned = false;
    // To avoid two crossing connections, the side with the lower address opens it; the other one listens
    if (ipCmp(local, n.ip) < 0) {
      this.setState(p, 'Connect');
      p.sock = { lport: 49152 + Math.floor(this.sim.random() * 16000), rport: BGP_PORT, local, seq: Math.floor(this.sim.random() * 4e9) >>> 0 };
      this.rec('info', `opens a TCP connection to the BGP neighbor ${n.ip}:179 from ${local}`, { tag: 'bgp-connect', data: { peer: n.ip } });
      this.sendSeg(p, { SYN: true });
    } else this.setState(p, 'Active', 'waiting for the neighbor to connect');
  }
  ttlFor(n) { return this.ebgp(n) ? Math.max(1, Number(n.multihop) || 1) : 64; }
  sendSeg(p, flags, msg = null) {
    const s = p.sock;
    const seg = tcp(s.lport, s.rport, s.seq, s.ack || 0, flags, msg ? { dataLen: bgpLen(msg), bgp: msg, app: `BGP ${msg.type}` } : { mss: 1460 });
    if (msg) s.seq = (s.seq + bgpLen(msg)) >>> 0; else if (flags.SYN) s.seq = (s.seq + 1) >>> 0;
    const pkt = ipPacket({ src: s.local, dst: p.ip, ttl: this.ttlFor(p.cfg), proto: PROTO.TCP, df: true, l4: seg });
    return this.l3.output(pkt, {});
  }
  send(p, msg) {
    if (!p.sock) return;
    p.msgsOut++;
    this.sendSeg(p, { PSH: true, ACK: true }, msg);
  }
  /** A TCP segment to or from port 179. Returns true when BGP took care of it. */
  onTcp(ip) {
    const s = ip.l4;
    if (s.dport !== BGP_PORT && s.sport !== BGP_PORT) return false;
    if (!this.enabled) return false;
    const n = this.nbrs().find(x => x.ip === ip.src);
    if (s.dport === BGP_PORT && s.flags.SYN && !s.flags.ACK) {
      if (!n) {
        this.rec('drop', `refuses a BGP connection from ${ip.src}: not a configured neighbor (connection reset)`, { tag: 'bgp-refused', data: { from: ip.src } });
        this.l3.sendTcp(ip.src, tcp(BGP_PORT, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
        return true;
      }
      const p = this.peer(n);
      if (['OpenSent', 'OpenConfirm', 'Established'].includes(p.state) && p.sock?.rport !== s.sport) {
        this.l3.sendTcp(ip.src, tcp(BGP_PORT, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
        return true;
      }
      if (ip.dst !== this.localIp(n)) {
        this.rec('drop', `refuses a BGP connection from ${ip.src} to ${ip.dst}: the session is configured from ${this.localIp(n) || '?'} (update-source)`, { tag: 'bgp-refused', data: { from: ip.src } });
        this.l3.sendTcp(ip.src, tcp(BGP_PORT, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
        return true;
      }
      p.sock = { lport: BGP_PORT, rport: s.sport, local: ip.dst, seq: Math.floor(this.sim.random() * 4e9) >>> 0, ack: s.seq + 1, passive: true };
      this.sendSeg(p, { SYN: true, ACK: true });
      if (p.state === 'Idle' || p.state === 'Connect') this.setState(p, 'Active', 'TCP connection accepted');
      return true;
    }
    const p = n && this.peers.get(n.ip);
    if (!p || !p.sock || s.dport !== p.sock.lport || s.sport !== p.sock.rport) {
      // A rejected connection (RST from the other side) or something for a session that is gone
      if (s.flags.RST && p) { p.lastError = 'connection refused by the neighbor'; this.rec('err', `BGP neighbor ${ip.src} refuses the connection (RST)`, { tag: 'bgp-rst', data: { peer: ip.src } }); this.setState(p, 'Active', 'connection refused'); }
      return true;
    }
    if (s.flags.RST) { p.lastError = 'connection reset'; this.down(p, 'TCP connection reset by the neighbor'); return true; }
    if (s.flags.SYN && s.flags.ACK && p.state === 'Connect') {
      p.sock.ack = s.seq + 1;
      this.sendSeg(p, { ACK: true });
      this.sendOpen(p);
      this.setState(p, 'OpenSent', 'TCP connection established, OPEN sent');
      return true;
    }
    if (s.bgp) { p.sock.ack = (s.seq + s.dataLen) >>> 0; p.msgsIn++; this.onMessage(p, s.bgp, ip); }
    return true;
  }
  sendOpen(p) {
    const t = this.timersCfg();
    this.send(p, { type: 'OPEN', version: 4, asn: this.asn, hold: t.hold, rid: this.rid, caps: ['IPv4 unicast', ...(p.cfg.evpn ? ['L2VPN EVPN'] : []), '4-octet AS'] });
  }
  notify(p, code, sub, text = '') {
    this.rec('err', `sends NOTIFICATION to ${p.ip}: ${notifText(code, sub)}${text ? ' (' + text + ')' : ''}`, { tag: 'bgp-notify-sent', data: { peer: p.ip, code, sub } });
    this.send(p, { type: 'NOTIFICATION', code, sub, text });
  }

  // ---- Messages
  onMessage(p, m, ip) {
    const t = this.timersCfg();
    if (m.type === 'OPEN') {
      if (Number(m.asn) !== Number(p.cfg.remoteAs)) {
        p.lastError = `Bad Peer AS: the neighbor says AS ${m.asn}, configured is AS ${p.cfg.remoteAs}`;
        this.rec('err', `OPEN from ${p.ip} with AS ${m.asn}, but remote-as is ${p.cfg.remoteAs}: the session is refused`, { tag: 'bgp-badas', data: { peer: p.ip, got: m.asn, want: Number(p.cfg.remoteAs) } });
        this.notify(p, 2, 2, `expected ${p.cfg.remoteAs}`);
        return this.down(p, 'Bad Peer AS');
      }
      if (m.rid === this.rid) { this.notify(p, 2, 3); return this.down(p, 'same router ID on both sides'); }
      p.remoteRid = m.rid;
      p.holdTime = Math.min(t.hold, m.hold);
      p.remoteCaps = m.caps || [];
      if (p.state === 'Active') { this.sendOpen(p); this.send(p, { type: 'KEEPALIVE' }); this.setState(p, 'OpenConfirm', 'OPEN received and answered'); }
      else if (p.state === 'OpenSent') { this.send(p, { type: 'KEEPALIVE' }); this.setState(p, 'OpenConfirm', 'OPEN received'); }
      this.armHold(p);
      return;
    }
    if (m.type === 'NOTIFICATION') {
      p.lastError = `received NOTIFICATION: ${notifText(m.code, m.sub)}${m.text ? ' (' + m.text + ')' : ''}`;
      this.rec('err', `BGP neighbor ${p.ip} sends NOTIFICATION: ${notifText(m.code, m.sub)}${m.text ? ' (' + m.text + ')' : ''}`, { tag: 'bgp-notify', data: { peer: p.ip, code: m.code, sub: m.sub } });
      return this.down(p, 'NOTIFICATION received');
    }
    if (m.type === 'KEEPALIVE') {
      this.armHold(p);
      if (p.state === 'OpenConfirm') {
        p.upSince = this.sim.time;
        this.setState(p, 'Established', `the session is up, hold time ${p.holdTime} s`);
        p.out.clear(); p.outEvpn.clear();
        this.armKeepalive(p);
        this.recompute(true);
      }
      return;
    }
    if (m.type === 'UPDATE' && p.state === 'Established') {
      this.armHold(p);
      this.onUpdate(p, m);
    }
  }
  armHold(p) {
    this.sim.cancel(p.hold);
    const h = (p.holdTime || this.timersCfg().hold) * 1000;
    p.hold = this.later(h, () => {
      if (!this.peers.has(p.ip) || p.state === 'Idle') return;
      p.lastError = 'hold timer expired';
      this.rec('err', `BGP neighbor ${p.ip}: no message for ${h / 1000} s, hold timer expired`, { tag: 'bgp-holdexp', data: { peer: p.ip } });
      this.notify(p, 4, 0);
      this.down(p, 'hold timer expired');
    });
  }
  armKeepalive(p) {
    this.sim.cancel(p.ka);
    const iv = Math.max(1, Math.floor((p.holdTime || this.timersCfg().hold) / 3)) * 1000;
    p.ka = this.later(iv, () => { if (p.state !== 'Established') return; this.send(p, { type: 'KEEPALIVE' }); this.armKeepalive(p); });
  }
  down(p, why, retry = true) {
    this.sim.cancel(p.hold); this.sim.cancel(p.ka);
    const had = p.rx.size + p.rxEvpn.size;
    p.rx.clear(); p.rxEvpn.clear(); p.out.clear(); p.outEvpn.clear(); p.sock = null; p.upSince = null;
    this.setState(p, 'Idle', why);
    if (had) this.rec('info', `withdraws the ${had} route${had === 1 ? '' : 's'} learned from ${p.ip}`, { tag: 'bgp-flush', data: { peer: p.ip } });
    this.recompute();
    if (retry) { this.sim.cancel(p.retry); p.retry = this.later(this.timersCfg().retry * 1000, () => this.connect(p)); }
  }
  reset(p, why, retry = true) { if (p.state === 'Established') this.notify(p, 6, 4); this.down(p, why, retry); }
  clear(ip = '*') {
    for (const p of this.peers.values()) if (ip === '*' || p.ip === ip) { this.reset(p, 'clear ip bgp'); this.later(200, () => this.connect(p)); }
  }
  onUpdate(p, m) {
    const ebgp = this.ebgp(p.cfg);
    for (const w of m.withdrawn || []) if (p.rx.delete(w)) this.rec('info', `${p.ip} withdraws ${w}`, { tag: 'bgp-withdraw-rx', data: { peer: p.ip, prefix: w } });
    for (const e of m.evpnWithdrawn || []) if (p.rxEvpn.delete(e)) this.rec('info', `${p.ip} withdraws the EVPN route ${e}`, { tag: 'bgp-evpn-withdraw', data: { peer: p.ip, key: e } });
    const a = m.attrs || {};
    const add = [];
    for (const n of m.nlri || []) {
      if (ebgp && (a.asPath || []).includes(this.asn)) { this.rec('drop', `ignores ${n} from ${p.ip}: its AS path ${asPathText(a.asPath)} already contains AS ${this.asn} (loop)`, { tag: 'bgp-loop', data: { peer: p.ip, prefix: n } }); continue; }
      if (a.originatorId === this.rid || (a.clusterList || []).includes(this.rid)) { this.rec('drop', `ignores ${n} from ${p.ip}: it was reflected back to its own origin (originator ID / cluster list)`, { tag: 'bgp-loop', data: { peer: p.ip, prefix: n } }); continue; }
      p.rx.set(n, { ...a });
      add.push(n);
    }
    for (const e of m.evpn || []) {
      if (e.originatorId === this.rid) continue;
      p.rxEvpn.set(e.key, { ...e, nextHop: e.nextHop ?? a.nextHop, asPath: a.asPath || [] });
    }
    if (add.length) this.rec('learn', `${p.ip} announces ${add.join(', ')}: AS path ${asPathText(a.asPath) || '(empty, from its own AS)'}, next hop ${a.nextHop}${a.localPref != null && !ebgp ? ', local pref ' + a.localPref : ''}${a.med != null ? ', MED ' + a.med : ''}`, { tag: 'bgp-update-rx', data: { peer: p.ip, prefixes: add, asPath: a.asPath, nextHop: a.nextHop } });
    if (m.evpn?.length) this.rec('learn', `${p.ip} announces ${m.evpn.length} EVPN route${m.evpn.length === 1 ? '' : 's'}: ${m.evpn.map(e => e.rt === 2 ? `type 2 ${e.mac}${e.ip ? ' ' + e.ip : ''} VNI ${e.vni}` : `type 3 VNI ${e.vni} from ${e.nextHop ?? a.nextHop}`).join(', ')}`, { tag: 'bgp-evpn-rx', data: { peer: p.ip, count: m.evpn.length } });
    this.recompute();
  }

  // ---- Routes
  /** Routing table entries without BGP, to find out how to reach a next hop */
  resolve(nh) {
    let best = null;
    for (const r of this.l3.routes(true)) {
      if (r.proto === 'S' && !r.dev) continue;
      if (!inNet(nh, r.net, r.len) || r.len === 0) continue;
      if (!best || r.len > best.len) best = r;
    }
    return best ? { via: best.via || nh, dev: best.dev, metric: best.proto === 'O' ? best.metric || 0 : 0 } : null;
  }
  localPaths() {
    const out = [];
    const rib = this.l3.routes(true);
    for (const s of this.cfg.networks || []) {
      const c = parseCidr(s);
      if (!c) continue;
      const exists = rib.some(r => r.net === c.net && r.len === c.len && (r.proto !== 'S' || r.dev));
      out.push({ prefix: pfx(c), from: 'local', local: true, valid: exists, why: exists ? '' : 'not in the routing table (network needs an exact match)', attrs: { origin: 'i', asPath: [], nextHop: '0.0.0.0', med: 0, localPref: 100 }, weight: 32768 });
    }
    if (this.cfg.redistributeConnected) for (const r of rib) if (r.proto === 'C' && !out.some(o => o.prefix === `${r.net}/${r.len}`)) out.push({ prefix: `${r.net}/${r.len}`, from: 'local', local: true, valid: true, attrs: { origin: '?', asPath: [], nextHop: '0.0.0.0', med: 0, localPref: 100 }, weight: 32768 });
    return out;
  }
  /** Best path selection in the order of FRR; returns [winner first, reason] */
  compare(a, b) {
    if (a.weight !== b.weight) return [b.weight - a.weight, 'weight'];
    const lp = x => x.attrs.localPref ?? 100;
    if (lp(a) !== lp(b)) return [lp(b) - lp(a), 'local preference'];
    if (a.local !== b.local) return [a.local ? -1 : 1, 'locally originated'];
    if (a.attrs.asPath.length !== b.attrs.asPath.length) return [a.attrs.asPath.length - b.attrs.asPath.length, 'AS path length'];
    const og = { i: 0, e: 1, '?': 2 };
    if (og[a.attrs.origin] !== og[b.attrs.origin]) return [og[a.attrs.origin] - og[b.attrs.origin], 'origin'];
    if (a.attrs.asPath[0] === b.attrs.asPath[0] && (a.attrs.med ?? 0) !== (b.attrs.med ?? 0)) return [(a.attrs.med ?? 0) - (b.attrs.med ?? 0), 'MED'];
    if (a.ebgp !== b.ebgp) return [a.ebgp ? -1 : 1, 'eBGP over iBGP'];
    if ((a.igp ?? 0) !== (b.igp ?? 0)) return [(a.igp ?? 0) - (b.igp ?? 0), 'IGP metric to the next hop'];
    const ra = a.attrs.originatorId || a.rid || '', rb = b.attrs.originatorId || b.rid || '';
    if (ra !== rb) return [ipCmp(ra, rb), 'router ID'];
    return [ipCmp(a.from, b.from), 'neighbor address'];
  }
  paths() {
    const all = this.localPaths();
    for (const p of this.peers.values()) {
      if (p.state !== 'Established') continue;
      const ebgp = this.ebgp(p.cfg);
      // Inbound policy is applied every time, so a change takes effect at once (like a route refresh)
      const lp = p.cfg.localPref != null && p.cfg.localPref !== '' ? Number(p.cfg.localPref) : null;
      for (const [prefix, raw] of p.rx) {
        const attrs = { ...raw, localPref: lp ?? (ebgp ? 100 : raw.localPref ?? 100) };
        const r = this.resolve(attrs.nextHop);
        all.push({ prefix, from: p.ip, rid: p.remoteRid, ebgp, ibgp: !ebgp, attrs, weight: 0, valid: !!r, why: r ? '' : `next hop ${attrs.nextHop} is not reachable (inaccessible)`, igp: r?.metric ?? 0, nh: r });
      }
    }
    return all;
  }
  recompute(force = false) {
    if (!this.enabled) { this.best.clear(); return; }
    const byPrefix = new Map();
    for (const x of this.paths()) { if (!byPrefix.has(x.prefix)) byPrefix.set(x.prefix, []); byPrefix.get(x.prefix).push(x); }
    const best = new Map();
    for (const [prefix, list] of byPrefix) {
      const valid = list.filter(x => x.valid);
      let win = null, reason = '';
      for (const x of valid) {
        if (!win) { win = x; continue; }
        const [d, why] = this.compare(x, win);
        if (d < 0) { win = x; reason = why; } else if (!reason) reason = why;
      }
      for (const x of list) x.best = x === win;
      if (win) win.reason = valid.length > 1 ? reason : 'only path';
      best.set(prefix, { list, win });
    }
    const before = JSON.stringify([...this.best].map(([k, v]) => [k, v.win?.from, v.win?.attrs?.nextHop]));
    this.best = best;
    const after = JSON.stringify([...best].map(([k, v]) => [k, v.win?.from, v.win?.attrs?.nextHop]));
    if (before !== after && !force) {
      const n = [...best.values()].filter(v => v.win && !v.win.local).length;
      this.rec('info', `BGP best paths recomputed: ${n} route${n === 1 ? '' : 's'} learned from neighbors in use`, { tag: 'bgp-best', data: { routes: n } });
    }
    this.dev.evpn?.recomputeBgp?.();
    for (const p of this.peers.values()) if (p.state === 'Established') this.advertise(p);
  }
  /** What a neighbor gets: the rules for eBGP and iBGP, split horizon and route reflection */
  outFor(p) {
    const out = new Map();
    const ebgp = this.ebgp(p.cfg), rr = this.isRR();
    const local = p.sock?.local || this.localIp(p.cfg);
    for (const [prefix, { win }] of this.best) {
      if (!win) continue;
      if (win.from === p.ip) continue;
      if (win.ibgp && !ebgp) {
        // iBGP split horizon: never pass an iBGP route to another iBGP neighbor, unless reflecting it
        const fromClient = !!this.nbrs().find(n => n.ip === win.from)?.rrClient;
        if (!rr || (!fromClient && !p.cfg.rrClient)) continue;
      }
      const a = win.attrs;
      let attrs;
      if (ebgp) {
        const prep = Math.max(0, Number(p.cfg.prepend) || 0);
        attrs = { origin: a.origin, asPath: [...Array(prep + 1).fill(this.asn), ...a.asPath], nextHop: local, ...(p.cfg.med !== '' && p.cfg.med != null ? { med: Number(p.cfg.med) } : {}) };
      } else {
        const self = win.local || p.cfg.nextHopSelf && win.ebgp;
        attrs = { origin: a.origin, asPath: [...a.asPath], nextHop: self ? local : a.nextHop, localPref: a.localPref ?? 100, ...(a.med != null ? { med: a.med } : {}) };
        if (win.ibgp && rr) { attrs.originatorId = a.originatorId || win.rid; attrs.clusterList = [this.rid, ...(a.clusterList || [])]; }
      }
      out.set(prefix, attrs);
    }
    return out;
  }
  advertise(p) {
    const want = this.outFor(p);
    const withdrawn = [...p.out.keys()].filter(k => !want.has(k));
    const groups = new Map();
    for (const [prefix, attrs] of want) {
      const key = JSON.stringify(attrs);
      if (p.out.get(prefix) === key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(prefix);
    }
    for (const w of withdrawn) p.out.delete(w);
    if (withdrawn.length) { this.send(p, { type: 'UPDATE', withdrawn, nlri: [], attrs: {} }); this.rec('info', `withdraws ${withdrawn.join(', ')} at ${p.ip}`, { tag: 'bgp-withdraw-sent', data: { peer: p.ip } }); }
    for (const [key, list] of groups) {
      const attrs = JSON.parse(key);
      for (const x of list) p.out.set(x, key);
      this.send(p, { type: 'UPDATE', withdrawn: [], nlri: list, attrs });
      this.rec('info', `announces ${list.join(', ')} to ${p.ip}: AS path ${asPathText(attrs.asPath) || '(empty)'}, next hop ${attrs.nextHop}`, { tag: 'bgp-update-sent', data: { peer: p.ip, prefixes: list } });
    }
    this.advertiseEvpn(p);
  }
  /** EVPN routes, only when both sides announced the address family in their OPEN */
  evpnOk(p) { return !!p.cfg.evpn && (p.remoteCaps || []).includes('L2VPN EVPN'); }
  evpnOut(p) {
    const out = new Map();
    if (!this.evpnOk(p)) return out;
    const local = p.sock?.local || this.localIp(p.cfg);
    for (const r of this.dev.evpn?.localRoutes() || []) out.set(r.key, { ...r, nextHop: local });
    const rr = this.isRR();
    for (const q of this.peers.values()) {
      if (q === p || q.state !== 'Established' || !this.evpnOk(q)) continue;
      // The same reflection rules as for IPv4 routes
      if (!rr || (!q.cfg.rrClient && !p.cfg.rrClient)) continue;
      for (const [k, e] of q.rxEvpn) {
        if (out.has(k) || (e.originatorId || q.remoteRid) === p.remoteRid) continue;
        out.set(k, { ...e, originatorId: e.originatorId || q.remoteRid });
      }
    }
    return out;
  }
  advertiseEvpn(p) {
    const want = this.evpnOut(p);
    const withdrawn = [...p.outEvpn.keys()].filter(k => !want.has(k));
    const add = [];
    for (const [k, e] of want) { const j = JSON.stringify(e); if (p.outEvpn.get(k) !== j) { add.push(e); p.outEvpn.set(k, j); } }
    for (const k of withdrawn) p.outEvpn.delete(k);
    if (!add.length && !withdrawn.length) return;
    this.send(p, { type: 'UPDATE', withdrawn: [], nlri: [], evpn: add, evpnWithdrawn: withdrawn, attrs: { origin: 'i', asPath: [], nextHop: add[0]?.nextHop || p.sock?.local, localPref: 100 } });
    if (add.length) this.rec('info', `announces ${add.length} EVPN route${add.length === 1 ? '' : 's'} to ${p.ip}: ${add.map(e => e.rt === 2 ? `type 2 ${e.mac}` : `type 3 VNI ${e.vni}`).join(', ')}`, { tag: 'bgp-evpn-sent', data: { peer: p.ip, count: add.length } });
  }
  /** Routes for the routing table: the best path of every prefix learned from a neighbor */
  routes() {
    if (!this.enabled) return [];
    const out = [];
    for (const [prefix, { win }] of this.best) {
      if (!win || win.local || !win.valid) continue;
      const nh = this.resolve(win.attrs.nextHop);
      if (!nh) continue;
      const c = parseCidr(prefix);
      out.push({ net: c.net, len: c.len, via: nh.via, dev: nh.dev, proto: 'B', ibgp: win.ibgp, metric: win.attrs.med ?? 0, bgpNh: win.attrs.nextHop, asPath: win.attrs.asPath });
    }
    return out;
  }
  summary() {
    return [...this.peers.values()].map(p => ({ ip: p.ip, as: Number(p.cfg.remoteAs), state: p.state, up: p.upSince === null ? null : Math.round((this.sim.time - p.upSince) / 1000),
      pfx: p.rx.size, evpn: p.rxEvpn.size, msgsIn: p.msgsIn, msgsOut: p.msgsOut, type: this.ebgp(p.cfg) ? 'eBGP' : 'iBGP', error: p.lastError }));
  }
  table() {
    const rows = [];
    for (const [prefix, { list }] of [...this.best].sort((a, b) => ipCmp(a[0].split('/')[0], b[0].split('/')[0]))) {
      for (const x of list.sort((a, b) => (b.best - a.best))) rows.push({ prefix, best: x.best, valid: x.valid, ibgp: !!x.ibgp, nextHop: x.attrs.nextHop, med: x.attrs.med ?? 0, localPref: x.local || x.ibgp ? x.attrs.localPref ?? 100 : null, weight: x.weight, asPath: x.attrs.asPath, origin: x.attrs.origin, from: x.from, why: x.why, reason: x.reason });
    }
    return rows;
  }
}
