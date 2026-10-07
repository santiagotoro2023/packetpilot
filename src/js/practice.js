// Practice: troubleshooting challenges and the subnetting trainer
import { h, resizer } from './ui.js';
import { I } from './icons.js';
import { store } from './store.js';
import { Lab } from './lab.js';
import { clone } from './net.js';
import { CHALLENGES, LEVELS, challengeTopo } from './challenges.js';
import { MODES, LEVELS as SUB_LEVELS, explain, checkField, maskStr } from './subnet.js';

const fmtTime = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const levelDots = l => h('span', { class: 'lvl', title: LEVELS[l], 'aria-label': LEVELS[l] }, [1, 2, 3].map(i => h('i', { class: i <= l ? 'on' : '' })));

// ================================================================ Troubleshooting: overview
export function viewChallenges(main, cleanup, id) {
  if (id) return viewChallenge(main, cleanup, id);
  const solved = CHALLENGES.filter(c => store.challenge(c.id)?.solved).length;
  const page = h('div', { class: 'page' }, h('h1', {}, 'Troubleshooting'),
    h('p', { class: 'muted', style: { maxWidth: '68ch' } }, 'Every network here has one hidden fault. You get the symptom, the rest is up to you: test, read the log, compare configurations, fix it. Each challenge has several variants with a different cause, so trying again is worth it.'),
    h('div', { class: 'small muted' }, `${solved} of ${CHALLENGES.length} solved`));
  for (const lvl of [1, 2, 3]) {
    const list = CHALLENGES.filter(c => c.level === lvl);
    page.append(h('h2', { style: { marginTop: '22px' } }, LEVELS[lvl]));
    page.append(h('div', { class: 'netgrid' }, list.map(c => {
      const st = store.challenge(c.id);
      return h('a', { class: 'netcard chcard' + (st?.solved ? ' solved' : ''), href: `#/troubleshoot/${c.id}` },
        h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'nowrap' } }, h('h3', { style: { margin: 0 } }, c.title), st?.solved ? h('span', { class: 'st ok', html: I.check, title: 'solved' }) : levelDots(c.level)),
        h('div', { class: 'row' }, c.topics.map(t => h('span', { class: 'chip' }, t))),
        h('div', { class: 'muted small', html: c.symptom }),
        h('div', { class: 'small muted' }, st?.solved ? `Best time ${fmtTime(st.best)} · ${st.solvedVariants?.length || 1} of ${c.variants.length} variants found` : st?.elapsed ? 'In progress' : `${c.variants.length} variants`));
    })));
  }
  main.append(page);
}

