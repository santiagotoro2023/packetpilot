// Side panel: configuration, tables and console of a device
import { h } from './ui.js';
import { I } from './icons.js';
import { isIp, parseCidr } from './net.js';
import { PORTS, STP_TEXT } from './engine.js';
import { runCommand } from './cli.js';

function ipInput(value, onChange, placeholder = '') {
  const i = h('input', { class: 'input mono', value: value || '', placeholder, spellcheck: 'false' });
  i.addEventListener('change', () => {
    const v = i.value.trim();
    if (v && !isIp(v)) { i.classList.add('bad'); return; }
    i.classList.remove('bad'); onChange(v);
  });
  return i;
}
function numInput(value, min, max, onChange, placeholder = '') {
  const i = h('input', { class: 'input mono', type: 'number', value: value ?? '', min, max, placeholder });
  i.addEventListener('change', () => {
    if (i.value === '') return onChange(null);
    const v = Math.round(Number(i.value));
    if (Number.isNaN(v) || v < min || v > max) { i.classList.add('bad'); return; }
    i.classList.remove('bad'); onChange(v);
  });
  return i;
}
function select(options, value, onChange) {
  const s = h('select', { class: 'input' }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, t)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// ---------------------------------------------------------------- Configuration
export function configPanel(dev, ctx) {
  const { sim, changed, locked, rerender } = ctx;
  const c = dev.cfg;
  const box = h('div');
  const upd = (fn, msg) => { fn(); changed(msg); };
  if (locked) box.append(h('div', { class: 'hint' }, 'The configuration is locked in this step. Observe the network and use the console and tables.'));

  if (c.type === 'pc' || c.type === 'server') {
    const i = c.ifaces.eth1;
    box.append(h('h4', {}, 'Network card eth1'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr' } },
        h('span', {}, 'IP address'), ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name}: IP ${v || 'removed'}`), '192.168.10.10'),
        h('span', {}, 'Prefix'), numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name}: prefix /${v}`)),
        h('span', {}, 'Gateway'), ipInput(c.gw, v => upd(() => c.gw = v, `${dev.name}: gateway ${v || 'removed'}`), 'empty = none'),
        h('span', {}, 'VLAN tag'), numInput(i.vlan, 1, 4094, v => upd(() => i.vlan = v, `${dev.name}: VLAN tag ${v ?? 'off'}`), 'no tag')),
      h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', {}, 'MAC'), h('dd', {}, dev.mac('eth1'))),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'A VLAN tag sends all frames with an 802.1Q tag, like a subinterface eth1.10 on Linux. Without a tag the host fits on an access port.'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr', marginTop: '8px' } },
        h('span', {}, 'DNS server'), ipInput(c.resolver, v => upd(() => c.resolver = v, `${dev.name}: DNS server ${v || 'removed'}`), 'for curl/ping with names')));
    box.append(servicesEditor(dev, upd), dnsEditor(dev, upd));
  }

  if (c.type === 'router' || c.type === 'vtep') {
    const names = c.type === 'router' ? [...PORTS.router, 'lo'] : ['eth1', 'lo'];
    box.append(h('h4', {}, c.type === 'vtep' ? 'Underlay (layer 3)' : 'Interfaces'));
    const g = h('div', { class: 'cfg-grid' });
    for (const n of names) {
      const i = c.ifaces[n];
      const linked = n === 'lo' || !!sim.linkAt(dev.id, n);
      g.append(h('span', { class: 'if', title: linked ? 'connected' : 'not connected' }, n + (linked ? '' : ' ○')),
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'no IP'}`), n === 'lo' ? 'Loopback' : ''),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)));
    }
    box.append(g);
    if (c.type === 'router') box.append(subifEditor(dev, upd, sim, rerender));
    if (c.type === 'router') {
      const fw = h('input', { type: 'checkbox', checked: c.forwarding !== false ? true : null });
      fw.addEventListener('change', () => upd(() => c.forwarding = fw.checked, `${dev.name}: forwarding ${fw.checked ? 'on' : 'off'}`));
      box.append(h('label', { class: 'row', style: { marginTop: '10px', fontSize: '.88rem' } }, fw, 'IP forwarding (net.ipv4.ip_forward = 1)'));
      const clamp = numInput(c.mssClamp, 536, 9000, v => upd(() => c.mssClamp = v, `${dev.name}: MSS clamping ${v ?? 'off'}`), 'off');
      clamp.style.width = '90px';
      box.append(h('div', { class: 'row', style: { marginTop: '6px', fontSize: '.88rem' } }, 'MSS clamping', clamp,
        h('span', { class: 'small muted' }, 'lowers the MSS in forwarded SYN segments')));
    }
    box.append(routesEditor(dev, upd));
    if (c.type === 'router') box.append(aclEditor(dev, upd));
  }

  if (c.type === 'switch' || c.type === 'vtep') {
    box.append(h('h4', {}, c.type === 'vtep' ? 'Local bridge ports' : 'Ports'));
    const ports = c.type === 'switch' ? PORTS.switch : ['eth2', 'eth3', 'eth4'];
    const shown = ports.filter(p => sim.linkAt(dev.id, p));
    if (!shown.length) box.append(h('div', { class: 'empty' }, 'No port connected yet.'));
    const g = h('div', { class: 'cfg-grid ports' });
    for (const p of shown) {
      const pc = c.ports[p];
      const vl = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } });
      const drawVl = () => {
        vl.innerHTML = '';
        if (pc.mode === 'trunk') {
          const al = h('input', { class: 'input mono', value: pc.allowed ?? '1-4094', title: 'Allowed VLANs, e.g. 10,20 or 1-4094', style: { width: '78px' } });
          al.addEventListener('change', () => upd(() => pc.allowed = al.value.trim() || '1-4094', `${dev.name} ${p}: allowed ${al.value}`));
          vl.append(al, h('span', { class: 'small muted' }, 'native'), numInput(pc.native, 1, 4094, v => upd(() => pc.native = v, `${dev.name} ${p}: native VLAN ${v ?? 'none'}`), '–'));
          vl.lastChild.style.width = '58px';
        } else {
          const n = numInput(pc.vlan ?? 1, 1, 4094, v => upd(() => pc.vlan = v ?? 1, `${dev.name} ${p}: VLAN ${v}`));
          n.style.width = '74px';
          vl.append(h('span', { class: 'small muted' }, 'VLAN'), n);
        }
      };
      drawVl();
      g.append(h('span', { class: 'if' }, p),
        select([['access', 'Access'], ['trunk', 'Trunk']], pc.mode, v => { upd(() => pc.mode = v, `${dev.name} ${p}: ${v === 'trunk' ? 'trunk' : 'access'}`); drawVl(); }),
        vl);
    }
    box.append(g);
    box.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 90px', marginTop: '10px' } },
      h('span', { class: 'small' }, 'MAC table aging time (s), 0 = learns nothing'),
      numInput(c.ageing, 0, 3600, v => upd(() => c.ageing = v ?? 300, `${dev.name}: aging ${v} s`))));
    if (c.type === 'switch') box.append(stpEditor(dev, upd, sim, shown, rerender));
  }

  if (c.type === 'vtep') box.append(vxlanEditor(dev, upd, sim));
  if (locked) box.querySelectorAll('input,select,button').forEach(e => e.disabled = true);
  return box;
}

function subifEditor(dev, upd, sim, rerender) {
  const c = dev.cfg;
  const wrap = h('div');
  const subs = Object.keys(c.ifaces).filter(n => c.ifaces[n].parent);
  wrap.append(h('h4', {}, 'Subinterfaces (802.1Q)'));
  const list = h('div', { class: 'list' });
  for (const n of subs) {
    const i = c.ifaces[n];
    list.append(h('div', { class: 'item' },
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('b', { class: 'mono small' }, n), h('span', { class: 'small muted' }, `tag ${i.vlan} on ${i.parent}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'Remove subinterface', html: I.trash, onclick: () => { upd(() => delete c.ifaces[n], `${dev.name}: ${n} removed`); rerender?.(); } })),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 70px' } },
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'no IP'}`), '10.10.0.1'),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)))));
  }
  if (!subs.length) list.append(h('div', { class: 'empty' }, 'None. A subinterface sends and receives frames with a specific VLAN tag; this is how a router routes between VLANs over a single cable (router on a stick).'));
  const parent = select(PORTS.router.map(p => [p, p]), PORTS.router.find(p => sim.linkAt(dev.id, p)) || 'eth1', () => {});
  const vid = h('input', { class: 'input mono', type: 'number', min: 1, max: 4094, placeholder: 'VLAN', style: { width: '80px' } });
  const add = h('button', { class: 'btn', html: I.plus + ' Create', onclick: () => {
    const v = Math.round(Number(vid.value)), par = parent.value;
    if (!(v >= 1 && v <= 4094)) return vid.classList.add('bad');
    const name = `${par}.${v}`;
    if (c.ifaces[name]) return vid.classList.add('bad');
    upd(() => { c.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 }; }, `${dev.name}: ${name} created`);
    rerender?.();
  } });
  wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } }, parent, vid, add),
    h('p', { class: 'small muted' }, 'The physical interface does not need its own IP for this. On the switch, the port must be a trunk that allows these VLANs.'));
  return wrap;
}

function stpEditor(dev, upd, sim, shown, rerender) {
  const c = dev.cfg, st = c.stp;
  const wrap = h('div');
  const on = h('input', { type: 'checkbox', checked: st.enabled ? true : null });
  on.addEventListener('change', () => { upd(() => st.enabled = on.checked, `${dev.name}: spanning tree ${on.checked ? 'on' : 'off'}`); rerender?.(); });
  wrap.append(h('h4', {}, 'Spanning tree (802.1D)'),
    h('label', { class: 'row', style: { fontSize: '.88rem' } }, on, 'Spanning tree enabled'));
  if (!st.enabled) { wrap.append(h('p', { class: 'small muted' }, 'Off: all ports forward immediately. If the network has a loop, broadcasts circle endlessly.')); return wrap; }
  const prios = []; for (let p = 0; p <= 61440; p += 4096) prios.push([p, String(p) + (p === 32768 ? ' (default)' : '')]);
  const timers = st.timers === 'schnell' ? 'fast' : st.timers;
  wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
    h('span', { class: 'small' }, 'Bridge priority'), select(prios, st.priority, v => upd(() => st.priority = Number(v), `${dev.name}: priority ${v}`)),
    h('span', { class: 'small' }, 'Timers'), select([['standard', 'Standard (hello 2, forward delay 15, max age 20)'], ['fast', 'Fast for the lab (1 / 4 / 6)']], timers, v => upd(() => st.timers = v, `${dev.name}: timers ${v}`))));
  const b = dev.bridge.stpTable();
  if (b) wrap.append(h('dl', { class: 'kv', style: { marginTop: '8px' } }, h('dt', {}, 'Bridge ID'), h('dd', { class: 'mono' }, b.bridge), h('dt', {}, 'Root'), h('dd', { class: 'mono' }, b.isRoot ? 'this bridge' : `${b.root} via ${b.rootPort}, cost ${b.rootCost}`)));
  if (shown.length) {
    const g = h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '50px 80px 1fr', marginTop: '8px' } }, h('span', { class: 'small muted' }, 'Port'), h('span', { class: 'small muted' }, 'Cost'), h('span', { class: 'small muted' }, 'Edge (PortFast)'));
    for (const p of shown) {
      const pc = c.ports[p];
      const edge = h('input', { type: 'checkbox', checked: pc.edge ? true : null });
      edge.addEventListener('change', () => upd(() => pc.edge = edge.checked, `${dev.name} ${p}: PortFast ${edge.checked ? 'on' : 'off'}`));
      const cost = numInput(pc.cost ?? 4, 1, 200000000, v => upd(() => pc.cost = v ?? 4, `${dev.name} ${p}: cost ${v}`));
      g.append(h('span', { class: 'if' }, p), cost, h('label', { class: 'row small' }, edge, dev.bridge.stp?.ports.get(p)?.edgeLost ? 'BPDU received, edge lost' : ''));
    }
    wrap.append(g);
  }
  wrap.append(h('p', { class: 'small muted' }, `Cost 4 corresponds to 1 Gbit/s, 19 to 100 Mbit/s. Edge ports for end devices go to Forwarding immediately.`));
  return wrap;
}

function servicesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Services (listening ports)'));
    const list = h('div', { class: 'list' });
    c.services.forEach((sv, idx) => {
      const name = h('input', { class: 'input', value: sv.name || '', placeholder: 'Name', style: { minWidth: 0, flex: '1 1 0' } });
      name.addEventListener('change', () => upd(() => sv.name = name.value.trim(), `${dev.name}: service ${name.value}`));
      const port = numInput(sv.port, 1, 65535, v => upd(() => sv.port = v ?? sv.port, `${dev.name}: port ${v}`));
      port.style.width = '78px';
      const size = numInput(sv.size, 0, 100000, v => upd(() => sv.size = v ?? 0, `${dev.name}: response ${v} bytes`), 'bytes');
      size.style.width = '90px';
      const proto = select([['tcp', 'TCP'], ['udp', 'UDP']], sv.proto, v => { upd(() => sv.proto = v, `${dev.name}: ${v}`); draw(); });
      proto.style.width = '74px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, proto, port, name,
          h('button', { class: 'btn icon ghost', title: 'Remove service', html: I.trash, onclick: () => { upd(() => c.services.splice(idx, 1), `${dev.name}: service removed`); draw(); } })),
        sv.proto === 'tcp' ? h('div', { class: 'row small muted', style: { flexWrap: 'nowrap' } }, 'Response', size, 'bytes') : null));
    });
    if (!c.services.length) list.append(h('div', { class: 'empty' }, 'No service. A TCP connection is refused with RST, UDP with ICMP Port Unreachable.'));
    wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn', html: I.plus + ' Web server (TCP 80)', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 80, name: 'http', size: 2000 }), `${dev.name}: web server`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' DNS (UDP 53)', onclick: () => { upd(() => c.services.push({ proto: 'udp', port: 53, name: 'dns' }), `${dev.name}: DNS service`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' Other', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 8080, name: 'app', size: 500 }), `${dev.name}: service`); draw(); } })),
    h('p', { class: 'small muted' }, 'For TCP, bytes is the size of the response. It is split into segments of MSS size.'));
  };
  draw();
  return wrap;
}

function dnsEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  if (!c.services.some(s => s.proto === 'udp' && Number(s.port) === 53) && !c.dns.length) return wrap;
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'DNS entries (A records)'));
    const list = h('div', { class: 'list' });
    c.dns.forEach((r, idx) => {
      const name = h('input', { class: 'input mono', value: r.name, placeholder: 'web.lab' });
      name.addEventListener('change', () => upd(() => r.name = name.value.trim().toLowerCase(), `${dev.name}: DNS ${name.value}`));
      list.append(h('div', { class: 'item' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('span', { class: 'small muted' }, 'A'),
        ipInput(r.ip, v => upd(() => r.ip = v, `${dev.name}: DNS ${r.name} → ${v}`), '10.0.0.10'),
        h('button', { class: 'btn icon ghost', title: 'Remove entry', html: I.trash, onclick: () => { upd(() => c.dns.splice(idx, 1), `${dev.name}: DNS entry removed`); draw(); } }))));
    });
    if (!c.dns.length) list.append(h('div', { class: 'empty' }, 'No entries. Every query ends with NXDOMAIN.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Entry', onclick: () => { upd(() => c.dns.push({ name: 'new.lab', ip: '' }), `${dev.name}: DNS entry`); draw(); } }));
  };
  draw();
  return wrap;
}

function routesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Static routes'));
    const list = h('div', { class: 'list' });
    c.routes.forEach((r, idx) => {
      const dst = h('input', { class: 'input mono', value: r.dst, placeholder: '10.0.0.0/24' });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); dst.classList.remove('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: route ${dst.value}`); });
      const act = dev.l3.routes().find(x => x.proto === 'S' && x.via === r.via && parseCidr(r.dst) && x.net === parseCidr(r.dst).net);
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, dst, h('span', { class: 'small muted' }, 'via'),
          ipInput(r.via, v => upd(() => r.via = v, `${dev.name}: next hop ${v}`), 'Next hop'),
          h('button', { class: 'btn icon ghost', title: 'Remove route', html: I.trash, onclick: () => { upd(() => c.routes.splice(idx, 1), `${dev.name}: route removed`); draw(); } })),
        act && !act.dev ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, 'Inactive: the next hop is not in any directly connected network') : null));
    });
    if (!c.routes.length) list.append(h('div', { class: 'empty' }, 'None. The device knows directly connected networks on its own.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Add route',
      onclick: () => { c.routes.push({ dst: '0.0.0.0/0', via: '' }); draw(); } }));
  };
  draw();
  return wrap;
}

function aclEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Rules for forwarded packets'),
      h('p', { class: 'small muted' }, 'From top to bottom, the first matching rule applies. If none matches, the packet is forwarded.'));
    const list = h('div', { class: 'list' });
    c.acl.forEach((r, idx) => {
      const src = h('input', { class: 'input mono', value: r.src || 'any', placeholder: 'any' });
      const dst = h('input', { class: 'input mono', value: r.dst || 'any', placeholder: 'any' });
      src.addEventListener('change', () => { if (!parseCidr(src.value)) return src.classList.add('bad'); upd(() => r.src = src.value.trim(), `${dev.name}: rule ${idx + 1}`); });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: rule ${idx + 1}`); });
      const type = numInput(r.icmpType, 0, 255, v => upd(() => r.icmpType = v, `${dev.name}: rule ${idx + 1}`), 'all');
      const portIn = (rr, i) => { const n = numInput(rr.port, 1, 65535, v => upd(() => rr.port = v, `${dev.name}: rule ${i + 1} port ${v ?? 'all'}`), 'all'); n.style.width = '84px'; return n; };
      type.style.width = '64px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'small' }, `#${idx + 1}`),
          select([['allow', 'allow'], ['drop', 'drop'], ['reject', 'reject']], r.action, v => upd(() => r.action = v, `${dev.name}: rule ${idx + 1}`)),
          select([['any', 'all protocols'], ['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP']], r.proto || 'any', v => { upd(() => r.proto = v, `${dev.name}: rule ${idx + 1}`); draw(); }),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'move up', html: I.up, disabled: idx === 0 ? true : null, onclick: () => { upd(() => c.acl.splice(idx - 1, 0, c.acl.splice(idx, 1)[0]), `${dev.name}: order`); draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'Remove rule', html: I.trash, onclick: () => { upd(() => c.acl.splice(idx, 1), `${dev.name}: rule removed`); draw(); } })),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'small muted' }, 'from'), src, h('span', { class: 'small muted' }, 'to'), dst),
        (r.proto === 'icmp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'ICMP type'), type, h('span', { class: 'small muted' }, '0 reply, 3 unreachable, 8 request, 11 TTL')) : null,
        (r.proto === 'tcp' || r.proto === 'udp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Dest. port'), portIn(r, idx), h('span', { class: 'small muted' }, 'empty = all ports')) : null,
        r.action === 'reject' ? h('div', { class: 'small muted' }, r.proto === 'tcp' ? 'Reject answers a SYN with TCP RST.' : 'Reject sends ICMP "administratively prohibited" to the sender.') : null));
    });
    if (!c.acl.length) list.append(h('div', { class: 'empty' }, 'No rules, everything is forwarded.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Add rule',
      onclick: () => { upd(() => c.acl.push({ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }), `${dev.name}: rule added`); draw(); } }));
  };
  draw();
  return wrap;
}

