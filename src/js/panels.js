// Side panel: configuration, tables and console of a device
import { h } from './ui.js';
import { I } from './icons.js';
import { isIp, parseCidr, isAnyIp, isIp6, parseCidr6, norm6 } from './net.js';
import { staticAddrs } from './ipv6.js';
import { wgPubKey, wgGenKey, isWgKey, shortKey } from './vpn.js';
import { PORTS, STP_TEXT } from './engine.js';
import { runCommand } from './cli.js';

function ipInput(value, onChange, placeholder = '', any = false) {
  const i = h('input', { class: 'input mono', value: value || '', placeholder, spellcheck: 'false' });
  i.addEventListener('change', () => {
    const v = i.value.trim();
    if (v && !(any ? isAnyIp(v) : isIp(v))) { i.classList.add('bad'); return; }
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

// Collapsible section for features that are not always needed. It opens by itself when the
// feature is in use and remembers being opened or closed while the device stays selected.
const sectionOpen = new Map();
function section(dev, title, status, inUse, content) {
  const key = dev.id + '|' + title;
  const d = h('details', { class: 'sect', open: (sectionOpen.get(key) ?? inUse) ? true : null },
    h('summary', {}, h('span', {}, title), h('span', { class: 'sect-status' + (inUse ? ' on' : '') }, status)), h('div', { class: 'sect-body' }, content));
  d.addEventListener('toggle', () => sectionOpen.set(key, d.open));
  return d;
}

// Optional features: only the ones in use (or just added) are shown, the rest waits in a
// small menu with one line of explanation each. This keeps a new device calm to look at.
const featShown = new Set();
function features(dev, list, rerender, locked) {
  const wrap = h('div', { class: 'features' });
  const key = f => dev.id + '|' + f.id;
  const active = list.filter(f => f.inUse || featShown.has(key(f)));
  const rest = list.filter(f => !active.includes(f));
  for (const f of active) wrap.append(section(dev, f.title, f.status || '', f.inUse, f.render()));
  if (rest.length && !locked) {
    const menu = h('div', { class: 'featmenu hidden', role: 'menu' }, rest.map(f => h('button', { class: 'featitem', role: 'menuitem', onclick: () => {
      featShown.add(key(f)); sectionOpen.set(dev.id + '|' + f.title, true); f.onAdd?.(); rerender?.();
    } }, h('b', {}, f.title), h('span', {}, f.desc))));
    const btn = h('button', { class: 'btn addfeat', 'aria-expanded': 'false', html: `${I.plus} Add a feature <span class="small muted">(${rest.map(f => f.title).join(', ')})</span>`,
      onclick: () => { const open = menu.classList.toggle('hidden') === false; btn.setAttribute('aria-expanded', String(open)); } });
    wrap.append(btn, menu);
  }
  return wrap;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- Configuration
export function configPanel(dev, ctx) {
  const { sim, changed, locked, rerender } = ctx;
  const c = dev.cfg;
  const box = h('div');
  const upd = (fn, msg) => { fn(); changed(msg); };
  if (locked) box.append(h('div', { class: 'hint' }, 'The configuration is locked in this step. Observe the network and use the console and tables.'));

  if (c.type === 'pc' || c.type === 'server') {
    const i = c.ifaces.eth1;
    const mode = select([['static', 'Static'], ['dhcp', 'DHCP (automatic)']], i.dhcp ? 'dhcp' : 'static', v => {
      upd(() => { i.dhcp = v === 'dhcp'; }, `${dev.name}: ${v === 'dhcp' ? 'DHCP' : 'static address'}`);
      if (v === 'dhcp') dev.dhclient('eth1'); else { dev.l3.lease = null; }
      rerender?.();
    });
    const lease = dev.l3.lease;
    const addrRows = i.dhcp ? [
      h('span', {}, 'Address'), h('span', { class: 'mono small' }, lease ? `${lease.ip}/${lease.prefix}` : 'waiting for DHCP …'),
      h('span', {}, 'Gateway'), h('span', { class: 'mono small' }, lease?.router || (lease ? 'none' : '–')),
      h('span', {}, 'DNS server'), h('span', { class: 'mono small' }, lease?.dns || (lease ? 'none' : '–'))
    ] : [
      h('span', {}, 'IP address'), ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name}: IP ${v || 'removed'}`), '192.168.10.10'),
      h('span', {}, 'Prefix'), numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name}: prefix /${v}`)),
      h('span', {}, 'Gateway'), ipInput(c.gw, v => upd(() => c.gw = v, `${dev.name}: gateway ${v || 'removed'}`), 'empty = none')
    ];
    box.append(h('h4', {}, 'Network card eth1'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr' } },
        h('span', {}, 'Address'), mode, ...addrRows,
        ...(i.dhcp ? [] : [h('span', {}, 'DNS server'), ipInput(c.resolver, v => upd(() => c.resolver = v, `${dev.name}: DNS server ${v || 'removed'}`), 'for names, optional', true)])),
      i.dhcp ? h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn', onclick: () => { dev.dhclient('eth1'); } }, 'Ask again (dhclient)'),
        lease ? h('button', { class: 'btn ghost', onclick: () => { dev.dhcpRelease('eth1'); rerender?.(); } }, 'Release') : null) : '',
      h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', {}, 'MAC'), h('dd', {}, dev.mac('eth1'))));
    const hasDnsSvc = () => c.services.some(x => x.proto === 'udp' && Number(x.port) === 53);
    box.append(features(dev, [
      { id: 'services', title: 'Services', desc: 'Programs that listen on a port, e.g. a web server on TCP 80',
        inUse: c.services.length > 0, status: c.services.map(x => `${x.proto.toUpperCase()} ${x.port}`).join(', '), render: () => servicesEditor(dev, upd) },
      { id: 'dns', title: 'DNS records', desc: 'Answer name queries for other devices (DNS server on UDP 53)',
        inUse: c.dns.length > 0 || !!c.dnsZone, status: plural(c.dns.length, 'record') + (c.dnsZone ? `, zone ${c.dnsZone}` : ''), render: () => dnsEditor(dev, upd),
        onAdd: () => { if (!hasDnsSvc()) upd(() => c.services.push({ proto: 'udp', port: 53, name: 'dns' }), `${dev.name}: DNS service`); } },
      { id: 'resolver', title: 'Recursive resolver', desc: 'Find any name for others: ask root, TLD and authoritative servers and cache the answers',
        inUse: !!c.recursion?.enabled, status: c.recursion?.enabled ? `on, ${plural(dev.l3.resolverSvc?.dump().length || 0, 'cached record')}` : 'off', render: () => resolverEditor(dev, upd, rerender),
        onAdd: () => upd(() => { c.recursion.enabled = true; if (!hasDnsSvc()) c.services.push({ proto: 'udp', port: 53, name: 'dns' }); }, `${dev.name}: recursive resolver`) },
      ...(c.type === 'server' ? [{ id: 'dhcpd', title: 'DHCP server', desc: 'Hand out addresses to other devices',
        inUse: c.dhcpServer.enabled, status: c.dhcpServer.enabled ? `on, ${plural(dev.l3.dhcpLeases.size, 'lease')}` : 'off', render: () => dhcpServerEditor(dev, upd) }] : []),
      { id: 'ipv6', title: 'IPv6', desc: 'A second address family: link-local, addresses from router advertisements (SLAAC), static addresses',
        inUse: !!c.ipv6?.enabled, status: c.ipv6?.enabled ? plural(dev.l3.v6.allAddrs().filter(a => a.scope === 'global').length, 'global address') : 'off', render: () => ipv6HostEditor(dev, upd, rerender),
        onAdd: () => upd(() => { c.ipv6.enabled = true; }, `${dev.name}: IPv6 on`) },
      { id: 'wg', title: 'WireGuard VPN', desc: 'An encrypted tunnel wg0 to other sites or devices, with keys and allowed IPs',
        inUse: !!c.wg?.enabled, status: c.wg?.enabled ? `wg0 ${c.ifaces.wg0?.ip || ''}, ${plural((c.wg.peers || []).length, 'peer')}` : 'off', render: () => wgEditor(dev, upd, rerender),
        onAdd: () => upd(() => { c.wg.enabled = true; c.wg.privateKey ||= wgGenKey(dev.id + Date.now()); c.ifaces.wg0 ??= { ip: '10.99.0.1', prefix: 24 }; }, `${dev.name}: WireGuard on`) },
      { id: 'vlan', title: 'VLAN tag', desc: 'Send every frame with an 802.1Q tag, like eth1.10 on Linux',
        inUse: !!i.vlan, status: i.vlan ? `VLAN ${i.vlan}` : '', render: () => h('div', {},
          h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr' } }, h('span', {}, 'VLAN tag'), numInput(i.vlan, 1, 4094, v => upd(() => i.vlan = v, `${dev.name}: VLAN tag ${v ?? 'off'}`), 'no tag')),
          h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Without a tag the host fits on an access port. With a tag, the switch port must be a trunk that allows this VLAN.')) }
    ], rerender, locked));
  }

  if (c.type === 'router' || c.type === 'vtep') {
    const names = c.type === 'router' ? [...PORTS.router, 'lo'] : ['eth1', 'lo'];
    box.append(h('h4', {}, c.type === 'vtep' ? 'Underlay (layer 3)' : 'Interfaces'));
    const g = h('div', { class: 'cfg-grid' });
    // Ports without a cable and without an address only appear on request
    const used = n => n === 'lo' || !!sim.linkAt(dev.id, n) || isIp(c.ifaces[n].ip);
    const showAll = featShown.has(dev.id + '|allports');
    for (const n of names) {
      if (!showAll && !used(n)) continue;
      const i = c.ifaces[n];
      const linked = n === 'lo' || !!sim.linkAt(dev.id, n);
      g.append(h('span', { class: 'if', title: linked ? 'connected' : 'not connected' }, n + (linked ? '' : ' ○')),
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'no IP'}`), n === 'lo' ? 'Loopback' : ''),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)));
    }
    box.append(g);
    const hidden = names.filter(n => !used(n));
    if (hidden.length && !locked) box.append(h('button', { class: 'linkbtn small', onclick: () => { showAll ? featShown.delete(dev.id + '|allports') : featShown.add(dev.id + '|allports'); rerender?.(); } },
      showAll ? 'Hide ports without a cable' : `Show ports without a cable (${hidden.join(', ')})`));
    box.append(routesEditor(dev, upd));
    if (c.type === 'router') {
      const subs = Object.keys(c.ifaces).filter(n => c.ifaces[n].parent);
      const relay = Object.values(c.ifaces).some(i => isIp(i.helper));
      const fullNbrs = (dev.ospf?.neighborTable() || []).filter(n => n.state === 'Full').length;
      box.append(features(dev, [
        { id: 'subif', title: 'Subinterfaces', desc: 'One cable, several VLANs: router on a stick', inUse: subs.length > 0, status: subs.join(', '), render: () => subifEditor(dev, upd, sim, rerender) },
        { id: 'ipv6', title: 'IPv6', desc: 'IPv6 addresses per interface, router advertisements for SLAAC, a DNS server for the clients (RDNSS)',
          inUse: !!c.ipv6?.enabled, status: c.ipv6?.enabled ? `on${(c.ipv6.ra || []).length ? ', RA on ' + c.ipv6.ra.join(', ') : ''}` : 'off', render: () => ipv6RouterEditor(dev, upd, sim, rerender),
          onAdd: () => upd(() => { c.ipv6.enabled = true; }, `${dev.name}: IPv6 on`) },
        { id: 'wg', title: 'WireGuard VPN', desc: 'An encrypted tunnel wg0 to other sites or devices, with keys and allowed IPs',
          inUse: !!c.wg?.enabled, status: c.wg?.enabled ? `wg0 ${c.ifaces.wg0?.ip || ''}, ${plural((c.wg.peers || []).length, 'peer')}` : 'off', render: () => wgEditor(dev, upd, rerender),
          onAdd: () => upd(() => { c.wg.enabled = true; c.wg.privateKey ||= wgGenKey(dev.id + Date.now()); c.ifaces.wg0 ??= { ip: '10.99.0.1', prefix: 24 }; }, `${dev.name}: WireGuard on`) },
        { id: 'rules', title: 'Rules', desc: 'Allow, drop or reject forwarded packets (firewall)', inUse: c.acl.length > 0, status: plural(c.acl.length, 'rule'), render: () => aclEditor(dev, upd) },
        { id: 'nat', title: 'NAT', desc: 'Inside hosts share the outside address, port forwards', inUse: !!c.nat.outside, status: c.nat.outside ? `outside ${c.nat.outside}` : 'off', render: () => natEditor(dev, upd, rerender) },
        { id: 'dhcp', title: 'DHCP', desc: 'Hand out addresses, or relay requests to a DHCP server', inUse: c.dhcpServer.enabled || relay,
          status: c.dhcpServer.enabled ? 'server on' : relay ? 'relay' : 'off', render: () => h('div', {}, relayEditor(dev, upd), dhcpServerEditor(dev, upd)) },
        { id: 'vrrp', title: 'VRRP', desc: 'Share a gateway address with a second router', inUse: c.vrrp.length > 0,
          status: (dev.vrrp?.table() || []).map(g => `${g.vrid}: ${g.state}`).join(', ') || plural(c.vrrp.length, 'group'), render: () => vrrpEditor(dev, upd, rerender) },
        { id: 'ospf', title: 'OSPF', desc: 'Learn routes automatically from neighboring routers', inUse: c.ospf.enabled,
          status: c.ospf.enabled ? `on, ${plural(fullNbrs, 'neighbor')}` : 'off', render: () => ospfEditor(dev, upd, rerender) },
        { id: 'ecmp', title: 'Load balancing (ECMP)', desc: 'Use several equally good routes at the same time', inUse: Number(c.maxPaths) !== 4 || c.ecmpHash === 'l4',
          status: Number(c.maxPaths) === 1 ? 'off (1 path)' : `up to ${c.maxPaths} paths, ${c.ecmpHash === 'l4' ? 'L4' : 'L3'} hash`, render: () => ecmpEditor(dev, upd) },
        { id: 'bfd', title: 'BFD', desc: 'Notice a dead neighbor in under a second', inUse: !!c.bfd.enabled,
          status: c.bfd.enabled ? (dev.bfd?.table() || []).map(x => `${x.peer} ${x.state}`).join(', ') || 'on, no peers' : 'off', render: () => bfdEditor(dev, upd, rerender) },
        { id: 'adv', title: 'Advanced', desc: 'IP forwarding on or off, MSS clamping', inUse: c.forwarding === false || !!c.mssClamp,
          status: c.forwarding === false || c.mssClamp ? 'changed' : '', render: () => advancedEditor(dev, upd) }
      ], rerender, locked));
    }
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
    const st = c.stp;
    box.append(features(dev, [
      ...(c.type === 'switch' ? [{ id: 'stp', title: 'Spanning tree', desc: 'Block redundant paths so no loop forms (STP or RSTP)', inUse: !!st.enabled,
        status: st.enabled ? `${st.mode === 'rstp' ? 'RSTP' : 'STP'}${dev.bridge.stpTable()?.isRoot ? ', root' : ''}` : 'off', render: () => stpEditor(dev, upd, sim, shown, rerender) }] : []),
      { id: 'mac', title: 'MAC table', desc: 'How long learned addresses are kept, 0 turns the switch into a hub', inUse: Number(c.ageing) !== 300,
        status: `aging ${c.ageing} s`, render: () => h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 90px' } },
          h('span', { class: 'small' }, 'Aging time (s), 0 = learns nothing'),
          numInput(c.ageing, 0, 3600, v => upd(() => c.ageing = v ?? 300, `${dev.name}: aging ${v} s`))) }
    ], rerender, locked));
  }

  if (c.type === 'vtep') box.append(vxlanEditor(dev, upd, sim));
  if (locked) box.querySelectorAll('input,select,button').forEach(e => e.disabled = true);
  return box;
}

function subifEditor(dev, upd, sim, rerender) {
  const c = dev.cfg;
  const wrap = h('div');
  const subs = Object.keys(c.ifaces).filter(n => c.ifaces[n].parent);
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
  wrap.append(h('label', { class: 'row', style: { fontSize: '.88rem' } }, on, 'Spanning tree enabled'));
  if (!st.enabled) { wrap.append(h('p', { class: 'small muted' }, 'Off: all ports forward immediately. If the network has a loop, broadcasts circle endlessly.')); return wrap; }
  const prios = []; for (let p = 0; p <= 61440; p += 4096) prios.push([p, String(p) + (p === 32768 ? ' (default)' : '')]);
  const timers = st.timers === 'schnell' ? 'fast' : st.timers;
  wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
    h('span', { class: 'small' }, 'Protocol'), select([['stp', 'STP, classic (802.1D)'], ['rstp', 'RSTP, rapid (802.1w)']], st.mode || 'stp', v => { upd(() => st.mode = v, `${dev.name}: ${v.toUpperCase()}`); rerender?.(); }),
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
      const ps = dev.bridge.stp?.ports.get(p);
      g.append(h('span', { class: 'if' }, p), cost, h('label', { class: 'row small' }, edge, ps?.edgeLost ? 'BPDU received, edge lost' : dev.bridge.stp?.rstp && ps?.legacy ? 'neighbor speaks only STP' : ''));
    }
    wrap.append(g);
  }
  wrap.append(h('p', { class: 'small muted' }, st.mode === 'rstp'
    ? 'Cost 4 corresponds to 1 Gbit/s, 19 to 100 Mbit/s. RSTP negotiates ports between switches in milliseconds. Ports to end devices still need the edge setting, otherwise they wait 2 × forward delay.'
    : 'Cost 4 corresponds to 1 Gbit/s, 19 to 100 Mbit/s. Edge ports for end devices go to Forwarding immediately.'));
  return wrap;
}

function servicesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
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
  const draw = () => {
    wrap.innerHTML = '';
    if (!c.services.some(s => s.proto === 'udp' && Number(s.port) === 53)) wrap.append(h('p', { class: 'small', style: { color: 'var(--warn)', marginTop: 0 } }, 'No DNS service on UDP 53: add it under Services, otherwise nobody can ask.'));
    const zone = h('input', { class: 'input mono', value: c.dnsZone || '', placeholder: 'none', spellcheck: 'false' });
    zone.addEventListener('change', () => upd(() => c.dnsZone = zone.value.trim().toLowerCase(), `${dev.name}: zone ${zone.value.trim() || 'none'}`));
    wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '120px 1fr' } }, h('span', {}, 'Authoritative for'), zone),
      h('p', { class: 'small muted', style: { margin: '4px 0 8px' } }, 'A zone like firma.lab, lab or . (the root). The server then answers every name in it: from its records, with a referral (NS) for delegated parts, or NXDOMAIN. Names outside the zone are refused. Empty: it only answers the names below.'));
    const list = h('div', { class: 'list' });
    c.dns.forEach((r, idx) => {
      const type = r.type || 'A';
      const name = h('input', { class: 'input mono', value: r.name, placeholder: 'www.firma.lab', spellcheck: 'false' });
      name.addEventListener('change', () => upd(() => r.name = name.value.trim().toLowerCase(), `${dev.name}: DNS ${name.value}`));
      const isAddr = type === 'A' || type === 'AAAA';
      let data;
      if (isAddr) {
        data = h('input', { class: 'input mono', value: r.ip || '', placeholder: type === 'A' ? '10.0.0.10' : '2001:db8::10', spellcheck: 'false' });
        data.addEventListener('change', () => { const v = data.value.trim(); upd(() => r.ip = v, `${dev.name}: DNS ${r.name} → ${v}`); });
      } else {
        data = h('input', { class: 'input mono', value: r.value || '', placeholder: type === 'NS' ? 'ns1.firma.lab' : 'www.firma.lab', spellcheck: 'false' });
        data.addEventListener('change', () => upd(() => r.value = data.value.trim().toLowerCase(), `${dev.name}: DNS ${r.name} ${type} ${data.value}`));
      }
      const ttl = numInput(r.ttl ?? 300, 1, 604800, v => upd(() => r.ttl = v ?? 300, `${dev.name}: TTL ${r.name} ${v}`), '300');
      ttl.title = 'TTL in seconds: how long others may cache the answer';
      list.append(h('div', { class: 'item' }, h('div', { class: 'row dnsrow' },
        h('span', { class: 'grp grow' }, name, select(['A', 'AAAA', 'NS', 'CNAME'].map(t => [t, t]), type, v => { upd(() => { r.type = v; if (v === 'A' || v === 'AAAA') delete r.value; else delete r.ip; }, `${dev.name}: ${r.name} type ${v}`); draw(); })),
        h('span', { class: 'grp grow' }, data, h('span', { class: 'small muted' }, 'TTL'), ttl,
          h('button', { class: 'btn icon ghost', title: 'Remove entry', html: I.trash, onclick: () => { upd(() => c.dns.splice(idx, 1), `${dev.name}: DNS entry removed`); draw(); } })))));
    });
    if (!c.dns.length) list.append(h('div', { class: 'empty' }, 'No entries. Every query ends with NXDOMAIN.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Entry', onclick: () => { upd(() => c.dns.push({ name: 'new.lab', type: 'A', ip: '', ttl: 300 }), `${dev.name}: DNS entry`); draw(); } }),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'A: name to IPv4 address. AAAA: to IPv6 address. NS: who is responsible for a zone (with an A record for that server as glue). CNAME: the name is an alias for another name.'));
  };
  draw();
  return wrap;
}
function resolverEditor(dev, upd, rerender) {
  const c = dev.cfg, r = c.recursion;
  const roots = h('input', { class: 'input mono', value: r.roots || '', placeholder: '198.41.0.4', spellcheck: 'false' });
  roots.addEventListener('change', () => upd(() => r.roots = roots.value.trim(), `${dev.name}: root hints ${roots.value.trim() || 'none'}`));
  const cache = dev.l3.resolverSvc?.dump() || [];
  return h('div', {},
    h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: r.enabled ? true : null, onchange: e => { upd(() => r.enabled = e.target.checked, `${dev.name}: resolver ${e.target.checked ? 'on' : 'off'}`); rerender?.(); } }), 'Resolve recursively for others'),
    h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '120px 1fr', marginTop: '6px' } }, h('span', {}, 'Root hints'), roots),
    h('p', { class: 'small muted', style: { margin: '4px 0 8px' } }, 'Where the resolver starts when it knows nothing yet: the addresses of the root servers. Every answer is kept in the cache for its TTL.'),
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', { class: 'small' }, `Cache (${plural(cache.length, 'entry').replace('entrys', 'entries')})`),
      h('button', { class: 'btn ghost', onclick: () => { runCommand(dev, 'unbound-control flush_all'); rerender?.(); } }, 'Flush cache')),
    cache.length ? h('table', { class: 'tbl' }, h('tr', {}, ['Name', 'Type', 'Data', 'TTL left'].map(x => h('th', {}, x))),
      cache.map(e => h('tr', {}, [e.name || '.', e.type, e.data, `${e.ttl} s`].map(x => h('td', { class: 'mono small' }, x))))) : h('div', { class: 'empty' }, 'Empty'));
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
      dst.addEventListener('change', () => { if (!parseCidr(dst.value) && !parseCidr6(dst.value)) return dst.classList.add('bad'); dst.classList.remove('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: route ${dst.value}`); });
      const six = !!parseCidr6(r.dst) && !parseCidr(r.dst);
      const act = six ? dev.l3.v6.routes().find(x => x.proto === 'S' && x.via === (isIp6(r.via) ? norm6(r.via) : r.via) && x.net === parseCidr6(r.dst).net)
        : dev.l3.routes().find(x => x.proto === 'S' && x.via === r.via && parseCidr(r.dst) && x.net === parseCidr(r.dst).net);
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, dst, h('span', { class: 'small muted' }, 'via'),
          ipInput(r.via, v => upd(() => r.via = v, `${dev.name}: next hop ${v}`), 'Next hop', true),
          (() => { const d = numInput(r.distance ?? '', 1, 255, v => upd(() => { if (!v || v === 1) delete r.distance; else r.distance = v; }, `${dev.name}: route ${r.dst} distance ${v ?? 1}`), '1');
            d.title = 'Distance (administrative distance): lower wins. A backup route with e.g. 200 is only used when the main route is gone.'; d.setAttribute('aria-label', 'Distance'); return d; })(),
          h('button', { class: 'btn icon ghost', title: 'Remove route', html: I.trash, onclick: () => { upd(() => c.routes.splice(idx, 1), `${dev.name}: route removed`); draw(); } })),
        c.bfd?.enabled ? (() => { const cb = h('input', { type: 'checkbox', checked: r.bfd ? true : null });
          cb.addEventListener('change', () => upd(() => { if (cb.checked) r.bfd = true; else delete r.bfd; }, `${dev.name}: BFD for route ${r.dst} ${cb.checked ? 'on' : 'off'}`));
          return h('label', { class: 'row small' }, cb, 'Watch the next hop with BFD, withdraw the route when it fails'); })() : null,
        act && !act.dev ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, act.bfdDown ? 'Inactive: BFD says the next hop is gone' : 'Inactive: the next hop is not in any directly connected network') : null));
    });
    if (!c.routes.length) list.append(h('div', { class: 'empty' }, 'None. The device knows directly connected networks on its own.'));
    if (c.ipv6?.enabled) list.append(h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'IPv6 routes go here too: 2001:db8:2::/64 via 2001:db8:12::2, or ::/0 for the default route.'));
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
    wrap.append(h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Rules for forwarded packets. From top to bottom, the first matching rule applies. If none matches, the packet is forwarded.'));
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

// ---------------------------------------------------------------- NAT, DHCP, VRRP, OSPF
const ifaceNames = dev => Object.keys(dev.cfg.ifaces).filter(n => n !== 'lo');
const small = t => h('span', { class: 'small muted' }, t);

function advancedEditor(dev, upd) {
  const c = dev.cfg;
  const fw = h('input', { type: 'checkbox', checked: c.forwarding !== false ? true : null });
  fw.addEventListener('change', () => upd(() => c.forwarding = fw.checked, `${dev.name}: forwarding ${fw.checked ? 'on' : 'off'}`));
  const clamp = numInput(c.mssClamp, 536, 9000, v => upd(() => c.mssClamp = v, `${dev.name}: MSS clamping ${v ?? 'off'}`), 'off');
  clamp.style.width = '90px';
  return h('div', {},
    h('label', { class: 'row', style: { fontSize: '.88rem' } }, fw, 'IP forwarding (net.ipv4.ip_forward = 1)'),
    h('div', { class: 'row', style: { marginTop: '6px', fontSize: '.88rem' } }, 'MSS clamping', clamp, small('lowers the MSS in forwarded SYN segments')));
}

function natEditor(dev, upd, rerender) {
  const n = dev.cfg.nat;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    const out = select([['', 'none (NAT off)'], ...ifaceNames(dev).map(x => [x, x])], n.outside, v => { upd(() => n.outside = v, `${dev.name}: NAT outside ${v || 'off'}`); rerender?.(); });
    const masq = h('input', { type: 'checkbox', checked: n.masquerade !== false ? true : null });
    masq.addEventListener('change', () => upd(() => n.masquerade = masq.checked, `${dev.name}: masquerade ${masq.checked ? 'on' : 'off'}`));
    wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr' } }, h('span', { class: 'small' }, 'Outside interface'), out),
      h('label', { class: 'row small', style: { marginTop: '6px' } }, masq, 'Masquerade: inside hosts share the outside address'),
      h('h4', {}, 'Port forwards'));
    const list = h('div', { class: 'list' });
    n.forwards.forEach((f, idx) => {
      const proto = select([['tcp', 'TCP'], ['udp', 'UDP']], f.proto || 'tcp', v => upd(() => f.proto = v, `${dev.name}: forward ${idx + 1}`));
      const port = numInput(f.port, 1, 65535, v => upd(() => f.port = v, `${dev.name}: forward port ${v}`), 'port'); port.style.width = '76px';
      const to = ipInput(f.to, v => upd(() => f.to = v, `${dev.name}: forward to ${v}`), 'inside IP');
      const toPort = numInput(f.toPort, 1, 65535, v => upd(() => f.toPort = v, `${dev.name}: forward to port ${v}`), 'port'); toPort.style.width = '76px';
      proto.style.width = '70px';
      // Two halves (outside → inside) that stay together when the panel is narrow
      list.append(h('div', { class: 'item' }, h('div', { class: 'row' },
        h('span', { class: 'grp' }, proto, port, small('→')),
        h('span', { class: 'grp grow' }, to, toPort,
          h('button', { class: 'btn icon ghost', title: 'Remove port forward', html: I.trash, onclick: () => { upd(() => n.forwards.splice(idx, 1), `${dev.name}: forward removed`); draw(); } })))));
    });
    if (!n.forwards.length) list.append(h('div', { class: 'empty' }, 'None. Connections from outside only reach inside hosts through a port forward.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Port forward', onclick: () => { n.forwards.push({ proto: 'tcp', port: 8080, to: '', toPort: 80 }); draw(); } }),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Packets leaving through the outside interface get the router\'s address as source. Answers are translated back using the table (conntrack -L).'));
  };
  draw();
  return wrap;
}

