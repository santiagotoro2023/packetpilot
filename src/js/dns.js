// DNS in depth: authoritative zones with delegation (NS and glue), a recursive resolver
// with a cache and TTLs, and the answers of a server. No DOM, used by the engine.
import { isIp, PROTO } from './net.js';
import { ipPacket, udp } from './packets.js';

export const DNS_TYPES = ['A', 'AAAA', 'NS', 'CNAME'];
export const DEFAULT_TTL = 300;
export const NEG_TTL = 60;
export const ROOT_TTL = 518400;
const QUERY_TIMEOUT = 1500;
const MAX_QUERIES = 20;

/** Names are compared without the final dot and in lower case; the root is '' */
export const norm = n => String(n ?? '').trim().toLowerCase().replace(/\.+$/, '');
export const fqdn = n => (norm(n) ? norm(n) + '.' : '.');
export const under = (name, zone) => !zone || name === zone || name.endsWith('.' + zone);
export const parentOf = z => z.includes('.') ? z.slice(z.indexOf('.') + 1) : '';
const isAddr = t => t === 'A' || t === 'AAAA';

/** The zone a server is authoritative for: null (simple server, answers what it knows), '' the root, or e.g. 'lab' */
export function zoneOf(cfg) {
  const z = cfg.dnsZone;
  if (z == null || String(z).trim() === '') return null;
  return norm(z);
}
/** The records of a server in one shape: name, type, data, ttl */
export function records(cfg) {
  return (cfg.dns || []).map(r => {
    const type = DNS_TYPES.includes(r.type) ? r.type : 'A';
    return { name: norm(r.name), type, data: isAddr(type) ? String(r.ip ?? '').trim() : norm(r.value), ttl: Number(r.ttl) > 0 ? Number(r.ttl) : DEFAULT_TTL };
  }).filter(r => r.data);
}
const rr = r => ({ name: r.name, type: r.type, ttl: r.ttl, data: r.data, ...(isAddr(r.type) ? { ip: r.data } : {}) });
export const rrText = r => `${fqdn(r.name)}\t${r.ttl}\tIN\t${r.type}\t${r.type === 'NS' || r.type === 'CNAME' ? fqdn(r.data) : r.data}`;
const soaOf = zone => ({ name: zone, type: 'SOA', ttl: NEG_TTL, data: `ns1.${fqdn(zone).replace(/^\.$/, '')} hostmaster ${NEG_TTL}` });
export const rootName = i => `${'abcdefghijklm'[i] || 'x'}.root-servers.lab`;

/** What a server answers from its own data. null: the name is outside its zone. */
export function authLookup(cfg, q, qtype) {
  const zone = zoneOf(cfg), recs = records(cfg);
  if (zone !== null && !under(q, zone)) return null;
  if (zone !== null) {
    // A delegation below the own zone: answer with a referral to the child zone's servers
    const cuts = recs.filter(r => r.type === 'NS' && r.name !== zone && under(q, r.name));
    if (cuts.length) {
      const cut = cuts.reduce((a, b) => b.name.length > a.name.length ? b : a).name;
      const ns = recs.filter(r => r.type === 'NS' && r.name === cut);
      const glue = recs.filter(r => isAddr(r.type) && ns.some(n => n.data === r.name));
      return { referral: cut, aa: 0, rcode: 'NOERROR', answers: [], authority: ns.map(rr), additional: glue.map(rr) };
    }
  }
  const answers = [];
  let name = q;
  for (let i = 0; i < 8; i++) {
    const here = recs.filter(r => r.name === name);
    const hit = here.filter(r => r.type === qtype);
    if (hit.length) { answers.push(...hit.map(rr)); break; }
    const cn = qtype !== 'CNAME' && here.find(r => r.type === 'CNAME');
    if (cn) {
      answers.push(rr(cn));
      name = cn.data;
      if (zone === null ? !recs.some(r => r.name === name) : !under(name, zone)) break;
      continue;
    }
    if (!answers.length) {
      const exists = recs.some(r => under(r.name, name));
      return { aa: 1, rcode: exists ? 'NOERROR' : 'NXDOMAIN', answers: [], authority: zone !== null ? [soaOf(zone)] : [], additional: [] };
    }
    break;
  }
  return { aa: 1, rcode: 'NOERROR', answers, authority: [], additional: [] };
}

