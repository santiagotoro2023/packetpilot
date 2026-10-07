// Backups: the new file format, old exports, and merging without losing anything
import { store, mergeState } from '../src/js/store.js';
import assert from 'node:assert/strict';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };

test('backup file has a header and restores everything', () => {
  store.markStep('m1-l1', 0); store.markLesson('m1-l1');
  store.saveNet('Home lab', { devices: [], links: [] });
  store.saveChallenge('vpn', { solved: true, best: 120000, solvedVariants: [2] });
  store.saveSubnetStats('net', { right: 12, total: 15, streak: 4, best: 9 });
  store.setPref('speed', 0.5);
  const file = JSON.parse(store.exportAll('2.8.0'));
  assert.equal(file.app, 'PacketPilot'); assert.equal(file.version, '2.8.0'); assert.ok(file.exported);
  store.resetProgress();
  assert.equal(store.lessonDone('m1-l1'), false);
  store.importAll(JSON.stringify(file));
  assert.ok(store.lessonDone('m1-l1'));
  assert.ok(store.nets()['Home lab']);
  assert.deepEqual(store.challenge('vpn').solvedVariants, [2]);
  assert.equal(store.subnetStats('net').best, 9);
  assert.equal(store.prefs.speed, 0.5);
});

test('exports of older versions (data without header) still import', () => {
  const old = { progress: { 'm4-l2': { steps: { 0: true }, done: true } }, nets: {}, prefs: {}, answers: {}, practice: { challenges: {}, subnet: {} } };
  store.importAll(JSON.stringify(old));
  assert.ok(store.lessonDone('m4-l2'));
});

test('merging keeps the best of both sides', () => {
  const a = { progress: { x: { steps: { 0: true }, done: false } }, nets: { n: { topo: { devices: [1] } } }, practice: { challenges: { c: { solved: false, best: null, solvedVariants: [0] } }, subnet: { s: { right: 3, total: 5, streak: 1, best: 2 } } } };
  const b = { progress: { x: { steps: { 1: true }, done: true } }, nets: { n: { topo: { devices: [2] } } }, practice: { challenges: { c: { solved: true, best: 5000, solvedVariants: [1] } }, subnet: { s: { right: 7, total: 9, streak: 6, best: 6 } } } };
  const m = mergeState(a, b);
  assert.deepEqual(Object.keys(m.progress.x.steps).sort(), ['0', '1']); assert.equal(m.progress.x.done, true);
  assert.ok(m.nets.n && m.nets['n (imported)'], 'two different networks with the same name are both kept');
  assert.equal(m.practice.challenges.c.solved, true); assert.equal(m.practice.challenges.c.best, 5000);
  assert.deepEqual(m.practice.challenges.c.solvedVariants.sort(), [0, 1]);
  assert.deepEqual([m.practice.subnet.s.right, m.practice.subnet.s.best, m.practice.subnet.s.streak], [7, 6, 6]);
  const twice = mergeState(m, b);
  assert.equal(Object.keys(twice.nets).length, Object.keys(m.nets).length, 'restoring twice changes nothing');
});

test('a file that is not a backup is refused', () => {
  assert.throws(() => store.importAll('{"hello": 1}'), /Not a valid PacketPilot file/);
});
console.log(`\n${passed} storage tests passed`);
