// Facts about this installation (site.json, written by the installer) and moving
// progress between addresses. Progress lives in the browser per address, so when a
// server gets a domain name, the learner takes it along with one click.
import { h } from './ui.js';
import { store } from './store.js';
import { pack } from './share.js';

let site = {};
export const siteInfo = () => site;
export async function loadSite() {
  try {
    const r = await Promise.race([fetch('site.json', { cache: 'no-store' }), new Promise((_, no) => setTimeout(no, 1500))]);
    if (r.ok) site = await r.json();
  } catch { /* opened as a file, without the installer or slow */ }
  return site;
}

/** The main address of this server, if it differs from the one in the address bar */
export function otherHome() {
  try {
    const u = site.canonical && new URL(site.canonical);
    return u && /^https?:$/.test(u.protocol) && u.origin !== location.origin ? u.origin : null;
  } catch { return null; }
}
/** Base for links that others open: the main address when there is one */
export const siteBase = () => (otherHome() || location.origin) + location.pathname;

async function moveUrl(home) {
  const to = encodeURIComponent(location.hash || '#/');
  if (store.isEmpty()) return `${home}/${location.hash || ''}`;
  return `${home}/#/migrate/${await pack(store.snapshot())}?to=${to}`;
}

/** Small card in the corner when the server has a new main address */
export function moveCard() {
  const home = otherHome();
  if (!home || store.prefs.moveHidden === home) return;
  const name = new URL(home).host;
  const empty = store.isEmpty();
  const card = h('aside', { class: 'movecard no-print', role: 'status' },
    h('b', {}, 'PacketPilot has a new address'),
    h('p', {}, 'This server is now reachable at ', h('b', {}, name), empty ? '.' : '. Your progress is saved in this browser per address, so take it along.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => { location.href = await moveUrl(home); } }, empty ? 'Go there' : 'Move my progress there'),
      h('button', { class: 'btn ghost', onclick: () => { store.setPref('moveHidden', home); card.remove(); } }, 'Not now')));
  document.body.append(card);
}