function ecmpEditor(dev, upd) {
  const c = dev.cfg;
  return h('div', {},
    h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '120px 1fr' } },
      h('span', { class: 'small' }, 'Equal paths used'), select([1, 2, 4, 8].map(n => [n, n === 1 ? '1 (ECMP off)' : String(n) + (n === 4 ? ' (default)' : '')]), c.maxPaths, v => upd(() => c.maxPaths = Number(v), `${dev.name}: maximum ${v} paths`)),
      h('span', { class: 'small' }, 'Hash over'), select([['l3', 'Addresses (L3, Linux default)'], ['l4', 'Addresses and ports (L4)']], c.ecmpHash, v => upd(() => c.ecmpHash = v, `${dev.name}: ECMP hash ${v.toUpperCase()}`))),
    h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'When several routes to a network are equally good (same prefix, same source, same metric), the router uses all of them. A hash over each packet picks the path, so a flow always stays on one path and its packets do not overtake each other.'));
}

function bfdEditor(dev, upd, rerender) {
  const b = dev.cfg.bfd;
  const on = h('input', { type: 'checkbox', checked: b.enabled ? true : null });
  on.addEventListener('change', () => { upd(() => b.enabled = on.checked, `${dev.name}: BFD ${on.checked ? 'on' : 'off'}`); rerender?.(); });
  const ospf = h('input', { type: 'checkbox', checked: b.ospf ? true : null });
  ospf.addEventListener('change', () => upd(() => b.ospf = ospf.checked, `${dev.name}: BFD for OSPF ${ospf.checked ? 'on' : 'off'}`));
  const t = dev.bfd?.table() || [];
  return h('div', {},
    h('label', { class: 'row', style: { fontSize: '.88rem' } }, on, 'BFD enabled'),
    b.enabled ? h('div', {},
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '120px 1fr', marginTop: '6px' } },
        h('span', { class: 'small' }, 'Interval (ms)'), numInput(b.interval, 50, 10000, v => upd(() => b.interval = v ?? 300, `${dev.name}: BFD interval ${v} ms`)),
        h('span', { class: 'small' }, 'Multiplier'), numInput(b.mult, 2, 50, v => upd(() => b.mult = v ?? 3, `${dev.name}: BFD multiplier ${v}`))),
      h('label', { class: 'row small', style: { marginTop: '6px' } }, ospf, 'Watch the OSPF neighbors'),
      h('p', { class: 'small muted', style: { margin: '4px 0 0' } }, 'Static routes get a BFD checkbox above. Both neighbors must run BFD.'),
      t.length ? h('table', { class: 'rtable', style: { marginTop: '8px' } }, h('tr', {}, h('th', {}, 'Peer'), h('th', {}, 'Port'), h('th', {}, 'State')), t.map(x => h('tr', {}, h('td', {}, x.peer), h('td', {}, x.ifname), h('td', {}, x.state)))) : null) : null,
    h('p', { class: 'small muted', style: { marginTop: '6px' } }, `Every ${b.interval || 300} ms a control packet; after ${(b.interval || 300) * (b.mult || 3)} ms without one the neighbor counts as gone.`));
}

