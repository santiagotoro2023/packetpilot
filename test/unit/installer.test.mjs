// The installer of PacketPilot: every older PacketPilot server can still update to it.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const script = fs.readFileSync('packetpilot-install.sh', 'utf8');
let n = 0;
assert.equal((script.match(/^APP_VERSION="(.*)"$/m) || [])[1], version, 'APP_VERSION is the current version'); n++;
// Installers before 3.0.0 read the version of the new script from this line when they run --update
assert.equal((script.match(/^PP_VERSION="(.*)"$/m) || [])[1], version, 'PP_VERSION for installers before 3.0.0'); n++;
assert.match(script, /^APP_ID="packetpilot"$/m); n++;
// The paths and settings of every older installation stay the same
for (const s of ['APP_ROOT="/opt/${APP_ID}"', 'APP_CONF="${APP_ROOT}/${APP_ID}.conf"', 'APP_CERT="${APP_TLS_DIR}/${APP_ID}.crt"', 'APP_RENEW="${APP_ID}-renew"', 'APP_SITE="/etc/nginx/sites-available/${APP_ID}"']) { assert.ok(script.includes(s), s); n++; }
for (const k of ['PORT', 'TLS', 'LE_DOMAIN', 'LE_DNS', 'LE_EMAIL', 'MOVED_TO', 'MOVE_CARD']) { assert.ok(script.includes(`\n${k}=\${APP_`), `${k} is saved in packetpilot.conf`); n++; }
console.log(`installer: ${n} checks passed`);
