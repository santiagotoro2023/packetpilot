// Small DOM helpers
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  return el;
}
let toastTimer;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
export function iconBtn(icon, title, onclick, cls = '') {
  return h('button', { class: `btn icon ghost ${cls}`, title, 'aria-label': title, onclick, html: icon });
}
export function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
}
export function pickFile(accept = '.json') {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept });
    i.onchange = async () => res(i.files[0] ? await i.files[0].text() : null);
    i.click();
  });
}
/**
 * Drag handle for resizing panels. axis 'col' drags horizontally, 'row' vertically.
 * onMove(event) gets every pointer move, onEnd() runs once on release, onReset() on double-click.
 */
export function resizer(axis, { onMove, onEnd, onReset, title = 'Drag to resize, double-click to reset' }) {
  const el = h('div', { class: `rz rz-${axis}`, title, role: 'separator', 'aria-orientation': axis === 'col' ? 'vertical' : 'horizontal' });
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('active');
    document.body.classList.add('resizing', axis);
    const move = ev => onMove(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('active');
      document.body.classList.remove('resizing', axis);
      onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  if (onReset) el.addEventListener('dblclick', onReset);
  return el;
}
