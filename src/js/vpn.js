// WireGuard: an interface wg0 with keys, peers with allowed IPs (cryptokey routing),
// the handshake over UDP, encrypted data packets with the inner IP packet, keepalives and
// roaming endpoints. The cryptography itself is not simulated, only its effects.
import { PROTO, isIp, parseCidr, inNet, clone } from './net.js';
import { ipPacket, udp } from './packets.js';

export const WG_PORT = 51820;
export const WG_T = { rekeyTimeout: 5000, tries: 4, rejectAfter: 180000, rekeyAfter: 120000 };
export const WG_SIZE = { init: 148, resp: 92, keepalive: 32 };
/** Length of a data message: 16 header + inner packet padded to 16 bytes + 16 authentication tag */
export const wgDataLen = innerLen => 32 + Math.ceil(innerLen / 16) * 16;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
};
const bytesFrom = (seed, n = 32) => {
  const out = [];
  let h = 2166136261;
  for (let i = 0; i < n; i++) {
    for (const c of seed + i) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    out.push((h >>> 0) & 255);
  }
  return out;
};
/** A private key looks like one (32 bytes, base64); the public key is derived from it, so a typo shows */
export const wgGenKey = seed => toB64(bytesFrom('priv:' + seed));
export const wgPubKey = priv => (priv ? toB64(bytesFrom('pub:' + String(priv).trim())) : '');
export const isWgKey = k => /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(String(k || '').trim());
export const shortKey = k => (k ? String(k).slice(0, 8) + '…' : '(none)');

const cidrs = s => String(s || '').split(/[\s,]+/).map(x => parseCidr(x.includes('/') ? x : x + '/32')).filter(Boolean);
const endpointOf = s => { const m = String(s || '').trim().match(/^(\d+\.\d+\.\d+\.\d+):(\d+)$/); return m && isIp(m[1]) ? { ip: m[1], port: Number(m[2]) } : null; };

