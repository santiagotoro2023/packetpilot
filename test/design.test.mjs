// The design system starter kit (docs/design/kit) must stay an exact copy of PacketPilot's
// shared files, and docs/DESIGN.md must name the same token values as base.css.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url));
let n = 0;
const same = (a, b) => { assert.ok(read(a).equals(read(b)), `${b} differs from ${a}: run build.sh`); n++; };

same('src/css/base.css', 'docs/design/kit/css/base.css');
same('src/js/ui.js', 'docs/design/kit/js/ui.js');
for (const f of fs.readdirSync(new URL('../src/fonts/', import.meta.url))) same(`src/fonts/${f}`, `docs/design/kit/fonts/${f}`);

// The kit's icons are the first block of src/js/icons.js, unchanged
const icons = read('src/js/icons.js').toString();
assert.equal(read('docs/design/kit/js/icons.js').toString(), icons.slice(0, icons.indexOf('\n};\n') + 4), 'docs/design/kit/js/icons.js differs: run build.sh');
n++;

// Every token of base.css appears with its value in DESIGN.md
const css = read('src/css/base.css').toString();
const doc = read('docs/DESIGN.md').toString();
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const tokens = [...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]);
assert.ok(tokens.length > 25, 'tokens found in base.css');
for (const [k, v] of tokens) { assert.ok(doc.includes(`${k}: ${v}`) || doc.includes(`\`${k}\` | \`${v}\``), `DESIGN.md does not name ${k}: ${v}`); n++; }
const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));
for (const m of dark.slice(0, dark.indexOf('}')).matchAll(/(--[\w-]+):\s*([^;]+);/g)) { assert.ok(doc.includes(m[2].trim()), `DESIGN.md does not name the dark value of ${m[1]}: ${m[2]}`); n++; }

// The kit page and PacketPilot use the same shell markup
const shell = s => s.toString().match(/<nav class="rail"[\s\S]*?<\/nav>/)[0].replace(/ *<a [^>]*data-nav[^>]*>.*<\/a>\n/g, '').replace(/<svg[\s\S]*?<\/svg>/, '').replace(/title="[^"]*"|aria-label="[^"]*"/g, '');
assert.equal(shell(read('docs/design/kit/index.html')), shell(read('src/index.html')), 'the rail markup of the kit and PacketPilot differ');
n++;
console.log(`design: ${n} checks passed`);