/** A DNS query arrived on UDP 53 of a host with a DNS service */
export function serveDns(l3, ip, frame) {
  const dev = l3.dev, cfg = l3.cfg, q = ip.l4.payload;
  const qname = norm(q.qname), qtype = q.qtype || 'A';
  const rec = !!cfg.recursion?.enabled;
  const reply = (p, kind, text, data = {}) => {
    const ans = { kind: 'dns', id: q.id, qr: 1, aa: p.aa ? 1 : 0, rd: q.rd ? 1 : 0, ra: rec ? 1 : 0, qname: q.qname, qtype,
      rcode: p.rcode, answers: p.answers || [], authority: p.authority || [], additional: p.additional || [] };
    dev.record(kind, text, { frame, tag: data.tag || 'dns-answered', data: { name: qname, qtype, found: !!ans.answers.length, rcode: ans.rcode, ...data } });
    l3.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.UDP, trace: ip.trace, l4: udp(ip.l4.dport, ip.l4.sport, ans) }), {});
  };
  const list = a => {
    const addr = a.filter(r => r.type !== 'CNAME').map(r => r.data), cn = a.filter(r => r.type === 'CNAME');
    return (addr.join(', ') || cn.map(r => r.data).join(', ')) + (addr.length && cn.length ? ` (via the alias ${cn.map(r => r.data).join(' → ')})` : '');
  };
  // Priming: a stub (or dig +trace) asks the resolver for the servers of the root
  if (rec && q.rd && qname === '' && qtype === 'NS') {
    const roots = resolverOf(l3).roots();
    return reply({ rcode: roots.length ? 'NOERROR' : 'SERVFAIL', answers: roots.map((_, i) => ({ name: '', type: 'NS', ttl: ROOT_TTL, data: rootName(i) })),
      additional: roots.map((r, i) => ({ name: rootName(i), type: 'A', ttl: ROOT_TTL, data: r, ip: r })) },
      'ok', `answers the question for the root servers from its root hints: ${roots.join(', ') || 'none configured'}`, { tag: 'dns-priming' });
  }
  let auth = authLookup(cfg, qname, qtype);
  // A resolver without an own zone only answers itself for names it has records for (like local-data in unbound)
  if (auth && zoneOf(cfg) === null && rec && q.rd && !auth.answers.length) auth = null;
  if (auth && !(auth.referral !== undefined && rec && q.rd)) {
    if (auth.referral !== undefined) {
      const ns = auth.authority.map(n => `${n.data}${auth.additional.find(g => g.name === n.data) ? ' ' + auth.additional.find(g => g.name === n.data).data : ''}`).join(', ');
      return reply(auth, 'info', `does not know ${fqdn(qname)} itself, but knows who is responsible: refers to the servers of ${fqdn(auth.referral)} (${ns})`, { tag: 'dns-referral', zone: auth.referral });
    }
    if (auth.answers.length) return reply(auth, 'ok', `answers the query for ${fqdn(qname)} ${qtype} authoritatively: ${list(auth.answers)} (TTL ${auth.answers[auth.answers.length - 1].ttl} s)`);
    return reply(auth, 'ok', auth.rcode === 'NXDOMAIN' ? `answers the query for ${fqdn(qname)}: NXDOMAIN, the name does not exist${zoneOf(cfg) !== null ? ' in its zone ' + fqdn(zoneOf(cfg)) : ''}`
      : `answers the query for ${fqdn(qname)} ${qtype}: the name exists, but has no ${qtype} record (NODATA)`);
  }
  if (rec && q.rd) {
    return resolverOf(l3).resolve(qname, qtype, res => {
      const how = res.cached ? `from its cache (TTL left ${res.answers[res.answers.length - 1]?.ttl ?? res.ttlLeft ?? 0} s)` : `after ${res.queries} quer${res.queries === 1 ? 'y' : 'ies'} to other servers`;
      if (res.rcode === 'NOERROR' && res.answers.length) reply(res, 'ok', `answers ${ip.src}: ${fqdn(qname)} ${qtype} is ${list(res.answers)}, ${how}`, { cached: !!res.cached });
      else if (res.rcode === 'SERVFAIL') reply(res, 'err', `cannot resolve ${fqdn(qname)} and answers ${ip.src} with SERVFAIL`, { tag: 'dns-servfail' });
      else reply(res, 'ok', `answers ${ip.src}: ${fqdn(qname)} ${res.rcode === 'NXDOMAIN' ? 'does not exist (NXDOMAIN)' : 'has no ' + qtype + ' record'}, ${how}`, { cached: !!res.cached });
    });
  }
  reply({ rcode: 'REFUSED', aa: 0 }, 'err', `refuses the query for ${fqdn(qname)} (REFUSED): ${zoneOf(cfg) !== null ? 'it is only responsible for ' + fqdn(zoneOf(cfg)) : 'it does not know the name'}${q.rd ? ' and does not resolve for others (no recursion)' : ''}`, { tag: 'dns-refused' });
}