export class Wg {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.l3 = dev.l3; this.peers = new Map(); this.timers = []; this.idx = 1; }
  get cfg() { return this.dev.cfg.wg; }
  get on() { return !!this.cfg?.enabled && !!this.dev.cfg.ifaces?.wg0; }
  get pub() { return wgPubKey(this.cfg?.privateKey); }
  port() { return Number(this.cfg?.listenPort) || WG_PORT; }
  later(ms, fn) { const ev = this.sim.schedule(ms, () => { this.timers = this.timers.filter(x => x !== ev); fn(); }); this.timers.push(ev); return ev; }
  rec(kind, text, extra) { return this.dev.record(kind, text, extra); }
  /** Runtime state per configured peer, keyed by its public key */
  state(p) {
    const k = String(p.publicKey || '').trim();
    if (!this.peers.has(k)) this.peers.set(k, { session: null, pending: null, queue: [], endpoint: endpointOf(p.endpoint), rx: 0, tx: 0, last: null, tries: 0 });
    const s = this.peers.get(k);
    if (!s.learned) s.endpoint = endpointOf(p.endpoint) || s.endpoint;
    return s;
  }
  list() { return (this.cfg?.peers || []).filter(p => p.publicKey); }
  /** Routes like wg-quick adds them: every allowed IP of every peer points into the tunnel */
  routes() {
    if (!this.on) return [];
    const out = [];
    for (const p of this.list()) for (const c of cidrs(p.allowedIps)) if (!out.some(r => r.net === c.net && r.len === c.len)) out.push({ net: c.net, len: c.len, via: null, dev: 'wg0', proto: 'W', peer: p.name });
    return out;
  }
  /** Cryptokey routing: the peer whose allowed IPs contain the address (longest match) */
  peerFor(ip) {
    let best = null;
    for (const p of this.list()) for (const c of cidrs(p.allowedIps)) if (inNet(ip, c.net, c.len) && (!best || c.len > best.len)) best = { p, len: c.len };
    return best?.p || null;
  }
  mtu() { return Number(this.cfg?.mtu) || 1420; }

  // ---- Sending
  send(pkt, ctx = {}) {
    const p = this.peerFor(pkt.dst);
    if (!p) {
      this.rec('drop', `wg0: no peer has ${pkt.dst} in its allowed IPs, the packet is dropped (Required key not available)`, { tag: 'wg-nokey', data: { dst: pkt.dst } });
      return { ok: false, error: 'sendmsg: Required key not available' };
    }
    const st = this.state(p);
    if (st.session && this.sim.time - st.session.t < WG_T.rejectAfter) { this.data(p, st, pkt); return { ok: true }; }
    if (!st.endpoint) {
      this.rec('drop', `wg0: peer ${p.name || shortKey(p.publicKey)} has no known endpoint: nobody to send the handshake to`, { tag: 'wg-noendpoint' });
      return { ok: false, error: 'sendmsg: Destination address required' };
    }
    st.queue.push(pkt);
    if (st.queue.length > 32) st.queue.shift();
    if (!st.pending) { st.tries = 0; this.initiate(p, st); }
    return { ok: true };
  }
  outer(st, payload, trace) {
    const pkt = ipPacket({ src: this.l3.srcFor(st.endpoint.ip), dst: st.endpoint.ip, proto: PROTO.UDP, trace, l4: udp(this.port(), st.endpoint.port, payload) });
    pkt.wgOuter = true;
    return this.l3.output(pkt, {});
  }
  initiate(p, st, force = false) {
    if (!force && st.session && this.sim.time - st.session.t < WG_T.rejectAfter) return;
    if (st.tries >= WG_T.tries) {
      this.rec('err', `wg0: no handshake response from ${st.endpoint.ip}:${st.endpoint.port} after ${st.tries} attempts, ${st.queue.length} queued packets dropped`, { tag: 'wg-giveup', data: { peer: p.name } });
      st.queue = []; st.pending = null;
      return;
    }
    st.tries++;
    const sender = this.idx++;
    st.pending = { sender, t: this.sim.time };
    this.rec('info', `wg0: starts a handshake with ${p.name || 'peer'} at ${st.endpoint.ip}:${st.endpoint.port} (handshake initiation${st.tries > 1 ? ', attempt ' + st.tries : ''})`, { tag: 'wg-init-sent', data: { peer: p.name } });
    this.outer(st, { kind: 'wg', type: 'init', sender, from: this.pub, to: String(p.publicKey).trim() });
    this.later(WG_T.rekeyTimeout, () => { if (st.pending?.sender === sender) this.initiate(p, st, true); });
  }
  data(p, st, pkt, keepalive = false) {
    // Sending for 15 seconds without hearing anything back: the peer may have lost the session
    if (!keepalive && this.sim.time - (st.last ?? 0) > 15000 && !st.pending) { st.tries = 0; this.rec('info', `wg0: nothing received from ${p.name || 'peer'} for 15 s, starts a new handshake`, { tag: 'wg-rekey' }); this.initiate(p, st, true); }
    st.session.counter = (st.session.counter || 0) + 1;
    st.tx += keepalive ? 32 : wgDataLen(pkt.totalLength);
    const res = this.outer(st, { kind: 'wg', type: 'data', receiver: st.session.peerIdx, counter: st.session.counter, inner: keepalive ? null : clone(pkt) }, pkt?.trace);
    if (!keepalive) this.rec('fwd', `wg0: encrypts ${pkt.src} > ${pkt.dst} for ${p.name || 'peer'} and sends it in UDP to ${st.endpoint.ip}:${st.endpoint.port}`, { tag: 'wg-encrypt', data: { peer: p.name, dst: pkt.dst } });
    return res;
  }
  keepalive(p, st) {
    const iv = Number(p.keepalive) || 0;
    if (!iv || st.kaTimer) return;
    st.kaTimer = this.later(iv * 1000, () => {
      st.kaTimer = null;
      if (!this.on || !st.session) return;
      if (this.sim.time - st.session.t >= WG_T.rejectAfter) { st.tries = 0; return this.initiate(p, st); }
      this.data(p, st, null, true);
      this.keepalive(p, st);
    });
  }

  // ---- Receiving
  onPacket(ip) {
    if (!this.on) return false;
    const m = ip.l4.payload, from = { ip: ip.src, port: ip.l4.sport };
    if (m.type === 'init') {
      // The initiation is encrypted with the public key of the receiver: a wrong key makes it unreadable
      if (m.to !== this.pub) { this.rec('drop', `wg0: handshake initiation from ${ip.src} cannot be decrypted (it was made for another public key), silently ignored`, { tag: 'wg-badkey', data: { from: ip.src } }); return true; }
      const p = this.list().find(x => String(x.publicKey).trim() === m.from);
      if (!p) { this.rec('drop', `wg0: handshake from ${ip.src} with the unknown public key ${shortKey(m.from)}: no such peer, silently ignored`, { tag: 'wg-unknown', data: { from: ip.src } }); return true; }
      const st = this.state(p);
      st.endpoint = from; st.learned = true;
      const sender = this.idx++;
      st.session = { t: this.sim.time, myIdx: sender, peerIdx: m.sender, counter: 0 };
      st.last = this.sim.time; st.pending = null;
      this.rec('ok', `wg0: handshake from ${p.name || 'peer'} (${ip.src}:${ip.l4.sport}) accepted, answers it. The session keys are ready`, { tag: 'wg-handshake', data: { peer: p.name, from: ip.src } });
      this.outer(st, { kind: 'wg', type: 'resp', sender, receiver: m.sender });
      this.keepalive(p, st);
      this.flush(p, st);
      return true;
    }
    if (m.type === 'resp') {
      for (const p of this.list()) {
        const st = this.state(p);
        if (st.pending?.sender !== m.receiver) continue;
        st.session = { t: this.sim.time, myIdx: m.receiver, peerIdx: m.sender, counter: 0 };
        st.pending = null; st.last = this.sim.time;
        this.rec('ok', `wg0: handshake with ${p.name || 'peer'} complete, ${st.queue.length} queued packet${st.queue.length === 1 ? '' : 's'} can go`, { tag: 'wg-handshake', data: { peer: p.name, from: ip.src } });
        this.keepalive(p, st);
        this.flush(p, st);
        return true;
      }
      return true;
    }
    if (m.type === 'data') {
      const p = this.list().find(x => this.state(x).session?.myIdx === m.receiver);
      if (!p) { this.rec('drop', `wg0: data packet from ${ip.src} for an unknown session, dropped`, { tag: 'wg-nosession' }); return true; }
      const st = this.state(p);
      // Roaming: the latest authenticated packet tells where the peer is now
      if (st.endpoint?.ip !== from.ip || st.endpoint?.port !== from.port) { st.endpoint = from; st.learned = true; this.rec('learn', `wg0: ${p.name || 'peer'} is now at ${from.ip}:${from.port} (endpoint updated)`, { tag: 'wg-roam' }); }
      st.last = this.sim.time;
      if (!m.inner) { st.rx += 32; return true; }
      st.rx += wgDataLen(m.inner.totalLength);
      const inner = clone(m.inner);
      const ok = cidrs(p.allowedIps).some(c => inNet(inner.src, c.net, c.len));
      if (!ok) { this.rec('drop', `wg0: decrypted a packet from ${p.name || 'peer'} with source ${inner.src}, which is not in its allowed IPs: dropped (cryptokey routing)`, { tag: 'wg-notallowed', data: { src: inner.src, peer: p.name } }); return true; }
      this.rec('info', `wg0: decrypts a packet from ${p.name || 'peer'}: ${inner.src} > ${inner.dst}`, { tag: 'wg-decrypt', data: { src: inner.src, dst: inner.dst, peer: p.name } });
      this.sim.schedule(0.01, () => this.l3.rxIp('wg0', inner, null));
      return true;
    }
    return true;
  }
  flush(p, st) { const q = st.queue; st.queue = []; for (const pkt of q) this.data(p, st, pkt); }
  table() {
    return this.list().map(p => {
      const st = this.state(p);
      return { name: p.name || '', publicKey: p.publicKey, endpoint: st.endpoint ? `${st.endpoint.ip}:${st.endpoint.port}` : '(none)', allowed: cidrs(p.allowedIps).map(c => `${c.net}/${c.len}`).join(', '),
        handshake: st.last === null ? null : Math.round((this.sim.time - st.last) / 1000), rx: st.rx, tx: st.tx, up: !!st.session && this.sim.time - st.session.t < WG_T.rejectAfter, keepalive: Number(p.keepalive) || 0 };
    });
  }
  stop() { for (const t of this.timers) this.sim.cancel(t); this.timers = []; this.peers.clear(); }
  start() { this.stop(); this.snap = JSON.stringify(this.cfg); this.base = this.baseSnap(); }
  baseSnap() { return JSON.stringify([this.cfg?.enabled, this.cfg?.privateKey, this.cfg?.listenPort]); }
  /** Like "wg set": new allowed IPs or endpoints keep the sessions, a new key or port starts over */
  onConfig() {
    const s = JSON.stringify(this.cfg);
    if (s === this.snap) return;
    this.snap = s;
    if (this.baseSnap() !== this.base) return this.start();
    const keys = new Set(this.list().map(p => String(p.publicKey).trim()));
    for (const k of [...this.peers.keys()]) if (!keys.has(k)) this.peers.delete(k);
  }
}
