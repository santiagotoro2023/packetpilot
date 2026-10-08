// Small command line per device, modeled on iproute2 and FRR
import { isIp, parseCidr, isIp6, isAnyIp, parseCidr6, norm6, isLinkLocal6 } from './net.js';
import { PORTS } from './engine.js';
import { resolverOf, fqdn } from './dns.js';
import { wgPubKey, wgGenKey } from './vpn.js';

const pad = (s, n) => String(s).padEnd(n);

export function helpFor(dev) {
  const l = [];
  if (dev.l3) l.push(
    'ping <ip> [-c count] [-s size] [-M do|dont] [-t ttl]',
    'traceroute <ip>',
    'ip addr               show addresses (also: ip -br a)',
    'ip route              routing table (kernel)',
    'ip route get <ip>     which route does a packet take?',
    'ip route add <net> via <ip>   add a static route',
    'ip route del <net>    remove a static route',
    'ip neigh              ARP table',
    'ip neigh flush        flush the ARP table',
    'arping [-U|-A|-D] [-c n] <ip>   ARP request, gratuitous ARP (-U/-A), duplicate address check (-D)',
    'curl http://<ip>[:port]/         fetch HTTP over TCP',
    'nc -zv <ip> <port>    check whether a TCP port is open',
    'nc -u <ip> <port>     send a UDP datagram',
    'dig [@server] <name> [A|AAAA|NS|CNAME]   DNS query over UDP 53',
    'dig +trace <name>     follow the delegation from the root yourself',
    'dig +norec / +short   no recursion wanted / only the answer',
    'curl http://<name>/   DNS first, then TCP (DNS server in the configuration)',
    'ss -tan / ss -tuln    TCP connections / open ports',
    'ping -6 <addr|name> / ping6   ping over IPv6 (link-local: fe80::1%eth1)',
    'ip -6 addr / route / neigh     IPv6 addresses, routes, neighbor cache',
    'ip -6 addr add 2001:db8::1/64 dev eth1   add an IPv6 address',
    'ip -6 route add <net>|default via <addr> [dev eth1]   static IPv6 route',
    'traceroute -6 <addr>  path over IPv6');
  if (dev.type === 'router') l.push(
    'ip link add link eth1 name eth1.10 type vlan id 10   create a subinterface',
    'ip addr add 10.10.0.1/24 dev eth1.10   set an address',
    'ip link del eth1.10   delete a subinterface');
  l.push('ip link set <port> down|up   disconnect or reconnect the cable on this port');
  if (dev.type === 'router') l.push('show ip route         routing table in FRR style', 'sysctl net.ipv4.ip_forward=0|1',
    'maximum-paths <n>     ECMP: how many equal paths are used (1 = off)', 'sysctl net.ipv4.fib_multipath_hash_policy=0|1   ECMP hash: addresses / with ports',
    'show bfd peers        BFD sessions and their state',
    'show ip ospf neighbor / database / interface   OSPF state', 'show vrrp             VRRP groups and who is master', 'conntrack -L          NAT translations (also: show ip nat)');
  if (dev.cfg.recursion?.enabled) l.push('unbound-control dump_cache     what the resolver has cached, with TTL left', 'unbound-control flush_all      empty the cache (flush <name>: one name)');
  if (dev.cfg.dhcpServer) l.push('show ip dhcp binding  addresses handed out by the DHCP server');
  if (dev.type === 'pc' || dev.type === 'server') l.push('dhclient [eth1]       ask for an address via DHCP (-r releases it)', 'rdisc6 [eth1]         ask the routers for their advertisement (IPv6)');
  if (dev.type === 'router') l.push('show ipv6 route / show ipv6 neighbors   IPv6 state in FRR style');
  if (dev.bgp) l.push('show ip bgp summary   BGP neighbors, states, prefixes', 'show ip bgp [prefix]  BGP table: all paths, the best marked with >',
    'show ip bgp neighbors <ip> advertised-routes | received-routes', 'clear ip bgp * | <ip>   reset BGP sessions');
  if (dev.wg) l.push('wg show               WireGuard: keys, peers, endpoints, latest handshake', 'wg genkey / wg pubkey <key>   make a key pair');
  if (dev.bridge) l.push('bridge fdb            MAC table (also: show mac address-table)', 'bridge fdb flush      flush the MAC table');
  if (dev.type === 'switch') l.push('show spanning-tree    STP status: root, roles, states',
    'spanning-tree on|off  turn STP on or off',
    'spanning-tree mode stp|rstp        classic (802.1D) or rapid (802.1w)',
    'spanning-tree priority <0-61440>   bridge priority (multiples of 4096)',
    'spanning-tree portfast <port> on|off   port as edge port',
    'spanning-tree cost <port> <cost>       port cost');
  if (dev.type === 'vtep') l.push('show vxlan            VXLAN segments, flood lists, MTU', 'show evpn [mac]       EVPN: remote VTEPs per VNI, MAC table', 'show bgp l2vpn evpn   EVPN routes (type 2 and type 3)');
  l.push('clear                 clear the console');
  return l;
}

