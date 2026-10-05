// Seitenpanel: Konfiguration, Tabellen und Konsole eines Geräts
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

// ---------------------------------------------------------------- Konfiguration
export function configPanel(dev, ctx) {
  const { sim, changed, locked, rerender } = ctx;
  const c = dev.cfg;
  const box = h('div');
  const upd = (fn, msg) => { fn(); changed(msg); };
  if (locked) box.append(h('div', { class: 'hint' }, 'In diesem Schritt ist die Konfiguration gesperrt. Beobachte das Netz und nutze Konsole und Tabellen.'));

  if (c.type === 'pc' || c.type === 'server') {
    const i = c.ifaces.eth1;
    box.append(h('h4', {}, 'Netzwerkkarte eth1'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr' } },
        h('span', {}, 'IP-Adresse'), ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name}: IP ${v || 'entfernt'}`), '192.168.10.10'),
        h('span', {}, 'Präfix'), numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name}: Präfix /${v}`)),
        h('span', {}, 'Gateway'), ipInput(c.gw, v => upd(() => c.gw = v, `${dev.name}: Gateway ${v || 'entfernt'}`), 'leer = keins'),
        h('span', {}, 'VLAN-Tag'), numInput(i.vlan, 1, 4094, v => upd(() => i.vlan = v, `${dev.name}: VLAN-Tag ${v ?? 'aus'}`), 'kein Tag')),
      h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', {}, 'MAC'), h('dd', {}, dev.mac('eth1'))),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Ein VLAN-Tag sendet alle Frames mit 802.1Q-Tag, wie ein Subinterface eth1.10 unter Linux. Ohne Tag passt der Host an einen Access-Port.'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr', marginTop: '8px' } },
        h('span', {}, 'DNS-Server'), ipInput(c.resolver, v => upd(() => c.resolver = v, `${dev.name}: DNS-Server ${v || 'entfernt'}`), 'für curl/ping mit Namen')));
    box.append(servicesEditor(dev, upd), dnsEditor(dev, upd));
  }

  if (c.type === 'router' || c.type === 'vtep') {
    const names = c.type === 'router' ? [...PORTS.router, 'lo'] : ['eth1', 'lo'];
    box.append(h('h4', {}, c.type === 'vtep' ? 'Underlay (Layer 3)' : 'Interfaces'));
    const g = h('div', { class: 'cfg-grid' });
    for (const n of names) {
      const i = c.ifaces[n];
      const linked = n === 'lo' || !!sim.linkAt(dev.id, n);
      g.append(h('span', { class: 'if', title: linked ? 'verbunden' : 'nicht verbunden' }, n + (linked ? '' : ' ○')),
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'keine IP'}`), n === 'lo' ? 'Loopback' : ''),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)));
    }
    box.append(g);
    if (c.type === 'router') box.append(subifEditor(dev, upd, sim, rerender));
    if (c.type === 'router') {
      const fw = h('input', { type: 'checkbox', checked: c.forwarding !== false ? true : null });
      fw.addEventListener('change', () => upd(() => c.forwarding = fw.checked, `${dev.name}: Forwarding ${fw.checked ? 'an' : 'aus'}`));
      box.append(h('label', { class: 'row', style: { marginTop: '10px', fontSize: '.88rem' } }, fw, 'IP-Forwarding (net.ipv4.ip_forward = 1)'));
      const clamp = numInput(c.mssClamp, 536, 9000, v => upd(() => c.mssClamp = v, `${dev.name}: MSS Clamping ${v ?? 'aus'}`), 'aus');
      clamp.style.width = '90px';
      box.append(h('div', { class: 'row', style: { marginTop: '6px', fontSize: '.88rem' } }, 'MSS Clamping', clamp,
        h('span', { class: 'small muted' }, 'kürzt die MSS in weitergeleiteten SYN-Segmenten')));
    }
    box.append(routesEditor(dev, upd));
    if (c.type === 'router') box.append(aclEditor(dev, upd));
  }

  if (c.type === 'switch' || c.type === 'vtep') {
    box.append(h('h4', {}, c.type === 'vtep' ? 'Lokale Bridge-Ports' : 'Ports'));
    const ports = c.type === 'switch' ? PORTS.switch : ['eth2', 'eth3', 'eth4'];
    const shown = ports.filter(p => sim.linkAt(dev.id, p));
    if (!shown.length) box.append(h('div', { class: 'empty' }, 'Noch kein Port verbunden.'));
    const g = h('div', { class: 'cfg-grid ports' });
    for (const p of shown) {
      const pc = c.ports[p];
      const vl = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } });
      const drawVl = () => {
        vl.innerHTML = '';
        if (pc.mode === 'trunk') {
          const al = h('input', { class: 'input mono', value: pc.allowed ?? '1-4094', title: 'Erlaubte VLANs, z. B. 10,20 oder 1-4094', style: { width: '78px' } });
          al.addEventListener('change', () => upd(() => pc.allowed = al.value.trim() || '1-4094', `${dev.name} ${p}: erlaubt ${al.value}`));
          vl.append(al, h('span', { class: 'small muted' }, 'nativ'), numInput(pc.native, 1, 4094, v => upd(() => pc.native = v, `${dev.name} ${p}: natives VLAN ${v ?? 'keins'}`), '–'));
          vl.lastChild.style.width = '58px';
        } else {
          const n = numInput(pc.vlan ?? 1, 1, 4094, v => upd(() => pc.vlan = v ?? 1, `${dev.name} ${p}: VLAN ${v}`));
          n.style.width = '74px';
          vl.append(h('span', { class: 'small muted' }, 'VLAN'), n);
        }
      };
      drawVl();
      g.append(h('span', { class: 'if' }, p),
        select([['access', 'Access'], ['trunk', 'Trunk']], pc.mode, v => { upd(() => pc.mode = v, `${dev.name} ${p}: ${v === 'trunk' ? 'Trunk' : 'Access'}`); drawVl(); }),
        vl);
    }
    box.append(g);
    box.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 90px', marginTop: '10px' } },
      h('span', { class: 'small' }, 'Aging-Zeit der MAC-Tabelle (s), 0 = lernt nichts'),
      numInput(c.ageing, 0, 3600, v => upd(() => c.ageing = v ?? 300, `${dev.name}: Aging ${v} s`))));
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
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('b', { class: 'mono small' }, n), h('span', { class: 'small muted' }, `Tag ${i.vlan} auf ${i.parent}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'Subinterface entfernen', html: I.trash, onclick: () => { upd(() => delete c.ifaces[n], `${dev.name}: ${n} entfernt`); rerender?.(); } })),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 70px' } },
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'keine IP'}`), '10.10.0.1'),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)))));
  }
  if (!subs.length) list.append(h('div', { class: 'empty' }, 'Keine. Ein Subinterface sendet und empfängt Frames mit einem bestimmten VLAN-Tag, so routet ein Router zwischen VLANs über ein einziges Kabel (Router-on-a-Stick).'));
  const parent = select(PORTS.router.map(p => [p, p]), PORTS.router.find(p => sim.linkAt(dev.id, p)) || 'eth1', () => {});
  const vid = h('input', { class: 'input mono', type: 'number', min: 1, max: 4094, placeholder: 'VLAN', style: { width: '80px' } });
  const add = h('button', { class: 'btn', html: I.plus + ' Anlegen', onclick: () => {
    const v = Math.round(Number(vid.value)), par = parent.value;
    if (!(v >= 1 && v <= 4094)) return vid.classList.add('bad');
    const name = `${par}.${v}`;
    if (c.ifaces[name]) return vid.classList.add('bad');
    upd(() => { c.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 }; }, `${dev.name}: ${name} angelegt`);
    rerender?.();
  } });
  wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } }, parent, vid, add),
    h('p', { class: 'small muted' }, 'Das physische Interface braucht dafür keine eigene IP. Am Switch muss der Port ein Trunk sein, der diese VLANs erlaubt.'));
  return wrap;
}

function stpEditor(dev, upd, sim, shown, rerender) {
  const c = dev.cfg, st = c.stp;
  const wrap = h('div');
  const on = h('input', { type: 'checkbox', checked: st.enabled ? true : null });
  on.addEventListener('change', () => { upd(() => st.enabled = on.checked, `${dev.name}: Spanning Tree ${on.checked ? 'an' : 'aus'}`); rerender?.(); });
  wrap.append(h('h4', {}, 'Spanning Tree (802.1D)'),
    h('label', { class: 'row', style: { fontSize: '.88rem' } }, on, 'Spanning Tree aktiv'));
  if (!st.enabled) { wrap.append(h('p', { class: 'small muted' }, 'Aus: Alle Ports leiten sofort weiter. Gibt es eine Schleife im Netz, kreisen Broadcasts endlos.')); return wrap; }
  const prios = []; for (let p = 0; p <= 61440; p += 4096) prios.push([p, String(p) + (p === 32768 ? ' (Standard)' : '')]);
  wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
    h('span', { class: 'small' }, 'Bridge-Priorität'), select(prios, st.priority, v => upd(() => st.priority = Number(v), `${dev.name}: Priorität ${v}`)),
    h('span', { class: 'small' }, 'Timer'), select([['standard', 'Standard (Hello 2, Forward Delay 15, Max Age 20)'], ['schnell', 'Schnell fürs Labor (1 / 4 / 6)']], st.timers, v => upd(() => st.timers = v, `${dev.name}: Timer ${v}`))));
  const b = dev.bridge.stpTable();
  if (b) wrap.append(h('dl', { class: 'kv', style: { marginTop: '8px' } }, h('dt', {}, 'Bridge ID'), h('dd', { class: 'mono' }, b.bridge), h('dt', {}, 'Root'), h('dd', { class: 'mono' }, b.isRoot ? 'diese Bridge' : `${b.root} via ${b.rootPort}, Kosten ${b.rootCost}`)));
  if (shown.length) {
    const g = h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '50px 80px 1fr', marginTop: '8px' } }, h('span', { class: 'small muted' }, 'Port'), h('span', { class: 'small muted' }, 'Kosten'), h('span', { class: 'small muted' }, 'Edge (PortFast)'));
    for (const p of shown) {
      const pc = c.ports[p];
      const edge = h('input', { type: 'checkbox', checked: pc.edge ? true : null });
      edge.addEventListener('change', () => upd(() => pc.edge = edge.checked, `${dev.name} ${p}: PortFast ${edge.checked ? 'an' : 'aus'}`));
      const cost = numInput(pc.cost ?? 4, 1, 200000000, v => upd(() => pc.cost = v ?? 4, `${dev.name} ${p}: Kosten ${v}`));
      g.append(h('span', { class: 'if' }, p), cost, h('label', { class: 'row small' }, edge, dev.bridge.stp?.ports.get(p)?.edgeLost ? 'BPDU empfangen, Edge verloren' : ''));
    }
    wrap.append(g);
  }
  wrap.append(h('p', { class: 'small muted' }, `Kosten 4 entspricht 1 Gbit/s, 19 entspricht 100 Mbit/s. Edge-Ports für Endgeräte gehen sofort auf Forwarding.`));
  return wrap;
}

function servicesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Dienste (lauschende Ports)'));
    const list = h('div', { class: 'list' });
    c.services.forEach((sv, idx) => {
      const name = h('input', { class: 'input', value: sv.name || '', placeholder: 'Name', style: { minWidth: 0, flex: '1 1 0' } });
      name.addEventListener('change', () => upd(() => sv.name = name.value.trim(), `${dev.name}: Dienst ${name.value}`));
      const port = numInput(sv.port, 1, 65535, v => upd(() => sv.port = v ?? sv.port, `${dev.name}: Port ${v}`));
      port.style.width = '78px';
      const size = numInput(sv.size, 0, 100000, v => upd(() => sv.size = v ?? 0, `${dev.name}: Antwort ${v} Byte`), 'Byte');
      size.style.width = '90px';
      const proto = select([['tcp', 'TCP'], ['udp', 'UDP']], sv.proto, v => { upd(() => sv.proto = v, `${dev.name}: ${v}`); draw(); });
      proto.style.width = '74px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, proto, port, name,
          h('button', { class: 'btn icon ghost', title: 'Dienst entfernen', html: I.trash, onclick: () => { upd(() => c.services.splice(idx, 1), `${dev.name}: Dienst entfernt`); draw(); } })),
        sv.proto === 'tcp' ? h('div', { class: 'row small muted', style: { flexWrap: 'nowrap' } }, 'Antwort', size, 'Byte') : null));
    });
    if (!c.services.length) list.append(h('div', { class: 'empty' }, 'Kein Dienst. Eine TCP-Verbindung wird mit RST abgelehnt, UDP mit ICMP Port Unreachable.'));
    wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn', html: I.plus + ' Webserver (TCP 80)', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 80, name: 'http', size: 2000 }), `${dev.name}: Webserver`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' DNS (UDP 53)', onclick: () => { upd(() => c.services.push({ proto: 'udp', port: 53, name: 'dns' }), `${dev.name}: DNS-Dienst`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' Anderer', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 8080, name: 'app', size: 500 }), `${dev.name}: Dienst`); draw(); } })),
    h('p', { class: 'small muted' }, 'Bei TCP gibt Byte an, wie gross die Antwort ist. Sie wird in Segmente der Grösse MSS zerlegt.'));
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
    wrap.append(h('h4', {}, 'DNS-Einträge (A-Records)'));
    const list = h('div', { class: 'list' });
    c.dns.forEach((r, idx) => {
      const name = h('input', { class: 'input mono', value: r.name, placeholder: 'web.lab' });
      name.addEventListener('change', () => upd(() => r.name = name.value.trim().toLowerCase(), `${dev.name}: DNS ${name.value}`));
      list.append(h('div', { class: 'item' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('span', { class: 'small muted' }, 'A'),
        ipInput(r.ip, v => upd(() => r.ip = v, `${dev.name}: DNS ${r.name} → ${v}`), '10.0.0.10'),
        h('button', { class: 'btn icon ghost', title: 'Eintrag entfernen', html: I.trash, onclick: () => { upd(() => c.dns.splice(idx, 1), `${dev.name}: DNS-Eintrag entfernt`); draw(); } }))));
    });
    if (!c.dns.length) list.append(h('div', { class: 'empty' }, 'Keine Einträge. Jede Anfrage endet mit NXDOMAIN.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Eintrag', onclick: () => { upd(() => c.dns.push({ name: 'neu.lab', ip: '' }), `${dev.name}: DNS-Eintrag`); draw(); } }));
  };
  draw();
  return wrap;
}

function routesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Statische Routen'));
    const list = h('div', { class: 'list' });
    c.routes.forEach((r, idx) => {
      const dst = h('input', { class: 'input mono', value: r.dst, placeholder: '10.0.0.0/24' });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); dst.classList.remove('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: Route ${dst.value}`); });
      const act = dev.l3.routes().find(x => x.proto === 'S' && x.via === r.via && parseCidr(r.dst) && x.net === parseCidr(r.dst).net);
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, dst, h('span', { class: 'small muted' }, 'via'),
          ipInput(r.via, v => upd(() => r.via = v, `${dev.name}: Next Hop ${v}`), 'Next Hop'),
          h('button', { class: 'btn icon ghost', title: 'Route entfernen', html: I.trash, onclick: () => { upd(() => c.routes.splice(idx, 1), `${dev.name}: Route entfernt`); draw(); } })),
        act && !act.dev ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, 'Inaktiv: Next Hop liegt in keinem direkt angeschlossenen Netz') : null));
    });
    if (!c.routes.length) list.append(h('div', { class: 'empty' }, 'Keine. Direkt angeschlossene Netze kennt das Gerät von selbst.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Route hinzufügen',
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
    wrap.append(h('h4', {}, 'Regeln für weitergeleitete Pakete'),
      h('p', { class: 'small muted' }, 'Von oben nach unten, die erste passende Regel gilt. Passt keine, wird weitergeleitet.'));
    const list = h('div', { class: 'list' });
    c.acl.forEach((r, idx) => {
      const src = h('input', { class: 'input mono', value: r.src || 'any', placeholder: 'any' });
      const dst = h('input', { class: 'input mono', value: r.dst || 'any', placeholder: 'any' });
      src.addEventListener('change', () => { if (!parseCidr(src.value)) return src.classList.add('bad'); upd(() => r.src = src.value.trim(), `${dev.name}: Regel ${idx + 1}`); });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: Regel ${idx + 1}`); });
      const type = numInput(r.icmpType, 0, 255, v => upd(() => r.icmpType = v, `${dev.name}: Regel ${idx + 1}`), 'alle');
      const portIn = (rr, i) => { const n = numInput(rr.port, 1, 65535, v => upd(() => rr.port = v, `${dev.name}: Regel ${i + 1} Port ${v ?? 'alle'}`), 'alle'); n.style.width = '84px'; return n; };
      type.style.width = '64px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'small' }, `#${idx + 1}`),
          select([['allow', 'erlauben'], ['drop', 'verwerfen'], ['reject', 'ablehnen']], r.action, v => upd(() => r.action = v, `${dev.name}: Regel ${idx + 1}`)),
          select([['any', 'alle Protokolle'], ['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP']], r.proto || 'any', v => { upd(() => r.proto = v, `${dev.name}: Regel ${idx + 1}`); draw(); }),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'nach oben', html: I.up, disabled: idx === 0 ? true : null, onclick: () => { upd(() => c.acl.splice(idx - 1, 0, c.acl.splice(idx, 1)[0]), `${dev.name}: Reihenfolge`); draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'Regel entfernen', html: I.trash, onclick: () => { upd(() => c.acl.splice(idx, 1), `${dev.name}: Regel entfernt`); draw(); } })),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'small muted' }, 'von'), src, h('span', { class: 'small muted' }, 'an'), dst),
        (r.proto === 'icmp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'ICMP-Typ'), type, h('span', { class: 'small muted' }, '0 Reply, 3 Unreachable, 8 Request, 11 TTL')) : null,
        (r.proto === 'tcp' || r.proto === 'udp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Zielport'), portIn(r, idx), h('span', { class: 'small muted' }, 'leer = alle Ports')) : null,
        r.action === 'reject' ? h('div', { class: 'small muted' }, r.proto === 'tcp' ? 'Ablehnen beantwortet ein SYN mit TCP RST.' : 'Ablehnen sendet ICMP «administratively prohibited» an den Absender.') : null));
    });
    if (!c.acl.length) list.append(h('div', { class: 'empty' }, 'Keine Regeln, alles wird weitergeleitet.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Regel hinzufügen',
      onclick: () => { upd(() => c.acl.push({ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }), `${dev.name}: Regel hinzugefügt`); draw(); } }));
  };
  draw();
  return wrap;
}