export const resolverOf = l3 => (l3.resolverSvc ??= new Resolver(l3));

/** Recursive resolver: asks root, TLD and authoritative servers one after the other and caches every answer for its TTL */
export class Resolver {
  constructor(l3) { this.l3 = l3; this.dev = l3.dev; this.sim = l3.sim; this.cache = new Map(); this.jobs = new Map(); this.open = new Map(); }
  get cfg() { return this.l3.cfg.recursion || {}; }
  roots() { return String(this.cfg.roots || '').split(/[\s,]+/).filter(isIp); }
  put(name, type, rrs, ttl, extra = {}) {
    this.cache.set(name + '|' + type, { name, type, rrs: rrs.map(r => ({ ...r })), ttl, exp: this.sim.time + ttl * 1000, ...extra });
  }
  get(name, type) {
    const k = name + '|' + type, e = this.cache.get(k);
    if (!e) return null;
    if (e.exp <= this.sim.time) {
      this.cache.delete(k);
      this.dev.record('info', `cache entry ${fqdn(name)} ${type} has expired (TTL ${e.ttl} s over): next time it asks again`, { tag: 'dns-expired', data: { name, type } });
      return null;
    }
    return e;
  }
  left(e) { return Math.max(0, Math.ceil((e.exp - this.sim.time) / 1000)); }
  dump() {
    const out = [];
    for (const [k, e] of [...this.cache]) {
      if (e.exp <= this.sim.time) { this.cache.delete(k); continue; }
      const ttl = this.left(e);
      if (e.neg) out.push({ name: e.name, type: e.type, ttl, data: e.rcode === 'NXDOMAIN' ? 'NXDOMAIN (negative)' : 'NODATA (negative)', neg: true });
      else for (const r of e.rrs) out.push({ name: e.name, type: e.type, ttl, data: r.data });
    }
    return out.sort((a, b) => a.name.split('.').reverse().join('.').localeCompare(b.name.split('.').reverse().join('.')) || a.type.localeCompare(b.type));
  }
  flush(name = null) {
    if (name === null) { const n = this.cache.size; this.cache.clear(); return n; }
    let n = 0;
    for (const k of [...this.cache.keys()]) if (k.split('|')[0] === norm(name)) { this.cache.delete(k); n++; }
    return n;
  }
  /** Cache content at the start of a scenario (e.g. an old answer with a long TTL) */
  seed(list = []) {
    for (const s of list) this.put(norm(s.name), s.type || 'A', [{ name: norm(s.name), type: s.type || 'A', data: s.data, ttl: Number(s.ttl) || DEFAULT_TTL, ...(isAddr(s.type || 'A') ? { ip: s.data } : {}) }], Number(s.ttl) || DEFAULT_TTL);
  }