function relayEditor(dev, upd) {
  const c = dev.cfg;
  const rows = ifaceNames(dev).filter(n => isIp(c.ifaces[n].ip));
  const g = h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '64px 1fr' } });
  for (const n of rows) g.append(h('span', { class: 'if' }, n), ipInput(c.ifaces[n].helper, v => upd(() => c.ifaces[n].helper = v, `${dev.name} ${n}: DHCP relay ${v || 'off'}`), 'DHCP server IP'));
  return h('div', {}, h('h4', { style: { marginTop: 0 } }, 'Relay (ip helper-address)'),
    rows.length ? g : h('div', { class: 'empty' }, 'Give the interfaces an address first.'),
    h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'DHCP broadcasts do not cross routers. With a helper address the router forwards them to the server and marks which network they came from (giaddr).'));
}

function dhcpServerEditor(dev, upd) {
  const s = dev.cfg.dhcpServer;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    const on = h('input', { type: 'checkbox', checked: s.enabled ? true : null });
    on.addEventListener('change', () => { upd(() => s.enabled = on.checked, `${dev.name}: DHCP server ${on.checked ? 'on' : 'off'}`); draw(); });
    wrap.append(h('h4', {}, 'DHCP server'), h('label', { class: 'row small' }, on, 'Hand out addresses (UDP port 67)'));
    if (!s.enabled) return;
    const list = h('div', { class: 'list', style: { marginTop: '6px' } });
    s.pools.forEach((p, idx) => {
      const f = (label, key, ph) => h('label', { class: 'field' }, label, ipInput(p[key], v => upd(() => p[key] = v, `${dev.name}: pool ${label} ${v}`), ph));
      const net = h('input', { class: 'input mono', value: p.net || '', placeholder: '10.10.0.0/24' });
      net.addEventListener('change', () => { if (!parseCidr(net.value)) return net.classList.add('bad'); net.classList.remove('bad'); upd(() => p.net = net.value.trim(), `${dev.name}: pool ${net.value}`); });
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('label', { class: 'field grow' }, 'Network', net),
          h('button', { class: 'btn icon ghost', title: 'Remove pool', html: I.trash, onclick: () => { upd(() => s.pools.splice(idx, 1), `${dev.name}: pool removed`); draw(); } })),
        h('div', { class: 'cfg-grid vx' }, f('First address', 'from', '10.10.0.100'), f('Last address', 'to', '10.10.0.199'), f('Gateway', 'router', '10.10.0.1'), f('DNS server', 'dns', 'optional'))));
    });
    if (!s.pools.length) list.append(h('div', { class: 'empty' }, 'No pool yet. A pool is a range of addresses for one network.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Pool', onclick: () => { s.pools.push({ net: '', from: '', to: '', router: '', dns: '', lease: 3600 }); draw(); } }),
      h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'The server picks the pool by the network the request came from: its own interface, or the relay\'s giaddr.'));
  };
  draw();
  return wrap;
}

