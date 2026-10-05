// PacketPilot: views and navigation
import { h, toast, download, pickFile } from './ui.js';
import { I } from './icons.js';
import { store } from './store.js';
import { MODULES, UPCOMING, findLesson, nextLesson } from './course/index.js';
import { renderWidget } from './widgets.js';
import { Lab } from './lab.js';
import { PRESETS } from './presets.js';
import { preview, heroSim } from './minimap.js';
import { renderFrameBuilder } from './framebuilder.js';
import { clone } from './net.js';

const main = document.querySelector('.main');
let cleanup = [];
function clear() { cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); cleanup = []; main.innerHTML = ''; main.scrollTop = 0; }

// ---------------------------------------------------------------- Theme
function applyTheme() {
  const t = store.prefs.theme;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const btn = document.querySelector('#theme');
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  btn.innerHTML = (dark ? I.sun : I.moon) + (dark ? 'Light' : 'Dark');
}
document.querySelector('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  store.setPref('theme', dark ? 'light' : 'dark');
  applyTheme();
});
applyTheme();

// ---------------------------------------------------------------- Home page and course
function lessonProgress(l) { return { done: store.lessonDone(l.id), steps: store.lessonSteps(l.id), total: l.steps.length }; }
function viewHome() {
  const page = h('div', { class: 'page' });
  const heroBox = h('div', { class: 'hero-lab' }, h('span', { class: 'caption' }, 'Live: pc1 pings srv1. Every stripe on the envelope is a layer.'));
  const flat = MODULES.flatMap(m => m.lessons);
  const next = flat.find(l => !store.lessonDone(l.id)) || flat[0];
  const doneCount = flat.filter(l => store.lessonDone(l.id)).length;
  page.append(h('section', { class: 'hero' },
    h('div', {},
      h('h1', {}, 'PacketPilot'),
      h('p', {}, 'Understand networks by watching every packet. Build networks, send packets in slow motion, take every frame apart layer by layer and find faults before they find you in a real network.'),
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('a', { class: 'btn primary', href: `#/lesson/${next.id}` }, doneCount ? 'Continue learning' : 'Start with lesson 1'),
        h('a', { class: 'btn', href: '#/lab' }, 'Open the free lab')),
      h('div', { class: 'small muted', style: { marginTop: '12px' } }, `${doneCount} of ${flat.length} lessons completed`)),
    heroBox));
  page.append(h('h2', { style: { marginTop: '18px' } }, 'Course'));
  const mods = h('div', { class: 'modules' });
  MODULES.forEach((m, mi) => {
    const lp = m.lessons.map(lessonProgress);
    const allDone = lp.every(x => x.done);
    const list = h('ol', { class: 'lessons' });
    m.lessons.forEach((l, li) => {
      const p = lp[li];
      list.append(h('li', {}, h('a', { href: `#/lesson/${l.id}` },
        h('span', { class: 'st' + (p.done ? ' ok' : ''), html: p.done ? I.check : I.circle }),
        h('span', {}, l.title),
        h('span', { class: 'meta' }, p.done ? 'done' : p.steps ? `${p.steps} of ${p.total} steps` : `${l.minutes} min`))));
    });
    const pct = Math.round(lp.filter(x => x.done).length / lp.length * 100);
    mods.append(h('article', { class: 'module' + (allDone ? ' done' : '') },
      h('div', { class: 'num', 'aria-hidden': 'true' }, String(mi + 1)),
      h('div', {},
        h('h2', {}, m.title),
        h('div', { class: 'bands', 'aria-hidden': 'true' }, m.bands.map(b => h('i', { class: `bg-${b}` }))),
        h('p', { class: 'muted' }, m.text),
        h('div', { class: 'progressbar', title: `${pct} % done` }, h('i', { style: { width: `${pct}%` } })),
        list)));
  });
  page.append(mods);
  page.append(h('h2', { style: { marginTop: '28px' } }, 'Coming soon'),
    h('div', { class: 'netgrid' }, UPCOMING.map(u => h('div', { class: 'netcard' }, h('h3', {}, u.title), h('p', { class: 'muted small' }, u.text)))));
  page.append(h('div', { class: 'row', style: { marginTop: '28px' } },
    h('button', { class: 'btn', html: I.download + 'Export progress and networks', onclick: () => download('packetpilot-export.json', store.exportAll()) }),
    h('button', { class: 'btn', html: I.upload + 'Import', onclick: async () => { const t = await pickFile(); if (!t) return; try { store.importAll(t); toast('Import successful'); route(); } catch (e) { toast(e.message); } } }),
    h('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset progress for all lessons?')) { store.resetProgress(); route(); } } }, 'Reset progress')));
  main.append(page);
  const heroTopo = PRESETS.find(p => p.id === 'routed').make();
  heroTopo.devices = heroTopo.devices.filter(d => d.id !== 'pc2');
  heroTopo.links = heroTopo.links.filter(l => l.a.dev !== 'pc2');
  let n = 0;
  cleanup.push(heroSim(heroBox, heroTopo, sim => {
    if (n++ % 2 === 0) for (const d of sim.devices.values()) d.l3?.arp.clear();
    sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  }));
}

