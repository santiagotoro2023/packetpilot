// Appname: views and navigation. Built exactly like PacketPilot's src/js/app.js:
// one hash router, every view renders into <main class="main">, h() builds the DOM.
import { h, toast, contextMenu, resizer } from './ui.js';
import { I } from './icons.js';

const STORE_KEY = 'appname.v1';   // the same key as in the <head> script of index.html
const main = document.querySelector('.main');
let cleanup = [];
function clear() { cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); cleanup = []; main.innerHTML = ''; main.scrollTop = 0; }

// ---------------------------------------------------------------- Settings in localStorage
const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } };
const state = load();
state.prefs ??= {};
const setPref = (k, v) => { state.prefs[k] = v; try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ } };

// ---------------------------------------------------------------- Theme
function applyTheme() {
  const t = state.prefs.theme;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const btn = document.querySelector('#theme');
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  btn.innerHTML = `<span>${dark ? I.sun : I.moon}</span>${dark ? 'Light' : 'Dark'}`;
}
document.querySelector('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  setPref('theme', dark ? 'light' : 'dark');
  applyTheme();
});
applyTheme();

// ---------------------------------------------------------------- Home
const SECTIONS = [
  { title: 'Getting started', bands: ['input', 'process'], text: 'One or two sentences about this section: what is in it and why it matters.',
    items: [['First item', '8 min', true], ['Second item', '12 min', true], ['Third item', '10 min', false]] },
  { title: 'Going further', bands: ['process', 'store', 'output'], text: 'Another short description. Plain words, no marketing.',
    items: [['Fourth item', '15 min', false], ['Fifth item', '20 min', false]] }
];
function viewHome() {
  const page = h('div', { class: 'page' });
  const flat = SECTIONS.flatMap(s => s.items);
  const done = flat.filter(x => x[2]).length;
  page.append(h('section', { class: 'hero' },
    h('div', {},
      h('h1', {}, 'Appname'),
      h('p', {}, 'One or two sentences that say what this app does and for whom. Concrete verbs, no superlatives, no exclamation marks.'),
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('a', { class: 'btn primary', href: '#/step/1' }, done ? 'Continue' : 'Start here'),
        h('a', { class: 'btn', href: '#/work' }, 'Open the workspace')),
      h('div', { class: 'small muted', style: { marginTop: '12px' } }, `${done} of ${flat.length} items completed`)),
    h('div', { class: 'hero-visual' }, h('div', { class: 'canvas-wrap', style: { position: 'absolute', inset: '0' } }),
      h('span', { class: 'caption' }, 'Live: a real, moving example of what the app does.'))));
  page.append(h('div', { class: 'row', style: { marginTop: '18px', justifyContent: 'space-between' } }, h('h2', { style: { margin: 0 } }, 'Sections'),
    h('a', { class: 'btn ghost', href: '#/components', html: I.print + 'Secondary action' })));
  const mods = h('div', { class: 'modules' });
  SECTIONS.forEach((m, mi) => {
    const allDone = m.items.every(x => x[2]);
    const pct = Math.round(m.items.filter(x => x[2]).length / m.items.length * 100);
    mods.append(h('article', { class: 'module' + (allDone ? ' done' : '') },
      h('div', { class: 'num', 'aria-hidden': 'true' }, String(mi + 1)),
      h('div', {},
        h('h2', {}, m.title),
        h('div', { class: 'bands', 'aria-hidden': 'true' }, m.bands.map(b => h('i', { class: `bg-${b}` }))),
        h('p', { class: 'muted' }, m.text),
        h('div', { class: 'progressbar', title: `${pct} % done` }, h('i', { style: { width: `${pct}%` } })),
        h('ol', { class: 'lessons' }, m.items.map(([t, meta, ok], i) => h('li', {}, h('a', { href: `#/step/${i + 1}` },
          h('span', { class: 'st' + (ok ? ' ok' : ''), html: ok ? I.check : I.circle }),
          h('span', {}, t),
          h('span', { class: 'meta' }, ok ? 'done' : meta))))))));
  });
  page.append(mods);
  page.append(h('h2', { style: { marginTop: '28px' } }, 'Practice'),
    h('div', { class: 'cardgrid' },
      h('a', { class: 'tile', href: '#/work' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'pico', html: I.fix }), h('h3', { style: { margin: 0 } }, 'A practice area')),
        h('p', { class: 'muted small' }, 'What you do here, in one sentence.'), h('div', { class: 'small muted' }, '3 of 12 solved')),
      h('a', { class: 'tile', href: '#/library' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'pico', html: I.calc }), h('h3', { style: { margin: 0 } }, 'Another area')),
        h('p', { class: 'muted small' }, 'Again one sentence. Tiles in one grid have the same structure.'), h('div', { class: 'small muted' }, 'Endless questions'))));
  page.append(h('section', { class: 'databox', 'aria-labelledby': 'datah' },
    h('h2', { id: 'datah' }, 'Your data'),
    h('p', { class: 'muted' }, 'Everything you do is kept in this browser, for this address. Download a backup to move it to another browser or server.'),
    h('div', { class: 'row small', style: { margin: '8px 0 12px', gap: '14px' } }, [[2, 'items done'], [1, 'saved things'], [7, 'best streak']].map(([n, t]) => h('span', { class: 'stat' }, h('b', {}, String(n)), ' ' + t))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', html: I.download + 'Download backup', onclick: () => toast('Backup downloaded') }),
      h('button', { class: 'btn', html: I.upload + 'Restore backup', onclick: () => toast('Backup restored: 2 items, 1 saved thing') }),
      h('button', { class: 'btn ghost', onclick: () => toast('Nothing was reset in the kit') }, 'Reset progress'))));
  main.append(page);
}