// ================================================================ Troubleshooting: one challenge
function viewChallenge(main, cleanup, id) {
  const c = CHALLENGES.find(x => x.id === id);
  if (!c) { location.hash = '#/troubleshoot'; return; }
  const st = store.challenge(c.id) || { variant: Math.floor(Math.random() * c.variants.length), elapsed: 0, solved: false, solvedVariants: [] };
  // A finished round starts a new one with an unsolved variant if there is one
  if (st.finished) {
    const open = c.variants.map((_, i) => i).filter(i => !(st.solvedVariants || []).includes(i) && i !== st.variant);
    st.variant = open.length ? open[Math.floor(Math.random() * open.length)] : Math.floor(Math.random() * c.variants.length);
    st.finished = false; st.elapsed = 0; st.revealed = false; delete st.topo;
  }
  const save = () => store.saveChallenge(c.id, st);
  save();

  const top = h('div', { class: 'lesson-top' },
    h('a', { class: 'btn icon ghost', href: '#/troubleshoot', title: 'Back to all challenges', html: I.left }),
    h('div', {}, h('div', { class: 'crumb' }, `Troubleshooting · ${LEVELS[c.level]}`), h('h1', {}, c.title)));
  const timerEl = h('span', { class: 'chtimer', html: I.timer + fmtTime(st.elapsed) });
  top.append(timerEl);
  const body = h('div', { class: 'lesson-body is-lab' });
  main.append(h('div', { class: 'lesson chlesson' }, top, body));

  const col = h('div', { class: 'goalcol' });
  const labRoot = h('div', { style: { minHeight: 0, minWidth: 0 } });
  const place = () => { rz.style.left = `${col.offsetWidth - 5}px`; rz.style.top = '0'; rz.style.height = `${body.clientHeight}px`; };
  const setW = w => w ? body.style.setProperty('--goal-w', w + 'px') : body.style.removeProperty('--goal-w');
  const rz = resizer('col', {
    onMove: e => { const r = body.getBoundingClientRect(); const w = Math.round(Math.min(Math.max(e.clientX - r.left, 240), Math.max(240, Math.min(720, r.width - 520)))); store.prefs.goalW = w; setW(w); place(); },
    onEnd: () => store.setPref('goalW', store.prefs.goalW), onReset: () => { store.setPref('goalW', null); setW(null); place(); } });
  setW(store.prefs.goalW);
  body.append(col, labRoot, rz);
  const ro = new ResizeObserver(place); ro.observe(body); cleanup.push(() => ro.disconnect());

  const fresh = () => challengeTopo(c, st.variant);
  const ctx = { inspected: [] };
  const goalState = c.goals.map(() => false);
  let pending = false, topoTimer;
  const lab = new Lab(labRoot, { topo: st.topo ? clone(st.topo) : fresh(), edit: 'config', compact: true, consolePresets: c.presets,
    onEvent: (type, data) => {
      if (type === 'inspect') ctx.inspected.push(data);
      if (['config', 'added', 'deleted', 'linked', 'moved', 'renamed'].includes(type) || (type === 'sim' && ['config', 'topology'].includes(data.type))) {
        clearTimeout(topoTimer); topoTimer = setTimeout(() => { st.topo = clone(lab.sim.topo); save(); }, 300);
      }
      if (type === 'sim' && data.type === 'tick') return;
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; evaluate(); }); }
    } });
  cleanup.push(() => { lab.destroy(); clearTimeout(topoTimer); });

  // The clock only runs while the challenge is open and unsolved
  const tick = setInterval(() => { if (st.finished || document.hidden) return; st.elapsed += 1000; timerEl.innerHTML = I.timer + fmtTime(st.elapsed); if (st.elapsed % 5000 === 0) save(); }, 1000);
  cleanup.push(() => { clearInterval(tick); save(); });

  col.append(h('h2', {}, 'The symptom'), h('div', { class: 'theory symptom', style: { padding: 0 }, html: c.symptom }));
  const list = h('ol', { class: 'goals' });
  const items = c.goals.map(g => { const li = h('li', {}, h('span', { class: 'st', html: I.circle }), h('div', { class: 'txt' }, h('span', { html: g.text }))); list.append(li); return li; });
  col.append(h('h2', { style: { marginTop: '14px' } }, 'Goal'), list);
  const hintBox = h('div');
  let shown = 0;
  const hintBtn = h('button', { class: 'btn ghost', html: I.bulb + 'Show a hint' });
  hintBtn.addEventListener('click', () => { hintBox.append(h('div', { class: 'hint' }, c.hints[shown++])); if (shown >= c.hints.length) hintBtn.remove(); });
  const outro = h('div');
  const reveal = () => {
    if (outro.querySelector('.cause')) return;
    outro.append(h('div', { class: 'hint cause' }, h('b', {}, 'The cause: '), c.variants[st.variant].cause));
  };
  const causeBtn = h('button', { class: 'btn ghost', onclick: () => { if (st.finished || confirm('Show the cause? The challenge then counts as not solved.')) { st.revealed = true; save(); reveal(); causeBtn.remove(); } } }, 'Show the cause');
  col.append(h('div', { class: 'row', style: { marginTop: '10px' } }, hintBtn, causeBtn), hintBox, outro,
    h('div', { class: 'row', style: { marginTop: '16px' } },
      h('button', { class: 'btn ghost', html: I.reset + 'Start over', onclick: () => { clearTimeout(topoTimer); delete st.topo; save(); lab.load(fresh()); ctx.inspected = []; } }),
      c.variants.length > 1 ? h('button', { class: 'btn', onclick: () => { st.finished = true; save(); viewAgain(); } }, 'Another variant') : null));
  if (st.revealed) { reveal(); causeBtn.remove(); }

  function viewAgain() { location.hash = `#/troubleshoot/${c.id}?${Date.now()}`; }
  let done = false;
  function evaluate() {
    c.goals.forEach((g, i) => {
      if (!goalState[i] && g.check(lab.sim, ctx)) goalState[i] = true;
      items[i].classList.toggle('ok', goalState[i]);
      items[i].querySelector('.st').innerHTML = goalState[i] ? I.check : I.circle;
    });
    if (!done && goalState.every(Boolean)) {
      done = true;
      const counted = !st.revealed;
      st.finished = true;
      if (counted) {
        st.solved = true;
        st.best = st.best ? Math.min(st.best, st.elapsed) : st.elapsed;
        st.solvedVariants = [...new Set([...(st.solvedVariants || []), st.variant])];
      }
      save();
      outro.prepend(h('div', { class: 'done-banner' }, counted ? `Solved in ${fmtTime(st.elapsed)}.` : 'Fixed, with the cause shown.'));
      reveal(); causeBtn.remove();
      const left = c.variants.length - (st.solvedVariants?.length || 0);
      outro.append(h('div', { class: 'row', style: { marginTop: '10px' } },
        left > 0 ? h('button', { class: 'btn primary', onclick: viewAgain }, `Next variant (${left} left)`) : h('span', { class: 'small muted' }, 'You found every variant of this challenge.'),
        h('a', { class: 'btn', href: '#/troubleshoot' }, 'All challenges')));
    }
  }
  const firstDev = Object.keys(c.presets || {})[0];
  if (firstDev) lab.selectByName(firstDev, 'console');
}

