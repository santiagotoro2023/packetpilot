// The subnetting trainer: every generated question must have a correct, self-consistent answer
import { MODES, info, checkField, explain } from '../../src/js/subnet.js';
import { ipToInt, maskOf } from '../../src/js/net.js';
import assert from 'node:assert/strict';

let n = 0;
for (const [mode, m] of Object.entries(MODES)) for (const level of ['easy', 'medium', 'hard']) for (let i = 0; i < 400; i++) {
  const q = m.make(level);
  n++;
  for (const f of q.fields) assert.ok(checkField(f, f[1]), `${mode}: own answer accepted`);
  assert.ok(explain(mode, q).length > 20);
  if (mode === 'range') {
    const [net, bc, first, last, hosts] = q.fields.map(f => f[1]);
    const mask = maskOf(q.len);
    assert.equal((ipToInt(q.ip) & mask) >>> 0, ipToInt(net));
    assert.equal(ipToInt(bc) - ipToInt(net) + 1, 2 ** (32 - q.len));
    assert.equal(ipToInt(first), ipToInt(net) + 1); assert.equal(ipToInt(last), ipToInt(bc) - 1);
    assert.equal(Number(hosts), 2 ** (32 - q.len) - 2);
  }
  if (mode === 'same') {
    const same = (ipToInt(q.ip) & maskOf(q.len)) >>> 0 === (ipToInt(q.other) & maskOf(q.len)) >>> 0;
    assert.equal(q.fields[0][1], same ? 'yes' : 'no', `${q.q}`);
  }
  if (mode === 'size') {
    const len = Number(q.fields[0][1]);
    assert.ok(2 ** (32 - len) - 2 >= q.hosts && 2 ** (31 - len) - 2 < q.hosts, `${q.q} → /${len}`);
  }
  if (mode === 'split') {
    const [, net, bc] = q.fields.map(f => f[1]);
    assert.equal(info(net, q.len).bc, bc);
  }
}
assert.ok(checkField(['Prefix', '26', v => String(v).replace(/^\//, '')], '/26'));
assert.ok(checkField(['Same', 'yes', v => String(v).trim().toLowerCase().replace(/^y$/, 'yes')], ' Y '));
console.log(`${n} generated subnetting questions are consistent`);