// ---------------------------------------------------------------- Library: a grid of tiles
function viewLibrary() {
  const page = h('div', { class: 'page' }, h('h1', {}, 'Library'),
    h('p', { class: 'muted' }, 'A short sentence that says what is on this page and what you can do with it.'));
  const grid = h('div', { class: 'cardgrid' });
  for (const [t, chips, text] of [['First example', ['Topic', 'Another'], 'Two lines at most about this example.'], ['Second example', ['Topic'], 'What makes this one different.'], ['Third example', ['Topic', 'More', 'Third'], 'Each tile ends with exactly one primary button.']]) {
    grid.append(h('article', { class: 'tile' }, h('div', { class: 'canvas-wrap', style: { height: '120px', borderRadius: 'var(--r-s)', border: '1px solid var(--grid-strong)' } }), h('h3', {}, t),
      h('div', { class: 'row' }, chips.map(c => h('span', { class: 'chip' }, c))),
      h('p', { class: 'muted small' }, text),
      h('div', {}, h('a', { class: 'btn primary', href: '#/work' }, 'Open'))));
  }
  page.append(grid);
  main.append(page);
}

// ---------------------------------------------------------------- Step page: top bar, reading text, bottom bar
function viewStep(n) {
  const cur = Math.min(Math.max(1, Number(n) || 1), 4);
  const top = h('div', { class: 'lesson-top' },
    h('a', { class: 'btn icon ghost', href: '#/', title: 'Back to the overview', html: I.left }),
    h('div', {}, h('div', { class: 'crumb' }, 'Section 1: Getting started'), h('h1', {}, 'First item')),
    h('div', { class: 'steps', 'aria-label': 'Steps' }, [1, 2, 3, 4].map(i => h('button', { class: (i === cur ? 'cur ' : '') + (i < cur ? 'ok' : ''), onclick: () => { location.hash = `#/step/${i}`; } }, i < cur ? '✓' : String(i)))));
  const body = h('div', { class: 'lesson-body' }, h('article', { class: 'theory' },
    h('h2', { style: { marginTop: 0 } }, 'A heading for this step'),
    h('div', { html: `
<p>Reading text has a measure of at most 70 characters per line. Paragraphs are short. <b>Bold</b> marks the one term the paragraph is about; <code>code</code> is for things you type.</p>
<ul><li>Lists are for three or more parallel things.</li><li>Each item is one line if it can be.</li></ul>
<div class="note">A note adds one useful aside. It is never a warning in disguise.</div>
<div class="note warn">A warning note says what goes wrong and how to avoid it.</div>
<h2>A second heading</h2>
<table><tr><th>Column</th><th>Meaning</th></tr><tr><td><b>First</b></td><td>Tables compare things side by side</td></tr><tr><td>Second</td><td>The first column names, the others explain</td></tr></table>
<pre>$ a command you can type
the answer it prints</pre>` })));
  const nav = h('div', { class: 'lesson-nav' },
    h('button', { class: 'btn', disabled: cur === 1 ? true : null, onclick: () => { location.hash = `#/step/${cur - 1}`; }, html: I.left + 'Back' }),
    h('span', { class: 'small muted' }, cur === 4 ? 'Last step' : ''),
    h('button', { class: 'btn primary', onclick: () => { location.hash = cur === 4 ? '#/' : `#/step/${cur + 1}`; }, html: (cur === 4 ? 'To the overview' : 'Next') + I.right }));
  main.append(h('div', { class: 'lesson' }, top, body, nav));
}