// ================================================================ Subnetting trainer
export function viewSubnet(main) {
  let mode = MODES[store.prefs.subnetMode] ? store.prefs.subnetMode : 'range';
  let level = SUB_LEVELS[store.prefs.subnetLevel] ? store.prefs.subnetLevel : 'medium';
  let q, checked, firstTry;
  const page = h('div', { class: 'page subnet' }, h('h1', {}, 'Subnetting trainer'),
    h('p', { class: 'muted', style: { maxWidth: '68ch' } }, 'Endless practice with random addresses. Every answer comes with the worked solution, so mistakes turn into understanding. Enter jumps to the next field and checks at the end.'));
  const tabs = h('div', { class: 'tabs subtabs', role: 'tablist' });
  const levelSel = h('select', { class: 'input', 'aria-label': 'Difficulty' }, Object.entries(SUB_LEVELS).map(([k, t]) => h('option', { value: k, selected: k === level ? true : null }, t)));
  levelSel.addEventListener('change', () => { level = levelSel.value; store.setPref('subnetLevel', level); next(); });
  const stats = h('div', { class: 'small muted' });
  const card = h('div', { class: 'subcard' });
  page.append(tabs, h('div', { class: 'row', style: { margin: '12px 0' } }, levelSel, h('span', { class: 'grow' }), stats), card, cheatSheet());
  main.append(page);

  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [k, m] of Object.entries(MODES)) tabs.append(h('button', { class: mode === k ? 'cur' : '', role: 'tab', 'aria-selected': mode === k ? 'true' : 'false',
      onclick: () => { mode = k; store.setPref('subnetMode', k); drawTabs(); next(); } }, m.title));
  };
  const drawStats = () => {
    const s = store.subnetStats(mode);
    stats.textContent = `Streak ${s.streak || 0} · best ${s.best || 0} · ${s.right || 0} of ${s.total || 0} right`;
  };
  function next() {
    q = MODES[mode].make(level); checked = false; firstTry = true;
    card.innerHTML = '';
    const inputs = q.fields.map(f => h('input', { class: 'input mono', 'aria-label': f[0], autocomplete: 'off', spellcheck: 'false' }));
    const fbs = q.fields.map(() => h('span', { class: 'feedback' }));
    const exp = h('div', { class: 'explain hidden' });
    const grid = h('div', { class: 'subgrid' });
    q.fields.forEach((f, i) => grid.append(h('span', { class: 'sublabel' }, f[0]), inputs[i], fbs[i]));
    const check = () => {
      let all = true;
      q.fields.forEach((f, i) => {
        const ok = checkField(f, inputs[i].value);
        all = all && ok;
        fbs[i].textContent = ok ? 'Correct' : inputs[i].value ? 'Not quite' : '';
        fbs[i].className = 'feedback ' + (ok ? 'ok' : 'bad');
        inputs[i].classList.toggle('bad', !ok && !!inputs[i].value);
      });
      const s = store.subnetStats(mode);
      if (firstTry) { s.total = (s.total || 0) + 1; if (all) { s.right = (s.right || 0) + 1; s.streak = (s.streak || 0) + 1; s.best = Math.max(s.best || 0, s.streak); } else s.streak = 0; store.saveSubnetStats(mode, s); firstTry = false; }
      drawStats();
      if (all) { checked = true; exp.innerHTML = explain(mode, q); exp.classList.remove('hidden'); nextBtn.focus(); }
    };
    const solution = () => {
      q.fields.forEach((f, i) => { inputs[i].value = f[1]; });
      if (firstTry) { const s = store.subnetStats(mode); s.total = (s.total || 0) + 1; s.streak = 0; store.saveSubnetStats(mode, s); firstTry = false; drawStats(); }
      check(); exp.innerHTML = explain(mode, q); exp.classList.remove('hidden');
    };
    inputs.forEach((inp, i) => inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (checked) return next();
      if (i < inputs.length - 1 && !inputs[i + 1].value) inputs[i + 1].focus(); else check();
    }));
    const nextBtn = h('button', { class: 'btn primary', onclick: next }, 'Next question');
    card.append(h('div', { class: 'muted small' }, MODES[mode].text), h('div', { class: 'subq mono' }, q.q), grid,
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: check }, 'Check'), h('button', { class: 'btn ghost', onclick: solution }, 'Show the solution'), h('span', { class: 'grow' }), nextBtn), exp);
    drawStats();
    inputs[0].focus();
  }
  drawTabs(); next();
}