// ---------------------------------------------------------------- Lesson
function viewLesson(id, stepIdx) {
  const f = findLesson(id);
  if (!f) return viewHome();
  const { module: m, lesson: l } = f;
  let cur = Math.min(Math.max(0, Number(stepIdx) || 0), l.steps.length - 1);
  if (stepIdx === undefined) { const first = l.steps.findIndex((_, i) => !store.stepDone(l.id, i)); cur = first < 0 ? 0 : first; }
  const step = l.steps[cur];
  const top = h('div', { class: 'lesson-top' },
    h('a', { class: 'btn icon ghost', href: '#/', title: 'Back to the course overview', html: I.left }),
    h('div', {}, h('div', { class: 'crumb' }, `Module ${MODULES.indexOf(m) + 1}: ${m.title}`), h('h1', {}, l.title)));
  const steps = h('div', { class: 'steps', 'aria-label': 'Steps' });
  l.steps.forEach((s, i) => steps.append(h('button', { class: (i === cur ? 'cur ' : '') + (store.stepDone(l.id, i) ? 'ok' : ''), title: s.title || s.type,
    onclick: () => go(i), 'aria-current': i === cur ? 'step' : null }, store.stepDone(l.id, i) && i !== cur ? '✓' : String(i + 1))));
  top.append(steps);
  const body = h('div', { class: 'lesson-body' });
  const nextBtn = h('button', { class: 'btn primary' });
  const status = h('span', { class: 'small muted' });
  const nav = h('div', { class: 'lesson-nav' },
    h('button', { class: 'btn', disabled: cur === 0 ? true : null, onclick: () => go(cur - 1), html: I.left + 'Back' }), status, nextBtn);
  const go = i => { location.hash = `#/lesson/${l.id}/${i}`; };
  const isLast = cur === l.steps.length - 1;
  const markDone = () => {
    store.markStep(l.id, cur);
    steps.children[cur].classList.add('ok');
    if (l.steps.every((_, i) => store.stepDone(l.id, i))) store.markLesson(l.id);
    nextBtn.disabled = false;
    status.textContent = step.type === 'theory' ? '' : 'Step complete';
  };
  const nl = nextLesson(l.id);
  nextBtn.innerHTML = isLast ? (nl ? 'Next lesson' : 'To the overview') + I.right : 'Next' + I.right;
  nextBtn.addEventListener('click', () => {
    if (!isLast) return go(cur + 1);
    location.hash = nl ? `#/lesson/${nl.id}` : '#/';
  });
  const done0 = store.stepDone(l.id, cur);
  if (step.type !== 'theory' && !done0) { nextBtn.disabled = true; status.textContent = step.type === 'lab' ? 'Complete the goals on the left to continue' : 'Solve the exercise to continue'; }
  main.append(h('div', { class: 'lesson' }, top, body, nav));

  if (step.type === 'theory') {
    body.append(h('article', { class: 'theory' }, h('h2', { style: { marginTop: 0 } }, step.title), h('div', { html: step.html })));
    markDone();
  } else if (step.type === 'lab') {
    labStep(step, body, markDone, done0, l.id + ':' + cur);
  } else {
    renderWidget({ ...step, id: l.id + cur }, body, markDone);
    if (done0) { nextBtn.disabled = false; status.textContent = 'Already done, but you can solve it again'; }
  }
}

