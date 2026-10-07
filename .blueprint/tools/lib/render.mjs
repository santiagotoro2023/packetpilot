// Rendering of blueprint files: placeholders, profile blocks, file lists.
// No dependencies: Node 18 or newer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROFILES = ['static', 'server'];
export const LOGO_PATTERNS = ['bars', 'steps', 'rows', 'split', 'dots', 'pair'];
export const LOGO_COLORS = ['blue', 'violet', 'orange', 'green', 'teal', 'brown', 'pink', 'gold', 'rust', 'pine'];

// The settings every project must have in project.conf, with a check for each
export const CONF_KEYS = {
  APP_ID: v => /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(v) || 'lowercase letters, digits and dashes, 3 to 32 characters, starting with a letter',
  APP_NAME: v => /^[A-Za-z0-9][A-Za-z0-9 .+-]{0,39}$/.test(v) || 'letters, digits, spaces, at most 40 characters',
  APP_TAGLINE: v => (v.length >= 10 && v.length <= 90 && /\.$/.test(v) && !/!/.test(v)) || 'one sentence of 10 to 90 characters that ends with a period, no exclamation mark',
  APP_DESCRIPTION: v => (v.length >= 20 && v.length <= 200 && !/!/.test(v)) || 'one or two sentences, 20 to 200 characters, no exclamation mark',
  APP_REPO: v => /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(v) || 'owner/repository on GitHub',
  APP_PROFILE: v => PROFILES.includes(v) || `one of ${PROFILES.join(', ')}`,
  APP_PORT: v => (/^\d+$/.test(v) && +v >= 1024 && +v <= 65535) || 'a port from 1024 to 65535 (the default port of the installer)',
  APP_KEYWORDS: v => /^[a-z0-9 -]+(, [a-z0-9 -]+)*$/.test(v) || 'lowercase keywords separated by ", "',
  APP_DATA_NOTE: v => (v.length >= 10 && v.length <= 120 && /\.$/.test(v)) || 'one sentence that says where the users\' data lives, ending with a period',
  LOGO_PATTERN: v => LOGO_PATTERNS.includes(v) || `one of ${LOGO_PATTERNS.join(', ')}`,
  LOGO_COLORS: v => v.split(',').every(c => LOGO_COLORS.includes(c)) || `comma-separated, from ${LOGO_COLORS.join(', ')}`
};