function vrrpEditor(dev, upd, rerender) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    const state = dev.vrrp?.table() || [];
    const list = h('div', { class: 'list' });
    c.vrrp.forEach((g, idx) => {
      const st = state.find(x => x.ifname === g.ifname && x.vrid === Number(g.vrid));
      const ifs = select(ifaceNames(dev).map(x => [x, x]), g.ifname, v => upd(() => g.ifname = v, `${dev.name}: VRRP interface ${v}`));
      const vrid = numInput(g.vrid, 1, 255, v => upd(() => g.vrid = v ?? 1, `${dev.name}: VRRP group ${v}`)); vrid.style.width = '64px';
      const prio = numInput(g.priority ?? 100, 1, 254, v => upd(() => g.priority = v ?? 100, `${dev.name}: VRRP priority ${v}`)); prio.style.width = '70px';
      const pre = h('input', { type: 'checkbox', checked: g.preempt !== false ? true : null });
      pre.addEventListener('change', () => upd(() => g.preempt = pre.checked, `${dev.name}: preempt ${pre.checked ? 'on' : 'off'}`));
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'small' }, `Group ${g.vrid}`), st ? h('span', { class: 'chip' + (st.state === 'master' ? ' on' : '') }, st.state) : null, h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'Remove group', html: I.trash, onclick: () => { upd(() => c.vrrp.splice(idx, 1), `${dev.name}: VRRP group removed`); rerender?.(); } })),
        h('div', { class: 'cfg-grid vx' }, h('label', { class: 'field' }, 'Interface', ifs), h('label', { class: 'field' }, 'Group (VRID)', vrid),
          h('label', { class: 'field' }, 'Virtual IP', ipInput(g.vip, v => upd(() => g.vip = v, `${dev.name}: virtual IP ${v}`), '10.0.0.1')), h('label', { class: 'field' }, 'Priority', prio)),
        h('label', { class: 'row small' }, pre, 'Preempt: take over again when this router has the higher priority')));
    });
    if (!c.vrrp.length) list.append(h('div', { class: 'empty' }, 'No group. With VRRP, two routers share one gateway address, and one takes over when the other fails.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Group', onclick: () => { upd(() => c.vrrp.push({ ifname: ifaceNames(dev).find(n => isIp(c.ifaces[n].ip)) || 'eth1', vrid: 1, vip: '', priority: 100, preempt: true }), `${dev.name}: VRRP group added`); draw(); } }));
  };
  draw();
  return wrap;
}