function labStep(step, body, markDone, already, key) {
  body.classList.add('is-lab');
  const col = h('div', { class: 'goalcol' });
  const labRoot = h('div', { style: { minHeight: 0, minWidth: 0 } });
  body.append(col, labRoot);
  const ctx = { inspected: [] };
  const goalState = step.goals.map(() => false);
  const lab = new Lab(labRoot, { topo: step.topo(), edit: step.edit || 'config', compact: true, consolePresets: step.presets,
    onEvent: (type, data) => {
      if (type === 'inspect') ctx.inspected.push(data);
      if (type === 'sim' && data.type === 'tick') return;
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; evaluate(); }); }
    } });
  let pending = false;
  cleanup.push(() => lab.destroy());
  col.append(h('h2', {}, step.title), h('div', { class: 'theory', style: { padding: 0 }, html: step.intro || '' }));
  const list = h('ol', { class: 'goals' });
  const items = step.goals.map((g, i) => {
    const li = h('li', {}, h('span', { class: 'st', html: I.circle }), h('div', { class: 'txt' }, h('span', { html: g.text })));
    if (g.ask) {
      const inp = h('input', { class: 'input mono', placeholder: g.placeholder || 'Answer', 'aria-label': 'Answer' });
      const fb = h('span', { class: 'small' });
      const test = () => {
        const exp = g.expect(lab.sim).map(x => String(x).toLowerCase().trim());
        const ok = exp.includes(inp.value.toLowerCase().trim());
        fb.textContent = ok ? '' : 'Not yet, take another close look';
        fb.style.color = 'var(--err)';
        if (ok) { goalState[i] = true; inp.disabled = true; evaluate(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') test(); });
      li.querySelector('.txt').append(h('div', { class: 'ask' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, inp, h('button', { class: 'btn', onclick: test }, 'Check')), fb));
    }
    list.append(li);
    return li;
  });
  col.append(list);
  const hintBox = h('div');
  if (step.hints?.length) {
    let shown = 0;
    const btn = h('button', { class: 'btn ghost', html: I.bulb + 'Show a hint' });
    btn.addEventListener('click', () => { hintBox.append(h('div', { class: 'hint' }, step.hints[shown++])); if (shown >= step.hints.length) btn.remove(); });
    col.append(btn, hintBox);
  }
  const outro = h('div');
  col.append(outro);
  col.append(h('div', { class: 'row', style: { marginTop: '16px' } },
    h('button', { class: 'btn ghost', html: I.reset + 'Reload network', onclick: () => { lab.load(step.topo()); ctx.inspected = []; } })));
  let finished = false;
  function evaluate() {
    step.goals.forEach((g, i) => {
      if (!goalState[i] && g.check && g.check(lab.sim, ctx)) goalState[i] = true;
      items[i].classList.toggle('ok', goalState[i]);
      items[i].querySelector('.st').innerHTML = goalState[i] ? I.check : I.circle;
    });
    if (!finished && goalState.every(Boolean)) {
      finished = true;
      outro.append(h('div', { class: 'done-banner' }, 'All goals reached.'));
      if (step.outro) outro.append(h('div', { class: 'theory', style: { padding: '10px 0 0' }, html: step.outro }));
      markDone();
    }
  }
  if (already) { const n = h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'You have already completed this step. You can still play through it again.'); col.insertBefore(n, list); }
  // Open the first console so it is clear where to start
  const firstDev = Object.keys(step.presets || {})[0];
  if (firstDev) lab.selectByName(firstDev, 'console');
}

// ---------------------------------------------------------------- Lab
function viewLab(presetId) {
  let topo;
  if (presetId) topo = PRESETS.find(p => p.id === presetId)?.make();
  if (!topo) topo = store.prefs.sandbox ? clone(store.prefs.sandbox) : PRESETS.find(p => p.id === 'routed').make();
  const nameIn = h('input', { class: 'input', value: topo.name || 'My network', 'aria-label': 'Network name', style: { width: '220px' } });
  const savedSel = h('select', { class: 'input', 'aria-label': 'Saved networks' });
  const fillSaved = () => {
    savedSel.innerHTML = '';
    savedSel.append(h('option', { value: '' }, 'Saved networks …'));
    for (const n of Object.keys(store.nets()).sort()) savedSel.append(h('option', { value: n }, n));
  };
  fillSaved();
  const root = h('div', { style: { minHeight: 0 } });
  const page = h('div', { class: 'labpage' }, h('div', { class: 'labbar' },
    h('span', { class: 'title' }, 'Lab'), nameIn,
    h('button', { class: 'btn', html: I.save + 'Save', onclick: () => { lab.sim.topo.name = nameIn.value.trim() || 'My network'; store.saveNet(lab.sim.topo.name, clone(lab.sim.topo)); fillSaved(); toast(`"${lab.sim.topo.name}" saved`); } }),
    savedSel,
    h('button', { class: 'btn ghost', onclick: () => { const n = savedSel.value; if (n && confirm(`Delete "${n}"?`)) { store.deleteNet(n); fillSaved(); } } }, 'Delete'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => { if (confirm('Start an empty network? Unsaved changes will be lost.')) { lab.load({ name: 'My network', devices: [], links: [] }); nameIn.value = 'My network'; } } }, 'New'),
    h('a', { class: 'btn', href: '#/networks' }, 'Example networks'),
    h('button', { class: 'btn', html: I.download + 'Export', onclick: () => download(`${(lab.sim.topo.name || 'network').replace(/\W+/g, '-')}.json`, JSON.stringify(lab.sim.topo, null, 2)) }),
    h('button', { class: 'btn', html: I.upload + 'Import', onclick: async () => {
      const t = await pickFile(); if (!t) return;
      try { const d = JSON.parse(t); if (!Array.isArray(d.devices) || !Array.isArray(d.links)) throw new Error(); lab.load(d); nameIn.value = d.name || 'Imported'; toast('Network imported'); }
      catch { toast('This file is not a PacketPilot network'); }
    } })), root);
  main.append(page);
  const lab = new Lab(root, { topo, edit: 'full', onEvent: type => { if (['config', 'added', 'deleted', 'linked', 'moved', 'renamed'].includes(type)) autosave(); } });
  let t;
  const autosave = () => { clearTimeout(t); t = setTimeout(() => store.setPref('sandbox', clone(lab.sim.topo)), 400); };
  savedSel.addEventListener('change', () => { const n = savedSel.value; if (!n) return; lab.load(clone(store.nets()[n].topo)); nameIn.value = n; autosave(); });
  nameIn.addEventListener('change', () => { lab.sim.topo.name = nameIn.value; autosave(); });
  if (presetId) autosave();
  cleanup.push(() => lab.destroy());
}