function cheatSheet() {
  const rows = [];
  for (let len = 16; len <= 30; len++) rows.push(h('tr', {}, h('td', {}, `/${len}`), h('td', { class: 'mono' }, maskStr(len)), h('td', {}, (2 ** (32 - len)).toLocaleString('en')), h('td', {}, (2 ** (32 - len) - 2).toLocaleString('en'))));
  const steps = h('div', { html: `
<p style="margin-top:4px"><b>Network, first host, last host, broadcast in four steps</b>, example <code>192.168.1.130/26</code>:</p>
<ol style="margin:4px 0 8px 18px;padding:0;line-height:1.6">
<li><b>Find the interesting octet and the block size.</b> /26 = 24 + 2: the prefix ends 2 bits into the 4th octet. Block size = 2<sup>8−2</sup> = <b>64</b> (or 256 − mask octet 192).</li>
<li><b>Find the block the address lies in.</b> The blocks start at 0, 64, 128, 192. 130 lies in the block <b>128 to 191</b>.</li>
<li><b>Network and broadcast are the edges of the block.</b> Network = first address of the block, all host bits 0: <code>192.168.1.128</code>. Broadcast = last address, all host bits 1: <code>192.168.1.191</code>.</li>
<li><b>The hosts are everything in between.</b> First host = network + 1 = <code>.129</code>, last host = broadcast − 1 = <code>.190</code>. 64 − 2 = 62 usable.</li></ol>
<p class="small muted" style="margin:0 0 10px">So the first host is only .1 when the block starts at .0. For <code>192.168.243.224/28</code> the blocks are 16 wide, 224 lies in the block 224 to 239, so the first host is .225 and the last .238. Addresses like .0 or .1 belong to a different subnet there.</p>` });
  return h('details', { class: 'sect', style: { marginTop: '18px' } }, h('summary', {}, h('span', {}, 'Cheat sheet: step by step, prefixes, masks and sizes')),
    h('div', { class: 'sect-body' }, steps, h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, 'Prefix'), h('th', {}, 'Mask'), h('th', {}, 'Addresses'), h('th', {}, 'Usable hosts')), rows),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Mask octets you will meet: 128, 192, 224, 240, 248, 252, 254, 255. Block size = 256 − mask octet.')));
}
