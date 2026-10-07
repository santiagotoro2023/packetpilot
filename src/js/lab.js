// Lab: network diagram editor, animation, side panel, log and inspector
import { Sim, PORTS, TYPE_NAMES, TIMING, newId, normalizeDevice, traceOf, STP_TEXT, isHello } from './engine.js';

// BPDUs, VRRP advertisements and OSPF hellos repeat all the time and can be hidden together
const isCtl = f => f.type === 'stp' || isHello(f);
import { layerKinds, shortLabel, flowOf, summary } from './packets.js';
import { isIp } from './net.js';
import { h, svgEl, toast, iconBtn, resizer, contextMenu } from './ui.js';
import { store } from './store.js';
import { I, DEV_ICON } from './icons.js';
import { renderInspector } from './inspector.js';
import { configPanel, tablesPanel, consolePanel } from './panels.js';

const CARD_W = 76, CARD_H = 60;
const NAME_PREFIX = { pc: 'pc', server: 'srv', router: 'r', switch: 'sw', vtep: 'vtep' };
export const ZONE_COLORS = [['blue', 'Blue'], ['violet', 'Violet'], ['green', 'Green'], ['orange', 'Orange'], ['pink', 'Pink'], ['yellow', 'Yellow'], ['gray', 'Gray']];
const KIND_COLOR = { vlan: 'violet', overlay: 'pink', underlay: 'blue' };
export const zoneColor = z => z.color || KIND_COLOR[z.kind] || 'gray';

// Kinds of changes the learner makes, they can be undone
const EDITS = ['config', 'added', 'deleted', 'linked', 'moved', 'renamed'];
// Log entries without a frame that belong to a tracked conversation (results, state changes)
const TRACK_TAGS = { dhcp: /^dhcp/, dns: /^dns/, tcp: /^(tcp|http|curl)/, udp: /^udp/, icmp: /^(ping|echo|trace|pmtu)/, arp: /^(arp|neigh)/ };