function ospfEditor(dev, upd, rerender) {
  const o = dev.cfg.ospf;
  const wrap = h('div');
  const on = h('input', { type: 'checkbox', checked: o.enabled ? true : null });
  on.addEventListener('change', () => { upd(() => o.enabled = on.checked, `${dev.name}: OSPF ${on.checked ? 'on' : 'off'}`); rerender?.(); });
  wrap.append(h('label', { class: 'row small' }, on, 'OSPF enabled (area 0)'));
  if (!o.enabled) { wrap.append(h('p', { class: 'small muted' }, 'Routers running OSPF find each other with hellos, exchange their links and compute the shortest paths themselves.')); return wrap; }
  wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
    h('span', { class: 'small' }, 'Router ID'), ipInput(o.rid, v => upd(() => o.rid = v, `${dev.name}: router ID ${v || 'auto'}`), `auto (${dev.ospf?.rid || '-'})`),
    h('span', { class: 'small' }, 'Timers'), select([['fast', 'Fast for the lab (hello 1, dead 4)'], ['standard', 'Standard (hello 10, dead 40)']], o.timers || 'fast', v => upd(() => o.timers = v, `${dev.name}: OSPF timers ${v}`))));
  const g = h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '54px 52px 70px 1fr', marginTop: '8px' } },
    small('Port'), small('OSPF'), small('Cost'), small('Passive'));
  for (const n of Object.keys(dev.cfg.ifaces)) {
    if (!isIp(dev.cfg.ifaces[n].ip)) continue;
    // The entry is only created on the first change, so rendering never alters the configuration
    const ic = o.ifaces[n] || { enabled: false, cost: 10, passive: false };
    const set = (k, v, msg) => upd(() => { ic[k] = v; o.ifaces[n] = ic; }, msg);
    const en = h('input', { type: 'checkbox', checked: ic.enabled ? true : null });
    en.addEventListener('change', () => set('enabled', en.checked, `${dev.name} ${n}: OSPF ${en.checked ? 'on' : 'off'}`));
    const cost = numInput(ic.cost ?? 10, 1, 65535, v => set('cost', v ?? 10, `${dev.name} ${n}: OSPF cost ${v}`));
    const pas = h('input', { type: 'checkbox', checked: ic.passive ? true : null, disabled: n === 'lo' ? true : null });
    pas.addEventListener('change', () => set('passive', pas.checked, `${dev.name} ${n}: passive ${pas.checked ? 'on' : 'off'}`));
    g.append(h('span', { class: 'if' }, n), en, cost, pas);
  }
  const nb = dev.ospf?.neighborTable() || [];
  wrap.append(g, h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'An enabled interface is advertised. Passive: advertised, but no hellos are sent (for LANs with only hosts).'),
    h('h4', {}, 'Neighbors'), nb.length ? h('dl', { class: 'kv' }, ...nb.flatMap(n => [h('dt', {}, `${n.rid}`), h('dd', {}, `${n.state} via ${n.ifname}`)])) : h('div', { class: 'empty' }, 'None yet.'));
  return wrap;
}