/** project.conf: KEY="value" lines (shell syntax), comments with # */
export function parseConf(text) {
  const out = {};
  for (const [i, line] of text.split('\n').entries()) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const m = l.match(/^([A-Z][A-Z0-9_]*)="((?:[^"\\$`]|\\.)*)"$/);
    if (!m) throw new Error(`project.conf line ${i + 1}: expected KEY="value", got: ${l}`);
    out[m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  return out;
}

// Optional settings
export const CONF_OPTIONAL = {
  LIBRARY: v => v === '' || /^[a-z][a-z0-9-]*(,[a-z][a-z0-9-]*)*$/.test(v) || 'comma-separated names of library elements (see .blueprint/library/), or empty'
};

export function checkConf(conf) {
  const errors = [];
  for (const [k, test] of Object.entries(CONF_OPTIONAL)) if (k in conf) { const r = test(conf[k]); if (r !== true) errors.push(`${k}="${conf[k]}": ${r}`); }
  for (const [k, test] of Object.entries(CONF_KEYS)) {
    if (!(k in conf)) { errors.push(`${k} is missing`); continue; }
    const r = test(conf[k]);
    if (r !== true) errors.push(`${k}="${conf[k]}": ${r}`);
  }
  for (const k of Object.keys(conf)) if (!(k in CONF_KEYS) && !(k in CONF_OPTIONAL)) errors.push(`${k} is not a blueprint setting`);
  return errors;
}

/** All placeholders of a project: the settings plus derived values */
export function variables(conf, { version, blueprintVersion }) {
  const [owner, repoName] = conf.APP_REPO.split('/');
  return {
    ...conf,
    APP_ENV: conf.APP_ID.toUpperCase().replace(/-/g, '_'),
    APP_OWNER: owner,
    APP_OWNER_LC: owner.toLowerCase(),
    APP_REPO_NAME: repoName,
    VERSION: version,
    BLUEPRINT_VERSION: blueprintVersion
  };
}

const MARK = /@@(IF (static|server)|ELSE|END)@@/;

/** Replace @@KEY@@ placeholders and keep only the blocks of this profile */
export function renderText(text, vars, file = '') {
  const lines = text.split('\n'), out = [], stack = [];
  for (const [i, line] of lines.entries()) {
    const m = line.match(MARK);
    if (m && line.trim() !== m[0]) throw new Error(`${file}:${i + 1}: ${m[0]} must stand alone on its line`);
    if (m) {
      if (m[1].startsWith('IF')) stack.push({ keep: m[2] === vars.APP_PROFILE, line: i + 1 });
      else if (m[1] === 'ELSE') { if (!stack.length) throw new Error(`${file}:${i + 1}: @@ELSE@@ without @@IF@@`); stack.at(-1).keep = !stack.at(-1).keep; }
      else if (!stack.pop()) throw new Error(`${file}:${i + 1}: @@END@@ without @@IF@@`);
      continue;
    }
    if (stack.every(s => s.keep)) out.push(line);
  }
  if (stack.length) throw new Error(`${file}:${stack.at(-1).line}: @@IF@@ without @@END@@`);
  const lone = /^\s*@@([A-Z][A-Z0-9_]*)@@\s*$/;
  const kept = out.filter(l => { const m = l.match(lone); return !(m && m[1] in vars && vars[m[1]] === ''); });
  return kept.join('\n').replace(/@@([A-Z][A-Z0-9_]*)@@/g, (all, k) => {
    if (!(k in vars)) throw new Error(`${file}: unknown placeholder ${all}`);
    return vars[k];
  });
}

export const renderPath = (p, vars, file) => renderText(p, vars, file);

const BINARY = /\.(woff2?|png|jpe?g|gif|ico|pdf|zip|gz)$/i;
export const isBinary = p => BINARY.test(p);

export function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * The files of a blueprint layer (core or template) for a project: common plus the profile.
 * Returns [{ src, dest, binary }] with dest relative to the project root.
 */
export function layerFiles(root, layer, vars) {
  const files = new Map();
  for (const part of ['common', vars.APP_PROFILE]) {
    const dir = path.join(root, layer, part);
    for (const rel of walk(dir)) {
      if (rel.endsWith('.gitkeep')) continue;
      const dest = renderPath(rel.replace(/\.bp$/, ''), vars, rel);
      files.set(dest, { src: path.join(dir, rel), dest, binary: isBinary(rel) });
    }
  }
  return [...files.values()].sort((a, b) => a.dest.localeCompare(b.dest));
}

/** Content of one rendered file (Buffer) */
export function renderFile(f, vars) {
  const raw = fs.readFileSync(f.src);
  return f.binary ? raw : Buffer.from(renderText(raw.toString('utf8'), vars, f.src));
}

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** The library elements a project uses (LIBRARY in project.conf), checked against the blueprint */
export function libraryElements(root, vars) {
  const names = (vars.LIBRARY || '').split(',').filter(Boolean);
  const out = [];
  for (const name of names) {
    const dir = path.join(root, 'library', name);
    if (!fs.existsSync(path.join(dir, 'element.json'))) throw new Error(`LIBRARY: there is no library element "${name}" in blueprint ${vars.BLUEPRINT_VERSION}`);
    const el = JSON.parse(fs.readFileSync(path.join(dir, 'element.json'), 'utf8'));
    if (!el.profiles.includes(vars.APP_PROFILE)) throw new Error(`LIBRARY: "${name}" is for the ${el.profiles.join(' and ')} profile, not ${vars.APP_PROFILE}`);
    for (const r of el.requires || []) if (!names.includes(r)) throw new Error(`LIBRARY: "${name}" needs "${r}" as well`);
    out.push({ name, dir, ...el });
  }
  return out;
}
export function libraryFiles(root, vars) {
  const files = [];
  for (const el of libraryElements(root, vars)) {
    for (const rel of walk(path.join(el.dir, 'files'))) {
      files.push({ src: path.join(el.dir, 'files', rel), dest: renderPath(rel, vars, rel), binary: isBinary(rel), element: el.name });
    }
  }
  return files;
}