// ---------------------------------------------------------------- Work page: task column + work area
function viewWork() {
  const top = h('div', { class: 'lesson-top' },
    h('a', { class: 'btn icon ghost', href: '#/', title: 'Back to the overview', html: I.left }),
    h('div', {}, h('div', { class: 'crumb' }, 'Practice · Beginner'), h('h1', {}, 'A task with goals')),
    h('span', { class: 'chtimer', html: I.timer + '1:24' }));
  const body = h('div', { class: 'lesson-body is-lab' });
  const col = h('div', { class: 'goalcol' },
    h('h2', {}, 'The task'),
    h('div', { class: 'theory', style: { padding: 0 }, html: '<p>What to do, in two or three sentences. The goals below tick themselves off.</p>' }),
    h('ol', { class: 'goals' },
      h('li', { class: 'ok' }, h('span', { class: 'st', html: I.check }), h('div', { class: 'txt' }, h('span', {}, 'A goal that is already reached.'))),
      h('li', {}, h('span', { class: 'st', html: I.circle }), h('div', { class: 'txt' }, h('span', {}, 'A goal that asks a question.'),
        h('div', { class: 'ask' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('input', { class: 'input mono', placeholder: 'Answer', 'aria-label': 'Answer' }), h('button', { class: 'btn' }, 'Check')))))),
    h('button', { class: 'btn ghost', html: I.bulb + 'Show a hint', onclick: e => { e.currentTarget.after(h('div', { class: 'hint' }, 'A hint points in the right direction without giving the answer.')); e.currentTarget.remove(); } }),
    h('div', { class: 'done-banner' }, 'All goals reached.'),
    h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn ghost', html: I.reset + 'Start over' })));
  const area = h('div', { class: 'canvas-wrap', oncontextmenu: e => contextMenu(e, [
    { label: 'An action', icon: I.plus, onClick: () => toast('An action') },
    { label: 'Another action', icon: I.eye, hint: 'Ctrl+E' }, '-',
    { label: 'Delete', icon: I.trash, danger: true }], 'Right-click menu') },
  h('div', { class: 'hint-overlay' }, 'Right-click the work area for a menu'));
  const place = () => { rz.style.left = `${col.offsetWidth - 5}px`; rz.style.top = '0'; rz.style.height = `${body.clientHeight}px`; };
  const rz = resizer('col', {
    onMove: e => { const r = body.getBoundingClientRect(); body.style.setProperty('--goal-w', Math.round(Math.min(Math.max(e.clientX - r.left, 240), 720)) + 'px'); place(); },
    onReset: () => { body.style.removeProperty('--goal-w'); place(); } });
  body.append(col, area, rz);
  main.append(h('div', { class: 'lesson' }, top, body));
  const ro = new ResizeObserver(place); ro.observe(body); cleanup.push(() => ro.disconnect());
}

// ---------------------------------------------------------------- Parts: every component once
function viewComponents() {
  const sec = (title, ...kids) => [h('h2', { style: { marginTop: '28px' } }, title), ...kids];
  const tabs = h('div', { class: 'tabs subtabs', role: 'tablist' }, ['First', 'Second', 'Third'].map((t, i) => h('button', { class: i === 0 ? 'cur' : '', role: 'tab' }, t)));
  tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('cur', x === b)); });
  const dlg = () => {
    const d = h('dialog', { class: 'dlg' }, h('h3', {}, 'A dialog'), h('p', { class: 'muted' }, 'Dialogs are rare: only for something the user has to read or copy before going on.'),
      h('input', { class: 'input mono', value: 'https://example.com/#/share/…', readonly: true, style: { width: '100%' } }),
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: () => d.close() }, 'Copy link'), h('button', { class: 'btn ghost', onclick: () => d.close() }, 'Close')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  };
  const page = h('div', { class: 'page' }, h('h1', {}, 'Parts'),
    h('p', { class: 'muted', style: { maxWidth: '68ch' } }, 'Every building block of the design system, once. New pages are put together from these parts and nothing else.'),
    ...sec('Buttons', h('div', { class: 'row' },
      h('button', { class: 'btn primary' }, 'Primary'), h('button', { class: 'btn' }, 'Secondary'), h('button', { class: 'btn ghost' }, 'Ghost'),
      h('button', { class: 'btn', html: I.download + 'With icon' }), h('button', { class: 'btn icon ghost', title: 'Icon only', html: I.share }),
      h('button', { class: 'btn on' }, 'Switched on'), h('button', { class: 'btn danger-soft' }, 'Delete'), h('button', { class: 'btn', disabled: true }, 'Disabled'),
      h('button', { class: 'linkbtn' }, 'Link button'))),
    ...sec('Fields', h('div', { class: 'row', style: { alignItems: 'end' } },
      h('label', { class: 'field' }, 'Name', h('input', { class: 'input', value: 'Text' })),
      h('label', { class: 'field' }, 'Address', h('input', { class: 'input mono', value: '192.168.1.10' })),
      h('label', { class: 'field' }, 'Wrong value', h('input', { class: 'input bad', value: 'abc' })),
      h('label', { class: 'field' }, 'Choice', h('select', { class: 'input' }, h('option', {}, 'Medium'), h('option', {}, 'Hard'))),
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: true }), 'A checkbox')),
      h('div', { class: 'feedback ok' }, 'Right. A short confirmation.'), h('div', { class: 'feedback bad' }, 'Not yet. Say what is wrong.')),
    ...sec('Chips, levels, progress', h('div', { class: 'row' },
      h('span', { class: 'chip' }, 'Topic'), h('span', { class: 'chip on' }, 'On'), h('span', { class: 'lvl', title: 'Level 2 of 3' }, [1, 2, 3].map(i => h('i', { class: i <= 2 ? 'on' : '' }))),
      h('div', { class: 'progressbar', style: { width: '200px' } }, h('i', { style: { width: '40%' } })))),
    ...sec('Tabs', tabs, h('div', { class: 'subcard', style: { marginTop: '12px' } }, h('div', { class: 'small muted' }, 'A narrow card (subcard) for one question or one form.'), h('div', { style: { fontSize: '1.35rem', fontWeight: 650, margin: '8px 0 14px' } }, 'A question in large type?'))),
    ...sec('Collapsible sections', h('div', { style: { maxWidth: '420px' } },
      h('details', { class: 'sect', open: true }, h('summary', {}, 'Open section', h('span', { class: 'sect-status on' }, 'on')), h('div', { class: 'sect-body' }, h('p', { class: 'small muted' }, 'Content of the section.'))),
      h('details', { class: 'sect' }, h('summary', {}, 'Closed section', h('span', { class: 'sect-status' }, 'off')), h('div', { class: 'sect-body' }, 'Hidden until opened.')),
      h('div', { class: 'features' }, h('button', { class: 'btn addfeat', html: I.plus + 'Add a feature <span class="small muted">optional things stay hidden until added</span>' })))),
    ...sec('Data', h('div', { class: 'row', style: { alignItems: 'start', gap: '24px' } },
      h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Value')), h('tr', {}, h('td', {}, 'alpha'), h('td', {}, '10.0.0.1')), h('tr', {}, h('td', {}, 'beta'), h('td', {}, '10.0.0.2'))),
      h('dl', { class: 'kv' }, h('dt', {}, 'Key'), h('dd', {}, 'value'), h('dt', {}, 'Other key'), h('dd', {}, 'other value')),
      h('div', { style: { width: '320px' } }, h('table', { class: 'tbl' }, h('tr', {}, h('th', {}, 'Dense'), h('th', {}, 'Table')), h('tr', {}, h('td', {}, 'for panels'), h('td', {}, '12:00:01'))), h('div', { class: 'empty' }, 'Nothing here yet.'))),
      h('div', { class: 'list', style: { maxWidth: '420px', marginTop: '12px' } }, h('div', { class: 'item' }, 'A list item in a panel'), h('div', { class: 'item' }, 'Another item'))),
    ...sec('Exercise', h('div', { class: 'quiz-q', style: { maxWidth: '760px' } }, h('div', {}, h('b', {}, 'A question?')),
      h('div', { class: 'opts' }, h('label', { class: 'right' }, h('input', { type: 'radio', checked: true }), h('span', {}, 'The right answer, marked after checking')), h('label', {}, h('input', { type: 'radio' }), h('span', {}, 'Another answer')), h('label', { class: 'wrong' }, h('input', { type: 'radio' }), h('span', {}, 'A wrong answer that was picked'))),
      h('div', { class: 'explain' }, 'The explanation says why, in one or two sentences.'))),
    ...sec('Terminal', h('div', { class: 'console', style: { maxWidth: '620px', minHeight: '0', height: 'auto' } }, h('pre', { style: { minHeight: '90px' } }, '$ command --option\nThe answer of the command.'),
      h('div', { class: 'in' }, h('input', { class: 'input', placeholder: 'Type a command' }), h('button', { class: 'btn primary' }, 'Run')), h('div', { class: 'quick' }, h('button', { class: 'btn' }, 'a preset'), h('button', { class: 'btn' }, 'another')))),
    ...sec('Messages and overlays', h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => toast('A toast: one short sentence, gone after 2.6 seconds') }, 'Show a toast'),
      h('button', { class: 'btn', onclick: dlg }, 'Open a dialog'),
      h('button', { class: 'btn', onclick: e => contextMenu(e, [{ label: 'Rename', icon: I.sliders, hint: 'F2' }, { label: 'Duplicate', icon: I.plus }, '-', { label: 'Delete', icon: I.trash, danger: true }], 'Menu title') }, 'Open a menu'),
      h('span', {}, 'A ', h('abbr', { class: 'gl', title: 'A term is explained on hover, quietly.' }, 'term'), ' in running text.'))));
  main.append(page);
}

// ---------------------------------------------------------------- Router
function markNav(nav) {
  document.querySelectorAll('.rail a').forEach(a => a.classList.toggle('active', (a.dataset.nav === 'home' && (nav === '' || nav === 'step')) || a.dataset.nav === nav));
}
function route() {
  clear();
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const nav = parts[0] || '';
  markNav(nav);
  if (nav === 'step') viewStep(parts[1]);
  else if (nav === 'work') viewWork();
  else if (nav === 'library') viewLibrary();
  else if (nav === 'components') viewComponents();
  else viewHome();
  document.title = 'Appname';
}
window.addEventListener('hashchange', route);
route();
