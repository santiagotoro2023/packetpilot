// Small command line per device, modeled on iproute2 and FRR
import { isIp, parseCidr } from './net.js';
import { PORTS } from './engine.js';

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
    'dig [@server] <name>  DNS query over UDP 53',
    'curl http://<name>/   DNS first, then TCP (DNS server in the configuration)',
    'ss -tan / ss -tuln    TCP connections / open ports');
  if (dev.type === 'router') l.push(
    'ip link add link eth1 name eth1.10 type vlan id 10   create a subinterface',
    'ip addr add 10.10.0.1/24 dev eth1.10   set an address',
    'ip link del eth1.10   delete a subinterface');
  l.push('ip link set <port> down|up   disconnect or reconnect the cable on this port');
  if (dev.type === 'router') l.push('show ip route         routing table in FRR style', 'sysctl net.ipv4.ip_forward=0|1');
  if (dev.bridge) l.push('bridge fdb            MAC table (also: show mac address-table)', 'bridge fdb flush      flush the MAC table');
  if (dev.type === 'switch') l.push('show spanning-tree    STP status: root, roles, states',
    'spanning-tree on|off  turn STP on or off',
    'spanning-tree priority <0-61440>   bridge priority (multiples of 4096)',
    'spanning-tree portfast <port> on|off   port as edge port',
    'spanning-tree cost <port> <cost>       port cost');
  if (dev.type === 'vtep') l.push('show vxlan            VXLAN segments, flood lists, MTU');
  l.push('clear                 clear the console');
  return l;
}

