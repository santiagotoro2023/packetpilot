import m1 from './m1.js';
import m2 from './m2.js';
import m3 from './m3.js';
import m4 from './m4.js';
import m5 from './m5.js';
import m6 from './m6.js';
import m7 from './m7.js';
import m8 from './m8.js';
import m9 from './m9.js';
import m10 from './m10.js';
import m11 from './m11.js';
import m12 from './m12.js';
import m13 from './m13.js';
import m14 from './m14.js';
import m15 from './m15.js';

// Display order: all of layer 2, then layer 3, VLAN/VXLAN, transport, then the network services
export const MODULES = [m1, m4, m2, m12, m3, m5, m11, m6, m7, m8, m9, m10, m14, m15, m13];
export const UPCOMING = [
]
export function findLesson(id) {
  for (const m of MODULES) {
    const i = m.lessons.findIndex(l => l.id === id);
    if (i >= 0) return { module: m, lesson: m.lessons[i], index: i };
  }
  return null;
}
export function nextLesson(id) {
  const flat = MODULES.flatMap(m => m.lessons);
  const i = flat.findIndex(l => l.id === id);
  return flat[i + 1] || null;
}