// ---------------------------------------------------------------- Tables
const addrList = v => (Array.isArray(v) ? v : String(v || '').split(/[\s,]+/)).filter(Boolean).join(', ');
function addrInput(ifc, dev, upd, ifname) {
  const i = h('input', { class: 'input mono', value: addrList(ifc.ip6), placeholder: '2001:db8:1::1/64', spellcheck: 'false' });
  i.addEventListener('change', () => {
    const parts = i.value.split(/[\s,]+/).filter(Boolean);
    if (parts.some(x => !parseCidr6(x.includes('/') ? x : x + '/64') || !isIp6(x.split('/')[0]))) { i.classList.add('bad'); return; }
    i.classList.remove('bad');
    upd(() => { ifc.ip6 = parts.map(x => `${norm6(x.split('/')[0])}/${x.split('/')[1] || 64}`); }, `${dev.name} ${ifname}: IPv6 ${parts.join(', ') || 'removed'}`);
  });
  return i;
}
function v6AddrTable(dev, names) {
  const rows = names.flatMap(n => dev.l3.v6.addrs(n).map(a => [n, `${a.ip}/${a.len}`, a.scope === 'link' ? 'link-local' : a.origin === 'slaac' ? 'SLAAC' : 'static', a.state === 'preferred' ? 'ok' : a.state === 'duplicate' ? 'duplicate!' : 'testing (DAD)']));
  return rows.length ? h('table', { class: 'tbl' }, h('tr', {}, ['Port', 'Address', 'From', 'State'].map(x => h('th', {}, x))), rows.map(r => h('tr', {}, r.map(x => h('td', { class: 'mono small' }, x))))) : h('div', { class: 'empty' }, 'No addresses yet');
}
function ipv6HostEditor(dev, upd, rerender) {
  const c = dev.cfg, v6 = dev.l3.v6, ifc = c.ifaces.eth1;
  const r = [...v6.routers.values()][0];
  return h('div', {},
    h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: c.ipv6.enabled ? true : null, onchange: e => { upd(() => c.ipv6.enabled = e.target.checked, `${dev.name}: IPv6 ${e.target.checked ? 'on' : 'off'}`); rerender?.(); } }), 'IPv6 on'),
    h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: c.ipv6.slaac !== false ? true : null, onchange: e => upd(() => c.ipv6.slaac = e.target.checked, `${dev.name}: SLAAC ${e.target.checked ? 'on' : 'off'}`) }), 'Take an address from router advertisements (SLAAC)'),
    h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '120px 1fr', marginTop: '6px' } },
      h('span', {}, 'Static addresses'), addrInput(ifc, dev, upd, 'eth1'),
      h('span', {}, 'IPv6 gateway'), ipInput(c.ipv6.gw, v => { if (v && !isIp6(v)) return; upd(() => c.ipv6.gw = v, `${dev.name}: IPv6 gateway ${v || 'removed'}`); }, 'from the RA, or e.g. 2001:db8:1::1', true)),
    h('p', { class: 'small muted', style: { margin: '6px 0' } }, 'Every IPv6 interface has a link-local address fe80::… from its MAC. With SLAAC the host builds a global address from the prefix in the router advertisement and the same interface ID (EUI-64).'),
    v6AddrTable(dev, v6.ifnames()),
    h('dl', { class: 'kv', style: { marginTop: '8px' } }, h('dt', {}, 'Default router'), h('dd', { class: 'mono' }, r ? `${r.ip} (RA)` : c.ipv6.gw || 'none'),
      h('dt', {}, 'DNS from RA'), h('dd', { class: 'mono' }, v6.rdnss.join(', ') || 'none')));
}
function ipv6RouterEditor(dev, upd, sim, rerender) {
  const c = dev.cfg, v6 = c.ipv6;
  const names = PORTS.router.filter(n => sim.linkAt(dev.id, n) || staticAddrs(c.ifaces[n]).length);
  const g = h('div', { class: 'list' });
  for (const n of names) {
    const ra = h('input', { type: 'checkbox', checked: (v6.ra || []).includes(n) ? true : null });
    ra.addEventListener('change', () => upd(() => { v6.ra = (v6.ra || []).filter(x => x !== n); if (ra.checked) v6.ra.push(n); }, `${dev.name} ${n}: router advertisements ${ra.checked ? 'on' : 'off'}`));
    g.append(h('div', { class: 'item' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'if mono', style: { width: '44px' } }, n), addrInput(c.ifaces[n], dev, upd, n),
      h('label', { class: 'row small', title: 'Send router advertisements on this port: hosts take the prefix (SLAAC) and this router as their gateway' }, ra, 'RA'))));
  }
  const rd = h('input', { class: 'input mono', value: v6.rdnss || '', placeholder: 'optional, e.g. 2001:db8:2::53', spellcheck: 'false' });
  rd.addEventListener('change', () => upd(() => v6.rdnss = rd.value.trim(), `${dev.name}: RDNSS ${rd.value.trim() || 'removed'}`));
  return h('div', {},
    h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: v6.enabled ? true : null, onchange: e => { upd(() => v6.enabled = e.target.checked, `${dev.name}: IPv6 ${e.target.checked ? 'on' : 'off'}`); rerender?.(); } }), 'IPv6 on (routes IPv6 too)'),
    h('p', { class: 'small muted', style: { margin: '6px 0' } }, 'Addresses per port, separated by commas. Check RA to advertise the /64 prefixes of that port to the hosts (SLAAC). IPv6 routes go into the static routes above.'),
    g, h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '120px 1fr', marginTop: '6px' } }, h('span', {}, 'DNS in the RA'), rd),
    h('div', { style: { marginTop: '8px' } }, v6AddrTable(dev, dev.l3.v6.ifnames())));
}

