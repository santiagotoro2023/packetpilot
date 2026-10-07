import { note, tag } from './helpers.js';
import { dnsTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const EPHEMERAL = { range: [1024, 65535] };
const ADDR = {
  mac: [[M('client'), 'client'], [M('resolver'), 'resolver'], [M('r1'), 'r1 eth1 (gateway)']],
  ip: [['10.1.0.10', 'client'], ['10.1.0.53', 'resolver'], ['10.1.0.1', 'r1 eth1'], ['198.41.0.4', 'root (a.root-servers.lab)'], ['192.0.2.53', 'ns1.nic.lab (TLD lab.)'], ['203.0.113.53', 'ns1.firma.lab']],
  name: ['www.firma.lab', 'firma.lab', 'lab', '.']
};
const done = (pred = () => true) => tag('client', 'dns-done', pred);

// A change in the configuration of ns1 is noticed at the next evaluation; answers after that count
const since = new WeakMap();
const after = (key, cond) => sim => {
  const m = since.get(sim) || {}; since.set(sim, m);
  if (!cond(sim)) { delete m[key]; return null; }
  return m[key] ??= sim.logSeq;
};
const recIs = (name, ip) => sim => (sim.dev('ns1')?.cfg.dns || []).some(r => r.name === name && (r.type || 'A') === 'A' && r.ip === ip);
const moved = after('moved', recIs('www.firma.lab', '203.0.113.81'));
const blogAdded = after('blog', sim => (sim.dev('ns1')?.cfg.dns || []).some(r => r.name === 'blog.firma.lab'));
const answerAfter = (mark, name, pred) => sim => {
  const s = mark(sim);
  return s !== null && sim.log.some(e => e.seq > s && e.dev === 'client' && e.tag === 'dns-done' && e.data.name === name && pred(e.data));
};
const lastTtl = sim => { const d = sim.log.filter(e => e.dev === 'client' && e.tag === 'dns-done' && e.data.name === 'www.firma.lab' && e.data.ttl != null).pop(); return d ? [String(d.data.ttl)] : []; };
const flushedThenResolved = sim => {
  const f = sim.log.filter(e => e.dev === 'resolver' && e.tag === 'dns-flush').pop();
  return !!f && sim.log.some(e => e.seq > f.seq && e.dev === 'resolver' && e.tag === 'dns-answered' && e.data.name === 'www.firma.lab' && !e.data.cached);
};

export default {
  id: 'm11', title: 'DNS in depth', bands: ['udp', 'data'],
  text: 'Who knows the answer? The hierarchy from the root down, resolvers that ask on your behalf, and caches that remember for exactly as long as the TTL allows.',
  lessons: [
    { id: 'm11-l1', title: 'From the root down', minutes: 14, steps: [
      { type: 'theory', title: 'Nobody knows every name', html: `
<p>No server in the world knows all names. DNS is a tree, read from right to left. Each level only knows who is responsible for the next level down:</p>
<pre>.                    the root: 13 server names, hundreds of machines (anycast)
└── lab.             a top-level domain (TLD), like com. or ch.
    ├── firma.lab.   a zone of a company, on its own name servers
    │   └── www.firma.lab.  →  203.0.113.80
    └── partner.lab.</pre>
<p>A part of the tree that one server is responsible for is a <b>zone</b>. A server that holds a zone answers for it <b>authoritatively</b> (flag <code>aa</code>). For a part it has handed off, it answers with a <b>referral</b>: "ask those servers", as NS records in the authority section.</p>
<table><tr><th>Record</th><th>Meaning</th><th>Example</th></tr>
<tr><td>A</td><td>name to IPv4 address</td><td><code>www.firma.lab. 60 IN A 203.0.113.80</code></td></tr>
<tr><td>AAAA</td><td>name to IPv6 address</td><td><code>www.firma.lab. 60 IN AAAA 2001:db8:80::80</code></td></tr>
<tr><td>NS</td><td>who is responsible for a zone</td><td><code>firma.lab. 86400 IN NS ns1.firma.lab.</code></td></tr>
<tr><td>CNAME</td><td>this name is an alias</td><td><code>shop.firma.lab. 3600 IN CNAME www.firma.lab.</code></td></tr></table>
<h2>Glue</h2>
<p>The TLD server says: firma.lab is served by <code>ns1.firma.lab</code>. But to find the address of ns1.firma.lab you would have to ask … ns1.firma.lab. To break that circle, the parent zone also sends the address of the name server along, in the additional section. That is a <b>glue record</b>.</p>
<h2>Resolver and stub</h2>
<p>Your PC does none of this work. It has a tiny <b>stub resolver</b> that sends one question with the flag <code>rd</code> (recursion desired) to a <b>recursive resolver</b>: the DNS server from DHCP, of your provider, or 1.1.1.1. The resolver asks <b>iteratively</b> (<code>rd 0</code>): root, then TLD, then the authoritative server, until it has the answer, and sends only the result back.</p>
${note('Authoritative servers usually refuse to resolve for strangers (status REFUSED). A resolver that answers anyone on the internet is an "open resolver" and gets abused for amplification attacks.')}` },
      { type: 'stack', title: 'Put the queries in order', hint: 'The client asks for www.firma.lab, the resolver has an empty cache. The top is the first message.',
        items: [{ name: 'client → resolver: A www.firma.lab? (rd 1)', kind: 'udp' }, { name: 'resolver → root: A www.firma.lab? (rd 0)', kind: 'udp' },
          { name: 'root → resolver: referral, lab. is at ns1.nic.lab', kind: 'data' }, { name: 'resolver → ns1.nic.lab: A www.firma.lab?', kind: 'udp' },
          { name: 'ns1.nic.lab → resolver: referral, firma.lab. is at ns1.firma.lab', kind: 'data' }, { name: 'resolver → ns1.firma.lab: A www.firma.lab?', kind: 'udp' },
          { name: 'ns1.firma.lab → resolver: 203.0.113.80 (aa)', kind: 'data' }, { name: 'resolver → client: 203.0.113.80', kind: 'data' }],
        explain: 'The client only sees the first and the last message. In between, the resolver walks down the tree, and every server only names the next one. Only the last answer is authoritative.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which server can answer "www.firma.lab is 203.0.113.80" authoritatively?', options: ['A root server', 'The TLD server of lab.', 'The name server of the zone firma.lab', 'Any resolver'], correct: 2 },
        { q: 'What does the root server answer when asked for www.firma.lab?', options: ['The address', 'NXDOMAIN, it does not know the name', 'A referral to the servers of lab.', 'Nothing'], correct: 2,
          explain: 'The root only knows who is responsible for each TLD and refers there.' },
        { q: 'Why does the TLD server send the address of ns1.firma.lab along with the referral?', options: ['To save one query', 'Without it, nobody could find ns1.firma.lab, because its address is in the zone it serves', 'So that the client can ask directly', 'It does not'], correct: 1,
          explain: 'This is the glue record. It is only needed when the name server sits inside the zone it serves.' },
        { q: 'Which flag tells a server "please resolve completely for me"?', input: ['rd', 'RD', 'recursion desired'] }] }
    ] },

    { id: 'm11-l2', title: 'Watching a resolver work', minutes: 18, steps: [
      { type: 'build', title: 'The resolver asks the root', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dns'],
        task: '<p>The client asked the <b>resolver</b> (10.1.0.53) for <code>www.firma.lab</code>. The cache of the resolver is empty, so it asks the root server 198.41.0.4 first. The root is on the internet, behind the gateway r1. Build the frame as it leaves the resolver\'s cable.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('resolver'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.1.0.53', dst: '198.41.0.4', proto: '17', ttl: '64' } },
          { block: 'udp', fields: { sport: EPHEMERAL, dport: '53' } },
          { block: 'dns', fields: { qr: '0', name: 'www.firma.lab', qtype: 'A', rd: '0' } }],
        explain: 'The resolver asks with its own address, not the client\'s: the root never learns who wanted to know. It asks for the full name, even though the root will only answer with a referral, and it clears RD: it does not want the root to resolve anything for it.' },
      { type: 'lab', title: 'From the root down', topo: () => dnsTopo(), edit: 'config',
        intro: '<p>The client uses the resolver 10.1.0.53 in its own network. On the internet there are a root server, the TLD server of <code>lab.</code> and two authoritative servers. All caches are empty.</p>',
        presets: { client: ['dig www.firma.lab', 'dig +trace portal.partner.lab', 'dig @203.0.113.53 portal.partner.lab', 'dig shop.firma.lab'], resolver: ['unbound-control dump_cache'], ns1: ['dig @203.0.113.53 www.firma.lab'] },
        goals: [
          { text: 'Resolve <code>www.firma.lab</code> on the client with dig.', check: done(d => d.ok && d.name === 'www.firma.lab' && !d.trace) },
          { text: 'Which server did the resolver ask first? Filter the log to "Only resolver".', ask: true, expect: () => ['198.41.0.4', 'root', 'a.root-servers.lab', 'a.root-servers.lab.', 'the root'], placeholder: 'IP or name' },
          { text: 'How many servers did the resolver ask before it could answer?', ask: true, expect: () => ['3', 'three'] },
          { text: 'The client\'s answer: does it carry the flag <code>aa</code> (authoritative)? yes or no', ask: true, expect: () => ['no'] },
          { text: 'Walk the tree yourself: <code>dig +trace portal.partner.lab</code>.', check: done(d => d.trace && d.ok) },
          { text: 'Which name server is responsible for partner.lab?', ask: true, expect: () => ['ns.partner.lab', 'ns.partner.lab.', '203.0.113.153'] },
          { text: 'Ask the server of firma.lab directly about a name in another zone: <code>dig @203.0.113.53 portal.partner.lab</code>. Which status comes back?', ask: true, expect: () => ['refused'] }],
        hints: ['The console presets of the client contain all commands.', 'In the log of the resolver, every outgoing question starts with "asks". Referrals say "refers to".', 'Click the client\'s answer in the log: the packet inspector shows the flags AA, RD and RA.'],
        outro: '<p>The client received a non-authoritative answer: it came from the resolver, which had asked the authoritative server on the client\'s behalf. With <code>+trace</code> you did the resolver\'s work yourself. And ns1.firma.lab only answers for its own zone: everything else is REFUSED.</p>' }
    ] },

    { id: 'm11-l3', title: 'Caching and TTL', minutes: 12, steps: [
      { type: 'theory', title: 'Remember, but not forever', html: `
<p>If every query walked the whole tree, the root servers would collapse. So the resolver keeps every answer it gets, the referrals too, in its <b>cache</b>. How long is decided by the owner of the record, with the <b>TTL</b> (time to live, in seconds):</p>
<pre>www.firma.lab.   60     IN A   203.0.113.80     cached for 1 minute
firma.lab.       86400  IN NS  ns1.firma.lab.   cached for 1 day
lab.             172800 IN NS  ns1.nic.lab.     cached for 2 days</pre>
<p>When the resolver answers from its cache, it hands out the <b>remaining</b> TTL: a second query after 20 seconds shows 40 instead of 60. Because the delegations of lab. and firma.lab. stay cached much longer, the next question for another name in firma.lab goes straight to ns1.firma.lab.</p>
<h2>Negative caching</h2>
<p>"This name does not exist" (NXDOMAIN) is cached too, for the time given in the SOA record of the zone. If you create a name that someone has just asked for, they will keep getting NXDOMAIN until that time is over.</p>
<h2>Changing a record</h2>
<table><tr><th>When</th><th>What</th></tr>
<tr><td>A day before</td><td>lower the TTL, e.g. from 86400 to 60</td></tr>
<tr><td>Wait</td><td>at least the old TTL, until every cache has the short one</td></tr>
<tr><td>Move</td><td>change the address: after at most 60 s everyone has the new one</td></tr>
<tr><td>Afterwards</td><td>raise the TTL again</td></tr></table>
${note('"DNS propagation" is not a process that pushes changes around. Nothing is propagated: caches simply expire. The longest TTL decides how long old data can live.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A record has TTL 300. The resolver cached it 120 s ago. Which TTL does the client see?', input: ['180'], unit: 's' },
        { q: 'You change the address of www from 1.1.1.1 to 2.2.2.2. The TTL was 86400. How long can clients still get 1.1.1.1?', options: ['Not at all', 'Up to 5 minutes', 'Up to one day', 'Forever'], correct: 2 },
        { q: 'The resolver has firma.lab. NS in its cache, but not mail.firma.lab. Whom does it ask for mail.firma.lab?', options: ['The root', 'The TLD server of lab.', 'ns1.firma.lab directly', 'The client'], correct: 2,
          explain: 'The cached delegation is a shortcut: the resolver starts as far down the tree as it already knows.' },
        { q: 'Someone asked for blog.firma.lab a second ago (NXDOMAIN). Now you create the record. What does the next query through the same resolver return?', options: ['The new address', 'NXDOMAIN, until the negative cache entry expires', 'SERVFAIL', 'REFUSED'], correct: 1 }] }
    ] },

    { id: 'm11-l4', title: 'Cache and TTL in the lab', minutes: 20, steps: [
      { type: 'lab', title: 'The web server moves', topo: () => dnsTopo(), edit: 'config',
        intro: '<p>The same network as before. The record <code>www.firma.lab</code> has a TTL of 60 seconds. The fast-forward button helps when you have to wait for a TTL.</p>',
        presets: { client: ['dig www.firma.lab', 'dig blog.firma.lab', 'curl http://www.firma.lab/'], resolver: ['unbound-control dump_cache', 'unbound-control flush_all'] },
        goals: [
          { text: 'Resolve <code>www.firma.lab</code> twice on the client. The second answer comes from the cache of the resolver.', check: tag('resolver', 'dns-cache-hit', d => d.name === 'www.firma.lab') },
          { text: 'Which TTL does your latest answer show? (seconds)', ask: true, expect: lastTtl, placeholder: 'seconds' },
          { text: 'The web server gets the new address 203.0.113.81. On <b>ns1</b>, under Configuration, DNS records, change www.firma.lab to 203.0.113.81. Then resolve again right away: the client still gets the old address.', check: answerAfter(moved, 'www.firma.lab', d => d.answer === '203.0.113.80') },
          { text: 'Wait until the TTL is over (fast-forward) and resolve again: now the new address arrives.', check: answerAfter(moved, 'www.firma.lab', d => d.answer === '203.0.113.81') },
          { text: 'For how many seconds at most could a client still get the old address after your change?', ask: true, expect: () => ['60'], placeholder: 'seconds' },
          { text: 'Resolve <code>blog.firma.lab</code> (it does not exist). Then create it on ns1 (A 203.0.113.80) and resolve again at once: NXDOMAIN, from the cache.', check: answerAfter(blogAdded, 'blog.firma.lab', d => d.rcode === 'NXDOMAIN') },
          { text: 'Flush the cache of the resolver (<code>unbound-control flush_all</code>) and resolve www.firma.lab again. It has to start at the root.', check: flushedThenResolved }],
        hints: ['Changing a record: click ns1, Configuration, DNS records, and edit the address in the www.firma.lab row.', 'unbound-control dump_cache on the resolver shows every cache entry with the TTL that is left.', 'The negative entry for blog.firma.lab lives as long as the SOA of firma.lab says: 60 seconds here.'],
        outro: '<p>The cache made the second answer instant, and the same cache delivered the old address after the move, for at most the TTL. That is why operators lower the TTL before a move. Flushing helps on your own resolver, but not on the thousands of resolvers of other people.</p>' }
    ] }
  ]
};