export function runCommand(dev, line) {
  const p = line.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return;
  const sim = dev.sim;
  const say = t => dev.print(t);
  const cmd = p.join(' ');
  const own = ['ping', 'traceroute', 'arping', 'curl', 'nc', 'dig', 'nslookup'];
  if (!own.includes(p[0]) || !dev.l3) say(`$ ${cmd}`);
  try {
    if (p[0] === 'help' || p[0] === '?') return helpFor(dev).forEach(say);
    if (p[0] === 'clear') { dev.consoleLines.length = 0; sim.emit('console', { devId: dev.id, clear: true }); return; }

    if (p[0] === 'ping') {
      if (!dev.l3) return say('This device has no IP address. Pings can be sent from PCs, servers, routers and VTEPs.');
      const o = { count: 4 }; let dst = null;
      for (let i = 1; i < p.length; i++) {
        if (p[i] === '-c') o.count = Math.min(100, Math.max(1, Number(p[++i]) || 4));
        else if (p[i] === '-s') o.size = Math.min(9000, Math.max(0, Number(p[++i]) || 56));
        else if (p[i] === '-M') o.df = p[++i] === 'do';
        else if (p[i] === '-t') o.ttl = Math.min(255, Math.max(1, Number(p[++i]) || 64));
        else dst = p[i];
      }
      if (dst && !isIp(dst) && /^[a-zA-Z][a-zA-Z0-9.-]*$/.test(dst)) {
        say(`$ ${cmd}`);
        return dev.resolve(dst, ip => ip ? dev.ping(ip, { ...o, noEcho: true }) : say(`ping: ${dst}: Name or service not known`));
      }
      if (!isIp(dst)) return say('ping: please enter a valid IPv4 address, e.g. ping 10.0.0.2');
      dev.ping(dst, o); return;
    }
    if (p[0] === 'traceroute' || p[0] === 'tracert') {
      if (!dev.l3) return say('This device has no IP address.');
      const dst = p.find((x, i) => i > 0 && isIp(x));
      if (!dst) return say('traceroute: please enter an IPv4 address.');
      dev.traceroute(dst); return;
    }
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
          const addr = isIp(c.ip) ? `${c.ip}/${c.prefix}` : '';
          if (brief) say(`${pad(label, 14)}${pad(up ? 'UP' : 'DOWN', 8)}${addr}`);
          else {
            say(`${label}: <${up ? 'UP,LOWER_UP' : 'NO-CARRIER'}> mtu ${mtu}`);
            if (n !== 'lo') say(`    link/ether ${dev.mac(n)}${c.vlan ? `  (${c.parent ? '802.1Q id' : 'VLAN tag'} ${c.vlan})` : ''}`);
            if (addr) say(`    inet ${addr}`);
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
            const via = p[p.indexOf('via') + 1];
            if (!isIp(via)) return say('Syntax: ip route add 10.0.0.0/24 via 192.168.1.1');
            if (dev.cfg.routes.some(r => parseCidr(r.dst) && `${parseCidr(r.dst).net}/${parseCidr(r.dst).len}` === key)) return say('RTNETLINK answers: File exists');
            dev.cfg.routes.push({ dst: key, via });
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
        for (const r of dev.l3.routes()) {
          if (r.proto === 'C') say(`${r.net}/${r.len} dev ${r.dev} proto kernel scope link src ${r.src}`);
          else say(`${r.len === 0 ? 'default' : r.net + '/' + r.len} via ${r.via}${r.dev ? ' dev ' + r.dev : '  (inactive: next hop unreachable)'}`);
        }
        return;
      }
      if (/^n(eigh|eighbor)?$/.test(sub)) {
        if (p[2] === 'flush') { dev.l3.arp.clear(); sim.record(dev, 'info', 'ARP table flushed', { tag: 'arp-flushed' }); return say('OK'); }
        const t = dev.l3.arpTable();
        if (!t.length) return say('(empty)');
        for (const e of t) say(`${e.ip} dev ${e.ifname}${e.mac ? ' lladdr ' + e.mac : ''} ${e.state}`);
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
      const m = u.match(/^(?:http:\/\/)?([a-zA-Z0-9.-]+)(?::(\d+))?\/?$/);
      if (!m) { say(`$ ${cmd}`); return say('Syntax: curl http://10.0.0.10/ or curl http://web.lab:8080/'); }
      const port = m[2] ? Number(m[2]) : 80;
      if (isIp(m[1])) { dev.curl(m[1], port); return; }
      say(`$ ${cmd}`);
      dev.resolve(m[1], ip => ip ? dev.curl(ip, port, { noEcho: true }) : say(`curl: (6) Could not resolve host: ${m[1]}`)); return;
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
      let server = null, name = null;
      for (const x of p.slice(1)) { if (x.startsWith('@')) server = x.slice(1); else if (isIp(x) && p[0] === 'nslookup') server = x; else if (!x.startsWith('+')) name = x; }
      server ??= (dev.cfg.resolver || '');
      if (!name) { say(`$ ${cmd}`); return say('Syntax: dig @<server-ip> <name>   e.g. dig @10.0.2.53 web.lab'); }
      if (!isIp(server)) { say(`$ ${cmd}`); return say(';; No DNS server configured. Specify one with @<ip> or enter it in the configuration.'); }
      dev.dig(server, name); return;
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
        return say('Syntax: spanning-tree on|off | priority <n> | portfast <port> on|off | cost <port> <n>');
      }
      const t = b.stpTable();
      if (!t) return say('Spanning tree is turned off. Turn it on with: spanning-tree on');
      say(`Root ID     ${t.root}${t.isRoot ? '   (this bridge is the root)' : ''}`);
      if (!t.isRoot) say(`            Cost ${t.rootCost}, root port ${t.rootPort}`);
      say(`Bridge ID   ${t.bridge}`);
      const tm = dev.bridge.timers();
      say(`Timers      Hello ${tm.hello} s, Max Age ${tm.maxAge} s`);
      say(`            Forward Delay ${tm.fwd} s`);
      say('');
      say(`${pad('Port', 6)}${pad('Role', 6)}${pad('State', 12)}${pad('Cost', 7)}Port ID`);
      for (const r of t.ports) say(`${pad(r.port, 6)}${pad({ root: 'Root', designated: 'Desg', alternate: 'Altn', disabled: 'Disa' }[r.role], 6)}${pad(r.state, 12)}${pad(r.cost, 7)}${r.id}${r.edge ? ' Edge' : ''}`);
      return;
    }
    if (p[0] === 'arp' && dev.l3) return runCommand(dev, 'ip neigh');
    if (p[0] === 'show' && p[1] === 'ip' && p[2] === 'route' && dev.l3) {
      say('Codes: C - connected, S - static, > - selected route, * - FIB route');
      for (const r of dev.l3.routes()) {
        if (r.proto === 'C') say(`C>* ${r.net}/${r.len} is directly connected, ${r.dev}`);
        else say(`S${r.dev ? '>*' : '  '} ${r.net}/${r.len} [1/0] via ${r.via}${r.dev ? ', ' + r.dev : ' inactive'}`);
      }
      return;
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
      for (const m of ms) say(`vxlan${m.vni}: VNI ${m.vni} ↔ VLAN ${m.vlan}, local ${dev.localIp()}, dstport ${m.dstport || 4789}, mtu ${dev.vxlanMtu(m)}, flood ${(m.flood || []).join(', ') || '(empty)'}`);
      return;
    }
    say(`Unknown command: ${p[0]}. Type help for an overview.`);
  } finally {
    sim.emit('cli', { devId: dev.id, cmd });
  }
}

export { PORTS };