export function runCommand(dev, line) {
  const p = line.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return;
  const sim = dev.sim;
  const say = t => dev.print(t);
  const cmd = p.join(' ');
  const own = ['ping', 'ping6', 'traceroute', 'traceroute6', 'arping', 'curl', 'nc', 'dig', 'nslookup', 'dhclient', 'rdisc6'];
  if (!own.includes(p[0]) || !dev.l3) say(`$ ${cmd}`);
  try {
    if (p[0] === 'help' || p[0] === '?') return helpFor(dev).forEach(say);
    if (p[0] === 'clear' && !p[1]) { dev.consoleLines.length = 0; sim.emit('console', { devId: dev.id, clear: true }); return; }

    if (p[0] === 'ping' || p[0] === 'ping6') {
      const p0 = p[0];
      if (!dev.l3) return say('This device has no IP address. Pings can be sent from PCs, servers, routers and VTEPs.');
      const o = { count: 4 }; let dst = null, family = p0 === 'ping6' ? 6 : 0;
      for (let i = 1; i < p.length; i++) {
        if (p[i] === '-6' || p[i] === '-4') family = Number(p[i][1]);
        else if (p[i] === '-c') o.count = Math.min(100, Math.max(1, Number(p[++i]) || 4));
        else if (p[i] === '-s') o.size = Math.min(9000, Math.max(0, Number(p[++i]) || 56));
        else if (p[i] === '-M') o.df = p[++i] === 'do';
        else if (p[i] === '-t') o.ttl = Math.min(255, Math.max(1, Number(p[++i]) || 64));
        else dst = p[i];
      }
      if (dst && !isAnyIp(dst) && /^[a-zA-Z][a-zA-Z0-9.-]*$/.test(dst)) {
        say(`$ ${cmd}`);
        if (!dev.resolve) return say(`ping: ${dst}: no DNS on this device, use an address`);
        return dev.resolve(dst, ip => ip ? dev.ping(ip, { ...o, noEcho: true }) : say(`ping: ${dst}: Name or service not known`), { family });
      }
      if (!isAnyIp(dst)) return say('ping: please enter a valid address, e.g. ping 10.0.0.2 or ping 2001:db8::1');
      if (family === 4 && isIp6(dst)) return say(`ping: ${dst}: Address family for hostname not supported`);
      dev.ping(isIp6(dst) ? norm6(dst) + (dst.includes('%') ? '%' + dst.split('%')[1] : '') : dst, o); return;
    }
    if (p[0] === 'traceroute' || p[0] === 'tracert' || p[0] === 'traceroute6') {
      if (!dev.l3) return say('This device has no IP address.');
      const dst = p.find((x, i) => i > 0 && isAnyIp(x));
      if (!dst) return say('traceroute: please enter an IPv4 or IPv6 address.');
      dev.traceroute(isIp6(dst) ? norm6(dst) : dst); return;
    }
    if (p[0] === 'ip' && dev.l3 && p.includes('-6')) return ip6Command(dev, p.filter(x => x !== '-6'), say);
    if (p[0] === 'ip' && dev.l3 && p[1] !== 'link') {
      const sub = p.filter(x => !x.startsWith('-'))[1] || '';
      const brief = p.includes('-br');
      if (/^a(ddr|ddress)?$/.test(sub)) {
        const act = p.filter(x => !x.startsWith('-'))[2];
        if (act === 'add' || act === 'del') {
          const c = parseCidr(p[p.indexOf(act) + 1] || ''), ifn = p[p.indexOf('dev') + 1];
          const raw = (p[p.indexOf(act) + 1] || '').split('/');
          if (!c || p.indexOf('dev') < 0 || !dev.cfg.ifaces?.[ifn]) return say(`Syntax: ip addr ${act} 10.0.0.1/24 dev eth1`);
          if (act === 'add') { dev.cfg.ifaces[ifn].ip = raw[0]; dev.cfg.ifaces[ifn].prefix = c.len; }
          else dev.cfg.ifaces[ifn].ip = '';
          sim.record(dev, 'info', `Address ${raw[0]}/${c.len} ${act === 'add' ? 'set on ' + ifn : 'removed from ' + ifn}`, { tag: 'addr-changed', data: { ifname: ifn } });
          sim.configChanged(dev.id);
          return say('OK');
        }
        const names = Object.keys(dev.cfg.ifaces || {});
        for (const n of names) {
          const c = dev.cfg.ifaces[n];
          const mtu = dev.l3.mtu(n);
          const up = n === 'lo' || dev.l3.linkUp(n);
          const label = c.parent ? `${n}@${c.parent}` : n + (c.vlan ? '.' + c.vlan : '');
          const eff = dev.l3.ifaces().find(i => i.name === n);
          const addr = eff ? `${eff.ip}/${eff.prefix}` : '';
          if (brief) say(`${pad(label, 14)}${pad(up ? 'UP' : 'DOWN', 8)}${addr}${c.dhcp && !addr ? '(DHCP, no lease)' : ''}`);
          else {
            say(`${label}: <${up ? 'UP,LOWER_UP' : 'NO-CARRIER'}> mtu ${mtu}`);
            if (n !== 'lo') say(`    link/ether ${dev.mac(n)}${c.vlan ? `  (${c.parent ? '802.1Q id' : 'VLAN tag'} ${c.vlan})` : ''}`);
            if (addr) say(`    inet ${addr}${c.dhcp ? ` dynamic valid_lft ${dev.l3.lease?.lease ?? 0}sec` : ''}`);
            else if (c.dhcp) say('    (DHCP: no lease yet, try dhclient)');
            for (const g of dev.vrrp?.table() || []) if (g.ifname === n && g.state === 'master') say(`    inet ${g.vip}/32 (VRRP ${g.vrid} virtual address)`);
            for (const a of dev.l3.v6.ifnames().includes(n) ? dev.l3.v6.addrs(n) : []) say(inet6Line(a));
          }
        }
        return;
      }
      if (/^r(oute)?$/.test(sub)) {
        const act = p[2];
        if (act === 'get') {
          const dst = p[3];
          if (!isIp(dst)) return say('Please enter an IP address.');
          if (dev.l3.isOwn(dst)) return say(`local ${dst} dev lo  (own address)`);
          const r = dev.l3.lookup(dst);
          if (!r) return say('RTNETLINK answers: Network is unreachable');
          const pm = dev.l3.pmtu.get(dst);
          return say(`${dst}${r.via ? ' via ' + r.via : ''} dev ${r.dev} src ${dev.l3.ifIp(r.dev)}   [match: ${r.net}/${r.len}]${pm ? `\n    cache mtu ${pm}` : ''}`);
        }
        if (act === 'add' || act === 'del' || act === 'delete') {
          if (dev.type === 'pc' || dev.type === 'server') {
            if (p[3] === 'default' && act === 'add') { const via = p[p.indexOf('via') + 1]; if (!isIp(via)) return say('Syntax: ip route add default via <ip>'); dev.cfg.gw = via; say('OK'); sim.configChanged(dev.id); return; }
            if (p[3] === 'default') { dev.cfg.gw = ''; say('OK'); sim.configChanged(dev.id); return; }
          }
          const net = parseCidr(p[3]);
          if (!net) return say('Syntax: ip route add 10.0.0.0/24 via 192.168.1.1');
          const key = `${net.net}/${net.len}`;
          dev.cfg.routes ??= [];
          if (act === 'add') {
            // Several next hops (ECMP): ip route add 10.0.0.0/24 nexthop via A nexthop via B
            const vias = p.map((x, i) => x === 'via' ? p[i + 1] : null).filter(Boolean);
            const via = vias[0];
            if (!vias.length || !vias.every(isIp)) return say('Syntax: ip route add 10.0.0.0/24 via 192.168.1.1   (several: nexthop via A nexthop via B)');
            if (dev.cfg.routes.some(r => parseCidr(r.dst) && `${parseCidr(r.dst).net}/${parseCidr(r.dst).len}` === key)) return say('RTNETLINK answers: File exists');
            const di = p.findIndex(x => x === 'distance' || x === 'metric');
            const distance = di >= 0 ? Number(p[di + 1]) : 1;
            if (!(distance >= 1 && distance <= 255)) return say('The distance must be between 1 and 255.');
            for (const v of vias) dev.cfg.routes.push({ dst: key, via: v, ...(distance !== 1 ? { distance } : {}), ...(p.includes('bfd') ? { bfd: true } : {}) });
            if (!dev.l3.routes().find(r => r.proto === 'S' && `${r.net}/${r.len}` === key)?.dev) say(`Note: next hop ${via} is not in any directly connected network, the route is inactive.`);
          } else {
            const before = dev.cfg.routes.length;
            dev.cfg.routes = dev.cfg.routes.filter(r => { const c = parseCidr(r.dst); return !c || `${c.net}/${c.len}` !== key; });
            if (before === dev.cfg.routes.length) return say('RTNETLINK answers: No such process');
          }
          sim.record(dev, 'info', `Route ${key} ${act === 'add' ? 'added' : 'removed'}`, { tag: 'route-changed', data: { dst: key, act } });
          sim.configChanged(dev.id);
          return say('OK');
        }
        // Routes with several next hops (ECMP) are shown like Linux does: one line per nexthop
        const groups = [];
        for (const r of dev.l3.routes()) {
          const g = groups.find(x => x[0].proto === r.proto && x[0].net === r.net && x[0].len === r.len && r.proto !== 'C' && r.dev && x[0].dev);
          if (g) g.push(r); else groups.push([r]);
        }
        for (const g of groups) {
          const r = g[0], dst = r.len === 0 ? 'default' : r.net + '/' + r.len;
          const proto = r.proto === 'O' ? ' proto ospf' : r.proto === 'B' ? ' proto bgp' : r.dhcp ? ' proto dhcp' : '';
          // FRR installs its routes into the kernel with metric 20; the OSPF cost is in show ip route
          const metric = r.proto === 'O' || r.proto === 'B' ? ' metric 20' : r.metric ? ' metric ' + r.metric : '';
          if (r.proto === 'C') { say(`${dst} dev ${r.dev} proto kernel scope link src ${r.src}`); continue; }
          if (g.length > 1) { say(`${dst}${proto}${metric}`); for (const x of g) say(`\tnexthop via ${x.via} dev ${x.dev} weight 1`); continue; }
          if (!r.dev) { say(`${dst} via ${r.via}  (inactive: ${r.bfdDown ? 'BFD says the next hop is down' : 'next hop unreachable'})`); continue; }
          say(`${dst}${r.via ? ' via ' + r.via : ''} dev ${r.dev}${proto}${r.via ? '' : ' scope link'}${metric}${r.bfd ? '  (BFD watched)' : ''}`);
        }
        return;
      }
      if (/^n(eigh|eighbor)?$/.test(sub)) {
        if (p[2] === 'flush') { dev.l3.arp.clear(); sim.record(dev, 'info', 'ARP table flushed', { tag: 'arp-flushed' }); return say('OK'); }
        const t = dev.l3.arpTable(), t6 = dev.l3.v6.neighborTable();
        if (!t.length && !t6.length) return say('(empty)');
        for (const e of t) say(`${e.ip} dev ${e.ifname}${e.mac ? ' lladdr ' + e.mac : ''} ${e.state}`);
        for (const e of t6) say(`${e.ip} dev ${e.ifname}${e.mac ? ' lladdr ' + e.mac : ''}${e.router ? ' router' : ''} ${e.state}`);
        return;
      }
      return say('Unknown ip command. Type help.');
    }
    if (p[0] === 'ip' && p[1] === 'link') {
      const act = p[2];
      if (act === 'set') {
        const port = p[3], st = p[4];
        const l = sim.linkAt(dev.id, port);
        if (!l || !['up', 'down'].includes(st)) return say(l ? 'Syntax: ip link set eth1 down|up' : `${port || '?'}: no cable on this port`);
        sim.setLinkUp(l, st === 'up');
        return say('OK');
      }
      if (act === 'add' && dev.type === 'router') {
        const m = cmd.match(/ip link add link (\S+) name (\S+) type vlan id (\d+)/);
        if (!m) return say('Syntax: ip link add link eth1 name eth1.10 type vlan id 10');
        const [, par, name, vid] = m;
        if (!PORTS.router.includes(par)) return say(`${par}: not a physical interface`);
        if (dev.cfg.ifaces[name]) return say('RTNETLINK answers: File exists');
        const v = Number(vid);
        if (!(v >= 1 && v <= 4094)) return say('VLAN ID must be between 1 and 4094');
        if (Object.values(dev.cfg.ifaces).some(c => c.parent === par && Number(c.vlan) === v)) return say(`${par} already has a subinterface for VLAN ${v}`);
        dev.cfg.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 };
        sim.record(dev, 'info', `Subinterface ${name} created on ${par} for VLAN ${v}`, { tag: 'subif-added', data: { name, vlan: v } });
        sim.configChanged(dev.id);
        return say('OK');
      }
      if ((act === 'del' || act === 'delete') && dev.type === 'router') {
        const name = p[3];
        if (!dev.cfg.ifaces?.[name]?.parent) return say('Only subinterfaces can be deleted.');
        delete dev.cfg.ifaces[name];
        sim.configChanged(dev.id);
        return say('OK');
      }
      for (const port of PORTS[dev.type]) {
        const l = sim.linkAt(dev.id, port);
        say(`${port}: <${l ? (l.up ? 'UP,LOWER_UP' : 'DOWN') : 'NO-CARRIER'}> mtu ${l ? l.mtu : 1500}`);
      }
      return;
    }
    if (p[0] === 'arping') {
      if (!dev.l3) return say('This device has no IP address.');
      const o = { mode: 'normal' }; let ip = null;
      for (let i = 1; i < p.length; i++) {
        if (p[i] === '-U') o.mode = 'gratuitous';
        else if (p[i] === '-A') o.mode = 'reply';
        else if (p[i] === '-D') o.mode = 'dad';
        else if (p[i] === '-c') o.count = Math.min(10, Math.max(1, Number(p[++i]) || 1));
        else if (p[i] === '-I') o.ifname = p[++i];
        else ip = p[i];
      }
      if (!isIp(ip)) { say(`$ ${cmd}`); return say('Syntax: arping [-U|-A|-D] [-c count] [-I interface] <ip>'); }
      if (o.ifname && !dev.cfg.ifaces?.[o.ifname]) { say(`$ ${cmd}`); return say(`arping: interface ${o.ifname} does not exist`); }
      dev.arping(ip, o); return;
    }
    if (p[0] === 'curl' && dev.l3) {
      const u = p.slice(1).find(x => !x.startsWith('-')) || '';
      const m = u.match(/^(?:http:\/\/)?(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::(\d+))?\/?$/);
      if (!m) { say(`$ ${cmd}`); return say('Syntax: curl http://10.0.0.10/, curl http://[2001:db8::80]/ or curl http://web.lab:8080/'); }
      const port = m[2] ? Number(m[2]) : 80;
      const host = m[1].replace(/^\[|\]$/g, '');
      const family = p.includes('-6') ? 6 : p.includes('-4') ? 4 : 0;
      if (isIp(host)) { dev.curl(host, port); return; }
      if (isIp6(host)) { dev.curl(norm6(host), port); return; }
      say(`$ ${cmd}`);
      if (!dev.resolve) return say(`curl: (6) Could not resolve host: ${host} (no DNS on this device)`);
      dev.resolve(host, ip => ip ? dev.curl(ip, port, { noEcho: true }) : say(`curl: (6) Could not resolve host: ${host}`), { family }); return;
    }
    if (p[0] === 'nc' && dev.l3) {
      const args = p.slice(1).filter(x => !x.startsWith('-'));
      const flags = p.slice(1).filter(x => x.startsWith('-')).join('');
      const [ip, port] = args; const n = Number(port);
      if (!isIp(ip) || !(n >= 1 && n <= 65535)) { say(`$ ${cmd}`); return say('Syntax: nc -zv <ip> <port>  or  nc -u <ip> <port>'); }
      if (flags.includes('u')) dev.udpSend(ip, n, 32); else dev.ncz(ip, n);
      return;
    }
    if ((p[0] === 'dig' || p[0] === 'nslookup') && dev.l3) {
      let server = null, name = null, type = 'A';
      const o = {};
      for (const x of p.slice(1)) {
        if (x.startsWith('@')) server = x.slice(1);
        else if (x === '+trace') o.trace = true;
        else if (x === '+norec' || x === '+norecurse') o.rd = false;
        else if (x === '+short') o.short = true;
        else if (/^(A|AAAA|NS|CNAME)$/i.test(x) && name) type = x.toUpperCase();
        else if (x.startsWith('-type=') || x.startsWith('-q=')) type = x.split('=')[1].toUpperCase();
        else if (isIp(x) && p[0] === 'nslookup' && name) server = x;
        else if (!x.startsWith('+') && !x.startsWith('-')) name = x;
      }
      server ??= dev.l3.resolver();
      if (!name) { say(`$ ${cmd}`); return say('Syntax: dig [@server] <name> [A|AAAA|NS|CNAME] [+trace] [+norec] [+short]   e.g. dig @10.0.2.53 web.lab'); }
      if (!isIp(server)) { say(`$ ${cmd}`); return say(';; No DNS server configured. Specify one with @<ip> or enter it in the configuration.'); }
      if (!['A', 'AAAA', 'NS', 'CNAME'].includes(type)) { say(`$ ${cmd}`); return say(`;; unsupported query type ${type}: A, AAAA, NS or CNAME`); }
      dev.dig(server, name, { ...o, type }); return;
    }
    if (p[0] === 'unbound-control' || (p[0] === 'show' && p[1] === 'dns' && p[2] === 'cache') || (p[0] === 'clear' && p[1] === 'dns')) {
      if (!dev.cfg.recursion?.enabled) return say('unbound-control: this device is not a recursive resolver (Configuration, Add a feature, Recursive resolver)');
      const r = resolverOf(dev.l3);
      const sub = p[0] === 'show' ? 'dump_cache' : p[0] === 'clear' ? 'flush_all' : p[1];
      if (sub === 'dump_cache') {
        const rows = r.dump();
        if (!rows.length) return say('(cache empty)');
        say(`${pad('Name', 26)}${pad('TTL left', 10)}${pad('Type', 7)}Data`);
        for (const e of rows) say(`${pad(fqdn(e.name), 26)}${pad(e.ttl + ' s', 10)}${pad(e.type, 7)}${e.type === 'NS' || e.type === 'CNAME' ? fqdn(e.data) : e.data}`);
        return;
      }
      if (sub === 'flush_all') { const n = r.flush(); dev.record('info', `cache flushed (${n} entr${n === 1 ? 'y' : 'ies'} removed)`, { tag: 'dns-flush' }); return say(`ok removed ${n} rrsets`); }
      if (sub === 'flush' && p[2]) { const n = r.flush(p[2]); dev.record('info', `cache entries for ${fqdn(p[2])} removed`, { tag: 'dns-flush', data: { name: p[2] } }); return say(`ok removed ${n} rrsets`); }
      return say('Syntax: unbound-control dump_cache | flush_all | flush <name>');
    }
    if (p[0] === 'show' && p[1] === 'ipv6' && dev.l3) {
      if (p[2] === 'route') return showIpv6Route(dev, say);
      if (/^neigh/.test(p[2] || '')) return ip6Command(dev, ['ip', 'neigh'], say);
      return say('Syntax: show ipv6 route | show ipv6 neighbors');
    }
    if (p[0] === 'rdisc6' && dev.l3) {
      const ifn = p[1] || 'eth1';
      if (!dev.l3.v6.on) { say(`$ ${cmd}`); return say('rdisc6: IPv6 is turned off on this device'); }
      if (!dev.l3.v6.ifnames().includes(ifn)) { say(`$ ${cmd}`); return say(`rdisc6: ${ifn}: no such IPv6 interface`); }
      dev.rdisc6(ifn); return;
    }
    if (p[0] === 'sysctl' && /^net\.ipv6\.conf\.(all|default)\.disable_ipv6=[01]$/.test(p[1] || '') && dev.cfg.ipv6) {
      dev.cfg.ipv6.enabled = p[1].endsWith('=0');
      sim.record(dev, 'info', `IPv6 ${dev.cfg.ipv6.enabled ? 'turned on' : 'turned off'}`, { tag: 'v6-toggle' });
      sim.configChanged(dev.id);
      return say(p[1].replace('=', ' = '));
    }
    if (p[0] === 'wg' && dev.wg) {
      const w = dev.cfg.wg;
      if (p[1] === 'genkey') return say(wgGenKey(dev.id + sim.time + Math.random()));
      if (p[1] === 'pubkey') return say(p[2] ? wgPubKey(p[2]) : 'Syntax: wg pubkey <private key>   (usually: wg genkey | wg pubkey)');
      if (!w.enabled || !dev.cfg.ifaces?.wg0) return say('No WireGuard interface (Configuration, Add a feature, WireGuard VPN)');
      if (p[1] === 'show' && p[3] === 'public-key') return say(wgPubKey(w.privateKey));
      const ago = s => s === null ? null : s < 60 ? `${s} second${s === 1 ? '' : 's'} ago` : `${Math.floor(s / 60)} minute${s >= 120 ? 's' : ''}, ${s % 60} seconds ago`;
      const kb = n => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(2)} KiB`;
      say('interface: wg0');
      say(`  public key: ${wgPubKey(w.privateKey) || '(no private key!)'}`);
      say('  private key: (hidden)');
      say(`  listening port: ${w.listenPort || 51820}`);
      for (const x of dev.wg.table()) {
        say('');
        say(`peer: ${x.publicKey}${x.name ? '   (' + x.name + ')' : ''}`);
        say(`  endpoint: ${x.endpoint}`);
        say(`  allowed ips: ${x.allowed || '(none)'}`);
        if (x.handshake !== null) say(`  latest handshake: ${ago(x.handshake)}`);
        if (x.rx || x.tx) say(`  transfer: ${kb(x.rx)} received, ${kb(x.tx)} sent`);
        if (x.keepalive) say(`  persistent keepalive: every ${x.keepalive} seconds`);
      }
      return;
    }
    if (p[0] === 'ss' && dev.l3) {
      const f = p.slice(1).join('');
      if (f.includes('l')) {
        say(`${pad('Netid', 7)}${pad('State', 9)}${pad('Local Address:Port', 24)}Service`);
        const svcs = dev.cfg.services || [];
        if (!svcs.length) return say('(no service is listening)');
        for (const s of svcs) if (f.includes(s.proto[0]) || !/[tu]/.test(f)) say(`${pad(s.proto, 7)}${pad(s.proto === 'tcp' ? 'LISTEN' : 'UNCONN', 9)}${pad('0.0.0.0:' + s.port, 24)}${s.name || ''}`);
        return;
      }
      say(`${pad('State', 13)}${pad('Local Address:Port', 24)}Peer Address:Port`);
      const rows = [...dev.l3.tcp.values()];
      if (!rows.length) return say('(no TCP connections)');
      for (const c of rows) say(`${pad(c.state, 13)}${pad((c.local || dev.l3.srcFor(c.rip)) + ':' + c.lport, 24)}${c.rip}:${c.rport}`);
      return;
    }
    if (dev.type === 'switch' && (p[0] === 'spanning-tree' || (p[0] === 'show' && /^span/.test(p[1] || '')))) {
      const b = dev.bridge, st = dev.cfg.stp;
      if (p[0] === 'spanning-tree') {
        const change = (text, data) => { sim.record(dev, 'info', text, { tag: 'stp-config', data }); sim.configChanged(dev.id); say('OK'); };
        if (p[1] === 'on' || p[1] === 'off') { st.enabled = p[1] === 'on'; return change(`Spanning tree ${st.enabled ? 'turned on' : 'turned off'}`, { enabled: st.enabled }); }
        if (p[1] === 'mode') {
          const m = { stp: 'stp', rstp: 'rstp', 'rapid-pvst': 'rstp', ieee: 'stp', pvst: 'stp' }[p[2]];
          if (!m) return say('Syntax: spanning-tree mode stp|rstp');
          st.mode = m; return change(`Spanning tree protocol: ${m === 'rstp' ? 'RSTP (802.1w)' : 'STP (802.1D)'}`, { mode: m });
        }
        if (p[1] === 'priority') {
          const v = Number(p[2]);
          if (!(v >= 0 && v <= 61440 && v % 4096 === 0)) return say('The priority must be a multiple of 4096 between 0 and 61440.');
          st.priority = v; return change(`Bridge priority set to ${v}`, { priority: v });
        }
        if (p[1] === 'portfast' || p[1] === 'cost') {
          const port = p[2];
          if (!dev.cfg.ports[port]) return say(`${port || '?'}: unknown port`);
          if (p[1] === 'portfast') { dev.cfg.ports[port].edge = p[3] !== 'off'; return change(`${port}: PortFast ${dev.cfg.ports[port].edge ? 'on' : 'off'}`, { port }); }
          const c = Number(p[3]);
          if (!(c >= 1 && c <= 200000000)) return say('Syntax: spanning-tree cost eth1 19');
          dev.cfg.ports[port].cost = c; return change(`${port}: port cost ${c}`, { port, cost: c });
        }
        return say('Syntax: spanning-tree on|off | mode stp|rstp | priority <n> | portfast <port> on|off | cost <port> <n>');
      }
      const t = b.stpTable();
      if (!t) return say('Spanning tree is turned off. Turn it on with: spanning-tree on');
      say(`Spanning tree enabled protocol ${t.mode === 'rstp' ? 'rstp (802.1w)' : 'ieee (802.1D)'}`);
      say(`Root ID     ${t.root}${t.isRoot ? '   (this bridge is the root)' : ''}`);
      if (!t.isRoot) say(`            Cost ${t.rootCost}, root port ${t.rootPort}`);
      say(`Bridge ID   ${t.bridge}`);
      const tm = dev.bridge.timers();
      say(`Timers      Hello ${tm.hello} s, Max Age ${tm.maxAge} s`);
      say(`            Forward Delay ${tm.fwd} s`);
      say('');
      say(`${pad('Port', 5)}${pad('Role', 5)}${pad('State', 11)}${pad('Cost', 5)}${pad('ID', 6)}Type`);
      for (const r of t.ports) say(`${pad(r.port, 5)}${pad({ root: 'Root', designated: 'Desg', alternate: 'Altn', backup: 'Back', disabled: 'Disa' }[r.role], 5)}${pad(r.state, 11)}${pad(r.cost, 5)}${pad(r.id, 6)}${[t.mode === 'rstp' ? 'P2p' : '', r.edge ? 'Edge' : '', r.legacy ? 'Peer(STP)' : ''].filter(Boolean).join(' ')}`);
      return;
    }
    if (p[0] === 'arp' && dev.l3) return runCommand(dev, 'ip neigh');
    if (p[0] === 'dhclient' && dev.dhclient) {
      const ifn = p.slice(1).find(x => !x.startsWith('-')) || 'eth1';
      if (!dev.cfg.ifaces?.[ifn]) return say(`dhclient: interface ${ifn} does not exist`);
      if (p.includes('-r')) return dev.dhcpRelease(ifn);
      if (!dev.cfg.ifaces[ifn].dhcp) say(`Note: ${ifn} has a static address, switch it to DHCP in the configuration to keep the lease.`);
      dev.dhclient(ifn); return;
    }
    if ((p[0] === 'show' && p[1] === 'ip' && p[2] === 'dhcp') || (p[0] === 'dhcp' && p[1] === 'leases')) {
      if (!dev.l3) return say('This device has no IP address.');
      const ls = [...dev.l3.dhcpLeases.entries()];
      if (!dev.cfg.dhcpServer?.enabled) say('(the DHCP server is not enabled on this device)');
      say(`${pad('IP address', 16)}${pad('MAC address', 20)}State`);
      if (!ls.length) return say('(no leases)');
      for (const [mac, l] of ls) say(`${pad(l.ip, 16)}${pad(mac, 20)}${l.state}`);
      return;
    }
    if ((p[0] === 'conntrack' || (p[0] === 'show' && p[1] === 'ip' && p[2] === 'nat')) && dev.type === 'router') {
      const t = dev.l3.natTable;
      if (!dev.cfg.nat?.outside) say('(NAT is not configured: no outside interface)');
      if (!t.length) return say('(no translations)');
      const nm = { 1: 'icmp', 6: 'tcp', 17: 'udp' };
      say(`${pad('Proto', 6)}${pad('Inside', 22)}${pad('Outside', 22)}${pad('Remote', 22)}Type`);
      for (const e of t) say(`${pad(nm[e.proto] || e.proto, 6)}${pad(e.inIp + ':' + e.inPort, 22)}${pad(e.outIp + ':' + e.outPort, 22)}${pad(e.remIp + ':' + e.remPort, 22)}${e.kind}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'vrrp' && dev.type === 'router') {
      const t = dev.vrrp?.table() || [];
      if (!t.length) return say('(no VRRP groups configured)');
      for (const g of t) say(`${g.ifname} - group ${g.vrid}: ${g.state.toUpperCase()}, virtual IP ${g.vip}, virtual MAC ${g.vmac}, priority ${g.prio}${g.preempt ? ', preempt' : ''}, master ${g.master || 'unknown'}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'ip' && p[2] === 'ospf' && dev.type === 'router') {
      const o = dev.ospf;
      if (!o?.enabled) return say('OSPF is not enabled on this router.');
      if (p[3] === 'database') {
        say(`OSPF router with ID (${o.rid}), area 0.0.0.0`);
        for (const l of [...o.lsdb.values()].sort((a, b) => a.rid.localeCompare(b.rid, 'en', { numeric: true }))) {
          say(`  Router LSA ${l.rid}  seq ${l.seq}`);
          for (const k of l.links) say(k.type === 'router' ? `    neighbor ${k.rid}, cost ${k.cost}` : `    network ${k.net}/${k.len}, cost ${k.cost}`);
        }
        return;
      }
      if (p[3] === 'interface') {
        for (const i of o.ifs()) say(`${pad(i.name, 8)}${pad(i.ip + '/' + i.prefix, 20)}cost ${i.cost}${i.passive ? ', passive' : ''}, hello ${o.timers().hello} s, dead ${o.timers().dead} s`);
        return;
      }
      say(`${pad('Neighbor ID', 16)}${pad('State', 10)}${pad('Address', 16)}Interface`);
      const t = o.neighborTable();
      if (!t.length) return say('(no neighbors)');
      for (const n of t) say(`${pad(n.rid, 16)}${pad(n.state, 10)}${pad(n.ip, 16)}${n.ifname}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'ip' && p[2] === 'route' && dev.l3) {
      say('Codes: C - connected, S - static, O - OSPF, B - BGP, W - WireGuard, > - selected route, * - FIB route');
      const ad = r => r.proto === 'S' ? r.distance || 1 : r.proto === 'B' ? (r.ibgp ? 200 : 20) : { C: 0, O: 110, W: 0 }[r.proto];
      const all = dev.l3.routes();
      const sel = r => !!r.dev && !all.some(x => x !== r && x.dev && x.net === r.net && x.len === r.len && (ad(x) < ad(r) || (ad(x) === ad(r) && (x.metric || 0) < (r.metric || 0))));
      let prev = null;
      for (const r of all) {
        const mark = sel(r) ? '>*' : '  ';
        // Further next hops of the same route (ECMP) are indented like in FRR
        const more = prev && prev.proto === r.proto && prev.net === r.net && prev.len === r.len && r.proto !== 'C';
        const lead = more ? `  ${sel(r) ? '*' : ' '} ${' '.repeat(`${r.net}/${r.len}`.length + (r.proto === 'O' ? 9 : 6))}` : null;
        if (r.proto === 'C') say(`C${mark} ${r.net}/${r.len} is directly connected, ${r.dev}`);
        else if (r.proto === 'O') say(more ? `${lead}via ${r.via}, ${r.dev}` : `O${mark} ${r.net}/${r.len} [110/${r.metric}] via ${r.via}, ${r.dev}`);
        else if (r.proto === 'B') say(`B${mark} ${r.net}/${r.len} [${r.ibgp ? 200 : 20}/${r.metric || 0}] via ${r.bgpNh}${r.bgpNh !== r.via ? ` (recursive via ${r.via})` : ''}, ${r.dev}${r.ibgp ? '  (iBGP)' : ''}`);
        else if (r.proto === 'W') say(`W${mark} ${r.net}/${r.len} is directly connected, wg0 (peer ${r.peer || '?'})`);
        else say(more ? `${lead}via ${r.via}${r.dev ? ', ' + r.dev : ' inactive'}` : `S${mark} ${r.net}/${r.len} [${r.distance || 1}/0] via ${r.via}${r.dev ? ', ' + r.dev : r.bfdDown ? ' inactive (BFD down)' : ' inactive'}`);
        prev = r;
      }
      return;
    }
    if (p[0] === 'show' && (p[1] === 'bgp' || (p[1] === 'ip' && p[2] === 'bgp')) && dev.bgp) return showBgp(dev, p[1] === 'ip' ? p.slice(3) : p.slice(2), say);
    if (p[0] === 'clear' && (p[1] === 'bgp' || (p[1] === 'ip' && p[2] === 'bgp')) && dev.bgp) {
      const t = (p[1] === 'ip' ? p[3] : p[2]) || '*';
      if (t !== '*' && !dev.bgp.peers.has(t)) return say(`% No such neighbor ${t}`);
      dev.bgp.clear(t); return say(`BGP session${t === '*' ? 's' : ' ' + t} reset`);
    }
    if (p[0] === 'show' && p[1] === 'bfd' && dev.bfd) {
      const t = dev.bfd.table();
      if (!dev.cfg.bfd?.enabled) return say('BFD is off. Turn it on under Configuration (Add a feature, BFD).');
      if (!t.length) return say('No BFD peers. Mark a static route with BFD, or let BFD watch the OSPF neighbors.');
      say(`${pad('Peer', 16)}${pad('Interface', 11)}${pad('State', 7)}${pad('For', 14)}Discriminators`);
      for (const x of t) say(`${pad(x.peer, 16)}${pad(x.ifname, 11)}${pad(x.state, 7)}${pad(x.clients.join(', '), 14)}${x.myDisc}/${x.yourDisc || 0}`);
      say(`Interval ${dev.bfd.interval} ms × ${dev.bfd.mult} = detection after ${dev.bfd.interval * dev.bfd.mult} ms`);
      return;
    }
    if (p[0] === 'maximum-paths' && dev.type === 'router') {
      const n = Number(p[1]);
      if (!(n >= 1 && n <= 16)) return say('Syntax: maximum-paths <1-16>   (1 turns ECMP off)');
      dev.cfg.maxPaths = n; sim.record(dev, 'info', `ECMP: up to ${n} equal path${n === 1 ? '' : 's'}`, { tag: 'ecmp-config', data: { maxPaths: n } }); sim.configChanged(dev.id); return say('OK');
    }
    if (p[0] === 'sysctl' && dev.type === 'router' && /fib_multipath_hash_policy/.test(cmd)) {
      const m = cmd.match(/fib_multipath_hash_policy\s*=\s*([01])/);
      if (!m) return say(`net.ipv4.fib_multipath_hash_policy = ${dev.cfg.ecmpHash === 'l4' ? 1 : 0}`);
      dev.cfg.ecmpHash = m[1] === '1' ? 'l4' : 'l3';
      sim.record(dev, 'info', `ECMP hash over ${m[1] === '1' ? 'addresses and ports (layer 4)' : 'the addresses only (layer 3)'}`, { tag: 'ecmp-config', data: { hash: dev.cfg.ecmpHash } });
      sim.configChanged(dev.id); return say(`net.ipv4.fib_multipath_hash_policy = ${m[1]}`);
    }
    if (p[0] === 'sysctl' && dev.type === 'router') {
      const m = cmd.match(/ip_forward\s*=\s*([01])/);
      if (m) { dev.cfg.forwarding = m[1] === '1'; sim.record(dev, 'info', `IP forwarding ${dev.cfg.forwarding ? 'turned on' : 'turned off'}`, { tag: 'forwarding-changed', data: { on: dev.cfg.forwarding } }); sim.configChanged(dev.id); return say(`net.ipv4.ip_forward = ${m[1]}`); }
      return say(`net.ipv4.ip_forward = ${dev.cfg.forwarding !== false ? 1 : 0}`);
    }
    if ((p[0] === 'bridge' && p[1] === 'fdb') || (p[0] === 'show' && p[1] === 'mac')) {
      if (!dev.bridge) return say('This device has no bridge.');
      if (p[2] === 'flush') { dev.bridge.fdb.clear(); sim.record(dev, 'info', 'MAC table flushed', { tag: 'fdb-flushed' }); return say('OK'); }
      const t = dev.bridge.table();
      if (!t.length) return say('(empty)');
      say(`${pad('VLAN', 6)}${pad('MAC', 20)}${pad('Port', 12)}Age`);
      for (const e of t) say(`${pad(e.vid, 6)}${pad(e.mac, 20)}${pad(e.port, 12)}${e.age.toFixed(1)} s${e.remote ? '   dst ' + e.remote : ''}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'vxlan' && dev.type === 'vtep') {
      const ms = dev.maps();
      if (!ms.length) return say('(no VXLAN segments)');
      for (const m of ms) say(`vxlan${m.vni}: VNI ${m.vni} ↔ VLAN ${m.vlan}, local ${dev.localIp()}, dstport ${m.dstport || 4789}, mtu ${dev.vxlanMtu(m)}, flood ${dev.evpn.floodList(m).join(', ') || '(empty)'}${m.evpn ? ' (EVPN' + (m.arpSuppress ? ', ARP suppression' : '') + ')' : ''}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'evpn' && dev.type === 'vtep') {
      const e = dev.evpn;
      if (!e.on()) return say('EVPN is not active: turn on BGP and mark the VXLAN segments as EVPN');
      if (p[2] === 'mac') {
        say(`${pad('VNI', 8)}${pad('MAC', 20)}${pad('Type', 8)}${pad('Where', 18)}IP`);
        for (const r of e.localRoutes().filter(x => x.rt === 2)) say(`${pad(r.vni, 8)}${pad(r.mac, 20)}${pad('local', 8)}${pad('this VTEP', 18)}${r.ip || ''}`);
        for (const r of e.macs.values()) say(`${pad(r.vni, 8)}${pad(r.mac, 20)}${pad('remote', 8)}${pad(r.vtep, 18)}${r.ip || ''}`);
        return;
      }
      for (const m of e.maps()) say(`VNI ${m.vni}  VLAN ${m.vlan}  remote VTEPs: ${[...(e.vteps.get(Number(m.vni)) || [])].join(', ') || 'none'}  MACs: ${[...e.macs.values()].filter(x => Number(x.vni) === Number(m.vni)).length} remote`);
      return;
    }
    say(`Unknown command: ${p[0]}. Type help for an overview.`);
  } finally {
    sim.emit('cli', { devId: dev.id, cmd });
  }
}

