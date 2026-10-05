// Storage in the browser, robust against blocked storage
const KEY = 'packetpilot.v1';
let mem = { progress: {}, nets: {}, prefs: {} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) mem = { ...mem, ...JSON.parse(raw) };
} catch { /* private window or similar */ }

function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ } }

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
  resetProgress() { mem.progress = {}; persist(); },
  nets() { return mem.nets; },
  saveNet(name, topo) { mem.nets[name] = { topo, saved: Date.now() }; persist(); },
  deleteNet(name) { delete mem.nets[name]; persist(); },
  exportAll() { return JSON.stringify(mem, null, 2); },
  importAll(json) {
    const d = JSON.parse(json);
    if (typeof d !== 'object' || !d) throw new Error('Not a valid PacketPilot file');
    mem = { progress: d.progress || {}, nets: d.nets || {}, prefs: d.prefs || mem.prefs };
    persist();
  }
};
