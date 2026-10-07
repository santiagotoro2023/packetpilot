// Icons of PacketPilot: the line icons of the design system (src/js/core/icons.js), plus the
// device symbols of the network diagram.
import { I as CORE, s } from './core/icons.js';

export const I = { ...CORE };
export { s };

// Device symbols for the network diagram (40x40, own colors via CSS)
export const DEV_ICON = {
  pc: `<rect x="6" y="7" width="28" height="19" rx="2.5" class="dv-fill"/><path d="M15 31h10M20 26v5" class="dv-line"/><path d="M10 11h20v11H10z" class="dv-screen"/>`,
  server: `<rect x="9" y="5" width="22" height="30" rx="2.5" class="dv-fill"/><path d="M12 12h16M12 19h16M12 26h16" class="dv-line"/><circle cx="26" cy="9" r="1.3" class="dv-led"/><circle cx="26" cy="16" r="1.3" class="dv-led"/><circle cx="26" cy="23" r="1.3" class="dv-led"/>`,
  switch: `<rect x="4" y="9" width="32" height="22" rx="3.5" class="dv-fill"/><path d="M11 16.5h18l-3.5-3.5M29 23.5H11l3.5 3.5" class="dv-line"/>`,
  router: `<circle cx="20" cy="20" r="14" class="dv-fill"/><path d="M20 9v8M20 31v-8M9 20h8M31 20h-8" class="dv-line"/><path d="M17.5 11.5 20 9l2.5 2.5M17.5 28.5 20 31l2.5-2.5M11.5 17.5 9 20l2.5 2.5M28.5 17.5 31 20l-2.5 2.5" class="dv-line"/>`,
  vtep: `<rect x="4" y="11" width="32" height="18" rx="3" class="dv-fill"/><path d="M10 20h20" class="dv-tunnel"/><circle cx="10" cy="20" r="2.4" class="dv-led"/><circle cx="30" cy="20" r="2.4" class="dv-led"/>`
};