export { PORTS };

// ---------------------------------------------------------------- IPv6 commands
function inet6Line(a) {
  const flags = a.state === 'duplicate' ? ' dadfailed tentative' : a.state === 'tentative' ? ' tentative' : '';
  return `    inet6 ${a.ip}/${a.len} scope ${a.scope}${a.origin === 'slaac' ? ' dynamic mngtmpaddr' : ''}${flags}`;
}
function route6Text(r, dev) {
  const dst = r.len === 0 ? 'default' : `${r.net}/${r.len}`;
  if (r.proto === 'C' || r.proto === 'K') return `${dst} dev ${r.dev} proto kernel metric 256`;
  if (r.proto === 'RA') return `${dst} via ${r.via} dev ${r.dev} proto ra metric 1024 expires ${Math.max(0, Math.round((r.until - dev.sim.time) / 1000))}sec`;
  if (!r.dev) return `${dst} via ${r.via}  (inactive: next hop not on any connected link${isLinkLocal6(r.via) ? ', a link-local next hop needs "dev"' : ''})`;
  return `${dst} via ${r.via} dev ${r.dev} metric 1024`;
}
function showIpv6Route(dev, say) {
  if (!dev.l3.v6.on) return say('IPv6 is turned off on this device');
  say('Codes: K - kernel route, C - connected, S - static, R - router advertisement');
  for (const r of dev.l3.v6.routes()) {
    const code = { C: 'C>*', K: 'K>*', S: r.dev ? 'S>*' : 'S  ', RA: 'R>*' }[r.proto];
    const dst = `${r.net}/${r.len}`;
    say(r.via ? `${code} ${dst} [${r.proto === 'S' ? (r.distance || 1) + '/0' : '0/1024'}] via ${r.via}, ${r.dev || 'inactive'}` : `${code} ${dst} is directly connected, ${r.dev}`);
  }
}
function ip6Command(dev, p, say) {
  const sim = dev.sim, v6 = dev.l3.v6;
  const sub = p[1] || '';
  if (!v6.on && !/^a(ddr|ddress)?$/.test(sub)) return say('IPv6 is turned off on this device (Configuration, Add a feature, IPv6, or sysctl net.ipv6.conf.all.disable_ipv6=0)');
  if (/^a(ddr|ddress)?$/.test(sub)) {
    const act = p[2];
    if (act === 'add' || act === 'del') {
      const raw = p[3] || '', ifn = p[p.indexOf('dev') + 1];
      const c = parseCidr6(raw.includes('/') ? raw : raw + '/64');
      if (!c || !isIp6(raw.split('/')[0]) || p.indexOf('dev') < 0 || !dev.cfg.ifaces?.[ifn]) return say(`Syntax: ip -6 addr ${act} 2001:db8:1::1/64 dev eth1`);
      const addr = `${norm6(raw.split('/')[0])}/${c.len}`;
      const ifc = dev.cfg.ifaces[ifn];
      ifc.ip6 = (Array.isArray(ifc.ip6) ? ifc.ip6 : []).filter(x => norm6(x.split('/')[0]) !== norm6(raw.split('/')[0]));
      if (act === 'add') { ifc.ip6.push(addr); dev.cfg.ipv6.enabled = true; }
      sim.record(dev, 'info', `IPv6 address ${addr} ${act === 'add' ? 'set on ' + ifn : 'removed from ' + ifn}`, { tag: 'addr-changed', data: { ifname: ifn, v6: true } });
      sim.configChanged(dev.id);
      return say('OK');
    }
    if (!v6.on) return say('(IPv6 is turned off)');
    for (const n of v6.ifnames()) {
      say(`${n}: <${dev.l3.linkUp(n) ? 'UP,LOWER_UP' : 'NO-CARRIER'}> mtu ${dev.l3.mtu(n)}`);
      for (const a of v6.addrs(n)) say(inet6Line(a));
    }
    return;
  }
  if (/^r(oute)?$/.test(sub)) {
    const act = p[2];
    if (act === 'get') {
      const dst = p[3];
      if (!isIp6(dst)) return say('Please enter an IPv6 address.');
      if (v6.isOwn(dst)) return say(`local ${norm6(dst)} dev lo  (own address)`);
      const r = v6.lookup(norm6(dst));
      if (!r) return say('RTNETLINK answers: Network is unreachable');
      return say(`${norm6(dst)} from :: ${r.via ? 'via ' + r.via + ' ' : ''}dev ${r.dev} src ${v6.srcFor(norm6(dst))}   [match: ${r.net}/${r.len}]`);
    }
    if (act === 'add' || act === 'del' || act === 'delete') {
      const net = p[3] === 'default' ? { net: '::', len: 0 } : parseCidr6(p[3] || '');
      if (!net) return say('Syntax: ip -6 route add 2001:db8:2::/64 via 2001:db8:12::2   or   ip -6 route add default via fe80::1 dev eth1');
      const key = `${net.net}/${net.len}`;
      const same = r => { const c = parseCidr6(r.dst === 'default6' ? '::/0' : r.dst); return c && `${c.net}/${c.len}` === key; };
      dev.cfg.routes ??= [];
      if (act === 'add') {
        const via = p[p.indexOf('via') + 1];
        if (p.indexOf('via') < 0 || !isIp6(via)) return say('Syntax: ip -6 route add 2001:db8:2::/64 via 2001:db8:12::2 [dev eth2]');
        if (dev.cfg.routes.some(same)) return say('RTNETLINK answers: File exists');
        const ifn = p.indexOf('dev') > 0 ? p[p.indexOf('dev') + 1] : null;
        if (isLinkLocal6(via) && !ifn && v6.ifnames().length > 1) return say('RTNETLINK answers: No route to host (a link-local next hop needs "dev eth1")');
        dev.cfg.routes.push({ dst: key, via: norm6(via), ...(ifn ? { dev: ifn } : {}) });
      } else {
        const before = dev.cfg.routes.length;
        dev.cfg.routes = dev.cfg.routes.filter(r => !same(r));
        if (before === dev.cfg.routes.length) return say('RTNETLINK answers: No such process');
      }
      sim.record(dev, 'info', `IPv6 route ${key} ${act === 'add' ? 'added' : 'removed'}`, { tag: 'route-changed', data: { dst: key, act, v6: true } });
      sim.configChanged(dev.id);
      return say('OK');
    }
    const rs = v6.routes();
    if (!rs.length) return say('(no IPv6 routes)');
    for (const r of rs) say(route6Text(r, dev));
    return;
  }
  if (/^n(eigh|eighbor)?$/.test(sub)) {
    if (p[2] === 'flush') { v6.nd.clear(); sim.record(dev, 'info', 'IPv6 neighbor cache flushed', { tag: 'nd-flushed' }); return say('OK'); }
    const t = v6.neighborTable();
    if (!t.length) return say('(empty)');
    for (const e of t) say(`${e.ip} dev ${e.ifname}${e.mac ? ' lladdr ' + e.mac : ''}${e.router ? ' router' : ''} ${e.state}`);
    return;
  }
  return say('Unknown ip -6 command. Try ip -6 addr, ip -6 route, ip -6 neigh.');
}