  resolve(qname, qtype, cb) {
    const chain = [];
    let name = qname;
    for (let i = 0; i < 8; i++) {
      const hit = this.get(name, qtype);
      if (hit) {
        const ttl = this.left(hit);
        if (hit.neg) return cb({ rcode: hit.rcode, answers: chain, cached: true, ttlLeft: ttl, queries: 0 });
        this.dev.record('ok', `finds ${fqdn(name)} ${qtype} in its cache (TTL left ${ttl} s): no need to ask anyone`, { tag: 'dns-cache-hit', data: { name, qtype, ttl } });
        return cb({ rcode: 'NOERROR', answers: [...chain, ...hit.rrs.map(r => ({ ...r, ttl }))], cached: true, queries: 0 });
      }
      const cn = qtype !== 'CNAME' && this.get(name, 'CNAME');
      if (!cn) break;
      chain.push({ ...cn.rrs[0], ttl: this.left(cn) });
      name = cn.rrs[0].data;
    }
    const key = name + '|' + qtype;
    const done = res => cb({ ...res, answers: [...chain, ...res.answers] });
    if (this.jobs.has(key)) { this.jobs.get(key).waiters.push(done); return; }
    const job = { key, name, qtype, waiters: [done], queries: 0, chain: [], depth: 0 };
    this.jobs.set(key, job);
    this.start(job);
  }
  /** The closest zone whose servers are known (from the cache), otherwise the root */
  closest(name) {
    for (let z = name; ; z = parentOf(z)) {
      const d = z ? this.get(z, 'NS') : null;
      if (d) {
        const ips = d.rrs.flatMap(r => (this.get(r.data, 'A')?.rrs || []).map(x => x.data));
        if (ips.length) return { zone: z, ips, names: d.rrs.map(r => r.data) };
      }
      if (!z) break;
    }
    const roots = this.roots();
    return { zone: '', ips: roots, names: roots.map((_, i) => rootName(i)) };
  }
  start(job) {
    const c = this.closest(job.name);
    if (!c.ips.length) return this.finish(job, 'SERVFAIL', [], 'it has no root hints, so it does not know where to start');
    Object.assign(job, { zone: c.zone, ips: c.ips, names: c.names, idx: 0 });
    if (c.zone) this.dev.record('info', `already knows the servers of ${fqdn(c.zone)} from its cache and starts there instead of at the root`, { tag: 'dns-shortcut', data: { name: job.name, zone: c.zone } });
    this.send(job);
  }
  send(job) {
    if (job.idx >= job.ips.length) return this.finish(job, 'SERVFAIL', [], `none of the servers of ${fqdn(job.zone)} answered`);
    if (++job.queries > MAX_QUERIES) return this.finish(job, 'SERVFAIL', [], 'too many queries, gives up');
    const server = job.ips[job.idx];
    const sport = 49152 + Math.floor(this.sim.random() * 16000), id = Math.floor(this.sim.random() * 65535);
    const who = job.zone === '' ? 'a root server' : `a server of ${fqdn(job.zone)}`;
    this.dev.record('info', `asks ${server} (${who}) for ${fqdn(job.name)} ${job.qtype}, iteratively: "tell me what you know"`, { tag: 'dns-iter', data: { name: job.name, server, zone: job.zone } });
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(server), dst: server, proto: PROTO.UDP, l4: udp(sport, 53, { kind: 'dns', id, qr: 0, rd: 0, qname: job.name, qtype: job.qtype }) }), {});
    const k = sport + '|' + id;
    const next = why => { this.open.delete(k); this.dev.record('err', `${why} from ${server}, tries the next server`, { tag: 'dns-iter-fail', data: { server } }); job.idx++; this.send(job); };
    if (!res.ok) return next(`cannot send the query (${res.error})`);
    job.timer = this.sim.schedule(QUERY_TIMEOUT, () => { if (this.open.get(k) === job) next('no answer'); });
    this.open.set(k, job);
  }
  onUdp(ip) {
    const l4 = ip.l4, d = l4.payload;
    if (d?.kind !== 'dns' || !d.qr) return false;
    const k = l4.dport + '|' + d.id, job = this.open.get(k);
    if (!job) return false;
    this.open.delete(k);
    this.sim.cancel(job.timer);
    this.handle(job, d, ip.src);
    return true;
  }
  handle(job, d, from) {
    const ttlOf = rrs => Math.min(...rrs.map(r => r.ttl));
    if (d.rcode === 'NXDOMAIN') {
      const ttl = d.authority?.find(r => r.type === 'SOA')?.ttl ?? NEG_TTL;
      this.put(job.name, job.qtype, [], ttl, { neg: true, rcode: 'NXDOMAIN' });
      this.dev.record('learn', `${from}: ${fqdn(job.name)} does not exist (NXDOMAIN). Remembers that for ${ttl} s (negative caching)`, { tag: 'dns-nxdomain', data: { name: job.name, server: from } });
      return this.finish(job, 'NXDOMAIN', []);
    }
    if (d.rcode !== 'NOERROR') { this.dev.record('err', `${from} answers ${d.rcode} for ${fqdn(job.name)}, tries the next server`, { tag: 'dns-iter-fail', data: { server: from, rcode: d.rcode } }); job.idx++; return this.send(job); }
    if (d.answers.length) {
      const groups = new Map();
      for (const a of d.answers) { const g = a.name + '|' + a.type; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a); }
      for (const rrs of groups.values()) this.put(rrs[0].name, rrs[0].type, rrs, ttlOf(rrs));
      const out = [];
      let name = job.name, found = false;
      for (let i = 0; i < 8; i++) {
        const direct = d.answers.filter(a => a.name === name && a.type === job.qtype);
        if (direct.length) { out.push(...direct); found = true; break; }
        const cn = d.answers.find(a => a.name === name && a.type === 'CNAME');
        if (!cn) break;
        out.push(cn); name = cn.data;
      }
      if (found) {
        this.dev.record('ok', `${from} answers authoritatively: ${out.map(r => `${fqdn(r.name)} ${r.type} ${r.data}`).join(', ')}. Cached for ${ttlOf(out)} s`, { tag: 'dns-resolved', data: { name: job.name, server: from, ttl: ttlOf(out) } });
        return this.finish(job, 'NOERROR', out);
      }
      if (out.length && ++job.depth < 8) {
        // A CNAME that points elsewhere: resolve the target from the start (or from the cache)
        this.dev.record('info', `${from} answers with an alias: ${fqdn(job.name)} is a CNAME for ${fqdn(name)}. Follows it`, { tag: 'dns-cname', data: { name: job.name, target: name } });
        job.chain.push(...out);
        job.name = name;
        const hit = this.get(name, job.qtype);
        if (hit) return this.finish(job, 'NOERROR', hit.rrs.map(r => ({ ...r, ttl: this.left(hit) })));
        return this.start(job);
      }
      return this.finish(job, 'NOERROR', []);
    }
    const ns = (d.authority || []).filter(r => r.type === 'NS');
    if (!d.aa && ns.length) {
      const zone = ns[0].name;
      const closer = zone.length > job.zone.length || (job.zone === '' && zone !== '');
      if (!closer || !under(job.name, zone)) {
        this.dev.record('err', `${from} refers back to ${fqdn(zone)} instead of further down (lame delegation), tries the next server`, { tag: 'dns-lame', data: { server: from, zone } });
        job.idx++; return this.send(job);
      }
      this.put(zone, 'NS', ns, ttlOf(ns));
      const glue = (d.additional || []).filter(r => r.type === 'A' && ns.some(n => n.data === r.name));
      for (const g of glue) this.put(g.name, 'A', [g], g.ttl);
      const names = ns.map(n => n.data);
      this.dev.record('learn', `${from} refers to ${fqdn(zone)}: ${names.map(n => n + (glue.find(g => g.name === n) ? ' ' + glue.find(g => g.name === n).data : ' (no address)')).join(', ')}. Caches the delegation`,
        { tag: 'dns-referral-rx', data: { name: job.name, server: from, zone } });
      Object.assign(job, { zone, names, idx: 0, ips: glue.map(g => g.data) });
      if (job.ips.length) return this.send(job);
      // No glue: the address of the name server has to be resolved first
      if (++job.depth > 4) return this.finish(job, 'SERVFAIL', [], 'the name servers have no addresses');
      this.dev.record('info', `the referral has no glue: first resolves the address of ${names[0]}`, { tag: 'dns-glueless', data: { ns: names[0] } });
      return this.resolve(names[0], 'A', r => {
        const ips = r.answers.filter(a => a.type === 'A').map(a => a.data);
        if (!ips.length) return this.finish(job, 'SERVFAIL', [], `the address of the name server ${names[0]} cannot be resolved`);
        job.ips = ips; job.idx = 0; this.send(job);
      });
    }
    // Authoritative, no answer: the name exists but not with this type
    this.put(job.name, job.qtype, [], NEG_TTL, { neg: true, rcode: 'NOERROR' });
    return this.finish(job, 'NOERROR', []);
  }
  finish(job, rcode, answers, why = '') {
    this.jobs.delete(job.key);
    if (rcode === 'SERVFAIL') this.dev.record('err', `cannot resolve ${fqdn(job.name)}: ${why}`, { tag: 'dns-servfail', data: { name: job.name } });
    for (const w of job.waiters) w({ rcode, answers: [...job.chain, ...answers], queries: job.queries });
  }
}