function wgEditor(dev, upd, rerender) {
  const c = dev.cfg, w = c.wg;
  c.ifaces.wg0 ??= { ip: '', prefix: 24 };
  const pub = wgPubKey(w.privateKey);
  const keyIn = (val, onSet, ph) => {
    const i = h('input', { class: 'input mono', value: val || '', placeholder: ph, spellcheck: 'false' });
    i.addEventListener('change', () => { const v = i.value.trim(); if (v && !isWgKey(v)) { i.classList.add('bad'); return; } i.classList.remove('bad'); onSet(v); });
    return i;
  };
  const list = h('div', { class: 'list' });
  (w.peers || []).forEach((p, idx) => {
    const field = (k, ph) => { const i = h('input', { class: 'input mono', value: p[k] ?? '', placeholder: ph, spellcheck: 'false' }); i.addEventListener('change', () => upd(() => p[k] = i.value.trim(), `${dev.name}: peer ${p.name || idx + 1} ${k}`)); return i; };
    const st = dev.wg.table().find(x => x.publicKey === p.publicKey);
    list.append(h('div', { class: 'item' },
      h('div', { class: 'row' }, h('span', { class: 'grp grow' }, field('name', 'name, e.g. gwB'), h('span', { class: 'small muted' }, st?.up ? `handshake ${st.handshake} s ago` : 'no handshake yet')),
        h('button', { class: 'btn icon ghost', title: 'Remove peer', html: I.trash, onclick: () => { upd(() => w.peers.splice(idx, 1), `${dev.name}: peer removed`); rerender?.(); } })),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '4px' } },
        h('span', {}, 'Public key'), keyIn(p.publicKey, v => upd(() => p.publicKey = v, `${dev.name}: peer ${p.name} key`), 'the public key of the peer'),
        h('span', {}, 'Endpoint'), field('endpoint', 'ip:port, empty = wait for it'),
        h('span', {}, 'Allowed IPs'), field('allowedIps', '10.2.0.0/24, 10.99.0.2/32'),
        h('span', {}, 'Keepalive (s)'), field('keepalive', '0 = off, 25 behind NAT'))));
  });
  if (!(w.peers || []).length) list.append(h('div', { class: 'empty' }, 'No peers yet: nobody to talk to.'));
  return h('div', {},
    h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: w.enabled ? true : null, onchange: e => { upd(() => w.enabled = e.target.checked, `${dev.name}: WireGuard ${e.target.checked ? 'on' : 'off'}`); rerender?.(); } }), 'Interface wg0 on'),
    h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr 70px', marginTop: '6px' } },
      h('span', {}, 'Address wg0'), ipInput(c.ifaces.wg0.ip, v => upd(() => c.ifaces.wg0.ip = v, `${dev.name}: wg0 ${v}`), '10.99.0.1'), numInput(c.ifaces.wg0.prefix, 0, 32, v => upd(() => c.ifaces.wg0.prefix = v ?? 24, `${dev.name}: wg0 /${v}`)),
      h('span', {}, 'Listen port'), numInput(w.listenPort, 1, 65535, v => upd(() => w.listenPort = v ?? 51820, `${dev.name}: WireGuard port ${v}`), '51820'), h('span'),
      h('span', {}, 'MTU'), numInput(w.mtu, 576, 9000, v => upd(() => w.mtu = v ?? 1420, `${dev.name}: wg0 MTU ${v}`), '1420'), h('span')),
    h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
      h('span', {}, 'Private key'), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, keyIn(w.privateKey, v => upd(() => w.privateKey = v, `${dev.name}: private key`), 'secret, never leaves this device'),
        h('button', { class: 'btn', title: 'wg genkey', onclick: () => { upd(() => w.privateKey = wgGenKey(dev.id + Date.now()), `${dev.name}: new key pair`); rerender?.(); } }, 'New')),
      h('span', {}, 'Public key'), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('code', { class: 'small', style: { wordBreak: 'break-all' } }, pub || '(no private key)'),
        pub ? h('button', { class: 'btn ghost', title: 'Copy the public key, to paste it at the peer', onclick: () => navigator.clipboard?.writeText(pub) }, 'Copy') : null)),
    h('p', { class: 'small muted', style: { margin: '6px 0' } }, 'Give your public key to the peer and enter its public key here. Allowed IPs work both ways: packets to these networks go into the tunnel to this peer, and only packets from these addresses are accepted from it.'),
    h('h4', {}, 'Peers'), list,
    h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Peer', onclick: () => { upd(() => (w.peers ||= []).push({ name: '', publicKey: '', endpoint: '', allowedIps: '', keepalive: 0 }), `${dev.name}: new peer`); rerender?.(); } }));
}