function vxlanEditor(dev, upd, sim) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'VXLAN-Segmente'));
    const list = h('div', { class: 'list' });
    c.vxlans.forEach((m, idx) => {
      const flood = h('input', { class: 'input mono', value: (m.flood || []).join(', '), placeholder: '10.255.0.2' });
      flood.addEventListener('change', () => {
        const ips = flood.value.split(/[,\s]+/).filter(Boolean);
        if (ips.some(x => !isIp(x))) return flood.classList.add('bad');
        flood.classList.remove('bad'); upd(() => m.flood = ips, `${dev.name}: Flood-Liste ${ips.join(', ') || 'leer'}`);
      });
      const learn = h('input', { type: 'checkbox', checked: m.learning !== false ? true : null });
      learn.addEventListener('change', () => upd(() => m.learning = learn.checked, `${dev.name}: Learning ${learn.checked ? 'an' : 'aus'}`));
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'mono small' }, `vxlan${m.vni}`), h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'Segment entfernen', html: I.trash, onclick: () => { upd(() => c.vxlans.splice(idx, 1), `${dev.name}: Segment entfernt`); draw(); } })),
        h('div', { class: 'cfg-grid vx' },
          h('label', { class: 'field' }, 'VNI', numInput(m.vni, 1, 16777215, v => { upd(() => m.vni = v, `${dev.name}: VNI ${v}`); draw(); })),
          h('label', { class: 'field' }, 'Lokales VLAN', numInput(m.vlan, 1, 4094, v => upd(() => m.vlan = v, `${dev.name}: VLAN ${v}`))),
          h('label', { class: 'field' }, 'UDP-Zielport', numInput(m.dstport ?? 4789, 1, 65535, v => upd(() => m.dstport = v ?? 4789, `${dev.name}: Port ${v}`))),
          h('label', { class: 'field' }, `MTU (auto ${dev.vxlanMtu({ ...m, mtu: null })})`, numInput(m.mtu, 68, 9000, v => upd(() => m.mtu = v, `${dev.name}: VXLAN-MTU ${v ?? 'auto'}`), 'auto'))),
        h('label', { class: 'field' }, 'Flood-Liste (entfernte VTEPs)', flood),
        h('label', { class: 'row small' }, learn, 'MAC-Adressen aus dem Tunnel lernen (Flood and Learn)')));
    });
    if (!c.vxlans.length) list.append(h('div', { class: 'empty' }, 'Kein Segment. Ein Segment verbindet ein lokales VLAN mit einem VNI.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Segment hinzufügen',
      onclick: () => { upd(() => c.vxlans.push({ vni: 10000 + (c.vxlans.length + 1) * 10, vlan: (c.vxlans.length + 1) * 10, flood: [], dstport: 4789, learning: true }), `${dev.name}: Segment hinzugefügt`); draw(); } }),
    h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Tunnel-Quelle: ${dev.localIp() || '(keine Adresse)'}. Die MTU passt Linux automatisch an: MTU von eth1 minus 50.`));
  };
  draw();
  return wrap;
}

// ---------------------------------------------------------------- Tabellen
export function tablesPanel(dev, sim) {
  const box = h('div');
  const tbl = (head, rows) => {
    if (!rows.length) return h('div', { class: 'empty' }, '(leer)');
    return h('table', { class: 'tbl' }, h('tr', {}, head.map(x => h('th', {}, x))), rows.map(r => h('tr', {}, r.map(x => h('td', {}, x ?? '')))));
  };
  if (dev.l3) {
    box.append(h('h4', {}, 'Routing-Tabelle'),
      tbl(['Ziel', 'via', 'dev', ''], dev.l3.routes().map(r => [`${r.net}/${r.len}`, r.via || 'direkt', r.dev || '–', r.proto === 'C' ? 'C' : (r.dev ? 'S' : 'S inaktiv')])));
    box.append(h('h4', {}, 'ARP-Tabelle'),
      tbl(['IP', 'MAC', 'dev', 'Zustand'], dev.l3.arpTable().map(e => [e.ip, e.mac || '–', e.ifname, e.state])));
    if (dev.l3.pmtu.size) box.append(h('h4', {}, 'Gelernte Path MTU'), tbl(['Ziel', 'MTU'], [...dev.l3.pmtu].map(([k, v]) => [k, v])));
    const conns = [...dev.l3.tcp.values()];
    if (conns.length) box.append(h('h4', {}, 'TCP-Verbindungen'), tbl(['Zustand', 'Lokal', 'Gegenstelle'], conns.map(c => [c.state, `:${c.lport}`, `${c.rip}:${c.rport}`])));
    if (dev.cfg.services?.length) box.append(h('h4', {}, 'Lauschende Dienste'), tbl(['Proto', 'Port', 'Dienst'], dev.cfg.services.map(s => [s.proto.toUpperCase(), s.port, s.name || ''])));
  }
  if (dev.type === 'switch') {
    const t = dev.bridge.stpTable();
    if (t) {
      box.append(h('h4', {}, 'Spanning Tree'),
        h('dl', { class: 'kv' }, h('dt', {}, 'Root'), h('dd', { class: 'mono' }, t.root + (t.isRoot ? ' (diese Bridge)' : '')),
          h('dt', {}, 'Bridge'), h('dd', { class: 'mono' }, t.bridge),
          ...(t.isRoot ? [] : [h('dt', {}, 'Root-Port'), h('dd', {}, `${t.rootPort}, Kosten ${t.rootCost}`)])),
        tbl(['Port', 'Rolle', 'Zustand', 'Kosten'], t.ports.map(p => [p.port + (p.edge ? ' (Edge)' : ''), STP_TEXT.ROLE_DE[p.role], STP_TEXT.STATE_DE[p.state], p.cost])));
    }
  }
  if (dev.bridge) {
    box.append(h('h4', {}, 'MAC-Tabelle'),
      tbl(['VLAN', 'MAC', 'Port', 'Alter'], dev.bridge.table().map(e => [e.vid, e.mac, e.remote ? `${e.port} → ${e.remote}` : e.port, e.age.toFixed(1) + ' s'])));
  }
  if (dev.type === 'vtep') {
    box.append(h('h4', {}, 'VXLAN'), tbl(['Interface', 'VLAN', 'Port', 'MTU', 'Flood'],
      dev.maps().map(m => [`vxlan${m.vni}`, m.vlan, m.dstport || 4789, dev.vxlanMtu(m), (m.flood || []).join(', ') || '(leer)'])));
  }
  return box;
}

// ---------------------------------------------------------------- Konsole
export function consolePanel(dev, sim, presets = []) {
  const pre = h('pre', { 'aria-live': 'polite' });
  const draw = () => { pre.textContent = dev.consoleLines.join('\n') || 'Tippe help für eine Übersicht der Befehle.'; pre.scrollTop = pre.scrollHeight; };
  draw();
  const input = h('input', { class: 'input', placeholder: dev.l3 ? 'z. B. ping 192.168.20.20' : 'z. B. bridge fdb', spellcheck: 'false', autocomplete: 'off' });
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
  const el = h('div', { class: 'console' }, pre, h('div', { class: 'in' }, input, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; input.focus(); } }, 'Ausführen')), quick);
  el.refresh = draw;
  el.focusInput = () => input.focus();
  return el;
}
