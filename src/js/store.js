// Storage in the browser, robust against blocked storage.
// The key and the shape only ever grow: new fields get defaults, nothing is renamed,
// so an update of PacketPilot never loses what a learner did.
const KEY = 'packetpilot.v1';
const empty = () => ({ progress: {}, nets: {}, prefs: {}, answers: {}, practice: { challenges: {}, subnet: {} } });
let mem = empty();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) mem = withDefaults(JSON.parse(raw));
} catch { /* private window or similar */ }

function withDefaults(d) {
  const e = empty();
  const m = { ...e, ...(d && typeof d === 'object' ? d : {}) };
  m.practice = { ...e.practice, ...(m.practice || {}) };
  for (const k of ['progress', 'nets', 'prefs', 'answers']) if (!m[k] || typeof m[k] !== 'object') m[k] = {};
  return m;
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ } }

/** Combine two saved states: nothing done is lost, on conflicts the current browser wins */
export function mergeState(cur, add) {
  const a = withDefaults(add), out = withDefaults(JSON.parse(JSON.stringify(cur)));
  for (const [id, p] of Object.entries(a.progress)) {
    const c = (out.progress[id] ??= { steps: {}, done: false });
    c.steps = { ...(p.steps || {}), ...(c.steps || {}) };
    c.done = !!(c.done || p.done);
  }
  for (const [k, v] of Object.entries(a.answers)) if (!(k in out.answers)) out.answers[k] = v;
  for (const [name, n] of Object.entries(a.nets)) {
    if (!(name in out.nets)) out.nets[name] = n;
    else if (JSON.stringify(out.nets[name].topo) !== JSON.stringify(n.topo)) out.nets[`${name} (imported)`] = n;
  }
  for (const [k, v] of Object.entries(a.prefs)) if (!(k in out.prefs)) out.prefs[k] = v;
  for (const [id, c] of Object.entries(a.practice.challenges || {})) {
    const o = out.practice.challenges[id];
    if (!o) { out.practice.challenges[id] = c; continue; }
    o.solved = !!(o.solved || c.solved);
    if (c.best && (!o.best || c.best < o.best)) o.best = c.best;
    o.solvedVariants = [...new Set([...(o.solvedVariants || []), ...(c.solvedVariants || [])])];
  }
  for (const [mode, s] of Object.entries(a.practice.subnet || {})) {
    const o = out.practice.subnet[mode];
    if (!o) { out.practice.subnet[mode] = s; continue; }
    o.right = Math.max(o.right || 0, s.right || 0); o.total = Math.max(o.total || 0, s.total || 0); o.best = Math.max(o.best || 0, s.best || 0);
  }
  return out;
}

export const store = {
  get prefs() { return mem.prefs; },
  setPref(k, v) { mem.prefs[k] = v; persist(); },
  stepDone(lessonId, idx) { return !!mem.progress[lessonId]?.steps?.[idx]; },
  markStep(lessonId, idx) {
    const p = (mem.progress[lessonId] ??= { steps: {}, done: false });
    if (!p.steps[idx]) { p.steps[idx] = true; persist(); }
  },
  markLesson(lessonId) { const p = (mem.progress[lessonId] ??= { steps: {}, done: false }); p.done = true; persist(); },
  lessonDone(lessonId) { return !!mem.progress[lessonId]?.done; },
  lessonSteps(lessonId) { return Object.keys(mem.progress[lessonId]?.steps || {}).length; },
  resetProgress() { mem.progress = {}; mem.answers = {}; mem.practice = empty().practice; persist(); },
  // Partial answers of an exercise or lab step, so they survive navigation and reloads
  answer(key) { return mem.answers?.[key]; },
  saveAnswer(key, value) { (mem.answers ??= {})[key] = value; persist(); },
  // Troubleshooting challenges and the subnetting trainer
  challenge(id) { return mem.practice.challenges[id] || null; },
  saveChallenge(id, v) { mem.practice.challenges[id] = v; persist(); },
  subnetStats(mode) { return mem.practice.subnet[mode] || { right: 0, total: 0, streak: 0, best: 0 }; },
  saveSubnetStats(mode, v) { mem.practice.subnet[mode] = v; persist(); },
  nets() { return mem.nets; },
  saveNet(name, topo) { mem.nets[name] = { topo, saved: Date.now() }; persist(); },
  deleteNet(name) { delete mem.nets[name]; persist(); },
  exportAll() { return JSON.stringify(mem, null, 2); },
  snapshot() { return JSON.stringify(mem); },
  /** Import a file or a transferred state. merge keeps everything already in this browser. */
  importAll(json, { merge = true } = {}) {
    const d = typeof json === 'string' ? JSON.parse(json) : json;
    if (typeof d !== 'object' || !d || !('progress' in d || 'nets' in d || 'prefs' in d)) throw new Error('Not a valid PacketPilot file');
    mem = merge ? mergeState(mem, d) : withDefaults(d);
    persist();
  },
  isEmpty() { return !Object.keys(mem.progress).length && !Object.keys(mem.nets).length && !Object.keys(mem.answers).length && !Object.keys(mem.practice.challenges).length; }
};