export function tablesPanel(dev, sim) {
  const box = h('div');
  const tbl = (head, rows) => {
    if (!rows.length) return h('div', { class: 'empty' }, '(empty)');
    return h('table', { class: 'tbl' }, h('tr', {}, head.map(x => h('th', {}, x))), rows.map(r => h('tr', {}, r.map(x => h('td', {}, x ?? '')))));
  };
  if (dev.l3) {
    box.append(h('h4', {}, 'Routing table'),
      tbl(['Destination', 'via', 'dev', ''], dev.l3.routes().map(r => [`${r.net}/${r.len}`, r.via || 'direct', r.dev || '–', r.proto === 'C' ? 'C' : r.proto === 'O' ? `O ${r.metric}` : r.dhcp ? 'DHCP' : (r.dev ? (r.bfd ? 'S, BFD' : 'S') : r.bfdDown ? 'S, BFD down' : 'S inactive')])));
    if (dev.l3.v6.on) {
      box.append(h('h4', {}, 'IPv6 routes'), tbl(['Destination', 'via', 'dev', ''], dev.l3.v6.routes().map(r => [`${r.net}/${r.len}`, r.via || 'direct', r.dev || '–', { C: 'C', K: 'C (SLAAC)', S: r.dev ? 'S' : 'S inactive', RA: 'RA' }[r.proto]])));
      box.append(h('h4', {}, 'IPv6 neighbors (NDP)'), tbl(['IPv6', 'MAC', 'dev', 'State'], dev.l3.v6.neighborTable().map(e => [e.ip, e.mac || '–', e.ifname, e.state + (e.router ? ', router' : '')])));
    }
    box.append(h('h4', {}, 'ARP table'),
      tbl(['IP', 'MAC', 'dev', 'State'], dev.l3.arpTable().map(e => [e.ip, e.mac || '–', e.ifname, e.state])));
    if (dev.l3.pmtu.size) box.append(h('h4', {}, 'Learned path MTU'), tbl(['Destination', 'MTU'], [...dev.l3.pmtu].map(([k, v]) => [k, v])));
    const conns = [...dev.l3.tcp.values()];
    if (conns.length) box.append(h('h4', {}, 'TCP connections'), tbl(['State', 'Local', 'Peer'], conns.map(c => [c.state, `:${c.lport}`, `${c.rip}:${c.rport}`])));
    if (dev.l3.lease) box.append(h('h4', {}, 'DHCP lease'), h('dl', { class: 'kv' }, h('dt', {}, 'Address'), h('dd', { class: 'mono' }, `${dev.l3.lease.ip}/${dev.l3.lease.prefix}`),
      h('dt', {}, 'From server'), h('dd', { class: 'mono' }, dev.l3.lease.server), h('dt', {}, 'Lease'), h('dd', {}, `${dev.l3.lease.lease} s`)));
    if (dev.cfg.dhcpServer?.enabled) box.append(h('h4', {}, 'DHCP leases handed out'), tbl(['IP', 'MAC', 'State'], [...dev.l3.dhcpLeases].map(([m, l]) => [l.ip, m, l.state])));
    if (dev.cfg.nat?.outside) box.append(h('h4', {}, 'NAT translations'), tbl(['Inside', 'Outside', 'Remote'], dev.l3.natTable.map(e => [`${e.inIp}:${e.inPort}`, `${e.outIp}:${e.outPort}`, `${e.remIp}:${e.remPort}`])));
    if (dev.vrrp?.groups.length) box.append(h('h4', {}, 'VRRP'), tbl(['Group', 'Port', 'Virtual IP', 'State', 'Prio'], dev.vrrp.table().map(g => [g.vrid, g.ifname, g.vip, g.state, g.prio])));
    if (dev.bfd?.table().length) box.append(h('h4', {}, 'BFD sessions'), tbl(['Peer', 'Port', 'State', 'For'], dev.bfd.table().map(x => [x.peer, x.ifname, x.state, x.clients.join(', ')])));
    if (dev.ospf?.enabled) box.append(h('h4', {}, 'OSPF neighbors'), tbl(['Router ID', 'Address', 'Port', 'State'], dev.ospf.neighborTable().map(n => [n.rid, n.ip, n.ifname, n.state])));
    if (dev.wg?.on) box.append(h('h4', {}, 'WireGuard peers'), tbl(['Peer', 'Endpoint', 'Allowed IPs', 'Handshake'], dev.wg.table().map(x => [x.name || shortKey(x.publicKey), x.endpoint, x.allowed, x.handshake === null ? 'none' : `${x.handshake} s ago`])));
    if (dev.cfg.recursion?.enabled) box.append(h('h4', {}, 'DNS cache'), tbl(['Name', 'Type', 'Data', 'TTL left'], (dev.l3.resolverSvc?.dump() || []).map(e => [e.name || '.', e.type, e.data, `${e.ttl} s`])));
    if (dev.cfg.services?.length) box.append(h('h4', {}, 'Listening services'), tbl(['Proto', 'Port', 'Service'], dev.cfg.services.map(s => [s.proto.toUpperCase(), s.port, s.name || ''])));
  }
  if (dev.type === 'switch') {
    const t = dev.bridge.stpTable();
    if (t) {
      box.append(h('h4', {}, t.mode === 'rstp' ? 'Rapid spanning tree (RSTP)' : 'Spanning tree (STP)'),
        h('dl', { class: 'kv' }, h('dt', {}, 'Root'), h('dd', { class: 'mono' }, t.root + (t.isRoot ? ' (this bridge)' : '')),
          h('dt', {}, 'Bridge'), h('dd', { class: 'mono' }, t.bridge),
          ...(t.isRoot ? [] : [h('dt', {}, 'Root port'), h('dd', {}, `${t.rootPort}, cost ${t.rootCost}`)])),
        tbl(['Port', 'Role', 'State', 'Cost'], t.ports.map(p => [p.port + (p.edge ? ' (edge)' : p.legacy ? ' (STP neighbor)' : ''), STP_TEXT.ROLE[p.role], STP_TEXT.STATE[p.state], p.cost])));
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
  const stop = h('button', { class: 'btn danger-soft hidden', title: 'Stop the running command (Ctrl+C)', onclick: () => { dev.interrupt(); draw(); input.focus(); } }, 'Stop');
  const draw = () => {
    pre.textContent = dev.consoleLines.join('\n') || 'Type help for an overview of the commands.';
    pre.scrollTop = pre.scrollHeight;
    stop.classList.toggle('hidden', !dev.running().length);
  };
  const input = h('input', { class: 'input', placeholder: dev.l3 ? 'e.g. ping 192.168.20.20' : 'e.g. bridge fdb', spellcheck: 'false', autocomplete: 'off' });
  const hist = []; let hi = 0;
  const run = cmd => { if (!cmd.trim()) return; hist.push(cmd); hi = hist.length; runCommand(dev, cmd); draw(); };
  input.addEventListener('keydown', e => {
    // Ctrl+C stops a running command, unless text is selected for copying
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd) {
      if (dev.interrupt()) { e.preventDefault(); input.value = ''; draw(); }
      return;
    }
    if (e.key === 'Enter') { run(input.value); input.value = ''; }
    if (e.key === 'ArrowUp' && hi > 0) { input.value = hist[--hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
  });
  const quick = h('div', { class: 'quick' });
  const defaults = dev.l3 ? ['help', 'ip addr', 'ip route', 'ip neigh', 'ip neigh flush'] : ['help', 'bridge fdb', 'bridge fdb flush'];
  if (dev.type === 'switch') defaults.push('show spanning-tree');
  if (dev.type === 'pc' || dev.type === 'server') defaults.push('ss -tuln');
  for (const q of [...presets, ...defaults]) quick.append(h('button', { class: 'btn', onclick: () => run(q) }, q));
  draw();
  const el = h('div', { class: 'console' }, pre, h('div', { class: 'in' }, input, stop, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; input.focus(); } }, 'Run')), quick);
  el.refresh = draw;
  el.focusInput = () => input.focus();
  return el;
}