// ---------------------------------------------------------------- Example networks
function viewNets() {
  const page = h('div', { class: 'page' }, h('h1', {}, 'Example networks'),
    h('p', { class: 'muted' }, 'Ready-made topologies to experiment with. A network opens in the lab, where you can change everything and save it under your own name.'));
  const grid = h('div', { class: 'netgrid' });
  for (const p of PRESETS) {
    grid.append(h('article', { class: 'netcard' }, preview(p.make()), h('h3', {}, p.title),
      h('div', { class: 'row' }, p.topics.map(t => h('span', { class: 'chip' }, t))),
      h('p', { class: 'muted small' }, p.text),
      h('div', {}, h('a', { class: 'btn primary', href: `#/lab/${p.id}` }, 'Open in the lab'))));
  }
  page.append(grid);
  main.append(page);
}

// ---------------------------------------------------------------- Router
// Older German links (#/lektion, #/labor, #/netze, #/baukasten) keep working
const ALIAS = { lektion: 'lesson', labor: 'lab', netze: 'networks', baukasten: 'builder' };
function route() {
  clear();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const nav = ALIAS[parts[0]] || parts[0] || '';
  document.querySelectorAll('.rail a').forEach(a => a.classList.toggle('active',
    (a.dataset.nav === 'course' && (nav === '' || nav === 'lesson')) || a.dataset.nav === nav));
  if (nav === 'lesson') viewLesson(parts[1], parts[2]);
  else if (nav === 'lab') viewLab(parts[1]);
  else if (nav === 'networks') viewNets();
  else if (nav === 'builder') { renderFrameBuilder(main); }
  else viewHome();
  document.title = 'PacketPilot';
}
window.addEventListener('hashchange', route);
route();