// ---------------------------------------------------------------- BGP (FRR style)
const hms = s => s === null ? 'never' : [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(x => String(x).padStart(2, '0')).join(':');
function showBgp(dev, args, say) {
  const b = dev.bgp;
  if (!b.enabled) return say('% BGP instance not found (Configuration, Add a feature, BGP)');
  if (args[0] === 'l2vpn' || args[0] === 'evpn') return showEvpn(dev, say);
  if (args[0] === 'summary' || (args[0] === 'ipv4' && args[2] === 'summary')) {
    say(`BGP router identifier ${b.rid}, local AS number ${b.asn}`);
    const rows = b.summary();
    say(`RIB entries ${b.best.size}, peers ${rows.length}`);
    say('');
    say(`${pad('Neighbor', 16)}V ${pad('AS', 8)}${pad('MsgRcvd', 9)}${pad('MsgSent', 9)}${pad('Up/Down', 10)}State/PfxRcd`);
    for (const r of rows) say(`${pad(r.ip, 16)}4 ${pad(r.as, 8)}${pad(r.msgsIn, 9)}${pad(r.msgsOut, 9)}${pad(hms(r.up), 10)}${r.state === 'Established' ? r.pfx + (r.evpn ? ` (+${r.evpn} EVPN)` : '') : r.state}`);
    for (const r of rows) if (r.state !== 'Established' && r.error) say(`  ${r.ip}: ${r.error}`);
    return;
  }
  if (args[0] === 'neighbors' || args[0] === 'neighbor') {
    const ip = args[1], what = args[2];
    const p = ip && b.peers.get(ip);
    if (!p) {
      for (const r of b.summary()) say(`BGP neighbor is ${r.ip}, remote AS ${r.as}, ${r.type === 'iBGP' ? 'internal' : 'external'} link\n  BGP state = ${r.state}${r.up !== null ? ', up for ' + hms(r.up) : ''}${r.error ? '\n  Last error: ' + r.error : ''}`);
      return;
    }
    if (what === 'advertised-routes' || what === 'received-routes' || what === 'routes') {
      const list = what === 'advertised-routes' ? [...p.out].map(([k, v]) => [k, JSON.parse(v)]) : [...p.rx];
      if (!list.length) return say('(none)');
      say(`   ${pad('Network', 19)}${pad('Next Hop', 17)}${pad('Metric', 7)}${pad('LocPrf', 7)}Path`);
      for (const [k, a] of list) say(`   ${pad(k, 19)}${pad(a.nextHop, 17)}${pad(a.med ?? '', 7)}${pad(a.localPref ?? '', 7)}${[...(a.asPath || []), a.origin || 'i'].join(' ')}`);
      return;
    }
    const r = b.summary().find(x => x.ip === ip);
    say(`BGP neighbor is ${ip}, remote AS ${r.as}, local AS ${b.asn}, ${r.type === 'iBGP' ? 'internal' : 'external'} link`);
    say(`  BGP version 4, remote router ID ${p.remoteRid || '0.0.0.0'}`);
    say(`  BGP state = ${r.state}${r.up !== null ? ', up for ' + hms(r.up) : ''}`);
    say(`  Hold time is ${p.holdTime || b.timersCfg().hold}, keepalive interval is ${Math.floor((p.holdTime || b.timersCfg().hold) / 3)} seconds`);
    say(`  Messages: ${r.msgsIn} received, ${r.msgsOut} sent. Prefixes received: ${r.pfx}`);
    if (p.cfg.updateSource) say(`  Update source is ${p.cfg.updateSource}`);
    if (p.cfg.nextHopSelf) say('  NEXT_HOP is always this router (next-hop-self)');
    if (p.cfg.rrClient) say('  Route-Reflector Client');
    if (p.sock) say(`  Local host: ${p.sock.local}, Local port: ${p.sock.lport}\n  Foreign host: ${ip}, Foreign port: ${p.sock.rport}`);
    if (r.error) say(`  Last reset: ${r.error}`);
    return;
  }
  const filter = args.find(a => /\d+\.\d+\.\d+\.\d+/.test(a));
  const rows = b.table().filter(r => !filter || r.prefix === filter || r.prefix.split('/')[0] === filter);
  if (filter) {
    if (!rows.length) return say('% Network not in table');
    say(`BGP routing table entry for ${rows[0].prefix}`);
    say(`Paths: (${rows.length} available${rows.some(r => r.best) ? ', best #' + (rows.findIndex(r => r.best) + 1) : ', no best path'})`);
    for (const r of rows) {
      say(`  ${r.asPath.length ? r.asPath.join(' ') : 'Local'}${r.ibgp ? '' : ''}`);
      say(`    ${r.nextHop} ${r.valid ? '' : '(inaccessible) '}from ${r.from === 'local' ? '0.0.0.0' : r.from}`);
      say(`      Origin ${{ i: 'IGP', e: 'EGP', '?': 'incomplete' }[r.origin]}, metric ${r.med}${r.localPref !== null ? ', localpref ' + r.localPref : ''}, weight ${r.weight}, ${r.valid ? 'valid' : 'invalid'}, ${r.from === 'local' ? 'sourced' : r.ibgp ? 'internal' : 'external'}${r.best ? ', best (' + r.reason + ')' : ''}`);
      if (!r.valid && r.why) say(`      Not usable: ${r.why}`);
    }
    return;
  }
  say(`BGP table version is ${b.best.size}, local router ID is ${b.rid}, vrf id 0`);
  say('Status codes:  * valid, > best, i internal');
  say('Origin codes:  i - IGP, e - EGP, ? - incomplete');
  say('');
  say(`   ${pad('Network', 19)}${pad('Next Hop', 17)}${pad('Metric', 7)}${pad('LocPrf', 7)}${pad('Weight', 7)}Path`);
  let last = null;
  for (const r of rows) {
    const code = `${r.valid ? '*' : ' '}${r.best ? '>' : ' '}${r.ibgp ? 'i' : ' '}`;
    say(`${code}${pad(r.prefix === last ? '' : r.prefix, 19)}${pad(r.nextHop, 17)}${pad(r.med, 7)}${pad(r.localPref ?? '', 7)}${pad(r.weight, 7)}${[...r.asPath, r.origin].join(' ')}${r.valid ? '' : '  (' + (r.why || 'invalid') + ')'}`);
    last = r.prefix;
  }
  say('');
  say(`Displayed ${new Set(rows.map(r => r.prefix)).size} routes and ${rows.length} total paths`);
}
function showEvpn(dev, say) {
  const e = dev.evpn;
  if (!e) return say('% EVPN is not active on this device');
  const rows = e.bgpTable();
  if (!rows.length) return say('(no EVPN routes)');
  say('Route types: [2]:[VNI]:[MAC]:[IP] MAC/IP advertisement, [3]:[VNI]:[VTEP] inclusive multicast');
  say('');
  for (const r of rows) {
    say(`*> ${r.rt === 2 ? `[2]:[${r.vni}]:[${r.mac}]${r.ip ? ':[' + r.ip + ']' : ''}` : `[3]:[${r.vni}]:[${r.nextHop}]`}`);
    say(`      VTEP ${r.nextHop}, ${r.from === 'local' ? 'local' : 'from ' + r.from}`);
  }
}