export class Lab {
  /**
   * @param {HTMLElement} root
   * @param {object} opts { topo, edit: 'full'|'config'|'view', palette: [...types], compact, onEvent, consolePresets }
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = { edit: 'full', palette: ['pc', 'server', 'switch', 'router', 'vtep'], ...opts };
    this.listeners = new Set();
    if (opts.onEvent) this.listeners.add(opts.onEvent);
    this.sel = null; this.connectFrom = null; this.connectMode = false;
    this.playing = true; this.msPerHop = opts.msPerHop || Number(store.prefs.speed) || 550; this.lastTs = 0; this.idleUntil = 0;
    this.track = null; this.flowSel = null; this.trackRaw = false; this.logFilter = 'all'; this.selectedLog = null; this.showBpdu = true;
    this.view = { x: 0, y: 0, w: 900, h: 520 };
    this.pktEls = new Map();
    this.tab = 'config';
    this.build();
    this.load(opts.topo || { name: 'New network', devices: [], links: [] }, true);
    this.raf = requestAnimationFrame(t => this.loop(t));
    this.keyHandler = e => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.fsHandler = () => { this.syncFull(); this.fit(true); };
    document.addEventListener('fullscreenchange', this.fsHandler);
    this.ro = new ResizeObserver(() => { this.fit(false); this.placeHandles(); });
    this.ro.observe(this.canvasWrap);
    this.ro.observe(this.el);
  }
  emit(type, data) {
    if (EDITS.includes(type)) this.noteEdit();
    for (const fn of this.listeners) fn(type, data, this);
  }

  // ------------------------------------------------------------ Undo and redo (Ctrl+Z, Ctrl+Y)
  // After every edit the network is stored as a snapshot. Undo puts the previous snapshot
  // back into the running simulation: devices, cables, areas and configuration.
  snapTopo() { return JSON.stringify(this.sim.topo); }
  resetHistory() { clearTimeout(this.histTimer); this.histTimer = null; this.undoStack = [this.snapTopo()]; this.redoStack = []; }
  noteEdit() {
    if (this.restoring || !this.undoStack) return;
    clearTimeout(this.histTimer);
    this.histTimer = setTimeout(() => this.captureEdit(), 250);
  }
  captureEdit() {
    clearTimeout(this.histTimer); this.histTimer = null;
    const snap = this.snapTopo();
    if (snap === this.undoStack[this.undoStack.length - 1]) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.canConfig && !this.canEditTopo) return;
    if (this.histTimer) this.captureEdit();
    if (this.undoStack.length < 2) return toast('Nothing to undo');
    this.redoStack.push(this.undoStack.pop());
    this.applyTopo(JSON.parse(this.undoStack[this.undoStack.length - 1]));
    toast('Undone (Ctrl+Y redoes it)');
  }
  redo() {
    if (!this.redoStack?.length) return toast('Nothing to redo');
    const snap = this.redoStack.pop();
    this.undoStack.push(snap);
    this.applyTopo(JSON.parse(snap));
    toast('Redone');
  }
  applyTopo(t) {
    const sim = this.sim, cur = sim.topo;
    this.restoring = true;
    try {
      for (const l of [...cur.links]) if (!t.links.some(x => x.id === l.id)) sim.removeLink(l.id);
      for (const d of [...cur.devices]) if (!t.devices.some(x => x.id === d.id)) sim.removeDevice(d.id);
      for (const td of t.devices) {
        const d = cur.devices.find(x => x.id === td.id);
        if (!d) { sim.addDevice(normalizeDevice(td)); continue; }
        if (JSON.stringify(d) === JSON.stringify(td)) continue;
        for (const k of Object.keys(d)) if (!(k in td)) delete d[k];
        Object.assign(d, td);
        sim.configChanged(d.id);
      }
      for (const tl of t.links) {
        const l = cur.links.find(x => x.id === tl.id);
        if (!l) { sim.addLink(tl); continue; }
        const wasUp = l.up;
        Object.assign(l, tl, { up: wasUp });
        if (wasUp !== tl.up) sim.setLinkUp(l, tl.up);
      }
      cur.zones = t.zones || [];
      cur.name = t.name;
      sim.emit('config', null);
    } finally { this.restoring = false; }
    const exists = this.sel && (this.sel.kind === 'dev' ? cur.devices.some(d => d.id === this.sel.id) : this.sel.kind === 'link' ? cur.links.some(l => l.id === this.sel.id) : (cur.zones || []).some(z => z.id === this.sel.id));
    if (!exists) this.select(null); else this.renderSide();
    this.render();
    for (const fn of this.listeners) fn('config', { msg: 'undo' }, this);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('fullscreenchange', this.fsHandler);
    if (document.fullscreenElement && document.fullscreenElement === this.fullTarget()) document.exitFullscreen?.();
    this.fullTarget().classList.remove('pseudo-full');
    this.ro.disconnect();
    this.unsub?.();
    this.root.innerHTML = '';
  }
  get canEditTopo() { return this.opts.edit === 'full'; }
  get canConfig() { return this.opts.edit !== 'view'; }

  // ------------------------------------------------------------ Structure
  build() {
    const o = this.opts;
    this.root.innerHTML = '';
    this.el = h('div', { class: `lab${o.compact ? ' compact' : ''}${this.canEditTopo ? '' : ' no-palette'}` });
    // Palette
    this.palette = h('div', { class: 'palette', 'aria-label': 'Devices' });
    if (this.canEditTopo) {
      for (const t of o.palette) {
        const it = h('button', { class: 'pal-item', draggable: 'true', title: `Add ${TYPE_NAMES[t]} (drag or click)` },
          h('span', { html: `<svg viewBox="0 0 40 40">${DEV_ICON[t]}</svg>` }), TYPE_NAMES[t]);
        it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pp-device', t); e.dataTransfer.effectAllowed = 'copy'; });
        it.addEventListener('click', () => this.addDevice(t));
        this.palette.append(it);
      }
      this.palette.append(h('div', { class: 'pal-sep' }));
      this.cableBtn = h('button', { class: 'pal-item', title: 'Draw a cable: click one device, then the second (key K)', html: `<span>${I.cable}</span>Cable`,
        onclick: () => this.setConnect(!this.connectMode) });
      this.palette.append(this.cableBtn);
      const area = h('button', { class: 'pal-item', draggable: 'true', title: 'Area for organizing: colored rectangle with a label (drag or click)', html: `<span>${I.area}</span>Area` });
      area.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pp-device', 'zone'); e.dataTransfer.effectAllowed = 'copy'; });
      area.addEventListener('click', () => this.addZone());
      this.palette.append(area);
    }
    // Canvas
    this.canvasWrap = h('div', { class: 'canvas-wrap' });
    this.svg = svgEl('svg', { class: `net${this.canEditTopo ? '' : ' ro'}`, role: 'img', 'aria-label': 'Network diagram' });
    // Labels of cables (interface names, MTU, STP dots) lie above all cables, so no cable crosses a name
    this.gZones = svgEl('g'); this.gLinks = svgEl('g'); this.gLinkLbl = svgEl('g', { class: 'lnk-lbls' }); this.gDevs = svgEl('g'); this.gPkts = svgEl('g');
    this.svg.append(this.gZones, this.gLinks, this.gLinkLbl, this.gDevs, this.gPkts);
    this.canvasWrap.append(this.svg);
    this.bindCanvas();
    // Player
    this.playBtn = iconBtn(I.pause, 'Pause (space)', () => this.setPlaying(!this.playing));
    this.timeEl = h('span', { class: 'time' }, 't = 0.0000 s');
    const speed = h('input', { type: 'range', min: '0', max: '100', value: String(this.speedToSlider(this.msPerHop)), 'aria-label': 'Speed' });
    this.speedLbl = h('span', { class: 'speedlbl' });
    // The speed is remembered for every lab and lesson
    speed.addEventListener('input', () => { this.msPerHop = this.sliderToSpeed(Number(speed.value)); this.showSpeed(); });
    speed.addEventListener('change', () => store.setPref('speed', this.msPerHop));
    this.showSpeed();
    this.player = h('div', { class: 'player' },
      h('div', { class: 'bar' }, this.playBtn,
        iconBtn(I.step, 'Next event (right arrow)', () => this.stepOnce()),
        iconBtn(I.ffwd, 'Fast-forward 5 seconds without animation (e.g. for STP timers)', () => this.fastForward(5000)),
        iconBtn(I.reset, 'Reset state: clear tables, packets and log', () => this.resetState()),
        this.timeEl),
      h('div', { class: 'bar' }, h('span', { class: 'speedlbl', style: { paddingLeft: '6px' } }, 'Speed'), speed, this.speedLbl),
      this.bpduBar = h('div', { class: 'bar hidden' }, this.bpduBtn = h('button', { class: 'tog on', title: 'Show or hide the periodic control messages (BPDUs, hellos) in the network diagram', onclick: () => this.toggleBpdu() }, 'BPDUs')),
      h('span', { class: 'grow' }),
      h('div', { class: 'bar' }, iconBtn(I.fit, 'Fit the network into the view', () => this.fit(true)),
        this.fullBtn = iconBtn(I.full, 'Fullscreen (F)', () => this.toggleFull())));
    this.canvasWrap.append(this.player);
    this.overlay = h('div', { class: 'hint-overlay hidden' });
    this.stormEl = h('div', { class: 'storm hidden', role: 'alert' });
    this.canvasWrap.append(this.overlay, this.stormEl);
    // Side panel
    this.side = h('div', { class: 'side' });
    // Dock
    this.logEl = h('div', { class: 'log', role: 'log' });
    this.filterSel = h('select', { class: 'input', 'aria-label': 'Filter log' });
    this.filterSel.addEventListener('change', () => { this.logFilter = this.filterSel.value; if (this.logFilter !== 'track') this.stopTrack(); this.renderLog(); });
    this.inspEl = h('div', { class: 'inspector' });
    this.dock = h('div', { class: 'dock' },
      h('div', { class: 'dock-col' }, h('div', { class: 'dock-head' }, 'Events', h('span', { class: 'grow' }), this.filterSel,
        iconBtn(I.trash, 'Clear log', () => { this.sim.log = []; this.renderLog(); })), this.logEl),
      h('div', { class: 'dock-col' }, h('div', { class: 'dock-head' }, 'Packet inspector'), this.inspEl));
    this.el.append(this.palette, this.canvasWrap, this.side, this.dock);
    this.buildResizers();
    this.root.append(this.el);
    renderInspector(this.inspEl, null);
  }

  // ------------------------------------------------------------ Resizable panels
  // Side panel width, dock height and the split between log and inspector. Lessons and the
  // free lab remember their sizes separately, because the lesson layout is narrower.
  buildResizers() {
    const key = this.opts.compact ? 'compact' : 'full';
    this.layout = { ...(store.prefs.layout?.[key] || {}) };
    const save = () => store.setPref('layout', { ...(store.prefs.layout || {}), [key]: { ...this.layout } });
    const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
    const after = () => { this.applyLayout(); this.placeHandles(); };
    const reset = prop => () => { delete this.layout[prop]; after(); save(); };
    this.rzSide = resizer('col', { onEnd: save, onReset: reset('sideW'), onMove: e => {
      const r = this.el.getBoundingClientRect();
      this.layout.sideW = clamp(r.right - e.clientX, 260, Math.min(960, r.width - this.palette.offsetWidth - 320)); after();
    } });
    this.rzDock = resizer('row', { onEnd: save, onReset: reset('dockH'), onMove: e => {
      const r = this.el.getBoundingClientRect();
      this.layout.dockH = clamp(r.bottom - e.clientY, 90, r.height - 140); after();
    } });
    this.rzSplit = resizer('col', { onEnd: save, onReset: reset('dockSplit'), onMove: e => {
      const r = this.dock.getBoundingClientRect();
      this.layout.dockSplit = Math.min(.85, Math.max(.15, (e.clientX - r.left) / r.width)); after();
    } });
    this.el.append(this.rzSide, this.rzDock, this.rzSplit);
    this.applyLayout();
  }
  applyLayout() {
    const s = this.el.style, l = this.layout;
    const set = (name, v) => v == null ? s.removeProperty(name) : s.setProperty(name, v);
    set('--side-w', l.sideW ? l.sideW + 'px' : null);
    set('--dock-h', l.dockH ? l.dockH + 'px' : null);
    set('--dock-a', l.dockSplit ? l.dockSplit + 'fr' : null);
    set('--dock-b', l.dockSplit ? (1 - l.dockSplit) + 'fr' : null);
  }
  placeHandles() {
    if (!this.rzSide) return;
    const d = this.dock, first = d.firstElementChild;
    Object.assign(this.rzSide.style, { left: `${this.side.offsetLeft - 5}px`, top: '0', height: `${this.el.clientHeight}px` });
    Object.assign(this.rzDock.style, { left: `${d.offsetLeft}px`, top: `${d.offsetTop - 5}px`, width: `${d.offsetWidth}px` });
    Object.assign(this.rzSplit.style, { left: `${d.offsetLeft + first.offsetWidth - 4}px`, top: `${d.offsetTop + 4}px`, height: `${Math.max(0, d.offsetHeight - 4)}px` });
  }
  speedToSlider(ms) { return Math.round(100 - (Math.log(ms / 60) / Math.log(4000 / 60)) * 100); }
  sliderToSpeed(v) { return Math.round(60 * Math.pow(4000 / 60, (100 - v) / 100)); }
  showSpeed() { this.speedLbl.textContent = `${(this.msPerHop / 1000).toFixed(this.msPerHop < 1000 ? 2 : 1)} s per cable`; }

  // ------------------------------------------------------------ Loading
  load(topo, first = false) {
    this.unsub?.();
    this.topo = topo;
    topo.devices.forEach(normalizeDevice);
    topo.links.forEach(l => { l.mtu ??= 1500; l.up ??= true; l.id ??= newId('l'); });
    topo.zones ??= [];
    topo.zones.forEach(z => { z.id ??= newId('z'); });
    this.sim = new Sim(topo);
    this.unsub = this.sim.on((type, data) => this.onSim(type, data));
    this.sel = null; this.track = null; this.flowSel = null; this.selectedLog = null;
    this.pktEls.forEach(e => e.remove()); this.pktEls.clear();
    this.render();
    this.fit(true);
    this.resetHistory();
    this.updateBpduBar();
    this.showStorm(null);
    this.renderSide();
    this.renderLog();
    renderInspector(this.inspEl, null);
    if (!first) this.emit('loaded');
  }
  resetState() {
    this.sim.reset();
    this.pktEls.forEach(e => e.remove()); this.pktEls.clear();
    this.stopTrack();
    this.renderLog(); this.renderSide(); renderInspector(this.inspEl, null);
    this.showStorm(null); this.render();
    toast('State reset: ARP and MAC tables are empty');
    this.emit('reset');
  }
  onSim(type, data) {
    if (type === 'log') {
      this.queueLog(data);
      if (data.tag && (/^(stp|vrrp|ospf)-/.test(data.tag) || ['link-up', 'link-down', 'dhcp-bound', 'dhcp-released-client'].includes(data.tag))) { this.renderSoon(); this.refreshSideSoon(); }
    }
    if (type === 'halted') this.showStorm(data);
    if (type === 'console' && this.sel?.kind === 'dev' && this.sel.id === data.devId && this.tab === 'console') this.consoleEl?.refresh();
    if (type === 'config') { this.render(); this.refreshSideSoon(); this.updateBpduBar(); this.noteEdit(); }
    if (type === 'topology') { this.render(); this.noteEdit(); }
    this.emit('sim', { type, data });
  }

  // ------------------------------------------------------------ Drawing the network diagram
  devPos(d) { return { x: d.x ?? 0, y: d.y ?? 0 }; }
  render() {
    const topo = this.sim.topo;
    const hl = this.trackHighlight();
    this.gLinks.innerHTML = ''; this.gLinkLbl.innerHTML = ''; this.gDevs.innerHTML = ''; this.gZones.innerHTML = '';
    for (const z of topo.zones || []) this.gZones.append(this.zoneEl(z));
    const byId = new Map(topo.devices.map(d => [d.id, d]));
    for (const l of topo.links) {
      const A = byId.get(l.a.dev), B = byId.get(l.b.dev);
      if (!A || !B) continue;
      const onPath = hl && (hl.edges.has(l.a.dev + '|' + l.b.dev) || hl.edges.has(l.b.dev + '|' + l.a.dev));
      const g = svgEl('g', { class: `lnk-g${this.sel?.kind === 'link' && this.sel.id === l.id ? ' sel' : ''}${onPath ? ' trace' : ''}`, 'data-id': l.id });
      const line = svgEl('line', { class: `lnk${l.up ? '' : ' down'}${l.mtu > 1500 ? ' jumbo' : ''}`, x1: A.x, y1: A.y, x2: B.x, y2: B.y });
      const hit = svgEl('line', { class: 'lnk-hit', x1: A.x, y1: A.y, x2: B.x, y2: B.y });
      hit.addEventListener('pointerdown', e => { if (e.button === 2) return; e.stopPropagation(); this.select({ kind: 'link', id: l.id }); });
      hit.addEventListener('contextmenu', e => this.linkMenu(e, l));
      g.append(line, hit);
      const lbl = (P, Q, name) => {
        const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy) || 1;
        // Pointing down: pass below the device's name and address
        const down = dy / len > 0.7;
        const off = Math.min(down ? 86 : 58, len * (down ? 0.45 : 0.32));
        const t = svgEl('text', { class: 'iflbl', x: P.x + dx / len * off + (-dy / len) * 9, y: P.y + dy / len * off + (dx / len) * 9 + 3, 'text-anchor': 'middle' });
        t.textContent = name; return t;
      };
      const lg = svgEl('g');
      lg.append(lbl(A, B, l.a.if), lbl(B, A, l.b.if));
      for (const [P, Q, end] of [[A, B, l.a], [B, A, l.b]]) {
        const br = this.sim.dev(end.dev)?.bridge;
        if (!br?.stp || P.type !== 'switch') continue;
        const ps = br.stp.ports.get(end.if);
        if (!ps) continue;
        const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy) || 1, off = Math.min(42, len * 0.22);
        const dot = svgEl('g', { class: `stp-dot st-${ps.state} role-${ps.role}`, transform: `translate(${(P.x + dx / len * off).toFixed(1)},${(P.y + dy / len * off).toFixed(1)})` });
        const tt = svgEl('title'); tt.textContent = `${P.name} ${end.if}: ${STP_TEXT.ROLE[ps.role]}, ${STP_TEXT.STATE[ps.state]}${ps.edge ? ', edge port' : ''}${br.stp.rstp && ps.legacy ? ', neighbor speaks only classic STP' : ''}`;
        const letter = svgEl('text', { 'text-anchor': 'middle', y: 2.7 }); letter.textContent = { root: 'R', designated: 'D', alternate: 'A', backup: 'B', disabled: '' }[ps.role];
        dot.append(tt, svgEl('circle', { r: 6 }), letter);
        lg.append(dot);
      }
      const props = [l.mtu !== 1500 ? `MTU ${l.mtu}` : '', Number(l.delay) > 0 ? `${l.delay} ms` : '', Number(l.loss) > 0 ? `${l.loss} % loss` : ''].filter(Boolean);
      if (props.length) {
        const t = svgEl('text', { class: 'mtulbl', x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 7, 'text-anchor': 'middle' });
        t.textContent = props.join(' · '); lg.append(t);
      }
      this.gLinks.append(g);
      this.gLinkLbl.append(lg);
    }
    const traceDevs = hl?.devs;
    for (const d of topo.devices) {
      const sel = this.sel?.kind === 'dev' && this.sel.id === d.id;
      const g = svgEl('g', { class: `dev t-${d.type}${sel ? ' sel' : ''}${this.connectFrom === d.id ? ' pend' : ''}${traceDevs?.has(d.id) ? ' trace' : ''}`,
        transform: `translate(${d.x - CARD_W / 2},${d.y - CARD_H / 2})`, tabindex: '0', 'data-id': d.id, role: 'button', 'aria-label': `${TYPE_NAMES[d.type]} ${d.name}` });
      g.append(svgEl('rect', { class: 'card', width: CARD_W, height: CARD_H, rx: 10 }));
      const ic = svgEl('g', { transform: `translate(${CARD_W / 2 - 20},${CARD_H / 2 - 22})` });
      ic.innerHTML = DEV_ICON[d.type];
      g.append(ic);
      const nm = svgEl('text', { class: 'nm', x: CARD_W / 2, y: CARD_H + 15 }); nm.textContent = d.name; g.append(nm);
      const lines = this.addrLines(d);
      lines.forEach((line, i) => { const t = svgEl('text', { class: 'ip', x: CARD_W / 2, y: CARD_H + 28 + i * 12 }); t.textContent = line; g.append(t); });
      const badge = this.badge(d);
      if (badge) { const t = svgEl('text', { class: 'stpbadge', x: CARD_W / 2, y: CARD_H + 28 + lines.length * 12 }); t.textContent = badge; g.append(t); }
      const st = d.type === 'switch' ? this.sim.dev(d.id)?.bridge?.stpTable() : null;
      if (st) { const t = svgEl('text', { class: 'stpbadge', x: CARD_W / 2, y: CARD_H + 28 }); const proto = st.mode === 'rstp' ? 'RSTP' : 'STP'; t.textContent = st.isRoot ? `Root bridge (${proto}), prio ${d.stp.priority}` : `${proto}, prio ${d.stp.priority}`; g.append(t); }
      g.addEventListener('pointerdown', e => { if (e.button !== 2) this.devPointerDown(e, d); });
      g.addEventListener('contextmenu', e => this.devMenu(e, d));
      g.addEventListener('dblclick', () => { this.select({ kind: 'dev', id: d.id }); this.setTab('console'); });
      g.addEventListener('keydown', e => { if (e.key === 'Enter') this.select({ kind: 'dev', id: d.id }); });
      this.gDevs.append(g);
    }
    this.updateOverlay();
  }
  /** Address lines under a device: one for hosts, one per configured interface for routers and VTEPs */
  addrLines(d) {
    // IPv6: the global addresses (static or from SLAAC) once they are usable
    const v6 = this.sim.dev(d.id)?.l3?.v6;
    const six = n => v6?.on ? v6.addrs(n).filter(a => a.scope === 'global' && a.state !== 'duplicate').map(a => `${a.ip}/${a.len}${a.origin === 'slaac' ? ' (SLAAC)' : ''}`) : [];
    if (d.type === 'pc' || d.type === 'server') {
      const i = d.ifaces.eth1;
      if (i.dhcp) { const l = this.sim.dev(d.id)?.l3?.lease; return [l ? `${l.ip}/${l.prefix} (DHCP)` : 'DHCP …', ...six('eth1')]; }
      return [...(isIp(i.ip) ? [`${i.ip}/${i.prefix}${i.vlan ? ', VLAN ' + i.vlan : ''}`] : []), ...six('eth1')];
    }
    if (d.type === 'router' || d.type === 'vtep') {
      return Object.entries(d.ifaces).filter(([n, i]) => isIp(i.ip) || six(n).length)
        .sort(([a], [b]) => (a === 'lo') - (b === 'lo') || a.localeCompare(b, 'en', { numeric: true }))
        .flatMap(([n, i]) => [...(isIp(i.ip) ? [`${n} ${i.ip}/${i.prefix}`] : []), ...six(n).map(x => `${n} ${x}`)]);
    }
    return [];
  }
  /** Short status line for routers: VRRP role, OSPF neighbors, DHCP server */
  badge(d) {
    if (d.type !== 'router' && d.type !== 'server') return '';
    const dev = this.sim.dev(d.id), parts = [];
    for (const g of dev?.vrrp?.table() || []) parts.push(`VRRP ${g.state === 'master' ? 'master' : g.state} ${g.vip}`);
    if (dev?.ospf?.enabled) { const n = dev.ospf.neighborTable().filter(x => x.state === 'Full').length; parts.push(`OSPF ${n} nbr${n === 1 ? '' : 's'}`); }
    if (d.dhcpServer?.enabled) parts.push('DHCP server');
    if (d.nat?.outside) parts.push('NAT');
    return parts.join(' · ');
  }
  // Fullscreen: in a lesson or challenge the goals come along, in the free lab the whole lab.
  // Without the Fullscreen API (e.g. iPhone) the area simply covers the window.
  fullTarget() { return this.root.closest('.lesson-body') || this.root; }
  isFull() { const t = this.fullTarget(); return document.fullscreenElement === t || t.classList.contains('pseudo-full'); }
  toggleFull() {
    const t = this.fullTarget();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else if (t.classList.contains('pseudo-full')) t.classList.remove('pseudo-full');
    else if (t.requestFullscreen) t.requestFullscreen().catch(() => t.classList.add('pseudo-full'));
    else t.classList.add('pseudo-full');
    setTimeout(() => this.syncFull(), 50);
  }
  syncFull() {
    if (!this.fullBtn) return;
    const on = this.isFull();
    this.fullBtn.innerHTML = on ? I.unfull : I.full;
    this.fullBtn.title = on ? 'Leave fullscreen (F or Esc)' : 'Fullscreen (F)';
    this.fullBtn.setAttribute('aria-label', this.fullBtn.title);
    this.fullBtn.classList.toggle('on', on);
  }
  fit(force) {
    const r = this.canvasWrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ds = this.sim?.topo.devices || [];
    if (!force && this.fitted) { this.view.h = this.view.w * r.height / r.width; this.applyView(); return; }
    this.fitted = true;
    if (!ds.length) { this.view = { x: 0, y: 0, w: r.width, h: r.height }; this.applyView(); return; }
    const xs = ds.map(d => d.x), ys = ds.map(d => d.y);
    let minX = Math.min(...xs) - 90, maxX = Math.max(...xs) + 90, minY = Math.min(...ys) - 100, maxY = Math.max(...ys) + 80;
    for (const z of this.sim.topo.zones || []) { minX = Math.min(minX, z.x - 20); minY = Math.min(minY, z.y - 20); maxX = Math.max(maxX, z.x + z.w + 20); maxY = Math.max(maxY, z.y + z.h + 20); }
    let w = Math.max(maxX - minX, 420), hh = Math.max(maxY - minY, 260);
    const ar = r.width / r.height;
    if (w / hh > ar) hh = w / ar; else w = hh * ar;
    this.view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - hh / 2 - 16, w, h: hh };
    this.applyView();
  }
  applyView() { this.svg.setAttribute('viewBox', `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`); }
  toSvg(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: this.view.x + (e.clientX - r.left) / r.width * this.view.w, y: this.view.y + (e.clientY - r.top) / r.height * this.view.h };
  }

  // ------------------------------------------------------------ Interaction
  bindCanvas() {
    this.svg.addEventListener('pointerdown', e => {
      if (e.target !== this.svg || e.button === 2) return;
      this.select(null);
      if (this.connectMode) { this.connectFrom = null; this.render(); }
      const start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      const r = this.svg.getBoundingClientRect();
      const move = ev => {
        this.view.x = start.vx - (ev.clientX - start.x) / r.width * this.view.w;
        this.view.y = start.vy - (ev.clientY - start.y) / r.height * this.view.h;
        this.applyView();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    this.svg.addEventListener('contextmenu', e => { if (e.target === this.svg || e.target.closest('.zone-g')) this.canvasMenu(e); });
    this.svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.toSvg(e);
      const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const w = Math.min(4000, Math.max(240, this.view.w * k));
      const f = w / this.view.w;
      this.view = { x: p.x - (p.x - this.view.x) * f, y: p.y - (p.y - this.view.y) * f, w, h: this.view.h * f };
      this.applyView();
    }, { passive: false });
    this.canvasWrap.addEventListener('dragover', e => { if (this.canEditTopo) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    this.canvasWrap.addEventListener('drop', e => {
      const t = e.dataTransfer.getData('text/pp-device');
      if (!t || !this.canEditTopo) return;
      e.preventDefault();
      const p = this.toSvg(e);
      if (t === 'zone') return this.addZone(Math.round(p.x / 12) * 12, Math.round(p.y / 12) * 12);
      this.addDevice(t, Math.round(p.x / 12) * 12, Math.round(p.y / 12) * 12);
    });
  }
  devPointerDown(e, d) {
    e.stopPropagation();
    if (this.connectMode) return this.connectClick(d);
    this.select({ kind: 'dev', id: d.id });
    if (!this.canEditTopo && this.opts.edit !== 'config') return;
    const start = this.toSvg(e), ox = d.x, oy = d.y;
    let moved = false;
    const move = ev => {
      const p = this.toSvg(ev);
      const nx = Math.round((ox + p.x - start.x) / 12) * 12, ny = Math.round((oy + p.y - start.y) / 12) * 12;
      if (nx !== d.x || ny !== d.y) { d.x = nx; d.y = ny; moved = true; this.render(); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) this.emit('moved'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  setConnect(on) {
    if (!this.canEditTopo) return;
    this.connectMode = on; this.connectFrom = null;
    this.cableBtn?.classList.toggle('on', on);
    this.canvasWrap.classList.toggle('connecting', on);
    this.render();
  }
  connectClick(d) {
    if (!this.connectFrom) { this.connectFrom = d.id; this.render(); return; }
    if (this.connectFrom === d.id) { this.connectFrom = null; this.render(); return; }
    const a = this.connectFrom, b = d.id;
    const pa = this.pickPort(a, b), pb = this.pickPort(b, a);
    const A = this.sim.dev(a), B = this.sim.dev(b);
    if (!pa || !pb) { toast(`${!pa ? A.name : B.name} has no free port left`); this.connectFrom = null; this.render(); return; }
    const l = this.sim.addLink({ id: newId('l'), a: { dev: a, if: pa }, b: { dev: b, if: pb }, mtu: 1500, up: true });
    this.connectFrom = null;
    toast(`${A.name} ${pa} ↔ ${B.name} ${pb} connected`);
    this.render();
    this.emit('linked', l);
  }
  pickPort(devId, otherId) {
    const d = this.sim.dev(devId), o = this.sim.dev(otherId);
    const free = PORTS[d.type].filter(p => !this.sim.linkAt(devId, p));
    if (d.type === 'vtep') {
      const wantsUplink = o.type === 'router' || o.type === 'vtep';
      if (wantsUplink && free.includes('eth1')) return 'eth1';
      return free.find(p => p !== 'eth1') || free[0] || null;
    }
    return free[0] || null;
  }
  addDevice(type, x, y) {
    if (!this.canEditTopo) return;
    const pre = NAME_PREFIX[type];
    let n = 1;
    while (this.sim.topo.devices.some(d => d.name === pre + n)) n++;
    if (x === undefined) {
      x = Math.round((this.view.x + this.view.w / 2 + (Math.random() - .5) * 120) / 12) * 12;
      y = Math.round((this.view.y + this.view.h / 2 + (Math.random() - .5) * 80) / 12) * 12;
    }
    const cfg = normalizeDevice({ id: newId(), type, name: pre + n, x, y });
    this.sim.addDevice(cfg);
    this.select({ kind: 'dev', id: cfg.id });
    this.emit('added', cfg);
  }
  // ------------------------------------------------------------ Areas
  zoneEl(z) {
    const sel = this.sel?.kind === 'zone' && this.sel.id === z.id;
    const g = svgEl('g', { class: `zone-g c-${zoneColor(z)}${sel ? ' sel' : ''}`, 'data-id': z.id });
    g.append(svgEl('rect', { class: 'zone', x: z.x, y: z.y, width: z.w, height: z.h, rx: 14 }));
    const label = z.label || 'Area';
    const tw = Math.min(z.w - 16, label.length * 6.3 + 18);
    const tab = svgEl('rect', { class: 'zone-tab', x: z.x + 8, y: z.y + 8, width: Math.max(30, tw), height: 20, rx: 6 });
    const t = svgEl('text', { class: 'zone-t', x: z.x + 17, y: z.y + 22 }); t.textContent = label;
    g.append(tab, t);
    if (this.canEditTopo) {
      tab.addEventListener('pointerdown', e => { if (e.button !== 2) this.zonePointer(e, z, 'move'); });
      tab.addEventListener('contextmenu', e => this.zoneMenu(e, z));
      tab.addEventListener('dblclick', () => { this.select({ kind: 'zone', id: z.id }); setTimeout(() => this.side.querySelector('input')?.focus(), 30); });
      const rs = svgEl('rect', { class: 'zone-rs', x: z.x + z.w - 13, y: z.y + z.h - 13, width: 11, height: 11, rx: 3 });
      rs.addEventListener('pointerdown', e => this.zonePointer(e, z, 'resize'));
      g.append(rs);
    }
    return g;
  }
  zonePointer(e, z, mode) {
    e.stopPropagation();
    this.select({ kind: 'zone', id: z.id });
    const start = this.toSvg(e), o = { x: z.x, y: z.y, w: z.w, h: z.h };
    const inside = mode === 'move' ? this.sim.topo.devices.filter(d => d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h).map(d => [d, d.x, d.y]) : [];
    const snap = v => Math.round(v / 12) * 12;
    let moved = false;
    const move = ev => {
      const p = this.toSvg(ev), dx = p.x - start.x, dy = p.y - start.y;
      if (mode === 'move') {
        const nx = snap(o.x + dx), ny = snap(o.y + dy);
        if (nx === z.x && ny === z.y) return;
        const mx = nx - o.x, my = ny - o.y;
        z.x = nx; z.y = ny;
        for (const [d, x, y] of inside) { d.x = x + mx; d.y = y + my; }
      } else {
        const nw = Math.max(120, snap(o.w + dx)), nh = Math.max(72, snap(o.h + dy));
        if (nw === z.w && nh === z.h) return;
        z.w = nw; z.h = nh;
      }
      moved = true; this.render();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) this.emit('moved'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  addZone(x, y) {
    if (!this.canEditTopo) return;
    const w = 312, hh = 204;
    if (x === undefined) { x = this.view.x + this.view.w / 2; y = this.view.y + this.view.h / 2; }
    const used = new Set((this.sim.topo.zones || []).map(zz => zoneColor(zz)));
    const color = (ZONE_COLORS.find(([k]) => !used.has(k)) || ZONE_COLORS[0])[0];
    const z = { id: newId('z'), x: Math.round((x - w / 2) / 12) * 12, y: Math.round((y - hh / 2) / 12) * 12, w, h: hh, label: `Area ${(this.sim.topo.zones || []).length + 1}`, color };
    this.sim.topo.zones.push(z);
    this.render();
    this.select({ kind: 'zone', id: z.id });
    this.emit('added', z);
  }
  renderZoneSide() {
    const z = this.sim.topo.zones.find(x => x.id === this.sel.id);
    if (!z) { this.sel = null; return this.renderSide(); }
    const name = h('input', { class: 'input', value: z.label || '', placeholder: 'e.g. VLAN 10, office, underlay', disabled: this.canEditTopo ? null : true });
    name.addEventListener('input', () => { z.label = name.value; this.render(); });
    name.addEventListener('change', () => this.emit('moved'));
    const sw = h('div', { class: 'swatches' });
    for (const [k, t] of ZONE_COLORS) {
      const b = h('button', { class: `swatch${zoneColor(z) === k ? ' cur' : ''}`, title: t, 'aria-label': t, style: { background: k === 'gray' ? 'var(--ink-3)' : `var(--l-${{ blue: 'eth', violet: 'vlan', green: 'ip', orange: 'arp', pink: 'vxlan', yellow: 'stp' }[k]})` },
        onclick: () => { z.color = k; delete z.kind; this.render(); this.renderSide(); this.emit('moved'); } });
      if (!this.canEditTopo) b.disabled = true;
      sw.append(b);
    }
    const inside = this.sim.topo.devices.filter(d => d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h);
    this.side.append(h('div', { class: 'side-head' }, h('span', { html: I.area }), h('div', { class: 'grow', style: { fontWeight: 650 } }, 'Area'),
      this.canEditTopo ? iconBtn(I.trash, 'Remove area (Del), the devices stay', () => this.deleteSelected(), 'danger') : null), h('div'),
      h('div', { class: 'side-body' },
        h('h4', {}, 'Label'), name,
        h('h4', {}, 'Color'), sw,
        h('h4', {}, 'Contents'),
        h('p', { class: 'small' }, inside.length ? inside.map(d => d.name).join(', ') : 'No devices in this area.'),
        h('p', { class: 'small muted' }, 'Areas are only for organizing and have no effect on the simulation. Move them by the tab (devices inside move along), resize them at the bottom right corner.')));
  }

  deleteSelected() {
    if (!this.canEditTopo || !this.sel) return;
    if (this.sel.kind === 'zone') { this.sim.topo.zones = this.sim.topo.zones.filter(z => z.id !== this.sel.id); this.select(null); this.render(); this.emit('deleted'); return; }
    if (this.sel.kind === 'dev') { const n = this.sim.dev(this.sel.id)?.name; this.sim.removeDevice(this.sel.id); toast(`${n} removed`); }
    else this.sim.removeLink(this.sel.id);
    this.select(null);
    this.emit('deleted');
  }
  onKey(e) {
    if (!this.root.isConnected) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); return this.redo(); }
    if (e.key === ' ') { e.preventDefault(); this.setPlaying(!this.playing); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.stepOnce(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSelected(); }
    else if (e.key === 'k' || e.key === 'K') this.setConnect(!this.connectMode);
    else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) this.toggleFull();
    else if (e.key === 'Escape') {
      if (this.fullTarget().classList.contains('pseudo-full')) { this.toggleFull(); return; }
      this.setConnect(false); this.select(null);
    }
  }
  select(s) {
    const same = JSON.stringify(s) === JSON.stringify(this.sel);
    this.sel = s;
    this.markSelection();
    if (!same) this.renderSide();
    if (s) this.emit('select', s);
  }
  markSelection() {
    this.gDevs.querySelectorAll('.dev').forEach(g => g.classList.toggle('sel', this.sel?.kind === 'dev' && g.dataset.id === this.sel.id));
    this.gLinks.querySelectorAll('.lnk-g').forEach(g => g.classList.toggle('sel', this.sel?.kind === 'link' && g.dataset.id === this.sel.id));
    this.gZones.querySelectorAll('.zone-g').forEach(g => g.classList.toggle('sel', this.sel?.kind === 'zone' && g.dataset.id === this.sel.id));
  }
  updateOverlay() {
    let msg = '';
    if (this.connectMode) msg = this.connectFrom ? 'Now click the second device' : 'Cable: click the first device (Esc cancels)';
    else if (!this.sim.topo.devices.length && this.canEditTopo) msg = 'Drag devices from the left bar onto the canvas';
    this.overlay.textContent = msg;
    this.overlay.classList.toggle('hidden', !msg);
  }

  // ------------------------------------------------------------ Side panel
  setTab(t) { this.tab = t; this.renderSide(); if (t === 'console') setTimeout(() => this.consoleEl?.focusInput(), 30); }
  refreshSideSoon() {
    if (this.sideTimer) return;
    this.sideTimer = setTimeout(() => { this.sideTimer = null; if (this.tab === 'tables') this.renderSide(); }, 250);
  }
  renderSide() {
    const side = this.side;
    side.innerHTML = '';
    this.consoleEl = null;
    if (!this.sel) {
      side.append(h('div', { class: 'side-head' }, h('div', {},
        h('div', { style: { fontWeight: 650 } }, this.sim.topo.name || 'Network'),
        h('div', { class: 'small muted' }, `${this.sim.topo.devices.length} devices, ${this.sim.topo.links.length} cables`))));
      side.append(h('div'));
      side.append(h('div', { class: 'side-body' },
        h('h4', {}, 'How to use the lab'),
        h('ul', { class: 'small', style: { paddingLeft: '18px', margin: 0, display: 'grid', gap: '6px' } },
          this.canEditTopo ? h('li', {}, 'Drag devices from the left bar onto the canvas.') : null,
          this.canEditTopo ? h('li', {}, 'Cable (key K): click one device, then the second. Free ports are chosen automatically.') : null,
          this.canEditTopo ? h('li', {}, 'Areas organize the canvas: colored rectangles with a label, move them by the tab, resize them at the corner.') : null,
          h('li', {}, 'Click a device: configuration, tables and console appear here. Double-click opens the console directly.'),
          h('li', {}, 'Type e.g. ping 10.0.0.2 in the console and watch the packets travel.'),
          h('li', {}, 'Space pauses time, the right arrow advances one event. The speed slider sets the slow motion. F switches to fullscreen.'),
          h('li', {}, 'Ctrl+Z undoes a change, Ctrl+Y redoes it. Right-click on a device, cable, area or packet shows what you can do with it.'),
          h('li', {}, 'Clicking a packet takes it apart into its layers in the packet inspector.')),
        h('h4', {}, 'Layer colors'),
        h('div', { class: 'row small' }, ...[['eth', 'Ethernet'], ['vlan', '802.1Q'], ['arp', 'ARP'], ['stp', 'STP'], ['ip', 'IPv4, IPv6'], ['icmp', 'ICMP, ICMPv6, NDP'], ['udp', 'UDP'], ['tcp', 'TCP'], ['vxlan', 'VXLAN'], ['rt', 'Routing (OSPF, VRRP, BFD)']]
          .map(([k, n]) => h('span', { class: 'chip' }, h('i', { class: `bg-${k}`, style: { width: '10px', height: '10px', borderRadius: '2px', display: 'inline-block' } }), n)))));
      return;
    }
    if (this.sel.kind === 'link') return this.renderLinkSide();
    if (this.sel.kind === 'zone') return this.renderZoneSide();
    const dev = this.sim.dev(this.sel.id);
    if (!dev) { this.sel = null; return this.renderSide(); }
    const nameIn = h('input', { class: 'name', value: dev.name, 'aria-label': 'Device name', disabled: this.canEditTopo ? null : true });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim().replace(/\s+/g, '-');
      if (!v || this.sim.topo.devices.some(d => d !== dev.cfg && d.name === v)) { nameIn.value = dev.name; return toast('Name empty or already taken'); }
      dev.cfg.name = v; this.render(); this.emit('renamed');
    });
    side.append(h('div', { class: 'side-head' },
      h('span', { class: 'devglyph', html: `<svg viewBox="0 0 40 40" width="34" height="34">${DEV_ICON[dev.type]}</svg>` }),
      h('div', { class: 'grow' }, nameIn, h('div', { class: 'small muted', style: { paddingLeft: '5px' } }, TYPE_NAMES[dev.type])),
      this.canEditTopo ? iconBtn(I.trash, 'Remove device (Del)', () => this.deleteSelected(), 'danger') : null));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const [k, label, icon] of [['config', 'Configuration', I.sliders], ['tables', 'Tables', I.table], ['console', 'Console', I.terminal]]) {
      tabs.append(h('button', { class: this.tab === k ? 'cur' : '', role: 'tab', 'aria-selected': this.tab === k ? 'true' : 'false', html: icon + label, onclick: () => this.setTab(k) }));
    }
    side.append(tabs);
    const body = h('div', { class: 'side-body' });
    if (this.tab === 'config') body.append(configPanel(dev, { sim: this.sim, locked: !this.canConfig, rerender: () => this.renderSide(), changed: msg => { this.sim.configChanged(dev.id); this.emit('config', { dev: dev.id, msg }); } }));
    if (this.tab === 'tables') body.append(tablesPanel(dev, this.sim));
    if (this.tab === 'console') { this.consoleEl = consolePanel(dev, this.sim, this.opts.consolePresets?.[dev.name] || []); body.append(this.consoleEl); body.style.overflow = 'hidden'; }
    side.append(body);
  }
  renderLinkSide() {
    const l = this.sim.topo.links.find(x => x.id === this.sel.id);
    if (!l) { this.sel = null; return this.renderSide(); }
    const A = this.sim.dev(l.a.dev), B = this.sim.dev(l.b.dev);
    const mtu = h('input', { class: 'input mono', type: 'number', min: '576', max: '9216', value: l.mtu, disabled: this.canConfig ? null : true });
    mtu.addEventListener('change', () => {
      const v = Number(mtu.value);
      if (!(v >= 576 && v <= 9216)) { mtu.classList.add('bad'); return; }
      l.mtu = v; mtu.classList.remove('bad'); this.render(); this.sim.emit('config', null); this.emit('config', { link: l.id, msg: `MTU ${v}` });
    });
    const up = h('input', { type: 'checkbox', checked: l.up ? true : null, disabled: this.canConfig ? null : true });
    up.addEventListener('change', () => { this.sim.setLinkUp(l, up.checked); this.render(); this.emit('config', { link: l.id, msg: up.checked ? 'Link on' : 'Link off' }); });
    this.side.append(h('div', { class: 'side-head' }, h('span', { html: I.cable }), h('div', { class: 'grow', style: { fontWeight: 650 } }, 'Cable'),
      this.canEditTopo ? iconBtn(I.trash, 'Remove cable (Del)', () => this.deleteSelected(), 'danger') : null), h('div'),
      h('div', { class: 'side-body' },
        h('dl', { class: 'kv' }, h('dt', {}, 'Side A'), h('dd', {}, `${A.name} ${l.a.if}`), h('dt', {}, 'Side B'), h('dd', {}, `${B.name} ${l.b.if}`)),
        h('h4', {}, 'MTU (payload bytes per frame)'), mtu,
        h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Both ends use this MTU. Frames with a larger payload are lost on this cable.'),
        h('h4', {}, 'Line quality'),
        h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 90px' } },
          h('span', { class: 'small' }, 'Latency, one way (ms)'), this.linkNum(l, 'delay', 0, 2000, 'ms'),
          h('span', { class: 'small' }, 'Packet loss (%)'), this.linkNum(l, 'loss', 0, 100, '%')),
        h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'A long-distance or wireless link: ping shows the round-trip time and losses, TCP retransmits what got lost, UDP does not.'),
        h('label', { class: 'row', style: { marginTop: '10px' } }, up, 'Link up (cable plugged in)')));
  }
  linkNum(l, key, min, max, unit) {
    const i = h('input', { class: 'input mono', type: 'number', min: String(min), max: String(max), value: Number(l[key]) || 0, disabled: this.canConfig ? null : true });
    i.addEventListener('change', () => {
      const v = Number(i.value);
      if (!(v >= min && v <= max)) { i.classList.add('bad'); return; }
      i.classList.remove('bad');
      if (v) l[key] = v; else delete l[key];
      this.render(); this.sim.emit('config', null); this.emit('config', { link: l.id, msg: `${key} ${v} ${unit}` });
    });
    return i;
  }

  // ------------------------------------------------------------ Log
  queueLog(e) {
    this.pendingLog ??= [];
    this.pendingLog.push(e);
    if (!this.logTimer) this.logTimer = setTimeout(() => { this.logTimer = null; const p = this.pendingLog; this.pendingLog = []; this.appendLog(p); }, 60);
  }
  logVisible(e) {
    if (this.logFilter === 'all') return e.tag !== 'bpdu-sent' && e.tag !== 'hello-sent';
    if (this.logFilter === 'bpdu') return true;
    if (this.logFilter === 'stp') return e.stp && e.tag !== 'bpdu-sent' || e.tag === 'loop-detected' || e.tag === 'storm' || e.tag === 'mac-flap';
    if (this.logFilter === 'nosend') return e.kind !== 'send';
    if (this.logFilter === 'track') return !!this.track?.seqs.has(e.seq);
    if (this.logFilter.startsWith('dev:')) return e.devId === this.logFilter.slice(4);
    return true;
  }
  logRow(e) {
    const row = h('div', { class: `e k-${e.kind}${e.frame ? ' has-frame' : ''}${this.selectedLog === e.seq ? ' sel' : ''}`, 'data-seq': e.seq },
      h('span', { class: 't' }, (e.t / 1000).toFixed(4)), h('span', { class: 'd', title: e.dev }, e.dev), h('span', { class: 'x' }, e.text));
    if (e.frame) {
      row.addEventListener('click', () => this.inspect(e));
      row.addEventListener('contextmenu', ev => contextMenu(ev, [
        { label: 'Take apart in the inspector', icon: I.eye, onClick: () => this.inspect(e) },
        flowOf(e.frame) ? { label: 'Track this conversation', icon: I.route, onClick: () => this.trackFrom(e) } : null]));
    }
    return row;
  }
  renderLog() {
    const opts = [['all', 'All events'], ['nosend', 'Decisions only']];
    const stp = this.sim.topo.devices.some(d => d.type === 'switch' && d.stp?.enabled), hellos = this.hasHellos();
    if (stp || this.logFilter === 'stp') opts.push(['stp', 'Spanning tree only']);
    if (stp || hellos || this.logFilter === 'bpdu') opts.push(['bpdu', `Everything, including ${stp && hellos ? 'BPDUs and hellos' : stp ? 'BPDUs' : 'hellos'}`]);
    if (this.track) opts.push(['track', `Conversation: ${this.track.label}`]);
    for (const d of this.sim.topo.devices) opts.push(['dev:' + d.id, `Only ${d.name}`]);
    this.filterSel.innerHTML = '';
    for (const [v, t] of opts) this.filterSel.append(h('option', { value: v, selected: v === this.logFilter ? true : null }, t));
    this.logEl.innerHTML = '';
    if (this.track) this.updateTrack();
    if (this.logFilter === 'track' && !this.trackRaw) return this.renderFlow();
    if (this.logFilter === 'track') this.logEl.append(this.flowBar());
    const list = this.sim.log.filter(e => this.logVisible(e)).slice(-600);
    if (!list.length) this.logEl.append(h('div', { class: 'empty', style: { padding: '10px' } }, 'Nothing has happened yet. Open the console of a device and send a ping.'));
    for (const e of list) this.logEl.append(this.logRow(e));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  appendLog(entries) {
    if (this.logFilter === 'track') { clearTimeout(this.flowTimer); this.flowTimer = setTimeout(() => { this.renderLog(); this.render(); }, 120); return; }
    const atBottom = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 30;
    if (this.logEl.querySelector('.empty')) this.logEl.innerHTML = '';
    for (const e of entries) if (this.logVisible(e)) this.logEl.append(this.logRow(e));
    while (this.logEl.childElementCount > 700) this.logEl.firstChild.remove();
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  inspect(e) {
    this.selectedLog = e.seq;
    this.logEl.querySelectorAll('.e.sel').forEach(x => x.classList.remove('sel'));
    this.logEl.querySelector(`[data-seq="${e.seq}"]`)?.classList.add('sel');
    renderInspector(this.inspEl, e, { onTrack: flowOf(e.frame) ? () => this.trackFrom(e) : null });
    this.emit('inspect', e);
  }
  // ------------------------------------------------------------ Tracking a conversation
  // Follows everything that belongs together (a DHCP exchange, a TCP connection, a ping …)
  // and shows it as a list of messages: who sent what to whom, over which devices.
  trackFrom(e) {
    const f = flowOf(e.frame);
    if (!f) return toast('This frame does not belong to a conversation that can be tracked');
    this.track = { keys: new Set([f.key]), traces: new Set(e.trace ? [e.trace] : []), devs: new Set(), label: f.label, kind: f.kind, seqs: new Set(), upTo: 0 };
    this.flowSel = null; this.trackRaw = false; this.logFilter = 'track';
    this.renderLog(); this.render();
    toast('Tracking the conversation: every message in order, the path is highlighted in the diagram');
  }
  stopTrack() {
    if (!this.track) return;
    this.track = null; this.flowSel = null;
    if (this.logFilter === 'track') this.logFilter = 'all';
    this.renderLog(); this.render();
  }
  updateTrack() {
    const t = this.track, tags = TRACK_TAGS[t.kind];
    for (const e of this.sim.log) {
      if (e.seq <= t.upTo) continue;
      t.upTo = e.seq;
      if (e.frame) {
        const f = flowOf(e.frame);
        // Same conversation, or the same packet after NAT or a relay changed its addresses
        if ((f && t.keys.has(f.key)) || (e.trace && t.traces.has(e.trace))) {
          if (f) t.keys.add(f.key);
          if (e.trace) t.traces.add(e.trace);
          t.seqs.add(e.seq); t.devs.add(e.devId); if (e.data?.toId) t.devs.add(e.data.toId);
        }
      } else if (tags?.test(e.tag || '') && t.devs.has(e.devId)) t.seqs.add(e.seq);
    }
  }
  /** Messages of the tracked conversation: one per packet on its way, with the hops */
  flowMessages() {
    const msgs = new Map();
    for (const e of this.sim.log) {
      if (e.kind !== 'send' || !this.track.seqs.has(e.seq)) continue;
      // One message is one packet on its way (also when a relay or NAT passes it on); an
      // answer is a new message even when it carries the same trace id
      const id = (e.trace ?? 'f' + e.frame.id) + '|' + shortLabel(e.frame);
      if (!msgs.has(id)) msgs.set(id, { id, first: e, edges: [] });
      msgs.get(id).edges.push([e.dev, e.data?.to, e.devId, e.data?.toId]);
    }
    return [...msgs.values()];
  }
  pathText(edges) {
    // A tree from the sender: a → b → {c, d → e}. Floods branch, a relay continues the line.
    const kids = new Map();
    for (const [from, to] of edges) {
      if (!to) continue;
      if (!kids.has(from)) kids.set(from, []);
      if (!kids.get(from).includes(to)) kids.get(from).push(to);
    }
    const seen = new Set();
    const walk = n => {
      seen.add(n);
      const next = (kids.get(n) || []).filter(x => !seen.has(x));
      next.forEach(x => seen.add(x));
      if (!next.length) return n;
      const parts = next.map(walk);
      return `${n} → ${parts.length === 1 ? parts[0] : `{${parts.join(', ')}}`}`;
    };
    return edges.length ? walk(edges[0][0]) : '';
  }
  flowBar() {
    const t = this.track;
    return h('div', { class: 'flowbar' }, h('b', {}, t.label), h('span', { class: 'grow' }),
      h('button', { class: 'tog' + (this.trackRaw ? '' : ' on'), onclick: () => { this.trackRaw = false; this.renderLog(); } }, 'Messages'),
      h('button', { class: 'tog' + (this.trackRaw ? ' on' : ''), onclick: () => { this.trackRaw = true; this.renderLog(); } }, 'All events'),
      h('button', { class: 'btn ghost small', onclick: () => this.stopTrack() }, 'Stop'));
  }
  renderFlow() {
    const msgs = this.flowMessages();
    this.logEl.append(this.flowBar());
    if (!msgs.length) this.logEl.append(h('div', { class: 'empty', style: { padding: '10px' } }, 'No messages of this conversation yet.'));
    msgs.forEach((m, i) => {
      const row = h('div', { class: `flow-row${this.flowSel === m.id ? ' sel' : ''}`, title: summary(m.first.frame) },
        h('span', { class: 'n' }, String(i + 1)),
        h('span', { class: 't' }, (m.first.t / 1000).toFixed(4)),
        h('span', { class: 'what' }, summary(m.first.frame)),
        h('span', { class: 'path mono' }, this.pathText(m.edges)));
      row.addEventListener('click', () => { this.flowSel = this.flowSel === m.id ? null : m.id; this.inspect(m.first); this.renderLog(); this.render(); });
      this.logEl.append(row);
    });
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  trackHighlight() {
    if (!this.track) return null;
    const devs = new Set(), edges = new Set();
    for (const m of this.flowMessages()) {
      if (this.flowSel && m.id !== this.flowSel) continue;
      for (const [, , a, b] of m.edges) { devs.add(a); if (b) { devs.add(b); edges.add(a + '|' + b); } }
    }
    return { devs, edges };
  }
  /** Clicking a packet on a cable: its entry in the event log, and the layers in the inspector */
  showInLog(f) {
    const e = this.sim.log.find(x => x.seq === f.logSeq);
    if (!e) return this.inspect({ seq: -1, t: this.sim.time, dev: '', frame: f.frame, trace: traceOf(f.frame) });
    if (!this.logVisible(e)) { if (this.logFilter === 'track') this.stopTrack(); this.logFilter = e.tag === 'bpdu-sent' || e.tag === 'hello-sent' ? 'bpdu' : 'all'; this.renderLog(); }
    else if (this.logFilter === 'track' && !this.trackRaw) { this.trackRaw = true; this.renderLog(); }
    this.inspect(e);
    this.logEl.querySelector(`[data-seq="${e.seq}"]`)?.scrollIntoView({ block: 'center' });
  }

  // ------------------------------------------------------------ Right-click menus
  devMenu(e, d) {
    const edit = this.canEditTopo;
    contextMenu(e, [
      { label: 'Console', icon: I.terminal, onClick: () => { this.select({ kind: 'dev', id: d.id }); this.setTab('console'); } },
      { label: 'Configuration', icon: I.sliders, onClick: () => { this.select({ kind: 'dev', id: d.id }); this.setTab('config'); } },
      { label: 'Tables', icon: I.table, onClick: () => { this.select({ kind: 'dev', id: d.id }); this.setTab('tables'); } },
      '-',
      edit ? { label: 'Connect a cable from here', icon: I.cable, hint: 'K', onClick: () => { this.setConnect(true); this.connectFrom = d.id; this.render(); toast('Now click the device on the other end'); } } : null,
      edit ? { label: 'Rename', onClick: () => { this.select({ kind: 'dev', id: d.id }); setTimeout(() => { const i = this.side.querySelector('.side-head .name'); i?.focus(); i?.select(); }, 30); } } : null,
      '-',
      edit ? { label: 'Delete', icon: I.trash, danger: true, hint: 'Del', onClick: () => { this.select({ kind: 'dev', id: d.id }); this.deleteSelected(); } } : null
    ], d.name);
  }
  linkMenu(e, l) {
    const name = id => this.sim.dev(id)?.name;
    contextMenu(e, [
      { label: 'Cable settings', icon: I.sliders, onClick: () => this.select({ kind: 'link', id: l.id }) },
      this.canConfig ? { label: l.up ? 'Disconnect (link down)' : 'Reconnect (link up)', onClick: () => { this.sim.setLinkUp(l, !l.up); this.render(); this.renderSide(); this.emit('config', { link: l.id, msg: l.up ? 'Link on' : 'Link off' }); } } : null,
      '-',
      this.canEditTopo ? { label: 'Delete cable', icon: I.trash, danger: true, onClick: () => { this.select({ kind: 'link', id: l.id }); this.deleteSelected(); } } : null
    ], `${name(l.a.dev)} ${l.a.if} ↔ ${name(l.b.dev)} ${l.b.if}`);
  }
  zoneMenu(e, z) {
    if (!this.canEditTopo) return;
    contextMenu(e, [
      { label: 'Rename and color', icon: I.sliders, onClick: () => { this.select({ kind: 'zone', id: z.id }); setTimeout(() => this.side.querySelector('input')?.focus(), 30); } },
      '-',
      { label: 'Delete area', icon: I.trash, danger: true, onClick: () => { this.select({ kind: 'zone', id: z.id }); this.deleteSelected(); } }
    ], z.label || 'Area');
  }
  packetMenu(e, f) {
    contextMenu(e, [
      { label: 'Show in the event log', icon: I.eye, onClick: () => this.showInLog(f) },
      flowOf(f.frame) ? { label: 'Track this conversation', icon: I.route, onClick: () => { const le = this.sim.log.find(x => x.seq === f.logSeq); this.trackFrom(le || { frame: f.frame, trace: traceOf(f.frame) }); } } : null
    ], shortLabel(f.frame));
  }
  canvasMenu(e) {
    const p = this.toSvg(e), snap = v => Math.round(v / 12) * 12;
    const zone = (this.sim.topo.zones || []).find(z => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h);
    const types = this.canEditTopo ? this.opts.palette : [];
    contextMenu(e, [
      ...types.map(t => ({ label: `Add ${/^[A-Z]+$/.test(TYPE_NAMES[t]) ? TYPE_NAMES[t] : TYPE_NAMES[t].toLowerCase()} here`, icon: `<svg viewBox="0 0 40 40" width="16" height="16">${DEV_ICON[t]}</svg>`, onClick: () => this.addDevice(t, snap(p.x), snap(p.y)) })),
      this.canEditTopo ? { label: 'Add area here', icon: I.area, onClick: () => this.addZone(snap(p.x), snap(p.y)) } : null,
      zone && this.canEditTopo ? '-' : null,
      zone && this.canEditTopo ? { label: `Rename area "${zone.label || 'Area'}"`, icon: I.sliders, onClick: () => { this.select({ kind: 'zone', id: zone.id }); setTimeout(() => this.side.querySelector('input')?.focus(), 30); } } : null,
      zone && this.canEditTopo ? { label: 'Delete area', icon: I.trash, danger: true, onClick: () => { this.select({ kind: 'zone', id: zone.id }); this.deleteSelected(); } } : null,
      '-',
      (this.canEditTopo || this.canConfig) ? { label: 'Undo', icon: I.reset, hint: 'Ctrl+Z', disabled: !(this.undoStack?.length > 1 || this.histTimer), onClick: () => this.undo() } : null,
      (this.canEditTopo || this.canConfig) ? { label: 'Redo', hint: 'Ctrl+Y', disabled: !this.redoStack?.length, onClick: () => this.redo() } : null,
      '-',
      { label: 'Fit the network into the view', icon: I.fit, onClick: () => this.fit(true) },
      { label: this.isFull() ? 'Leave fullscreen' : 'Fullscreen', icon: this.isFull() ? I.unfull : I.full, hint: 'F', onClick: () => this.toggleFull() },
      this.track ? { label: 'Stop tracking the conversation', onClick: () => this.stopTrack() } : null
    ]);
  }

  // ------------------------------------------------------------ Time and animation
  setPlaying(p) {
    this.playing = p;
    this.playBtn.innerHTML = p ? I.pause : I.play;
    this.playBtn.title = p ? 'Pause (space)' : 'Play (space)';
  }
  stepOnce() {
    this.setPlaying(false);
    if (!this.sim.step()) toast('No further events');
    this.drawPackets();
  }
  loop(ts) {
    const dt = Math.min(100, ts - (this.lastTs || ts));
    this.lastTs = ts;
    if (this.playing) {
      const sim = this.sim;
      const shown = this.showBpdu ? sim.inflight : sim.inflight.filter(f => !isCtl(f.frame));
      const visible = shown.length;
      if (!visible && sim.inflight.length) sim.runUntil(Math.max(...sim.inflight.map(f => f.t1)));
      if (visible) {
        // One hop takes msPerHop on screen. A slow link (latency) takes longer, but at most 8 hops' worth
        const durs = shown.map(f => f.t1 - f.t0);
        const pace = Math.max(Math.min(...durs), Math.max(...durs) / 8);
        sim.runUntil(sim.time + dt * (pace / this.msPerHop));
        this.idleUntil = 0;
      } else {
        const nt = sim.nextTime();
        if (nt !== null) {
          if (nt - sim.time < TIMING.linkDelay * 0.5) sim.runUntil(nt);
          else if (!this.idleUntil) this.idleUntil = ts + Math.min(500, this.msPerHop * 0.6);
          else if (ts >= this.idleUntil) { this.idleUntil = 0; sim.runUntil(nt); }
        }
      }
    }
    this.drawPackets();
    this.timeEl.textContent = `t = ${(this.sim.time / 1000).toFixed(4)} s`;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }
  drawPackets() {
    const sim = this.sim, seen = new Set();
    const byId = new Map(sim.topo.devices.map(d => [d.id, d]));
    // Group the packets per cable and direction
    const groups = new Map();
    for (const f of sim.inflight) {
      if (!this.showBpdu && isCtl(f.frame)) continue;
      const A = byId.get(f.from), B = byId.get(f.to);
      if (!A || !B) continue;
      const key = f.link.id + (f.from === f.link.a.dev ? 'a' : 'b');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ f, A, B, p: Math.min(1, Math.max(0, (sim.time - f.t0) / (f.t1 - f.t0))) });
    }
    for (const items of groups.values()) {
      // Packets that travel together (a TCP burst) form a small tower beside the cable:
      // every envelope stays visible, they just get smaller the more there are
      const { A, B } = items[0];
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      // Stay on the free part of the cable, not on top of the device cards at its ends
      const m = Math.min(46, len / 2);
      items.forEach(it => { it.s = m + it.p * (len - 2 * m); });
      items.sort((a, b) => a.s - b.s);
      const towers = [];
      for (const it of items) {
        const t = towers[towers.length - 1];
        if (t && it.s - t[0].s < 26) t.push(it); else towers.push([it]);
      }
      for (const tower of towers) {
        const n = tower.length, scale = n === 1 ? 1 : Math.max(0.5, 1 - 0.09 * (n - 1));
        const s0 = tower.reduce((a, it) => a + it.s, 0) / n;
        tower.forEach((it, k) => {
          const { f } = it;
          const off = 9 + (n === 1 ? 0 : 6 * scale) + k * 21 * scale;
          const sAt = n === 1 ? it.s : s0;
          const x = A.x + ux * sAt - uy * off, y = A.y + uy * sAt + ux * off;
          let g = this.pktEls.get(f.id);
          if (!g) {
            g = svgEl('g', { class: 'pkt', role: 'button', 'aria-label': shortLabel(f.frame) });
            const kinds = layerKinds(f.frame);
            const W = 12 + kinds.length * 7, H = 19;
            g.append(svgEl('rect', { class: 'box', x: -W / 2, y: -H / 2, width: W, height: H, rx: 3, fill: 'var(--panel)' }));
            kinds.forEach((kd, i) => g.append(svgEl('rect', { x: -W / 2 + 3.5 + i * 7, y: -H / 2 + 3, width: 6, height: H - 6, rx: 1, fill: `var(--l-${kd})` })));
            const t = svgEl('text', { x: 0, y: H / 2 + 12 }); t.textContent = shortLabel(f.frame);
            g.W = W; g.H = H; g.text = t;
            g.append(t);
            g.addEventListener('pointerdown', e => {
              e.stopPropagation();
              if (e.button === 2) return;
              this.setPlaying(false);
              this.showInLog(f);
            });
            g.addEventListener('contextmenu', e => { this.setPlaying(false); this.packetMenu(e, f); });
            this.gPkts.append(g);
            this.pktEls.set(f.id, g);
          }
          // Alone: label below. In a tower: label beside each envelope, so none covers another
          const side = n > 1 ? 'side' : 'below';
          if (g.labelPos !== side) {
            g.labelPos = side;
            if (side === 'side') { g.text.setAttribute('x', g.W / 2 + 4); g.text.setAttribute('y', 3.5); g.text.setAttribute('class', 'side'); }
            else { g.text.setAttribute('x', 0); g.text.setAttribute('y', g.H / 2 + 12); g.text.removeAttribute('class'); }
          }
          g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})${scale < 1 ? ` scale(${scale.toFixed(2)})` : ''}`);
          seen.add(f.id);
        });
      }
    }
    for (const [id, g] of this.pktEls) if (!seen.has(id)) { g.remove(); this.pktEls.delete(id); }
  }

  fastForward(ms) {
    if (this.sim.halted) return toast('The simulation is halted. Reset the state.');
    this.sim.runFor(ms);
    this.drawPackets();
    this.render();
    if (this.tab === 'tables') this.renderSide();
    toast(`Fast-forwarded ${ms / 1000} s, now t = ${(this.sim.time / 1000).toFixed(1)} s`);
  }
  toggleBpdu() { this.showBpdu = !this.showBpdu; this.bpduBtn.classList.toggle('on', this.showBpdu); this.drawPackets(); }
  hasHellos() { return this.sim.topo.devices.some(d => d.type === 'router' && (d.vrrp?.length || d.ospf?.enabled || d.bfd?.enabled)); }
  updateBpduBar() {
    const stp = this.sim.topo.devices.some(d => d.type === 'switch' && d.stp?.enabled), hellos = this.hasHellos();
    this.bpduBar?.classList.toggle('hidden', !stp && !hellos);
    if (this.bpduBtn) this.bpduBtn.textContent = stp && hellos ? 'BPDUs & hellos' : stp ? 'BPDUs' : 'Hellos';
  }
  renderSoon() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, 80);
  }
  showStorm(info) {
    this.stormEl.innerHTML = '';
    this.stormEl.classList.toggle('hidden', !info);
    if (!info) return;
    this.stormEl.append(h('div', {}, h('b', {}, 'Simulation halted. '), info.text),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => this.resetState() }, 'Reset state'),
        h('span', { class: 'small muted' }, 'Then remove the loop or turn on spanning tree.')));
  }

  // ------------------------------------------------------------ Helpers for lessons
  run(devName, cmd) {
    const d = this.sim.dev(devName);
    if (!d) return;
    import('./cli.js').then(m => { m.runCommand(d, cmd); if (this.sel?.id === d.id) this.consoleEl?.refresh(); });
  }
  selectByName(name, tab) {
    const d = this.sim.dev(name);
    if (d) { this.tab = tab || this.tab; this.select({ kind: 'dev', id: d.id }); this.renderSide(); }
  }
}