function vxlanEditor(dev, upd, sim) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'VXLAN segments'));
    const list = h('div', { class: 'list' });
    c.vxlans.forEach((m, idx) => {
      const flood = h('input', { class: 'input mono', value: (m.flood || []).join(', '), placeholder: '10.255.0.2' });
      flood.addEventListener('change', () => {
        const ips = flood.value.split(/[,\s]+/).filter(Boolean);
        if (ips.some(x => !isIp(x))) return flood.classList.add('bad');
        flood.classList.remove('bad'); upd(() => m.flood = ips, `${dev.name}: flood list ${ips.join(', ') || 'empty'}`);
      });
      const learn = h('input', { type: 'checkbox', checked: m.learning !== false ? true : null });
      learn.addEventListener('change', () => upd(() => m.learning = learn.checked, `${dev.name}: learning ${learn.checked ? 'on' : 'off'}`));
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'mono small' }, `vxlan${m.vni}`), h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'Remove segment', html: I.trash, onclick: () => { upd(() => c.vxlans.splice(idx, 1), `${dev.name}: segment removed`); draw(); } })),
        h('div', { class: 'cfg-grid vx' },
          h('label', { class: 'field' }, 'VNI', numInput(m.vni, 1, 16777215, v => { upd(() => m.vni = v, `${dev.name}: VNI ${v}`); draw(); })),
          h('label', { class: 'field' }, 'Local VLAN', numInput(m.vlan, 1, 4094, v => upd(() => m.vlan = v, `${dev.name}: VLAN ${v}`))),
          h('label', { class: 'field' }, 'UDP dest. port', numInput(m.dstport ?? 4789, 1, 65535, v => upd(() => m.dstport = v ?? 4789, `${dev.name}: port ${v}`))),
          h('label', { class: 'field' }, `MTU (auto ${dev.vxlanMtu({ ...m, mtu: null })})`, numInput(m.mtu, 68, 9000, v => upd(() => m.mtu = v, `${dev.name}: VXLAN MTU ${v ?? 'auto'}`), 'auto'))),
        h('label', { class: 'field' }, 'Flood list (remote VTEPs)', flood),
        h('label', { class: 'row small' }, learn, 'Learn MAC addresses from the tunnel (flood and learn)')));
    });
    if (!c.vxlans.length) list.append(h('div', { class: 'empty' }, 'No segment. A segment connects a local VLAN to a VNI.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Add segment',
      onclick: () => { upd(() => c.vxlans.push({ vni: 10000 + (c.vxlans.length + 1) * 10, vlan: (c.vxlans.length + 1) * 10, flood: [], dstport: 4789, learning: true }), `${dev.name}: segment added`); draw(); } }),
    h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Tunnel source: ${dev.localIp() || '(no address)'}. Linux adjusts the MTU automatically: MTU of eth1 minus 50.`));
  };
  draw();
  return wrap;
}

// ---------------------------------------------------------------- Tables
export function tablesPanel(dev, sim) {
  const box = h('div');
  const tbl = (head, rows) => {
    if (!rows.length) return h('div', { class: 'empty' }, '(empty)');
    return h('table', { class: 'tbl' }, h('tr', {}, head.map(x => h('th', {}, x))), rows.map(r => h('tr', {}, r.map(x => h('td', {}, x ?? '')))));
  };
  if (dev.l3) {
    box.append(h('h4', {}, 'Routing table'),
      tbl(['Destination', 'via', 'dev', ''], dev.l3.routes().map(r => [`${r.net}/${r.len}`, r.via || 'direct', r.dev || '–', r.proto === 'C' ? 'C' : (r.dev ? 'S' : 'S inactive')])));
    box.append(h('h4', {}, 'ARP table'),
      tbl(['IP', 'MAC', 'dev', 'State'], dev.l3.arpTable().map(e => [e.ip, e.mac || '–', e.ifname, e.state])));
    if (dev.l3.pmtu.size) box.append(h('h4', {}, 'Learned path MTU'), tbl(['Destination', 'MTU'], [...dev.l3.pmtu].map(([k, v]) => [k, v])));
    const conns = [...dev.l3.tcp.values()];
    if (conns.length) box.append(h('h4', {}, 'TCP connections'), tbl(['State', 'Local', 'Peer'], conns.map(c => [c.state, `:${c.lport}`, `${c.rip}:${c.rport}`])));
    if (dev.cfg.services?.length) box.append(h('h4', {}, 'Listening services'), tbl(['Proto', 'Port', 'Service'], dev.cfg.services.map(s => [s.proto.toUpperCase(), s.port, s.name || ''])));
  }
  if (dev.type === 'switch') {
    const t = dev.bridge.stpTable();
    if (t) {
      box.append(h('h4', {}, 'Spanning tree'),
        h('dl', { class: 'kv' }, h('dt', {}, 'Root'), h('dd', { class: 'mono' }, t.root + (t.isRoot ? ' (this bridge)' : '')),
          h('dt', {}, 'Bridge'), h('dd', { class: 'mono' }, t.bridge),
          ...(t.isRoot ? [] : [h('dt', {}, 'Root port'), h('dd', {}, `${t.rootPort}, cost ${t.rootCost}`)])),
        tbl(['Port', 'Role', 'State', 'Cost'], t.ports.map(p => [p.port + (p.edge ? ' (edge)' : ''), STP_TEXT.ROLE[p.role], STP_TEXT.STATE[p.state], p.cost])));
    }
  }
  if (dev.bridge) {
    box.append(h('h4', {}, 'MAC table'),
      tbl(['VLAN', 'MAC', 'Port', 'Age'], dev.bridge.table().map(e => [e.vid, e.mac, e.remote ? `${e.port} → ${e.remote}` : e.port, e.age.toFixed(1) + ' s'])));
  }
  if (dev.type === 'vtep') {
    box.append(h('h4', {}, 'VXLAN'), tbl(['Interface', 'VLAN', 'Port', 'MTU', 'Flood'],
      dev.maps().map(m => [`vxlan${m.vni}`, m.vlan, m.dstport || 4789, dev.vxlanMtu(m), (m.flood || []).join(', ') || '(empty)'])));
  }
  return box;
}

// ---------------------------------------------------------------- Console
export function consolePanel(dev, sim, presets = []) {
  const pre = h('pre', { 'aria-live': 'polite' });
  const draw = () => { pre.textContent = dev.consoleLines.join('\n') || 'Type help for an overview of the commands.'; pre.scrollTop = pre.scrollHeight; };
  draw();
  const input = h('input', { class: 'input', placeholder: dev.l3 ? 'e.g. ping 192.168.20.20' : 'e.g. bridge fdb', spellcheck: 'false', autocomplete: 'off' });
  const hist = []; let hi = 0;
  const run = cmd => { if (!cmd.trim()) return; hist.push(cmd); hi = hist.length; runCommand(dev, cmd); draw(); };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { run(input.value); input.value = ''; }
    if (e.key === 'ArrowUp' && hi > 0) { input.value = hist[--hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
  });
  const quick = h('div', { class: 'quick' });
  const defaults = dev.l3 ? ['help', 'ip addr', 'ip route', 'ip neigh', 'ip neigh flush'] : ['help', 'bridge fdb', 'bridge fdb flush'];
  if (dev.type === 'switch') defaults.push('show spanning-tree');
  if (dev.type === 'pc' || dev.type === 'server') defaults.push('ss -tuln');
  for (const q of [...presets, ...defaults]) quick.append(h('button', { class: 'btn', onclick: () => run(q) }, q));
  const el = h('div', { class: 'console' }, pre, h('div', { class: 'in' }, input, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; input.focus(); } }, 'Run')), quick);
  el.refresh = draw;
  el.focusInput = () => input.focus();
  return el;
}
