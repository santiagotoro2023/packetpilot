#!/usr/bin/env bash
# =============================================================================
#  PacketPilot 1.1.0
#  Netzwerke verstehen, indem du jedem Paket zuschaust.
#
#  Installiert die Lern-Webapp auf Debian 12 (Bookworm) oder 13 (Trixie):
#  nginx liefert die statischen Dateien aus, alles Weitere läuft im Browser.
#  Es werden keine Dateien aus dem Internet nachgeladen, ausser den nginx-Paketen
#  (und bei --update das neueste Skript von GitHub).
#
#  Aufruf:
#    sudo bash packetpilot-install.sh                 Installieren oder aktualisieren (Port 8080)
#    sudo bash packetpilot-install.sh --port 80       Auf einem anderen Port
#    sudo bash packetpilot-install.sh --update        Neueste Version von GitHub holen
#    sudo bash packetpilot-install.sh --uninstall     Entfernen
#    bash packetpilot-install.sh --extract ./web      Nur die Webdateien entpacken (ohne root)
# =============================================================================
set -euo pipefail

PP_VERSION="1.1.0"
PP_PORT="8080"
PP_ROOT="/opt/packetpilot"
PP_WWW="${PP_ROOT}/www"
PP_SITE="/etc/nginx/sites-available/packetpilot"
PP_LINK="/etc/nginx/sites-enabled/packetpilot"
PP_ACTION="install"
PP_EXTRACT_DIR=""
PP_FORCE="no"
PP_PORT_SET="no"
PP_REPO="santiagotoro2023/packetpilot"
PP_SCRIPT_URL="https://raw.githubusercontent.com/${PP_REPO}/main/packetpilot-install.sh"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓ \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m ✗ \033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port)      PP_PORT="${2:-}"; PP_PORT_SET="yes"; shift 2 ;;
    --port=*)    PP_PORT="${1#*=}"; PP_PORT_SET="yes"; shift ;;
    --update)    PP_ACTION="update"; shift ;;
    --uninstall) PP_ACTION="uninstall"; shift ;;
    --extract)   PP_ACTION="extract"; PP_EXTRACT_DIR="${2:-}"; shift 2 ;;
    --force)     PP_FORCE="yes"; shift ;;
    -h|--help)   usage ;;
    *) die "Unbekannte Option: $1 (Hilfe mit --help)" ;;
  esac
done

case "$PP_PORT" in
  ''|*[!0-9]*) die "Ungültiger Port: ${PP_PORT}" ;;
esac
[ "$PP_PORT" -ge 1 ] && [ "$PP_PORT" -le 65535 ] || die "Port muss zwischen 1 und 65535 liegen."

write_files() {
  local W="$1"
  mkdir -p "$W/css"
  cat > "$W/css/app.css" <<'__PACKETPILOT_FILE_END__'
/* PacketPilot: Netzplan auf kühlem Papier, Paketschichten in Kabelfarben */
:root {
  --paper: #F3F6FA;
  --grid: #E0E7F0;
  --grid-strong: #CFD9E6;
  --panel: #FFFFFF;
  --panel-2: #F7F9FC;
  --ink: #17253A;
  --ink-2: #4B5B71;
  --ink-3: #7A889B;
  --line: #D3DCE7;
  --focus: #2F6FDB;
  --select: #EE7F1A;
  --ok: #1F9D68;
  --err: #D33A3A;
  --warn: #C98400;
  --btn: #17253A;
  --btn-ink: #FFFFFF;

  /* Schichten = Farben der Adernpaare (T568B) plus Ergänzungen */
  --l-eth: #2F6FDB;
  --l-vlan: #7A5AF8;
  --l-arp: #EE7F1A;
  --l-ip: #1F9D68;
  --l-icmp: #0E93A8;
  --l-udp: #8B5E3C;
  --l-vxlan: #D24C8D;
  --l-frag: #94A3B8;
  --l-data: #B4BFCE;
  --l-tcp: #5B6B82;
  --l-stp: #B8920A;

  --font: "Cantarell", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace;
  --r-s: 6px;
  --r-m: 10px;
  --shadow: 0 1px 2px rgba(23, 37, 58, .08), 0 4px 14px rgba(23, 37, 58, .06);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0E1624; --grid: #172234; --grid-strong: #1F2C41; --panel: #131D2E; --panel-2: #172336;
    --ink: #E4EBF5; --ink-2: #AAB7C9; --ink-3: #7D8BA0; --line: #26354B; --btn: #E4EBF5; --btn-ink: #0E1624;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 18px rgba(0,0,0,.25); color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #0E1624; --grid: #172234; --grid-strong: #1F2C41; --panel: #131D2E; --panel-2: #172336;
  --ink: #E4EBF5; --ink-2: #AAB7C9; --ink-3: #7D8BA0; --line: #26354B; --btn: #E4EBF5; --btn-ink: #0E1624;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 18px rgba(0,0,0,.25); color-scheme: dark;
}

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font: 15px/1.5 var(--font); color: var(--ink); background: var(--paper); -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: var(--focus); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
code, .mono { font-family: var(--mono); font-size: .9em; }
h1, h2, h3 { line-height: 1.2; margin: 0 0 .5em; font-weight: 650; letter-spacing: -.01em; }
h1 { font-size: 2.1rem; } h2 { font-size: 1.45rem; } h3 { font-size: 1.1rem; }
p { margin: 0 0 .8em; }
.muted { color: var(--ink-2); }
.small { font-size: .85rem; }
.hidden { display: none !important; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

/* ---------- Grundgerüst ---------- */
.app { display: grid; grid-template-columns: 76px 1fr; height: 100vh; }
.rail { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; align-items: stretch; padding: 10px 6px; gap: 4px; }
.rail .logo { display: grid; place-items: center; margin: 4px 0 12px; }
.rail a, .rail button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 2px 7px; border-radius: var(--r-m);
  color: var(--ink-2); text-decoration: none; font-size: .72rem; border: 0; background: none; cursor: pointer; }
.rail a:hover, .rail button:hover { background: var(--panel-2); color: var(--ink); }
.rail a.active { background: var(--ink); color: var(--panel); }
.rail .spacer { flex: 1; }
.main { overflow: auto; position: relative; min-width: 0; }
.page { max-width: 1080px; margin: 0 auto; padding: 32px 28px 64px; }

/* ---------- Bedienelemente ---------- */
.btn { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--panel); border-radius: var(--r-s);
  padding: 6px 12px; cursor: pointer; line-height: 1.3; white-space: nowrap; }
.btn:hover { border-color: var(--ink-3); }
.btn.primary { background: var(--btn); color: var(--btn-ink); border-color: var(--btn); }
.btn.primary:hover { opacity: .9; }
.btn.ghost { border-color: transparent; background: transparent; }
.btn.icon { padding: 6px; }
.btn.danger { color: var(--err); }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn.on { border-color: var(--select); color: var(--select); box-shadow: inset 0 0 0 1px var(--select); }
.input, select.input { border: 1px solid var(--line); background: var(--panel); border-radius: var(--r-s); padding: 5px 8px; min-width: 0; }
.input:focus { border-color: var(--focus); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent); }
.input.mono { font-family: var(--mono); font-size: .85rem; }
.input.bad { border-color: var(--err); }
.field { display: grid; gap: 3px; font-size: .82rem; color: var(--ink-2); }
.field > .input { color: var(--ink); font-size: .9rem; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.grow { flex: 1; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 99px; font-size: .78rem; background: var(--panel-2); border: 1px solid var(--line); }
.toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--panel); padding: 9px 16px; border-radius: var(--r-m);
  box-shadow: var(--shadow); z-index: 50; font-size: .9rem; }

/* ---------- Startseite / Kurs ---------- */
.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 32px; align-items: center; padding: 8px 0 28px; }
.hero h1 { font-size: 3rem; letter-spacing: -.03em; margin-bottom: .2em; }
.hero p { font-size: 1.08rem; color: var(--ink-2); max-width: 46ch; }
.hero-lab { height: 280px; border: 1px solid var(--line); border-radius: var(--r-m); overflow: hidden; background: var(--paper); position: relative; }
.hero-lab .caption { position: absolute; left: 12px; bottom: 10px; font-size: .78rem; color: var(--ink-2); background: color-mix(in srgb, var(--panel) 85%, transparent); padding: 3px 8px; border-radius: 99px; }
.modules { display: grid; gap: 18px; margin-top: 12px; }
.module { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 20px 22px; display: grid; grid-template-columns: 56px 1fr; gap: 16px; }
.module .num { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 1.1rem; border: 2px solid var(--ink); }
.module.done .num { background: var(--ink); color: var(--panel); }
.module h2 { margin-bottom: .2em; }
.module .bands { display: flex; gap: 3px; margin: 2px 0 10px; }
.module .bands i { width: 26px; height: 6px; border-radius: 3px; display: block; }
.lessons { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 2px; }
.lessons a { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 7px 10px; border-radius: var(--r-s); color: var(--ink); text-decoration: none; }
.lessons a:hover { background: var(--panel-2); }
.lessons .st { color: var(--ink-3); display: grid; place-items: center; }
.lessons .st.ok { color: var(--ok); }
.lessons .meta { font-size: .8rem; color: var(--ink-3); }
.progressbar { height: 6px; background: var(--grid); border-radius: 3px; overflow: hidden; }
.progressbar > i { display: block; height: 100%; background: var(--ok); }

/* ---------- Lektion ---------- */
.lesson { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
.lesson-top { display: flex; align-items: center; gap: 14px; padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
.lesson-top .crumb { color: var(--ink-2); font-size: .85rem; }
.lesson-top h1 { font-size: 1.15rem; margin: 0; }
.steps { display: flex; gap: 6px; margin-left: auto; }
.steps button { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line); background: var(--panel); cursor: pointer; font-size: .75rem; color: var(--ink-2); display: grid; place-items: center; padding: 0; }
.steps button.cur { border-color: var(--ink); color: var(--ink); font-weight: 700; }
.steps button.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
.lesson-body { overflow: auto; min-height: 0; }
.lesson-body.is-lab { overflow: hidden; display: grid; grid-template-columns: 340px 1fr; }
.lesson-nav { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 20px; border-top: 1px solid var(--line); background: var(--panel); }
.theory { max-width: 760px; margin: 0 auto; padding: 30px 28px 48px; }
.theory p, .theory li { max-width: 70ch; }
.theory h2 { margin-top: 1.3em; }
.theory .note { border-left: 3px solid var(--l-eth); background: var(--panel); padding: 10px 14px; border-radius: 0 var(--r-s) var(--r-s) 0; margin: 14px 0; }
.theory .note.warn { border-color: var(--warn); }
.theory table { border-collapse: collapse; margin: 12px 0 18px; width: 100%; font-size: .92rem; background: var(--panel); }
.theory th, .theory td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
.theory th { background: var(--panel-2); font-weight: 600; }
.theory pre { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-s); padding: 10px 12px; overflow: auto; font: .82rem/1.45 var(--mono); }
.goalcol { border-right: 1px solid var(--line); background: var(--panel); overflow: auto; padding: 18px 18px 24px; }
.goalcol h2 { font-size: 1.15rem; }
.goals { list-style: none; padding: 0; margin: 12px 0; display: grid; gap: 8px; }
.goals li { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: start; font-size: .92rem; }
.goals li .st { color: var(--ink-3); margin-top: 1px; }
.goals li.ok .st { color: var(--ok); }
.goals li.ok .txt { color: var(--ink-2); }
.goals .ask { display: grid; gap: 4px; margin-top: 4px; }
.hint { margin-top: 10px; font-size: .88rem; background: var(--panel-2); border: 1px dashed var(--line); padding: 8px 10px; border-radius: var(--r-s); }
.done-banner { margin-top: 12px; padding: 10px 12px; border-radius: var(--r-s); background: color-mix(in srgb, var(--ok) 14%, var(--panel)); border: 1px solid color-mix(in srgb, var(--ok) 45%, transparent); font-weight: 600; }

/* ---------- Widgets ---------- */
.widget { max-width: 860px; margin: 0 auto; padding: 30px 28px 48px; }
.quiz-q { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 16px 18px; margin-bottom: 14px; }
.quiz-q .opts { display: grid; gap: 6px; margin-top: 10px; }
.quiz-q label { display: flex; gap: 10px; align-items: flex-start; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-s); cursor: pointer; }
.quiz-q label:hover { border-color: var(--ink-3); }
.quiz-q label.right { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, var(--panel)); }
.quiz-q label.wrong { border-color: var(--err); background: color-mix(in srgb, var(--err) 8%, var(--panel)); }
.quiz-q .explain { margin-top: 10px; font-size: .9rem; color: var(--ink-2); }
.quiz-q input[type=text] { width: 160px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 18px; min-height: 40px; padding: 8px; border: 1px dashed var(--line); border-radius: var(--r-m); }
.dchip { padding: 6px 12px; border-radius: var(--r-s); background: var(--panel); border: 1px solid var(--ink-3); cursor: grab; user-select: none; font-size: .88rem; }
.dchip.sel { border-color: var(--select); box-shadow: 0 0 0 2px color-mix(in srgb, var(--select) 30%, transparent); }
.slotrow { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 6px; }
.slot { border: 2px dashed var(--line); border-radius: var(--r-s); min-height: 74px; padding: 6px; display: flex; flex-direction: column; justify-content: space-between; align-items: center;
  font-size: .8rem; text-align: center; background: var(--panel); flex: 0 0 auto; }
.slot .size { color: var(--ink-3); font-family: var(--mono); font-size: .75rem; }
.slot.filled { border-style: solid; }
.slot.right { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 9%, var(--panel)); }
.slot.wrong { border-color: var(--err); }
.slot.over { border-color: var(--focus); }
.stack-list { display: grid; gap: 6px; max-width: 560px; }
.stack-item { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 8px; padding: 8px 10px; background: var(--panel); border: 1px solid var(--line); border-left-width: 6px; border-radius: var(--r-s); cursor: grab; }
.stack-item.dragging { opacity: .5; }
.macbits { display: grid; grid-template-columns: repeat(8, 38px); gap: 4px; margin: 12px 0; }
.macbits div { text-align: center; padding: 6px 0; border: 1px solid var(--line); border-radius: var(--r-s); font-family: var(--mono); background: var(--panel); }
.macbits div.hl { border-color: var(--select); background: color-mix(in srgb, var(--select) 12%, var(--panel)); font-weight: 700; }
.macbits span { display: block; font-size: .66rem; color: var(--ink-3); }
.rtable { border-collapse: collapse; font-family: var(--mono); font-size: .85rem; background: var(--panel); }
.rtable td, .rtable th { border: 1px solid var(--line); padding: 5px 10px; text-align: left; }
.rtable th { font-family: var(--font); background: var(--panel-2); font-weight: 600; font-size: .82rem; }
.feedback { margin-top: 10px; font-weight: 600; }
.feedback.ok { color: var(--ok); } .feedback.bad { color: var(--err); }

/* ---------- Labor ---------- */
.lab { display: grid; grid-template-columns: 58px minmax(0, 1fr) 340px; grid-template-rows: minmax(0, 1fr) 230px; height: 100%; min-height: 0; }
.lab.compact { grid-template-columns: 52px minmax(0, 1fr) 300px; grid-template-rows: minmax(0, 1fr) 210px; }
.lab.no-palette { grid-template-columns: 0 minmax(0, 1fr) 320px; }
.palette { grid-row: 1 / 3; border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; gap: 4px; padding: 8px 5px; overflow: hidden; }
.pal-item { display: grid; place-items: center; gap: 0; padding: 5px 0 4px; border-radius: var(--r-s); cursor: grab; font-size: .66rem; color: var(--ink-2); border: 1px solid transparent; background: none; }
.pal-item:hover { border-color: var(--line); background: var(--panel-2); }
.pal-item svg { width: 34px; height: 34px; }
.pal-sep { height: 1px; background: var(--line); margin: 4px 2px; }
.canvas-wrap { position: relative; min-width: 0; min-height: 0; overflow: hidden; background-color: var(--paper);
  background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px; }
.canvas-wrap svg.net { width: 100%; height: 100%; display: block; user-select: none; touch-action: none; }
.canvas-wrap.connecting { cursor: crosshair; }
.player { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 8px; align-items: center; pointer-events: none; flex-wrap: wrap; }
.player > * { pointer-events: auto; }
.player .bar { display: flex; align-items: center; gap: 4px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 4px; box-shadow: var(--shadow); }
.player .time { font-family: var(--mono); font-size: .8rem; color: var(--ink-2); padding: 0 8px; min-width: 88px; }
.player input[type=range] { width: 110px; accent-color: var(--ink); }
.player .speedlbl { font-size: .75rem; color: var(--ink-2); padding-right: 6px; }
.hint-overlay { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); border-radius: 99px; padding: 6px 14px; font-size: .85rem; color: var(--ink-2); }

.side { border-left: 1px solid var(--line); background: var(--panel); display: grid; grid-template-rows: auto auto 1fr; grid-template-columns: minmax(0, 1fr); min-width: 0; min-height: 0; grid-row: 1 / 3; grid-column: 3; }
.side-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }
.side-head .devglyph { width: 34px; height: 34px; flex: none; }
.side-head .grow { min-width: 0; }
.side-head .name { font-weight: 650; font-size: 1.02rem; border: 1px solid transparent; background: none; padding: 2px 4px; border-radius: 4px; width: 100%; }
.side-head .name:hover { border-color: var(--line); }
.tabs { display: flex; gap: 0; padding: 0 6px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.tabs button { border: 0; background: none; padding: 7px 8px; white-space: nowrap; cursor: pointer; color: var(--ink-2); display: flex; align-items: center; gap: 5px; font-size: .86rem; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button.cur { color: var(--ink); border-bottom-color: var(--ink); font-weight: 600; }
.side-body { overflow: auto; padding: 12px 14px 20px; min-height: 0; }
.side-body h4 { font-size: .8rem; font-weight: 650; color: var(--ink-2); margin: 14px 0 6px; }
.side-body > h4:first-child, .side-body > :first-child > h4:first-child { margin-top: 0; }
.cfg-grid { display: grid; grid-template-columns: 58px 1fr 52px; gap: 5px 6px; align-items: center; font-size: .85rem; }
.cfg-grid .if { font-family: var(--mono); font-size: .8rem; color: var(--ink-2); }
.cfg-grid.ports { grid-template-columns: 44px 92px minmax(0, 1fr); }
.cfg-grid.vx { grid-template-columns: 1fr 1fr; }
.list { display: grid; gap: 6px; }
.list .item { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5px; padding: 8px; border: 1px solid var(--line); border-radius: var(--r-s); background: var(--panel-2); }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; font-size: .85rem; }
.kv dt { color: var(--ink-2); } .kv dd { margin: 0; font-family: var(--mono); font-size: .82rem; }
.tbl { width: 100%; border-collapse: collapse; font-size: .78rem; font-family: var(--mono); }
.tbl th { font-family: var(--font); text-align: left; font-weight: 600; color: var(--ink-2); padding: 4px 4px; border-bottom: 1px solid var(--line); font-size: .76rem; }
.tbl td { padding: 4px 4px; border-bottom: 1px solid var(--grid); word-break: break-all; }
.empty { color: var(--ink-3); font-size: .85rem; padding: 6px 0; }
.console { display: grid; grid-template-rows: 1fr auto auto; grid-template-columns: minmax(0, 1fr); height: 100%; min-height: 260px; }
.console pre { margin: 0; background: #0F1A2A; color: #D7E2F0; border-radius: var(--r-s); padding: 10px; font: .78rem/1.45 var(--mono); overflow: auto; min-height: 180px; max-height: 100%; white-space: pre-wrap; word-break: break-word; }
.console .in { display: flex; gap: 6px; margin-top: 6px; }
.console .in .input { flex: 1; min-width: 0; font-family: var(--mono); font-size: .82rem; }
.console .quick { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.console .quick button { font-size: .74rem; padding: 2px 8px; }

.dock { grid-column: 2; grid-row: 2; border-top: 1px solid var(--line); background: var(--panel); display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); min-height: 0; }
.lab.no-palette .dock { grid-column: 2; }
.dock-col { display: grid; grid-template-rows: auto 1fr; min-height: 0; min-width: 0; }
.dock-col + .dock-col { border-left: 1px solid var(--line); }
.dock-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); font-size: .82rem; font-weight: 600; }
.dock-head .muted { font-weight: 400; }
.dock-head select { font-size: .78rem; padding: 2px 6px; }
.log { overflow: auto; min-height: 0; font-size: .8rem; }
.log .e { display: grid; grid-template-columns: 58px 74px 1fr; gap: 6px; padding: 3px 10px; border-bottom: 1px solid var(--grid); cursor: default; align-items: start; }
.log .e.has-frame { cursor: pointer; }
.log .e:hover { background: var(--panel-2); }
.log .e.sel { background: color-mix(in srgb, var(--select) 12%, var(--panel)); }
.log .t { font-family: var(--mono); color: var(--ink-3); font-size: .74rem; padding-top: 1px; }
.log .d { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log .e.k-drop .x, .log .e.k-err .x { color: var(--err); }
.log .e.k-ok .x { color: var(--ok); }
.log .e.k-learn .x { color: var(--l-vlan); }
.log .e.k-ignore .x { color: var(--ink-3); }
.log .e.k-send .x { color: var(--ink-2); }
.inspector { overflow: auto; min-height: 0; padding: 8px 10px 14px; font-size: .82rem; }
.bytebar { display: flex; height: 22px; border-radius: 4px; overflow: hidden; margin: 6px 0 4px; border: 1px solid var(--line); }
.bytebar i { display: block; min-width: 3px; }
.bytelegend { display: flex; justify-content: space-between; font-family: var(--mono); font-size: .72rem; color: var(--ink-3); }
.layer { border: 1px solid var(--line); border-left: 5px solid var(--lc, var(--ink-3)); border-radius: var(--r-s); margin-top: 6px; background: var(--panel); }
.layer > summary { cursor: pointer; padding: 5px 8px; font-weight: 600; display: flex; gap: 8px; align-items: center; list-style: none; }
.layer > summary::-webkit-details-marker { display: none; }
.layer > summary .b { margin-left: auto; font-weight: 400; color: var(--ink-3); font-family: var(--mono); font-size: .74rem; }
.layer table { width: 100%; border-collapse: collapse; }
.layer td { padding: 3px 8px; border-top: 1px solid var(--grid); vertical-align: top; }
.layer td:first-child { color: var(--ink-2); width: 36%; }
.layer td.v { font-family: var(--mono); font-size: .78rem; }
.layer td.h { color: var(--ink-3); font-size: .74rem; }
.layer.inner { margin-left: 12px; }
.lc-eth { --lc: var(--l-eth); } .lc-vlan { --lc: var(--l-vlan); } .lc-arp { --lc: var(--l-arp); } .lc-ip { --lc: var(--l-ip); }
.lc-icmp { --lc: var(--l-icmp); } .lc-udp { --lc: var(--l-udp); } .lc-vxlan { --lc: var(--l-vxlan); } .lc-frag { --lc: var(--l-frag); } .lc-data { --lc: var(--l-data); } .lc-tcp { --lc: var(--l-tcp); } .lc-stp { --lc: var(--l-stp); } .lc-dns { --lc: var(--l-udp); }
.bg-eth { background: var(--l-eth); } .bg-vlan { background: var(--l-vlan); } .bg-arp { background: var(--l-arp); } .bg-ip { background: var(--l-ip); }
.bg-icmp { background: var(--l-icmp); } .bg-udp { background: var(--l-udp); } .bg-vxlan { background: var(--l-vxlan); } .bg-frag { background: var(--l-frag); } .bg-data { background: var(--l-data); } .bg-tcp { background: var(--l-tcp); } .bg-stp { background: var(--l-stp); }

/* ---------- SVG-Netzplan ---------- */
svg.net text { font-family: var(--font); fill: var(--ink); }
svg.net .lnk { stroke: var(--ink-3); stroke-width: 2.5; }
svg.net .lnk.down { stroke-dasharray: 6 5; stroke: var(--err); }
svg.net .lnk.jumbo { stroke-width: 4.5; }
svg.net .lnk-hit { stroke: transparent; stroke-width: 14; cursor: pointer; }
svg.net .lnk-g.sel .lnk { stroke: var(--select); }
svg.net .iflbl { font-family: var(--mono); font-size: 10px; fill: var(--ink-2); }
svg.net .mtulbl { font-family: var(--mono); font-size: 9.5px; fill: var(--ink-3); }
svg.net .dev { cursor: pointer; outline: none; }
svg.net .dev:focus-visible .card { stroke: var(--focus); stroke-width: 2.5; }
svg.net .dev .card { fill: var(--panel); stroke: var(--line); stroke-width: 1.5; }
svg.net .dev:hover .card { stroke: var(--ink-3); }
svg.net .dev.sel .card { stroke: var(--select); stroke-width: 2.5; }
svg.net .dev.trace .card { stroke: var(--l-vxlan); stroke-width: 2.5; }
svg.net .dev.pend .card { stroke: var(--focus); stroke-dasharray: 4 3; stroke-width: 2.5; }
svg.net .dev .nm { font-size: 12.5px; font-weight: 650; text-anchor: middle; }
svg.net .dev .ip { font-family: var(--mono); font-size: 10px; fill: var(--ink-2); text-anchor: middle; }
svg.net .dv-fill { fill: color-mix(in srgb, var(--ink) 8%, var(--panel)); stroke: var(--ink); stroke-width: 1.6; }
svg.net .dv-line { stroke: var(--ink); stroke-width: 1.6; fill: none; }
svg.net .dv-screen { fill: color-mix(in srgb, var(--l-eth) 18%, var(--panel)); stroke: none; }
svg.net .dv-led { fill: var(--l-ip); stroke: none; }
svg.net .dv-tunnel { stroke: var(--l-vxlan); stroke-width: 2.4; stroke-dasharray: 3 3; fill: none; }
svg.net .t-router .dv-fill { fill: color-mix(in srgb, var(--l-ip) 14%, var(--panel)); }
svg.net .t-switch .dv-fill { fill: color-mix(in srgb, var(--l-eth) 14%, var(--panel)); }
svg.net .t-vtep .dv-fill { fill: color-mix(in srgb, var(--l-vxlan) 13%, var(--panel)); }
svg.net .pkt { cursor: pointer; }
svg.net .pkt rect.box { stroke: var(--ink); stroke-width: 1.2; }
svg.net .pkt text { font-size: 9.5px; font-weight: 700; text-anchor: middle; fill: var(--ink); paint-order: stroke; stroke: var(--paper); stroke-width: 3px; }
svg.net .zone-g { --zc: var(--ink-3); }
svg.net .zone-g.c-blue { --zc: var(--l-eth); } svg.net .zone-g.c-violet { --zc: var(--l-vlan); } svg.net .zone-g.c-green { --zc: var(--l-ip); }
svg.net .zone-g.c-orange { --zc: var(--l-arp); } svg.net .zone-g.c-pink { --zc: var(--l-vxlan); } svg.net .zone-g.c-yellow { --zc: var(--l-stp); }
svg.net .zone { fill: color-mix(in srgb, var(--zc) 7%, transparent); stroke: var(--zc); stroke-dasharray: 6 5; pointer-events: none; }
svg.net .zone-g.sel .zone { stroke-dasharray: none; stroke-width: 1.6; }
svg.net .zone-tab { fill: color-mix(in srgb, var(--zc) 14%, var(--panel)); stroke: color-mix(in srgb, var(--zc) 55%, transparent); cursor: move; }
svg.net.ro .zone-tab { cursor: default; pointer-events: none; }
svg.net .zone-t { font-size: 11px; fill: var(--ink); pointer-events: none; font-weight: 600; }
svg.net .zone-rs { fill: var(--panel); stroke: var(--zc); cursor: nwse-resize; opacity: 0; transition: opacity .12s; }
svg.net .zone-g:hover .zone-rs, svg.net .zone-g.sel .zone-rs { opacity: 1; }
svg.net .stp-dot circle { stroke: var(--panel); stroke-width: 1.5; }
svg.net .stp-dot text { font-size: 7.5px; font-weight: 700; fill: #fff; pointer-events: none; }
svg.net .stp-dot.st-forwarding circle { fill: var(--ok); }
svg.net .stp-dot.st-blocking circle { fill: var(--err); }
svg.net .stp-dot.st-listening circle, svg.net .stp-dot.st-learning circle { fill: var(--warn); }
svg.net .stp-dot.st-disabled circle { fill: var(--ink-3); }
svg.net .dev .stpbadge { font-size: 10px; fill: var(--l-stp); font-weight: 650; }
.swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--panel); box-shadow: 0 0 0 1px var(--line); cursor: pointer; padding: 0; }
.swatch.cur { box-shadow: 0 0 0 2px var(--ink); }
.storm { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); width: min(520px, calc(100% - 32px)); background: var(--panel); border: 1px solid var(--err); border-left-width: 4px; border-radius: var(--r-m); box-shadow: var(--shadow); padding: 12px 14px; display: grid; gap: 8px; font-size: .9rem; }
.storm.hidden { display: none; }
.storm b { color: var(--err); }
.player .tog { font-size: .72rem; font-weight: 650; padding: 0 8px; height: 30px; border-radius: var(--r-s); border: 1px solid transparent; background: none; color: var(--ink-3); cursor: pointer; }
.player .tog.on { color: var(--l-stp); border-color: color-mix(in srgb, var(--l-stp) 45%, transparent); background: color-mix(in srgb, var(--l-stp) 10%, transparent); }
.palette svg .dv-fill { fill: color-mix(in srgb, var(--ink) 8%, var(--panel)); stroke: var(--ink); stroke-width: 1.6; }
.palette svg .dv-line { stroke: var(--ink); stroke-width: 1.6; fill: none; }
.palette svg .dv-screen { fill: color-mix(in srgb, var(--l-eth) 18%, var(--panel)); }
.palette svg .dv-led { fill: var(--l-ip); }
.palette svg .dv-tunnel { stroke: var(--l-vxlan); stroke-width: 2.4; stroke-dasharray: 3 3; fill: none; }
.devglyph .dv-fill { fill: color-mix(in srgb, var(--ink) 8%, var(--panel)); stroke: var(--ink); stroke-width: 1.6; }
.devglyph .dv-line { stroke: var(--ink); stroke-width: 1.6; fill: none; }
.devglyph .dv-screen { fill: color-mix(in srgb, var(--l-eth) 18%, var(--panel)); }
.devglyph .dv-led { fill: var(--l-ip); }
.devglyph .dv-tunnel { stroke: var(--l-vxlan); stroke-width: 2.4; stroke-dasharray: 3 3; fill: none; }

/* ---------- Labor-Seite und Netze ---------- */
.labpage { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.labbar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.labbar .title { font-weight: 650; margin-right: 8px; }
.netgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; margin-top: 16px; }
.netcard { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 16px; display: grid; gap: 8px; align-content: start; }
.netcard svg { width: 100%; height: 120px; background: var(--paper); border-radius: var(--r-s); border: 1px solid var(--grid-strong); }
.netcard h3 { margin: 4px 0 0; }

/* ---------- Frame-Baukasten ---------- */
.fb { display: grid; grid-template-columns: 220px 1fr; gap: 22px; margin-top: 14px; }
.fb-pal { display: grid; gap: 6px; align-content: start; }
.fb-blk { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: var(--r-s); background: var(--panel); border: 1px solid var(--line); border-left: 6px solid var(--lc); cursor: grab; font-size: .9rem; }
.fb-blk .sz { margin-left: auto; font-family: var(--mono); font-size: .75rem; color: var(--ink-3); }
.fb-drop { min-height: 96px; border: 2px dashed var(--line); border-radius: var(--r-m); padding: 10px; display: flex; gap: 4px; align-items: stretch; flex-wrap: wrap; background: var(--panel); }
.fb-drop.over { border-color: var(--focus); }
.bld { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 14px; margin-top: 14px; align-items: start; }
.bld-pal .fb-blk { cursor: pointer; text-align: left; font: inherit; color: inherit; }
.bld-pal .fb-blk .sz svg { width: 14px; height: 14px; }
.bld-frame { display: grid; gap: 8px; min-height: 80px; }
.bld-layer { background: var(--panel); border: 1px solid var(--line); border-left: 6px solid var(--lc); border-radius: var(--r-s); padding: 6px 10px 10px; }
.bld-layer.wrong { border-color: var(--err); border-left-color: var(--err); }
.bld-head { display: flex; align-items: center; gap: 4px; }
.bld-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin-top: 4px; }
.bld-fields .field { font-size: .78rem; }
.bld-fields .input.bad { border-color: var(--err); background: color-mix(in srgb, var(--err) 7%, var(--panel)); }
@media (max-width: 720px) { .bld { grid-template-columns: 1fr; } .bld-pal { grid-template-columns: repeat(3, 1fr); } }
.fb-cell { border-radius: var(--r-s); padding: 8px 10px 6px; color: #fff; display: grid; gap: 2px; min-width: 74px; position: relative; cursor: grab; }
.fb-cell .n { font-weight: 650; font-size: .86rem; }
.fb-cell .sz { font-family: var(--mono); font-size: .72rem; opacity: .9; }
.fb-cell button { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,.2); color: #fff; border: 0; border-radius: 4px; width: 18px; height: 18px; display: grid; place-items: center; cursor: pointer; padding: 0; font-size: 11px; }
.fb-cell.bad { outline: 3px solid var(--err); outline-offset: 1px; }
.fb-msgs { margin-top: 10px; display: grid; gap: 4px; font-size: .9rem; }
.fb-msgs .m.bad { color: var(--err); } .fb-msgs .m.ok { color: var(--ok); }
.fb-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 14px; }
.fb-stats div { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-s); padding: 10px 12px; }
.fb-stats b { display: block; font-size: 1.3rem; font-family: var(--mono); }
.fb-stats span { font-size: .8rem; color: var(--ink-2); }

@media (max-width: 1100px) {
  .lab { grid-template-columns: 52px minmax(0, 1fr) 290px; }
  .lesson-body.is-lab { grid-template-columns: 290px 1fr; }
  .hero { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .app { grid-template-columns: 1fr; grid-template-rows: 1fr 60px; }
  .rail { order: 2; flex-direction: row; border-right: 0; border-top: 1px solid var(--line); padding: 4px; justify-content: space-around; }
  .rail .logo, .rail .spacer { display: none; }
  .main { order: 1; }
  .lab, .lab.compact { grid-template-columns: 0 1fr; grid-template-rows: 1fr 200px auto; height: auto; min-height: 100%; }
  .palette { display: none; }
  .side { grid-column: 1 / 3; grid-row: 3; max-height: 60vh; border-left: 0; border-top: 1px solid var(--line); }
  .dock { grid-column: 1 / 3; grid-template-columns: 1fr; }
  .lesson-body.is-lab { grid-template-columns: 1fr; overflow: auto; }
  .goalcol { border-right: 0; border-bottom: 1px solid var(--line); }
  .fb { grid-template-columns: 1fr; }
  .page { padding: 20px 16px 48px; }
  .hero h1 { font-size: 2.2rem; }
  .lesson { height: auto; min-height: 100%; }
  .lesson-body.is-lab .lab { height: 80vh; }
}
__PACKETPILOT_FILE_END__
  cat > "$W/index.html" <<'__PACKETPILOT_FILE_END__'
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PacketPilot</title>
<meta name="description" content="Netzwerke verstehen, indem du jedem Paket zuschaust: Kurs, Labor und Frame-Baukasten.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='8' width='26' height='16' rx='3' fill='%2317253A'/%3E%3Crect x='7' y='12' width='3' height='8' rx='1' fill='%232F6FDB'/%3E%3Crect x='12' y='12' width='3' height='8' rx='1' fill='%231F9D68'/%3E%3Crect x='17' y='12' width='3' height='8' rx='1' fill='%238B5E3C'/%3E%3Crect x='22' y='12' width='3' height='8' rx='1' fill='%23EE7F1A'/%3E%3C/svg%3E">
<link rel="stylesheet" href="css/app.css">
<script>try{var t=JSON.parse(localStorage.getItem('packetpilot.v1')||'{}').prefs;if(t&&t.theme)document.documentElement.dataset.theme=t.theme}catch(e){}</script>
</head>
<body>
<div class="app">
  <nav class="rail" aria-label="Hauptnavigation">
    <a class="logo" href="#/" title="PacketPilot" aria-label="PacketPilot Startseite">
      <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true"><rect x="3" y="8" width="26" height="16" rx="3" fill="var(--ink)"/><rect x="7" y="12" width="3" height="8" rx="1" fill="var(--l-eth)"/><rect x="12" y="12" width="3" height="8" rx="1" fill="var(--l-ip)"/><rect x="17" y="12" width="3" height="8" rx="1" fill="var(--l-udp)"/><rect x="22" y="12" width="3" height="8" rx="1" fill="var(--l-arp)"/></svg>
    </a>
    <a href="#/" data-nav="kurs"><span data-icon="course"></span>Kurs</a>
    <a href="#/labor" data-nav="labor"><span data-icon="lab"></span>Labor</a>
    <a href="#/netze" data-nav="netze"><span data-icon="nets"></span>Netze</a>
    <a href="#/baukasten" data-nav="baukasten"><span data-icon="frame"></span>Frames</a>
    <span class="spacer"></span>
    <button id="theme" type="button" title="Hell oder dunkel"></button>
  </nav>
  <main class="main"></main>
</div>
<noscript><p style="padding:2rem">PacketPilot braucht JavaScript.</p></noscript>
<script type="module">
  import { I } from './js/icons.js';
  document.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = I[e.dataset.icon]);
  import('./js/app.js');
</script>
</body>
</html>
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/app.js" <<'__PACKETPILOT_FILE_END__'
// PacketPilot: Ansichten und Navigation
import { h, toast, download, pickFile } from './ui.js';
import { I } from './icons.js';
import { store } from './store.js';
import { MODULES, UPCOMING, findLesson, nextLesson } from './course/index.js';
import { renderWidget } from './widgets.js';
import { Lab } from './lab.js';
import { PRESETS } from './presets.js';
import { preview, heroSim } from './minimap.js';
import { renderFrameBuilder } from './framebuilder.js';
import { clone } from './net.js';

const main = document.querySelector('.main');
let cleanup = [];
function clear() { cleanup.forEach(f => { try { f(); } catch { /* egal */ } }); cleanup = []; main.innerHTML = ''; main.scrollTop = 0; }

// ---------------------------------------------------------------- Thema
function applyTheme() {
  const t = store.prefs.theme;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const btn = document.querySelector('#theme');
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  btn.innerHTML = (dark ? I.sun : I.moon) + (dark ? 'Hell' : 'Dunkel');
}
document.querySelector('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  store.setPref('theme', dark ? 'light' : 'dark');
  applyTheme();
});
applyTheme();

// ---------------------------------------------------------------- Startseite und Kurs
function lessonProgress(l) { return { done: store.lessonDone(l.id), steps: store.lessonSteps(l.id), total: l.steps.length }; }
function viewHome() {
  const page = h('div', { class: 'page' });
  const heroBox = h('div', { class: 'hero-lab' }, h('span', { class: 'caption' }, 'Live: pc1 pingt srv1. Jeder Streifen auf dem Umschlag ist eine Schicht.'));
  const flat = MODULES.flatMap(m => m.lessons);
  const next = flat.find(l => !store.lessonDone(l.id)) || flat[0];
  const doneCount = flat.filter(l => store.lessonDone(l.id)).length;
  page.append(h('section', { class: 'hero' },
    h('div', {},
      h('h1', {}, 'PacketPilot'),
      h('p', {}, 'Netzwerke verstehen, indem du jedem Paket zuschaust. Baue Netze, sende Pakete im Zeitraffer, zerlege jeden Frame Schicht für Schicht und finde Fehler, bevor sie dich im echten Netz finden.'),
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('a', { class: 'btn primary', href: `#/lektion/${next.id}` }, doneCount ? 'Weiterlernen' : 'Mit Lektion 1 beginnen'),
        h('a', { class: 'btn', href: '#/labor' }, 'Freies Labor öffnen')),
      h('div', { class: 'small muted', style: { marginTop: '12px' } }, `${doneCount} von ${flat.length} Lektionen abgeschlossen`)),
    heroBox));
  page.append(h('h2', { style: { marginTop: '18px' } }, 'Kurs'));
  const mods = h('div', { class: 'modules' });
  MODULES.forEach((m, mi) => {
    const lp = m.lessons.map(lessonProgress);
    const allDone = lp.every(x => x.done);
    const list = h('ol', { class: 'lessons' });
    m.lessons.forEach((l, li) => {
      const p = lp[li];
      list.append(h('li', {}, h('a', { href: `#/lektion/${l.id}` },
        h('span', { class: 'st' + (p.done ? ' ok' : ''), html: p.done ? I.check : I.circle }),
        h('span', {}, l.title),
        h('span', { class: 'meta' }, p.done ? 'erledigt' : p.steps ? `${p.steps} von ${p.total} Schritten` : `${l.minutes} Min.`))));
    });
    const pct = Math.round(lp.filter(x => x.done).length / lp.length * 100);
    mods.append(h('article', { class: 'module' + (allDone ? ' done' : '') },
      h('div', { class: 'num', 'aria-hidden': 'true' }, String(mi + 1)),
      h('div', {},
        h('h2', {}, m.title),
        h('div', { class: 'bands', 'aria-hidden': 'true' }, m.bands.map(b => h('i', { class: `bg-${b}` }))),
        h('p', { class: 'muted' }, m.text),
        h('div', { class: 'progressbar', title: `${pct} % erledigt` }, h('i', { style: { width: `${pct}%` } })),
        list)));
  });
  page.append(mods);
  page.append(h('h2', { style: { marginTop: '28px' } }, 'In Vorbereitung'),
    h('div', { class: 'netgrid' }, UPCOMING.map(u => h('div', { class: 'netcard' }, h('h3', {}, u.title), h('p', { class: 'muted small' }, u.text)))));
  page.append(h('div', { class: 'row', style: { marginTop: '28px' } },
    h('button', { class: 'btn', html: I.download + 'Fortschritt und Netze exportieren', onclick: () => download('packetpilot-export.json', store.exportAll()) }),
    h('button', { class: 'btn', html: I.upload + 'Importieren', onclick: async () => { const t = await pickFile(); if (!t) return; try { store.importAll(t); toast('Import erfolgreich'); route(); } catch (e) { toast(e.message); } } }),
    h('button', { class: 'btn ghost', onclick: () => { if (confirm('Fortschritt aller Lektionen zurücksetzen?')) { store.resetProgress(); route(); } } }, 'Fortschritt zurücksetzen')));
  main.append(page);
  const heroTopo = PRESETS.find(p => p.id === 'routed').make();
  heroTopo.devices = heroTopo.devices.filter(d => d.id !== 'pc2');
  heroTopo.links = heroTopo.links.filter(l => l.a.dev !== 'pc2');
  let n = 0;
  cleanup.push(heroSim(heroBox, heroTopo, sim => {
    if (n++ % 2 === 0) for (const d of sim.devices.values()) d.l3?.arp.clear();
    sim.dev('pc1').ping('192.168.20.20', { count: 1 });
  }));
}

// ---------------------------------------------------------------- Lektion
function viewLesson(id, stepIdx) {
  const f = findLesson(id);
  if (!f) return viewHome();
  const { module: m, lesson: l } = f;
  let cur = Math.min(Math.max(0, Number(stepIdx) || 0), l.steps.length - 1);
  if (stepIdx === undefined) { const first = l.steps.findIndex((_, i) => !store.stepDone(l.id, i)); cur = first < 0 ? 0 : first; }
  const step = l.steps[cur];
  const top = h('div', { class: 'lesson-top' },
    h('a', { class: 'btn icon ghost', href: '#/', title: 'Zur Kursübersicht', html: I.left }),
    h('div', {}, h('div', { class: 'crumb' }, `Modul ${MODULES.indexOf(m) + 1}: ${m.title}`), h('h1', {}, l.title)));
  const steps = h('div', { class: 'steps', 'aria-label': 'Schritte' });
  l.steps.forEach((s, i) => steps.append(h('button', { class: (i === cur ? 'cur ' : '') + (store.stepDone(l.id, i) ? 'ok' : ''), title: s.title || s.type,
    onclick: () => go(i), 'aria-current': i === cur ? 'step' : null }, store.stepDone(l.id, i) && i !== cur ? '✓' : String(i + 1))));
  top.append(steps);
  const body = h('div', { class: 'lesson-body' });
  const nextBtn = h('button', { class: 'btn primary' });
  const status = h('span', { class: 'small muted' });
  const nav = h('div', { class: 'lesson-nav' },
    h('button', { class: 'btn', disabled: cur === 0 ? true : null, onclick: () => go(cur - 1), html: I.left + 'Zurück' }), status, nextBtn);
  const go = i => { location.hash = `#/lektion/${l.id}/${i}`; };
  const isLast = cur === l.steps.length - 1;
  const markDone = () => {
    store.markStep(l.id, cur);
    steps.children[cur].classList.add('ok');
    if (l.steps.every((_, i) => store.stepDone(l.id, i))) store.markLesson(l.id);
    nextBtn.disabled = false;
    status.textContent = step.type === 'theory' ? '' : 'Schritt erledigt';
  };
  const nl = nextLesson(l.id);
  nextBtn.innerHTML = isLast ? (nl ? 'Nächste Lektion' : 'Zur Übersicht') + I.right : 'Weiter' + I.right;
  nextBtn.addEventListener('click', () => {
    if (!isLast) return go(cur + 1);
    location.hash = nl ? `#/lektion/${nl.id}` : '#/';
  });
  const done0 = store.stepDone(l.id, cur);
  if (step.type !== 'theory' && !done0) { nextBtn.disabled = true; status.textContent = step.type === 'lab' ? 'Erfülle die Ziele links, dann geht es weiter' : 'Löse die Aufgabe, dann geht es weiter'; }
  main.append(h('div', { class: 'lesson' }, top, body, nav));

  if (step.type === 'theory') {
    body.append(h('article', { class: 'theory' }, h('h2', { style: { marginTop: 0 } }, step.title), h('div', { html: step.html })));
    markDone();
  } else if (step.type === 'lab') {
    labStep(step, body, markDone, done0, l.id + ':' + cur);
  } else {
    renderWidget({ ...step, id: l.id + cur }, body, markDone);
    if (done0) { nextBtn.disabled = false; status.textContent = 'Bereits erledigt, du kannst es aber nochmals lösen'; }
  }
}

function labStep(step, body, markDone, already, key) {
  body.classList.add('is-lab');
  const col = h('div', { class: 'goalcol' });
  const labRoot = h('div', { style: { minHeight: 0, minWidth: 0 } });
  body.append(col, labRoot);
  const ctx = { inspected: [] };
  const goalState = step.goals.map(() => false);
  const lab = new Lab(labRoot, { topo: step.topo(), edit: step.edit || 'config', compact: true, consolePresets: step.presets,
    onEvent: (type, data) => {
      if (type === 'inspect') ctx.inspected.push(data);
      if (type === 'sim' && data.type === 'tick') return;
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; evaluate(); }); }
    } });
  let pending = false;
  cleanup.push(() => lab.destroy());
  col.append(h('h2', {}, step.title), h('div', { class: 'theory', style: { padding: 0 }, html: step.intro || '' }));
  const list = h('ol', { class: 'goals' });
  const items = step.goals.map((g, i) => {
    const li = h('li', {}, h('span', { class: 'st', html: I.circle }), h('div', { class: 'txt' }, h('span', { html: g.text })));
    if (g.ask) {
      const inp = h('input', { class: 'input mono', placeholder: g.placeholder || 'Antwort', 'aria-label': 'Antwort' });
      const fb = h('span', { class: 'small' });
      const test = () => {
        const exp = g.expect(lab.sim).map(x => String(x).toLowerCase().trim());
        const ok = exp.includes(inp.value.toLowerCase().trim());
        fb.textContent = ok ? '' : 'Noch nicht, schau nochmals genau hin';
        fb.style.color = 'var(--err)';
        if (ok) { goalState[i] = true; inp.disabled = true; evaluate(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') test(); });
      li.querySelector('.txt').append(h('div', { class: 'ask' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, inp, h('button', { class: 'btn', onclick: test }, 'Prüfen')), fb));
    }
    list.append(li);
    return li;
  });
  col.append(list);
  const hintBox = h('div');
  if (step.hints?.length) {
    let shown = 0;
    const btn = h('button', { class: 'btn ghost', html: I.bulb + 'Tipp anzeigen' });
    btn.addEventListener('click', () => { hintBox.append(h('div', { class: 'hint' }, step.hints[shown++])); if (shown >= step.hints.length) btn.remove(); });
    col.append(btn, hintBox);
  }
  const outro = h('div');
  col.append(outro);
  col.append(h('div', { class: 'row', style: { marginTop: '16px' } },
    h('button', { class: 'btn ghost', html: I.reset + 'Netz neu laden', onclick: () => { lab.load(step.topo()); ctx.inspected = []; } })));
  let finished = false;
  function evaluate() {
    step.goals.forEach((g, i) => {
      if (!goalState[i] && g.check && g.check(lab.sim, ctx)) goalState[i] = true;
      items[i].classList.toggle('ok', goalState[i]);
      items[i].querySelector('.st').innerHTML = goalState[i] ? I.check : I.circle;
    });
    if (!finished && goalState.every(Boolean)) {
      finished = true;
      outro.append(h('div', { class: 'done-banner' }, 'Alle Ziele erreicht.'));
      if (step.outro) outro.append(h('div', { class: 'theory', style: { padding: '10px 0 0' }, html: step.outro }));
      markDone();
    }
  }
  if (already) { const n = h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Diesen Schritt hast du schon erledigt. Du kannst ihn trotzdem nochmals durchspielen.'); col.insertBefore(n, list); }
  // Erste Konsole öffnen, damit der Einstieg klar ist
  const firstDev = Object.keys(step.presets || {})[0];
  if (firstDev) lab.selectByName(firstDev, 'console');
}

// ---------------------------------------------------------------- Labor
function viewLab(presetId) {
  let topo;
  if (presetId) topo = PRESETS.find(p => p.id === presetId)?.make();
  if (!topo) topo = store.prefs.sandbox ? clone(store.prefs.sandbox) : PRESETS.find(p => p.id === 'routed').make();
  const nameIn = h('input', { class: 'input', value: topo.name || 'Mein Netz', 'aria-label': 'Name des Netzes', style: { width: '220px' } });
  const savedSel = h('select', { class: 'input', 'aria-label': 'Gespeicherte Netze' });
  const fillSaved = () => {
    savedSel.innerHTML = '';
    savedSel.append(h('option', { value: '' }, 'Gespeicherte Netze …'));
    for (const n of Object.keys(store.nets()).sort()) savedSel.append(h('option', { value: n }, n));
  };
  fillSaved();
  const root = h('div', { style: { minHeight: 0 } });
  const page = h('div', { class: 'labpage' }, h('div', { class: 'labbar' },
    h('span', { class: 'title' }, 'Labor'), nameIn,
    h('button', { class: 'btn', html: I.save + 'Speichern', onclick: () => { lab.sim.topo.name = nameIn.value.trim() || 'Mein Netz'; store.saveNet(lab.sim.topo.name, clone(lab.sim.topo)); fillSaved(); toast(`"${lab.sim.topo.name}" gespeichert`); } }),
    savedSel,
    h('button', { class: 'btn ghost', onclick: () => { const n = savedSel.value; if (n && confirm(`"${n}" löschen?`)) { store.deleteNet(n); fillSaved(); } } }, 'Löschen'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => { if (confirm('Leeres Netz beginnen? Nicht gespeicherte Änderungen gehen verloren.')) { lab.load({ name: 'Mein Netz', devices: [], links: [] }); nameIn.value = 'Mein Netz'; } } }, 'Neu'),
    h('a', { class: 'btn', href: '#/netze' }, 'Beispielnetze'),
    h('button', { class: 'btn', html: I.download + 'Export', onclick: () => download(`${(lab.sim.topo.name || 'netz').replace(/\W+/g, '-')}.json`, JSON.stringify(lab.sim.topo, null, 2)) }),
    h('button', { class: 'btn', html: I.upload + 'Import', onclick: async () => {
      const t = await pickFile(); if (!t) return;
      try { const d = JSON.parse(t); if (!Array.isArray(d.devices) || !Array.isArray(d.links)) throw new Error(); lab.load(d); nameIn.value = d.name || 'Importiert'; toast('Netz importiert'); }
      catch { toast('Diese Datei ist kein PacketPilot-Netz'); }
    } })), root);
  main.append(page);
  const lab = new Lab(root, { topo, edit: 'full', onEvent: type => { if (['config', 'added', 'deleted', 'linked', 'moved', 'renamed'].includes(type)) autosave(); } });
  let t;
  const autosave = () => { clearTimeout(t); t = setTimeout(() => store.setPref('sandbox', clone(lab.sim.topo)), 400); };
  savedSel.addEventListener('change', () => { const n = savedSel.value; if (!n) return; lab.load(clone(store.nets()[n].topo)); nameIn.value = n; autosave(); });
  nameIn.addEventListener('change', () => { lab.sim.topo.name = nameIn.value; autosave(); });
  if (presetId) autosave();
  cleanup.push(() => lab.destroy());
}

// ---------------------------------------------------------------- Beispielnetze
function viewNets() {
  const page = h('div', { class: 'page' }, h('h1', {}, 'Beispielnetze'),
    h('p', { class: 'muted' }, 'Fertige Topologien zum Ausprobieren. Ein Netz öffnet sich im Labor, dort kannst du alles verändern und unter eigenem Namen speichern.'));
  const grid = h('div', { class: 'netgrid' });
  for (const p of PRESETS) {
    grid.append(h('article', { class: 'netcard' }, preview(p.make()), h('h3', {}, p.title),
      h('div', { class: 'row' }, p.topics.map(t => h('span', { class: 'chip' }, t))),
      h('p', { class: 'muted small' }, p.text),
      h('div', {}, h('a', { class: 'btn primary', href: `#/labor/${p.id}` }, 'Im Labor öffnen'))));
  }
  page.append(grid);
  main.append(page);
}

// ---------------------------------------------------------------- Router
function route() {
  clear();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const nav = parts[0] || '';
  document.querySelectorAll('.rail a').forEach(a => a.classList.toggle('active',
    (a.dataset.nav === 'kurs' && (nav === '' || nav === 'lektion')) || a.dataset.nav === nav));
  if (nav === 'lektion') viewLesson(parts[1], parts[2]);
  else if (nav === 'labor') viewLab(parts[1]);
  else if (nav === 'netze') viewNets();
  else if (nav === 'baukasten') { renderFrameBuilder(main); }
  else viewHome();
  document.title = 'PacketPilot';
}
window.addEventListener('hashchange', route);
route();
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/cli.js" <<'__PACKETPILOT_FILE_END__'
// Kleine Kommandozeile pro Gerät, angelehnt an iproute2 und FRR
import { isIp, parseCidr } from './net.js';
import { PORTS } from './engine.js';

const pad = (s, n) => String(s).padEnd(n);

export function helpFor(dev) {
  const l = [];
  if (dev.l3) l.push(
    'ping <ip> [-c anzahl] [-s grösse] [-M do|dont] [-t ttl]',
    'traceroute <ip>',
    'ip addr               Adressen anzeigen (auch: ip -br a)',
    'ip route              Routing-Tabelle (Kernel)',
    'ip route get <ip>     Welche Route nimmt ein Paket?',
    'ip route add <netz> via <ip>   statische Route hinzufügen',
    'ip route del <netz>   statische Route entfernen',
    'ip neigh              ARP-Tabelle',
    'ip neigh flush        ARP-Tabelle leeren',
    'arping [-U|-A|-D] [-c n] <ip>   ARP-Anfrage, Gratuitous ARP (-U/-A), Adressprüfung (-D)',
    'curl http://<ip>[:port]/         HTTP über TCP abrufen',
    'nc -zv <ip> <port>    prüfen, ob ein TCP-Port offen ist',
    'nc -u <ip> <port>     ein UDP-Datagramm senden',
    'dig [@server] <name>  DNS-Abfrage über UDP 53',
    'curl http://<name>/   erst DNS, dann TCP (DNS-Server in der Konfiguration)',
    'ss -tan / ss -tuln    TCP-Verbindungen / offene Ports');
  if (dev.type === 'router') l.push(
    'ip link add link eth1 name eth1.10 type vlan id 10   Subinterface anlegen',
    'ip addr add 10.10.0.1/24 dev eth1.10   Adresse setzen',
    'ip link del eth1.10   Subinterface löschen');
  l.push('ip link set <port> down|up   Kabel an diesem Port trennen oder verbinden');
  if (dev.type === 'router') l.push('show ip route         Routing-Tabelle im FRR-Stil', 'sysctl net.ipv4.ip_forward=0|1');
  if (dev.bridge) l.push('bridge fdb            MAC-Tabelle (auch: show mac address-table)', 'bridge fdb flush      MAC-Tabelle leeren');
  if (dev.type === 'switch') l.push('show spanning-tree    STP-Zustand: Root, Rollen, Zustände',
    'spanning-tree on|off  STP ein- oder ausschalten',
    'spanning-tree priority <0-61440>   Bridge-Priorität (Vielfache von 4096)',
    'spanning-tree portfast <port> on|off   Port als Edge-Port',
    'spanning-tree cost <port> <kosten>     Portkosten');
  if (dev.type === 'vtep') l.push('show vxlan            VXLAN-Segmente, Flood-Listen, MTU');
  l.push('clear                 Konsole leeren');
  return l;
}

export function runCommand(dev, line) {
  const p = line.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return;
  const sim = dev.sim;
  const say = t => dev.print(t);
  const cmd = p.join(' ');
  const own = ['ping', 'traceroute', 'arping', 'curl', 'nc', 'dig', 'nslookup'];
  if (!own.includes(p[0]) || !dev.l3) say(`$ ${cmd}`);
  try {
    if (p[0] === 'help' || p[0] === '?') return helpFor(dev).forEach(say);
    if (p[0] === 'clear') { dev.consoleLines.length = 0; sim.emit('console', { devId: dev.id, clear: true }); return; }

    if (p[0] === 'ping') {
      if (!dev.l3) return say('Dieses Gerät hat keine IP-Adresse. Ping geht von PCs, Servern, Routern und VTEPs aus.');
      const o = { count: 4 }; let dst = null;
      for (let i = 1; i < p.length; i++) {
        if (p[i] === '-c') o.count = Math.min(100, Math.max(1, Number(p[++i]) || 4));
        else if (p[i] === '-s') o.size = Math.min(9000, Math.max(0, Number(p[++i]) || 56));
        else if (p[i] === '-M') o.df = p[++i] === 'do';
        else if (p[i] === '-t') o.ttl = Math.min(255, Math.max(1, Number(p[++i]) || 64));
        else dst = p[i];
      }
      if (dst && !isIp(dst) && /^[a-zA-Z][a-zA-Z0-9.-]*$/.test(dst)) {
        say(`$ ${cmd}`);
        return dev.resolve(dst, ip => ip ? dev.ping(ip, { ...o, noEcho: true }) : say(`ping: ${dst}: Name or service not known`));
      }
      if (!isIp(dst)) return say('ping: Bitte eine gültige IPv4-Adresse angeben, z. B. ping 10.0.0.2');
      dev.ping(dst, o); return;
    }
    if (p[0] === 'traceroute' || p[0] === 'tracert') {
      if (!dev.l3) return say('Dieses Gerät hat keine IP-Adresse.');
      const dst = p.find((x, i) => i > 0 && isIp(x));
      if (!dst) return say('traceroute: Bitte eine IPv4-Adresse angeben.');
      dev.traceroute(dst); return;
    }
    if (p[0] === 'ip' && dev.l3 && p[1] !== 'link') {
      const sub = p.filter(x => !x.startsWith('-'))[1] || '';
      const brief = p.includes('-br');
      if (/^a(ddr|ddress)?$/.test(sub)) {
        const act = p.filter(x => !x.startsWith('-'))[2];
        if (act === 'add' || act === 'del') {
          const c = parseCidr(p[p.indexOf(act) + 1] || ''), ifn = p[p.indexOf('dev') + 1];
          const raw = (p[p.indexOf(act) + 1] || '').split('/');
          if (!c || p.indexOf('dev') < 0 || !dev.cfg.ifaces?.[ifn]) return say(`Syntax: ip addr ${act} 10.0.0.1/24 dev eth1`);
          if (act === 'add') { dev.cfg.ifaces[ifn].ip = raw[0]; dev.cfg.ifaces[ifn].prefix = c.len; }
          else dev.cfg.ifaces[ifn].ip = '';
          sim.record(dev, 'info', `Adresse ${raw[0]}/${c.len} ${act === 'add' ? 'auf ' + ifn + ' gesetzt' : 'von ' + ifn + ' entfernt'}`, { tag: 'addr-changed', data: { ifname: ifn } });
          sim.configChanged(dev.id);
          return say('OK');
        }
        const names = Object.keys(dev.cfg.ifaces || {});
        for (const n of names) {
          const c = dev.cfg.ifaces[n];
          const mtu = dev.l3.mtu(n);
          const up = n === 'lo' || dev.l3.linkUp(n);
          const label = c.parent ? `${n}@${c.parent}` : n + (c.vlan ? '.' + c.vlan : '');
          const addr = isIp(c.ip) ? `${c.ip}/${c.prefix}` : '';
          if (brief) say(`${pad(label, 14)}${pad(up ? 'UP' : 'DOWN', 8)}${addr}`);
          else {
            say(`${label}: <${up ? 'UP,LOWER_UP' : 'NO-CARRIER'}> mtu ${mtu}`);
            if (n !== 'lo') say(`    link/ether ${dev.mac(n)}${c.vlan ? `  (${c.parent ? '802.1Q id' : 'VLAN-Tag'} ${c.vlan})` : ''}`);
            if (addr) say(`    inet ${addr}`);
          }
        }
        return;
      }
      if (/^r(oute)?$/.test(sub)) {
        const act = p[2];
        if (act === 'get') {
          const dst = p[3];
          if (!isIp(dst)) return say('Bitte eine IP-Adresse angeben.');
          if (dev.l3.isOwn(dst)) return say(`local ${dst} dev lo  (eigene Adresse)`);
          const r = dev.l3.lookup(dst);
          if (!r) return say('RTNETLINK answers: Network is unreachable');
          const pm = dev.l3.pmtu.get(dst);
          return say(`${dst}${r.via ? ' via ' + r.via : ''} dev ${r.dev} src ${dev.l3.ifIp(r.dev)}   [Treffer: ${r.net}/${r.len}]${pm ? `\n    cache mtu ${pm}` : ''}`);
        }
        if (act === 'add' || act === 'del' || act === 'delete') {
          if (dev.type === 'pc' || dev.type === 'server') {
            if (p[3] === 'default' && act === 'add') { const via = p[p.indexOf('via') + 1]; if (!isIp(via)) return say('Syntax: ip route add default via <ip>'); dev.cfg.gw = via; say('OK'); sim.configChanged(dev.id); return; }
            if (p[3] === 'default') { dev.cfg.gw = ''; say('OK'); sim.configChanged(dev.id); return; }
          }
          const net = parseCidr(p[3]);
          if (!net) return say('Syntax: ip route add 10.0.0.0/24 via 192.168.1.1');
          const key = `${net.net}/${net.len}`;
          dev.cfg.routes ??= [];
          if (act === 'add') {
            const via = p[p.indexOf('via') + 1];
            if (!isIp(via)) return say('Syntax: ip route add 10.0.0.0/24 via 192.168.1.1');
            if (dev.cfg.routes.some(r => parseCidr(r.dst) && `${parseCidr(r.dst).net}/${parseCidr(r.dst).len}` === key)) return say('RTNETLINK answers: File exists');
            dev.cfg.routes.push({ dst: key, via });
            if (!dev.l3.routes().find(r => r.proto === 'S' && `${r.net}/${r.len}` === key)?.dev) say(`Hinweis: Next Hop ${via} liegt in keinem direkt angeschlossenen Netz, die Route ist inaktiv.`);
          } else {
            const before = dev.cfg.routes.length;
            dev.cfg.routes = dev.cfg.routes.filter(r => { const c = parseCidr(r.dst); return !c || `${c.net}/${c.len}` !== key; });
            if (before === dev.cfg.routes.length) return say('RTNETLINK answers: No such process');
          }
          sim.record(dev, 'info', `Route ${key} ${act === 'add' ? 'hinzugefügt' : 'entfernt'}`, { tag: 'route-changed', data: { dst: key, act } });
          sim.configChanged(dev.id);
          return say('OK');
        }
        for (const r of dev.l3.routes()) {
          if (r.proto === 'C') say(`${r.net}/${r.len} dev ${r.dev} proto kernel scope link src ${r.src}`);
          else say(`${r.len === 0 ? 'default' : r.net + '/' + r.len} via ${r.via}${r.dev ? ' dev ' + r.dev : '  (inaktiv: Next Hop nicht erreichbar)'}`);
        }
        return;
      }
      if (/^n(eigh|eighbor)?$/.test(sub)) {
        if (p[2] === 'flush') { dev.l3.arp.clear(); sim.record(dev, 'info', 'ARP-Tabelle geleert', { tag: 'arp-flushed' }); return say('OK'); }
        const t = dev.l3.arpTable();
        if (!t.length) return say('(leer)');
        for (const e of t) say(`${e.ip} dev ${e.ifname}${e.mac ? ' lladdr ' + e.mac : ''} ${e.state}`);
        return;
      }
      return say('Unbekannter ip-Befehl. Tippe help.');
    }
    if (p[0] === 'ip' && p[1] === 'link') {
      const act = p[2];
      if (act === 'set') {
        const port = p[3], st = p[4];
        const l = sim.linkAt(dev.id, port);
        if (!l || !['up', 'down'].includes(st)) return say(l ? 'Syntax: ip link set eth1 down|up' : `${port || '?'}: kein Kabel an diesem Port`);
        sim.setLinkUp(l, st === 'up');
        return say('OK');
      }
      if (act === 'add' && dev.type === 'router') {
        const m = cmd.match(/ip link add link (\S+) name (\S+) type vlan id (\d+)/);
        if (!m) return say('Syntax: ip link add link eth1 name eth1.10 type vlan id 10');
        const [, par, name, vid] = m;
        if (!PORTS.router.includes(par)) return say(`${par}: kein physisches Interface`);
        if (dev.cfg.ifaces[name]) return say('RTNETLINK answers: File exists');
        const v = Number(vid);
        if (!(v >= 1 && v <= 4094)) return say('VLAN-ID muss zwischen 1 und 4094 liegen');
        if (Object.values(dev.cfg.ifaces).some(c => c.parent === par && Number(c.vlan) === v)) return say(`Auf ${par} gibt es schon ein Subinterface für VLAN ${v}`);
        dev.cfg.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 };
        sim.record(dev, 'info', `Subinterface ${name} auf ${par} für VLAN ${v} angelegt`, { tag: 'subif-added', data: { name, vlan: v } });
        sim.configChanged(dev.id);
        return say('OK');
      }
      if ((act === 'del' || act === 'delete') && dev.type === 'router') {
        const name = p[3];
        if (!dev.cfg.ifaces?.[name]?.parent) return say('Nur Subinterfaces können gelöscht werden.');
        delete dev.cfg.ifaces[name];
        sim.configChanged(dev.id);
        return say('OK');
      }
      for (const port of PORTS[dev.type]) {
        const l = sim.linkAt(dev.id, port);
        say(`${port}: <${l ? (l.up ? 'UP,LOWER_UP' : 'DOWN') : 'NO-CARRIER'}> mtu ${l ? l.mtu : 1500}`);
      }
      return;
    }
    if (p[0] === 'arping') {
      if (!dev.l3) return say('Dieses Gerät hat keine IP-Adresse.');
      const o = { mode: 'normal' }; let ip = null;
      for (let i = 1; i < p.length; i++) {
        if (p[i] === '-U') o.mode = 'gratuitous';
        else if (p[i] === '-A') o.mode = 'reply';
        else if (p[i] === '-D') o.mode = 'dad';
        else if (p[i] === '-c') o.count = Math.min(10, Math.max(1, Number(p[++i]) || 1));
        else if (p[i] === '-I') o.ifname = p[++i];
        else ip = p[i];
      }
      if (!isIp(ip)) { say(`$ ${cmd}`); return say('Syntax: arping [-U|-A|-D] [-c anzahl] [-I interface] <ip>'); }
      if (o.ifname && !dev.cfg.ifaces?.[o.ifname]) { say(`$ ${cmd}`); return say(`arping: Interface ${o.ifname} gibt es nicht`); }
      dev.arping(ip, o); return;
    }
    if (p[0] === 'curl' && dev.l3) {
      const u = p.slice(1).find(x => !x.startsWith('-')) || '';
      const m = u.match(/^(?:http:\/\/)?([a-zA-Z0-9.-]+)(?::(\d+))?\/?$/);
      if (!m) { say(`$ ${cmd}`); return say('Syntax: curl http://10.0.0.10/ oder curl http://web.lab:8080/'); }
      const port = m[2] ? Number(m[2]) : 80;
      if (isIp(m[1])) { dev.curl(m[1], port); return; }
      say(`$ ${cmd}`);
      dev.resolve(m[1], ip => ip ? dev.curl(ip, port, { noEcho: true }) : say(`curl: (6) Could not resolve host: ${m[1]}`)); return;
    }
    if (p[0] === 'nc' && dev.l3) {
      const args = p.slice(1).filter(x => !x.startsWith('-'));
      const flags = p.slice(1).filter(x => x.startsWith('-')).join('');
      const [ip, port] = args; const n = Number(port);
      if (!isIp(ip) || !(n >= 1 && n <= 65535)) { say(`$ ${cmd}`); return say('Syntax: nc -zv <ip> <port>  oder  nc -u <ip> <port>'); }
      if (flags.includes('u')) dev.udpSend(ip, n, 32); else dev.ncz(ip, n);
      return;
    }
    if ((p[0] === 'dig' || p[0] === 'nslookup') && dev.l3) {
      let server = null, name = null;
      for (const x of p.slice(1)) { if (x.startsWith('@')) server = x.slice(1); else if (isIp(x) && p[0] === 'nslookup') server = x; else if (!x.startsWith('+')) name = x; }
      server ??= (dev.cfg.resolver || '');
      if (!name) { say(`$ ${cmd}`); return say('Syntax: dig @<server-ip> <name>   z. B. dig @10.0.2.53 web.lab'); }
      if (!isIp(server)) { say(`$ ${cmd}`); return say(';; Kein DNS-Server konfiguriert. Gib ihn mit @<ip> an oder trage ihn in der Konfiguration ein.'); }
      dev.dig(server, name); return;
    }
    if (p[0] === 'ss' && dev.l3) {
      const f = p.slice(1).join('');
      if (f.includes('l')) {
        say(`${pad('Netid', 7)}${pad('State', 9)}${pad('Local Address:Port', 24)}Dienst`);
        const svcs = dev.cfg.services || [];
        if (!svcs.length) return say('(kein Dienst lauscht)');
        for (const s of svcs) if (f.includes(s.proto[0]) || !/[tu]/.test(f)) say(`${pad(s.proto, 7)}${pad(s.proto === 'tcp' ? 'LISTEN' : 'UNCONN', 9)}${pad('0.0.0.0:' + s.port, 24)}${s.name || ''}`);
        return;
      }
      say(`${pad('State', 13)}${pad('Local Address:Port', 24)}Peer Address:Port`);
      const rows = [...dev.l3.tcp.values()];
      if (!rows.length) return say('(keine TCP-Verbindungen)');
      for (const c of rows) say(`${pad(c.state, 13)}${pad((c.local || dev.l3.srcFor(c.rip)) + ':' + c.lport, 24)}${c.rip}:${c.rport}`);
      return;
    }
    if (dev.type === 'switch' && (p[0] === 'spanning-tree' || (p[0] === 'show' && /^span/.test(p[1] || '')))) {
      const b = dev.bridge, st = dev.cfg.stp;
      if (p[0] === 'spanning-tree') {
        const change = (text, data) => { sim.record(dev, 'info', text, { tag: 'stp-config', data }); sim.configChanged(dev.id); say('OK'); };
        if (p[1] === 'on' || p[1] === 'off') { st.enabled = p[1] === 'on'; return change(`Spanning Tree ${st.enabled ? 'eingeschaltet' : 'ausgeschaltet'}`, { enabled: st.enabled }); }
        if (p[1] === 'priority') {
          const v = Number(p[2]);
          if (!(v >= 0 && v <= 61440 && v % 4096 === 0)) return say('Die Priorität muss ein Vielfaches von 4096 zwischen 0 und 61440 sein.');
          st.priority = v; return change(`Bridge-Priorität auf ${v} gesetzt`, { priority: v });
        }
        if (p[1] === 'portfast' || p[1] === 'cost') {
          const port = p[2];
          if (!dev.cfg.ports[port]) return say(`${port || '?'}: unbekannter Port`);
          if (p[1] === 'portfast') { dev.cfg.ports[port].edge = p[3] !== 'off'; return change(`${port}: PortFast ${dev.cfg.ports[port].edge ? 'an' : 'aus'}`, { port }); }
          const c = Number(p[3]);
          if (!(c >= 1 && c <= 200000000)) return say('Syntax: spanning-tree cost eth1 19');
          dev.cfg.ports[port].cost = c; return change(`${port}: Portkosten ${c}`, { port, cost: c });
        }
        return say('Syntax: spanning-tree on|off | priority <n> | portfast <port> on|off | cost <port> <n>');
      }
      const t = b.stpTable();
      if (!t) return say('Spanning Tree ist ausgeschaltet. Einschalten mit: spanning-tree on');
      say(`Root ID     ${t.root}${t.isRoot ? '   (diese Bridge ist die Root)' : ''}`);
      if (!t.isRoot) say(`            Kosten ${t.rootCost}, Root-Port ${t.rootPort}`);
      say(`Bridge ID   ${t.bridge}`);
      const tm = dev.bridge.timers();
      say(`Timer       Hello ${tm.hello} s, Max Age ${tm.maxAge} s`);
      say(`            Forward Delay ${tm.fwd} s`);
      say('');
      say(`${pad('Port', 6)}${pad('Rolle', 6)}${pad('Zustand', 12)}${pad('Kosten', 7)}Port-ID`);
      for (const r of t.ports) say(`${pad(r.port, 6)}${pad({ root: 'Root', designated: 'Desg', alternate: 'Altn', disabled: 'Disa' }[r.role], 6)}${pad(r.state, 12)}${pad(r.cost, 7)}${r.id}${r.edge ? ' Edge' : ''}`);
      return;
    }
    if (p[0] === 'arp' && dev.l3) return runCommand(dev, 'ip neigh');
    if (p[0] === 'show' && p[1] === 'ip' && p[2] === 'route' && dev.l3) {
      say('Codes: C - connected, S - static, > - beste Route, * - im Kernel');
      for (const r of dev.l3.routes()) {
        if (r.proto === 'C') say(`C>* ${r.net}/${r.len} is directly connected, ${r.dev}`);
        else say(`S${r.dev ? '>*' : '  '} ${r.net}/${r.len} [1/0] via ${r.via}${r.dev ? ', ' + r.dev : ' inactive'}`);
      }
      return;
    }
    if (p[0] === 'sysctl' && dev.type === 'router') {
      const m = cmd.match(/ip_forward\s*=\s*([01])/);
      if (m) { dev.cfg.forwarding = m[1] === '1'; sim.record(dev, 'info', `IP-Forwarding ${dev.cfg.forwarding ? 'eingeschaltet' : 'ausgeschaltet'}`, { tag: 'forwarding-changed', data: { on: dev.cfg.forwarding } }); sim.configChanged(dev.id); return say(`net.ipv4.ip_forward = ${m[1]}`); }
      return say(`net.ipv4.ip_forward = ${dev.cfg.forwarding !== false ? 1 : 0}`);
    }
    if ((p[0] === 'bridge' && p[1] === 'fdb') || (p[0] === 'show' && p[1] === 'mac')) {
      if (!dev.bridge) return say('Dieses Gerät hat keine Bridge.');
      if (p[2] === 'flush') { dev.bridge.fdb.clear(); sim.record(dev, 'info', 'MAC-Tabelle geleert', { tag: 'fdb-flushed' }); return say('OK'); }
      const t = dev.bridge.table();
      if (!t.length) return say('(leer)');
      say(`${pad('VLAN', 6)}${pad('MAC', 20)}${pad('Port', 12)}Alter`);
      for (const e of t) say(`${pad(e.vid, 6)}${pad(e.mac, 20)}${pad(e.port, 12)}${e.age.toFixed(1)} s${e.remote ? '   dst ' + e.remote : ''}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'vxlan' && dev.type === 'vtep') {
      const ms = dev.maps();
      if (!ms.length) return say('(keine VXLAN-Segmente)');
      for (const m of ms) say(`vxlan${m.vni}: VNI ${m.vni} ↔ VLAN ${m.vlan}, local ${dev.localIp()}, dstport ${m.dstport || 4789}, mtu ${dev.vxlanMtu(m)}, flood ${(m.flood || []).join(', ') || '(leer)'}`);
      return;
    }
    say(`Unbekannter Befehl: ${p[0]}. Tippe help für eine Übersicht.`);
  } finally {
    sim.emit('cli', { devId: dev.id, cmd });
  }
}

export { PORTS };
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/helpers.js" <<'__PACKETPILOT_FILE_END__'
// Hilfen für Lektionsinhalte und Zielprüfungen
export function bar(parts, caption = '') {
  // parts: [label, sizeText, kind, flex]
  const cells = parts.map(([l, s, k, f]) =>
    `<div style="flex:${f || 1} 0 0;min-width:54px;background:var(--l-${k});color:#fff;padding:6px 8px;border-right:1px solid rgba(255,255,255,.35)">
      <div style="font-weight:650;font-size:.82rem">${l}</div><div style="font-family:var(--mono);font-size:.72rem;opacity:.9">${s}</div></div>`).join('');
  return `<div style="display:flex;border-radius:8px;overflow:hidden;margin:14px 0 4px;border:1px solid var(--line)">${cells}</div>${caption ? `<div class="small muted">${caption}</div>` : ''}`;
}
export const note = (html, warn = false) => `<div class="note${warn ? ' warn' : ''}">${html}</div>`;

// Zielprüfungen
export const pingOk = (from, to, o = {}) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received > 0
  && (o.size === undefined || e.data.size >= o.size) && (o.df === undefined || e.data.df === o.df));
export const pingFailed = (from, to, o = {}) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received === 0
  && (o.size === undefined || e.data.size >= o.size));
export const tag = (dev, t, pred = () => true) => sim => sim.log.some(e => e.tag === t && (!dev || e.dev === dev) && pred(e.data || {}, e));
export const inspected = pred => (sim, ctx) => ctx.inspected.some(e => e.frame && pred(e.frame));
export const isArpReq = f => f.type === 'arp' && f.payload.op === 1;
export const isVxlan = f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'vxlan';
export const all = (...fs) => (sim, ctx) => fs.every(f => f(sim, ctx));
// Ping erfolgreich, nachdem ein bestimmtes Ereignis eingetreten ist
export const pingOkAfter = (from, to, evPred) => sim => {
  const ev = sim.log.find(evPred);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received > 0);
};
export const linkBetween = (sim, a, b) => sim.topo.links.find(l => (l.a.dev === a && l.b.dev === b) || (l.a.dev === b && l.b.dev === a));
export const isTcpSyn = f => f.type === 'ipv4' && f.payload.l4?.kind === 'tcp' && f.payload.l4.flags.SYN && !f.payload.l4.flags.ACK;
export const isDns = f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'dns';
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/index.js" <<'__PACKETPILOT_FILE_END__'
import m1 from './m1.js';
import m2 from './m2.js';
import m3 from './m3.js';
import m4 from './m4.js';
import m5 from './m5.js';

// Reihenfolge der Anzeige: Layer 2 komplett, dann Layer 3, VLAN/VXLAN, Transport
export const MODULES = [m1, m4, m2, m3, m5];
export const UPCOMING = [
  { title: 'Statisches Routing und ECMP', text: 'Mehrere gleich gute Wege, Lastverteilung über Hashes.' },
  { title: 'OSPF und BFD', text: 'Routen dynamisch lernen und Ausfälle in Millisekunden erkennen.' },
  { title: 'VRRP', text: 'Ein Gateway, das nicht ausfällt.' },
  { title: 'DHCP und DNS im Detail', text: 'Adressen verteilen mit Relay über Router, DNS-Hierarchie und rekursive Auflösung.' },
  { title: 'VPN', text: 'WireGuard und IPsec zwischen Standorten, MTU mit doppelter Hülle.' },
  { title: 'BGP und EVPN', text: 'Routing zwischen Netzen und eine echte Control Plane für VXLAN.' },
  { title: 'IPv6', text: 'Adressen, Neighbor Discovery statt ARP, SLAAC und Dual Stack.' }
];
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
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m1.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, pingOk, tag, inspected, isArpReq } from './helpers.js';
import { PRESETS, topo, host, sw, link, failoverTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const isGarp = f => f.type === 'arp' && f.payload.spa === f.payload.tpa && f.payload.spa !== '0.0.0.0';

const switch3 = () => PRESETS.find(p => p.id === 'switch3').make();
const routed = () => PRESETS.find(p => p.id === 'routed').make();

export default {
  id: 'm1', title: 'Ethernet, MAC und ARP', bands: ['eth', 'arp', 'vlan'],
  text: 'Wie Daten verpackt werden, wie ein Frame Byte für Byte aussieht, wie ein Switch lernt und wie ARP IP-Adressen in MAC-Adressen übersetzt.',
  lessons: [
    { id: 'm1-l1', title: 'Kapselung: jede Schicht packt ein', minutes: 8, steps: [
      { type: 'theory', title: 'Jede Schicht packt ein', html: `
<p>Jede Schicht behandelt das, was sie von oben bekommt, als Nutzlast. Sie setzt ihren eigenen Header davor und gibt alles nach unten weiter. Ethernet hängt zusätzlich hinten eine Prüfsumme an. Der Empfänger packt in umgekehrter Reihenfolge wieder aus.</p>
${bar([['Ethernet', '14 Byte', 'eth', 1.2], ['IPv4', '20 Byte', 'ip', 1.4], ['UDP', '8 Byte', 'udp', 1], ['Daten der Anwendung', 'beliebig', 'data', 3.2], ['FCS', '4 Byte', 'eth', .8]], 'So liegt ein UDP-Paket auf dem Kabel: aussen Ethernet, innen die Anwendung.')}
<table><tr><th>Schicht</th><th>Dateneinheit</th><th>Adressiert mit</th><th>Gerät, das hier entscheidet</th></tr>
<tr><td>Anwendung</td><td>Nachricht</td><td>Hostname, URL</td><td>Server, Client</td></tr>
<tr><td>Transport</td><td>Segment (TCP), Datagramm (UDP)</td><td>Port</td><td>Firewall, Load Balancer</td></tr>
<tr><td>Internet</td><td>Paket</td><td>IP-Adresse</td><td>Router</td></tr>
<tr><td>Link</td><td>Frame</td><td>MAC-Adresse</td><td>Switch</td></tr></table>
${note('<b>Jedes Gerät schaut nur so tief hinein, wie es muss.</b> Ein Switch liest den Ethernet-Header. Ein Router packt den Frame aus, liest den IP-Header, entscheidet und packt das Paket in einen <i>neuen</i> Frame. Was darüber liegt, fasst keiner von beiden an.')}
<p>Im Labor siehst du das an jedem Paket: Die farbigen Streifen auf dem Umschlag sind seine Schichten, von aussen nach innen. Ein Klick auf ein Paket zerlegt es im Paketinspektor.</p>` },
      { type: 'stack', title: 'Bringe die Teile in die richtige Reihenfolge', hint: 'Oben steht, was zuerst über das Kabel geht.',
        items: [{ name: 'Ethernet-Header', size: '14 Byte', kind: 'eth' }, { name: 'IPv4-Header', size: '20 Byte', kind: 'ip' }, { name: 'UDP-Header', size: '8 Byte', kind: 'udp' },
          { name: 'Daten der Anwendung', size: 'z. B. eine DNS-Anfrage', kind: 'data' }, { name: 'FCS (Prüfsumme)', size: '4 Byte', kind: 'eth' }],
        explain: 'Die äusserste Schicht steht vorne, damit jedes Gerät sofort lesen kann, was es braucht. Nur die FCS steht am Ende: Die Karte kann sie erst berechnen, wenn alle Bytes vorbei sind.' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Welchen Header liest ein Switch, um zu entscheiden, wohin ein Frame geht?', options: ['IP-Header', 'Ethernet-Header', 'UDP-Header', 'Alle Header'], correct: 1,
          explain: 'Ein Switch arbeitet auf Layer 2. Er braucht nur die Ziel-MAC im Ethernet-Header.' },
        { q: 'Was verändert ein Router an einem Paket, das er weiterleitet?', options: ['Nichts, er reicht es nur durch', 'Die Ziel-IP-Adresse', 'Er baut einen neuen Ethernet-Frame und senkt die TTL im IP-Header', 'Den UDP-Port'], correct: 2,
          explain: 'Der Router entfernt den alten Ethernet-Header, zieht von der TTL eins ab und packt das Paket in einen neuen Frame für das nächste Segment. IP-Adressen und Ports bleiben (ohne NAT) gleich.' }] }
    ] },

    { id: 'm1-l2', title: 'Der Ethernet-Frame Byte für Byte', minutes: 12, steps: [
      { type: 'theory', title: 'Aufbau eines Ethernet-II-Frames', html: `
<p>Fast alle Netze, mit denen du arbeitest, verwenden <b>Ethernet II</b>. Vor und nach dem eigentlichen Frame kommen noch Felder der physischen Schicht dazu.</p>
${bar([['Präambel', '7', 'frag', .9], ['SFD', '1', 'frag', .5], ['Ziel-MAC', '6', 'eth', 1.1], ['Quell-MAC', '6', 'eth', 1.1], ['Type', '2', 'eth', .7], ['Nutzlast', '46 bis 1500', 'ip', 3], ['FCS', '4', 'eth', .7], ['IFG', '12', 'frag', .9]], 'Grau: physische Schicht, Blau: Ethernet, Grün: Nutzlast (z. B. ein IP-Paket). Zahlen in Byte.')}
<table><tr><th>Feld</th><th>Zweck</th></tr>
<tr><td>Präambel, SFD</td><td>Bitmuster zum Einschwingen des Empfängers, SFD markiert den Start. Gehört zur physischen Schicht.</td></tr>
<tr><td>Ziel-MAC</td><td>Steht <b>zuerst</b>, damit ein Switch so früh wie möglich entscheiden kann.</td></tr>
<tr><td>Quell-MAC</td><td>Absender. Daraus lernt der Switch, wo welches Gerät steckt.</td></tr>
<tr><td>EtherType</td><td>Was in der Nutzlast steckt: <code>0x0800</code> IPv4, <code>0x0806</code> ARP, <code>0x86DD</code> IPv6, <code>0x8100</code> VLAN-Tag.</td></tr>
<tr><td>Nutzlast</td><td>46 bis 1500 Byte. Zu kurze Nutzlast wird mit Nullen aufgefüllt (Padding). Die Obergrenze ist die <b>MTU</b>.</td></tr>
<tr><td>FCS</td><td>CRC-32 über den Frame. Stimmt sie nicht, wird der Frame <b>still</b> verworfen.</td></tr>
<tr><td>IFG</td><td>Mindestpause bis zum nächsten Frame.</td></tr></table>
${note('Ein Frame ist mindestens <b>64 Byte</b> gross (Ziel-MAC bis FCS). Das stammt aus der Zeit, als sich alle ein Kabel teilten: Ein Sender musste eine Kollision bemerken, solange er noch sendet. Eine ARP-Nachricht (28 Byte) wird deshalb auf 46 Byte Nutzlast aufgefüllt.')}
<h2>Was von 1 Gbit/s übrig bleibt</h2>
<pre>Auf dem Kabel:  8 + 14 + 1500 + 4 + 12          = 1538 Byte pro Frame
Nutzdaten TCP:  1500 - 20 (IP) - 20 (TCP) - 12 (Timestamps) = 1448 Byte
1448 / 1538 = 94,1 %   →   ca. 941 Mbit/s</pre>
<p>Genau diesen Wert misst <code>iperf3</code> auf einer sauberen Gigabit-Verbindung.</p>` },
      { type: 'label', title: 'Beschrifte den Frame', distractors: ['TTL', 'Port', 'VNI'],
        slots: [{ label: 'Präambel', size: '7 Byte', kind: 'frag', w: 92 }, { label: 'SFD', size: '1 Byte', kind: 'frag', w: 70 },
          { label: 'Ziel-MAC', size: '6 Byte', kind: 'eth', w: 100 }, { label: 'Quell-MAC', size: '6 Byte', kind: 'eth', w: 100 },
          { label: 'EtherType', size: '2 Byte', kind: 'eth', w: 92 }, { label: 'Nutzlast', size: '46 bis 1500 Byte', kind: 'ip', w: 150 },
          { label: 'FCS', size: '4 Byte', kind: 'eth', w: 70 }],
        explain: 'Präambel und SFD siehst du in keinem Mitschnitt, die Netzwerkkarte entfernt sie. Die FCS meistens auch.' },
      { type: 'quiz', title: 'Rechnen mit Frames', questions: [
        { q: 'Welcher EtherType kennzeichnet eine ARP-Nachricht?', input: ['0x0806', '806', '0806'], explain: '<code>0x0806</code> ist ARP, <code>0x0800</code> IPv4.' },
        { q: 'Wie viele Byte belegt ein voller Frame (MTU 1500) inklusive Präambel, SFD und IFG auf dem Kabel?', input: ['1538'], unit: 'Byte', explain: '8 + 14 + 1500 + 4 + 12 = 1538.' },
        { q: 'Eine ARP-Nachricht ist 28 Byte lang. Wie viele Byte Padding hängt die Netzwerkkarte an?', input: ['18'], unit: 'Byte', explain: 'Mindestnutzlast 46 Byte minus 28 Byte ARP = 18 Byte Nullen.' },
        { q: 'Ein Frame kommt mit falscher FCS an. Was passiert?', options: ['Der Empfänger fordert ihn neu an', 'Er wird still verworfen, nur ein Fehlerzähler der Karte steigt', 'Der Switch korrigiert ihn', 'Er wird trotzdem verarbeitet'], correct: 1,
          explain: 'Ethernet kennt keine Neuübertragung. Mit <code>ethtool -S eth0</code> siehst du die CRC-Fehler. Neu übertragen muss bei Bedarf TCP.' }] }
    ] },

    { id: 'm1-l3', title: 'Was eine MAC-Adresse verrät', minutes: 8, steps: [
      { type: 'theory', title: 'Aufbau der MAC-Adresse', html: `
<p>Eine MAC-Adresse hat 48 Bit und gilt nur im lokalen Segment. Die ersten 3 Byte sind der <b>OUI</b> (Organizationally Unique Identifier), den die IEEE an Hersteller vergibt. <code>00:50:56</code> gehört zu VMware, deshalb beginnen die Adressen deiner VMs auf dem ESXi damit.</p>
<p>Zwei Bits im ersten Byte haben eine besondere Bedeutung:</p>
<table><tr><th>Bit</th><th>0</th><th>1</th></tr>
<tr><td><b>b0</b> (I/G)</td><td>Unicast: eine Schnittstelle</td><td>Gruppe: Multicast oder Broadcast</td></tr>
<tr><td><b>b1</b> (U/L)</td><td>vom Hersteller vergeben</td><td>lokal vergeben (Docker, containerlab, zufällige MAC am Smartphone)</td></tr></table>
${note('Lokal vergebene Adressen erkennst du an der <b>zweiten</b> Hex-Ziffer: 2, 6, A oder E. Beispiele: <code>02:42:…</code> bei älteren Docker-Versionen, <code>aa:c1:ab:…</code> bei containerlab und hier im Labor.')}
<table><tr><th>Adresse</th><th>Bedeutung</th></tr>
<tr><td><code>ff:ff:ff:ff:ff:ff</code></td><td>Broadcast, alle im Segment</td></tr>
<tr><td><code>01:00:5e:…</code></td><td>IPv4-Multicast, z. B. OSPF an 224.0.0.5</td></tr>
<tr><td><code>33:33:…</code></td><td>IPv6-Multicast</td></tr>
<tr><td><code>00:00:5e:00:01:xx</code></td><td>virtuelle MAC von VRRP (Kapitel Gateway-Redundanz)</td></tr></table>` },
      { type: 'mac', title: 'Untersuche MAC-Adressen', classify: ['00:50:56:a3:1f:7c', 'aa:c1:ab:12:34:56', '01:00:5e:00:00:05', 'ff:ff:ff:ff:ff:ff', '02:42:ac:11:00:02', '33:33:00:00:00:01'] }
    ] },

    { id: 'm1-l4', title: 'Wie ein Switch lernt', minutes: 15, steps: [
      { type: 'theory', title: 'MAC-Tabelle, Fluten und Aging', html: `
<p>Ein Switch kennt anfangs kein Gerät. Er baut seine <b>MAC-Tabelle</b> nur aus den <b>Quell-MACs</b> der Frames, die er empfängt.</p>
<pre>Frame kommt an Port eth3 an: Quelle aa:aa, Ziel bb:bb
1. Lernen:      aa:aa ist an eth3
2. Weiterleiten:
   Broadcast oder Multicast       → an alle Ports ausser eth3 (fluten)
   bb:bb steht in der Tabelle     → nur an diesen Port
   bb:bb steht an eth3            → verwerfen (filtern)
   bb:bb unbekannt                → an alle Ports ausser eth3 (fluten)</pre>
<p>Einträge verfallen nach einer Weile ohne Verkehr (<b>Aging</b>, meist 300 Sekunden). So passt sich der Switch an, wenn ein Gerät umgesteckt wird.</p>
<table><tr><th>Begriff</th><th>Bedeutung</th></tr>
<tr><td>Kollisionsdomäne</td><td>Geräte, die sich ein Medium teilen. Bei einem Switch im Vollduplex ist jeder Port eine eigene.</td></tr>
<tr><td>Broadcast-Domäne</td><td>Alle Geräte, die ein Broadcast erreicht. Ein Switch flutet Broadcasts, ein Router nicht.</td></tr></table>
${note('Ein <b>Hub</b> lernt nichts und gibt jeden Frame an alle weiter. Im nächsten Schritt machst du aus dem Switch einen Hub, indem du die Aging-Zeit auf 0 setzt, und siehst den Unterschied.')}` },
      { type: 'lab', title: 'Der Switch lernt', topo: switch3, edit: 'config',
        intro: '<p>pc1, pc2 und pc3 hängen an sw1. Doppelklicke auf <b>pc1</b>, um seine Konsole zu öffnen, und pinge pc2.</p>',
        presets: { pc1: ['ping -c 2 10.0.0.2'], pc3: ['ip neigh'] },
        goals: [
          { text: 'Pinge von pc1 aus pc2 (10.0.0.2).', check: pingOk('pc1', '10.0.0.2') },
          { text: 'An welchem Port hat sw1 die MAC-Adresse von pc2 gelernt? Schau bei sw1 unter Tabellen nach.', ask: true, expect: () => ['eth2'], placeholder: 'z. B. eth1' },
          { text: 'pc3 hat die ARP-Anfrage gesehen, aber keinen einzigen Ping. Setze bei sw1 die Aging-Zeit auf 0 und pinge erneut. Jetzt sieht pc3 auch die ICMP-Pakete.',
            check: tag('pc3', 'frame-not-mine', d => d.kind === 'icmp') }],
        hints: ['Die Aging-Zeit findest du bei sw1 unter Konfiguration ganz unten.', 'Filtere das Protokoll auf "Nur pc3", um zu sehen, was bei pc3 ankommt.'],
        outro: '<p>Mit Aging 0 vergisst der Switch jede Adresse sofort und muss alles fluten wie ein Hub. Jeder Host sieht dann fremden Verkehr: schlecht für die Sicherheit und für die Bandbreite. Stelle die Aging-Zeit danach ruhig wieder auf 300.</p>' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Woraus lernt ein Switch, an welchem Port ein Gerät hängt?', options: ['Aus der Ziel-MAC', 'Aus der Quell-MAC', 'Aus der IP-Adresse', 'Aus ARP'], correct: 1, explain: 'Nur die Quell-MAC verrät, wer an diesem Port sendet.' },
        { q: 'Ein Switch erhält einen Frame an eine MAC, die nicht in seiner Tabelle steht. Was tut er?', options: ['Verwerfen', 'Per ARP nachfragen', 'An alle Ports im VLAN ausser dem Eingang senden', 'An den Router schicken'], correct: 2,
          explain: 'Unknown Unicast Flooding. Antwortet das Ziel, lernt der Switch dessen Port, und ab dann geht der Verkehr gezielt.' }] }
    ] },

    { id: 'm1-l5', title: 'ARP: von der IP zur MAC', minutes: 15, steps: [
      { type: 'theory', title: 'So funktioniert ARP', html: `
<p>Eine Anwendung kennt nur die IP-Adresse ihres Ziels, ein Ethernet-Frame braucht aber eine Ziel-MAC. <b>ARP</b> (Address Resolution Protocol) findet sie heraus, und zwar nur für Adressen im <b>eigenen</b> Subnetz.</p>
<pre>pc1 10.0.0.1 möchte an 10.0.0.3 senden, kennt die MAC nicht
1. Request (Broadcast an ff:ff:ff:ff:ff:ff): Wer hat 10.0.0.3? Antwort an 10.0.0.1
2. Reply   (Unicast an pc1):                 10.0.0.3 ist bei aa:c1:ab:…
3. Beide tragen den anderen in die ARP-Tabelle ein, pc3 schon beim Request.</pre>
${bar([['Ethernet', '14', 'eth', 1.4], ['HW/Proto Type', '4', 'arp', 1], ['Längen', '2', 'arp', .7], ['Operation', '2', 'arp', .8], ['Sender MAC/IP', '10', 'arp', 1.6], ['Target MAC/IP', '10', 'arp', 1.6]], 'ARP liegt direkt im Ethernet-Frame (EtherType 0x0806), ohne IP-Header. Die Nachricht hat immer 28 Byte.')}
<p>Linux nennt die ARP-Tabelle <b>Neighbor-Tabelle</b> (<code>ip neigh</code>). Ein Eintrag ist <code>REACHABLE</code>, solange er frisch bestätigt ist, danach <code>STALE</code>. Bleibt eine Anfrage unbeantwortet, wird er <code>FAILED</code>, und der eigene Host meldet <code>Destination Host Unreachable</code>.</p>
${note('Ein <b>Gratuitous ARP</b> kündigt die eigene IP ungefragt an. VRRP, MetalLB und kube-vip nutzen das bei einem Failover: Alle Nachbarn ändern sofort ihre Tabelle.')}
${note('ARP hat <b>keine Authentifizierung</b>. Jedes Gerät im Segment kann Antworten schicken, und die meisten Systeme glauben sie. Schutz bieten Dynamic ARP Inspection auf Switches, kleine Segmente und Verschlüsselung auf höheren Schichten.', true)}` },
      { type: 'lab', title: 'ARP beobachten', topo: switch3, edit: 'config',
        intro: '<p>Tempo ruhig herunterdrehen: So siehst du, wie die Anfrage an alle geht und nur eine Antwort zurückkommt.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.3', 'ip neigh'], pc2: ['ping -c 1 10.0.0.99'] },
        goals: [
          { text: 'Pinge von pc1 aus pc3 (10.0.0.3).', check: pingOk('pc1', '10.0.0.3') },
          { text: 'Klicke im Protokoll auf die ARP-Anfrage (ARP Request) und schau sie dir im Paketinspektor an.', check: inspected(isArpReq) },
          { text: 'Welche Target MAC steht in der Anfrage?', ask: true, expect: () => ['00:00:00:00:00:00'], placeholder: 'xx:xx:xx:xx:xx:xx' },
          { text: 'Pinge von pc2 die Adresse 10.0.0.99, die es nicht gibt. Wer meldet "Destination Host Unreachable"?',
            check: tag('pc2', 'arp-failed', d => d.ip === '10.0.0.99') },
          { text: 'Von welcher IP-Adresse kam die Meldung "Destination Host Unreachable"?', ask: true, expect: () => ['10.0.0.2'] }],
        outro: '<p>Die Meldung kommt nicht von einem Router, sondern von pc2 selbst: Seine drei ARP-Anfragen blieben unbeantwortet.</p>' },
      { type: 'build', title: 'Baue die ARP-Anfrage selbst', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: '<p><b>pc1</b> (10.0.0.1) will <b>pc3</b> (10.0.0.3) erreichen, kennt aber dessen MAC nicht. Baue den Frame, den pc1 als Erstes sendet.</p>',
        addresses: { mac: [[M('pc1'), 'pc1'], [M('pc2'), 'pc2'], [M('pc3'), 'pc3'], [M('sw1'), 'sw1']], ip: [['10.0.0.1', 'pc1'], ['10.0.0.2', 'pc2'], ['10.0.0.3', 'pc3']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('pc1'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('pc1'), spa: '10.0.0.1', tha: '00:00:00:00:00:00', tpa: '10.0.0.3' } }],
        explain: 'Ethernet-Ziel ist Broadcast, damit pc3 die Frage überhaupt bekommt. Im ARP-Teil ist die gesuchte MAC noch unbekannt, also Nullen. Ein IP-Header kommt nicht vor: ARP sitzt direkt im Ethernet-Frame.' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'An welche Ziel-MAC geht eine ARP-Anfrage?', options: ['An die MAC des Gateways', 'An ff:ff:ff:ff:ff:ff', 'An 00:00:00:00:00:00', 'An die MAC des Switches'], correct: 1, explain: 'Die Anfrage ist ein Broadcast, die Antwort ein Unicast.' },
        { q: 'Warum kennt pc3 nach dem Ping die MAC von pc1, obwohl pc3 nie selbst gefragt hat?', options: ['Der Switch hat sie ihm mitgeteilt', 'pc3 hat sie aus der Anfrage gelernt (Sender MAC und IP)', 'Über DHCP', 'Gar nicht'], correct: 1,
          explain: 'Die Anfrage enthält Sender MAC und Sender IP. Wer gefragt wird, trägt den Fragenden gleich ein, denn er wird ihm gleich antworten.' }] }
    ] },

    { id: 'm1-garp', title: 'Gratuitous ARP und Failover', minutes: 20, steps: [
      { type: 'theory', title: 'ARP-Nachrichten, die niemand bestellt hat', html: `
<p>Neben Anfrage und Antwort kennt ARP zwei Sonderformen, die du in jedem Mitschnitt sehen wirst:</p>
<table><tr><th>Nachricht</th><th>Sender-IP</th><th>Ziel-IP</th><th>Zweck</th></tr>
<tr><td><b>Gratuitous ARP</b></td><td>die eigene</td><td>die eigene</td><td>«Diese Adresse ist jetzt bei meiner MAC.» Nachbarn mit einem Eintrag für die Adresse aktualisieren ihn sofort.</td></tr>
<tr><td><b>ARP-Probe</b></td><td>0.0.0.0</td><td>die gewünschte</td><td>«Benutzt jemand diese Adresse schon?» Antwortet jemand, gibt es einen Konflikt (RFC 5227).</td></tr></table>
<p>Beide gehen als Broadcast an alle. Ein Gratuitous ARP ist meist als Request formuliert, manchmal als Reply. Linux aktualisiert damit nur <b>bestehende</b> Einträge und legt keine neuen an.</p>
<h2>Wann ein Gerät einen Gratuitous ARP sendet</h2>
<ul><li>beim Hochfahren einer Schnittstelle, um die eigene Adresse anzukündigen und Konflikte zu bemerken</li>
<li>bei einem <b>Failover</b>: VRRP, keepalived, kube-vip oder MetalLB ziehen eine Dienstadresse auf einen anderen Rechner</li>
<li>nach einer Live-Migration einer VM, damit die Switches die MAC am neuen Port lernen</li></ul>
<h2>Die Neighbor-Zustände unter Linux</h2>
<table><tr><th>Zustand</th><th>Bedeutung</th></tr>
<tr><td>REACHABLE</td><td>vor kurzem bestätigt (rund 30 Sekunden)</td></tr>
<tr><td>STALE</td><td>wird noch benutzt, aber nicht mehr bestätigt</td></tr>
<tr><td>DELAY</td><td>ein Paket ging an einen STALE-Eintrag, 5 Sekunden warten, ob eine Bestätigung kommt</td></tr>
<tr><td>PROBE</td><td>drei Unicast-Anfragen direkt an die gespeicherte MAC</td></tr>
<tr><td>FAILED</td><td>keine Antwort, der Eintrag wird verworfen, das nächste Paket fragt wieder per Broadcast</td></tr></table>
${note('Ohne Gratuitous ARP schickt ein Client nach einem Failover seine Pakete weiter an die <b>alte</b> MAC, bis seine Neighbor-Prüfung scheitert. Das sind schnell 30 bis 40 Sekunden Ausfall. Mit einem Gratuitous ARP ist es nach Millisekunden vorbei.')}
<pre>arping -U -c 3 -I eth0 10.0.0.100   # Gratuitous ARP senden (wie keepalived)
arping -D -I eth0 10.0.0.100        # prüfen, ob die Adresse frei ist</pre>` },
      { type: 'build', title: 'Baue den Gratuitous ARP', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: `<p>Die Dienstadresse <code>10.0.0.100</code> zieht von srvA zu <b>srvB</b> um. Baue die Nachricht, mit der srvB allen Nachbarn mitteilt, dass 10.0.0.100 jetzt bei seiner MAC ist (als Request formuliert).</p>`,
        addresses: { mac: [[M('srvA'), 'srvA'], [M('srvB'), 'srvB'], [M('client'), 'client']], ip: [['10.0.0.100', 'Dienstadresse'], ['10.0.0.12', 'srvB'], ['10.0.0.5', 'client']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('srvB'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('srvB'), spa: '10.0.0.100', tha: ['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'], tpa: '10.0.0.100' } }],
        explain: 'Sender-IP und Ziel-IP sind gleich, das macht die Nachricht «gratuitous». Niemand muss antworten. Jeder, der 10.0.0.100 in seiner Tabelle hat, ersetzt die alte MAC durch die von srvB.' },
      { type: 'lab', title: 'Failover ohne Gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: `<p>srvA hält die Dienstadresse 10.0.0.100. Starte auf dem client einen langen Ping. Lass srvA dann ausfallen (Kabel trennen) und gib srvB die Adresse 10.0.0.100. Ein Gratuitous ARP wird noch <b>nicht</b> gesendet. Mit dem Tempo-Regler oder dem Vorspulen-Knopf geht das Warten schneller.</p>`,
        presets: { client: ['ping -c 60 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['ip addr add 10.0.0.100/24 dev eth1'] },
        goals: [
          { text: 'Starte den Ping und lass srvA ausfallen, während er läuft.', check: sim => sim.log.some(e => e.tag === 'link-down') && sim.log.some(e => e.dev === 'client' && e.tag === 'arp-learned') },
          { text: 'Gib srvB die Adresse 10.0.0.100.', check: sim => sim.dev('srvB').cfg.ifaces.eth1.ip === '10.0.0.100' },
          { text: 'Warte, bis der client die alte MAC verwirft und neu fragt.', check: tag('client', 'nud-failed', d => d.ip === '10.0.0.100') },
          { text: 'In welchem Zustand schickt der client Unicast-Anfragen an die alte MAC?', ask: true, expect: () => ['probe'] },
          { text: 'srvB beantwortet die Pings.', check: tag('srvB', 'echo-request-received') }],
        hints: ['Die Befehle stehen als Knöpfe in der Konsole der jeweiligen Geräte.', 'Im Protokoll unter «Nur client» siehst du, wie der Eintrag altert und geprüft wird.'],
        outro: '<p>Zähle die verlorenen Pings: Etwa 35 Sekunden lang ging jedes Paket an eine MAC, die es nicht mehr gab. Genau dieses Loch stopft der Gratuitous ARP.</p>' },
      { type: 'lab', title: 'Failover mit Gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: '<p>Dasselbe nochmals, aber diesmal kündigt srvB die Adresse nach der Übernahme mit <code>arping -U</code> an. Prüfe zuerst mit einer ARP-Probe, ob die Adresse wirklich frei ist.</p>',
        presets: { client: ['ping -c 30 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['arping -D -c 2 10.0.0.100', 'ip addr add 10.0.0.100/24 dev eth1', 'arping -U -c 1 10.0.0.100'] },
        goals: [
          { text: 'Prüfe von srvB aus mit arping -D, ob 10.0.0.100 belegt ist, solange srvA noch läuft. Die Probe meldet einen Konflikt.', check: tag('srvB', 'arping-done', d => d.mode === 'dad' && d.replies > 0) },
          { text: 'Starte den Ping, lass srvA ausfallen, gib srvB die Adresse und sende den Gratuitous ARP.', check: tag('client', 'garp-updated', d => d.ip === '10.0.0.100') },
          { text: 'srvB beantwortet die Pings, ohne dass der client neu fragen musste.', check: sim => sim.log.some(e => e.dev === 'srvB' && e.tag === 'echo-request-received') && !sim.log.some(e => e.dev === 'client' && e.tag === 'nud-failed') },
          { text: 'Klicke auf den Gratuitous ARP im Protokoll. Welche Sender-IP trägt er?', ask: true, expect: () => ['10.0.0.100'] }],
        hints: ['Die Reihenfolge zählt: erst die Adresse übernehmen, dann den Gratuitous ARP senden.'],
        outro: '<p>Der client hat seinen Eintrag sofort umgeschrieben. Genau so arbeiten keepalived und kube-vip: Wer die Adresse übernimmt, sendet sofort einen Gratuitous ARP. Die Switches lernen dabei nebenbei, an welchem Port die MAC von srvB hängt.</p>' }
    ] },

    { id: 'm1-l6', title: 'Ein Paket über einen Router', minutes: 18, steps: [
      { type: 'theory', title: 'MAC von Hop zu Hop, IP von Ende zu Ende', html: `
<p>Will ein Host an eine IP-Adresse <b>ausserhalb</b> seines Subnetzes senden, fragt er nicht nach deren MAC, sondern nach der MAC seines <b>Default-Gateways</b>.</p>
<pre>pc1 192.168.10.10/24 → srv1 192.168.20.20
1. Liegt 192.168.20.20 in 192.168.10.0/24?  Nein → an das Gateway 192.168.10.1
2. ARP fragt nach 192.168.10.1, nicht nach 192.168.20.20
3. r1 nimmt den Frame an, liest die Ziel-IP, findet die Route, TTL 64 → 63
4. r1 fragt per ARP auf eth2 nach 192.168.20.20 und baut einen neuen Frame</pre>
<table><tr><th></th><th>Segment LAN A (pc1 → r1)</th><th>Segment LAN B (r1 → srv1)</th></tr>
<tr><td>Quell-MAC</td><td>pc1</td><td>r1 eth2</td></tr><tr><td>Ziel-MAC</td><td>r1 eth1</td><td>srv1</td></tr>
<tr><td>Quell-IP</td><td>192.168.10.10</td><td>192.168.10.10</td></tr><tr><td>Ziel-IP</td><td>192.168.20.20</td><td>192.168.20.20</td></tr>
<tr><td>TTL</td><td>64</td><td><b>63</b></td></tr></table>
${note('<b>Merke:</b> MAC-Adressen gelten von Hop zu Hop und werden von jedem Router neu gesetzt. IP-Adressen gelten von Ende zu Ende und bleiben gleich, solange kein NAT dazwischen ist.')}
<table><tr><th>Symptom</th><th>Typische Ursache</th></tr>
<tr><td>Eigenes Subnetz geht, alles dahinter nicht</td><td>Gateway falsch oder fehlt</td></tr>
<tr><td>Host fragt per ARP nach dem fernen Ziel statt nach dem Gateway</td><td>Netzmaske zu gross, z. B. /16 statt /24</td></tr>
<tr><td>Paket kommt an, Antwort nicht</td><td>Ziel hat kein Gateway, der Rückweg fehlt</td></tr></table>` },
      { type: 'lab', title: 'Weise die Regel selbst nach', topo: routed, edit: 'config',
        intro: '<p>Pinge von pc1 aus srv1. Klicke danach im Protokoll auf die Ping-Pakete, die r1 sendet und empfängt, und lies die Werte im Paketinspektor ab. Die Filterung "Nur r1" hilft.</p>',
        presets: { pc1: ['ping -c 1 192.168.20.20'] },
        goals: [
          { text: 'Pinge von pc1 aus srv1 (192.168.20.20).', check: pingOk('pc1', '192.168.20.20') },
          { text: 'Nach welcher IP-Adresse hat pc1 per ARP gefragt?', ask: true, expect: () => ['192.168.10.1'] },
          { text: 'Welche Ziel-MAC hat der Ping im LAN A?', ask: true, expect: s => [s.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' },
          { text: 'Welche Quell-MAC hat derselbe Ping im LAN B?', ask: true, expect: s => [s.dev('r1').mac('eth2')], placeholder: 'aa:c1:ab:…' },
          { text: 'Welche TTL hat der Ping im LAN B?', ask: true, expect: () => ['63'] },
          { text: 'Stelle bei pc1 das Präfix auf 16 und pinge erneut. Nach welcher Adresse fragt pc1 jetzt per ARP?', ask: true, expect: () => ['192.168.20.20'] }],
        hints: ['Die MAC-Adressen von r1 stehen bei r1 im Reiter Konsole mit dem Befehl ip addr.', 'Ein Ping im LAN B ist ein Frame, den r1 über eth2 sendet.'],
        outro: '<p>Mit /16 glaubt pc1, 192.168.20.20 liege im eigenen Netz, und fragt direkt danach. Niemand antwortet, und pc1 meldet selbst "Destination Host Unreachable". Stelle das Präfix wieder auf 24.</p>' }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m2.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, pingOk, pingFailed, tag } from './helpers.js';
import { PRESETS, chainTopo, topo, host, server, router, link } from '../presets.js';

const mtuTopo = () => PRESETS.find(p => p.id === 'mtu').make();
const brokenReturn = () => { const t = chainTopo(); t.name = 'Fehlender Rückweg'; t.devices.find(d => d.id === 'r2').routes = [{ dst: '10.0.4.0/24', via: '10.0.23.3' }]; return t; };
const blackhole = () => topo('PMTUD-Blackhole', [
  host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'),
  router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']], {
    acl: [{ action: 'allow', proto: 'icmp', icmpType: 8, src: 'any', dst: 'any' }, { action: 'allow', proto: 'icmp', icmpType: 0, src: 'any', dst: 'any' },
      { action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }),
  router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]),
  server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
[link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'srv1', 'eth1', 1400)]);

export default {
  id: 'm2', title: 'IP und Routing', bands: ['ip', 'icmp', 'udp'],
  text: 'Der IPv4-Header, wie Router entscheiden, TTL und traceroute, der Rückweg, MTU mit Path MTU Discovery und Regeln auf Routern.',
  lessons: [
    { id: 'm2-l1', title: 'Der IPv4-Header', minutes: 12, steps: [
      { type: 'theory', title: 'Was in jedem IP-Paket steht', html: `
<p>Jedes IPv4-Paket beginnt mit mindestens 20 Byte Header. Jeder Router liest ihn, zwei Felder ändert er sogar.</p>
<table><tr><th>Feld</th><th>Bit</th><th>Zweck</th></tr>
<tr><td>Version, IHL</td><td>4 + 4</td><td>4 und Headerlänge in 32-Bit-Wörtern (meist 5 = 20 Byte)</td></tr>
<tr><td>TOS (DSCP, ECN)</td><td>8</td><td>Priorität für QoS und Staumeldung</td></tr>
<tr><td>Total Length</td><td>16</td><td>Länge mit Header, höchstens 65 535</td></tr>
<tr><td>Identification, Flags, Offset</td><td>16 + 3 + 13</td><td>Fragmentierung. Flag <b>DF</b> verbietet das Zerlegen</td></tr>
<tr><td><b>TTL</b></td><td>8</td><td>Jeder Router zieht 1 ab, bei 0 wird verworfen</td></tr>
<tr><td>Protocol</td><td>8</td><td>1 ICMP, 6 TCP, 17 UDP, 50 ESP, 89 OSPF</td></tr>
<tr><td><b>Header Checksum</b></td><td>16</td><td>Nur über den Header. Wegen der TTL bei jedem Hop neu berechnet</td></tr>
<tr><td>Quell-IP, Ziel-IP</td><td>32 + 32</td><td>Bleiben von Ende zu Ende gleich (ohne NAT)</td></tr></table>
${note('Das Feld <b>Protocol</b> spielt dieselbe Rolle wie der EtherType im Ethernet-Frame: Es sagt, wie die Nutzlast zu lesen ist. OSPF läuft direkt auf IP mit Protocol 89, BGP dagegen über TCP-Port 179.')}` },
      { type: 'label', title: 'Beschrifte den IPv4-Header', distractors: ['Ziel-MAC', 'Port', 'VNI'],
        rows: [
          [{ label: 'Version', size: '4 Bit', kind: 'ip', w: 70 }, { label: 'IHL', size: '4 Bit', kind: 'ip', w: 70 }, { label: 'TOS', size: '8 Bit', kind: 'ip', w: 130 }, { label: 'Total Length', size: '16 Bit', kind: 'ip', w: 250 }],
          [{ label: 'Identification', size: '16 Bit', kind: 'ip', w: 250 }, { label: 'Flags', size: '3 Bit', kind: 'ip', w: 70 }, { label: 'Fragment Offset', size: '13 Bit', kind: 'ip', w: 198 }],
          [{ label: 'TTL', size: '8 Bit', kind: 'ip', w: 130 }, { label: 'Protocol', size: '8 Bit', kind: 'ip', w: 136 }, { label: 'Header Checksum', size: '16 Bit', kind: 'ip', w: 256 }],
          [{ label: 'Quell-IP', size: '32 Bit', kind: 'ip', w: 530 }],
          [{ label: 'Ziel-IP', size: '32 Bit', kind: 'ip', w: 530 }]],
        explain: 'Jede Zeile hat 32 Bit. Die ersten fünf Zeilen sind die 20 Byte des Standard-Headers.' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Welche Protocol-Nummer hat UDP?', input: ['17'], explain: '1 ICMP, 6 TCP, 17 UDP.' },
        { q: 'Warum muss ein Router die Header Checksum bei jedem Paket neu berechnen?', options: ['Weil sich die Ziel-IP ändert', 'Weil er die TTL ändert und die Prüfsumme den Header abdeckt', 'Weil Ethernet es verlangt', 'Muss er nicht'], correct: 1,
          explain: 'Die TTL gehört zum Header. Ändert sie sich, stimmt die alte Prüfsumme nicht mehr.' }] }
    ] },

    { id: 'm2-l2', title: 'Die Routing-Entscheidung', minutes: 12, steps: [
      { type: 'theory', title: 'Routing-Tabelle und Longest Prefix Match', html: `
<p>Host und Router entscheiden mit demselben Verfahren. Ein Router leitet nur zusätzlich Pakete weiter, die nicht an ihn selbst gehen.</p>
<pre>$ ip route
default via 192.168.10.1 dev eth1                         ← Default Route
10.20.0.0/16 via 192.168.10.254 dev eth1                  ← statische Route
192.168.10.0/24 dev eth1 proto kernel scope link          ← Connected Route</pre>
<table><tr><th>Eintrag</th><th>ARP fragt nach</th></tr>
<tr><td>Connected Route (direkt angeschlossen)</td><td>dem <b>Ziel</b> selbst</td></tr>
<tr><td>Route mit <code>via</code></td><td>dem <b>Next Hop</b></td></tr></table>
${note('<b>Longest Prefix Match:</b> Passen mehrere Einträge, gewinnt der spezifischste, also der mit dem längsten Präfix. Die Reihenfolge in der Tabelle spielt keine Rolle. Bei gleich langem Präfix entscheidet die Herkunft: Connected vor statisch.')}
<p>Unter Linux zeigt <code>ip route get &lt;ziel&gt;</code> die Entscheidung für ein Ziel an, ohne ein Paket zu senden. Das kannst du auch in jeder Konsole im Labor ausprobieren.</p>` },
      { type: 'lpm', title: 'Wohin geht das Paket?', table: [['10.0.0.0/8', 'A'], ['10.1.0.0/16', 'B'], ['10.1.2.0/24', 'C'], ['10.1.2.64/26', 'D'], ['0.0.0.0/0', 'E']],
        dests: ['10.1.2.77', '10.1.2.200', '10.9.9.9', '10.1.3.1', '172.16.5.5'] },
      { type: 'lpm', title: 'Und ohne Default Route?', table: [['192.168.0.0/16', 'R1'], ['192.168.10.0/24', 'R2'], ['192.168.10.128/25', 'R3']],
        dests: ['192.168.10.130', '192.168.10.5', '192.168.11.5', '8.8.8.8'] }
    ] },

    { id: 'm2-l3', title: 'TTL und traceroute', minutes: 12, steps: [
      { type: 'theory', title: 'Wie traceroute die Router verrät', html: `
<p>Die TTL verhindert, dass ein Paket bei einem Routing-Fehler ewig kreist. Der Router, der sie auf 0 setzt, verwirft das Paket und sendet <b>ICMP Time Exceeded</b> an den Absender.</p>
<p><code>traceroute</code> nutzt das: Es sendet Pakete mit TTL 1, 2, 3 … Jeder Router auf dem Weg verrät sich mit seiner Time-Exceeded-Meldung. Linux sendet dafür UDP an hohe Ports (ab 33434), das Ziel antwortet am Ende mit <b>Port Unreachable</b>.</p>
<pre> 1  10.0.1.1    0.4 ms     ← TTL 1 bei r1 abgelaufen
 2  10.0.12.2   0.6 ms     ← TTL 2 bei r2 abgelaufen
 3  10.0.23.3   0.8 ms
 4  10.0.4.10   1.0 ms     ← Ziel: Port Unreachable</pre>
${note('Ein <code>*</code> heisst nur, dass von diesem Hop keine Antwort kam. Viele Router drosseln Time Exceeded, leiten aber problemlos weiter. Die Start-TTL verrät oft das System: Linux 64, Windows 128, viele Netzwerkgeräte 255.')}` },
      { type: 'lab', title: 'Verfolge den Weg', topo: chainTopo, edit: 'view',
        intro: '<p>pc1 erreicht srv1 über drei Router. Starte auf pc1 ein traceroute und beobachte, bei welchem Router jedes Paket stirbt.</p>',
        presets: { pc1: ['traceroute 10.0.4.10', 'ping -c 1 -t 2 10.0.4.10'] },
        goals: [
          { text: 'Starte auf pc1 traceroute 10.0.4.10.', check: tag('pc1', 'trace-done', d => d.reached) },
          { text: 'Welche Adresse antwortet beim zweiten Hop?', ask: true, expect: () => ['10.0.12.2'] },
          { text: 'Sende einen Ping mit TTL 2 (ping -c 1 -t 2 10.0.4.10). Welcher Router meldet Time Exceeded?', ask: true, expect: () => ['r2', '10.0.12.2'] },
          { text: 'Mit welcher TTL kommt die Antwort von srv1 bei einem normalen Ping an?', ask: true, expect: () => ['61'] }],
        outro: '<p>Drei Router, also 64 - 3 = 61. Die Antwort beim zweiten Hop kommt von der Adresse des Interfaces, über das r2 die Meldung an pc1 zurückschickt.</p>' }
    ] },

    { id: 'm2-l4', title: 'Der Rückweg zählt genauso', minutes: 15, steps: [
      { type: 'theory', title: 'Routing gilt immer nur in eine Richtung', html: `
<p>Jeder Router auf dem Weg braucht eine Route zum Ziel, und jeder Router auf dem Rückweg braucht eine Route zur <b>Quelle</b>. Fehlt der Rückweg, kommt der Ping beim Ziel an, aber die Antwort nie zurück. Das ist der häufigste Fehler beim statischen Routing.</p>
${note('Vorgehen bei der Fehlersuche: <b>1.</b> Kommt das Paket beim Ziel an? <b>2.</b> Hat das Ziel eine Route zurück? <b>3.</b> Hat jeder Router auf dem Rückweg eine Route zur Quelle? Prüfe mit <code>ip route get</code> auf jedem Gerät.')}
<p>Nehmen Hin- und Rückweg verschiedene Pfade, heisst das <b>asymmetrisches Routing</b>. Erlaubt ist das, aber zustandsbehaftete Firewalls verwerfen solche Verbindungen, weil sie nur eine Richtung sehen.</p>` },
      { type: 'lab', title: 'Finde den fehlenden Rückweg', topo: brokenReturn, edit: 'config',
        intro: '<p>pc1 erreicht srv1 nicht. Finde heraus, wo das Problem liegt, und behebe es mit einer statischen Route.</p>',
        presets: { pc1: ['ping -c 2 10.0.4.10'], r2: ['ip route', 'ip route get 10.0.1.10'] },
        goals: [
          { text: 'Pinge von pc1 aus srv1 und stelle fest: Der Ping scheitert.', check: pingFailed('pc1', '10.0.4.10') },
          { text: 'Weise nach, dass der Echo Request bei srv1 trotzdem ankommt (Protokoll filtern: Nur srv1).', check: tag('srv1', 'echo-request-received') },
          { text: 'Welcher Router hat keine Route zurück zu 10.0.1.0/24?', ask: true, expect: () => ['r2'] },
          { text: 'Ergänze die fehlende Route und pinge erneut, bis es klappt.', check: pingOk('pc1', '10.0.4.10') }],
        hints: ['Schau bei r2 unter Tabellen nach, welche Netze er kennt.', 'Auf r2 fehlt: Ziel 10.0.1.0/24 via 10.0.12.1. In der Konsole: ip route add 10.0.1.0/24 via 10.0.12.1'] }
    ] },

    { id: 'm2-l5', title: 'MTU und Path MTU Discovery', minutes: 15, steps: [
      { type: 'theory', title: 'Zu gross für den Weg', html: `
<p>Ist ein Paket grösser als die MTU des nächsten Links, hat ein Router zwei Möglichkeiten:</p>
<table><tr><th>DF-Flag</th><th>Was der Router tut</th></tr>
<tr><td>nicht gesetzt</td><td>Zerlegt das Paket in <b>Fragmente</b>. Erst das Ziel setzt sie zusammen. Geht ein Fragment verloren, ist alles verloren.</td></tr>
<tr><td>gesetzt</td><td>Verwirft das Paket und sendet <b>ICMP Fragmentation Needed</b> mit der passenden MTU zurück. Der Absender merkt sich die MTU und sendet kleiner. Das ist <b>Path MTU Discovery</b>.</td></tr></table>
<pre>ping -M do -s 1472 ziel     1472 + 8 (ICMP) + 20 (IP) = 1500 Byte, DF gesetzt
ping -M dont -s 1472 ziel   gleich gross, Fragmentierung erlaubt</pre>
${note('Nach einer Fragmentation-Needed-Meldung lehnt Linux zu grosse Pakete schon lokal ab: <code>ping: local error: message too long, mtu=1400</code>. Mit <code>ip route get</code> siehst du die gelernte MTU.')}` },
      { type: 'lab', title: 'Der Engpass', topo: mtuTopo, edit: 'view',
        intro: '<p>Der Link zwischen r1 und r2 hat nur MTU 1400. Teste es von pc1 aus.</p>',
        presets: { pc1: ['ping -c 2 -M do -s 1472 10.0.2.20', 'ping -c 1 -M dont -s 1472 10.0.2.20', 'ip route get 10.0.2.20'] },
        goals: [
          { text: 'Sende einen Ping mit 1472 Byte und DF (-M do). Welche MTU meldet r1 zurück?', ask: true, expect: () => ['1400'] },
          { text: 'pc1 merkt sich die MTU des Weges.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Sende denselben Ping ohne DF (-M dont). r1 zerlegt das Paket, und der Ping kommt an.', check: pingOk('pc1', '10.0.2.20', { size: 1472, df: false }) },
          { text: 'In wie viele Fragmente hat r1 das Paket zerlegt?', ask: true, expect: () => ['2'] },
          { text: 'Mit welchem grössten Wert für -s klappt der Ping mit -M do?', ask: true, expect: () => ['1372'] }],
        outro: '<p>1372 + 8 + 20 = 1400. Genau so gross darf ein IP-Paket über den engsten Link sein.</p>' }
    ] },

    { id: 'm2-l6', title: 'Regeln und das PMTUD-Blackhole', minutes: 15, steps: [
      { type: 'theory', title: 'Regeln auf Routern', html: `
<p>Router und Firewalls filtern Pakete mit <b>Regeln</b>. Die Regeln werden von oben nach unten geprüft, die <b>erste passende</b> gilt. Typische Aktionen sind erlauben, verwerfen (still) und ablehnen (mit ICMP-Meldung).</p>
<p>Ein häufiger Fehler: ICMP wird bis auf Ping komplett blockiert, weil es "unsicher" sei. Damit verschwindet auch <b>Fragmentation Needed</b> (ICMP Typ 3). Kleine Pakete gehen, grosse verschwinden spurlos: SSH klappt, grosse Downloads hängen. Das heisst <b>PMTUD-Blackhole</b>.</p>
<table><tr><th>ICMP-Typ</th><th>Bedeutung</th><th>Blockieren?</th></tr>
<tr><td>8 / 0</td><td>Echo Request / Reply</td><td>von aussen drosseln ist vertretbar</td></tr>
<tr><td>3</td><td>Destination Unreachable, inkl. Fragmentation Needed</td><td><b>nie</b></td></tr>
<tr><td>11</td><td>Time Exceeded</td><td>besser nicht, sonst geht traceroute nicht</td></tr></table>` },
      { type: 'lab', title: 'Repariere das Blackhole', topo: blackhole, edit: 'config',
        intro: '<p>r1 erlaubt nur Ping (Typ 8 und 0) und verwirft jedes andere ICMP. Zwischen r2 und srv1 ist die MTU 1400.</p>',
        presets: { pc1: ['ping -c 1 10.0.2.20', 'ping -c 1 -M do -s 1472 10.0.2.20', 'ping -c 1 -M do -s 1372 10.0.2.20'] },
        goals: [
          { text: 'Ein normaler Ping von pc1 an srv1 funktioniert.', check: pingOk('pc1', '10.0.2.20') },
          { text: 'Ein Ping mit -M do -s 1472 verschwindet ohne jede Meldung. Finde im Protokoll, wo die ICMP-Meldung von r2 bleibt.', check: tag('r1', 'acl-drop') },
          { text: 'Ergänze auf r1 eine Regel, die ICMP Typ 3 erlaubt, und setze sie über die Regel zum Verwerfen. Jetzt lernt pc1 die MTU.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Sende einen Ping mit -M do -s 1372.', check: pingOk('pc1', '10.0.2.20', { size: 1372, df: true }) }],
        hints: ['Bei r1 unter Konfiguration findest du die Regeln. Neue Regel: erlauben, ICMP, Typ 3, dann mit dem Pfeil nach oben schieben.'] }
    ] },

    { id: 'm2-l7', title: 'Control Plane und Data Plane', minutes: 6, steps: [
      { type: 'theory', title: 'Wer entscheidet, wer leitet weiter?', html: `
<table><tr><th></th><th>Control Plane</th><th>Data Plane</th></tr>
<tr><td>Aufgabe</td><td>Herausfinden, welche Wege es gibt</td><td>Jedes Paket weiterleiten</td></tr>
<tr><td>Wie oft</td><td>bei Änderungen im Netz</td><td>Millionen Mal pro Sekunde</td></tr>
<tr><td>Linux mit FRR</td><td>FRR: ospfd, bgpd, zebra</td><td>der Kernel</td></tr>
<tr><td>Ergebnis</td><td>Einträge in der Routing-Tabelle</td><td>Pakete auf dem richtigen Interface</td></tr></table>
<p>Kennt der Router dieselbe Route aus mehreren Quellen, gewinnt die kleinste <b>administrative Distanz</b>: Connected 0, statisch 1, eBGP 20, OSPF 110, iBGP 200.</p>
${note('Hängt die Control Plane, leitet die Data Plane mit den vorhandenen Routen weiter. Sie reagiert nur nicht mehr auf Änderungen. Dasselbe Prinzip kennst du aus Kubernetes: API-Server und Scheduler entscheiden, kubelet und kube-proxy setzen um.')}` },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Eine Route zu 10.0.0.0/24 ist statisch und gleichzeitig über OSPF bekannt. Welche gewinnt?', options: ['OSPF, weil dynamisch', 'Die statische, Distanz 1 statt 110', 'Die mit der kleineren Metrik', 'Beide abwechselnd'], correct: 1, explain: 'Bei gleichem Präfix entscheidet die administrative Distanz.' },
        { q: 'Welche Distanz hat eine OSPF-Route in FRR?', input: ['110'] }] }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m3.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, pingOk, tag, inspected, isVxlan } from './helpers.js';
import { vlanTopo, vxlanTopo, stickTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const subif = (sim, vid, ip) => Object.values(sim.dev('r1').cfg.ifaces).some(i => i.parent === 'eth1' && Number(i.vlan) === vid && i.ip === ip);

export default {
  id: 'm3', title: 'VLAN und VXLAN', bands: ['vlan', 'udp', 'vxlan'],
  text: 'Layer-2-Segmente mit 802.1Q trennen, Trunks verstehen und Segmente mit VXLAN über ein geroutetes Netz strecken.',
  lessons: [
    { id: 'm3-l1', title: 'VLANs und der 802.1Q-Tag', minutes: 10, steps: [
      { type: 'theory', title: 'Mehrere Switches in einem', html: `
<p>Ein <b>VLAN</b> teilt einen Switch in mehrere logische Switches. Jedes VLAN ist eine eigene Broadcast-Domäne. Zwischen VLANs gibt es keine Verbindung auf Layer 2, nur über einen Router.</p>
<p>Damit zwischen Switches erkennbar bleibt, zu welchem VLAN ein Frame gehört, wird nach der Quell-MAC ein 4 Byte langer <b>Tag</b> eingefügt:</p>
${bar([['Ziel-MAC', '6', 'eth', 1.1], ['Quell-MAC', '6', 'eth', 1.1], ['TPID 0x8100', '2', 'vlan', 1.2], ['PCP DEI VID', '2', 'vlan', 1.2], ['EtherType', '2', 'eth', .9], ['Nutzlast', 'bis 1500', 'ip', 2.4], ['FCS', '4', 'eth', .7]], 'Der Frame wird 4 Byte länger, die MTU bleibt 1500.')}
<table><tr><th>Feld</th><th>Bit</th><th>Bedeutung</th></tr>
<tr><td>TPID</td><td>16</td><td><code>0x8100</code> steht dort, wo sonst der EtherType steht</td></tr>
<tr><td>PCP</td><td>3</td><td>Priorität 0 bis 7</td></tr><tr><td>DEI</td><td>1</td><td>darf bei Überlast zuerst verworfen werden</td></tr>
<tr><td>VID</td><td>12</td><td>VLAN-Nummer, nutzbar 1 bis 4094</td></tr></table>` },
      { type: 'label', title: 'Beschrifte den Tag', distractors: ['TTL', 'VNI'],
        slots: [{ label: 'TPID', size: '16 Bit', kind: 'vlan', w: 210 }, { label: 'PCP', size: '3 Bit', kind: 'vlan', w: 74 }, { label: 'DEI', size: '1 Bit', kind: 'vlan', w: 58 }, { label: 'VID', size: '12 Bit', kind: 'vlan', w: 170 }] },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Wie viele VLANs kannst du mit 12 Bit nutzen?', input: ['4094'], explain: '2<sup>12</sup> = 4096, davon sind 0 und 4095 reserviert.' },
        { q: 'Welcher Wert steht im TPID?', input: ['0x8100', '8100'] }] }
    ] },

    { id: 'm3-l2', title: 'Access-Port und Trunk', minutes: 15, steps: [
      { type: 'theory', title: 'Wann Frames einen Tag tragen', html: `
<table><tr><th>Port</th><th>Auf dem Kabel</th><th>Typisch für</th></tr>
<tr><td><b>Access</b></td><td>ohne Tag, der Port gehört zu genau einem VLAN</td><td>PC, Drucker, Server mit einem Netz</td></tr>
<tr><td><b>Trunk</b></td><td>mit Tag, mehrere VLANs über ein Kabel</td><td>Switch zu Switch, Router, Hypervisor</td></tr></table>
<p>Auf einem Trunk darf ein VLAN zusätzlich ohne Tag laufen, das <b>Native VLAN</b>. Stimmt es auf beiden Seiten nicht überein, werden zwei VLANs unbemerkt verbunden.</p>
${note('Deine VMs auf dem ESXi kennen das: Die Portgruppe ist für die VM ein Access-Port. Der vSwitch setzt den Tag erst, wenn der Frame über den Uplink (einen Trunk) den Host verlässt.')}` },
      { type: 'lab', title: 'Verbinde zwei Switches richtig', topo: () => vlanTopo(false), edit: 'config',
        intro: '<p>a10 und b10 gehören in VLAN 10, a20 und b20 in VLAN 20. Das Kabel zwischen s1 und s2 ist aber auf beiden Seiten ein Access-Port in VLAN 1. Mache daraus einen Trunk.</p>',
        presets: { a10: ['ping -c 1 10.10.0.2'], a20: ['ping -c 1 10.20.0.2'] },
        goals: [
          { text: 'a10 erreicht b10 (10.10.0.2).', check: pingOk('a10', '10.10.0.2') },
          { text: 'a20 erreicht b20 (10.20.0.2).', check: pingOk('a20', '10.20.0.2') },
          { text: 'Klicke im Protokoll auf einen Frame, den s1 über eth8 sendet, und finde den Tag im Paketinspektor.', check: inspected(f => !!f.vlan) },
          { text: 'Welche VID tragen die Frames von a20 auf dem Trunk?', ask: true, expect: () => ['20'] }],
        hints: ['Bei s1 und s2 unter Konfiguration: eth8 auf Trunk stellen, erlaubte VLANs 10,20.'] }
    ] },

    { id: 'm3-stick', title: 'Routing zwischen VLANs: Router-on-a-Stick', minutes: 18, steps: [
      { type: 'theory', title: 'Ein Kabel, viele Netze', html: `
<p>Zwischen VLANs braucht es einen Router. Mit einem eigenen Router-Port pro VLAN gehen bei zehn VLANs schnell die Ports aus. Die Lösung: Der Router hängt mit <b>einem</b> Kabel an einem Trunk und hat dafür pro VLAN ein <b>Subinterface</b>. Jedes Subinterface sendet und empfängt nur Frames mit seinem VLAN-Tag und hat eine eigene IP-Adresse, das Gateway des jeweiligen VLANs.</p>
<pre># Linux
ip link add link eth1 name eth1.10 type vlan id 10
ip addr add 10.10.0.1/24 dev eth1.10
ip link add link eth1 name eth1.20 type vlan id 20
ip addr add 10.20.0.1/24 dev eth1.20

# Cisco IOS
interface GigabitEthernet0/0.10
 encapsulation dot1Q 10
 ip address 10.10.0.1 255.255.255.0</pre>
<h2>Der Weg eines Pakets von a1 (VLAN 10) zu b1 (VLAN 20)</h2>
<pre>a1 → sw1      ohne Tag, Access-Port in VLAN 10
sw1 → r1      Tag 10 auf dem Trunk
r1            nimmt es auf eth1.10 an, routet, sendet über eth1.20
r1 → sw1      Tag 20 auf dem Trunk, gleiches Kabel zurück
sw1 → b1      ohne Tag, Access-Port in VLAN 20</pre>
${note('Alle Subinterfaces teilen sich die MAC-Adresse der physischen Schnittstelle. Das stört nicht, weil jedes VLAN ein eigenes Segment ist.')}
${note('Jedes geroutete Paket läuft zweimal über dasselbe Kabel. Bei viel Verkehr zwischen VLANs wird dieser Link zum Engpass. Grössere Netze routen deshalb direkt im Switch (Layer-3-Switch mit einem SVI pro VLAN).', true)}` },
      { type: 'lab', title: 'Richte die Subinterfaces ein', topo: () => stickTopo(false), edit: 'config',
        intro: '<p>sw1 ist fertig konfiguriert: a1 und a2 in VLAN 10, b1 und b2 in VLAN 20, eth8 als Trunk zu r1. Auf r1 fehlt alles. Lege die beiden Subinterfaces an, unter Konfiguration oder in der Konsole.</p>',
        presets: { r1: ['ip link add link eth1 name eth1.10 type vlan id 10', 'ip link add link eth1 name eth1.20 type vlan id 20', 'ip addr add 10.10.0.1/24 dev eth1.10', 'ip addr add 10.20.0.1/24 dev eth1.20', 'ip -br a'], a1: ['ping -c 2 10.20.0.11'] },
        goals: [
          { text: 'r1 hat ein Subinterface für VLAN 10 mit 10.10.0.1/24.', check: sim => subif(sim, 10, '10.10.0.1') },
          { text: 'r1 hat ein Subinterface für VLAN 20 mit 10.20.0.1/24.', check: sim => subif(sim, 20, '10.20.0.1') },
          { text: 'Pinge von a1 aus b1 (10.20.0.11).', check: pingOk('a1', '10.20.0.11') },
          { text: 'Klicke auf einen Frame, den r1 mit Tag 20 sendet.', check: inspected(f => f.vlan?.vid === 20 && f.type === 'ipv4') },
          { text: 'Wie oft überquert der Ping von a1 auf dem Weg zu b1 das Kabel zwischen sw1 und r1?', ask: true, expect: () => ['2', 'zweimal'] },
          { text: 'Welche Quell-MAC hat der Frame, den r1 in VLAN 20 sendet?', ask: true, expect: sim => [sim.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' }],
        hints: ['Die Befehle stehen als Knöpfe in der Konsole von r1.', 'Unter Konfiguration: Subinterfaces, Parent eth1, VLAN eingeben, Anlegen. Dann die IP eintragen.'],
        outro: '<p>Die Quell-MAC ist die von eth1, egal über welches Subinterface r1 sendet. Was die VLANs unterscheidet, ist nur der Tag.</p>' },
      { type: 'build', title: 'Baue den Frame auf dem Trunk', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp'],
        task: `<p>a1 (10.10.0.11) pingt b1 (10.20.0.11). Baue den Echo Request, wie ihn <b>r1</b> über den Trunk Richtung b1 sendet. MAC von r1 eth1: <code>${M('r1')}</code>.</p>`,
        addresses: { mac: [[M('a1'), 'a1'], [M('b1'), 'b1'], [M('r1'), 'r1 eth1'], [M('sw1'), 'sw1']], ip: [['10.10.0.11', 'a1'], ['10.20.0.11', 'b1'], ['10.10.0.1', 'r1 eth1.10'], ['10.20.0.1', 'r1 eth1.20']] },
        expected: [
          { block: 'eth', fields: { dst: M('b1'), src: M('r1'), type: '0x8100' } },
          { block: 'vlan', fields: { vid: '20', type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.11', dst: '10.20.0.11', proto: '1', ttl: '63' } },
          { block: 'icmp', fields: { type: '8' } }],
        explain: 'Der EtherType im Ethernet-Header ist 0x8100 und kündigt den Tag an. Erst nach dem Tag folgt der eigentliche EtherType 0x0800. r1 hat die TTL um eins gesenkt, die IP-Adressen bleiben.' }
    ] },

    { id: 'm3-l3', title: 'VXLAN: Ethernet in UDP', minutes: 12, steps: [
      { type: 'theory', title: 'Layer 2 über ein geroutetes Netz', html: `
<p>VLANs brauchen einen durchgehenden Layer-2-Weg und sind auf 4094 beschränkt. Moderne Rechenzentren routen deshalb jeden Link und legen Layer-2-Segmente als <b>Overlay</b> darüber. Das Standardprotokoll dafür ist <b>VXLAN</b> (RFC 7348): Es packt einen ganzen Ethernet-Frame in ein UDP-Paket.</p>
${bar([['Ethernet', '14', 'eth', 1], ['IPv4', '20', 'ip', 1.1], ['UDP 4789', '8', 'udp', 1], ['VXLAN', '8', 'vxlan', 1], ['Ethernet', '14', 'eth', 1], ['IP-Paket des Hosts', 'bis 1500', 'ip', 2.6]], 'Aussen das Underlay, innen der unveränderte Frame des Hosts.')}
<table><tr><th>Begriff</th><th>Bedeutung</th></tr>
<tr><td>Underlay</td><td>das geroutete Netz, kennt nur die Adressen der VTEPs</td></tr>
<tr><td>Overlay</td><td>die Layer-2-Segmente darüber</td></tr>
<tr><td>VTEP</td><td>packt Frames ein und aus (VXLAN Tunnel Endpoint)</td></tr>
<tr><td>VNI</td><td>Nummer des Segments, 24 Bit, über 16 Millionen</td></tr></table>
${note('Warum UDP? UDP geht durch jedes IP-Netz. Und der VTEP berechnet den UDP-Quell-Port aus dem inneren Frame: Verschiedene Verbindungen bekommen verschiedene Ports, und Router mit mehreren gleich guten Wegen (ECMP) verteilen sie darauf.')}
${note('Linux nimmt ohne Angabe den alten Port <b>8472</b>. Gib immer <code>dstport 4789</code> an, sonst reden zwei VTEPs aneinander vorbei.', true)}
<p>Für Broadcasts und unbekannte Ziele (BUM-Verkehr) sendet ein VTEP eine Kopie an jeden VTEP in seiner <b>Flood-Liste</b> (Head-End Replication). Aus den Frames, die er auspackt, lernt er, welche MAC hinter welchem VTEP steckt: <b>Flood and Learn</b>.</p>` },
      { type: 'stack', title: 'Baue das VXLAN-Paket zusammen', hint: 'Oben steht, was zuerst über das Kabel des Underlays geht.',
        items: [{ name: 'Äusserer Ethernet-Header', size: '14 Byte', kind: 'eth' }, { name: 'Äusserer IPv4-Header (VTEP → VTEP)', size: '20 Byte', kind: 'ip' }, { name: 'UDP, Ziel-Port 4789', size: '8 Byte', kind: 'udp' },
          { name: 'VXLAN-Header mit VNI', size: '8 Byte', kind: 'vxlan' }, { name: 'Innerer Ethernet-Header (srv1 → srv2)', size: '14 Byte', kind: 'eth' }, { name: 'Innerer IPv4-Header', size: '20 Byte', kind: 'ip' }, { name: 'ICMP Echo Request', size: '64 Byte', kind: 'icmp' }] },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Wie viele Byte setzt VXLAN vor das IP-Paket des Hosts (ohne äusseren Ethernet-Header)?', input: ['50'], unit: 'Byte', explain: '20 (IP) + 8 (UDP) + 8 (VXLAN) + 14 (innerer Ethernet-Header).' },
        { q: 'Welcher UDP-Ziel-Port ist für VXLAN vergeben?', input: ['4789'] },
        { q: 'Ein Router im Underlay hat keine Route zu den Netzen der Server. Funktioniert VXLAN trotzdem?', options: ['Nein', 'Ja, er muss nur die Adressen der VTEPs erreichen', 'Nur mit Multicast'], correct: 1 }] }
    ] },

    { id: 'm3-l4', title: 'VXLAN im Lab', minutes: 15, steps: [
      { type: 'lab', title: 'Zerlege einen VXLAN-Frame', topo: () => vxlanTopo(), edit: 'view',
        intro: '<p>srv1 und srv2 liegen im selben Subnetz, aber an verschiedenen VTEPs. Dazwischen routet core. Tempo herunterdrehen und zuschauen, wie das Paket unterwegs eine zweite Hülle bekommt.</p>',
        presets: { srv1: ['ping -c 2 192.168.10.12'], vtep1: ['bridge fdb', 'show vxlan'], core: ['ip route'] },
        goals: [
          { text: 'Pinge von srv1 aus srv2 (192.168.10.12).', check: pingOk('srv1', '192.168.10.12') },
          { text: 'Klicke auf einen VXLAN-Frame zwischen vtep1 und core und klappe alle Schichten auf.', check: inspected(isVxlan) },
          { text: 'Welche Quell-IP hat das äussere IP-Paket von vtep1?', ask: true, expect: () => ['10.255.0.1'] },
          { text: 'Welchen VNI trägt der Frame?', ask: true, expect: () => ['10010'] },
          { text: 'Kennt core eine Route zu 192.168.10.0/24? (ja oder nein)', ask: true, expect: () => ['nein'] }],
        outro: '<p>In der MAC-Tabelle von vtep1 steht srv2 mit dem Vermerk <code>dst 10.255.0.2</code>: vtep1 hat aus dem ausgepackten Frame gelernt, hinter welchem VTEP srv2 steckt.</p>' }
    ] },

    { id: 'm3-l5', title: 'Fehlersuche im Overlay', minutes: 12, steps: [
      { type: 'theory', title: 'Von unten nach oben', html: `
<p>Funktioniert ein Overlay nicht, prüfe immer in dieser Reihenfolge:</p>
<ol><li><b>Underlay:</b> Erreichen sich die VTEPs? Ping zwischen den Loopbacks.</li>
<li><b>Kommen VXLAN-Pakete an?</b> Im Protokoll beim empfangenden VTEP filtern.</li>
<li><b>Werden sie ausgepackt?</b> VNI und UDP-Port müssen auf beiden Seiten gleich sein.</li>
<li><b>Lokal:</b> Stimmt das VLAN am Port zum Server?</li></ol>` },
      { type: 'lab', title: 'Etwas stimmt nicht', topo: () => vxlanTopo({ vni2: 10011 }), edit: 'config',
        intro: '<p>Die Verbindung zwischen srv1 und srv2 ist kaputt. Finde den Fehler und behebe ihn.</p>',
        presets: { srv1: ['ping -c 1 192.168.10.12'], vtep1: ['ping -c 1 10.255.0.2', 'show vxlan'], vtep2: ['show vxlan'] },
        goals: [
          { text: 'Der Ping von srv1 an srv2 scheitert.', check: tag('srv1', 'ping-done', d => d.received === 0) },
          { text: 'Finde im Protokoll die Meldung, warum vtep2 die Pakete verwirft.', check: tag('vtep2', 'vxlan-vni-unknown') },
          { text: 'Behebe den Fehler, bis der Ping klappt.', check: pingOk('srv1', '192.168.10.12') }],
        hints: ['Vergleiche bei vtep1 und vtep2 unter Konfiguration die VXLAN-Segmente.'] }
    ] },

    { id: 'm3-l6', title: 'Die MTU-Falle', minutes: 12, steps: [
      { type: 'theory', title: '50 Byte, die alles kaputt machen', html: `
<p>VXLAN setzt 50 Byte vor jedes Paket. Ein volles Paket mit 1500 Byte wird im Underlay 1550 Byte gross. Linux setzt die MTU eines VXLAN-Interfaces deshalb automatisch auf die MTU des Uplinks minus 50.</p>
${note('Passt ein Frame nicht, wird er <b>still verworfen</b>. Der VTEP ist für die Hosts ein Switch, und ein Switch sendet keine ICMP-Meldung, er hat im Segment gar keine IP-Adresse. Ping geht, grosse Übertragungen hängen.', true)}
<table><tr><th>Lösung</th><th>Bewertung</th></tr>
<tr><td>Underlay-MTU auf 1550 oder Jumbo Frames (9000)</td><td>Standard im Rechenzentrum, die Hosts merken nichts</td></tr>
<tr><td>Hosts im Overlay auf MTU 1450</td><td>Nötig, wenn das Underlay nicht anpassbar ist</td></tr></table>` },
      { type: 'lab', title: 'Stolpere und behebe', topo: () => vxlanTopo(), edit: 'config',
        intro: '<p>Sende ein grosses Paket mit DF von srv1 an srv2 und schau genau hin, wo es verschwindet.</p>',
        presets: { srv1: ['ping -c 1 -M do -s 1472 192.168.10.12', 'ping -c 1 -M do -s 1422 192.168.10.12'], vtep1: ['show vxlan'] },
        goals: [
          { text: 'Sende ping -c 1 -M do -s 1472 192.168.10.12 auf srv1. Das Paket verschwindet ohne Meldung.', check: tag('vtep1', 'vxlan-mtu-drop') },
          { text: 'Welche MTU hat das VXLAN-Interface von vtep1?', ask: true, expect: () => ['1450'] },
          { text: 'Erhöhe die MTU der beiden Underlay-Kabel auf 1550 (Kabel anklicken) und sende den Ping erneut.', check: pingOk('srv1', '192.168.10.12', { size: 1472, df: true }) }],
        hints: ['Underlay-Kabel sind vtep1 ↔ core und vtep2 ↔ core.'],
        outro: '<p>Mit 1550 im Underlay hat das VXLAN-Interface automatisch wieder MTU 1500, und die Server merken von der Kapselung nichts.</p>' }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m4.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, pingOk, tag, pingOkAfter, linkBetween } from './helpers.js';
import { stpTriangle, stpSquare } from '../presets.js';
import { macFor } from '../net.js';

// Bridge-IDs wie in der Engine: Priorität plus MAC der Bridge
const bmac = id => macFor(id + '/bridge');
const bidOf = (sim, id) => `${sim.dev(id).cfg.stp.priority}.${bmac(id)}`;
const lowestBid = (sim, ids) => ids.map(id => ({ id, prio: Number(sim.dev(id).cfg.stp.priority), mac: bmac(id) }))
  .sort((a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac))[0].id;
const TRI = ['sw1', 'sw2', 'sw3'];
// Der Switch mit der höchsten MAC wird bei gleicher Priorität sicher nicht Root
const NOT_ROOT = [...TRI].sort((a, b) => bmac(b).localeCompare(bmac(a)))[0];
const blockedPorts = (sim, ids) => ids.flatMap(id => (sim.dev(id).bridge.stpTable()?.ports || []).filter(p => p.role === 'alternate').map(p => [id, p.port]));
const portAnswers = list => list.flatMap(([d, p]) => [`${d} ${p}`, `${d}:${p}`, `${d}/${p}`, `${d}-${p}`]);
const stpOn = ids => sim => ids.every(id => sim.dev(id)?.bridge?.stp);

export default {
  id: 'm4', title: 'Spanning Tree', bands: ['eth', 'stp'],
  text: 'Redundante Verkabelung ohne Broadcast-Sturm: Wie Switches eine Root Bridge wählen, Ports blockieren und nach einem Ausfall umschalten.',
  lessons: [
    { id: 'm4-l1', title: 'Warum Schleifen ein Netz lahmlegen', minutes: 12, steps: [
      { type: 'theory', title: 'Redundanz ohne Schutz', html: `
<p>Ein einzelnes Kabel zwischen zwei Switches ist ein Single Point of Failure. Also verkabelt man redundant: Fällt ein Weg aus, gibt es einen zweiten. Damit entsteht aber eine <b>Schleife</b>, und Ethernet ist dafür nicht gebaut.</p>
<table><tr><th>IP-Paket</th><th>Ethernet-Frame</th></tr>
<tr><td>hat eine TTL, jeder Router zieht 1 ab, bei 0 ist Schluss</td><td>hat <b>kein</b> solches Feld, ein Frame kann ewig kreisen</td></tr></table>
<p>Was in einem Dreieck aus drei Switches passiert, wenn pc1 eine einzige ARP-Anfrage sendet:</p>
<pre>1. sw2 flutet den Broadcast an sw1 und an sw3
2. sw1 flutet ihn weiter an sw3, sw3 flutet ihn weiter an sw1
3. Beide Kopien kommen wieder bei sw2 an, der flutet sie erneut
4. Jede Runde erzeugt neue Kopien, keine verschwindet</pre>
<p>Die Folgen nennt man <b>Broadcast-Sturm</b>: Die Links laufen voll, jeder Host muss jeden Broadcast verarbeiten, und die MAC-Tabellen springen ständig hin und her (<b>MAC-Flapping</b>), weil dieselbe Quell-MAC abwechselnd an verschiedenen Ports auftaucht. In Sekunden steht das ganze Segment.</p>
${note('Die Lösung ist das <b>Spanning Tree Protocol</b> (STP, IEEE 802.1D). Die Switches tauschen kleine Nachrichten aus, die <b>BPDUs</b>, und berechnen daraus einen Baum ohne Schleifen. Überzählige Ports werden blockiert. Fällt ein aktiver Weg aus, gibt STP einen blockierten Port wieder frei.')}
${note('Ein Kabel, das versehentlich zwei Wanddosen im selben Büro verbindet, reicht für eine Schleife. Deshalb ist STP auf Switches im Normalfall eingeschaltet, auch dort, wo niemand absichtlich redundant verkabelt hat.', true)}` },
      { type: 'lab', title: 'Ein Ping legt das Netz lahm', topo: () => stpTriangle({ enabled: false }), edit: 'config',
        intro: '<p>Drei Switches im Dreieck, Spanning Tree ist überall aus. Pinge von pc1 aus pc2 und schau zu, was mit der ARP-Anfrage passiert. Die Simulation hält an, sobald ein Switch denselben Frame zu oft gesehen hat.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2'], sw2: ['bridge fdb', 'show spanning-tree'] },
        goals: [
          { text: 'Pinge von pc1 aus pc2 (10.0.0.2) und löse den Sturm aus.', check: tag(null, 'storm') },
          { text: 'Welche Art von Frame kreist in der Schleife?', ask: true, expect: () => ['arp', 'arp request', 'arp-anfrage', 'arp-request', 'broadcast', 'arp broadcast'], placeholder: 'z. B. ICMP' },
          { text: 'Setze den Zustand zurück und schalte bei sw1, sw2 und sw3 unter Konfiguration Spanning Tree ein.', check: stpOn(TRI) },
          { text: 'Warte, bis die Punkte an den Ports grün oder rot sind, und pinge erneut. Jetzt kommt die Antwort an.', check: pingOk('pc1', '10.0.0.2') }],
        hints: ['Der Knopf mit dem Kreispfeil oben links setzt den Zustand zurück.', 'Die Timer sind auf «schnell» gestellt: Ein Port braucht 8 Sekunden bis Forwarding. Mit dem Vorspulen-Knopf geht es sofort.'],
        outro: '<p>Ein roter Punkt zeigt einen blockierten Port. Er empfängt weiterhin BPDUs, leitet aber keinen einzigen Frame weiter. So bleibt das Kabel als Reserve gesteckt, ohne eine Schleife zu bilden.</p>' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Warum kreist ein Ethernet-Frame in einer Schleife unbegrenzt, ein IP-Paket aber nicht?', options: ['Ethernet ist schneller', 'Der Ethernet-Header hat kein TTL-Feld', 'Switches löschen keine Frames', 'IP-Pakete sind kleiner'], correct: 1,
          explain: 'Router senken die TTL und verwerfen das Paket bei 0. Ein Switch verändert den Frame nicht und kann eine Schleife nicht erkennen.' },
        { q: 'Was bedeutet MAC-Flapping?', options: ['Eine MAC-Adresse ändert sich zufällig', 'Dieselbe Quell-MAC taucht abwechselnd an verschiedenen Ports auf', 'Der Switch vergisst alle Adressen', 'Zwei Hosts haben dieselbe IP'], correct: 1,
          explain: 'In einer Schleife kommt der Frame von pc1 über mehrere Wege an. Der Switch trägt pc1 jedes Mal an einem anderen Port ein. Viele Switches melden das im Log, ein gutes Indiz für eine Schleife.' }] }
    ] },

    { id: 'm4-l2', title: 'Die Wahl der Root Bridge', minutes: 15, steps: [
      { type: 'theory', title: 'Bridge-ID und BPDUs', html: `
<p>Spanning Tree baut den Baum von einer Wurzel aus, der <b>Root Bridge</b>. Gewählt wird der Switch mit der kleinsten <b>Bridge-ID</b>:</p>
${bar([['Priorität', '4 Bit', 'stp', 1], ['System-ID (VLAN)', '12 Bit', 'stp', 1.6], ['MAC-Adresse der Bridge', '48 Bit', 'eth', 3]], 'Zusammen 8 Byte. Zuerst zählt die Priorität, bei Gleichstand die MAC.')}
<p>Die Priorität ist standardmässig <b>32768</b> und lässt sich nur in Schritten von <b>4096</b> ändern, weil die unteren 12 Bit für die VLAN-Nummer reserviert sind. Haben alle Switches dieselbe Priorität, gewinnt die kleinste MAC-Adresse, oft der älteste Switch im Netz. Deshalb legt man die Root bewusst fest, meist auf einen zentralen Switch mit Priorität 4096 oder 0.</p>
<h2>So läuft die Wahl</h2>
<pre>1. Jeder Switch startet und hält sich selbst für die Root
2. Er sendet alle 2 Sekunden BPDUs an 01:80:c2:00:00:00
3. Hört er eine BPDU mit kleinerer Root-ID, übernimmt er diese Root
4. Am Ende sendet nur noch die Root eigene BPDUs, die anderen geben sie weiter</pre>
<table><tr><th>Feld in der BPDU</th><th>Bedeutung</th></tr>
<tr><td>Root-ID</td><td>wen der Absender für die Root hält</td></tr>
<tr><td>Root-Pfadkosten</td><td>wie teuer der Weg des Absenders zur Root ist</td></tr>
<tr><td>Bridge-ID, Port-ID</td><td>wer sendet, über welchen Port</td></tr>
<tr><td>Hello, Max Age, Forward Delay</td><td>Timer, die die Root für alle vorgibt (2, 20, 15 Sekunden)</td></tr>
<tr><td>Flags</td><td>u. a. Topology Change</td></tr></table>
${note('BPDUs sind keine Ethernet-II-Frames. Sie verwenden das ältere 802.3-Format mit einem Längenfeld statt EtherType und einem LLC-Header (DSAP und SSAP 0x42). Im Paketinspektor siehst du das.')}` },
      { type: 'quiz', title: 'Wer gewinnt?', questions: [
        { q: 'Drei Switches: A <code>32768.00:1a:2b:00:00:01</code>, B <code>4096.00:1a:2b:ff:ff:ff</code>, C <code>32768.00:00:00:00:00:02</code>. Wer wird Root?', options: ['A', 'B', 'C'], correct: 1,
          explain: 'Zuerst zählt die Priorität. 4096 ist kleiner als 32768, die MAC spielt dann keine Rolle mehr.' },
        { q: 'A und C bleiben übrig. Wer von beiden hätte die kleinere Bridge-ID?', options: ['A', 'C'], correct: 1, explain: 'Gleiche Priorität, also entscheidet die MAC: 00:00:00:… ist kleiner als 00:1a:2b:….' },
        { q: 'Welche Priorität kannst du nicht einstellen?', options: ['0', '4096', '20000', '61440'], correct: 2, explain: '20000 ist kein Vielfaches von 4096.' }] },
      { type: 'build', title: 'Baue eine BPDU der Root', blocks: ['eth', 'vlan', 'arp', 'stp', 'ip', 'udp', 'data'],
        task: `<p><b>sw1</b> ist Root Bridge mit der Bridge-ID <code>4096.${bmac('sw1')}</code>. Baue die BPDU, die sw1 über seinen Port eth1 sendet (MAC von eth1: <code>${macFor('sw1/eth1')}</code>).</p>`,
        addresses: { mac: [[macFor('sw1/eth1'), 'sw1 eth1'], [macFor('sw2/eth1'), 'sw2 eth1']], bid: [[`4096.${bmac('sw1')}`, 'sw1'], [`32768.${bmac('sw2')}`, 'sw2'], [`32768.${bmac('sw3')}`, 'sw3']] },
        expected: [
          { block: 'eth', fields: { dst: '01:80:c2:00:00:00', src: macFor('sw1/eth1'), type: 'len' } },
          { block: 'stp', fields: { root: `4096.${bmac('sw1')}`, cost: '0', bridge: `4096.${bmac('sw1')}` } }],
        explain: 'Die Root hat zu sich selbst die Kosten 0 und ist zugleich Absender. Die Ziel-MAC ist die reservierte Multicast-Adresse für Bridges, die kein Switch weiterleitet. Statt EtherType steht die Länge der Nutzlast im Header (802.3), danach folgt der LLC-Header.' },
      { type: 'lab', title: 'Root finden und neu bestimmen', topo: () => stpTriangle({ enabled: true }), edit: 'config',
        intro: `<p>Alle drei Switches haben die Standardpriorität 32768. Finde heraus, wer Root geworden ist, und bestimme dann selbst eine neue Root. Mit <code>show spanning-tree</code> in der Konsole eines Switches oder unter Tabellen siehst du den Zustand.</p>`,
        presets: { sw1: ['show spanning-tree'], sw2: ['show spanning-tree'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Welcher Switch ist Root Bridge?', ask: true, expect: sim => [lowestBid(sim, TRI)], placeholder: 'z. B. sw2' },
          { text: 'Warum er? Welche MAC-Adresse hat seine Bridge-ID?', ask: true, expect: sim => [bmac(lowestBid(sim, TRI))], placeholder: 'aa:c1:ab:…' },
          { text: `Mache <b>${NOT_ROOT}</b> zur Root Bridge, indem du seine Priorität senkst. Alle Switches müssen ihn als Root anerkennen.`,
            check: sim => TRI.every(id => sim.dev(id).bridge.stpTable()?.root === bidOf(sim, NOT_ROOT)) }],
        hints: ['Die Priorität stellst du unter Konfiguration beim Switch ein, Abschnitt Spanning Tree.', 'In der Konsole geht es auch: spanning-tree priority 4096'],
        outro: '<p>Die neue Root setzt sich sofort durch: Sobald die anderen ihre bessere BPDU hören, übernehmen sie die Root-ID und berechnen ihre Ports neu.</p>' }
    ] },

    { id: 'm4-l3', title: 'Port-Rollen und Pfadkosten', minutes: 18, steps: [
      { type: 'theory', title: 'Root-Port, Designated, Alternate', html: `
<p>Steht die Root fest, verteilt jeder Switch Rollen an seine Ports. Alle Entscheidungen folgen derselben Kette von Vergleichen: kleinere Kosten, dann kleinere Bridge-ID des Absenders, dann kleinere Port-ID.</p>
<table><tr><th>Rolle</th><th>Regel</th><th>Zustand</th></tr>
<tr><td><b>Root-Port</b></td><td>Jeder Switch ausser der Root hat genau einen: den Port mit dem günstigsten Weg zur Root.</td><td>Forwarding</td></tr>
<tr><td><b>Designated Port</b></td><td>Jedes Kabelsegment hat genau einen: am Switch, der dort den günstigsten Weg zur Root anbietet. Alle Ports der Root sind Designated.</td><td>Forwarding</td></tr>
<tr><td><b>Alternate</b></td><td>Alles, was übrig bleibt. Ein Reserveweg zur Root.</td><td>Blocking</td></tr></table>
<h2>Kosten</h2>
<p>Die Root-Pfadkosten sind die Summe der Portkosten auf dem Weg zur Root, jeweils am <b>empfangenden</b> Port gezählt. Schnellere Links kosten weniger:</p>
<table><tr><th>Geschwindigkeit</th><th>802.1D (kurz)</th><th>802.1t (lang)</th></tr>
<tr><td>10 Mbit/s</td><td>100</td><td>2 000 000</td></tr><tr><td>100 Mbit/s</td><td>19</td><td>200 000</td></tr>
<tr><td>1 Gbit/s</td><td>4</td><td>20 000</td></tr><tr><td>10 Gbit/s</td><td>2</td><td>2 000</td></tr></table>
<h2>Durchgerechnet am Ring</h2>
<pre>Ring: sw1 (Root) – sw2 – sw3 – sw4 – sw1, alle Links Kosten 4
sw2: Root-Port zu sw1, Kosten 4
sw4: Root-Port zu sw1, Kosten 4
sw3: zwei Wege mit Kosten 8, über sw2 oder über sw4
     Gleichstand → der Nachbar mit der kleineren Bridge-ID gewinnt
Segment sw2–sw3: sw2 bietet 4, sw3 bietet 8 → sw2 ist Designated
Segment sw3–sw4: genauso, sw4 ist Designated
→ Der Port von sw3 zum «Verlierer» bleibt übrig: Alternate, Blocking</pre>
${note('Die Rollen sagen dir, wo der Verkehr fliesst. Ein Frame von einem Ende des Rings zum anderen nimmt immer den Weg über die Root, auch wenn ein kürzerer Weg existiert, der gerade blockiert ist.')}` },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Wie viele Root-Ports hat die Root Bridge?', input: ['0', 'keinen', 'null'], explain: 'Die Root braucht keinen Weg zu sich selbst. Alle ihre Ports sind Designated.' },
        { q: 'Ein Switch erreicht die Root über einen 100-Mbit-Link direkt (Kosten 19) oder über zwei Gigabit-Hops (4 + 4). Welcher Weg wird Root-Port?', options: ['Der direkte 100-Mbit-Link', 'Der Weg über zwei Gigabit-Hops', 'Beide, STP verteilt die Last'], correct: 1,
          explain: '4 + 4 = 8 ist kleiner als 19. STP zählt Kosten, nicht Hops. Und STP verteilt nie Last auf zwei Wege, dafür bräuchte es mehrere Instanzen (MSTP) oder Layer-3-Routing mit ECMP.' },
        { q: 'Auf einem Segment bieten beide Switches dieselben Kosten zur Root. Wer bekommt den Designated Port?', options: ['Der mit der kleineren Bridge-ID', 'Der mit der grösseren MAC', 'Beide', 'Keiner'], correct: 0 }] },
      { type: 'lab', title: 'Den blockierten Port vorhersagen und verschieben', topo: stpSquare, edit: 'config',
        intro: '<p>Vier Switches im Ring, sw1 ist Root (Priorität 4096). Lass das Netz kurz konvergieren und vergleiche dann die Punkte an den Ports mit deiner Rechnung. Ein R steht für Root-Port, D für Designated, A für Alternate.</p>',
        presets: { sw3: ['show spanning-tree', 'spanning-tree cost eth2 19'], sw2: ['show spanning-tree'], sw4: ['show spanning-tree'], pc1: ['ping -c 2 10.0.0.3'] },
        goals: [
          { text: 'Welcher Port blockiert? Antworte mit Switch und Port, z. B. sw2 eth1.', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Über welchen Nachbarn erreicht sw3 die Root?', ask: true, expect: sim => { const t = sim.dev('sw3').bridge.stpTable(); const l = sim.linkAt('sw3', t?.rootPort || ''); return l ? [l.a.dev === 'sw3' ? l.b.dev : l.a.dev] : []; } },
          { text: 'Erhöhe eine Portkosten bei sw3 so, dass sw3 die Root über <b>sw2</b> erreicht.', check: sim => sim.dev('sw3').bridge.stpTable()?.rootPort === 'eth1' },
          { text: 'Welcher Port blockiert jetzt?', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Pinge von pc1 aus pc3 (10.0.0.3). Der Weg führt über sw2.', check: pingOk('pc1', '10.0.0.3') }],
        hints: ['sw3 eth1 führt zu sw2, sw3 eth2 zu sw4.', 'Die Kosten zählen am empfangenden Port. Mache den Weg über sw4 teurer: Kosten von sw3 eth2 auf 19.'],
        outro: '<p>Mit Portkosten steuerst du, welcher Link Reserve ist. In der Praxis lässt man die Kosten meist auf dem Standard und wählt nur die Root bewusst. Die Kosten passt man an, wenn Links unterschiedlich schnell sind oder ein bestimmter Link bevorzugt werden soll.</p>' }
    ] },

    { id: 'm4-l4', title: 'Port-Zustände, Timer und PortFast', minutes: 15, steps: [
      { type: 'theory', title: 'Warum ein neuer Port 30 Sekunden braucht', html: `
<p>Ein Port, der aktiv wird, darf nicht sofort weiterleiten: Er könnte eine Schleife schliessen, bevor alle Switches die neue Lage kennen. Deshalb durchläuft er mehrere Zustände:</p>
<table><tr><th>Zustand</th><th>Dauer</th><th>BPDUs</th><th>lernt MACs</th><th>leitet weiter</th></tr>
<tr><td>Blocking</td><td>bis zu 20 s (Max Age)</td><td>empfängt</td><td>nein</td><td>nein</td></tr>
<tr><td>Listening</td><td>15 s (Forward Delay)</td><td>sendet und empfängt</td><td>nein</td><td>nein</td></tr>
<tr><td>Learning</td><td>15 s (Forward Delay)</td><td>sendet und empfängt</td><td><b>ja</b></td><td>nein</td></tr>
<tr><td>Forwarding</td><td>dauerhaft</td><td>sendet und empfängt</td><td>ja</td><td><b>ja</b></td></tr></table>
<p>Learning gibt es, damit der Switch seine MAC-Tabelle schon füllt, bevor er weiterleitet. Sonst müsste er anfangs jeden Frame fluten.</p>
${note('Das Problem in der Praxis: Ein PC wird eingesteckt, und 30 Sekunden geht gar nichts. DHCP läuft in einen Timeout, ein PXE-Boot scheitert. Die Lösung heisst <b>PortFast</b> (Cisco) oder <b>Edge-Port</b> (Standard): Ports zu Endgeräten gehen sofort auf Forwarding.')}
<p>Kommt an einem Edge-Port trotzdem eine BPDU an, hängt dort offensichtlich ein Switch. Der Port verliert dann den Edge-Status und nimmt normal an STP teil. Mit <b>BPDU Guard</b> wird ein solcher Port sogar abgeschaltet, ein guter Schutz gegen mitgebrachte Switches.</p>
${note('<b>RSTP</b> (802.1w, heute Standard) handelt neue Ports in Sekundenbruchteilen aus, statt Timer abzuwarten. Die Rollen und die Root-Wahl funktionieren gleich wie hier. Eine Linux-Bridge spricht nur das klassische STP, für RSTP braucht es den Dienst <code>mstpd</code>.')}` },
      { type: 'lab', title: 'Zustände beobachten und PortFast einschalten', topo: () => stpTriangle({ enabled: true, rootPrio: 4096, timers: 'standard' }), edit: 'config',
        intro: '<p>Diesmal laufen die Standard-Timer. Beobachte die Punkte an den Ports: gelb heisst Listening oder Learning. Das Protokoll lässt sich auf «Nur Spanning Tree» filtern. Mit dem Vorspulen-Knopf überspringst du Wartezeit.</p>',
        presets: { sw2: ['show spanning-tree'], sw3: ['show spanning-tree', 'spanning-tree portfast eth5 on'], pc1: ['ping -c 1 10.0.0.2'] },
        goals: [
          { text: 'Warte, bis der Port von pc1 (sw2 eth5) weiterleitet.', check: tag('sw2', 'stp-state', d => d.port === 'eth5' && d.state === 'forwarding') },
          { text: 'Nach wie vielen Sekunden Simulationszeit war das? (ganze Zahl)', ask: true,
            expect: sim => { const e = sim.log.find(x => x.dev === 'sw2' && x.tag === 'stp-state' && x.data?.port === 'eth5' && x.data.state === 'forwarding'); return e ? [String(Math.round(e.t / 1000)), '30'] : ['30']; } },
          { text: 'Schalte bei sw3 PortFast für eth5 ein. Trenne danach das Kabel von pc2 kurz und verbinde es wieder: Der Port leitet sofort weiter.', check: tag('sw3', 'stp-state', d => d.port === 'eth5' && d.edge) },
          { text: 'In welchem Zustand lernt ein Port MAC-Adressen, leitet aber noch nichts weiter?', ask: true, expect: () => ['learning'] }],
        hints: ['Ein Kabel trennst du, indem du es anklickst und «Link aktiv» ausschaltest.'],
        outro: '<p>Edge-Ports gehören an jeden Port zu einem Endgerät. Zwischen Switches bleiben sie aus, sonst könnte beim Einstecken kurz eine Schleife entstehen.</p>' }
    ] },

    { id: 'm4-l5', title: 'Ausfall und Konvergenz', minutes: 15, steps: [
      { type: 'theory', title: 'Wenn ein Weg wegfällt', html: `
<p>Spanning Tree muss zwei Arten von Ausfällen unterscheiden:</p>
<table><tr><th>Ausfall</th><th>Wie der Switch es merkt</th><th>Dauer bei 802.1D</th></tr>
<tr><td>direkt: der eigene Root-Port verliert den Link</td><td>sofort</td><td>30 s (Listening + Learning)</td></tr>
<tr><td>indirekt: irgendwo anders bricht der Weg</td><td>BPDUs bleiben aus, nach Max Age verfällt die Information</td><td>bis 50 s (20 + 15 + 15)</td></tr></table>
<h2>Topologieänderung</h2>
<p>Nach dem Umschalten stimmen die MAC-Tabellen nicht mehr: Sie zeigen noch auf den alten Weg. Ohne Gegenmassnahme liefen Frames bis zum Aging (300 s) ins Leere. Deshalb meldet ein Switch eine <b>Topology Change</b> (TC) Richtung Root, die Root setzt das TC-Flag in ihren BPDUs, und alle Switches leeren daraufhin ihre MAC-Tabellen schnell. Danach wird über den neuen Weg neu gelernt.</p>
${note('Eine TC entsteht auch, wenn ein gewöhnlicher Port eines Endgeräts auf Forwarding geht. Ohne PortFast löst also jeder eingeschaltete PC kurz ein Leeren der MAC-Tabellen im ganzen Netz aus. Noch ein Grund für Edge-Ports.')}` },
      { type: 'lab', title: 'Ziehe ein Kabel', topo: () => stpTriangle({ enabled: true, rootPrio: 4096 }), edit: 'config',
        intro: '<p>sw1 ist Root. Lass das Netz konvergieren und prüfe mit einem Ping, dass alles läuft. Dann unterbrichst du das Kabel zwischen sw1 und sw2 und schaust zu, wie STP den Reserveweg freigibt.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2', 'ping -c 12 10.0.0.2'], sw2: ['show spanning-tree', 'ip link set eth1 down'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Pinge von pc1 aus pc2, sobald alle Ports grün oder rot sind.', check: pingOk('pc1', '10.0.0.2') },
          { text: 'Welcher Switch hat den blockierten Port?', ask: true, expect: sim => {
            const cut = sim.log.find(x => x.tag === 'link-down');
            const ev = sim.log.filter(x => x.tag === 'stp-state' && x.data?.state === 'blocking' && (!cut || x.seq < cut.seq));
            return ev.length ? [ev[ev.length - 1].dev] : blockedPorts(sim, TRI).map(([d]) => d);
          } },
          { text: 'Unterbrich das Kabel zwischen sw1 und sw2.', check: sim => linkBetween(sim, 'sw1', 'sw2')?.up === false },
          { text: 'Welcher Port von sw2 ist jetzt Root-Port?', ask: true, expect: sim => [sim.dev('sw2').bridge.stpTable()?.rootPort || ''] },
          { text: 'Pinge erneut, bis wieder Antworten kommen.', check: pingOkAfter('pc1', '10.0.0.2', e => e.tag === 'link-down') }],
        hints: ['Ein laufender ping -c 12 zeigt schön, wie lange die Unterbrechung dauert.', 'Im Protokoll siehst du unter «Nur Spanning Tree» die Topologieänderung und das Leeren der MAC-Tabellen.'],
        outro: '<p>Mit den schnellen Labor-Timern dauert das Umschalten 8 Sekunden, mit Standard-Timern 30. Rapid Spanning Tree schafft es meist unter einer Sekunde. Wo noch schneller umgeschaltet werden muss, setzt man auf Layer 3 mit Routing statt auf grosse Layer-2-Domänen.</p>' },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Warum leeren Switches nach einer Topologieänderung ihre MAC-Tabellen?', options: ['Um Speicher zu sparen', 'Weil die Einträge noch auf den alten Weg zeigen', 'Damit STP neu startet', 'Das tun sie nicht'], correct: 1 },
        { q: 'Ein Switch hört auf seinem Root-Port keine BPDUs mehr, der Link ist aber noch aktiv. Wie lange wartet er (802.1D), bevor er die Information verwirft?', input: ['20'], unit: 'Sekunden', explain: 'Das ist Max Age. Danach folgen noch Listening und Learning mit je 15 Sekunden.' },
        { q: 'Welche Massnahme verkürzt das Umschalten am stärksten?', options: ['Hello-Timer auf 1 Sekunde', 'Rapid Spanning Tree (802.1w)', 'Höhere Root-Priorität', 'Mehr redundante Kabel'], correct: 1 }] }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m5.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, tag, inspected, isTcpSyn, isDns } from './helpers.js';
import { servicesTopo, tcpPathTopo } from '../presets.js';
import { macFor } from '../net.js';

const M = id => macFor(id + '/eth1');
const ADDR = {
  mac: [[M('client'), 'client'], [M('r1'), 'r1 eth1 (Gateway)'], [M('web'), 'web'], [M('dns'), 'dns']],
  ip: [['10.10.0.10', 'client'], ['10.10.0.1', 'r1 eth1'], ['10.20.0.80', 'web'], ['10.20.0.53', 'dns']],
  name: ['web.lab', 'dns.lab', 'client.lab']
};
const EPHEMERAL = { range: [1024, 65535] };
const tcpDoneAfter = (evTag, port) => sim => {
  const ev = sim.log.find(e => e.tag === evTag);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.tag === 'tcp-done' && e.data.ok && (!port || e.data.port === port));
};

export default {
  id: 'm5', title: 'Transport: UDP, TCP und Dienste', bands: ['ip', 'udp', 'tcp'],
  text: 'Ports und Sockets, DNS über UDP, der Drei-Wege-Handshake, abgelehnte und gefilterte Verbindungen, MSS und die Path MTU aus Sicht von TCP.',
  lessons: [
    { id: 'm5-l1', title: 'Ports, Sockets und UDP', minutes: 10, steps: [
      { type: 'theory', title: 'Wer bekommt das Paket?', html: `
<p>Die IP-Adresse bringt ein Paket zum richtigen Host. Auf dem Host laufen aber viele Programme gleichzeitig. Welches die Daten bekommt, entscheidet die Transportschicht mit <b>Ports</b>: 16-Bit-Nummern von 0 bis 65535.</p>
<table><tr><th>Bereich</th><th>Name</th><th>Beispiele</th></tr>
<tr><td>0 bis 1023</td><td>Well-Known Ports, unter Linux nur mit root-Rechten</td><td>22 SSH, 53 DNS, 80 HTTP, 443 HTTPS</td></tr>
<tr><td>1024 bis 49151</td><td>registrierte Ports</td><td>3306 MySQL, 5432 PostgreSQL, 4789 VXLAN</td></tr>
<tr><td>49152 bis 65535</td><td>dynamische Ports für Clients (IANA)</td><td>Linux nimmt standardmässig 32768 bis 60999</td></tr></table>
<p>Ein Server <b>lauscht</b> auf einem festen Port. Ein Client bekommt vom Betriebssystem einen zufälligen <b>Quell-Port</b>. Die Kombination aus Protokoll, Quell-IP, Quell-Port, Ziel-IP und Ziel-Port (das <b>5-Tupel</b>) bestimmt eindeutig, zu welcher Verbindung ein Paket gehört. Deshalb kann ein Browser zehn Verbindungen zum selben Webserver offen haben.</p>
<h2>UDP: einfach und schnell</h2>
${bar([['Quell-Port', '2', 'udp', 1], ['Ziel-Port', '2', 'udp', 1], ['Länge', '2', 'udp', 1], ['Prüfsumme', '2', 'udp', 1], ['Daten', 'beliebig', 'data', 2.6]], 'Der UDP-Header hat nur 8 Byte.')}
<p>UDP liefert Datagramme ohne Verbindung, ohne Bestätigung, ohne Neuübertragung und ohne Reihenfolge. Was verloren geht, ist weg, ausser die Anwendung kümmert sich selbst darum. Das ist gewollt: DNS, DHCP, NTP, Syslog, VoIP, VXLAN, WireGuard und QUIC (HTTP/3) nutzen UDP, weil sie schnell sein wollen oder die Zuverlässigkeit selbst regeln.</p>
${note('Kommt ein UDP-Datagramm an einem Port an, auf dem nichts lauscht, antwortet der Host mit ICMP <b>Port Unreachable</b> (Typ 3, Code 3). <code>ss -tuln</code> zeigt, welche Ports auf einem Linux-Host offen sind.')}` },
      { type: 'label', title: 'Beschrifte den UDP-Header', distractors: ['TTL', 'Sequenznummer', 'Flags'],
        slots: [{ label: 'Quell-Port', size: '16 Bit', kind: 'udp', w: 130 }, { label: 'Ziel-Port', size: '16 Bit', kind: 'udp', w: 130 }, { label: 'Länge', size: '16 Bit', kind: 'udp', w: 130 }, { label: 'Prüfsumme', size: '16 Bit', kind: 'udp', w: 130 }] },
      { type: 'quiz', title: 'Kurz geprüft', questions: [
        { q: 'Ein Client fragt einen DNS-Server. Welcher Port ist auf dem Hinweg der Ziel-Port?', options: ['Ein zufälliger hoher Port', '53', '80', '67'], correct: 1, explain: 'Auf der Antwort sind die Ports vertauscht: Quelle 53, Ziel der zufällige Port des Clients.' },
        { q: 'Was passiert, wenn ein UDP-Datagramm unterwegs verloren geht?', options: ['UDP sendet es nach einem Timeout neu', 'Nichts, ausser die Anwendung fragt erneut', 'Der Router schickt es nochmals', 'Der Empfänger fordert es an'], correct: 1 },
        { q: 'Wie lang ist der UDP-Header?', input: ['8'], unit: 'Byte' }] }
    ] },

    { id: 'm5-l2', title: 'DNS über UDP', minutes: 15, steps: [
      { type: 'theory', title: 'Eine Frage, eine Antwort', html: `
<p>DNS übersetzt Namen in Adressen. Eine Abfrage passt fast immer in ein einziges UDP-Datagramm, die Antwort auch. Kommt keine Antwort, fragt der Client nach ein paar Sekunden einfach nochmals.</p>
<pre>client  →  dns   UDP 51234 → 53   Anfrage: A-Record für web.lab?
dns     →  client UDP 53 → 51234  Antwort: web.lab A 10.20.0.80</pre>
<table><tr><th>Antwortcode</th><th>Bedeutung</th></tr>
<tr><td>NOERROR</td><td>Name gefunden, Adresse in der Answer Section</td></tr>
<tr><td>NXDOMAIN</td><td>den Namen gibt es nicht</td></tr>
<tr><td>SERVFAIL</td><td>der Server konnte die Frage nicht beantworten</td></tr></table>
<p><code>dig @10.20.0.53 web.lab</code> fragt einen bestimmten Server. Ohne <code>@</code> nimmt dig den eingetragenen DNS-Server (unter Linux aus <code>/etc/resolv.conf</code>). Programme wie <code>curl</code> oder <code>ping</code> lösen einen Namen zuerst auf und senden erst dann das eigentliche Paket.</p>
${note('Antworten über 512 Byte (z. B. mit DNSSEC) wechseln auf TCP Port 53. Eine Firewall, die nur UDP 53 erlaubt, verursacht deshalb manchmal seltsame Fehler.')}` },
      { type: 'build', title: 'Baue die DNS-Anfrage', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dns'],
        task: '<p>Der <b>client</b> (10.10.0.10, Gateway 10.10.0.1) fragt den DNS-Server <b>dns</b> (10.20.0.53) nach <code>web.lab</code>. Der DNS-Server steht in einem anderen Subnetz. Baue den Frame, so wie er das Kabel des Clients verlässt.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.53', proto: '17', ttl: '64' } },
          { block: 'udp', fields: { sport: EPHEMERAL, dport: '53' } },
          { block: 'dns', fields: { qr: '0', name: 'web.lab' } }],
        explain: 'Die Ziel-MAC ist die des Gateways, weil der DNS-Server in einem anderen Netz liegt. Die IP-Adressen gelten von Ende zu Ende. Der Quell-Port ist ein beliebiger hoher Port, den das Betriebssystem wählt.' },
      { type: 'lab', title: 'Namen auflösen', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>Der client fragt den Server dns. Öffne die Konsole des clients und schau dir Anfrage und Antwort im Paketinspektor an.</p>',
        presets: { client: ['dig @10.20.0.53 web.lab', 'dig @10.20.0.53 gibtsnicht.lab', 'nc -u 10.20.0.53 5353'], dns: ['ss -tuln'] },
        goals: [
          { text: 'Frage mit dig den Server 10.20.0.53 nach web.lab.', check: tag('client', 'dns-done', d => d.ok && d.name === 'web.lab') },
          { text: 'Klicke im Protokoll auf die DNS-Anfrage und klappe sie im Paketinspektor auf.', check: inspected(isDns) },
          { text: 'Welchen Quell-Port hat die Anfrage des clients?', ask: true,
            expect: sim => sim.log.filter(e => e.dev === 'client' && e.kind === 'send' && e.frame && isDns(e.frame) && !e.frame.payload.l4.payload.qr).map(e => String(e.frame.payload.l4.sport)) },
          { text: 'Frage nach einem Namen, den es nicht gibt. Welchen Status meldet dig?', ask: true, expect: () => ['nxdomain'] },
          { text: 'Sende mit nc -u ein UDP-Datagramm an einen Port, auf dem dns nicht lauscht.', check: tag('dns', 'port-unreachable-sent') }],
        hints: ['Der Status steht in der Zeile ->>HEADER<<- der Ausgabe von dig.'],
        outro: '<p>Auf den geschlossenen Port antwortet dns mit ICMP Port Unreachable. Der Client erfährt so, dass dort niemand lauscht. Ohne diese Meldung, zum Beispiel weil eine Firewall sie verwirft, sieht ein geschlossener UDP-Port genau gleich aus wie ein verlorenes Paket.</p>' }
    ] },

    { id: 'm5-l3', title: 'TCP: der Drei-Wege-Handshake', minutes: 18, steps: [
      { type: 'theory', title: 'Zuverlässig über ein unzuverlässiges Netz', html: `
<p>TCP macht aus einzelnen IP-Paketen einen zuverlässigen <b>Bytestrom</b>: Jedes Byte wird nummeriert, der Empfänger bestätigt, was er bekommen hat, und Fehlendes wird neu gesendet. Bevor Daten fliessen, einigen sich beide Seiten auf ihre Startnummern.</p>
${bar([['Ports', '4', 'tcp', 1], ['Sequenznummer', '4', 'tcp', 1.2], ['Bestätigung', '4', 'tcp', 1.2], ['Länge, Flags', '2', 'tcp', 1], ['Fenster', '2', 'tcp', .8], ['Prüfsumme, Urgent', '4', 'tcp', 1.1], ['Optionen', '0 bis 40', 'tcp', 1], ['Daten', '', 'data', 1.6]], 'Mindestens 20 Byte Header, mit Optionen bis 60 Byte.')}
<table><tr><th>Flag</th><th>Bedeutung</th></tr>
<tr><td>SYN</td><td>Verbindung aufbauen, Startnummer festlegen</td></tr>
<tr><td>ACK</td><td>Das Bestätigungsfeld ist gültig. Ab dem zweiten Segment immer gesetzt.</td></tr>
<tr><td>PSH</td><td>Daten sofort an die Anwendung geben</td></tr>
<tr><td>FIN</td><td>Ich sende nichts mehr, sauberes Ende</td></tr>
<tr><td>RST</td><td>Abbruch: Port geschlossen oder Verbindung unbekannt</td></tr></table>
<h2>Auf- und Abbau</h2>
<pre>client                                 web:80
  SYN       seq=1000          MSS 1460  →          LISTEN
            ←  SYN, ACK  seq=5000 ack=1001  MSS 1460
  ACK       seq=1001 ack=5001           →          ESTABLISHED
  PSH, ACK  GET / HTTP/1.1 (78 Byte)    →
            ←  ACK, Daten: HTTP/1.1 200 OK …
  FIN, ACK                              →
            ←  FIN, ACK
  ACK                                   →          geschlossen</pre>
<p>SYN und FIN zählen wie ein Byte, deshalb bestätigt der Server die 1000 mit 1001. Die Startnummern sind zufällig, damit niemand fremde Segmente in eine Verbindung einschleusen kann. Im SYN steht auch die <b>MSS</b> (Maximum Segment Size): wie viele Byte Daten ein Segment höchstens tragen darf, normalerweise MTU minus 40.</p>
${note('Ein Router liest von all dem nichts. Für ihn ist ein TCP-Segment ein IP-Paket wie jedes andere. Nur Firewalls mit Zustandsverfolgung und Load Balancer schauen auf Ports und Flags.')}` },
      { type: 'label', title: 'Beschrifte den TCP-Header', distractors: ['TTL', 'VNI', 'Länge (UDP)'],
        rows: [[{ label: 'Quell-Port', size: '16 Bit', kind: 'tcp', w: 200 }, { label: 'Ziel-Port', size: '16 Bit', kind: 'tcp', w: 200 }],
          [{ label: 'Sequenznummer', size: '32 Bit', kind: 'tcp', w: 406 }],
          [{ label: 'Bestätigungsnummer', size: '32 Bit', kind: 'tcp', w: 406 }],
          [{ label: 'Header-Länge', size: '4 Bit', kind: 'tcp', w: 100 }, { label: 'Flags', size: '12 Bit', kind: 'tcp', w: 96 }, { label: 'Fenster', size: '16 Bit', kind: 'tcp', w: 200 }],
          [{ label: 'Prüfsumme', size: '16 Bit', kind: 'tcp', w: 200 }, { label: 'Urgent Pointer', size: '16 Bit', kind: 'tcp', w: 200 }]],
        explain: 'Das Fenster sagt, wie viele Byte der Empfänger noch aufnehmen kann. Damit bremst er einen zu schnellen Sender (Flusskontrolle).' },
      { type: 'stack', title: 'Bringe die Segmente in die richtige Reihenfolge', hint: 'Oben steht das erste Segment einer kurzen HTTP-Verbindung.',
        items: [{ name: 'client → web: SYN', kind: 'tcp' }, { name: 'web → client: SYN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' },
          { name: 'client → web: PSH, ACK mit GET /', kind: 'data' }, { name: 'web → client: ACK mit HTTP/1.1 200 OK', kind: 'data' },
          { name: 'client → web: FIN, ACK', kind: 'tcp' }, { name: 'web → client: FIN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' }] },
      { type: 'build', title: 'Baue das erste Segment', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'http'],
        task: '<p>Der <b>client</b> (10.10.0.10) öffnet eine Verbindung zum Webserver <b>web</b> (10.20.0.80, Port 80) in einem anderen Subnetz. Baue den ersten Frame dieser Verbindung, wie er das Kabel des Clients verlässt.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.80', proto: '6', ttl: '64' } },
          { block: 'tcp', fields: { sport: EPHEMERAL, dport: '80', flags: 'SYN' } }],
        explain: 'Das erste Segment trägt nur das SYN-Flag und noch keine Daten. Die HTTP-Anfrage folgt erst nach dem Handshake.' }
    ] },

    { id: 'm5-l4', title: 'TCP im Lab', minutes: 15, steps: [
      { type: 'lab', title: 'Eine Webseite abrufen', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>Rufe vom client aus die Seite <code>http://web.lab/</code> ab. curl löst dabei zuerst den Namen über DNS auf und baut dann die TCP-Verbindung auf. Dreh das Tempo herunter und verfolge die Segmente.</p>',
        presets: { client: ['curl http://web.lab/', 'curl http://10.20.0.80/'], web: ['ss -tuln', 'ss -tan'] },
        goals: [
          { text: 'Rufe http://web.lab/ ab.', check: tag('client', 'tcp-done', d => d.ok && d.mode === 'http') },
          { text: 'Klicke auf das erste SYN-Segment und schau dir die Optionen an.', check: inspected(isTcpSyn) },
          { text: 'Welche MSS kündigt der client im SYN an?', ask: true, expect: () => ['1460'] },
          { text: 'In wie vielen Segmenten schickt web die Antwort?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-response').map(e => String(e.data.segments)) },
          { text: 'Welche Flags hat das zweite Segment des Handshakes?', ask: true, expect: () => ['syn, ack', 'syn,ack', 'syn ack', 'syn/ack', 'synack', 'syn-ack', 'ack, syn', 'ack,syn'] }],
        hints: ['Im Protokoll heissen die Segmente SYN, SYN/ACK und so weiter. Filtere auf «Nur client».', 'Die Antwort ist 3000 Byte gross. Rechne mit der MSS.'],
        outro: '<p>Die Antwort von 3000 Byte passt nicht in ein Segment: web teilt sie nach der MSS auf. Der client bestätigt jedes Segment. In echten Netzen bestätigt er oft nur jedes zweite (Delayed ACK), und der Sender schickt mehrere Segmente, ohne auf Bestätigungen zu warten (Fenster).</p>' }
    ] },

    { id: 'm5-l5', title: 'Abgelehnt, gefiltert, verboten', minutes: 15, steps: [
      { type: 'theory', title: 'Drei Arten, wie eine Verbindung scheitert', html: `
<table><tr><th>Was du siehst</th><th>Was passiert ist</th><th>Typische Ursache</th></tr>
<tr><td><code>Connection refused</code> sofort</td><td>Auf das SYN kam ein RST zurück</td><td>Auf dem Port lauscht nichts, oder eine Firewall lehnt mit RST ab</td></tr>
<tr><td><code>timed out</code> nach Sekunden</td><td>Auf das SYN kam gar nichts zurück, der Client wiederholt es mehrmals</td><td>Eine Firewall verwirft still (DROP), oder der Host ist weg</td></tr>
<tr><td><code>No route to host</code> oder <code>prohibited</code></td><td>Ein ICMP-Fehler kam zurück</td><td>Kein ARP für das Ziel, oder eine Firewall lehnt mit ICMP ab</td></tr></table>
<p><code>nc -zv host port</code> testet nur den Verbindungsaufbau und eignet sich gut, um diese Fälle zu unterscheiden.</p>
${note('Eine Firewall, die mit RST ablehnt, setzt als Absender die Adresse des Servers ein. Für den Client sieht ein abgelehnter Port deshalb genau gleich aus wie ein geschlossener. Erst das Protokoll der Firewall oder ein Mitschnitt auf beiden Seiten zeigt den Unterschied.')}
${note('DROP oder REJECT? DROP verrät weniger, lässt aber jeden Client bis zum Timeout warten. Für interne Netze ist REJECT oft freundlicher, an der Grenze zum Internet verwendet man meist DROP.')}` },
      { type: 'lab', title: 'Finde heraus, was die Verbindung stoppt', topo: () => servicesTopo({ acl: [
        { action: 'drop', proto: 'tcp', port: 80, src: 'any', dst: '10.20.0.80/32' },
        { action: 'reject', proto: 'tcp', port: 443, src: 'any', dst: '10.20.0.80/32' }] }), edit: 'config',
        intro: '<p>Ein Kollege meldet: «web.lab geht nicht». Auf web laufen HTTP (80) und HTTPS (443), SSH (22) ist nicht installiert. Untersuche vom client aus die drei Ports.</p>',
        presets: { client: ['nc -zv 10.20.0.80 22', 'nc -zv 10.20.0.80 80', 'nc -zv 10.20.0.80 443', 'curl http://web.lab/'], web: ['ss -tuln'] },
        goals: [
          { text: 'Teste Port 22. Die Verbindung wird sofort abgelehnt.', check: tag('client', 'tcp-refused', d => d.port === 22) },
          { text: 'Teste Port 80. Diesmal läuft die Verbindung in einen Timeout.', check: tag('client', 'tcp-timeout', d => d.port === 80) },
          { text: 'Teste Port 443. Auch hier: refused, obwohl der Dienst läuft.', check: tag('client', 'tcp-refused', d => d.port === 443) },
          { text: 'Welches Gerät hat das RST für Port 443 tatsächlich gesendet?', ask: true, expect: () => ['r1'] },
          { text: 'Ändere die Regeln auf r1 so, dass HTTP zu web erlaubt ist, und rufe http://web.lab/ ab.', check: tag('client', 'tcp-done', d => d.ok && d.port === 80 && d.mode === 'http') }],
        hints: ['Wie oft hat der client bei Port 80 sein SYN gesendet? Das Protokoll zeigt es.', 'Bei r1 unter Konfiguration findest du die Regeln. Die erste passende gilt.'],
        outro: '<p>Port 22 und Port 443 sahen für den client gleich aus, die Ursache war aber eine ganz andere: einmal kein Dienst, einmal eine Regel auf r1. Das Protokoll von r1 verrät es mit «Regel 2 (ablehnen) trifft».</p>' }
    ] },

    { id: 'm5-l6', title: 'Segmente, MSS und die Path MTU', minutes: 18, steps: [
      { type: 'theory', title: 'TCP fragmentiert nicht, TCP segmentiert', html: `
<p>TCP setzt in jedem Paket das DF-Bit. Statt IP-Fragmenten verwendet es kleinere Segmente. Wie gross sie sein dürfen, handeln beide Seiten im Handshake mit der MSS aus: Jede Seite kündigt MTU ihrer Schnittstelle minus 40 an (20 IP, 20 TCP). Beide kennen aber nur ihre eigene Leitung.</p>
<pre>client ── r1 ══ MTU 1400 ══ r2 ── fw ── web
MSS im Handshake: 1460 und 1460 → web sendet Segmente mit 1500 Byte
r2 kann sie nicht weiterleiten (DF gesetzt) → ICMP Fragmentation Needed, MTU 1400 an web
web merkt sich die Path MTU und sendet die Daten erneut, jetzt mit 1360 Byte pro Segment</pre>
<p>Das ist <b>Path MTU Discovery</b> (Modul IP und Routing) aus Sicht von TCP. Kommt die ICMP-Meldung nicht an, entsteht das berüchtigte <b>PMTUD-Blackhole</b>:</p>
<table><tr><th>Symptom</th><th>Erklärung</th></tr>
<tr><td>Verbindung baut sich auf, dann hängt sie</td><td>SYN, SYN/ACK und ACK sind klein und passen, die vollen Datensegmente nicht</td></tr>
<tr><td>SSH-Login klappt, beim ersten <code>ls</code> in einem grossen Verzeichnis friert es ein</td><td>kleine Pakete gehen, grosse nicht</td></tr>
<tr><td>Webseiten laden halb</td><td>der Anfang passt in kleine Segmente, der Rest nicht</td></tr></table>
<h2>Abhilfe</h2>
<p>Die saubere Lösung: ICMP Typ 3 Code 4 nicht filtern. Wo man das nicht in der Hand hat, hilft <b>MSS Clamping</b> auf dem Router vor der engen Stelle. Er schreibt die MSS in jedem weitergeleiteten SYN herunter, dann senden beide Seiten von Anfang an kleine Segmente:</p>
<pre>iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
         -j TCPMSS --set-mss 1360</pre>
${note('Typische Stellen dafür sind VPN-Tunnel, PPPoE (MTU 1492) und VXLAN ohne Jumbo Frames im Underlay.')}` },
      { type: 'lab', title: 'Path MTU Discovery mit TCP', topo: () => tcpPathTopo(), edit: 'config',
        intro: '<p>Zwischen r1 und r2 liegt eine Strecke mit MTU 1400. Die Antwort von web ist 6000 Byte gross. Rufe sie ab und beobachte, wie web seine Segmente anpasst.</p>',
        presets: { client: ['curl http://10.0.2.80/'], web: ['ip route get 10.0.1.10'] },
        goals: [
          { text: 'Rufe http://10.0.2.80/ vom client aus ab.', check: tag('client', 'tcp-done', d => d.ok) },
          { text: 'Welcher Router hat ICMP Fragmentation Needed gesendet?', ask: true, expect: sim => sim.log.filter(e => e.tag === 'frag-needed-sent').map(e => e.dev) },
          { text: 'Mit welcher MSS sendet web die Daten erneut?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-retransmit').map(e => String(e.data.mss)) }],
        outro: '<p>web hat in der Konsole mit <code>ip route get 10.0.1.10</code> nun auch einen Eintrag <code>cache mtu 1400</code>. So merkt sich Linux die Path MTU pro Ziel.</p>' },
      { type: 'lab', title: 'Das Blackhole und MSS Clamping', topo: () => tcpPathTopo({ fwAcl: [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }), edit: 'config',
        intro: '<p>Jemand hat auf fw sämtliches ICMP gesperrt. Rufe die Seite erneut ab und vergleiche. Behebe das Problem danach, ohne die Regel auf fw anzufassen.</p>',
        presets: { client: ['curl http://10.0.2.80/'], r1: ['show ip route'] },
        goals: [
          { text: 'Rufe http://10.0.2.80/ ab. Die Verbindung steht, aber die Daten kommen nicht an.', check: tag('client', 'tcp-stalled') },
          { text: 'Wurde der Drei-Wege-Handshake abgeschlossen? (ja oder nein)', ask: true, expect: () => ['ja'] },
          { text: 'Stelle auf r1 MSS Clamping ein, sodass die Segmente durch die enge Stelle passen, und rufe die Seite erneut ab.', check: tcpDoneAfter('tcp-stalled') }],
        hints: ['MSS Clamping findest du bei r1 unter Konfiguration, unter IP-Forwarding.', 'MTU 1400 minus 40 Byte für IP und TCP.'],
        outro: '<p>Mit MSS Clamping kündigt der client im SYN nur noch 1360 an, und auch das SYN/ACK von web wird auf dem Rückweg angepasst. Keine Seite sendet mehr ein zu grosses Segment, ICMP wird gar nicht gebraucht.</p>' }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/engine.js" <<'__PACKETPILOT_FILE_END__'
// PacketPilot Simulations-Engine: ereignisgesteuert, ohne DOM
import { BCAST, VXLAN_PORT, PROTO, STP_MAC, isGroupMac, macFor, inNet, parseCidr, isIp,
  netOf, intToIp, hashFlow, framePayloadLen, clone, IP_HDR, ICMP_HDR, TCP_HDR } from './net.js';
import { ethFrame, arpPacket, ipPacket, icmp, udp, tcp, ipChecksum, summary, icmpName, fmtBid } from './packets.js';

export const PORTS = {
  pc: ['eth1'], server: ['eth1'],
  router: ['eth1', 'eth2', 'eth3', 'eth4'],
  switch: ['eth1', 'eth2', 'eth3', 'eth4', 'eth5', 'eth6', 'eth7', 'eth8'],
  vtep: ['eth1', 'eth2', 'eth3', 'eth4']
};
export const TYPE_NAMES = { pc: 'PC', server: 'Server', router: 'Router', switch: 'Switch', vtep: 'VTEP' };

const T = { linkDelay: 0.1, arpTimeout: 1000, arpRetries: 3, pingInterval: 1000, replyTimeout: 4000, reachable: 30000,
  nudDelay: 5000, nudProbes: 3, tcpSyn: [1000, 2000, 4000], tcpStall: 10000, dnsTimeout: 5000, loopHalt: 8 };
export const TIMING = T;
export const STP_PRESETS = { standard: { hello: 2, fwd: 15, maxAge: 20 }, schnell: { hello: 1, fwd: 4, maxAge: 6 } };

// ---------------------------------------------------------------- Simulation
export class Sim {
  constructor(topo) {
    this.topo = topo;
    topo.zones ??= [];
    this.time = 0; this.queue = []; this.seq = 0; this.inflight = []; this.log = []; this.logSeq = 0;
    this.listeners = new Set(); this.devices = new Map(); this.halted = null; this.rnd = 12345;
    for (const d of topo.devices) this._mk(d);
    for (const d of this.devices.values()) d.start?.();
  }
  random() { this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) >>> 0; return this.rnd / 4294967296; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  _mk(cfg) {
    normalizeDevice(cfg);
    const C = { pc: Host, server: Host, router: Router, switch: Switch, vtep: Vtep }[cfg.type];
    const d = new C(this, cfg);
    this.devices.set(cfg.id, d);
    return d;
  }
  dev(idOrName) { return this.devices.get(idOrName) || [...this.devices.values()].find(d => d.name === idOrName); }
  addDevice(cfg) { this.topo.devices.push(cfg); const d = this._mk(cfg); d.start?.(); this.emit('topology'); return d; }
  removeDevice(id) {
    const gone = this.topo.links.filter(l => l.a.dev === id || l.b.dev === id);
    this.topo.links = this.topo.links.filter(l => !gone.includes(l));
    this.topo.devices = this.topo.devices.filter(d => d.id !== id);
    this.devices.get(id)?.stop?.();
    this.devices.delete(id);
    this.inflight = this.inflight.filter(f => f.from !== id && f.to !== id);
    for (const l of gone) this._linkNotify(l, false);
    this.emit('topology');
  }
  addLink(cfg) { cfg.mtu ??= 1500; cfg.up ??= true; this.topo.links.push(cfg); this._linkNotify(cfg, cfg.up); this.emit('topology'); return cfg; }
  removeLink(id) {
    const l = this.topo.links.find(x => x.id === id);
    this.topo.links = this.topo.links.filter(x => x.id !== id);
    this.inflight = this.inflight.filter(f => f.link.id !== id);
    if (l) this._linkNotify(l, false);
    this.emit('topology');
  }
  setLinkUp(l, up) {
    if (l.up === up) return;
    l.up = up;
    if (!up) this.inflight = this.inflight.filter(f => f.link !== l);
    const A = this.devices.get(l.a.dev), B = this.devices.get(l.b.dev);
    this.record(A, up ? 'info' : 'err', `Link ${A?.name} ${l.a.if} ↔ ${B?.name} ${l.b.if} ist ${up ? 'wieder aktiv' : 'unterbrochen'}`, { tag: up ? 'link-up' : 'link-down' });
    this._linkNotify(l, up);
    this.emit('topology');
  }
  _linkNotify(l, up) {
    for (const end of [l.a, l.b]) this.devices.get(end.dev)?.onLink?.(end.if, up);
  }
  configChanged(devId) { this.devices.get(devId)?.onConfig?.(); this.emit('config', devId); }
  linkAt(devId, ifname) {
    return this.topo.links.find(l => (l.a.dev === devId && l.a.if === ifname) || (l.b.dev === devId && l.b.if === ifname));
  }
  mtuOf(devId, ifname) { const l = this.linkAt(devId, ifname); return l ? l.mtu : 1500; }
  freePort(devId) { const d = this.devices.get(devId); return PORTS[d.cfg.type].find(p => !this.linkAt(devId, p)) || null; }

  schedule(delay, fn) {
    const ev = { t: this.time + Math.max(0, delay), n: this.seq++, fn };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > ev.t || (this.queue[i - 1].t === ev.t && this.queue[i - 1].n > ev.n))) i--;
    this.queue.splice(i, 0, ev);
    return ev;
  }
  cancel(ev) { if (!ev) return; const i = this.queue.indexOf(ev); if (i >= 0) this.queue.splice(i, 1); }
  nextTime() { return this.queue.length && !this.halted ? this.queue[0].t : null; }
  step() {
    if (this.halted) return false;
    const ev = this.queue.shift();
    if (!ev) return false;
    this.time = Math.max(this.time, ev.t);
    ev.fn();
    this.emit('tick');
    return true;
  }
  runUntil(t) {
    let n = 0;
    while (!this.halted && this.queue.length && this.queue[0].t <= t && n < 50000) { this.step(); n++; }
    if (!this.halted) this.time = Math.max(this.time, t);
    return n;
  }
  runFor(ms) { return this.runUntil(this.time + ms); }
  runToIdle(maxMs = 120000) {
    const end = this.time + maxMs;
    let n = 0;
    while (!this.halted && this.queue.length && this.queue[0].t <= end && n < 400000) { this.step(); n++; }
    return n;
  }
  reset() {
    this.queue = []; this.inflight = []; this.log = []; this.time = 0; this.halted = null;
    for (const d of this.devices.values()) d.resetState();
    for (const d of this.devices.values()) d.start?.();
    this.emit('reset');
  }
  halt(dev, text) {
    if (this.halted) return;
    this.record(dev, 'err', text, { tag: 'storm' });
    this.halted = { dev: dev.name, text, t: this.time };
    this.emit('halted', this.halted);
  }

  transmit(dev, ifname, frame) {
    const link = this.linkAt(dev.id, ifname);
    const quiet = frame.type === 'stp';
    if (!link) { if (!quiet) this.record(dev, 'drop', `${ifname} ist nicht verbunden, Frame geht verloren`, { frame }); return; }
    if (!link.up) { if (!quiet) this.record(dev, 'drop', `Link an ${ifname} ist unterbrochen, Frame geht verloren`, { frame, tag: 'link-down-drop' }); return; }
    const plen = framePayloadLen(frame);
    if (plen > link.mtu) {
      this.record(dev, 'drop', `Frame passt nicht durch den Link an ${ifname} (Nutzlast ${plen} > MTU ${link.mtu}), still verworfen`, { frame, tag: 'link-mtu-drop' });
      return;
    }
    const peer = link.a.dev === dev.id && link.a.if === ifname ? link.b : link.a;
    const f = clone(frame);
    const fl = { id: f.id + ':' + this.seq, frame: f, link, from: dev.id, fromIf: ifname, to: peer.dev, toIf: peer.if, t0: this.time, t1: this.time + T.linkDelay };
    this.inflight.push(fl);
    this.record(dev, 'send', `sendet über ${ifname}: ${summary(f)}`, { frame: f, tag: quiet ? 'bpdu-sent' : null });
    this.schedule(T.linkDelay, () => {
      this.inflight = this.inflight.filter(x => x !== fl);
      const target = this.devices.get(peer.dev);
      if (!target || !this.topo.links.includes(link) || !link.up) return;
      target.receive(peer.if, f);
    });
  }

  record(dev, kind, text, extra = {}) {
    const e = { seq: ++this.logSeq, t: this.time, dev: dev ? dev.name : '', devId: dev ? dev.id : null, kind, text,
      tag: extra.tag || null, data: extra.data || null, frame: extra.frame ? clone(extra.frame) : null,
      trace: extra.frame ? traceOf(extra.frame) : (extra.trace ?? null), stp: extra.frame?.type === 'stp' || (extra.tag || '').startsWith('stp') || extra.tag === 'bpdu-sent' };
    this.log.push(e);
    if (this.log.length > 5000) this.log.splice(0, this.log.length - 5000);
    this.emit('log', e);
    return e;
  }
  print(dev, text) {
    dev.consoleLines.push(text);
    if (dev.consoleLines.length > 500) dev.consoleLines.shift();
    this.emit('console', { devId: dev.id, text });
  }
  hasTag(tag, pred = () => true) { return this.log.some(e => e.tag === tag && pred(e.data || {}, e)); }
}

export function traceOf(f) {
  if (!f || f.type !== 'ipv4') return null;
  const l4 = f.payload.l4;
  if (l4?.kind === 'udp' && l4.payload?.kind === 'vxlan') return traceOf(l4.payload.frame) ?? f.payload.trace;
  return f.payload.trace;
}

const DEFAULT_SERVICES = { server: [{ proto: 'tcp', port: 80, name: 'http', size: 2000 }, { proto: 'tcp', port: 22, name: 'ssh', size: 40 }], pc: [] };
export function normalizeDevice(cfg) {
  const t = cfg.type;
  cfg.ifaces ??= {};
  if (t === 'pc' || t === 'server') {
    cfg.ifaces.eth1 ??= { ip: '', prefix: 24, vlan: null };
    cfg.gw ??= '';
    cfg.services ??= clone(DEFAULT_SERVICES[t]);
    cfg.dns ??= [];
    cfg.resolver ??= '';
  }
  if (t === 'router') {
    for (const p of PORTS.router) cfg.ifaces[p] ??= { ip: '', prefix: 24 };
    cfg.ifaces.lo ??= { ip: '', prefix: 32 };
    cfg.routes ??= []; cfg.acl ??= []; cfg.forwarding ??= true;
  }
  if (t === 'switch') {
    cfg.ports ??= {};
    for (const p of PORTS.switch) cfg.ports[p] = { mode: 'access', vlan: 1, allowed: '1-4094', native: 1, edge: false, cost: 4, ...(cfg.ports[p] || {}) };
    cfg.ageing ??= 300;
    cfg.stp = { enabled: false, priority: 32768, timers: 'standard', ...(cfg.stp || {}) };
  }
  if (t === 'vtep') {
    cfg.ifaces.eth1 ??= { ip: '', prefix: 24 };
    cfg.ifaces.lo ??= { ip: '', prefix: 32 };
    cfg.routes ??= []; cfg.vxlans ??= [];
    cfg.ports ??= {};
    for (const p of ['eth2', 'eth3', 'eth4']) cfg.ports[p] ??= { mode: 'access', vlan: 10, allowed: '1-4094', native: 1 };
    cfg.ageing ??= 300;
  }
  return cfg;
}

export function parseVlanList(s) {
  const out = new Set();
  for (const part of String(s ?? '').split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (b - a > 5000) continue;
    for (let i = a; i <= b; i++) if (i >= 1 && i <= 4094) out.add(i);
  }
  return out;
}

// ---------------------------------------------------------------- Geräte
class Device {
  constructor(sim, cfg) { this.sim = sim; this.cfg = cfg; this.id = cfg.id; this.consoleLines = []; }
  get name() { return this.cfg.name; }
  get type() { return this.cfg.type; }
  mac(ifname) {
    const base = this.cfg.ifaces?.[ifname]?.parent || ifname;
    return this.cfg.macs?.[base] || macFor(this.id + '/' + base);
  }
  record(kind, text, extra) { return this.sim.record(this, kind, text, extra); }
  print(text) { this.sim.print(this, text); }
  resetState() { this.consoleLines = []; this.l3?.resetState(); this.bridge?.resetState(); }
  transmit(ifname, frame) { this.sim.transmit(this, ifname, frame); }
}

let ISN = 1000;
const nextIsn = sim => (Math.floor(sim.random() * 4e9) + (ISN += 64000)) >>> 0;

// ---------------------------------------------------------------- Layer 3
class L3 {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.resetState(); }
  resetState() {
    this.arp = new Map(); this.pending = new Map(); this.pmtu = new Map();
    this.reasm = new Map(); this.sessions = new Set(); this.tcp = new Map();
  }
  get cfg() { return this.dev.cfg; }
  get forwarding() { return this.cfg.type === 'router' ? this.cfg.forwarding !== false : false; }
  ifaces() {
    return Object.entries(this.cfg.ifaces || {})
      .filter(([, v]) => v && isIp(v.ip))
      .map(([name, v]) => ({ name, ip: v.ip, prefix: Number(v.prefix ?? 24), vlan: v.vlan ? Number(v.vlan) : null, phys: v.parent || name }));
  }
  phys(ifname) { return this.cfg.ifaces?.[ifname]?.parent || ifname; }
  logicalFor(phys, vid) {
    for (const [k, v] of Object.entries(this.cfg.ifaces || {})) {
      if ((v.parent || k) !== phys) continue;
      if (Number(v.vlan || 0) === (vid || 0)) return k;
    }
    return null;
  }
  isOwn(ip) { return this.ifaces().some(i => i.ip === ip); }
  ifIp(ifname) { return this.ifaces().find(i => i.name === ifname)?.ip || null; }
  mtu(ifname) { return ifname === 'lo' ? 65536 : this.sim.mtuOf(this.dev.id, this.phys(ifname)); }
  linkUp(ifname) { if (ifname === 'lo') return true; const l = this.sim.linkAt(this.dev.id, this.phys(ifname)); return !!l && l.up; }

  routes() {
    const out = [];
    for (const i of this.ifaces()) {
      if (i.name === 'lo') continue;
      out.push({ net: intToIp(netOf(i.ip, i.prefix)), len: i.prefix, via: null, dev: i.name, proto: 'C', src: i.ip });
    }
    const statics = [...(this.cfg.routes || [])];
    if ((this.cfg.type === 'pc' || this.cfg.type === 'server') && isIp(this.cfg.gw)) statics.push({ dst: 'default', via: this.cfg.gw, auto: true });
    for (const r of statics) {
      const p = parseCidr(r.dst);
      if (!p || !isIp(r.via)) continue;
      const nh = out.find(c => c.proto === 'C' && inNet(r.via, c.net, c.len));
      out.push({ net: p.net, len: p.len, via: r.via, dev: nh ? nh.dev : null, proto: 'S', active: !!nh, auto: r.auto });
    }
    return out;
  }
  lookup(dst) {
    let best = null;
    for (const r of this.routes()) {
      if (r.proto === 'S' && !r.dev) continue;
      if (!inNet(dst, r.net, r.len)) continue;
      if (!best || r.len > best.len || (r.len === best.len && best.proto === 'S' && r.proto === 'C')) best = r;
    }
    return best;
  }
  srcFor(dst) {
    const r = this.lookup(dst);
    if (r) return this.ifIp(r.dev) || this.ifaces()[0]?.ip;
    return this.ifaces()[0]?.ip || '0.0.0.0';
  }

  // ---- Senden
  output(pkt, ctx = {}) {
    if (this.isOwn(pkt.dst)) { this.sim.schedule(0.01, () => this.deliver(pkt, 'lo')); return { ok: true }; }
    const r = this.lookup(pkt.dst);
    if (!r) {
      if (ctx.forwarded) {
        this.dev.record('drop', `keine Route zu ${pkt.dst}, sendet ICMP Network Unreachable an ${pkt.src}`, { tag: 'no-route', data: { dst: pkt.dst } });
        this.icmpError(pkt, 3, 0);
      } else this.dev.record('err', `keine Route zu ${pkt.dst}: Network is unreachable`, { tag: 'no-route', data: { dst: pkt.dst } });
      return { ok: false, error: 'Network is unreachable' };
    }
    const mtu = this.mtu(r.dev);
    if (pkt.totalLength > mtu) {
      if (pkt.df) {
        if (ctx.forwarded) {
          this.dev.record('drop', `Paket (${pkt.totalLength} Byte) grösser als MTU ${mtu} von ${r.dev} und DF gesetzt: verworfen, ICMP Fragmentation Needed an ${pkt.src}`, { tag: 'frag-needed-sent', data: { mtu } });
          this.icmpError(pkt, 3, 4, { mtu });
        }
        return { ok: false, error: `message too long, mtu=${mtu}`, mtu };
      }
      const frags = this.fragment(pkt, mtu);
      this.dev.record('info', `Paket (${pkt.totalLength} Byte) grösser als MTU ${mtu}: zerlegt in ${frags.length} Fragmente`, { tag: 'fragmented', data: { count: frags.length, mtu } });
      for (const f of frags) this.l2send(f, r.dev, r.via || pkt.dst);
      return { ok: true };
    }
    this.l2send(pkt, r.dev, r.via || pkt.dst);
    return { ok: true };
  }
  fragment(pkt, mtu) {
    const total = pkt.totalLength - IP_HDR;
    const chunk = Math.floor((mtu - IP_HDR) / 8) * 8;
    const base = pkt.fragOffset || 0;
    const isFirstSrc = !pkt.frag || pkt.frag.first;
    const origL4 = pkt.l4 || pkt.frag?.origL4;
    const fullTotal = pkt.frag ? pkt.frag.total : total;
    const out = [];
    for (let off = 0; off < total; off += chunk) {
      const len = Math.min(chunk, total - off);
      const last = off + len >= total;
      const first = isFirstSrc && off === 0;
      const f = { ...clone(pkt), fragOffset: base + off, mf: last ? pkt.mf : true,
        l4: first ? clone(origL4) : null, frag: { first, len, total: fullTotal, origL4: clone(origL4) } };
      f.totalLength = IP_HDR + len;
      f.checksum = ipChecksum(f);
      out.push(f);
    }
    return out;
  }
  l2send(pkt, egress, nh) {
    const e = this.arp.get(nh);
    if (e && e.mac && e.ifname === egress && e.state !== 'INCOMPLETE' && e.state !== 'FAILED') {
      this.sendFrame(egress, e.mac, 'ipv4', pkt);
      this.nudCheck(nh, e);
      return;
    }
    if (!this.pending.has(nh)) this.pending.set(nh, []);
    this.pending.get(nh).push({ pkt, egress });
    if (!e || e.state !== 'INCOMPLETE') this.startArp(nh, egress);
  }
  sendFrame(egress, dstMac, type, payload) {
    const c = this.cfg.ifaces?.[egress];
    const phys = c?.parent || egress;
    const vlanId = c?.vlan;
    const frame = ethFrame(this.dev.mac(phys), dstMac, type, payload, vlanId ? { vid: Number(vlanId), pcp: 0 } : null);
    this.dev.transmit(phys, frame);
  }
  startArp(nh, egress) {
    const myIp = this.ifIp(egress);
    const entry = { mac: null, ifname: egress, t: this.sim.time, state: 'INCOMPLETE', tries: 0 };
    this.arp.set(nh, entry);
    const ask = () => {
      if (this.arp.get(nh) !== entry || entry.mac) return;
      if (entry.tries >= T.arpRetries) {
        entry.state = 'FAILED';
        this.dev.record('err', `keine ARP-Antwort von ${nh} nach ${T.arpRetries} Versuchen`, { tag: 'arp-failed', data: { ip: nh } });
        const q = this.pending.get(nh) || [];
        this.pending.delete(nh);
        for (const { pkt } of q) {
          if (this.isOwn(pkt.src)) for (const s of [...this.sessions]) s.onArpFail?.(pkt);
          else this.icmpError(pkt, 3, 1);
        }
        return;
      }
      entry.tries++;
      this.dev.record('info', `kennt die MAC von ${nh} nicht und fragt per ARP (Versuch ${entry.tries})`, { tag: 'arp-request-sent', data: { ip: nh } });
      this.sendFrame(egress, BCAST, 'arp', arpPacket(1, this.dev.mac(egress), myIp, null, nh));
      this.sim.schedule(T.arpTimeout, ask);
    };
    ask();
  }
  // Neighbor Unreachability Detection: veraltete Einträge prüfen
  nudCheck(nh, e) {
    if (this.sim.time - e.t <= T.reachable || e.probing) return;
    e.probing = true; e.state = 'DELAY';
    this.sim.schedule(T.nudDelay, () => {
      if (this.arp.get(nh) !== e) return;
      if (this.sim.time - e.t <= T.reachable) { e.probing = false; e.state = 'REACHABLE'; return; }
      e.state = 'PROBE';
      let n = 0;
      const probe = () => {
        if (this.arp.get(nh) !== e) return;
        if (this.sim.time - e.t <= T.reachable) { e.probing = false; e.state = 'REACHABLE'; return; }
        if (n++ >= T.nudProbes) {
          this.arp.delete(nh);
          this.dev.record('err', `${nh} antwortet nicht mehr unter ${e.mac}: ARP-Eintrag gelöscht (FAILED). Das nächste Paket löst eine neue ARP-Anfrage aus.`, { tag: 'nud-failed', data: { ip: nh } });
          return;
        }
        this.dev.record('info', `prüft per Unicast-ARP, ob ${nh} noch bei ${e.mac} erreichbar ist (Probe ${n})`, { tag: 'nud-probe', data: { ip: nh } });
        this.sendFrame(e.ifname, e.mac, 'arp', arpPacket(1, this.dev.mac(e.ifname), this.ifIp(e.ifname), null, nh));
        this.sim.schedule(1000, probe);
      };
      probe();
    });
  }
  learnArp(ip, mac, ifname, how, quiet = false) {
    const old = this.arp.get(ip);
    const changed = !old || old.mac !== mac;
    this.arp.set(ip, { mac, ifname, t: this.sim.time, state: 'REACHABLE' });
    if (changed && !quiet) this.dev.record('learn', `trägt ${ip} → ${mac} in die ARP-Tabelle ein (${how})`, { tag: 'arp-learned', data: { ip, mac } });
    const q = this.pending.get(ip);
    if (q) { this.pending.delete(ip); for (const { pkt, egress } of q) this.sendFrame(egress, mac, 'ipv4', pkt); }
  }
  arpTable() {
    return [...this.arp.entries()].map(([ip, e]) => ({ ip, mac: e.mac, ifname: e.ifname,
      state: e.state === 'REACHABLE' && this.sim.time - e.t > T.reachable ? 'STALE' : e.state }));
  }

  // ---- Empfangen
  receive(phys, frame) {
    if (frame.type === 'stp') return;
    const vid = frame.vlan ? frame.vlan.vid : 0;
    const ifname = this.logicalFor(phys, vid);
    if (!ifname) {
      this.dev.record('drop', vid ? `verwirft Frame mit VLAN-Tag ${vid} auf ${phys}: kein passendes (Sub-)Interface` : `verwirft Frame ohne VLAN-Tag auf ${phys}: Interface erwartet einen Tag`,
        { frame, tag: 'vlan-mismatch' });
      return;
    }
    const myMac = this.dev.mac(phys);
    if (frame.dst !== myMac && frame.dst !== BCAST) {
      this.dev.record('ignore', `sieht einen Frame an ${frame.dst} auf ${phys}: nicht für mich, verworfen`,
        { frame, tag: 'frame-not-mine', data: { type: frame.type, kind: frame.type === 'ipv4' ? frame.payload.l4?.kind : 'arp' } });
      return;
    }
    // Erreichbarkeit bestätigen: Verkehr vom Nachbarn hält den ARP-Eintrag frisch
    for (const e of this.arp.values()) if (e.mac === frame.src && e.ifname === ifname && e.state !== 'INCOMPLETE') { e.t = this.sim.time; e.state = 'REACHABLE'; e.probing = false; }
    if (frame.type === 'arp') return this.rxArp(ifname, frame);
    if (frame.type === 'ipv4') return this.rxIp(ifname, frame.payload, frame);
  }
  rxArp(ifname, frame) {
    const a = frame.payload;
    const myIp = this.ifIp(ifname);
    const myMac = this.dev.mac(ifname);
    for (const s of [...this.sessions]) s.onArp?.(a, ifname);
    if (a.spa === a.tpa && a.spa !== '0.0.0.0') {
      if (myIp && a.spa === myIp && a.sha !== myMac) {
        this.dev.record('err', `Adresskonflikt: ${a.sha} meldet ebenfalls ${myIp}`, { frame, tag: 'ip-conflict' });
        return;
      }
      const e = this.arp.get(a.spa);
      if (e && e.mac) {
        if (e.mac !== a.sha) this.dev.record('learn', `aktualisiert ${a.spa}: ${e.mac} → ${a.sha} (Gratuitous ARP)`, { frame, tag: 'garp-updated', data: { ip: a.spa, mac: a.sha } });
        this.learnArp(a.spa, a.sha, ifname, 'Gratuitous ARP', true);
      } else this.dev.record('ignore', `Gratuitous ARP von ${a.spa}: kein Eintrag vorhanden, nichts zu aktualisieren`, { frame, tag: 'garp-ignored' });
      return;
    }
    if (a.op === 1 && a.spa === '0.0.0.0') {
      if (myIp && a.tpa === myIp) {
        this.dev.record('info', `beantwortet eine ARP-Probe: ${myIp} ist bereits vergeben`, { frame, tag: 'dad-reply' });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, '0.0.0.0'));
      }
      return;
    }
    if (a.op === 1) {
      if (myIp && a.tpa === myIp) {
        this.learnArp(a.spa, a.sha, ifname, 'aus der Anfrage gelernt');
        this.dev.record('info', `beantwortet die ARP-Anfrage: ${myIp} ist bei ${myMac}`, { tag: 'arp-reply-sent', data: { ip: myIp } });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, a.spa));
      } else this.dev.record('ignore', `ARP-Anfrage für ${a.tpa} ist nicht für mich, ignoriert`, { frame, tag: 'arp-ignored' });
    } else if (a.op === 2) {
      if (a.tpa === '0.0.0.0') return;
      if (this.arp.has(a.spa) || this.pending.has(a.spa)) this.learnArp(a.spa, a.sha, ifname, 'aus der Antwort');
      else this.dev.record('ignore', `ungefragte ARP-Antwort von ${a.spa} ignoriert`, { frame, tag: 'arp-unsolicited' });
    }
  }
  rxIp(ifname, ip, frame) {
    if (this.isOwn(ip.dst)) {
      if (ip.frag) return this.reassemble(ip, ifname);
      return this.deliver(ip, ifname, frame);
    }
    if (!this.forwarding) {
      this.dev.record('drop', `Paket an ${ip.dst} ist nicht für mich, und ich leite nicht weiter (ip_forward=0)`, { frame, tag: 'not-forwarding' });
      return;
    }
    this.forward(ip, ifname, frame);
  }
  aclMatch(ip) {
    const rules = this.cfg.acl || [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const proto = r.proto || 'any';
      const pn = { icmp: PROTO.ICMP, udp: PROTO.UDP, tcp: PROTO.TCP }[proto];
      if (proto !== 'any' && ip.proto !== pn) continue;
      if (proto === 'icmp' && r.icmpType !== undefined && r.icmpType !== '' && r.icmpType !== null) {
        if (!ip.l4 || ip.l4.type !== Number(r.icmpType)) continue;
      }
      if ((proto === 'tcp' || proto === 'udp') && r.port) {
        if (!ip.l4 || ip.l4.dport !== Number(r.port)) continue;
      }
      const s = parseCidr(r.src || 'any'), d = parseCidr(r.dst || 'any');
      if (s && !inNet(ip.src, s.net, s.len)) continue;
      if (d && !inNet(ip.dst, d.net, d.len)) continue;
      return { rule: r, index: i + 1 };
    }
    return null;
  }
  forward(ip, inIf, frame) {
    const m = this.aclMatch(ip);
    if (m && m.rule.action !== 'allow') {
      this.dev.record('drop', `Regel ${m.index} (${m.rule.action === 'reject' ? 'ablehnen' : 'verwerfen'}) trifft: Paket ${ip.src} > ${ip.dst} wird nicht weitergeleitet`, { frame, tag: 'acl-drop', data: { rule: m.index } });
      if (m.rule.action === 'reject') {
        if (ip.proto === PROTO.TCP && ip.l4?.flags?.SYN) this.sendTcp(ip.src, tcp(ip.l4.dport, ip.l4.sport, 0, ip.l4.seq + 1, { RST: true, ACK: true }), ip.dst);
        else this.icmpError(ip, 3, 13);
      }
      return;
    }
    if (ip.ttl <= 1) {
      this.dev.record('drop', `TTL von ${ip.src} > ${ip.dst} ist abgelaufen, sendet ICMP Time Exceeded an ${ip.src}`, { frame, tag: 'ttl-expired' });
      this.icmpError(ip, 11, 0);
      return;
    }
    const r = this.lookup(ip.dst);
    const out = clone(ip);
    out.ttl = ip.ttl - 1;
    const clamp = Number(this.cfg.mssClamp || 0);
    if (clamp && out.proto === PROTO.TCP && out.l4?.flags?.SYN && out.l4.mss > clamp) {
      this.dev.record('info', `passt die MSS im SYN von ${out.l4.mss} auf ${clamp} an (MSS Clamping)`, { frame, tag: 'mss-clamped', data: { from: out.l4.mss, to: clamp } });
      out.l4.mss = clamp;
    }
    out.checksum = ipChecksum(out);
    if (r) this.dev.record('fwd', `leitet ${ip.src} > ${ip.dst} weiter: Route ${r.net}/${r.len}${r.via ? ' via ' + r.via : ' direkt'} über ${r.dev}, TTL ${ip.ttl} → ${out.ttl}`,
      { frame, tag: 'forwarded', data: { dst: ip.dst, route: `${r.net}/${r.len}`, from: inIf, to: r.dev } });
    this.output(out, { forwarded: true, inIf });
  }
  icmpError(orig, type, code, extra = {}) {
    if (orig.proto === PROTO.ICMP && orig.l4 && ![0, 8].includes(orig.l4.type)) return;
    if (orig.frag && !orig.frag.first) return;
    const src = this.srcFor(orig.src);
    const o = orig.l4 || {};
    const pkt = ipPacket({ src, dst: orig.src, proto: PROTO.ICMP,
      l4: icmp(type, code, { dataLen: 28, mtu: extra.mtu,
        orig: { src: orig.src, dst: orig.dst, proto: orig.proto, ident: o.ident, seq: o.seq, sport: o.sport, dport: o.dport } }) });
    this.output(pkt, {});
  }
  reassemble(ip, ifname) {
    const key = `${ip.src}|${ip.id}`;
    let r = this.reasm.get(key);
    if (!r) { r = { parts: [], got: 0 }; this.reasm.set(key, r); }
    r.parts.push(ip); r.got += ip.frag.len;
    if (r.got >= ip.frag.total && r.parts.some(p => !p.mf)) {
      this.reasm.delete(key);
      const first = r.parts.find(p => p.frag.first) || r.parts[0];
      const full = clone(first);
      full.l4 = clone(first.frag.origL4);
      delete full.frag;
      full.mf = false; full.fragOffset = 0; full.totalLength = IP_HDR + ip.frag.total;
      this.dev.record('info', `setzt ${r.parts.length} Fragmente wieder zu einem Paket mit ${full.totalLength} Byte zusammen`, { tag: 'reassembled' });
      this.deliver(full, ifname);
    }
  }
  service(proto, port) { return (this.cfg.services || []).find(s => s.proto === proto && Number(s.port) === port); }
  deliver(ip, ifname, frame) {
    const l4 = ip.l4;
    if (!l4) return;
    if (l4.kind === 'icmp') {
      if (l4.type === 8) {
        this.dev.record('ok', `erhält Echo Request von ${ip.src} (seq ${l4.seq}) und antwortet`, { frame, tag: 'echo-request-received', data: { from: ip.src } });
        this.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.ICMP, df: ip.df, trace: ip.trace, l4: icmp(0, 0, { ident: l4.ident, seq: l4.seq, dataLen: l4.dataLen }) }), {});
        return;
      }
      if (l4.type === 0) {
        this.dev.record('ok', `erhält Echo Reply von ${ip.src} (seq ${l4.seq})`, { frame, tag: 'echo-reply-received', data: { from: ip.src, size: l4.dataLen } });
        for (const s of [...this.sessions]) s.onEchoReply?.(ip);
        return;
      }
      if (l4.type === 3 || l4.type === 11) {
        if (l4.type === 3 && l4.code === 4 && l4.mtu && l4.orig) {
          this.pmtu.set(l4.orig.dst, l4.mtu);
          this.dev.record('learn', `merkt sich: Weg zu ${l4.orig.dst} hat MTU ${l4.mtu} (Path MTU Discovery)`, { frame, tag: 'pmtu-learned', data: { mtu: l4.mtu } });
          if (l4.orig.proto === PROTO.TCP) this.tcpPmtu(l4.orig, l4.mtu);
        } else this.dev.record('err', `erhält ICMP ${icmpName(l4.type, l4.code)} von ${ip.src}`, { frame, tag: 'icmp-error-received', data: { type: l4.type, code: l4.code } });
        for (const s of [...this.sessions]) s.onIcmpError?.(ip);
      }
      return;
    }
    if (l4.kind === 'tcp') return this.onTcp(ip, frame);
    if (l4.kind === 'udp') {
      if (this.dev.onUdp?.(ip, ifname, frame)) return;
      for (const s of [...this.sessions]) if (s.onUdp?.(ip)) return;
      const svc = this.service('udp', l4.dport);
      if (svc) {
        if (l4.payload?.kind === 'dns' && !l4.payload.qr) return this.answerDns(ip, svc, frame);
        this.dev.record('ok', `empfängt ein UDP-Datagramm von ${ip.src}:${l4.sport} an Port ${l4.dport} (${svc.name || 'Dienst'})`, { frame, tag: 'udp-received', data: { port: l4.dport, from: ip.src } });
        return;
      }
      this.dev.record('info', `UDP-Port ${l4.dport} ist geschlossen, sendet ICMP Port Unreachable an ${ip.src}`, { frame, tag: 'port-unreachable-sent', data: { port: l4.dport } });
      this.icmpError(ip, 3, 3);
    }
  }
  answerDns(ip, svc, frame) {
    const q = ip.l4.payload;
    const name = q.qname.toLowerCase().replace(/\.$/, '');
    const recs = (this.cfg.dns || []).filter(r => String(r.name).toLowerCase().replace(/\.$/, '') === name && isIp(r.ip));
    const ans = { kind: 'dns', id: q.id, qr: 1, qname: q.qname, answers: recs.map(r => ({ name: q.qname, ip: r.ip })), rcode: recs.length ? 'NOERROR' : 'NXDOMAIN' };
    this.dev.record('ok', `beantwortet die DNS-Anfrage für ${q.qname}: ${recs.length ? recs.map(r => r.ip).join(', ') : 'NXDOMAIN (unbekannt)'}`, { frame, tag: 'dns-answered', data: { name: q.qname, found: !!recs.length } });
    this.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.UDP, trace: ip.trace, l4: udp(ip.l4.dport, ip.l4.sport, ans) }), {});
  }

  // ---- TCP
  sendResponse(c, mss, from) {
    const end = c.resp.start + c.resp.total;
    c.curMss = mss;
    let seq = from;
    while (seq < end) {
      const len = Math.min(mss, end - seq);
      this.sendTcp(c.rip, tcp(c.lport, c.rport, seq, c.rcvNxt, { ACK: true, PSH: seq + len >= end }, { dataLen: len, app: seq === c.resp.start ? c.resp.app : null, total: c.resp.total }), c.local);
      seq += len;
    }
    c.sndNxt = Math.max(c.sndNxt, end);
  }
  // Nach ICMP Fragmentation Needed: nicht bestätigte Daten mit kleinerer MSS neu senden
  tcpPmtu(orig, mtu) {
    for (const c of this.tcp.values()) {
      if (c.client || !c.resp || c.lport !== orig.sport || c.rip !== orig.dst || c.rport !== orig.dport) continue;
      const mss = Math.min(c.peerMss, mtu - 40);
      if (mss >= c.curMss || c.acked >= c.resp.start + c.resp.total) continue;
      this.dev.record('info', `sendet die nicht bestätigten Daten ab Byte ${c.acked - c.resp.start} neu, jetzt in Segmenten zu ${mss} Byte`, { tag: 'tcp-retransmit', data: { mss } });
      this.sendResponse(c, mss, c.acked);
    }
  }
  sendTcp(dst, seg, src) {
    seg.dataLen ??= 0;
    const pkt = ipPacket({ src: src || this.srcFor(dst), dst, proto: PROTO.TCP, df: true, l4: seg });
    return this.output(pkt, {});
  }
  mssFor(dst) { const r = this.lookup(dst); return (r ? this.mtu(r.dev) : 1500) - 40; }
  onTcp(ip, frame) {
    const s = ip.l4;
    const key = `${s.dport}|${ip.src}|${s.sport}`;
    const c = this.tcp.get(key);
    if (c?.client) return c.client.onSegment(ip, frame);
    if (!c) {
      if (s.flags.SYN && !s.flags.ACK) {
        const svc = this.service('tcp', s.dport);
        if (!svc) {
          this.dev.record('info', `kein Dienst auf TCP-Port ${s.dport}: antwortet mit RST`, { frame, tag: 'tcp-rst-sent', data: { port: s.dport } });
          this.sendTcp(ip.src, tcp(s.dport, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
          return;
        }
        const conn = { state: 'SYN_RECEIVED', lport: s.dport, rip: ip.src, rport: s.sport, iss: nextIsn(this.sim), rcvNxt: s.seq + 1, peerMss: s.mss || 536, svc, local: ip.dst };
        conn.sndNxt = conn.iss + 1;
        this.tcp.set(key, conn);
        this.dev.record('info', `Dienst ${svc.name || ''} auf Port ${s.dport} nimmt die Verbindung an: SYN/ACK`, { frame, tag: 'tcp-synack-sent', data: { port: s.dport } });
        this.sendTcp(ip.src, tcp(s.dport, s.sport, conn.iss, conn.rcvNxt, { SYN: true, ACK: true }, { mss: this.mssFor(ip.src) }), ip.dst);
        return;
      }
      if (!s.flags.RST) this.sendTcp(ip.src, tcp(s.dport, s.sport, s.ack, s.seq + (s.dataLen || 0), { RST: true, ACK: true }), ip.dst);
      return;
    }
    if (s.flags.RST) { this.tcp.delete(key); this.dev.record('info', `Verbindung zu ${ip.src}:${s.sport} durch RST beendet`, { frame, tag: 'tcp-reset' }); return; }
    if (c.state === 'SYN_RECEIVED' && s.flags.ACK && s.ack === c.sndNxt) {
      c.state = 'ESTABLISHED';
      this.dev.record('ok', `Verbindung mit ${ip.src}:${s.sport} aufgebaut (ESTABLISHED)`, { frame, tag: 'tcp-established', data: { port: c.lport } });
    }
    if (s.dataLen > 0 && s.seq === c.rcvNxt) {
      c.rcvNxt += s.dataLen;
      const total = Number(c.svc.size ?? 2000);
      const mss = Math.min(c.peerMss, this.mssFor(ip.src), (this.pmtu.get(ip.src) || 65535) - 40);
      const n = Math.max(1, Math.ceil(total / mss));
      this.dev.record('info', `erhält ${s.dataLen} Byte${s.app ? ' (' + s.app + ')' : ''} und antwortet mit ${total} Byte in ${n} Segment${n > 1 ? 'en' : ''} (MSS ${mss})`,
        { frame, tag: 'tcp-response', data: { segments: n, bytes: total, mss } });
      c.resp = { start: c.sndNxt, total, app: c.svc.name === 'http' ? `HTTP/1.1 200 OK, ${total} Byte` : c.svc.name === 'ssh' ? 'SSH-2.0-OpenSSH_9.6' : `${c.svc.name || 'Antwort'}` };
      c.acked = c.sndNxt;
      this.sendResponse(c, mss, c.sndNxt);
      return;
    }
    if (c.resp && s.flags.ACK && s.ack > (c.acked ?? 0)) c.acked = s.ack;
    if (s.flags.FIN) {
      c.rcvNxt += 1;
      this.sendTcp(ip.src, tcp(c.lport, c.rport, c.sndNxt, c.rcvNxt, { FIN: true, ACK: true }), c.local);
      c.sndNxt += 1; c.state = 'LAST_ACK';
      this.dev.record('info', `${ip.src} beendet die Verbindung: FIN/ACK zurück`, { frame, tag: 'tcp-fin' });
      return;
    }
    if (c.state === 'LAST_ACK' && s.flags.ACK && s.ack === c.sndNxt) {
      this.tcp.delete(key);
      this.dev.record('ok', `Verbindung mit ${ip.src}:${s.sport} geschlossen`, { frame, tag: 'tcp-closed' });
    }
  }
}

// ---------------------------------------------------------------- Sitzungen
let IDENT = 100;
const pad2 = n => String(n).padStart(2);
class Session {
  constructor(l3) { this.l3 = l3; this.dev = l3.dev; this.sim = l3.sim; this.done = false; }
  begin() { this.l3.sessions.add(this); }
  end() { this.done = true; this.l3.sessions.delete(this); }
}

class PingSession extends Session {
  constructor(l3, dst, o) {
    super(l3);
    Object.assign(this, { dst, count: o.count ?? 4, size: o.size ?? 56, df: !!o.df, ttl: o.ttl ?? 64, noEcho: !!o.noEcho });
    this.ident = IDENT++; this.seq = 0; this.sent = 0; this.received = 0; this.errors = 0; this.open = new Map();
  }
  start() {
    this.begin();
    if (!this.noEcho) this.dev.print(`$ ping -c ${this.count}${this.size !== 56 ? ' -s ' + this.size : ''}${this.df ? ' -M do' : ''}${this.ttl !== 64 ? ' -t ' + this.ttl : ''} ${this.dst}`);
    this.dev.print(`PING ${this.dst}: ${this.size} Byte Daten, ${IP_HDR + ICMP_HDR + this.size} Byte IP-Paket`);
    this.sendNext();
  }
  sendNext() {
    if (this.done) return;
    const seq = ++this.seq;
    const total = IP_HDR + ICMP_HDR + this.size;
    const r = this.l3.lookup(this.dst);
    if (!r && !this.l3.isOwn(this.dst)) { this.dev.print('ping: connect: Network is unreachable'); this.dev.record('err', `ping ${this.dst}: keine Route`, { tag: 'no-route' }); return this.finish(true); }
    const lim = Math.min(this.l3.pmtu.get(this.dst) || Infinity, r ? this.l3.mtu(r.dev) : 65536);
    this.sent++;
    if (this.df && total > lim) {
      this.dev.print(`ping: local error: message too long, mtu=${lim}`);
      this.dev.record('err', `Paket mit ${total} Byte und DF passt nicht (MTU ${lim}), lokal abgelehnt`, { tag: 'local-mtu-error', data: { mtu: lim } });
      this.errors++;
    } else {
      const pkt = ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, ttl: this.ttl, proto: PROTO.ICMP, df: this.df, l4: icmp(8, 0, { ident: this.ident, seq, dataLen: this.size }) });
      const t0 = this.sim.time;
      const ev = this.sim.schedule(T.replyTimeout, () => { if (this.open.has(seq)) { this.open.delete(seq); this.dev.print(`icmp_seq=${seq}: keine Antwort (Timeout)`); this.checkEnd(); } });
      this.open.set(seq, { t0, ev });
      this.l3.output(pkt, {});
    }
    if (this.seq < this.count) this.sim.schedule(T.pingInterval, () => this.sendNext());
    else this.checkEnd();
  }
  take(seq) { const o = this.open.get(seq); if (!o) return null; this.open.delete(seq); this.sim.cancel(o.ev); return o; }
  onEchoReply(ip) {
    const l4 = ip.l4;
    if (l4.ident !== this.ident) return;
    const o = this.take(l4.seq); if (!o) return;
    this.received++;
    this.dev.print(`${ICMP_HDR + l4.dataLen} Byte von ${ip.src}: icmp_seq=${l4.seq} ttl=${ip.ttl} Zeit=${(this.sim.time - o.t0).toFixed(2)} ms`);
    this.checkEnd();
  }
  onIcmpError(ip) {
    const l4 = ip.l4, o = l4.orig;
    if (!o || o.ident !== this.ident || !this.take(o.seq)) return;
    this.errors++;
    const txt = l4.type === 11 ? 'Time to live exceeded' : l4.code === 0 ? 'Destination Net Unreachable' : l4.code === 1 ? 'Destination Host Unreachable'
      : l4.code === 3 ? 'Destination Port Unreachable' : l4.code === 4 ? `Frag needed and DF set (mtu = ${l4.mtu})` : l4.code === 13 ? 'Packet filtered' : icmpName(l4.type, l4.code);
    this.dev.print(`From ${ip.src} icmp_seq=${o.seq} ${txt}`);
    this.checkEnd();
  }
  onArpFail(pkt) {
    const l4 = pkt.l4;
    if (!l4 || l4.kind !== 'icmp' || l4.ident !== this.ident || !this.take(l4.seq)) return;
    this.errors++;
    this.dev.print(`From ${pkt.src} icmp_seq=${l4.seq} Destination Host Unreachable`);
    this.checkEnd();
  }
  checkEnd() { if (this.seq >= this.count && this.open.size === 0) this.finish(); }
  finish(aborted = false) {
    if (this.done) return;
    this.end();
    const loss = this.sent ? Math.round((1 - this.received / this.sent) * 100) : 100;
    if (!aborted) { this.dev.print(`--- ${this.dst} Statistik ---`); this.dev.print(`${this.sent} gesendet, ${this.received} empfangen${this.errors ? `, ${this.errors} Fehler` : ''}, ${loss} % Verlust`); }
    this.dev.record(this.received ? 'ok' : 'err', `ping an ${this.dst} beendet: ${this.received} von ${this.sent} beantwortet`,
      { tag: 'ping-done', data: { dst: this.dst, sent: this.sent, received: this.received, size: this.size, df: this.df } });
  }
}

class TraceSession extends Session {
  constructor(l3, dst, o) { super(l3); Object.assign(this, { dst, max: o.maxHops ?? 8 }); this.ttl = 0; this.port = 33433; this.hops = []; }
  start() { this.begin(); this.dev.print(`$ traceroute -n ${this.dst}`); this.dev.print(`traceroute zu ${this.dst}, höchstens ${this.max} Hops`); this.next(); }
  next() {
    if (this.done) return;
    if (this.ttl >= this.max) return this.finish();
    this.ttl++; this.port++;
    const pkt = ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, ttl: this.ttl, proto: PROTO.UDP, l4: udp(hashFlow(this.dst + this.ttl), this.port, { kind: 'data', len: 32 }) });
    this.t0 = this.sim.time;
    const port = this.port;
    this.timer = this.sim.schedule(T.replyTimeout, () => { if (this.done || this.port !== port) return; this.dev.print(`${pad2(this.ttl)}  *`); this.hops.push('*'); this.next(); });
    const res = this.l3.output(pkt, {});
    if (!res.ok) { this.sim.cancel(this.timer); this.dev.print(`traceroute: ${res.error}`); this.finish(); }
  }
  onIcmpError(ip) {
    const l4 = ip.l4, o = l4.orig;
    if (!o || o.dport !== this.port || this.done) return;
    this.sim.cancel(this.timer);
    const rtt = (this.sim.time - this.t0).toFixed(2);
    this.hops.push(ip.src);
    if (l4.type === 11) { this.dev.print(`${pad2(this.ttl)}  ${ip.src}  ${rtt} ms`); return this.next(); }
    const mark = l4.code === 3 ? '' : l4.code === 0 ? ' !N' : l4.code === 1 ? ' !H' : l4.code === 13 ? ' !X' : ' !';
    this.dev.print(`${pad2(this.ttl)}  ${ip.src}  ${rtt} ms${mark}`);
    this.finish(l4.code === 3);
  }
  onArpFail(pkt) { if (pkt.l4?.dport !== this.port || this.done) return; this.sim.cancel(this.timer); this.dev.print(`${pad2(this.ttl)}  ${pkt.src}  !H`); this.finish(); }
  finish(reached = false) {
    if (this.done) return;
    this.end();
    this.dev.record(reached ? 'ok' : 'err', `traceroute zu ${this.dst} beendet${reached ? ', Ziel erreicht' : ''}`, { tag: 'trace-done', data: { dst: this.dst, reached, hops: this.hops.length, path: this.hops } });
  }
}

class ArpingSession extends Session {
  constructor(l3, target, o) { super(l3); Object.assign(this, { target, mode: o.mode || 'normal', count: o.count ?? (o.mode === 'normal' ? 3 : o.mode === 'dad' ? 2 : 1), ifname: o.ifname }); this.sent = 0; this.replies = 0; }
  start() {
    this.begin();
    const ifn = this.ifname || this.l3.ifaces().find(i => i.name !== 'lo')?.name;
    this.ifname = ifn;
    const myIp = this.l3.ifIp(ifn);
    if (!ifn || !myIp) { this.dev.print('arping: kein Interface mit IP-Adresse'); return this.end(); }
    const flag = { normal: '', gratuitous: '-U ', reply: '-A ', dad: '-D ' }[this.mode];
    this.dev.print(`$ arping ${flag}-c ${this.count} -I ${ifn} ${this.target}`);
    this.dev.print(`ARPING ${this.target} von ${this.mode === 'dad' ? '0.0.0.0' : myIp} ${ifn}`);
    const mac = this.dev.mac(ifn);
    const tick = () => {
      if (this.done) return;
      if (this.sent >= this.count) return this.finish();
      this.sent++;
      let pkt, label;
      if (this.mode === 'gratuitous') { pkt = arpPacket(1, mac, myIp, null, myIp); label = 'gratuitous-sent'; }
      else if (this.mode === 'reply') { pkt = arpPacket(2, mac, myIp, BCAST, myIp); label = 'gratuitous-sent'; }
      else if (this.mode === 'dad') { pkt = arpPacket(1, mac, '0.0.0.0', null, this.target); label = 'dad-sent'; }
      else { pkt = arpPacket(1, mac, myIp, null, this.target); label = 'arping-sent'; }
      this.t0 = this.sim.time;
      this.dev.record('info', this.mode === 'gratuitous' || this.mode === 'reply' ? `kündigt ${myIp} bei ${mac} ungefragt an (Gratuitous ARP)` : this.mode === 'dad' ? `prüft per ARP-Probe, ob ${this.target} schon vergeben ist` : `fragt per arping nach ${this.target}`,
        { tag: label, data: { ip: this.mode === 'dad' ? this.target : myIp } });
      this.l3.sendFrame(ifn, BCAST, 'arp', pkt);
      this.sim.schedule(1000, tick);
    };
    tick();
  }
  onArp(a) {
    if (this.done || a.op !== 2 || a.spa !== this.target || this.mode === 'gratuitous' || this.mode === 'reply') return;
    this.replies++;
    this.dev.print(`Unicast reply from ${a.spa} [${a.sha.toUpperCase()}]  ${(this.sim.time - this.t0).toFixed(2)} ms`);
  }
  finish() {
    if (this.done) return;
    this.end();
    this.dev.print(`${this.sent} Pakete gesendet${this.mode === 'gratuitous' || this.mode === 'reply' ? '' : `, ${this.replies} Antworten`}`);
    if (this.mode === 'dad') this.dev.print(this.replies ? `Adresse ${this.target} ist bereits vergeben (Konflikt).` : `Adresse ${this.target} ist frei.`);
    this.dev.record(this.mode === 'dad' && this.replies ? 'err' : 'ok', `arping beendet (${this.mode})`, { tag: 'arping-done', data: { mode: this.mode, target: this.target, replies: this.replies } });
  }
}

class TcpClient extends Session {
  constructor(l3, dst, port, mode, o = {}) {
    super(l3); Object.assign(this, { dst, port, mode, noEcho: !!o.noEcho });
    this.lport = 49152 + Math.floor(this.sim.random() * 16000); this.state = 'CLOSED'; this.bytes = 0; this.segments = 0; this.expected = null; this.tries = 0;
  }
  get tool() { return this.mode === 'probe' ? 'nc' : 'curl'; }
  start() {
    this.begin();
    if (!this.noEcho) this.dev.print(this.mode === 'probe' ? `$ nc -zv ${this.dst} ${this.port}` : `$ curl http://${this.dst}${this.port !== 80 ? ':' + this.port : ''}/`);
    if (!this.l3.lookup(this.dst) && !this.l3.isOwn(this.dst)) { this.dev.print(`${this.tool}: Network is unreachable`); return this.finish(false); }
    this.key = `${this.lport}|${this.dst}|${this.port}`;
    this.l3.tcp.set(this.key, { client: this, state: 'SYN_SENT', lport: this.lport, rip: this.dst, rport: this.port });
    this.iss = nextIsn(this.sim);
    this.state = 'SYN_SENT';
    this.syn();
  }
  conn() { return this.l3.tcp.get(this.key); }
  setState(s) { this.state = s; const c = this.conn(); if (c) c.state = s; }
  syn() {
    if (this.done || this.state !== 'SYN_SENT') return;
    if (this.tries >= T.tcpSyn.length) {
      this.dev.print(this.mode === 'probe' ? `nc: connect to ${this.dst} port ${this.port} (tcp) timed out` : `curl: (28) Failed to connect to ${this.dst} port ${this.port}: Connection timed out`);
      this.dev.record('err', `TCP-Verbindung zu ${this.dst}:${this.port}: keine Antwort auf SYN (gefiltert?)`, { tag: 'tcp-timeout', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    const wait = T.tcpSyn[this.tries++];
    this.dev.record('info', `öffnet eine TCP-Verbindung zu ${this.dst}:${this.port}: SYN${this.tries > 1 ? ' (Wiederholung ' + (this.tries - 1) + ')' : ''}`, { tag: 'tcp-syn-sent', data: { dst: this.dst, port: this.port } });
    this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.iss, 0, { SYN: true }, { mss: this.l3.mssFor(this.dst) }));
    this.t0 = this.sim.time;
    this.timer = this.sim.schedule(wait, () => this.syn());
  }
  onSegment(ip) {
    const s = ip.l4;
    if (this.done) return;
    if (s.flags.RST) {
      this.sim.cancel(this.timer);
      this.dev.print(this.mode === 'probe' ? `nc: connect to ${this.dst} port ${this.port} (tcp) failed: Connection refused` : `curl: (7) Failed to connect to ${this.dst} port ${this.port}: Connection refused`);
      this.dev.record('err', `${this.dst}:${this.port} lehnt ab (RST): Port geschlossen oder Verbindung abgelehnt`, { tag: 'tcp-refused', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    if (this.state === 'SYN_SENT' && s.flags.SYN && s.flags.ACK && s.ack === this.iss + 1) {
      this.sim.cancel(this.timer);
      this.rcvNxt = s.seq + 1; this.sndNxt = this.iss + 1; this.peerMss = s.mss;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.setState('ESTABLISHED');
      this.dev.record('ok', `Drei-Wege-Handshake mit ${this.dst}:${this.port} abgeschlossen (ESTABLISHED)`, { tag: 'tcp-established', data: { dst: this.dst, port: this.port, client: true } });
      if (this.mode === 'probe') { this.dev.print(`Connection to ${this.dst} ${this.port} port [tcp] succeeded!`); return this.close(); }
      const req = 78;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true, PSH: true }, { dataLen: req, app: 'GET / HTTP/1.1' }));
      this.sndNxt += req;
      this.armStall();
      return;
    }
    if (this.state === 'ESTABLISHED' && s.dataLen > 0 && s.seq === this.rcvNxt) {
      this.rcvNxt += s.dataLen; this.bytes += s.dataLen; this.segments++;
      if (s.total) this.expected = s.total;
      if (s.app) this.dev.print(`< ${s.app}`);
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.armStall();
      if (this.expected !== null && this.bytes >= this.expected) {
        this.dev.print(`${this.bytes} Byte in ${this.segments} Segment${this.segments > 1 ? 'en' : ''} empfangen (MSS ${Math.max(...[s.dataLen, this.firstLen || 0])})`);
        this.close();
      }
      this.firstLen ??= s.dataLen;
      return;
    }
    if (this.state === 'FIN_WAIT' && s.flags.FIN) {
      this.rcvNxt += 1;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.dev.record('ok', `Verbindung zu ${this.dst}:${this.port} sauber geschlossen`, { tag: 'tcp-closed', data: { client: true } });
      this.finish(true);
    }
  }
  armStall() {
    this.sim.cancel(this.timer);
    this.timer = this.sim.schedule(T.tcpStall, () => {
      if (this.done || this.state !== 'ESTABLISHED') return;
      this.dev.print(`curl: (28) Operation timed out after ${T.tcpStall} milliseconds with ${this.bytes} bytes received`);
      this.dev.record('err', `Verbindung zu ${this.dst}:${this.port} steht, aber die Antwort kommt nicht an (${this.bytes} Byte erhalten)`, { tag: 'tcp-stalled', data: { dst: this.dst, port: this.port, bytes: this.bytes } });
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { RST: true, ACK: true }));
      this.finish(false);
    });
  }
  close() {
    this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { FIN: true, ACK: true }));
    this.sndNxt += 1;
    this.setState('FIN_WAIT');
    this.timer = this.sim.schedule(T.replyTimeout, () => this.finish(true));
  }
  onIcmpError(ip) {
    const l4 = ip.l4, o = l4.orig;
    if (!o || o.sport !== this.lport || this.done) return;
    this.sim.cancel(this.timer);
    const txt = l4.type === 11 ? 'TTL abgelaufen' : l4.code === 13 ? 'Communication administratively prohibited' : l4.code === 3 ? 'Connection refused' : 'No route to host';
    this.dev.print(`${this.tool}: ${this.dst} port ${this.port}: ${txt} (ICMP von ${ip.src})`);
    this.finish(false);
  }
  onArpFail(pkt) {
    if (pkt.l4?.kind !== 'tcp' || pkt.l4.sport !== this.lport || this.done) return;
    this.sim.cancel(this.timer);
    this.dev.print(`${this.tool}: ${this.dst} port ${this.port}: No route to host`);
    this.finish(false);
  }
  finish(ok) {
    if (this.done) return;
    this.sim.cancel(this.timer);
    this.end();
    this.l3.tcp.delete(this.key);
    this.dev.record(ok ? 'ok' : 'err', `${this.tool} ${this.dst}:${this.port} beendet`, { tag: 'tcp-done', data: { dst: this.dst, port: this.port, ok: !!ok, bytes: this.bytes, segments: this.segments, mode: this.mode } });
  }
}

class DigSession extends Session {
  constructor(l3, server, name, then = null) { super(l3); Object.assign(this, { server, name, then }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); this.id = Math.floor(this.sim.random() * 65535); }
  print(t) { if (!this.then) this.dev.print(t); }
  start() {
    this.begin();
    this.print(`$ dig @${this.server} ${this.name}`);
    this.t0 = this.sim.time;
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.server), dst: this.server, proto: PROTO.UDP, l4: udp(this.sport, 53, { kind: 'dns', id: this.id, qr: 0, qname: this.name }) }), {});
    if (!res.ok) { this.print(`;; ${res.error}`); return this.finish(false); }
    this.dev.record('info', `fragt ${this.server} per DNS (UDP 53) nach ${this.name}`, { tag: 'dns-query', data: { name: this.name } });
    this.timer = this.sim.schedule(T.dnsTimeout, () => { this.print(';; connection timed out; no servers could be reached'); this.finish(false); });
  }
  onUdp(ip) {
    const l4 = ip.l4;
    if (this.done || l4.dport !== this.sport || l4.payload?.kind !== 'dns' || l4.payload.id !== this.id) return false;
    this.sim.cancel(this.timer);
    const d = l4.payload;
    this.print(`;; ->>HEADER<<- opcode: QUERY, status: ${d.rcode}, id: ${d.id}`);
    if (d.answers.length) { this.print(';; ANSWER SECTION:'); for (const a of d.answers) this.print(`${a.name}.\t300\tIN\tA\t${a.ip}`); }
    this.print(`;; Query time: ${(this.sim.time - this.t0).toFixed(2)} msec`);
    this.print(`;; SERVER: ${this.server}#53(UDP)`);
    this.finish(d.rcode === 'NOERROR', d);
    return true;
  }
  onIcmpError(ip) {
    const o = ip.l4.orig;
    if (!o || o.sport !== this.sport || this.done) return;
    this.sim.cancel(this.timer);
    this.print(`;; communications error to ${this.server}#53: ${ip.l4.code === 3 ? 'connection refused' : 'host unreachable'}`);
    this.finish(false);
  }
  onArpFail(pkt) { if (pkt.l4?.sport === this.sport && !this.done) { this.sim.cancel(this.timer); this.print(`;; communications error to ${this.server}#53: host unreachable`); this.finish(false); } }
  finish(ok, d) {
    if (this.done) return;
    this.end();
    const answer = d?.answers?.[0]?.ip || null;
    this.dev.record(ok ? 'ok' : 'err', ok ? `DNS: ${this.name} ist ${answer}` : `DNS-Abfrage ${this.name} ohne Ergebnis`, { tag: 'dns-done', data: { name: this.name, ok, answer } });
    if (this.then) { if (answer) this.dev.print(`${this.name} → ${answer} (DNS über ${this.server})`); this.then(answer); }
  }
}

class UdpSend extends Session {
  constructor(l3, dst, port, len) { super(l3); Object.assign(this, { dst, port, len }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); }
  start() {
    this.begin();
    this.dev.print(`$ echo test | nc -u -w1 ${this.dst} ${this.port}`);
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, proto: PROTO.UDP, l4: udp(this.sport, this.port, { kind: 'data', len: this.len }) }), {});
    if (!res.ok) { this.dev.print(`nc: ${res.error}`); return this.end(); }
    this.dev.print(`${this.len} Byte als UDP-Datagramm gesendet. UDP wartet auf keine Bestätigung.`);
    this.sim.schedule(2000, () => this.end());
  }
  onIcmpError(ip) { const o = ip.l4.orig; if (!o || o.sport !== this.sport || this.done) return; this.dev.print(`Hinweis: ICMP ${icmpName(ip.l4.type, ip.l4.code)} von ${ip.src} erhalten`); this.end(); }
}

// ---------------------------------------------------------------- Hosts und Router
class Host extends Device {
  constructor(sim, cfg) { super(sim, cfg); this.l3 = new L3(this); }
  receive(ifname, frame) { this.l3.receive(ifname, frame); }
  ping(dst, o = {}) { const s = new PingSession(this.l3, dst, o); s.start(); return s; }
  traceroute(dst, o = {}) { const s = new TraceSession(this.l3, dst, o); s.start(); return s; }
  arping(target, o = {}) { const s = new ArpingSession(this.l3, target, o); s.start(); return s; }
  curl(dst, port = 80, o = {}) { const s = new TcpClient(this.l3, dst, port, 'http', o); s.start(); return s; }
  ncz(dst, port) { const s = new TcpClient(this.l3, dst, port, 'probe'); s.start(); return s; }
  dig(server, name) { const s = new DigSession(this.l3, server, name); s.start(); return s; }
  resolve(name, cb) {
    if (isIp(name)) return cb(name);
    if (!isIp(this.cfg.resolver)) { this.print(`${name}: kein DNS-Server eingetragen`); this.record('err', `kann ${name} nicht auflösen: kein DNS-Server konfiguriert`, { tag: 'dns-no-resolver' }); return cb(null); }
    const s = new DigSession(this.l3, this.cfg.resolver, name, cb); s.start(); return s;
  }
  udpSend(dst, port, len = 32) { const s = new UdpSend(this.l3, dst, port, len); s.start(); return s; }
}
class Router extends Host {}

// ---------------------------------------------------------------- Bridge mit Spanning Tree
const cmpBid = (a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac);
const cmpPort = (a, b) => { const [ap, an] = a.split('.').map(Number), [bp, bn] = b.split('.').map(Number); return (ap - bp) || (an - bn); };
function cmpVec(a, b) {
  return cmpBid(a.root, b.root) || (a.cost - b.cost) || cmpBid(a.bridge, b.bridge) || cmpPort(a.port, b.port) || (a.rx && b.rx ? cmpPort(a.rx, b.rx) : 0);
}
const ROLE_DE = { root: 'Root-Port', designated: 'Designated', alternate: 'Alternate (blockiert)', disabled: 'deaktiviert' };
const STATE_DE = { blocking: 'Blocking', listening: 'Listening', learning: 'Learning', forwarding: 'Forwarding', disabled: 'Disabled' };

class Bridge {
  constructor(dev) { this.dev = dev; this.sim = dev.sim; this.resetState(); }
  resetState() { this.fdb = new Map(); this.seen = new Map(); this.stp = null; }
  get cfg() { return this.dev.cfg; }
  get ageingMs() { return Number(this.cfg.ageing ?? 300) * 1000; }
  portCfg(p) { return this.dev.portCfg(p); }
  allPorts() { return this.dev.bridgePorts(); }
  stpOn() { return !!this.stp; }
  vidIn(p, frame) {
    const c = this.portCfg(p);
    if (!c) return null;
    if (c.mode === 'trunk') {
      if (frame.vlan) return parseVlanList(c.allowed).has(frame.vlan.vid) ? frame.vlan.vid : null;
      return c.native ? Number(c.native) : null;
    }
    return frame.vlan ? null : Number(c.vlan || 1);
  }
  carries(p, vid) {
    const c = this.portCfg(p);
    if (!c) return false;
    if (this.stp && !p.startsWith('vxlan') && this.stp.ports.get(p)?.state !== 'forwarding') return false;
    if (c.mode === 'trunk') return parseVlanList(c.allowed).has(vid) || Number(c.native) === vid;
    return Number(c.vlan || 1) === vid;
  }
  entry(vid, mac) {
    const e = this.fdb.get(vid + '|' + mac);
    if (!e) return null;
    if (this.sim.time - e.t > this.ageingMs) { this.fdb.delete(vid + '|' + mac); return null; }
    return e;
  }
  table() {
    const out = [];
    for (const [k, e] of this.fdb) {
      const [vid, mac] = k.split('|');
      const age = (this.sim.time - e.t) / 1000;
      if (age * 1000 > this.ageingMs) continue;
      out.push({ vid: Number(vid), mac, port: e.port, remote: e.remote || null, age });
    }
    return out.sort((a, b) => a.vid - b.vid || a.port.localeCompare(b.port));
  }
  receive(p, frame, from = {}) {
    if (frame.type === 'stp') { if (this.stp) this.stpReceive(p, frame); return; }
    const ps = this.stp && !p.startsWith('vxlan') ? this.stp.ports.get(p) : null;
    if (ps && (ps.state === 'blocking' || ps.state === 'listening' || ps.state === 'disabled')) {
      this.dev.record('drop', `${p} ist im Zustand ${STATE_DE[ps.state]} (STP): Frame verworfen`, { frame, tag: 'stp-drop', data: { port: p, state: ps.state } });
      return;
    }
    const vid = from.vid ?? this.vidIn(p, frame);
    if (vid === null) {
      this.dev.record('drop', `Frame auf ${p} passt zu keinem erlaubten VLAN (${frame.vlan ? 'Tag ' + frame.vlan.vid : 'ohne Tag'}), verworfen`, { frame, tag: 'vlan-drop', data: { port: p } });
      return;
    }
    const inner = clone(frame); inner.vlan = null;
    if (this.ageingMs > 0 && !isGroupMac(frame.src) && from.learning !== false) {
      const key = vid + '|' + frame.src;
      const old = this.fdb.get(key);
      this.fdb.set(key, { port: p, t: this.sim.time, remote: from.remote || null });
      if (!old || old.port !== p || old.remote !== (from.remote || null)) {
        const flap = old && old.port !== p && this.sim.time - old.t < 1000;
        this.dev.record('learn', flap ? `MAC-Flapping: ${frame.src} springt von ${old.port} zu ${p}` : `lernt: ${frame.src} ist in VLAN ${vid} an ${p}${from.remote ? ' (hinter VTEP ' + from.remote + ')' : ''}`,
          { tag: flap ? 'mac-flap' : 'mac-learned', data: { mac: frame.src, port: p, vid, remote: from.remote || null } });
      }
    }
    if (ps && ps.state === 'learning') { this.dev.record('drop', `${p} ist im Zustand Learning: MAC gelernt, Frame aber nicht weitergeleitet`, { frame, tag: 'stp-learning' }); return; }
    const e = !isGroupMac(frame.dst) && this.ageingMs > 0 ? this.entry(vid, frame.dst) : null;
    if (e && (!this.stp || e.port.startsWith('vxlan') || this.stp.ports.get(e.port)?.state === 'forwarding')) {
      if (e.port === p) { this.dev.record('drop', `Ziel ${frame.dst} liegt am selben Port ${p}, Frame wird gefiltert`, { frame, tag: 'filtered' }); return; }
      this.dev.record('fwd', `leitet an ${e.port} weiter (MAC-Tabelle: ${frame.dst})`, { frame, tag: 'switched', data: { port: e.port } });
      this.egress(e.port, inner, vid, e.remote);
      return;
    }
    // Schleifenerkennung: derselbe Broadcast kommt immer wieder
    if (isGroupMac(frame.dst) || !e) {
      const n = (this.seen.get(frame.id) || 0) + 1;
      this.seen.set(frame.id, n);
      if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
      if (n === 2) this.dev.record('err', `sieht denselben Frame (${frame.type === 'arp' ? 'ARP' : 'IP'} von ${frame.src}) zum zweiten Mal: Das Netz hat eine Schleife!`, { frame, tag: 'loop-detected' });
      if (n >= T.loopHalt) return this.sim.halt(this.dev, `Broadcast-Sturm: ${this.dev.name} hat denselben Frame ${n}-mal geflutet. Ethernet hat keine TTL, ohne Spanning Tree kreist er ewig. Simulation angehalten.`);
    }
    const why = frame.dst === BCAST ? 'Broadcast' : isGroupMac(frame.dst) ? 'Multicast' : this.ageingMs === 0 ? 'Aging 0: lernt nichts, flutet alles' : `Ziel ${frame.dst} unbekannt`;
    const targets = this.allPorts().filter(x => x !== p && this.carries(x, vid) && !(from.remote && x.startsWith('vxlan')));
    this.dev.record('fwd', targets.length ? `flutet an ${targets.join(', ')} (${why})` : `kein weiterer Port in VLAN ${vid} (${why})`, { frame, tag: 'flooded', data: { ports: targets, why } });
    for (const t of targets) this.egress(t, inner, vid, null);
  }
  egress(p, inner, vid, remote) {
    if (p.startsWith('vxlan')) return this.dev.vxlanOut(p, inner, remote);
    const c = this.portCfg(p);
    const f = clone(inner);
    if (c.mode === 'trunk' && Number(c.native) !== vid) f.vlan = { vid, pcp: 0 };
    this.dev.transmit(p, f);
  }

  // ---------- Spanning Tree (IEEE 802.1D, vereinfacht)
  timers() { return STP_PRESETS[this.cfg.stp.timers] || STP_PRESETS.standard; }
  myId() { return { prio: Number(this.cfg.stp.priority ?? 32768), mac: macFor(this.dev.id + '/bridge') }; }
  portId(p) { return `128.${PORTS.switch.indexOf(p) + 1}`; }
  physUp(p) { const l = this.sim.linkAt(this.dev.id, p); return !!l && l.up; }
  stpStart() {
    if (this.stp) return;
    this.stp = { ports: new Map(), rootPort: null, rootId: this.myId(), rootCost: 0, tcUntil: 0, lastFlush: -1e9, timer: null };
    this.dev.record('info', `startet Spanning Tree (Bridge ID ${fmtBid(this.myId())}) und hält sich zunächst selbst für die Root`, { tag: 'stp-start' });
    for (const p of PORTS.switch) this.stp.ports.set(p, { role: 'disabled', state: 'disabled', info: null, timer: null, edge: false });
    this.stpRecompute(true);
    const tick = () => { if (!this.stp) return; this.stpHello(); this.stp.timer = this.sim.schedule(this.timers().hello * 1000, tick); };
    this.stp.timer = this.sim.schedule(5 + this.sim.random() * 20, tick);
  }
  stpStop() {
    if (!this.stp) return;
    this.sim.cancel(this.stp.timer);
    for (const ps of this.stp.ports.values()) this.sim.cancel(ps.timer);
    this.stp = null;
    this.dev.record('info', 'Spanning Tree ausgeschaltet: alle Ports leiten sofort weiter', { tag: 'stp-stop' });
  }
  stpHello() {
    const now = this.sim.time, { maxAge } = this.timers();
    let changed = false;
    for (const [p, ps] of this.stp.ports) {
      if (ps.info && now - ps.info.t > maxAge * 1000) {
        ps.info = null; changed = true;
        this.dev.record('err', `${p}: seit ${maxAge} s keine BPDU mehr (Max Age), die gespeicherte Information verfällt`, { tag: 'stp-maxage', data: { port: p } });
      }
    }
    if (changed) this.stpRecompute();
    const { hello, fwd } = this.timers();
    const amRoot = !this.stp.rootPort;
    const rootInfo = this.stp.rootPort ? this.stp.ports.get(this.stp.rootPort).info : null;
    for (const [p, ps] of this.stp.ports) {
      if (ps.role !== 'designated' || !this.physUp(p)) continue;
      const bpdu = { root: this.stp.rootId, cost: this.stp.rootCost, bridge: this.myId(), port: this.portId(p), age: amRoot ? 0 : (rootInfo?.age ?? 0) + 1,
        maxAge, hello, fwd, tc: now < this.stp.tcUntil };
      this.dev.transmit(p, ethFrame(this.dev.mac(p), STP_MAC, 'stp', bpdu));
    }
  }
  stpReceive(p, frame) {
    const ps = this.stp.ports.get(p);
    if (!ps || !this.physUp(p)) return;
    const b = frame.payload;
    if (ps.edge) { ps.edge = false; ps.edgeLost = true; this.dev.record('err', `${p} ist als Edge-Port konfiguriert, empfängt aber eine BPDU: verliert den Edge-Status`, { frame, tag: 'stp-edge-lost', data: { port: p } }); }
    const isNew = !ps.info || cmpBid(ps.info.root, b.root) || ps.info.cost !== b.cost || cmpBid(ps.info.bridge, b.bridge);
    ps.info = { root: b.root, cost: b.cost, bridge: b.bridge, port: b.port, age: b.age, t: this.sim.time };
    if (isNew) this.dev.record('learn', `${p} empfängt BPDU: Root ${fmtBid(b.root)}, Kosten ${b.cost}, von ${fmtBid(b.bridge)}`, { frame, tag: 'stp-bpdu', data: { port: p } });
    if (b.tc && p === this.stp.rootPort && this.sim.time - this.stp.lastFlush > 5000) {
      this.stp.lastFlush = this.sim.time;
      this.fdb.clear();
      this.stp.tcUntil = Math.max(this.stp.tcUntil, this.sim.time + this.timers().fwd * 1000);
      this.dev.record('info', 'Topologieänderung gemeldet: MAC-Tabelle geleert, Adressen werden neu gelernt', { tag: 'stp-tc-flush' });
    }
    this.stpRecompute();
  }
  stpRecompute(initial = false) {
    const st = this.stp, me = this.myId();
    let best = null, rootPort = null;
    for (const [p, ps] of st.ports) {
      if (!ps.info || !this.physUp(p)) continue;
      const cost = Number(this.portCfg(p).cost || 4);
      const cand = { root: ps.info.root, cost: ps.info.cost + cost, bridge: ps.info.bridge, port: ps.info.port, rx: this.portId(p) };
      if (cmpBid(cand.root, me) >= 0) continue;
      if (!best || cmpVec(cand, best) < 0) { best = cand; rootPort = p; }
    }
    const oldRoot = st.rootId;
    st.rootPort = rootPort;
    st.rootId = best ? best.root : me;
    st.rootCost = best ? best.cost : 0;
    if (cmpBid(oldRoot, st.rootId) !== 0 && !initial) {
      this.dev.record('info', rootPort ? `neue Root Bridge: ${fmtBid(st.rootId)}, Root-Port ${rootPort}, Kosten ${st.rootCost}` : 'ist jetzt selbst die Root Bridge', { tag: 'stp-root', data: { root: fmtBid(st.rootId), rootPort } });
    }
    for (const [p, ps] of st.ports) {
      let role;
      if (!this.physUp(p)) role = 'disabled';
      else if (p === rootPort) role = 'root';
      else {
        const offer = { root: st.rootId, cost: st.rootCost, bridge: me, port: this.portId(p) };
        role = !ps.info || cmpVec(offer, ps.info) < 0 ? 'designated' : 'alternate';
      }
      this.setRole(p, ps, role, initial);
    }
  }
  setRole(p, ps, role, initial) {
    const prev = ps.role;
    ps.role = role;
    const cfgEdge = !!this.portCfg(p).edge;
    if (role === 'disabled') { this.sim.cancel(ps.timer); ps.state = 'disabled'; ps.edge = false; ps.edgeLost = false; return; }
    ps.edge = cfgEdge && !ps.edgeLost;
    if (role !== prev && !initial) this.dev.record('info', `${p} wird ${ROLE_DE[role]}`, { tag: 'stp-role', data: { port: p, role } });
    if (role === 'alternate') {
      if (ps.state !== 'blocking') {
        const wasFwd = ps.state === 'forwarding';
        this.sim.cancel(ps.timer); ps.state = 'blocking';
        this.dev.record('info', `${p}: Zustand Blocking (verhindert eine Schleife)`, { tag: 'stp-state', data: { port: p, state: 'blocking' } });
        if (wasFwd) this.topologyChange();
      }
      return;
    }
    if (ps.edge && role === 'designated') {
      if (ps.state !== 'forwarding') { this.sim.cancel(ps.timer); ps.state = 'forwarding'; this.dev.record('info', `${p} ist Edge-Port (PortFast): sofort Forwarding`, { tag: 'stp-state', data: { port: p, state: 'forwarding', edge: true } }); }
      return;
    }
    if (ps.state === 'blocking' || ps.state === 'disabled') {
      ps.state = 'listening';
      this.dev.record('info', `${p}: Zustand Listening (${this.timers().fwd} s, leitet noch nichts weiter)`, { tag: 'stp-state', data: { port: p, state: 'listening' } });
      const fwd = this.timers().fwd * 1000;
      ps.timer = this.sim.schedule(fwd, () => {
        if (!this.stp || ps.state !== 'listening') return;
        ps.state = 'learning';
        this.dev.record('info', `${p}: Zustand Learning (${this.timers().fwd} s, lernt MAC-Adressen, leitet noch nicht weiter)`, { tag: 'stp-state', data: { port: p, state: 'learning' } });
        ps.timer = this.sim.schedule(fwd, () => {
          if (!this.stp || ps.state !== 'learning') return;
          ps.state = 'forwarding';
          this.dev.record('ok', `${p}: Zustand Forwarding, leitet jetzt weiter`, { tag: 'stp-state', data: { port: p, state: 'forwarding' } });
          this.topologyChange();
        });
      });
    }
  }
  topologyChange() {
    if (!this.stp) return;
    this.stp.tcUntil = this.sim.time + (this.timers().maxAge + this.timers().fwd) * 1000;
    if (this.sim.time - this.stp.lastFlush > 5000) {
      this.stp.lastFlush = this.sim.time;
      this.fdb.clear();
      this.dev.record('info', 'Topologieänderung: MAC-Tabelle geleert und Änderung per BPDU gemeldet', { tag: 'stp-tc', data: {} });
    }
  }
  stpTable() {
    if (!this.stp) return null;
    const ports = [];
    for (const [p, ps] of this.stp.ports) {
      if (!this.sim.linkAt(this.dev.id, p)) continue;
      ports.push({ port: p, id: this.portId(p), role: ps.role, state: ps.state, cost: Number(this.portCfg(p).cost || 4), edge: ps.edge,
        designated: ps.role === 'designated' ? fmtBid(this.myId()) : ps.info ? fmtBid(ps.info.bridge) : '' });
    }
    return { bridge: fmtBid(this.myId()), root: fmtBid(this.stp.rootId), isRoot: !this.stp.rootPort, rootPort: this.stp.rootPort, rootCost: this.stp.rootCost, ports };
  }
  roleOf(p) { return this.stp?.ports.get(p)?.role || null; }
  stateOf(p) { return this.stp?.ports.get(p)?.state || null; }
}
export const STP_TEXT = { ROLE_DE, STATE_DE };

class Switch extends Device {
  constructor(sim, cfg) { super(sim, cfg); this.bridge = new Bridge(this); }
  portCfg(p) { return this.cfg.ports[p]; }
  bridgePorts() { return PORTS.switch.filter(p => { const l = this.sim.linkAt(this.id, p); return l && l.up; }); }
  receive(ifname, frame) { this.bridge.receive(ifname, frame); }
  start() { if (this.cfg.stp?.enabled) this.bridge.stpStart(); }
  stop() { this.bridge.stpStop(); }
  onConfig() {
    if (this.cfg.stp?.enabled && !this.bridge.stp) this.bridge.stpStart();
    else if (!this.cfg.stp?.enabled && this.bridge.stp) this.bridge.stpStop();
    else if (this.bridge.stp) this.bridge.stpRecompute();
  }
  onLink(ifname, up) {
    if (!this.bridge.stp) return;
    const ps = this.bridge.stp.ports.get(ifname);
    if (ps && !up) ps.info = null;
    this.bridge.stpRecompute();
  }
}

class Vtep extends Device {
  constructor(sim, cfg) { super(sim, cfg); this.l3 = new L3(this); this.bridge = new Bridge(this); }
  maps() { return (this.cfg.vxlans || []).filter(m => m.vni && m.vlan); }
  portCfg(p) {
    if (p.startsWith('vxlan')) { const m = this.maps().find(x => 'vxlan' + x.vni === p); return m ? { mode: 'access', vlan: Number(m.vlan) } : null; }
    return this.cfg.ports[p];
  }
  bridgePorts() { return ['eth2', 'eth3', 'eth4'].filter(p => { const l = this.sim.linkAt(this.id, p); return l && l.up; }).concat(this.maps().map(m => 'vxlan' + m.vni)); }
  localIp() { return this.cfg.ifaces.lo?.ip || this.cfg.ifaces.eth1?.ip; }
  vxlanMtu(m) { return m.mtu ? Number(m.mtu) : this.sim.mtuOf(this.id, 'eth1') - 50; }
  receive(ifname, frame) {
    if (ifname === 'eth1') return this.l3.receive(ifname, frame);
    this.bridge.receive(ifname, frame);
  }
  vxlanOut(port, inner, remote) {
    const m = this.maps().find(x => 'vxlan' + x.vni === port);
    if (!m) return;
    const plen = framePayloadLen(inner);
    const vm = this.vxlanMtu(m);
    if (plen > vm) {
      this.record('drop', `${port}: Frame mit ${plen} Byte Nutzlast ist grösser als die MTU ${vm} des VXLAN-Interfaces, still verworfen (keine ICMP-Meldung auf Layer 2)`, { frame: inner, tag: 'vxlan-mtu-drop', data: { mtu: vm, len: plen } });
      return;
    }
    const targets = remote ? [remote] : (m.flood || []).filter(isIp);
    if (!targets.length) { this.record('drop', `${port}: Flood-Liste ist leer, Frame geht an keinen VTEP`, { frame: inner, tag: 'vxlan-no-flood' }); return; }
    const src = this.localIp();
    for (const t of targets) {
      const pkt = ipPacket({ src, dst: t, proto: PROTO.UDP, df: false, trace: traceOf(inner) ?? undefined,
        l4: udp(hashFlow(inner.src + inner.dst + (inner.type === 'ipv4' ? inner.payload.src + inner.payload.dst + inner.payload.proto : 'arp')),
          Number(m.dstport || VXLAN_PORT), { kind: 'vxlan', vni: Number(m.vni), frame: clone(inner) }) });
      this.record('info', `kapselt in VXLAN (VNI ${m.vni}) und sendet ${remote ? 'per Unicast' : 'per Head-End Replication'} an VTEP ${t}`, { frame: ethFrame(this.mac('eth1'), '00:00:00:00:00:00', 'ipv4', pkt), tag: 'vxlan-encap', data: { vni: Number(m.vni), dst: t } });
      this.l3.output(pkt, {});
    }
  }
  onUdp(ip) {
    const l4 = ip.l4;
    if (l4.payload?.kind !== 'vxlan') return false;
    const onPort = this.maps().filter(m => Number(m.dstport || VXLAN_PORT) === l4.dport);
    if (!onPort.length) return false;
    const m = onPort.find(x => Number(x.vni) === l4.payload.vni);
    if (!m) { this.record('drop', `VXLAN mit VNI ${l4.payload.vni} von ${ip.src} erhalten, aber kein Segment mit diesem VNI: verworfen`, { tag: 'vxlan-vni-unknown', data: { vni: l4.payload.vni } }); return true; }
    this.record('info', `packt VXLAN von ${ip.src} aus (VNI ${m.vni} → VLAN ${m.vlan})`, { tag: 'vxlan-decap', data: { vni: Number(m.vni), from: ip.src } });
    this.bridge.receive('vxlan' + m.vni, clone(l4.payload.frame), { vid: Number(m.vlan), remote: ip.src, learning: m.learning !== false });
    return true;
  }
  ping(dst, o) { return Host.prototype.ping.call(this, dst, o); }
  traceroute(dst, o) { return Host.prototype.traceroute.call(this, dst, o); }
  arping(t, o) { return Host.prototype.arping.call(this, t, o); }
}

export function newId(prefix = 'd') { return prefix + Math.random().toString(36).slice(2, 9); }
export { TCP_HDR };
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/framebuilder.js" <<'__PACKETPILOT_FILE_END__'
// Frame-Baukasten: Schichten frei stapeln, Regeln prüfen, Grössen berechnen
import { h } from './ui.js';

const BLOCKS = {
  eth: { name: 'Ethernet', size: 14, kind: 'eth', note: 'Ziel-MAC, Quell-MAC, EtherType' },
  vlan: { name: '802.1Q-Tag', size: 4, kind: 'vlan', note: 'TPID 0x8100, PCP, DEI, VID' },
  arp: { name: 'ARP', size: 28, kind: 'arp', note: 'Request oder Reply' },
  stp: { name: 'BPDU (mit LLC)', size: 38, kind: 'stp', note: 'Spanning Tree: Root-ID, Kosten, Bridge-ID, Timer' },
  ip: { name: 'IPv4', size: 20, kind: 'ip', note: 'TTL, Protocol, Adressen' },
  icmp: { name: 'ICMP', size: 8, kind: 'icmp', note: 'Echo, Unreachable, Time Exceeded' },
  udp: { name: 'UDP', size: 8, kind: 'udp', note: 'Ports, Länge, Prüfsumme' },
  tcp: { name: 'TCP', size: 20, kind: 'tcp', note: 'Ports, Sequenz, Flags (ohne Optionen)' },
  vxlan: { name: 'VXLAN', size: 8, kind: 'vxlan', note: 'Flags, VNI' },
  data: { name: 'Daten', size: null, kind: 'data', note: 'Nutzdaten der Anwendung' }
};
const PRESETS = {
  'Ping': ['eth', 'ip', 'icmp', 'data'],
  'ARP-Anfrage': ['eth', 'arp'],
  'Ping in VLAN 10': ['eth', 'vlan', 'ip', 'icmp', 'data'],
  'DNS über UDP': ['eth', 'ip', 'udp', 'data'],
  'TCP-SYN': ['eth', 'ip', 'tcp'],
  'BPDU': ['eth', 'stp'],
  'Ping über VXLAN': ['eth', 'ip', 'udp', 'vxlan', 'eth', 'ip', 'icmp', 'data']
};

function validate(seq) {
  const msgs = [], bad = new Set();
  const err = (i, m) => { bad.add(i); msgs.push(m); };
  if (!seq.length) return { msgs: ['Ziehe Schichten in die Ablage. Ganz vorne steht, was zuerst auf das Kabel geht.'], bad, ok: false, empty: true };
  if (seq[0] !== 'eth') err(0, 'Ein Frame beginnt immer mit dem Ethernet-Header.');
  for (let i = 0; i < seq.length; i++) {
    const b = seq[i], prev = seq[i - 1], next = seq[i + 1];
    if (b === 'vlan' && prev !== 'eth') err(i, 'Der 802.1Q-Tag folgt direkt auf den Ethernet-Header (nach der Quell-MAC).');
    if (b === 'eth' && i > 0 && prev !== 'vxlan') err(i, 'Ein zweiter Ethernet-Header ist nur nach einem VXLAN-Header sinnvoll (innerer Frame).');
    if ((b === 'ip' || b === 'arp') && !['eth', 'vlan'].includes(prev)) err(i, `${BLOCKS[b].name} gehört direkt in den Ethernet-Frame (EtherType).`);
    if (b === 'arp' && next) err(i + 1, 'ARP hat keine weitere Nutzlast, danach folgt nichts mehr.');
    if (b === 'stp' && !['eth', 'vlan'].includes(prev)) err(i, 'Eine BPDU steht direkt im Ethernet-Frame (802.3 mit LLC).');
    if (b === 'stp' && next) err(i + 1, 'Nach der BPDU folgt nichts mehr.');
    if (['icmp', 'udp', 'tcp'].includes(b) && prev !== 'ip') err(i, `${BLOCKS[b].name} steckt in einem IP-Paket (Feld Protocol).`);
    if (b === 'vxlan' && prev !== 'udp') err(i, 'VXLAN steckt in UDP (Ziel-Port 4789).');
    if (b === 'vxlan' && next !== 'eth') err(i, 'Nach dem VXLAN-Header folgt der innere Ethernet-Frame.');
    if (b === 'data' && !['udp', 'tcp', 'icmp'].includes(prev)) err(i, 'Daten der Anwendung stecken in UDP, TCP oder ICMP.');
    if (b === 'data' && next) err(i + 1, 'Nach den Daten kommt nur noch die FCS.');
    if (b === 'vlan' && seq.filter(x => x === 'vlan').length > 2) err(i, 'Mehr als zwei Tags (QinQ) sind unüblich.');
  }
  return { msgs: msgs.length ? msgs : ['Gültiger Frame.'], bad, ok: !msgs.length };
}

export function renderFrameBuilder(root) {
  let seq = [...PRESETS['Ping']];
  let dataLen = 56;
  let dragFrom = null;
  const pal = h('div', { class: 'fb-pal' });
  for (const [k, b] of Object.entries(BLOCKS)) {
    const el = h('div', { class: 'fb-blk', draggable: 'true', style: { '--lc': `var(--l-${b.kind})` }, tabindex: '0', role: 'button', title: `${b.note}. Klicken fügt hinten an.` },
      b.name, h('span', { class: 'sz' }, b.size === null ? 'variabel' : `${b.size} B`));
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/fb', k); dragFrom = null; });
    el.addEventListener('click', () => { seq.push(k); draw(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { seq.push(k); draw(); } });
    pal.append(el);
  }
  const drop = h('div', { class: 'fb-drop', 'aria-label': 'Frame' });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const k = e.dataTransfer.getData('text/fb');
    const target = e.target.closest('.fb-cell');
    const pos = target ? Number(target.dataset.i) : seq.length;
    if (dragFrom !== null) { const [m] = seq.splice(dragFrom, 1); seq.splice(pos > dragFrom ? pos - 1 : pos, 0, m); dragFrom = null; }
    else if (k) seq.splice(pos, 0, k);
    draw();
  });
  const msgs = h('div', { class: 'fb-msgs', role: 'status' });
  const stats = h('div', { class: 'fb-stats' });
  const dataIn = h('input', { class: 'input mono', type: 'number', min: '0', max: '9000', value: dataLen, style: { width: '96px' } });
  dataIn.addEventListener('input', () => { dataLen = Math.max(0, Math.min(9000, Number(dataIn.value) || 0)); draw(); });
  const presetRow = h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Vorlagen:'),
    ...Object.keys(PRESETS).map(n => h('button', { class: 'btn', onclick: () => { seq = [...PRESETS[n]]; draw(); } }, n)),
    h('button', { class: 'btn ghost', onclick: () => { seq = []; draw(); } }, 'Leeren'));

  function draw() {
    drop.innerHTML = '';
    const v = validate(seq);
    seq.forEach((k, i) => {
      const b = BLOCKS[k];
      const size = b.size ?? dataLen;
      const cell = h('div', { class: `fb-cell bg-${b.kind}${v.bad.has(i) ? ' bad' : ''}`, draggable: 'true', 'data-i': i,
        style: { flex: `${Math.max(1, Math.log2(size + 2))} 0 auto` } },
        h('span', { class: 'n' }, b.name), h('span', { class: 'sz' }, `${size} Byte`),
        h('button', { title: 'entfernen', 'aria-label': `${b.name} entfernen`, onclick: () => { seq.splice(i, 1); draw(); } }, '✕'));
      cell.addEventListener('dragstart', () => { dragFrom = i; });
      drop.append(cell);
    });
    if (v.empty) drop.append(h('div', { class: 'muted', style: { alignSelf: 'center', padding: '0 8px' } }, 'Hier ablegen'));
    msgs.innerHTML = '';
    for (const m of v.msgs) msgs.append(h('div', { class: 'm ' + (v.ok ? 'ok' : 'bad') }, m));
    stats.innerHTML = '';
    if (!v.ok) return;
    const sizes = seq.map(k => BLOCKS[k].size ?? dataLen);
    const total = sizes.reduce((a, b) => a + b, 0);
    const outerL2 = 14 + (seq[1] === 'vlan' ? 4 : 0);
    const payload = total - outerL2;
    const frameLen = Math.max(64, total + 4);
    const wire = frameLen + 8 + 12;
    const useful = seq.includes('data') ? dataLen : 0;
    const mtuOk = payload <= 1500;
    const stat = (val, label) => h('div', {}, h('b', {}, val), h('span', {}, label));
    stats.append(
      stat(`${total} B`, 'Frame ohne FCS (so zeigt ihn tcpdump)'),
      stat(`${frameLen} B`, total + 4 < 64 ? `mit FCS, auf 64 Byte aufgefüllt (${64 - total - 4} Byte Padding)` : 'mit FCS'),
      stat(`${wire} B`, 'auf dem Kabel mit Präambel, SFD und Pause'),
      stat(`${payload} B`, mtuOk ? 'Nutzlast des äusseren Frames, passt in MTU 1500' : 'Nutzlast über 1500: braucht grössere MTU (Jumbo)'),
      stat(useful ? `${(useful / wire * 100).toFixed(1)} %` : '0 %', 'Anteil der Anwendungsdaten auf dem Kabel'));
    if (!mtuOk) stats.lastChild.previousSibling.style.borderColor = 'var(--err)';
  }
  root.append(h('div', { class: 'page' },
    h('h1', {}, 'Frame-Baukasten'),
    h('p', { class: 'muted' }, 'Staple Header zu einem Frame und sieh sofort, ob die Reihenfolge stimmt und wie viel Platz jede Schicht kostet.'),
    presetRow,
    h('div', { class: 'fb' }, pal, h('div', {},
      drop,
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('label', { class: 'field' }, 'Grösse der Daten (Byte)', dataIn),
        h('span', { class: 'small muted', style: { maxWidth: '52ch' } }, 'Tipp: Bei "Ping über VXLAN" mit 1472 Byte Daten siehst du, warum das Underlay 1550 Byte braucht.')),
      msgs, stats))));
  draw();
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/icons.js" <<'__PACKETPILOT_FILE_END__'
// Eigene Linien-Icons, 24x24, stroke=currentColor
const s = (body, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const I = {
  course: s('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7h8M8 11h6"/>'),
  lab: s('<rect x="3" y="3" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="3" width="7" height="6" rx="1.5"/><path d="M6.5 9v4.5a2 2 0 0 0 2 2H14M10 6h4"/>'),
  nets: s('<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="5" r="2.2"/><circle cx="19" cy="19" r="2.2"/><circle cx="12" cy="12" r="2.2"/><path d="M7.2 12h2.6M13.7 10.5l3.6-4M13.7 13.5l3.6 4"/>'),
  frame: s('<rect x="2.5" y="8" width="5" height="8" rx="1"/><rect x="8.5" y="8" width="4" height="8" rx="1"/><rect x="13.5" y="8" width="8" height="8" rx="1"/><path d="M5 5v2M10.5 5v2M17.5 5v2"/>'),
  play: s('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: s('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  step: s('<path d="M5 5v14l9-7z" fill="currentColor" stroke="none"/><path d="M18 5v14" stroke-width="2.4"/>'),
  reset: s('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  cable: s('<path d="M4 20c4 0 4-16 8-16s4 16 8 16"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="20" r="1.6" fill="currentColor"/>'),
  trash: s('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  sun: s('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: s('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  check: s('<path d="M4.5 12.5l5 5 10-11"/>'),
  circle: s('<circle cx="12" cy="12" r="8"/>'),
  lock: s('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>'),
  right: s('<path d="M9 5l7 7-7 7"/>'),
  left: s('<path d="M15 5l-7 7 7 7"/>'),
  down: s('<path d="M5 9l7 7 7-7"/>'),
  up: s('<path d="M5 15l7-7 7 7"/>'),
  terminal: s('<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M6.5 9l3.5 3-3.5 3M12 15h5"/>'),
  table: s('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 14.5h18M9 9.5V20"/>'),
  sliders: s('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  target: s('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  bulb: s('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'),
  download: s('<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>'),
  upload: s('<path d="M12 20V9M7 13.5l5-5 5 5M4.5 4h15"/>'),
  fit: s('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  eye: s('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  route: s('<circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>'),
  x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  save: s('<path d="M5 3.5h11.5L20.5 7.5V20.5H5z"/><path d="M8 3.5v5h8v-5M8 20.5v-6h8v6"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
  warn: s('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>'),
  flag: s('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  spark: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  ffwd: s('<path d="M3.5 6v12l8-6zM12.5 6v12l8-6z" fill="currentColor" stroke="none"/>'),
  area: s('<rect x="3" y="5" width="18" height="14" rx="2.5" stroke-dasharray="3 2.4"/><path d="M6 9h5"/>'),
  grip: s('<circle cx="9" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="7" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="17" r="1" fill="currentColor"/><circle cx="15" cy="17" r="1" fill="currentColor"/>')
};

// Geräte-Symbole für den Netzplan (40x40, eigene Farben über CSS)
export const DEV_ICON = {
  pc: `<rect x="6" y="7" width="28" height="19" rx="2.5" class="dv-fill"/><path d="M15 31h10M20 26v5" class="dv-line"/><path d="M10 11h20v11H10z" class="dv-screen"/>`,
  server: `<rect x="9" y="5" width="22" height="30" rx="2.5" class="dv-fill"/><path d="M12 12h16M12 19h16M12 26h16" class="dv-line"/><circle cx="26" cy="9" r="1.3" class="dv-led"/><circle cx="26" cy="16" r="1.3" class="dv-led"/><circle cx="26" cy="23" r="1.3" class="dv-led"/>`,
  switch: `<rect x="4" y="12" width="32" height="16" rx="3" class="dv-fill"/><path d="M11 17h18l-3-2.5M29 23H11l3 2.5" class="dv-line"/>`,
  router: `<circle cx="20" cy="20" r="14" class="dv-fill"/><path d="M20 9v8M20 31v-8M9 20h8M31 20h-8" class="dv-line"/><path d="M17.5 11.5 20 9l2.5 2.5M17.5 28.5 20 31l2.5-2.5M11.5 17.5 9 20l2.5 2.5M28.5 17.5 31 20l-2.5 2.5" class="dv-line"/>`,
  vtep: `<rect x="4" y="11" width="32" height="18" rx="3" class="dv-fill"/><path d="M10 20h20" class="dv-tunnel"/><circle cx="10" cy="20" r="2.4" class="dv-led"/><circle cx="30" cy="20" r="2.4" class="dv-led"/>`
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/inspector.js" <<'__PACKETPILOT_FILE_END__'
// Paketinspektor: Schichten, Felder, Byte-Balken
import { dissect, summary } from './packets.js';
import { frameLen, frameWireLen } from './net.js';
import { h, esc } from './ui.js';

export function renderInspector(el, entry, { onTrace } = {}) {
  el.innerHTML = '';
  if (!entry || !entry.frame) {
    el.append(h('div', { class: 'empty' }, 'Klicke auf ein Paket im Netzplan oder auf eine Zeile im Protokoll, um es Schicht für Schicht zu zerlegen.'));
    return;
  }
  const f = entry.frame;
  const layers = dissect(f);
  const total = frameLen(f);
  el.append(h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, summary(f)));
  el.append(h('div', { class: 'muted small' },
    `${entry.dev ? entry.dev + ', ' : ''}t = ${(entry.t / 1000).toFixed(4)} s, ${total} Byte ohne FCS, ${frameWireLen(f)} Byte im Frame mit FCS`));
  const bar = h('div', { class: 'bytebar', title: 'Anteil jeder Schicht an der Framegrösse' });
  for (const l of layers) bar.append(h('i', { class: `bg-${l.kind}`, style: { flex: `${Math.max(l.bytes, 1)} 0 0` }, title: `${l.name}: ${l.bytes} Byte` }));
  el.append(bar, h('div', { class: 'bytelegend' }, h('span', {}, '0'), h('span', {}, `${total} Byte`)));
  if (entry.trace && onTrace) el.append(h('div', { class: 'row', style: { margin: '6px 0' } },
    h('button', { class: 'btn', onclick: () => onTrace(entry.trace) }, 'Weg dieses Pakets verfolgen')));
  for (const l of layers) {
    const d = h('details', { class: `layer lc-${l.kind}${l.depth ? ' inner' : ''}`, open: l.depth === 0 && ['ip', 'arp', 'vxlan', 'icmp'].includes(l.kind) ? true : null });
    d.append(h('summary', {}, l.name, h('span', { class: 'b' }, `${l.bytes} Byte`)));
    const t = h('table');
    for (const [k, v, hint] of l.fields) t.append(h('tr', {}, h('td', {}, k), h('td', { class: 'v' }, v), h('td', { class: 'h' }, hint || '')));
    d.append(t);
    el.append(d);
  }
}
export { esc };
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/lab.js" <<'__PACKETPILOT_FILE_END__'
// Labor: Netzplan-Editor, Animation, Seitenpanel, Protokoll und Inspektor
import { Sim, PORTS, TYPE_NAMES, TIMING, newId, normalizeDevice, traceOf, STP_TEXT } from './engine.js';
import { layerKinds, shortLabel } from './packets.js';
import { isIp } from './net.js';
import { h, svgEl, toast, iconBtn } from './ui.js';
import { I, DEV_ICON } from './icons.js';
import { renderInspector } from './inspector.js';
import { configPanel, tablesPanel, consolePanel } from './panels.js';

const CARD_W = 76, CARD_H = 60;
const NAME_PREFIX = { pc: 'pc', server: 'srv', router: 'r', switch: 'sw', vtep: 'vtep' };
export const ZONE_COLORS = [['blue', 'Blau'], ['violet', 'Violett'], ['green', 'Grün'], ['orange', 'Orange'], ['pink', 'Pink'], ['yellow', 'Gelb'], ['gray', 'Grau']];
const KIND_COLOR = { vlan: 'violet', overlay: 'pink', underlay: 'blue' };
export const zoneColor = z => z.color || KIND_COLOR[z.kind] || 'gray';

export class Lab {
  /**
   * @param {HTMLElement} root
   * @param {object} opts { topo, edit: 'full'|'config'|'view', palette: [...types], compact, onEvent, consolePresets }
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = { edit: 'full', palette: ['pc', 'server', 'switch', 'router', 'vtep'], ...opts };
    this.listeners = new Set();
    if (opts.onEvent) this.listeners.add(opts.onEvent);
    this.sel = null; this.connectFrom = null; this.connectMode = false;
    this.playing = true; this.msPerHop = opts.msPerHop || 550; this.lastTs = 0; this.idleUntil = 0;
    this.traceId = null; this.logFilter = 'all'; this.selectedLog = null; this.showBpdu = true;
    this.view = { x: 0, y: 0, w: 900, h: 520 };
    this.pktEls = new Map();
    this.tab = 'config';
    this.build();
    this.load(opts.topo || { name: 'Neues Netz', devices: [], links: [] }, true);
    this.raf = requestAnimationFrame(t => this.loop(t));
    this.keyHandler = e => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.ro = new ResizeObserver(() => this.fit(false));
    this.ro.observe(this.canvasWrap);
  }
  emit(type, data) { for (const fn of this.listeners) fn(type, data, this); }
  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler);
    this.ro.disconnect();
    this.unsub?.();
    this.root.innerHTML = '';
  }
  get canEditTopo() { return this.opts.edit === 'full'; }
  get canConfig() { return this.opts.edit !== 'view'; }

  // ------------------------------------------------------------ Aufbau
  build() {
    const o = this.opts;
    this.root.innerHTML = '';
    this.el = h('div', { class: `lab${o.compact ? ' compact' : ''}${this.canEditTopo ? '' : ' no-palette'}` });
    // Palette
    this.palette = h('div', { class: 'palette', 'aria-label': 'Geräte' });
    if (this.canEditTopo) {
      for (const t of o.palette) {
        const it = h('button', { class: 'pal-item', draggable: 'true', title: `${TYPE_NAMES[t]} hinzufügen (ziehen oder klicken)` },
          h('span', { html: `<svg viewBox="0 0 40 40">${DEV_ICON[t]}</svg>` }), TYPE_NAMES[t]);
        it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pp-device', t); e.dataTransfer.effectAllowed = 'copy'; });
        it.addEventListener('click', () => this.addDevice(t));
        this.palette.append(it);
      }
      this.palette.append(h('div', { class: 'pal-sep' }));
      this.cableBtn = h('button', { class: 'pal-item', title: 'Kabel ziehen: erst ein Gerät, dann das zweite anklicken (Taste K)', html: `<span>${I.cable}</span>Kabel`,
        onclick: () => this.setConnect(!this.connectMode) });
      this.palette.append(this.cableBtn);
      const area = h('button', { class: 'pal-item', draggable: 'true', title: 'Bereich zum Ordnen: farbiges Rechteck mit Beschriftung (ziehen oder klicken)', html: `<span>${I.area}</span>Bereich` });
      area.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pp-device', 'zone'); e.dataTransfer.effectAllowed = 'copy'; });
      area.addEventListener('click', () => this.addZone());
      this.palette.append(area);
    }
    // Canvas
    this.canvasWrap = h('div', { class: 'canvas-wrap' });
    this.svg = svgEl('svg', { class: `net${this.canEditTopo ? '' : ' ro'}`, role: 'img', 'aria-label': 'Netzplan' });
    this.gZones = svgEl('g'); this.gLinks = svgEl('g'); this.gDevs = svgEl('g'); this.gPkts = svgEl('g');
    this.svg.append(this.gZones, this.gLinks, this.gDevs, this.gPkts);
    this.canvasWrap.append(this.svg);
    this.bindCanvas();
    // Player
    this.playBtn = iconBtn(I.pause, 'Anhalten (Leertaste)', () => this.setPlaying(!this.playing));
    this.timeEl = h('span', { class: 'time' }, 't = 0.0000 s');
    const speed = h('input', { type: 'range', min: '0', max: '100', value: String(this.speedToSlider(this.msPerHop)), 'aria-label': 'Tempo' });
    this.speedLbl = h('span', { class: 'speedlbl' });
    speed.addEventListener('input', () => { this.msPerHop = this.sliderToSpeed(Number(speed.value)); this.showSpeed(); });
    this.showSpeed();
    this.player = h('div', { class: 'player' },
      h('div', { class: 'bar' }, this.playBtn,
        iconBtn(I.step, 'Nächstes Ereignis (Pfeil rechts)', () => this.stepOnce()),
        iconBtn(I.ffwd, '5 Sekunden vorspulen, ohne Animation (z. B. für STP-Timer)', () => this.fastForward(5000)),
        iconBtn(I.reset, 'Zustand zurücksetzen: Tabellen, Pakete und Protokoll leeren', () => this.resetState()),
        this.timeEl),
      h('div', { class: 'bar' }, h('span', { class: 'speedlbl', style: { paddingLeft: '6px' } }, 'Tempo'), speed, this.speedLbl),
      this.bpduBar = h('div', { class: 'bar hidden' }, this.bpduBtn = h('button', { class: 'tog on', title: 'BPDUs im Netzplan zeigen oder ausblenden', onclick: () => this.toggleBpdu() }, 'BPDUs')),
      h('span', { class: 'grow' }),
      h('div', { class: 'bar' }, iconBtn(I.fit, 'Ansicht einpassen', () => this.fit(true))));
    this.canvasWrap.append(this.player);
    this.overlay = h('div', { class: 'hint-overlay hidden' });
    this.stormEl = h('div', { class: 'storm hidden', role: 'alert' });
    this.canvasWrap.append(this.overlay, this.stormEl);
    // Seitenpanel
    this.side = h('div', { class: 'side' });
    // Dock
    this.logEl = h('div', { class: 'log', role: 'log' });
    this.filterSel = h('select', { class: 'input', 'aria-label': 'Protokoll filtern' });
    this.filterSel.addEventListener('change', () => { this.logFilter = this.filterSel.value; if (this.logFilter !== 'trace') this.setTrace(null); this.renderLog(); });
    this.inspEl = h('div', { class: 'inspector' });
    this.dock = h('div', { class: 'dock' },
      h('div', { class: 'dock-col' }, h('div', { class: 'dock-head' }, 'Ereignisse', h('span', { class: 'grow' }), this.filterSel,
        iconBtn(I.trash, 'Protokoll leeren', () => { this.sim.log = []; this.renderLog(); })), this.logEl),
      h('div', { class: 'dock-col' }, h('div', { class: 'dock-head' }, 'Paketinspektor'), this.inspEl));
    this.el.append(this.palette, this.canvasWrap, this.side, this.dock);
    this.root.append(this.el);
    renderInspector(this.inspEl, null);
  }
  speedToSlider(ms) { return Math.round(100 - (Math.log(ms / 60) / Math.log(4000 / 60)) * 100); }
  sliderToSpeed(v) { return Math.round(60 * Math.pow(4000 / 60, (100 - v) / 100)); }
  showSpeed() { this.speedLbl.textContent = `${(this.msPerHop / 1000).toFixed(this.msPerHop < 1000 ? 2 : 1)} s pro Kabel`; }

  // ------------------------------------------------------------ Laden
  load(topo, first = false) {
    this.unsub?.();
    this.topo = topo;
    topo.devices.forEach(normalizeDevice);
    topo.links.forEach(l => { l.mtu ??= 1500; l.up ??= true; l.id ??= newId('l'); });
    topo.zones ??= [];
    topo.zones.forEach(z => { z.id ??= newId('z'); });
    this.sim = new Sim(topo);
    this.unsub = this.sim.on((type, data) => this.onSim(type, data));
    this.sel = null; this.traceId = null; this.selectedLog = null;
    this.pktEls.forEach(e => e.remove()); this.pktEls.clear();
    this.render();
    this.fit(true);
    this.updateBpduBar();
    this.showStorm(null);
    this.renderSide();
    this.renderLog();
    renderInspector(this.inspEl, null);
    if (!first) this.emit('loaded');
  }
  resetState() {
    this.sim.reset();
    this.pktEls.forEach(e => e.remove()); this.pktEls.clear();
    this.setTrace(null);
    this.renderLog(); this.renderSide(); renderInspector(this.inspEl, null);
    this.showStorm(null); this.render();
    toast('Zustand zurückgesetzt: ARP- und MAC-Tabellen sind leer');
    this.emit('reset');
  }
  onSim(type, data) {
    if (type === 'log') {
      this.queueLog(data);
      if (data.tag && (data.tag.startsWith('stp-') || data.tag === 'link-up' || data.tag === 'link-down')) this.renderSoon();
    }
    if (type === 'halted') this.showStorm(data);
    if (type === 'console' && this.sel?.kind === 'dev' && this.sel.id === data.devId && this.tab === 'console') this.consoleEl?.refresh();
    if (type === 'config') { this.render(); this.refreshSideSoon(); this.updateBpduBar(); }
    if (type === 'topology') this.render();
    this.emit('sim', { type, data });
  }

  // ------------------------------------------------------------ Darstellung Netzplan
  devPos(d) { return { x: d.x ?? 0, y: d.y ?? 0 }; }
  render() {
    const topo = this.sim.topo;
    this.gLinks.innerHTML = ''; this.gDevs.innerHTML = ''; this.gZones.innerHTML = '';
    for (const z of topo.zones || []) this.gZones.append(this.zoneEl(z));
    const byId = new Map(topo.devices.map(d => [d.id, d]));
    for (const l of topo.links) {
      const A = byId.get(l.a.dev), B = byId.get(l.b.dev);
      if (!A || !B) continue;
      const g = svgEl('g', { class: `lnk-g${this.sel?.kind === 'link' && this.sel.id === l.id ? ' sel' : ''}`, 'data-id': l.id });
      const line = svgEl('line', { class: `lnk${l.up ? '' : ' down'}${l.mtu > 1500 ? ' jumbo' : ''}`, x1: A.x, y1: A.y, x2: B.x, y2: B.y });
      const hit = svgEl('line', { class: 'lnk-hit', x1: A.x, y1: A.y, x2: B.x, y2: B.y });
      hit.addEventListener('pointerdown', e => { e.stopPropagation(); this.select({ kind: 'link', id: l.id }); });
      g.append(line, hit);
      const lbl = (P, Q, name) => {
        const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy) || 1;
        // Nach unten weg: unter Name und Adresse des Geräts hindurch
        const down = dy / len > 0.7;
        const off = Math.min(down ? 86 : 58, len * (down ? 0.45 : 0.32));
        const t = svgEl('text', { class: 'iflbl', x: P.x + dx / len * off + (-dy / len) * 9, y: P.y + dy / len * off + (dx / len) * 9 + 3, 'text-anchor': 'middle' });
        t.textContent = name; return t;
      };
      g.append(lbl(A, B, l.a.if), lbl(B, A, l.b.if));
      for (const [P, Q, end] of [[A, B, l.a], [B, A, l.b]]) {
        const br = this.sim.dev(end.dev)?.bridge;
        if (!br?.stp || P.type !== 'switch') continue;
        const ps = br.stp.ports.get(end.if);
        if (!ps) continue;
        const dx = Q.x - P.x, dy = Q.y - P.y, len = Math.hypot(dx, dy) || 1, off = Math.min(42, len * 0.22);
        const dot = svgEl('g', { class: `stp-dot st-${ps.state}`, transform: `translate(${(P.x + dx / len * off).toFixed(1)},${(P.y + dy / len * off).toFixed(1)})` });
        const tt = svgEl('title'); tt.textContent = `${P.name} ${end.if}: ${STP_TEXT.ROLE_DE[ps.role]}, ${STP_TEXT.STATE_DE[ps.state]}${ps.edge ? ', Edge-Port' : ''}`;
        const letter = svgEl('text', { 'text-anchor': 'middle', y: 2.7 }); letter.textContent = { root: 'R', designated: 'D', alternate: 'A', disabled: '' }[ps.role];
        dot.append(tt, svgEl('circle', { r: 6 }), letter);
        g.append(dot);
      }
      if (l.mtu !== 1500) {
        const t = svgEl('text', { class: 'mtulbl', x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 7, 'text-anchor': 'middle' });
        t.textContent = `MTU ${l.mtu}`; g.append(t);
      }
      this.gLinks.append(g);
    }
    const traceDevs = this.traceId ? new Set(this.sim.log.filter(e => e.trace === this.traceId).map(e => e.devId)) : null;
    for (const d of topo.devices) {
      const sel = this.sel?.kind === 'dev' && this.sel.id === d.id;
      const g = svgEl('g', { class: `dev t-${d.type}${sel ? ' sel' : ''}${this.connectFrom === d.id ? ' pend' : ''}${traceDevs?.has(d.id) ? ' trace' : ''}`,
        transform: `translate(${d.x - CARD_W / 2},${d.y - CARD_H / 2})`, tabindex: '0', 'data-id': d.id, role: 'button', 'aria-label': `${TYPE_NAMES[d.type]} ${d.name}` });
      g.append(svgEl('rect', { class: 'card', width: CARD_W, height: CARD_H, rx: 10 }));
      const ic = svgEl('g', { transform: `translate(${CARD_W / 2 - 20},${CARD_H / 2 - 22})` });
      ic.innerHTML = DEV_ICON[d.type];
      g.append(ic);
      const nm = svgEl('text', { class: 'nm', x: CARD_W / 2, y: CARD_H + 15 }); nm.textContent = d.name; g.append(nm);
      const ip = this.primaryIp(d);
      if (ip) { const t = svgEl('text', { class: 'ip', x: CARD_W / 2, y: CARD_H + 28 }); t.textContent = ip; g.append(t); }
      const st = d.type === 'switch' ? this.sim.dev(d.id)?.bridge?.stpTable() : null;
      if (st) { const t = svgEl('text', { class: 'stpbadge', x: CARD_W / 2, y: CARD_H + 28 }); t.textContent = st.isRoot ? `Root Bridge, Prio ${d.stp.priority}` : `STP, Prio ${d.stp.priority}`; g.append(t); }
      g.addEventListener('pointerdown', e => this.devPointerDown(e, d));
      g.addEventListener('dblclick', () => { this.select({ kind: 'dev', id: d.id }); this.setTab('console'); });
      g.addEventListener('keydown', e => { if (e.key === 'Enter') this.select({ kind: 'dev', id: d.id }); });
      this.gDevs.append(g);
    }
    this.updateOverlay();
  }
  primaryIp(d) {
    if (d.type === 'pc' || d.type === 'server') {
      const i = d.ifaces.eth1; return isIp(i.ip) ? `${i.ip}/${i.prefix}${i.vlan ? ', VLAN ' + i.vlan : ''}` : '';
    }
    if (d.type === 'vtep') return isIp(d.ifaces.lo?.ip) ? `lo ${d.ifaces.lo.ip}` : '';
    if (d.type === 'router') {
      const n = Object.values(d.ifaces).filter(i => isIp(i.ip)).length;
      const sub = Object.values(d.ifaces).filter(i => i.parent).length;
      return sub ? `${sub} Subinterface${sub > 1 ? 's' : ''}` : n ? `${n} Adressen` : '';
    }
    return '';
  }
  fit(force) {
    const r = this.canvasWrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ds = this.sim?.topo.devices || [];
    if (!force && this.fitted) { this.view.h = this.view.w * r.height / r.width; this.applyView(); return; }
    this.fitted = true;
    if (!ds.length) { this.view = { x: 0, y: 0, w: r.width, h: r.height }; this.applyView(); return; }
    const xs = ds.map(d => d.x), ys = ds.map(d => d.y);
    let minX = Math.min(...xs) - 90, maxX = Math.max(...xs) + 90, minY = Math.min(...ys) - 100, maxY = Math.max(...ys) + 80;
    for (const z of this.sim.topo.zones || []) { minX = Math.min(minX, z.x - 20); minY = Math.min(minY, z.y - 20); maxX = Math.max(maxX, z.x + z.w + 20); maxY = Math.max(maxY, z.y + z.h + 20); }
    let w = Math.max(maxX - minX, 420), hh = Math.max(maxY - minY, 260);
    const ar = r.width / r.height;
    if (w / hh > ar) hh = w / ar; else w = hh * ar;
    this.view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - hh / 2 - 16, w, h: hh };
    this.applyView();
  }
  applyView() { this.svg.setAttribute('viewBox', `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`); }
  toSvg(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: this.view.x + (e.clientX - r.left) / r.width * this.view.w, y: this.view.y + (e.clientY - r.top) / r.height * this.view.h };
  }

  // ------------------------------------------------------------ Interaktion
  bindCanvas() {
    this.svg.addEventListener('pointerdown', e => {
      if (e.target !== this.svg) return;
      this.select(null);
      if (this.connectMode) { this.connectFrom = null; this.render(); }
      const start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      const r = this.svg.getBoundingClientRect();
      const move = ev => {
        this.view.x = start.vx - (ev.clientX - start.x) / r.width * this.view.w;
        this.view.y = start.vy - (ev.clientY - start.y) / r.height * this.view.h;
        this.applyView();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    this.svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.toSvg(e);
      const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const w = Math.min(4000, Math.max(240, this.view.w * k));
      const f = w / this.view.w;
      this.view = { x: p.x - (p.x - this.view.x) * f, y: p.y - (p.y - this.view.y) * f, w, h: this.view.h * f };
      this.applyView();
    }, { passive: false });
    this.canvasWrap.addEventListener('dragover', e => { if (this.canEditTopo) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    this.canvasWrap.addEventListener('drop', e => {
      const t = e.dataTransfer.getData('text/pp-device');
      if (!t || !this.canEditTopo) return;
      e.preventDefault();
      const p = this.toSvg(e);
      if (t === 'zone') return this.addZone(Math.round(p.x / 12) * 12, Math.round(p.y / 12) * 12);
      this.addDevice(t, Math.round(p.x / 12) * 12, Math.round(p.y / 12) * 12);
    });
  }
  devPointerDown(e, d) {
    e.stopPropagation();
    if (this.connectMode) return this.connectClick(d);
    this.select({ kind: 'dev', id: d.id });
    if (!this.canEditTopo && this.opts.edit !== 'config') return;
    const start = this.toSvg(e), ox = d.x, oy = d.y;
    let moved = false;
    const move = ev => {
      const p = this.toSvg(ev);
      const nx = Math.round((ox + p.x - start.x) / 12) * 12, ny = Math.round((oy + p.y - start.y) / 12) * 12;
      if (nx !== d.x || ny !== d.y) { d.x = nx; d.y = ny; moved = true; this.render(); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) this.emit('moved'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  setConnect(on) {
    if (!this.canEditTopo) return;
    this.connectMode = on; this.connectFrom = null;
    this.cableBtn?.classList.toggle('on', on);
    this.canvasWrap.classList.toggle('connecting', on);
    this.render();
  }
  connectClick(d) {
    if (!this.connectFrom) { this.connectFrom = d.id; this.render(); return; }
    if (this.connectFrom === d.id) { this.connectFrom = null; this.render(); return; }
    const a = this.connectFrom, b = d.id;
    const pa = this.pickPort(a, b), pb = this.pickPort(b, a);
    const A = this.sim.dev(a), B = this.sim.dev(b);
    if (!pa || !pb) { toast(`${!pa ? A.name : B.name} hat keinen freien Port mehr`); this.connectFrom = null; this.render(); return; }
    const l = this.sim.addLink({ id: newId('l'), a: { dev: a, if: pa }, b: { dev: b, if: pb }, mtu: 1500, up: true });
    this.connectFrom = null;
    toast(`${A.name} ${pa} ↔ ${B.name} ${pb} verbunden`);
    this.render();
    this.emit('linked', l);
  }
  pickPort(devId, otherId) {
    const d = this.sim.dev(devId), o = this.sim.dev(otherId);
    const free = PORTS[d.type].filter(p => !this.sim.linkAt(devId, p));
    if (d.type === 'vtep') {
      const wantsUplink = o.type === 'router' || o.type === 'vtep';
      if (wantsUplink && free.includes('eth1')) return 'eth1';
      return free.find(p => p !== 'eth1') || free[0] || null;
    }
    return free[0] || null;
  }
  addDevice(type, x, y) {
    if (!this.canEditTopo) return;
    const pre = NAME_PREFIX[type];
    let n = 1;
    while (this.sim.topo.devices.some(d => d.name === pre + n)) n++;
    if (x === undefined) {
      x = Math.round((this.view.x + this.view.w / 2 + (Math.random() - .5) * 120) / 12) * 12;
      y = Math.round((this.view.y + this.view.h / 2 + (Math.random() - .5) * 80) / 12) * 12;
    }
    const cfg = normalizeDevice({ id: newId(), type, name: pre + n, x, y });
    this.sim.addDevice(cfg);
    this.select({ kind: 'dev', id: cfg.id });
    this.emit('added', cfg);
  }
  // ------------------------------------------------------------ Bereiche
  zoneEl(z) {
    const sel = this.sel?.kind === 'zone' && this.sel.id === z.id;
    const g = svgEl('g', { class: `zone-g c-${zoneColor(z)}${sel ? ' sel' : ''}`, 'data-id': z.id });
    g.append(svgEl('rect', { class: 'zone', x: z.x, y: z.y, width: z.w, height: z.h, rx: 14 }));
    const label = z.label || 'Bereich';
    const tw = Math.min(z.w - 16, label.length * 6.3 + 18);
    const tab = svgEl('rect', { class: 'zone-tab', x: z.x + 8, y: z.y + 8, width: Math.max(30, tw), height: 20, rx: 6 });
    const t = svgEl('text', { class: 'zone-t', x: z.x + 17, y: z.y + 22 }); t.textContent = label;
    g.append(tab, t);
    if (this.canEditTopo) {
      tab.addEventListener('pointerdown', e => this.zonePointer(e, z, 'move'));
      tab.addEventListener('dblclick', () => { this.select({ kind: 'zone', id: z.id }); setTimeout(() => this.side.querySelector('input')?.focus(), 30); });
      const rs = svgEl('rect', { class: 'zone-rs', x: z.x + z.w - 13, y: z.y + z.h - 13, width: 11, height: 11, rx: 3 });
      rs.addEventListener('pointerdown', e => this.zonePointer(e, z, 'resize'));
      g.append(rs);
    }
    return g;
  }
  zonePointer(e, z, mode) {
    e.stopPropagation();
    this.select({ kind: 'zone', id: z.id });
    const start = this.toSvg(e), o = { x: z.x, y: z.y, w: z.w, h: z.h };
    const inside = mode === 'move' ? this.sim.topo.devices.filter(d => d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h).map(d => [d, d.x, d.y]) : [];
    const snap = v => Math.round(v / 12) * 12;
    let moved = false;
    const move = ev => {
      const p = this.toSvg(ev), dx = p.x - start.x, dy = p.y - start.y;
      if (mode === 'move') {
        const nx = snap(o.x + dx), ny = snap(o.y + dy);
        if (nx === z.x && ny === z.y) return;
        const mx = nx - o.x, my = ny - o.y;
        z.x = nx; z.y = ny;
        for (const [d, x, y] of inside) { d.x = x + mx; d.y = y + my; }
      } else {
        const nw = Math.max(120, snap(o.w + dx)), nh = Math.max(72, snap(o.h + dy));
        if (nw === z.w && nh === z.h) return;
        z.w = nw; z.h = nh;
      }
      moved = true; this.render();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) this.emit('moved'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  addZone(x, y) {
    if (!this.canEditTopo) return;
    const w = 312, hh = 204;
    if (x === undefined) { x = this.view.x + this.view.w / 2; y = this.view.y + this.view.h / 2; }
    const used = new Set((this.sim.topo.zones || []).map(zz => zoneColor(zz)));
    const color = (ZONE_COLORS.find(([k]) => !used.has(k)) || ZONE_COLORS[0])[0];
    const z = { id: newId('z'), x: Math.round((x - w / 2) / 12) * 12, y: Math.round((y - hh / 2) / 12) * 12, w, h: hh, label: `Bereich ${(this.sim.topo.zones || []).length + 1}`, color };
    this.sim.topo.zones.push(z);
    this.render();
    this.select({ kind: 'zone', id: z.id });
    this.emit('added', z);
  }
  renderZoneSide() {
    const z = this.sim.topo.zones.find(x => x.id === this.sel.id);
    if (!z) { this.sel = null; return this.renderSide(); }
    const name = h('input', { class: 'input', value: z.label || '', placeholder: 'z. B. VLAN 10, Büro, Underlay', disabled: this.canEditTopo ? null : true });
    name.addEventListener('input', () => { z.label = name.value; this.render(); });
    name.addEventListener('change', () => this.emit('moved'));
    const sw = h('div', { class: 'swatches' });
    for (const [k, t] of ZONE_COLORS) {
      const b = h('button', { class: `swatch${zoneColor(z) === k ? ' cur' : ''}`, title: t, 'aria-label': t, style: { background: k === 'gray' ? 'var(--ink-3)' : `var(--l-${{ blue: 'eth', violet: 'vlan', green: 'ip', orange: 'arp', pink: 'vxlan', yellow: 'stp' }[k]})` },
        onclick: () => { z.color = k; delete z.kind; this.render(); this.renderSide(); this.emit('moved'); } });
      if (!this.canEditTopo) b.disabled = true;
      sw.append(b);
    }
    const inside = this.sim.topo.devices.filter(d => d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h);
    this.side.append(h('div', { class: 'side-head' }, h('span', { html: I.area }), h('div', { class: 'grow', style: { fontWeight: 650 } }, 'Bereich'),
      this.canEditTopo ? iconBtn(I.trash, 'Bereich entfernen (Entf), die Geräte bleiben', () => this.deleteSelected(), 'danger') : null), h('div'),
      h('div', { class: 'side-body' },
        h('h4', {}, 'Beschriftung'), name,
        h('h4', {}, 'Farbe'), sw,
        h('h4', {}, 'Inhalt'),
        h('p', { class: 'small' }, inside.length ? inside.map(d => d.name).join(', ') : 'Keine Geräte in diesem Bereich.'),
        h('p', { class: 'small muted' }, 'Bereiche dienen nur der Ordnung und haben keinen Einfluss auf die Simulation. Am Reiter verschieben (Geräte darin wandern mit), an der Ecke unten rechts die Grösse ändern.')));
  }

  deleteSelected() {
    if (!this.canEditTopo || !this.sel) return;
    if (this.sel.kind === 'zone') { this.sim.topo.zones = this.sim.topo.zones.filter(z => z.id !== this.sel.id); this.select(null); this.render(); this.emit('deleted'); return; }
    if (this.sel.kind === 'dev') { const n = this.sim.dev(this.sel.id)?.name; this.sim.removeDevice(this.sel.id); toast(`${n} entfernt`); }
    else this.sim.removeLink(this.sel.id);
    this.select(null);
    this.emit('deleted');
  }
  onKey(e) {
    if (!this.root.isConnected) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    if (e.key === ' ') { e.preventDefault(); this.setPlaying(!this.playing); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); this.stepOnce(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSelected(); }
    else if (e.key === 'k' || e.key === 'K') this.setConnect(!this.connectMode);
    else if (e.key === 'Escape') { this.setConnect(false); this.select(null); }
  }
  select(s) {
    const same = JSON.stringify(s) === JSON.stringify(this.sel);
    this.sel = s;
    this.markSelection();
    if (!same) this.renderSide();
    if (s) this.emit('select', s);
  }
  markSelection() {
    this.gDevs.querySelectorAll('.dev').forEach(g => g.classList.toggle('sel', this.sel?.kind === 'dev' && g.dataset.id === this.sel.id));
    this.gLinks.querySelectorAll('.lnk-g').forEach(g => g.classList.toggle('sel', this.sel?.kind === 'link' && g.dataset.id === this.sel.id));
    this.gZones.querySelectorAll('.zone-g').forEach(g => g.classList.toggle('sel', this.sel?.kind === 'zone' && g.dataset.id === this.sel.id));
  }
  updateOverlay() {
    let msg = '';
    if (this.connectMode) msg = this.connectFrom ? 'Jetzt das zweite Gerät anklicken' : 'Kabel: erstes Gerät anklicken (Esc beendet)';
    else if (!this.sim.topo.devices.length && this.canEditTopo) msg = 'Ziehe Geräte aus der linken Leiste auf den Plan';
    this.overlay.textContent = msg;
    this.overlay.classList.toggle('hidden', !msg);
  }

  // ------------------------------------------------------------ Seitenpanel
  setTab(t) { this.tab = t; this.renderSide(); if (t === 'console') setTimeout(() => this.consoleEl?.focusInput(), 30); }
  refreshSideSoon() {
    if (this.sideTimer) return;
    this.sideTimer = setTimeout(() => { this.sideTimer = null; if (this.tab === 'tables') this.renderSide(); }, 250);
  }
  renderSide() {
    const side = this.side;
    side.innerHTML = '';
    this.consoleEl = null;
    if (!this.sel) {
      side.append(h('div', { class: 'side-head' }, h('div', {},
        h('div', { style: { fontWeight: 650 } }, this.sim.topo.name || 'Netz'),
        h('div', { class: 'small muted' }, `${this.sim.topo.devices.length} Geräte, ${this.sim.topo.links.length} Kabel`))));
      side.append(h('div'));
      side.append(h('div', { class: 'side-body' },
        h('h4', {}, 'So bedienst du das Labor'),
        h('ul', { class: 'small', style: { paddingLeft: '18px', margin: 0, display: 'grid', gap: '6px' } },
          this.canEditTopo ? h('li', {}, 'Geräte aus der linken Leiste auf den Plan ziehen.') : null,
          this.canEditTopo ? h('li', {}, 'Kabel (Taste K): erst ein Gerät, dann das zweite anklicken. Freie Ports werden automatisch gewählt.') : null,
          this.canEditTopo ? h('li', {}, 'Bereiche ordnen den Plan: farbige Rechtecke mit Beschriftung, am Reiter verschieben, an der Ecke vergrössern.') : null,
          h('li', {}, 'Gerät anklicken: Konfiguration, Tabellen und Konsole erscheinen hier. Doppelklick öffnet direkt die Konsole.'),
          h('li', {}, 'In der Konsole z. B. ping 10.0.0.2 eingeben und zuschauen, wie die Pakete reisen.'),
          h('li', {}, 'Leertaste hält die Zeit an, Pfeil rechts geht ein Ereignis weiter. Mit dem Tempo-Regler stellst du den Zeitraffer ein.'),
          h('li', {}, 'Ein Paket anklicken zerlegt es im Paketinspektor in seine Schichten.')),
        h('h4', {}, 'Farben der Schichten'),
        h('div', { class: 'row small' }, ...[['eth', 'Ethernet'], ['vlan', '802.1Q'], ['arp', 'ARP'], ['stp', 'STP'], ['ip', 'IPv4'], ['icmp', 'ICMP'], ['udp', 'UDP'], ['tcp', 'TCP'], ['vxlan', 'VXLAN']]
          .map(([k, n]) => h('span', { class: 'chip' }, h('i', { class: `bg-${k}`, style: { width: '10px', height: '10px', borderRadius: '2px', display: 'inline-block' } }), n)))));
      return;
    }
    if (this.sel.kind === 'link') return this.renderLinkSide();
    if (this.sel.kind === 'zone') return this.renderZoneSide();
    const dev = this.sim.dev(this.sel.id);
    if (!dev) { this.sel = null; return this.renderSide(); }
    const nameIn = h('input', { class: 'name', value: dev.name, 'aria-label': 'Gerätename', disabled: this.canEditTopo ? null : true });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim().replace(/\s+/g, '-');
      if (!v || this.sim.topo.devices.some(d => d !== dev.cfg && d.name === v)) { nameIn.value = dev.name; return toast('Name leer oder schon vergeben'); }
      dev.cfg.name = v; this.render(); this.emit('renamed');
    });
    side.append(h('div', { class: 'side-head' },
      h('span', { class: 'devglyph', html: `<svg viewBox="0 0 40 40" width="34" height="34">${DEV_ICON[dev.type]}</svg>` }),
      h('div', { class: 'grow' }, nameIn, h('div', { class: 'small muted', style: { paddingLeft: '5px' } }, TYPE_NAMES[dev.type])),
      this.canEditTopo ? iconBtn(I.trash, 'Gerät entfernen (Entf)', () => this.deleteSelected(), 'danger') : null));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const [k, label, icon] of [['config', 'Konfiguration', I.sliders], ['tables', 'Tabellen', I.table], ['console', 'Konsole', I.terminal]]) {
      tabs.append(h('button', { class: this.tab === k ? 'cur' : '', role: 'tab', 'aria-selected': this.tab === k ? 'true' : 'false', html: icon + label, onclick: () => this.setTab(k) }));
    }
    side.append(tabs);
    const body = h('div', { class: 'side-body' });
    if (this.tab === 'config') body.append(configPanel(dev, { sim: this.sim, locked: !this.canConfig, rerender: () => this.renderSide(), changed: msg => { this.sim.configChanged(dev.id); this.emit('config', { dev: dev.id, msg }); } }));
    if (this.tab === 'tables') body.append(tablesPanel(dev, this.sim));
    if (this.tab === 'console') { this.consoleEl = consolePanel(dev, this.sim, this.opts.consolePresets?.[dev.name] || []); body.append(this.consoleEl); body.style.overflow = 'hidden'; }
    side.append(body);
  }
  renderLinkSide() {
    const l = this.sim.topo.links.find(x => x.id === this.sel.id);
    if (!l) { this.sel = null; return this.renderSide(); }
    const A = this.sim.dev(l.a.dev), B = this.sim.dev(l.b.dev);
    const mtu = h('input', { class: 'input mono', type: 'number', min: '576', max: '9216', value: l.mtu, disabled: this.canConfig ? null : true });
    mtu.addEventListener('change', () => {
      const v = Number(mtu.value);
      if (!(v >= 576 && v <= 9216)) { mtu.classList.add('bad'); return; }
      l.mtu = v; mtu.classList.remove('bad'); this.render(); this.sim.emit('config', null); this.emit('config', { link: l.id, msg: `MTU ${v}` });
    });
    const up = h('input', { type: 'checkbox', checked: l.up ? true : null, disabled: this.canConfig ? null : true });
    up.addEventListener('change', () => { this.sim.setLinkUp(l, up.checked); this.render(); this.emit('config', { link: l.id, msg: up.checked ? 'Link an' : 'Link aus' }); });
    this.side.append(h('div', { class: 'side-head' }, h('span', { html: I.cable }), h('div', { class: 'grow', style: { fontWeight: 650 } }, 'Kabel'),
      this.canEditTopo ? iconBtn(I.trash, 'Kabel entfernen (Entf)', () => this.deleteSelected(), 'danger') : null), h('div'),
      h('div', { class: 'side-body' },
        h('dl', { class: 'kv' }, h('dt', {}, 'Seite A'), h('dd', {}, `${A.name} ${l.a.if}`), h('dt', {}, 'Seite B'), h('dd', {}, `${B.name} ${l.b.if}`)),
        h('h4', {}, 'MTU (Byte Nutzlast pro Frame)'), mtu,
        h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Beide Enden verwenden diese MTU. Frames mit grösserer Nutzlast gehen auf diesem Kabel verloren.'),
        h('label', { class: 'row', style: { marginTop: '10px' } }, up, 'Link aktiv (Kabel eingesteckt)')));
  }

  // ------------------------------------------------------------ Protokoll
  queueLog(e) {
    this.pendingLog ??= [];
    this.pendingLog.push(e);
    if (!this.logTimer) this.logTimer = setTimeout(() => { this.logTimer = null; const p = this.pendingLog; this.pendingLog = []; this.appendLog(p); }, 60);
  }
  logVisible(e) {
    if (this.logFilter === 'all') return e.tag !== 'bpdu-sent';
    if (this.logFilter === 'bpdu') return true;
    if (this.logFilter === 'stp') return e.stp && e.tag !== 'bpdu-sent' || e.tag === 'loop-detected' || e.tag === 'storm' || e.tag === 'mac-flap';
    if (this.logFilter === 'nosend') return e.kind !== 'send';
    if (this.logFilter === 'trace') return e.trace === this.traceId;
    if (this.logFilter.startsWith('dev:')) return e.devId === this.logFilter.slice(4);
    return true;
  }
  logRow(e) {
    const row = h('div', { class: `e k-${e.kind}${e.frame ? ' has-frame' : ''}${this.selectedLog === e.seq ? ' sel' : ''}`, 'data-seq': e.seq },
      h('span', { class: 't' }, (e.t / 1000).toFixed(4)), h('span', { class: 'd', title: e.dev }, e.dev), h('span', { class: 'x' }, e.text));
    if (e.frame) row.addEventListener('click', () => this.inspect(e));
    return row;
  }
  renderLog() {
    const opts = [['all', 'Alle Ereignisse'], ['nosend', 'Nur Entscheidungen']];
    if (this.sim.topo.devices.some(d => d.type === 'switch' && d.stp?.enabled) || this.logFilter === 'stp' || this.logFilter === 'bpdu') opts.push(['stp', 'Nur Spanning Tree'], ['bpdu', 'Alles, auch BPDU-Versand']);
    if (this.traceId) opts.push(['trace', 'Verfolgtes Paket']);
    for (const d of this.sim.topo.devices) opts.push(['dev:' + d.id, `Nur ${d.name}`]);
    this.filterSel.innerHTML = '';
    for (const [v, t] of opts) this.filterSel.append(h('option', { value: v, selected: v === this.logFilter ? true : null }, t));
    this.logEl.innerHTML = '';
    const list = this.sim.log.filter(e => this.logVisible(e)).slice(-600);
    if (!list.length) this.logEl.append(h('div', { class: 'empty', style: { padding: '10px' } }, 'Noch nichts passiert. Öffne die Konsole eines Geräts und sende einen ping.'));
    for (const e of list) this.logEl.append(this.logRow(e));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  appendLog(entries) {
    const atBottom = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 30;
    if (this.logEl.querySelector('.empty')) this.logEl.innerHTML = '';
    for (const e of entries) if (this.logVisible(e)) this.logEl.append(this.logRow(e));
    while (this.logEl.childElementCount > 700) this.logEl.firstChild.remove();
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  inspect(e) {
    this.selectedLog = e.seq;
    this.logEl.querySelectorAll('.e.sel').forEach(x => x.classList.remove('sel'));
    this.logEl.querySelector(`[data-seq="${e.seq}"]`)?.classList.add('sel');
    renderInspector(this.inspEl, e, { onTrace: t => this.setTrace(t) });
    this.emit('inspect', e);
  }
  setTrace(t) {
    this.traceId = t;
    if (t) { this.logFilter = 'trace'; toast('Protokoll zeigt nur noch dieses Paket, beteiligte Geräte sind markiert'); }
    else if (this.logFilter === 'trace') this.logFilter = 'all';
    this.render(); this.renderLog();
  }

  // ------------------------------------------------------------ Zeit und Animation
  setPlaying(p) {
    this.playing = p;
    this.playBtn.innerHTML = p ? I.pause : I.play;
    this.playBtn.title = p ? 'Anhalten (Leertaste)' : 'Abspielen (Leertaste)';
  }
  stepOnce() {
    this.setPlaying(false);
    if (!this.sim.step()) toast('Keine weiteren Ereignisse');
    this.drawPackets();
  }
  loop(ts) {
    const dt = Math.min(100, ts - (this.lastTs || ts));
    this.lastTs = ts;
    if (this.playing) {
      const sim = this.sim;
      const visible = this.showBpdu ? sim.inflight.length : sim.inflight.filter(f => f.frame.type !== 'stp').length;
      if (!visible && sim.inflight.length) sim.runUntil(Math.max(...sim.inflight.map(f => f.t1)));
      if (visible) {
        sim.runUntil(sim.time + dt * (TIMING.linkDelay / this.msPerHop));
        this.idleUntil = 0;
      } else {
        const nt = sim.nextTime();
        if (nt !== null) {
          if (nt - sim.time < TIMING.linkDelay * 0.5) sim.runUntil(nt);
          else if (!this.idleUntil) this.idleUntil = ts + Math.min(500, this.msPerHop * 0.6);
          else if (ts >= this.idleUntil) { this.idleUntil = 0; sim.runUntil(nt); }
        }
      }
    }
    this.drawPackets();
    this.timeEl.textContent = `t = ${(this.sim.time / 1000).toFixed(4)} s`;
    this.raf = requestAnimationFrame(t => this.loop(t));
  }
  drawPackets() {
    const sim = this.sim, seen = new Set();
    const byId = new Map(sim.topo.devices.map(d => [d.id, d]));
    const groups = new Map();
    for (const f of sim.inflight) {
      if (!this.showBpdu && f.frame.type === 'stp') continue;
      const key = f.link.id + (f.from === f.link.a.dev ? 'a' : 'b');
      groups.set(key, (groups.get(key) || 0) + 1);
      const idx = groups.get(key) - 1;
      const A = byId.get(f.from), B = byId.get(f.to);
      if (!A || !B) continue;
      const p = Math.min(1, Math.max(0, (sim.time - f.t0) / (f.t1 - f.t0)));
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const x = A.x + dx * p + (-dy / len) * (8 + idx * 4), y = A.y + dy * p + (dx / len) * (8 + idx * 4);
      let g = this.pktEls.get(f.id);
      if (!g) {
        g = svgEl('g', { class: 'pkt', role: 'button', 'aria-label': shortLabel(f.frame) });
        const kinds = layerKinds(f.frame);
        const W = 12 + kinds.length * 7, H = 19;
        g.append(svgEl('rect', { class: 'box', x: -W / 2, y: -H / 2, width: W, height: H, rx: 3, fill: 'var(--panel)' }));
        kinds.forEach((k, i) => g.append(svgEl('rect', { x: -W / 2 + 3.5 + i * 7, y: -H / 2 + 3, width: 6, height: H - 6, rx: 1, fill: `var(--l-${k})` })));
        const t = svgEl('text', { x: 0, y: H / 2 + 12 }); t.textContent = shortLabel(f.frame);
        g.append(t);
        g.addEventListener('pointerdown', e => {
          e.stopPropagation();
          this.setPlaying(false);
          this.inspect({ seq: -1, t: sim.time, dev: `${byId.get(f.from)?.name} → ${byId.get(f.to)?.name}`, frame: f.frame, trace: traceOf(f.frame) });
        });
        this.gPkts.append(g);
        this.pktEls.set(f.id, g);
      }
      g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      seen.add(f.id);
    }
    for (const [id, g] of this.pktEls) if (!seen.has(id)) { g.remove(); this.pktEls.delete(id); }
  }

  fastForward(ms) {
    if (this.sim.halted) return toast('Die Simulation ist angehalten. Setze den Zustand zurück.');
    this.sim.runFor(ms);
    this.drawPackets();
    this.render();
    if (this.tab === 'tables') this.renderSide();
    toast(`${ms / 1000} s vorgespult, jetzt t = ${(this.sim.time / 1000).toFixed(1)} s`);
  }
  toggleBpdu() { this.showBpdu = !this.showBpdu; this.bpduBtn.classList.toggle('on', this.showBpdu); this.drawPackets(); }
  updateBpduBar() { this.bpduBar?.classList.toggle('hidden', !this.sim.topo.devices.some(d => d.type === 'switch' && d.stp?.enabled)); }
  renderSoon() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, 80);
  }
  showStorm(info) {
    this.stormEl.innerHTML = '';
    this.stormEl.classList.toggle('hidden', !info);
    if (!info) return;
    this.stormEl.append(h('div', {}, h('b', {}, 'Simulation angehalten. '), info.text),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => this.resetState() }, 'Zustand zurücksetzen'),
        h('span', { class: 'small muted' }, 'Danach die Schleife entfernen oder Spanning Tree einschalten.')));
  }

  // ------------------------------------------------------------ Hilfen für Lektionen
  run(devName, cmd) {
    const d = this.sim.dev(devName);
    if (!d) return;
    import('./cli.js').then(m => { m.runCommand(d, cmd); if (this.sel?.id === d.id) this.consoleEl?.refresh(); });
  }
  selectByName(name, tab) {
    const d = this.sim.dev(name);
    if (d) { this.tab = tab || this.tab; this.select({ kind: 'dev', id: d.id }); this.renderSide(); }
  }
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/minimap.js" <<'__PACKETPILOT_FILE_END__'
// Statische Vorschau einer Topologie und die lebende Mini-Simulation auf der Startseite
import { Sim, TIMING } from './engine.js';
import { layerKinds, shortLabel } from './packets.js';
import { svgEl } from './ui.js';
import { DEV_ICON } from './icons.js';

function frame(topo, pad = 70) {
  const xs = topo.devices.map(d => d.x), ys = topo.devices.map(d => d.y);
  if (!xs.length) return '0 0 400 200';
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  return `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
}
const ZC = { blue: 'eth', violet: 'vlan', green: 'ip', orange: 'arp', pink: 'vxlan', yellow: 'stp' };
const KC = { vlan: 'violet', overlay: 'pink', underlay: 'blue' };
function drawStatic(svg, topo, scale = 1) {
  const byId = new Map(topo.devices.map(d => [d.id, d]));
  for (const z of topo.zones || []) {
    const c = z.color || KC[z.kind] || 'gray';
    const col = c === 'gray' ? 'var(--ink-3)' : `var(--l-${ZC[c]})`;
    svg.append(svgEl('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 14, fill: `color-mix(in srgb, ${col} 8%, transparent)`, stroke: col, 'stroke-dasharray': '8 6', 'stroke-width': 1.5 * scale }));
  }
  for (const l of topo.links) {
    const A = byId.get(l.a.dev), B = byId.get(l.b.dev);
    if (A && B) svg.append(svgEl('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, stroke: 'var(--ink-3)', 'stroke-width': 2.5 * scale }));
  }
  for (const d of topo.devices) {
    const g = svgEl('g', { transform: `translate(${d.x - 26 * scale},${d.y - 22 * scale}) scale(${1.3 * scale})`, class: `t-${d.type}` });
    g.append(svgEl('rect', { x: -2, y: 0, width: 44, height: 36, rx: 8, fill: 'var(--panel)', stroke: 'var(--line)' }));
    const ic = svgEl('g', { transform: 'translate(0,-2)' }); ic.innerHTML = DEV_ICON[d.type]; g.append(ic);
    svg.append(g);
    const t = svgEl('text', { x: d.x, y: d.y + 40 * scale, 'text-anchor': 'middle', 'font-size': 12 * scale, 'font-weight': 600, fill: 'var(--ink)' });
    t.textContent = d.name; svg.append(t);
  }
}
export function preview(topo) {
  const svg = svgEl('svg', { viewBox: frame(topo, 95), class: 'net', 'aria-hidden': 'true' });
  drawStatic(svg, topo, 1.8);
  return svg;
}

/** Lebende Simulation: pc1 pingt in Schleife über einen Router */
export function heroSim(container, topo, script) {
  const svg = svgEl('svg', { viewBox: frame(topo, 80), class: 'net', style: 'width:100%;height:100%' });
  container.append(svg);
  drawStatic(svg, topo, 1.35);
  const gp = svgEl('g'); svg.append(gp);
  const sim = new Sim(topo);
  const byId = new Map(topo.devices.map(d => [d.id, d]));
  const els = new Map();
  let last = 0, idle = 0, raf, nextRun = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const msPerHop = 700;
  const tick = ts => {
    const dt = Math.min(100, ts - (last || ts)); last = ts;
    if (!sim.queue.length && ts > nextRun) { script(sim); nextRun = ts + 6000; }
    if (sim.inflight.length) sim.runUntil(sim.time + dt * TIMING.linkDelay / msPerHop);
    else if (sim.queue.length) { if (!idle) idle = ts + 350; else if (ts > idle) { idle = 0; sim.runUntil(sim.nextTime()); } }
    const seen = new Set();
    for (const f of sim.inflight) {
      const A = byId.get(f.from), B = byId.get(f.to);
      const p = Math.min(1, Math.max(0, (sim.time - f.t0) / (f.t1 - f.t0)));
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const x = A.x + dx * p - dy / len * 10, y = A.y + dy * p + dx / len * 10;
      let g = els.get(f.id);
      if (!g) {
        g = svgEl('g', { class: 'pkt' });
        const kinds = layerKinds(f.frame), W = 14 + kinds.length * 8, H = 22;
        g.append(svgEl('rect', { class: 'box', x: -W / 2, y: -H / 2, width: W, height: H, rx: 3, fill: 'var(--panel)' }));
        kinds.forEach((k, i) => g.append(svgEl('rect', { x: -W / 2 + 4 + i * 8, y: -H / 2 + 3.5, width: 6.5, height: H - 7, rx: 1, fill: `var(--l-${k})` })));
        const t = svgEl('text', { x: 0, y: H / 2 + 14, 'font-size': 12 }); t.textContent = shortLabel(f.frame); g.append(t);
        gp.append(g); els.set(f.id, g);
      }
      g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      seen.add(f.id);
    }
    for (const [id, g] of els) if (!seen.has(id)) { g.remove(); els.delete(id); }
    raf = requestAnimationFrame(tick);
  };
  if (!reduce) raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/net.js" <<'__PACKETPILOT_FILE_END__'
// Hilfsfunktionen für Adressen und Paketgrössen. Ohne DOM, auch in Node nutzbar.

export const ETH_HDR = 14, VLAN_TAG = 4, FCS = 4, PREAMBLE = 8, IFG = 12;
export const IP_HDR = 20, UDP_HDR = 8, ICMP_HDR = 8, VXLAN_HDR = 8, ARP_LEN = 28, TCP_HDR = 20, LLC_LEN = 3, BPDU_LEN = 35;
export const STP_MAC = '01:80:c2:00:00:00';
export const BCAST = 'ff:ff:ff:ff:ff:ff';
export const VXLAN_PORT = 4789;
export const PROTO = { ICMP: 1, TCP: 6, UDP: 17 };
export const PROTO_NAME = { 1: 'ICMP', 6: 'TCP', 17: 'UDP' };

export function ipToInt(ip) {
  const p = String(ip).trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x)) return null;
    const v = Number(x);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}
export function intToIp(n) {
  return [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
}
export const isIp = ip => ipToInt(ip) !== null;
export function maskOf(len) { return len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0; }
export function netOf(ip, len) { return (ipToInt(ip) & maskOf(len)) >>> 0; }
export function inNet(ip, net, len) {
  const a = ipToInt(ip), b = ipToInt(net);
  if (a === null || b === null) return false;
  return ((a & maskOf(len)) >>> 0) === ((b & maskOf(len)) >>> 0);
}
export function parseCidr(s) {
  if (s === 'default' || s === 'any') return { net: '0.0.0.0', len: 0 };
  const m = String(s).trim().match(/^(\d+\.\d+\.\d+\.\d+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const len = m[2] === undefined ? 32 : Number(m[2]);
  if (len > 32 || !isIp(m[1])) return null;
  return { net: intToIp(netOf(m[1], len)), len };
}
export const cidr = (net, len) => `${net}/${len}`;
export const isBroadcastMac = m => m === BCAST;
export function isGroupMac(mac) { return (parseInt(mac.slice(0, 2), 16) & 1) === 1; }
export function isLocalMac(mac) { return (parseInt(mac.slice(0, 2), 16) & 2) === 2; }

// Stabile MAC aus einem Namen (containerlab-Stil aa:c1:ab:xx:xx:xx)
export function macFor(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const b = [(h >>> 16) & 255, (h >>> 8) & 255, h & 255].map(x => x.toString(16).padStart(2, '0'));
  return `aa:c1:ab:${b.join(':')}`;
}
export function hashFlow(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 49152 + ((h >>> 0) % 16384);
}

// ---------- Grössen ----------
export function l4Len(ip) {
  const l4 = ip.l4;
  if (ip.frag) return ip.frag.len;
  if (!l4) return 0;
  if (l4.kind === 'icmp') return ICMP_HDR + (l4.dataLen || 0);
  if (l4.kind === 'udp') return UDP_HDR + udpPayloadLen(l4);
  if (l4.kind === 'tcp') return tcpHdrLen(l4) + (l4.dataLen || 0);
  return 0;
}
export function tcpHdrLen(t) { return TCP_HDR + (t.mss ? 4 : 0); }
export function dnsLen(d) {
  const q = 12 + (d.qname.length + 2) + 4;
  return q + (d.answers || []).length * 16;
}
export function udpPayloadLen(udp) {
  const p = udp.payload;
  if (!p) return udp.dataLen || 0;
  if (p.kind === 'vxlan') return VXLAN_HDR + frameLen(p.frame);
  if (p.kind === 'dns') return dnsLen(p);
  return p.len || 0;
}
export function ipTotalLen(ip) { return IP_HDR + l4Len(ip); }
/** Länge ab Ziel-MAC bis Ende Nutzlast, ohne FCS (so wie tcpdump sie zeigt) */
export function frameLen(f) {
  return ETH_HDR + (f.vlan ? VLAN_TAG : 0) + framePayloadLen(f);
}
export function framePayloadLen(f) {
  if (f.type === 'arp') return ARP_LEN;
  if (f.type === 'ipv4') return f.payload.totalLength;
  if (f.type === 'stp') return LLC_LEN + BPDU_LEN;
  return f.payload?.len || 0;
}
/** Auf dem Kabel: mit FCS und Padding auf 64 Byte */
export function frameWireLen(f) { return Math.max(64, frameLen(f) + FCS); }

export function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/packets.js" <<'__PACKETPILOT_FILE_END__'
// Aufbau, Beschreibung und Zerlegung von Frames
import { ETH_HDR, VLAN_TAG, IP_HDR, UDP_HDR, ICMP_HDR, VXLAN_HDR, ARP_LEN, FCS, PROTO, LLC_LEN, BPDU_LEN,
  ipTotalLen, frameLen, frameWireLen, isGroupMac, isLocalMac, BCAST, STP_MAC, tcpHdrLen, dnsLen, udpPayloadLen } from './net.js';

let FRAME_SEQ = 1, TRACE_SEQ = 1, IP_ID = 1000;
export const nextTrace = () => TRACE_SEQ++;
export const nextIpId = () => (IP_ID = (IP_ID + 1) & 0xffff);

export function ethFrame(src, dst, type, payload, vlan = null) {
  return { id: FRAME_SEQ++, src, dst, vlan, type, payload };
}
export function arpPacket(op, sha, spa, tha, tpa) {
  return { op, sha, spa, tha: tha || '00:00:00:00:00:00', tpa };
}
export function ipPacket({ src, dst, ttl = 64, proto, df = false, l4, trace, id }) {
  const p = { src, dst, ttl, proto, df, mf: false, fragOffset: 0, tos: 0,
    id: id ?? nextIpId(), l4, trace: trace ?? nextTrace(), checksum: 0, totalLength: 0 };
  p.totalLength = ipTotalLen(p);
  p.checksum = ipChecksum(p);
  return p;
}
export function icmp(type, code, extra = {}) { return { kind: 'icmp', type, code, ...extra }; }
export function udp(sport, dport, payload) { return { kind: 'udp', sport, dport, payload }; }
export function tcp(sport, dport, seq, ack, flags, extra = {}) { return { kind: 'tcp', sport, dport, seq: seq >>> 0, ack: ack >>> 0, flags, win: 64240, dataLen: 0, ...extra }; }
export const tcpFlags = f => ['SYN', 'FIN', 'RST', 'PSH', 'ACK'].filter(k => f[k]).join(', ') || 'keine';
export const fmtBid = b => b ? `${b.prio}.${b.mac}` : '';

// Vereinfachte, aber deterministische Header-Prüfsumme (ändert sich mit TTL)
export function ipChecksum(p) {
  const words = [0x4500, p.totalLength & 0xffff, p.id & 0xffff,
    (p.df ? 0x4000 : 0) | (p.mf ? 0x2000 : 0) | ((p.fragOffset >> 3) & 0x1fff),
    ((p.ttl & 255) << 8) | (p.proto & 255)];
  for (const ip of [p.src, p.dst]) {
    const o = ip.split('.').map(Number);
    words.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
  }
  let s = words.reduce((a, b) => a + b, 0);
  while (s >> 16) s = (s & 0xffff) + (s >> 16);
  return (~s) & 0xffff;
}
export const hex4 = n => '0x' + (n & 0xffff).toString(16).padStart(4, '0');

export const ICMP_NAMES = {
  '0/0': 'Echo Reply', '8/0': 'Echo Request', '11/0': 'Time Exceeded (TTL abgelaufen)',
  '3/0': 'Destination Unreachable: Network Unreachable', '3/1': 'Destination Unreachable: Host Unreachable',
  '3/3': 'Destination Unreachable: Port Unreachable', '3/4': 'Destination Unreachable: Fragmentation Needed',
  '3/13': 'Destination Unreachable: Communication Administratively Prohibited'
};
export function icmpName(t, c) { return ICMP_NAMES[`${t}/${c}`] || `Typ ${t} Code ${c}`; }

/** Kurzes Etikett für die Animation */
export function shortLabel(f) {
  if (f.type === 'stp') return 'BPDU';
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa) return 'GARP';
    return a.op === 1 ? 'ARP ?' : 'ARP !';
  }
  const ip = f.payload;
  if (ip.frag && !ip.frag.first) return 'Frag';
  const l4 = ip.l4;
  if (!l4) return 'IP';
  if (l4.kind === 'icmp') {
    if (l4.type === 8) return 'Ping';
    if (l4.type === 0) return 'Pong';
    if (l4.type === 11) return 'TTL!';
    if (l4.type === 3 && l4.code === 4) return 'MTU!';
    if (l4.type === 3) return 'Unreach';
    return 'ICMP';
  }
  if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') return 'VXLAN';
  if (l4.kind === 'udp' && l4.payload?.kind === 'dns') return 'DNS';
  if (l4.kind === 'udp') return 'UDP';
  if (l4.kind === 'tcp') {
    const fl = l4.flags;
    if (fl.RST) return 'RST';
    if (fl.SYN && fl.ACK) return 'SYN/ACK';
    if (fl.SYN) return 'SYN';
    if (fl.FIN) return 'FIN';
    return l4.dataLen ? 'TCP' : 'ACK';
  }
  return 'IP';
}
/** Schichten von aussen nach innen, für die Balken auf dem Paket */
export function layerKinds(f) {
  const out = [];
  let cur = f;
  while (cur) {
    out.push('eth');
    if (cur.vlan) out.push('vlan');
    if (cur.type === 'stp') { out.push('stp'); break; }
    if (cur.type === 'arp') { out.push('arp'); break; }
    out.push('ip');
    const l4 = cur.payload.l4;
    if (!l4 || (cur.payload.frag && !cur.payload.frag.first)) { out.push('frag'); break; }
    if (l4.kind === 'icmp') { out.push('icmp'); break; }
    if (l4.kind === 'udp') {
      out.push('udp');
      if (l4.payload?.kind === 'vxlan') { out.push('vxlan'); cur = l4.payload.frame; continue; }
      out.push('data');
    }
    if (l4.kind === 'tcp') { out.push('tcp'); if (l4.dataLen) out.push('data'); }
    break;
  }
  return out;
}

/** Einzeilige Beschreibung im Stil von tcpdump */
export function summary(f) {
  const tag = f.vlan ? `vlan ${f.vlan.vid}, ` : '';
  if (f.type === 'stp') {
    const b = f.payload;
    return `STP BPDU: Root ${fmtBid(b.root)}, Kosten ${b.cost}, von Bridge ${fmtBid(b.bridge)} Port ${b.port}${b.tc ? ', Topologieänderung' : ''}`;
  }
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa) return `${tag}Gratuitous ARP ${a.op === 1 ? 'Request' : 'Reply'}: ${a.spa} ist bei ${a.sha}`;
    if (a.spa === '0.0.0.0') return `${tag}ARP-Probe: Benutzt jemand ${a.tpa}?`;
    return a.op === 1 ? `${tag}ARP Request: Wer hat ${a.tpa}? Antwort an ${a.spa}`
      : `${tag}ARP Reply: ${a.spa} ist bei ${a.sha}`;
  }
  const ip = f.payload;
  const base = `${ip.src} > ${ip.dst}`;
  if (ip.frag && !ip.frag.first) return `${tag}IP-Fragment ${base}, id ${ip.id}, Offset ${ip.fragOffset}, ${ip.frag.len} Byte${ip.mf ? ', weitere folgen' : ', letztes'}`;
  const l4 = ip.l4;
  let s;
  if (l4.kind === 'icmp') {
    if (l4.type === 8 || l4.type === 0) s = `ICMP ${l4.type === 8 ? 'Echo Request' : 'Echo Reply'} ${base}, seq ${l4.seq}, TTL ${ip.ttl}, ${ip.totalLength} Byte`;
    else s = `ICMP ${icmpName(l4.type, l4.code)}${l4.mtu ? ` (MTU ${l4.mtu})` : ''} ${base}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') {
    s = `VXLAN ${base}, VNI ${l4.payload.vni}, UDP ${l4.sport} > ${l4.dport}  ⟶  ${summary(l4.payload.frame)}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    s = d.qr ? `DNS-Antwort ${base}: ${d.qname} ${d.rcode === 'NOERROR' ? '→ ' + d.answers.map(a => a.ip).join(', ') : d.rcode}`
      : `DNS-Anfrage ${base}: A ${d.qname}?`;
  } else if (l4.kind === 'udp') {
    s = `UDP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport}, TTL ${ip.ttl}`;
  } else if (l4.kind === 'tcp') {
    s = `TCP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport} [${tcpFlags(l4.flags)}] seq ${l4.seq}${l4.flags.ACK ? ' ack ' + l4.ack : ''}${l4.dataLen ? ', ' + l4.dataLen + ' Byte Daten' : ''}${l4.app ? ' (' + l4.app + ')' : ''}`;
  } else s = `IP ${base}`;
  if (ip.frag?.first) s += ` (erstes Fragment, weitere folgen)`;
  return tag + s;
}

function macNote(m) {
  if (m === BCAST) return 'Broadcast, an alle im Segment';
  if (isGroupMac(m)) return 'Multicast (Bit I/G = 1)';
  return isLocalMac(m) ? 'Unicast, lokal vergeben (Bit U/L = 1)' : 'Unicast, vom Hersteller vergeben';
}

/** Zerlegt einen Frame in Schichten für den Paketinspektor */
export function dissect(f, depth = 0) {
  const layers = [];
  const pre = depth ? 'Innerer ' : '';
  if (f.type === 'stp') {
    const b = f.payload;
    layers.push({ kind: 'eth', depth, name: 'IEEE 802.3 (mit Längenfeld)', bytes: ETH_HDR, fields: [
      ['Ziel-MAC', f.dst, 'Gruppenadresse für Bridges, wird nie weitergeleitet'], ['Quell-MAC', f.src, 'MAC des sendenden Switch-Ports'],
      ['Länge', `${LLC_LEN + BPDU_LEN} Byte`, 'Kein EtherType: Werte bis 1500 sind eine Länge']] });
    layers.push({ kind: 'stp', depth, name: 'LLC', bytes: LLC_LEN, fields: [['DSAP / SSAP', '0x42 / 0x42', 'Spanning Tree'], ['Control', '0x03', 'Unnumbered Information']] });
    layers.push({ kind: 'stp', depth, name: 'STP Configuration BPDU', bytes: BPDU_LEN, fields: [
      ['Protocol / Version', '0 / 0 (802.1D)', ''], ['Flags', b.tc ? 'Topology Change' : 'keine', b.tc ? 'Empfänger verkürzen das Aging ihrer MAC-Tabelle' : ''],
      ['Root Bridge ID', fmtBid(b.root), 'Priorität.MAC der Bridge, die der Sender für die Root hält'],
      ['Root Path Cost', String(b.cost), 'Kosten des Senders bis zur Root'],
      ['Bridge ID', fmtBid(b.bridge), 'Wer sendet'], ['Port ID', b.port, 'Priorität.Nummer des sendenden Ports'],
      ['Message Age', `${b.age} s`, ''], ['Max Age / Hello / Forward Delay', `${b.maxAge} / ${b.hello} / ${b.fwd} s`, 'Timer, die die Root vorgibt']] });
    return layers;
  }
  layers.push({ kind: 'eth', depth, name: `${pre}Ethernet II`, bytes: ETH_HDR, fields: [
    ['Ziel-MAC', f.dst, macNote(f.dst)],
    ['Quell-MAC', f.src, macNote(f.src)],
    ['EtherType', f.vlan ? '0x8100 (802.1Q-Tag folgt)' : (f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)'), 'Sagt, wie die Nutzlast zu lesen ist']
  ]});
  if (f.vlan) layers.push({ kind: 'vlan', depth, name: `${pre}802.1Q-Tag`, bytes: VLAN_TAG, fields: [
    ['TPID', '0x8100', 'Kennzeichnet den Tag'],
    ['PCP (Priorität)', String(f.vlan.pcp || 0), '0 bis 7'],
    ['DEI', '0', 'Darf bei Überlast verworfen werden'],
    ['VID (VLAN)', String(f.vlan.vid), 'Nutzbar 1 bis 4094'],
    ['EtherType', f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)', '']
  ]});
  if (f.type === 'arp') {
    const a = f.payload;
    layers.push({ kind: 'arp', depth, name: `${pre}ARP ${a.op === 1 ? 'Request' : 'Reply'}`, bytes: ARP_LEN, fields: [
      ['Hardware Type', '1 (Ethernet)', ''], ['Protocol Type', '0x0800 (IPv4)', ''],
      ['Hardware / Protocol Length', '6 / 4', ''],
      ['Operation', a.op === 1 ? '1 (Request)' : '2 (Reply)', ''],
      ['Sender MAC', a.sha, ''], ['Sender IP', a.spa, ''],
      ['Target MAC', a.tha, a.op === 1 ? 'Noch unbekannt, deshalb Nullen' : ''], ['Target IP', a.tpa, a.spa === a.tpa ? 'Gleich wie Sender IP: Gratuitous ARP' : a.spa === '0.0.0.0' ? 'Probe: Sender IP 0.0.0.0' : '']
    ]});
    return layers;
  }
  const ip = f.payload;
  const flags = [ip.df ? 'DF' : null, ip.mf ? 'MF' : null].filter(Boolean).join(', ') || 'keine';
  layers.push({ kind: 'ip', depth, name: `${pre}IPv4`, bytes: IP_HDR, fields: [
    ['Version / IHL', '4 / 5 (20 Byte)', ''],
    ['Total Length', `${ip.totalLength} Byte`, 'Header und Nutzlast'],
    ['Identification', String(ip.id), 'Gleich in allen Fragmenten eines Pakets'],
    ['Flags', flags, ip.df ? 'Don\'t Fragment: Router dürfen nicht zerlegen' : 'Router dürfen zerlegen'],
    ['Fragment Offset', `${ip.fragOffset} Byte`, ''],
    ['TTL', String(ip.ttl), 'Jeder Router zieht 1 ab'],
    ['Protocol', `${ip.proto} (${ip.proto === 1 ? 'ICMP' : ip.proto === 17 ? 'UDP' : ip.proto === 6 ? 'TCP' : '?'})`, ''],
    ['Header Checksum', hex4(ip.checksum), 'Wird bei jedem Hop neu berechnet'],
    ['Quell-IP', ip.src, 'Bleibt von Ende zu Ende gleich'],
    ['Ziel-IP', ip.dst, '']
  ]});
  if (ip.frag && !ip.frag.first) {
    layers.push({ kind: 'frag', depth, name: 'Fragment-Daten', bytes: ip.frag.len, fields: [
      ['Inhalt', `${ip.frag.len} Byte`, 'Fortsetzung des ersten Fragments, ohne eigenen ICMP- oder UDP-Header']] });
    return layers;
  }
  const l4 = ip.l4;
  if (l4.kind === 'icmp') {
    const fields = [['Type / Code', `${l4.type} / ${l4.code}`, icmpName(l4.type, l4.code)]];
    if (l4.type === 8 || l4.type === 0) fields.push(['Identifier / Sequence', `${l4.ident} / ${l4.seq}`, ''], ['Daten', `${l4.dataLen} Byte`, '']);
    if (l4.mtu) fields.push(['Next-Hop MTU', String(l4.mtu), 'So gross darf das Paket höchstens sein']);
    if (l4.orig) fields.push(['Betrifft Paket', `${l4.orig.src} > ${l4.orig.dst}`, 'Kopie des ursprünglichen Headers']);
    layers.push({ kind: 'icmp', depth, name: `${pre}ICMP ${icmpName(l4.type, l4.code)}`, bytes: ICMP_HDR + (l4.dataLen || 0), fields });
  } else if (l4.kind === 'tcp') {
    layers.push({ kind: 'tcp', depth, name: `${pre}TCP`, bytes: tcpHdrLen(l4), fields: [
      ['Quell-Port', String(l4.sport), l4.sport >= 49152 ? 'Kurzlebiger Port des Clients' : ''],
      ['Ziel-Port', String(l4.dport), l4.dport === 80 ? 'HTTP' : l4.dport === 22 ? 'SSH' : l4.dport === 443 ? 'HTTPS' : ''],
      ['Sequenznummer', String(l4.seq), 'Nummer des ersten Bytes in diesem Segment'],
      ['Bestätigungsnummer', l4.flags.ACK ? String(l4.ack) : '0', l4.flags.ACK ? 'Nächstes Byte, das erwartet wird' : 'nur gültig mit ACK'],
      ['Header-Länge', `${tcpHdrLen(l4)} Byte`, l4.mss ? 'mit Option MSS' : ''],
      ['Flags', tcpFlags(l4.flags), ''], ['Fenster', String(l4.win), 'So viele Byte darf die Gegenseite unbestätigt senden'],
      ...(l4.mss ? [['Option MSS', String(l4.mss), 'Grösstes Segment, das dieser Host annimmt']] : [])] });
    if (l4.dataLen) layers.push({ kind: 'data', depth, name: 'Daten der Anwendung', bytes: l4.dataLen, fields: [['Inhalt', `${l4.dataLen} Byte${l4.app ? ': ' + l4.app : ''}`, '']] });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Quell-Port', String(l4.sport), ''], ['Ziel-Port', String(l4.dport), l4.dport === 53 || l4.sport === 53 ? 'DNS' : ''], ['Länge', `${UDP_HDR + udpPayloadLen(l4)} Byte`, '']] });
    layers.push({ kind: 'data', depth, name: `DNS ${d.qr ? 'Antwort' : 'Anfrage'}`, bytes: dnsLen(d), fields: [
      ['ID', String(d.id), 'Ordnet Antwort und Anfrage einander zu'], ['QR', d.qr ? '1 (Antwort)' : '0 (Anfrage)', ''],
      ['Frage', `${d.qname} A`, ''], ...(d.qr ? [['Antwortcode', d.rcode, ''], ...d.answers.map(a => ['Antwort', `${a.name} A ${a.ip}`, 'TTL 300'])] : [])] });
  } else if (l4.kind === 'udp') {
    const vx = l4.payload?.kind === 'vxlan';
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [
      ['Quell-Port', String(l4.sport), vx ? 'Hash über den inneren Frame (Verteilung bei ECMP)' : ''],
      ['Ziel-Port', String(l4.dport), vx ? (l4.dport === 4789 ? 'VXLAN (IANA)' : 'Nicht der Standard-Port 4789!') : (l4.dport >= 33434 && l4.dport < 33534 ? 'traceroute-Probe' : '')],
      ['Länge', `${UDP_HDR + (vx ? VXLAN_HDR + frameLen(l4.payload.frame) : (l4.payload?.len || 0))} Byte`, '']
    ]});
    if (vx) {
      layers.push({ kind: 'vxlan', depth, name: 'VXLAN', bytes: VXLAN_HDR, fields: [
        ['Flags', '0x08 (I: VNI gültig)', ''], ['VNI', String(l4.payload.vni), 'Nummer des Overlay-Segments, 24 Bit']] });
      layers.push(...dissect(l4.payload.frame, depth + 1));
    } else if (l4.payload?.len) {
      layers.push({ kind: 'data', depth, name: 'Daten', bytes: l4.payload.len, fields: [['Inhalt', `${l4.payload.len} Byte`, '']] });
    }
  }
  return layers;
}

export function frameStats(f) {
  return { len: frameLen(f), wire: frameWireLen(f), fcs: FCS };
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/panels.js" <<'__PACKETPILOT_FILE_END__'
// Seitenpanel: Konfiguration, Tabellen und Konsole eines Geräts
import { h } from './ui.js';
import { I } from './icons.js';
import { isIp, parseCidr } from './net.js';
import { PORTS, STP_TEXT } from './engine.js';
import { runCommand } from './cli.js';

function ipInput(value, onChange, placeholder = '') {
  const i = h('input', { class: 'input mono', value: value || '', placeholder, spellcheck: 'false' });
  i.addEventListener('change', () => {
    const v = i.value.trim();
    if (v && !isIp(v)) { i.classList.add('bad'); return; }
    i.classList.remove('bad'); onChange(v);
  });
  return i;
}
function numInput(value, min, max, onChange, placeholder = '') {
  const i = h('input', { class: 'input mono', type: 'number', value: value ?? '', min, max, placeholder });
  i.addEventListener('change', () => {
    if (i.value === '') return onChange(null);
    const v = Math.round(Number(i.value));
    if (Number.isNaN(v) || v < min || v > max) { i.classList.add('bad'); return; }
    i.classList.remove('bad'); onChange(v);
  });
  return i;
}
function select(options, value, onChange) {
  const s = h('select', { class: 'input' }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, t)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// ---------------------------------------------------------------- Konfiguration
export function configPanel(dev, ctx) {
  const { sim, changed, locked, rerender } = ctx;
  const c = dev.cfg;
  const box = h('div');
  const upd = (fn, msg) => { fn(); changed(msg); };
  if (locked) box.append(h('div', { class: 'hint' }, 'In diesem Schritt ist die Konfiguration gesperrt. Beobachte das Netz und nutze Konsole und Tabellen.'));

  if (c.type === 'pc' || c.type === 'server') {
    const i = c.ifaces.eth1;
    box.append(h('h4', {}, 'Netzwerkkarte eth1'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr' } },
        h('span', {}, 'IP-Adresse'), ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name}: IP ${v || 'entfernt'}`), '192.168.10.10'),
        h('span', {}, 'Präfix'), numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name}: Präfix /${v}`)),
        h('span', {}, 'Gateway'), ipInput(c.gw, v => upd(() => c.gw = v, `${dev.name}: Gateway ${v || 'entfernt'}`), 'leer = keins'),
        h('span', {}, 'VLAN-Tag'), numInput(i.vlan, 1, 4094, v => upd(() => i.vlan = v, `${dev.name}: VLAN-Tag ${v ?? 'aus'}`), 'kein Tag')),
      h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', {}, 'MAC'), h('dd', {}, dev.mac('eth1'))),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Ein VLAN-Tag sendet alle Frames mit 802.1Q-Tag, wie ein Subinterface eth1.10 unter Linux. Ohne Tag passt der Host an einen Access-Port.'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr', marginTop: '8px' } },
        h('span', {}, 'DNS-Server'), ipInput(c.resolver, v => upd(() => c.resolver = v, `${dev.name}: DNS-Server ${v || 'entfernt'}`), 'für curl/ping mit Namen')));
    box.append(servicesEditor(dev, upd), dnsEditor(dev, upd));
  }

  if (c.type === 'router' || c.type === 'vtep') {
    const names = c.type === 'router' ? [...PORTS.router, 'lo'] : ['eth1', 'lo'];
    box.append(h('h4', {}, c.type === 'vtep' ? 'Underlay (Layer 3)' : 'Interfaces'));
    const g = h('div', { class: 'cfg-grid' });
    for (const n of names) {
      const i = c.ifaces[n];
      const linked = n === 'lo' || !!sim.linkAt(dev.id, n);
      g.append(h('span', { class: 'if', title: linked ? 'verbunden' : 'nicht verbunden' }, n + (linked ? '' : ' ○')),
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'keine IP'}`), n === 'lo' ? 'Loopback' : ''),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)));
    }
    box.append(g);
    if (c.type === 'router') box.append(subifEditor(dev, upd, sim, rerender));
    if (c.type === 'router') {
      const fw = h('input', { type: 'checkbox', checked: c.forwarding !== false ? true : null });
      fw.addEventListener('change', () => upd(() => c.forwarding = fw.checked, `${dev.name}: Forwarding ${fw.checked ? 'an' : 'aus'}`));
      box.append(h('label', { class: 'row', style: { marginTop: '10px', fontSize: '.88rem' } }, fw, 'IP-Forwarding (net.ipv4.ip_forward = 1)'));
      const clamp = numInput(c.mssClamp, 536, 9000, v => upd(() => c.mssClamp = v, `${dev.name}: MSS Clamping ${v ?? 'aus'}`), 'aus');
      clamp.style.width = '90px';
      box.append(h('div', { class: 'row', style: { marginTop: '6px', fontSize: '.88rem' } }, 'MSS Clamping', clamp,
        h('span', { class: 'small muted' }, 'kürzt die MSS in weitergeleiteten SYN-Segmenten')));
    }
    box.append(routesEditor(dev, upd));
    if (c.type === 'router') box.append(aclEditor(dev, upd));
  }

  if (c.type === 'switch' || c.type === 'vtep') {
    box.append(h('h4', {}, c.type === 'vtep' ? 'Lokale Bridge-Ports' : 'Ports'));
    const ports = c.type === 'switch' ? PORTS.switch : ['eth2', 'eth3', 'eth4'];
    const shown = ports.filter(p => sim.linkAt(dev.id, p));
    if (!shown.length) box.append(h('div', { class: 'empty' }, 'Noch kein Port verbunden.'));
    const g = h('div', { class: 'cfg-grid ports' });
    for (const p of shown) {
      const pc = c.ports[p];
      const vl = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } });
      const drawVl = () => {
        vl.innerHTML = '';
        if (pc.mode === 'trunk') {
          const al = h('input', { class: 'input mono', value: pc.allowed ?? '1-4094', title: 'Erlaubte VLANs, z. B. 10,20 oder 1-4094', style: { width: '78px' } });
          al.addEventListener('change', () => upd(() => pc.allowed = al.value.trim() || '1-4094', `${dev.name} ${p}: erlaubt ${al.value}`));
          vl.append(al, h('span', { class: 'small muted' }, 'nativ'), numInput(pc.native, 1, 4094, v => upd(() => pc.native = v, `${dev.name} ${p}: natives VLAN ${v ?? 'keins'}`), '–'));
          vl.lastChild.style.width = '58px';
        } else {
          const n = numInput(pc.vlan ?? 1, 1, 4094, v => upd(() => pc.vlan = v ?? 1, `${dev.name} ${p}: VLAN ${v}`));
          n.style.width = '74px';
          vl.append(h('span', { class: 'small muted' }, 'VLAN'), n);
        }
      };
      drawVl();
      g.append(h('span', { class: 'if' }, p),
        select([['access', 'Access'], ['trunk', 'Trunk']], pc.mode, v => { upd(() => pc.mode = v, `${dev.name} ${p}: ${v === 'trunk' ? 'Trunk' : 'Access'}`); drawVl(); }),
        vl);
    }
    box.append(g);
    box.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 90px', marginTop: '10px' } },
      h('span', { class: 'small' }, 'Aging-Zeit der MAC-Tabelle (s), 0 = lernt nichts'),
      numInput(c.ageing, 0, 3600, v => upd(() => c.ageing = v ?? 300, `${dev.name}: Aging ${v} s`))));
    if (c.type === 'switch') box.append(stpEditor(dev, upd, sim, shown, rerender));
  }

  if (c.type === 'vtep') box.append(vxlanEditor(dev, upd, sim));
  if (locked) box.querySelectorAll('input,select,button').forEach(e => e.disabled = true);
  return box;
}

function subifEditor(dev, upd, sim, rerender) {
  const c = dev.cfg;
  const wrap = h('div');
  const subs = Object.keys(c.ifaces).filter(n => c.ifaces[n].parent);
  wrap.append(h('h4', {}, 'Subinterfaces (802.1Q)'));
  const list = h('div', { class: 'list' });
  for (const n of subs) {
    const i = c.ifaces[n];
    list.append(h('div', { class: 'item' },
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('b', { class: 'mono small' }, n), h('span', { class: 'small muted' }, `Tag ${i.vlan} auf ${i.parent}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'Subinterface entfernen', html: I.trash, onclick: () => { upd(() => delete c.ifaces[n], `${dev.name}: ${n} entfernt`); rerender?.(); } })),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 70px' } },
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'keine IP'}`), '10.10.0.1'),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)))));
  }
  if (!subs.length) list.append(h('div', { class: 'empty' }, 'Keine. Ein Subinterface sendet und empfängt Frames mit einem bestimmten VLAN-Tag, so routet ein Router zwischen VLANs über ein einziges Kabel (Router-on-a-Stick).'));
  const parent = select(PORTS.router.map(p => [p, p]), PORTS.router.find(p => sim.linkAt(dev.id, p)) || 'eth1', () => {});
  const vid = h('input', { class: 'input mono', type: 'number', min: 1, max: 4094, placeholder: 'VLAN', style: { width: '80px' } });
  const add = h('button', { class: 'btn', html: I.plus + ' Anlegen', onclick: () => {
    const v = Math.round(Number(vid.value)), par = parent.value;
    if (!(v >= 1 && v <= 4094)) return vid.classList.add('bad');
    const name = `${par}.${v}`;
    if (c.ifaces[name]) return vid.classList.add('bad');
    upd(() => { c.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 }; }, `${dev.name}: ${name} angelegt`);
    rerender?.();
  } });
  wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } }, parent, vid, add),
    h('p', { class: 'small muted' }, 'Das physische Interface braucht dafür keine eigene IP. Am Switch muss der Port ein Trunk sein, der diese VLANs erlaubt.'));
  return wrap;
}

function stpEditor(dev, upd, sim, shown, rerender) {
  const c = dev.cfg, st = c.stp;
  const wrap = h('div');
  const on = h('input', { type: 'checkbox', checked: st.enabled ? true : null });
  on.addEventListener('change', () => { upd(() => st.enabled = on.checked, `${dev.name}: Spanning Tree ${on.checked ? 'an' : 'aus'}`); rerender?.(); });
  wrap.append(h('h4', {}, 'Spanning Tree (802.1D)'),
    h('label', { class: 'row', style: { fontSize: '.88rem' } }, on, 'Spanning Tree aktiv'));
  if (!st.enabled) { wrap.append(h('p', { class: 'small muted' }, 'Aus: Alle Ports leiten sofort weiter. Gibt es eine Schleife im Netz, kreisen Broadcasts endlos.')); return wrap; }
  const prios = []; for (let p = 0; p <= 61440; p += 4096) prios.push([p, String(p) + (p === 32768 ? ' (Standard)' : '')]);
  wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
    h('span', { class: 'small' }, 'Bridge-Priorität'), select(prios, st.priority, v => upd(() => st.priority = Number(v), `${dev.name}: Priorität ${v}`)),
    h('span', { class: 'small' }, 'Timer'), select([['standard', 'Standard (Hello 2, Forward Delay 15, Max Age 20)'], ['schnell', 'Schnell fürs Labor (1 / 4 / 6)']], st.timers, v => upd(() => st.timers = v, `${dev.name}: Timer ${v}`))));
  const b = dev.bridge.stpTable();
  if (b) wrap.append(h('dl', { class: 'kv', style: { marginTop: '8px' } }, h('dt', {}, 'Bridge ID'), h('dd', { class: 'mono' }, b.bridge), h('dt', {}, 'Root'), h('dd', { class: 'mono' }, b.isRoot ? 'diese Bridge' : `${b.root} via ${b.rootPort}, Kosten ${b.rootCost}`)));
  if (shown.length) {
    const g = h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '50px 80px 1fr', marginTop: '8px' } }, h('span', { class: 'small muted' }, 'Port'), h('span', { class: 'small muted' }, 'Kosten'), h('span', { class: 'small muted' }, 'Edge (PortFast)'));
    for (const p of shown) {
      const pc = c.ports[p];
      const edge = h('input', { type: 'checkbox', checked: pc.edge ? true : null });
      edge.addEventListener('change', () => upd(() => pc.edge = edge.checked, `${dev.name} ${p}: PortFast ${edge.checked ? 'an' : 'aus'}`));
      const cost = numInput(pc.cost ?? 4, 1, 200000000, v => upd(() => pc.cost = v ?? 4, `${dev.name} ${p}: Kosten ${v}`));
      g.append(h('span', { class: 'if' }, p), cost, h('label', { class: 'row small' }, edge, dev.bridge.stp?.ports.get(p)?.edgeLost ? 'BPDU empfangen, Edge verloren' : ''));
    }
    wrap.append(g);
  }
  wrap.append(h('p', { class: 'small muted' }, `Kosten 4 entspricht 1 Gbit/s, 19 entspricht 100 Mbit/s. Edge-Ports für Endgeräte gehen sofort auf Forwarding.`));
  return wrap;
}

function servicesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Dienste (lauschende Ports)'));
    const list = h('div', { class: 'list' });
    c.services.forEach((sv, idx) => {
      const name = h('input', { class: 'input', value: sv.name || '', placeholder: 'Name', style: { minWidth: 0, flex: '1 1 0' } });
      name.addEventListener('change', () => upd(() => sv.name = name.value.trim(), `${dev.name}: Dienst ${name.value}`));
      const port = numInput(sv.port, 1, 65535, v => upd(() => sv.port = v ?? sv.port, `${dev.name}: Port ${v}`));
      port.style.width = '78px';
      const size = numInput(sv.size, 0, 100000, v => upd(() => sv.size = v ?? 0, `${dev.name}: Antwort ${v} Byte`), 'Byte');
      size.style.width = '90px';
      const proto = select([['tcp', 'TCP'], ['udp', 'UDP']], sv.proto, v => { upd(() => sv.proto = v, `${dev.name}: ${v}`); draw(); });
      proto.style.width = '74px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, proto, port, name,
          h('button', { class: 'btn icon ghost', title: 'Dienst entfernen', html: I.trash, onclick: () => { upd(() => c.services.splice(idx, 1), `${dev.name}: Dienst entfernt`); draw(); } })),
        sv.proto === 'tcp' ? h('div', { class: 'row small muted', style: { flexWrap: 'nowrap' } }, 'Antwort', size, 'Byte') : null));
    });
    if (!c.services.length) list.append(h('div', { class: 'empty' }, 'Kein Dienst. Eine TCP-Verbindung wird mit RST abgelehnt, UDP mit ICMP Port Unreachable.'));
    wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn', html: I.plus + ' Webserver (TCP 80)', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 80, name: 'http', size: 2000 }), `${dev.name}: Webserver`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' DNS (UDP 53)', onclick: () => { upd(() => c.services.push({ proto: 'udp', port: 53, name: 'dns' }), `${dev.name}: DNS-Dienst`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' Anderer', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 8080, name: 'app', size: 500 }), `${dev.name}: Dienst`); draw(); } })),
    h('p', { class: 'small muted' }, 'Bei TCP gibt Byte an, wie gross die Antwort ist. Sie wird in Segmente der Grösse MSS zerlegt.'));
  };
  draw();
  return wrap;
}

function dnsEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  if (!c.services.some(s => s.proto === 'udp' && Number(s.port) === 53) && !c.dns.length) return wrap;
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'DNS-Einträge (A-Records)'));
    const list = h('div', { class: 'list' });
    c.dns.forEach((r, idx) => {
      const name = h('input', { class: 'input mono', value: r.name, placeholder: 'web.lab' });
      name.addEventListener('change', () => upd(() => r.name = name.value.trim().toLowerCase(), `${dev.name}: DNS ${name.value}`));
      list.append(h('div', { class: 'item' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('span', { class: 'small muted' }, 'A'),
        ipInput(r.ip, v => upd(() => r.ip = v, `${dev.name}: DNS ${r.name} → ${v}`), '10.0.0.10'),
        h('button', { class: 'btn icon ghost', title: 'Eintrag entfernen', html: I.trash, onclick: () => { upd(() => c.dns.splice(idx, 1), `${dev.name}: DNS-Eintrag entfernt`); draw(); } }))));
    });
    if (!c.dns.length) list.append(h('div', { class: 'empty' }, 'Keine Einträge. Jede Anfrage endet mit NXDOMAIN.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Eintrag', onclick: () => { upd(() => c.dns.push({ name: 'neu.lab', ip: '' }), `${dev.name}: DNS-Eintrag`); draw(); } }));
  };
  draw();
  return wrap;
}

function routesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Statische Routen'));
    const list = h('div', { class: 'list' });
    c.routes.forEach((r, idx) => {
      const dst = h('input', { class: 'input mono', value: r.dst, placeholder: '10.0.0.0/24' });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); dst.classList.remove('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: Route ${dst.value}`); });
      const act = dev.l3.routes().find(x => x.proto === 'S' && x.via === r.via && parseCidr(r.dst) && x.net === parseCidr(r.dst).net);
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, dst, h('span', { class: 'small muted' }, 'via'),
          ipInput(r.via, v => upd(() => r.via = v, `${dev.name}: Next Hop ${v}`), 'Next Hop'),
          h('button', { class: 'btn icon ghost', title: 'Route entfernen', html: I.trash, onclick: () => { upd(() => c.routes.splice(idx, 1), `${dev.name}: Route entfernt`); draw(); } })),
        act && !act.dev ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, 'Inaktiv: Next Hop liegt in keinem direkt angeschlossenen Netz') : null));
    });
    if (!c.routes.length) list.append(h('div', { class: 'empty' }, 'Keine. Direkt angeschlossene Netze kennt das Gerät von selbst.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Route hinzufügen',
      onclick: () => { c.routes.push({ dst: '0.0.0.0/0', via: '' }); draw(); } }));
  };
  draw();
  return wrap;
}

function aclEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Regeln für weitergeleitete Pakete'),
      h('p', { class: 'small muted' }, 'Von oben nach unten, die erste passende Regel gilt. Passt keine, wird weitergeleitet.'));
    const list = h('div', { class: 'list' });
    c.acl.forEach((r, idx) => {
      const src = h('input', { class: 'input mono', value: r.src || 'any', placeholder: 'any' });
      const dst = h('input', { class: 'input mono', value: r.dst || 'any', placeholder: 'any' });
      src.addEventListener('change', () => { if (!parseCidr(src.value)) return src.classList.add('bad'); upd(() => r.src = src.value.trim(), `${dev.name}: Regel ${idx + 1}`); });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: Regel ${idx + 1}`); });
      const type = numInput(r.icmpType, 0, 255, v => upd(() => r.icmpType = v, `${dev.name}: Regel ${idx + 1}`), 'alle');
      const portIn = (rr, i) => { const n = numInput(rr.port, 1, 65535, v => upd(() => rr.port = v, `${dev.name}: Regel ${i + 1} Port ${v ?? 'alle'}`), 'alle'); n.style.width = '84px'; return n; };
      type.style.width = '64px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'small' }, `#${idx + 1}`),
          select([['allow', 'erlauben'], ['drop', 'verwerfen'], ['reject', 'ablehnen']], r.action, v => upd(() => r.action = v, `${dev.name}: Regel ${idx + 1}`)),
          select([['any', 'alle Protokolle'], ['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP']], r.proto || 'any', v => { upd(() => r.proto = v, `${dev.name}: Regel ${idx + 1}`); draw(); }),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'nach oben', html: I.up, disabled: idx === 0 ? true : null, onclick: () => { upd(() => c.acl.splice(idx - 1, 0, c.acl.splice(idx, 1)[0]), `${dev.name}: Reihenfolge`); draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'Regel entfernen', html: I.trash, onclick: () => { upd(() => c.acl.splice(idx, 1), `${dev.name}: Regel entfernt`); draw(); } })),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'small muted' }, 'von'), src, h('span', { class: 'small muted' }, 'an'), dst),
        (r.proto === 'icmp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'ICMP-Typ'), type, h('span', { class: 'small muted' }, '0 Reply, 3 Unreachable, 8 Request, 11 TTL')) : null,
        (r.proto === 'tcp' || r.proto === 'udp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Zielport'), portIn(r, idx), h('span', { class: 'small muted' }, 'leer = alle Ports')) : null,
        r.action === 'reject' ? h('div', { class: 'small muted' }, r.proto === 'tcp' ? 'Ablehnen beantwortet ein SYN mit TCP RST.' : 'Ablehnen sendet ICMP «administratively prohibited» an den Absender.') : null));
    });
    if (!c.acl.length) list.append(h('div', { class: 'empty' }, 'Keine Regeln, alles wird weitergeleitet.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Regel hinzufügen',
      onclick: () => { upd(() => c.acl.push({ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }), `${dev.name}: Regel hinzugefügt`); draw(); } }));
  };
  draw();
  return wrap;
}

function vxlanEditor(dev, upd, sim) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'VXLAN-Segmente'));
    const list = h('div', { class: 'list' });
    c.vxlans.forEach((m, idx) => {
      const flood = h('input', { class: 'input mono', value: (m.flood || []).join(', '), placeholder: '10.255.0.2' });
      flood.addEventListener('change', () => {
        const ips = flood.value.split(/[,\s]+/).filter(Boolean);
        if (ips.some(x => !isIp(x))) return flood.classList.add('bad');
        flood.classList.remove('bad'); upd(() => m.flood = ips, `${dev.name}: Flood-Liste ${ips.join(', ') || 'leer'}`);
      });
      const learn = h('input', { type: 'checkbox', checked: m.learning !== false ? true : null });
      learn.addEventListener('change', () => upd(() => m.learning = learn.checked, `${dev.name}: Learning ${learn.checked ? 'an' : 'aus'}`));
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'mono small' }, `vxlan${m.vni}`), h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'Segment entfernen', html: I.trash, onclick: () => { upd(() => c.vxlans.splice(idx, 1), `${dev.name}: Segment entfernt`); draw(); } })),
        h('div', { class: 'cfg-grid vx' },
          h('label', { class: 'field' }, 'VNI', numInput(m.vni, 1, 16777215, v => { upd(() => m.vni = v, `${dev.name}: VNI ${v}`); draw(); })),
          h('label', { class: 'field' }, 'Lokales VLAN', numInput(m.vlan, 1, 4094, v => upd(() => m.vlan = v, `${dev.name}: VLAN ${v}`))),
          h('label', { class: 'field' }, 'UDP-Zielport', numInput(m.dstport ?? 4789, 1, 65535, v => upd(() => m.dstport = v ?? 4789, `${dev.name}: Port ${v}`))),
          h('label', { class: 'field' }, `MTU (auto ${dev.vxlanMtu({ ...m, mtu: null })})`, numInput(m.mtu, 68, 9000, v => upd(() => m.mtu = v, `${dev.name}: VXLAN-MTU ${v ?? 'auto'}`), 'auto'))),
        h('label', { class: 'field' }, 'Flood-Liste (entfernte VTEPs)', flood),
        h('label', { class: 'row small' }, learn, 'MAC-Adressen aus dem Tunnel lernen (Flood and Learn)')));
    });
    if (!c.vxlans.length) list.append(h('div', { class: 'empty' }, 'Kein Segment. Ein Segment verbindet ein lokales VLAN mit einem VNI.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Segment hinzufügen',
      onclick: () => { upd(() => c.vxlans.push({ vni: 10000 + (c.vxlans.length + 1) * 10, vlan: (c.vxlans.length + 1) * 10, flood: [], dstport: 4789, learning: true }), `${dev.name}: Segment hinzugefügt`); draw(); } }),
    h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Tunnel-Quelle: ${dev.localIp() || '(keine Adresse)'}. Die MTU passt Linux automatisch an: MTU von eth1 minus 50.`));
  };
  draw();
  return wrap;
}

// ---------------------------------------------------------------- Tabellen
export function tablesPanel(dev, sim) {
  const box = h('div');
  const tbl = (head, rows) => {
    if (!rows.length) return h('div', { class: 'empty' }, '(leer)');
    return h('table', { class: 'tbl' }, h('tr', {}, head.map(x => h('th', {}, x))), rows.map(r => h('tr', {}, r.map(x => h('td', {}, x ?? '')))));
  };
  if (dev.l3) {
    box.append(h('h4', {}, 'Routing-Tabelle'),
      tbl(['Ziel', 'via', 'dev', ''], dev.l3.routes().map(r => [`${r.net}/${r.len}`, r.via || 'direkt', r.dev || '–', r.proto === 'C' ? 'C' : (r.dev ? 'S' : 'S inaktiv')])));
    box.append(h('h4', {}, 'ARP-Tabelle'),
      tbl(['IP', 'MAC', 'dev', 'Zustand'], dev.l3.arpTable().map(e => [e.ip, e.mac || '–', e.ifname, e.state])));
    if (dev.l3.pmtu.size) box.append(h('h4', {}, 'Gelernte Path MTU'), tbl(['Ziel', 'MTU'], [...dev.l3.pmtu].map(([k, v]) => [k, v])));
    const conns = [...dev.l3.tcp.values()];
    if (conns.length) box.append(h('h4', {}, 'TCP-Verbindungen'), tbl(['Zustand', 'Lokal', 'Gegenstelle'], conns.map(c => [c.state, `:${c.lport}`, `${c.rip}:${c.rport}`])));
    if (dev.cfg.services?.length) box.append(h('h4', {}, 'Lauschende Dienste'), tbl(['Proto', 'Port', 'Dienst'], dev.cfg.services.map(s => [s.proto.toUpperCase(), s.port, s.name || ''])));
  }
  if (dev.type === 'switch') {
    const t = dev.bridge.stpTable();
    if (t) {
      box.append(h('h4', {}, 'Spanning Tree'),
        h('dl', { class: 'kv' }, h('dt', {}, 'Root'), h('dd', { class: 'mono' }, t.root + (t.isRoot ? ' (diese Bridge)' : '')),
          h('dt', {}, 'Bridge'), h('dd', { class: 'mono' }, t.bridge),
          ...(t.isRoot ? [] : [h('dt', {}, 'Root-Port'), h('dd', {}, `${t.rootPort}, Kosten ${t.rootCost}`)])),
        tbl(['Port', 'Rolle', 'Zustand', 'Kosten'], t.ports.map(p => [p.port + (p.edge ? ' (Edge)' : ''), STP_TEXT.ROLE_DE[p.role], STP_TEXT.STATE_DE[p.state], p.cost])));
    }
  }
  if (dev.bridge) {
    box.append(h('h4', {}, 'MAC-Tabelle'),
      tbl(['VLAN', 'MAC', 'Port', 'Alter'], dev.bridge.table().map(e => [e.vid, e.mac, e.remote ? `${e.port} → ${e.remote}` : e.port, e.age.toFixed(1) + ' s'])));
  }
  if (dev.type === 'vtep') {
    box.append(h('h4', {}, 'VXLAN'), tbl(['Interface', 'VLAN', 'Port', 'MTU', 'Flood'],
      dev.maps().map(m => [`vxlan${m.vni}`, m.vlan, m.dstport || 4789, dev.vxlanMtu(m), (m.flood || []).join(', ') || '(leer)'])));
  }
  return box;
}

// ---------------------------------------------------------------- Konsole
export function consolePanel(dev, sim, presets = []) {
  const pre = h('pre', { 'aria-live': 'polite' });
  const draw = () => { pre.textContent = dev.consoleLines.join('\n') || 'Tippe help für eine Übersicht der Befehle.'; pre.scrollTop = pre.scrollHeight; };
  draw();
  const input = h('input', { class: 'input', placeholder: dev.l3 ? 'z. B. ping 192.168.20.20' : 'z. B. bridge fdb', spellcheck: 'false', autocomplete: 'off' });
  const hist = []; let hi = 0;
  const run = cmd => { if (!cmd.trim()) return; hist.push(cmd); hi = hist.length; runCommand(dev, cmd); draw(); };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { run(input.value); input.value = ''; }
    if (e.key === 'ArrowUp' && hi > 0) { input.value = hist[--hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
  });
  const quick = h('div', { class: 'quick' });
  const defaults = dev.l3 ? ['help', 'ip addr', 'ip route', 'ip neigh', 'ip neigh flush'] : ['help', 'bridge fdb', 'bridge fdb flush'];
  if (dev.type === 'switch') defaults.push('show spanning-tree');
  if (dev.type === 'pc' || dev.type === 'server') defaults.push('ss -tuln');
  for (const q of [...presets, ...defaults]) quick.append(h('button', { class: 'btn', onclick: () => run(q) }, q));
  const el = h('div', { class: 'console' }, pre, h('div', { class: 'in' }, input, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; input.focus(); } }, 'Ausführen')), quick);
  el.refresh = draw;
  el.focusInput = () => input.focus();
  return el;
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/presets.js" <<'__PACKETPILOT_FILE_END__'
// Bausteine für Topologien und die Beispielnetze
let LN = 1;
export const host = (name, x, y, ip = '', prefix = 24, gw = '', vlan = null, type = 'pc') =>
  ({ id: name, type, name, x, y, ifaces: { eth1: { ip, prefix, vlan } }, gw });
export const server = (name, x, y, ip, prefix, gw, vlan) => host(name, x, y, ip, prefix, gw, vlan, 'server');
export const router = (name, x, y, ifaces = {}, routes = [], extra = {}) => {
  const i = {};
  for (const [k, v] of Object.entries(ifaces)) { const [ip, p] = v.split('/'); i[k] = { ip, prefix: Number(p ?? 24) }; }
  return { id: name, type: 'router', name, x, y, ifaces: i, routes: routes.map(([dst, via]) => ({ dst, via })), ...extra };
};
export const sw = (name, x, y, ports = {}, extra = {}) => ({ id: name, type: 'switch', name, x, y, ports, ...extra });
export const vtep = (name, x, y, { uplink, lo, routes = [], ports = {}, vxlans = [] }) => {
  const [ip, p] = uplink.split('/');
  return { id: name, type: 'vtep', name, x, y, ifaces: { eth1: { ip, prefix: Number(p ?? 24) }, lo: { ip: lo, prefix: 32 } },
    routes: routes.map(([dst, via]) => ({ dst, via })), ports, vxlans };
};
export const link = (a, ai, b, bi, mtu = 1500) => ({ id: 'l' + (LN++), a: { dev: a, if: ai }, b: { dev: b, if: bi }, mtu, up: true });
export const acc = vlan => ({ mode: 'access', vlan });
export const trunk = (allowed = '1-4094', native = 1) => ({ mode: 'trunk', allowed, native });

export function topo(name, devices, links, zones) { return { name, devices, links, zones }; }

// -------------------------------------------------------------- Beispielnetze
export const PRESETS = [
  { id: 'switch3', title: 'Ein Switch, drei PCs', topics: ['Ethernet', 'ARP', 'Switching'],
    text: 'Das kleinste sinnvolle Netz. Beobachte ARP und wie der Switch seine MAC-Tabelle füllt.',
    make: () => topo('Ein Switch, drei PCs', [
      host('pc1', 120, 120, '10.0.0.1'), host('pc2', 120, 320, '10.0.0.2'), host('pc3', 520, 220, '10.0.0.3'), sw('sw1', 320, 220)],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('pc3', 'eth1', 'sw1', 'eth3')]) },
  { id: 'routed', title: 'Zwei Subnetze und ein Router', topics: ['Routing', 'ARP', 'TTL'],
    text: 'LAN A und LAN B, verbunden über r1. Ideal, um MAC- und TTL-Wechsel pro Segment zu sehen.',
    make: () => topo('Zwei Subnetze und ein Router', [
      host('pc1', 100, 120, '192.168.10.10', 24, '192.168.10.1'), host('pc2', 100, 320, '192.168.10.11', 24, '192.168.10.1'),
      sw('sw1', 290, 220), router('r1', 480, 220, { eth1: '192.168.10.1/24', eth2: '192.168.20.1/24' }),
      server('srv1', 680, 220, '192.168.20.20', 24, '192.168.20.1')],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('r1', 'eth1', 'sw1', 'eth4'), link('r1', 'eth2', 'srv1', 'eth1')]) },
  { id: 'chain', title: 'Drei Router in Reihe', topics: ['Statisches Routing', 'traceroute'],
    text: 'Statische Routen über drei Router. Starte auf pc1 ein traceroute 10.0.4.10.',
    make: chainTopo },
  { id: 'mtu', title: 'Engpass mit kleiner MTU', topics: ['MTU', 'PMTUD', 'Fragmentierung'],
    text: 'Der Link zwischen r1 und r2 hat nur MTU 1400. Teste ping -s 1472 -M do und -M dont.',
    make: () => topo('Engpass mit kleiner MTU', [
      host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'), router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']]),
      router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]), server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
    [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'srv1', 'eth1')]) },
  { id: 'vlans', title: 'VLANs über einen Trunk', topics: ['VLAN', '802.1Q', 'Trunk'],
    text: 'Zwei Switches, zwei VLANs, ein Trunk dazwischen. Schau dir die Tags auf dem Trunk an.',
    make: vlanTopo },
  { id: 'campus', title: 'Campus mit Routing zwischen VLANs', topics: ['VLAN', 'Routing', 'Regeln'],
    text: 'Clients in VLAN 10, Server in VLAN 20, r1 routet dazwischen. Probiere Regeln auf r1 aus.',
    make: () => topo('Campus mit Routing zwischen VLANs', [
      host('client1', 100, 100, '10.10.0.11', 24, '10.10.0.1'), host('client2', 100, 300, '10.10.0.12', 24, '10.10.0.1'),
      server('web', 640, 100, '10.20.0.80', 24, '10.20.0.1'), server('dns', 640, 300, '10.20.0.53', 24, '10.20.0.1'),
      sw('sw1', 370, 200, { eth1: acc(10), eth2: acc(10), eth3: acc(20), eth4: acc(20), eth5: acc(10), eth6: acc(20) }),
      router('r1', 370, 400, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' })],
    [link('client1', 'eth1', 'sw1', 'eth1'), link('client2', 'eth1', 'sw1', 'eth2'), link('web', 'eth1', 'sw1', 'eth3'), link('dns', 'eth1', 'sw1', 'eth4'),
      link('r1', 'eth1', 'sw1', 'eth5'), link('r1', 'eth2', 'sw1', 'eth6')]) },
  { id: 'vxlan', title: 'VXLAN über ein geroutetes Underlay', topics: ['VXLAN', 'Underlay', 'Overlay'],
    text: 'Zwei VTEPs, ein Router dazwischen, zwei Segmente. Der Router kennt die Netze der Server nicht.',
    make: () => vxlanTopo({ two: true }) },
  { id: 'stp', title: 'Redundanz mit Spanning Tree', topics: ['STP', 'Redundanz', 'Root Bridge'],
    text: 'Drei Switches im Dreieck. STP blockiert einen Port. Trenne ein Kabel und schau zu, wie das Netz umschaltet.',
    make: () => stpTriangle({ enabled: true, rootPrio: 4096 }) },
  { id: 'loop', title: 'Schleife ohne Spanning Tree', topics: ['Broadcast-Sturm', 'Schleife'],
    text: 'Das gleiche Dreieck, aber STP ist aus. Ein einziger Ping genügt für einen Broadcast-Sturm.',
    make: () => stpTriangle({ enabled: false }) },
  { id: 'stpsquare', title: 'Vier Switches im Ring', topics: ['STP', 'Portkosten', 'Port-Rollen'],
    text: 'Welcher Port blockiert, und wie verschiebst du ihn mit Portkosten?',
    make: () => stpSquare() },
  { id: 'stick', title: 'Router-on-a-Stick', topics: ['Subinterfaces', 'VLAN', 'Trunk'],
    text: 'Ein Router, ein Kabel, zwei VLANs: r1 routet über die Subinterfaces eth1.10 und eth1.20.',
    make: () => stickTopo(true) },
  { id: 'services', title: 'Web und DNS', topics: ['TCP', 'UDP', 'DNS', 'Regeln'],
    text: 'Ein Client, ein Webserver, ein DNS-Server. curl http://web.lab/ löst erst den Namen auf und baut dann eine TCP-Verbindung auf.',
    make: () => servicesTopo() },
  { id: 'failover', title: 'Failover mit Gratuitous ARP', topics: ['ARP', 'GARP', 'Failover'],
    text: 'Die Dienstadresse 10.0.0.100 zieht von srvA zu srvB um. Mit und ohne Gratuitous ARP ausprobieren.',
    make: () => failoverTopo() },
  { id: 'tcppath', title: 'TCP über einen Engpass', topics: ['TCP', 'MSS', 'PMTUD'],
    text: 'Zwischen r1 und r2 nur MTU 1400. Der Webserver muss seine Segmente verkleinern.',
    make: () => tcpPathTopo() },
  { id: 'empty', title: 'Leeres Netz', topics: ['Eigenes Netz'],
    text: 'Ein leerer Plan für deine eigene Topologie.',
    make: () => topo('Mein Netz', [], []) }
];

export function chainTopo() {
  return topo('Drei Router in Reihe', [
    host('pc1', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 250, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 420, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.4.0/24', '10.0.23.3']]),
    router('r3', 590, 220, { eth1: '10.0.23.3/24', eth2: '10.0.4.1/24' }, [['0.0.0.0/0', '10.0.23.2']]),
    server('srv1', 760, 220, '10.0.4.10', 24, '10.0.4.1')],
  [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'r3', 'eth1'), link('r3', 'eth2', 'srv1', 'eth1')]);
}
export function vlanTopo(trunked = true) {
  const up = trunked ? trunk('10,20', 1) : acc(1);
  return topo('VLANs über einen Trunk', [
    host('a10', 90, 110, '10.10.0.1'), host('a20', 90, 330, '10.20.0.1'),
    host('b10', 690, 110, '10.10.0.2'), host('b20', 690, 330, '10.20.0.2'),
    sw('s1', 270, 220, { eth1: acc(10), eth2: acc(20), eth8: up }), sw('s2', 510, 220, { eth1: acc(10), eth2: acc(20), eth8: up })],
  [link('a10', 'eth1', 's1', 'eth1'), link('a20', 'eth1', 's1', 'eth2'), link('b10', 'eth1', 's2', 'eth1'), link('b20', 'eth1', 's2', 'eth2'), link('s1', 'eth8', 's2', 'eth8')],
  [{ x: 20, y: 40, w: 760, h: 140, label: 'VLAN 10', kind: 'vlan' }, { x: 20, y: 262, w: 760, h: 140, label: 'VLAN 20', kind: 'vlan' }]);
}
export function vxlanTopo({ two = false, vni2 = 10010, port2 = 4789, mtu = 1500, flood2 = true } = {}) {
  const maps1 = [{ vni: 10010, vlan: 10, flood: ['10.255.0.2'], dstport: 4789, learning: true }];
  const maps2 = [{ vni: vni2, vlan: 10, flood: flood2 ? ['10.255.0.1'] : [], dstport: port2, learning: true }];
  if (two) { maps1.push({ vni: 10020, vlan: 20, flood: ['10.255.0.2'], dstport: 4789, learning: true }); maps2.push({ vni: 10020, vlan: 20, flood: ['10.255.0.1'], dstport: 4789, learning: true }); }
  const devs = [
    server('srv1', 90, 120, '192.168.10.11'), server('srv2', 790, 120, '192.168.10.12'),
    vtep('vtep1', 230, 260, { uplink: '10.0.1.2/24', lo: '10.255.0.1', routes: [['10.255.0.2/32', '10.0.1.1']], ports: { eth2: acc(10), eth3: acc(20) }, vxlans: maps1 }),
    vtep('vtep2', 650, 260, { uplink: '10.0.2.2/24', lo: '10.255.0.2', routes: [['10.255.0.1/32', '10.0.2.1']], ports: { eth2: acc(10), eth3: acc(20) }, vxlans: maps2 }),
    router('core', 440, 380, { eth1: '10.0.1.1/24', eth2: '10.0.2.1/24' }, [['10.255.0.1/32', '10.0.1.2'], ['10.255.0.2/32', '10.0.2.2']])];
  const links = [link('vtep1', 'eth1', 'core', 'eth1', mtu), link('vtep2', 'eth1', 'core', 'eth2', mtu), link('srv1', 'eth1', 'vtep1', 'eth2'), link('srv2', 'eth1', 'vtep2', 'eth2')];
  if (two) {
    devs.push(host('pc1', 90, 400, '192.168.20.11'), host('pc2', 790, 400, '192.168.20.12'));
    links.push(link('pc1', 'eth1', 'vtep1', 'eth3'), link('pc2', 'eth1', 'vtep2', 'eth3'));
  }
  return topo('VXLAN über ein geroutetes Underlay', devs, links,
    [{ x: 20, y: 40, w: 860, h: 130, label: two ? 'Overlay: VNI 10010 (192.168.10.0/24) und VNI 10020 (192.168.20.0/24)' : 'Overlay: VNI 10010, 192.168.10.0/24', kind: 'overlay' },
      { x: 150, y: 320, w: 580, h: 120, label: 'Underlay: geroutet, kennt nur die Loopbacks der VTEPs', kind: 'underlay' }]);
}

// -------------------------------------------------------------- Spanning Tree, Subinterfaces, Dienste
const stpCfg = (enabled, prio = 32768, timers = 'schnell') => ({ stp: { enabled, priority: prio, timers } });
export function stpTriangle({ enabled = true, rootPrio = 32768, timers = 'schnell', edge = false } = {}) {
  const pcPort = edge ? { mode: 'access', vlan: 1, edge: true } : acc(1);
  return topo(enabled ? 'Redundanz mit Spanning Tree' : 'Schleife ohne Spanning Tree', [
    sw('sw1', 400, 110, {}, stpCfg(enabled, rootPrio, timers)), sw('sw2', 230, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers)), sw('sw3', 570, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers)),
    host('pc1', 80, 300, '10.0.0.1'), host('pc2', 720, 300, '10.0.0.2')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw1', 'eth2', 'sw3', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth2'),
    link('pc1', 'eth1', 'sw2', 'eth5'), link('pc2', 'eth1', 'sw3', 'eth5')],
  [{ x: 160, y: 40, w: 480, h: 330, label: 'Redundante Verkabelung: drei Wege, eine Schleife', color: 'yellow' }]);
}
export function stpSquare() {
  return topo('Vier Switches im Ring', [
    sw('sw1', 240, 110, {}, stpCfg(true, 4096)), sw('sw2', 560, 110, {}, stpCfg(true)), sw('sw3', 560, 340, { eth5: acc(1) }, stpCfg(true)), sw('sw4', 240, 340, {}, stpCfg(true)),
    host('pc1', 80, 110, '10.0.0.1'), host('pc3', 720, 340, '10.0.0.3')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth1'), link('sw3', 'eth2', 'sw4', 'eth2'), link('sw4', 'eth1', 'sw1', 'eth2'),
    link('pc1', 'eth1', 'sw1', 'eth5'), link('pc3', 'eth1', 'sw3', 'eth5')],
  [{ x: 170, y: 40, w: 460, h: 370, label: 'Ring aus vier Switches, sw1 ist Root', color: 'yellow' }]);
}
export function stickTopo(configured = true) {
  const r = { id: 'r1', type: 'router', name: 'r1', x: 400, y: 84, ifaces: { eth1: { ip: '', prefix: 24 } }, routes: [] };
  if (configured) {
    r.ifaces['eth1.10'] = { parent: 'eth1', vlan: 10, ip: '10.10.0.1', prefix: 24 };
    r.ifaces['eth1.20'] = { parent: 'eth1', vlan: 20, ip: '10.20.0.1', prefix: 24 };
  }
  return topo('Router-on-a-Stick', [r,
    sw('sw1', 400, 260, { eth1: acc(10), eth2: acc(10), eth3: acc(20), eth4: acc(20), eth8: trunk('10,20', 1) }),
    host('a1', 120, 200, '10.10.0.11', 24, '10.10.0.1'), host('a2', 120, 380, '10.10.0.12', 24, '10.10.0.1'),
    host('b1', 680, 200, '10.20.0.11', 24, '10.20.0.1'), server('b2', 680, 380, '10.20.0.12', 24, '10.20.0.1')],
  [link('a1', 'eth1', 'sw1', 'eth1'), link('a2', 'eth1', 'sw1', 'eth2'), link('b1', 'eth1', 'sw1', 'eth3'), link('b2', 'eth1', 'sw1', 'eth4'), link('r1', 'eth1', 'sw1', 'eth8')],
  [{ x: 30, y: 140, w: 210, h: 300, label: 'VLAN 10', color: 'blue' }, { x: 560, y: 140, w: 210, h: 300, label: 'VLAN 20', color: 'violet' },
    { x: 290, y: 14, w: 220, h: 146, label: 'Router mit Subinterfaces', color: 'gray' }]);
}
export function servicesTopo({ acl = [] } = {}) {
  const web = server('web', 640, 110, '10.20.0.80', 24, '10.20.0.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 3000 }, { proto: 'tcp', port: 443, name: 'https', size: 3000 }];
  const dns = server('dns', 640, 330, '10.20.0.53', 24, '10.20.0.1');
  dns.services = [{ proto: 'udp', port: 53, name: 'dns' }];
  dns.dns = [{ name: 'web.lab', ip: '10.20.0.80' }, { name: 'dns.lab', ip: '10.20.0.53' }, { name: 'intranet.lab', ip: '10.20.0.80' }];
  const c1 = host('client', 100, 220, '10.10.0.10', 24, '10.10.0.1');
  c1.resolver = '10.20.0.53';
  return topo('Web und DNS', [c1, router('r1', 300, 220, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' }, [], { acl }), sw('sw1', 470, 220), web, dns],
    [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'sw1', 'eth1'), link('web', 'eth1', 'sw1', 'eth2'), link('dns', 'eth1', 'sw1', 'eth3')],
    [{ x: 400, y: 40, w: 340, h: 380, label: 'Servernetz 10.20.0.0/24', color: 'green' }]);
}
export function failoverTopo() {
  const a = server('srvA', 600, 110, '10.0.0.100'), b = server('srvB', 600, 330, '10.0.0.12');
  return topo('Failover mit Gratuitous ARP', [host('client', 120, 220, '10.0.0.5'), sw('sw1', 360, 220), a, b],
    [link('client', 'eth1', 'sw1', 'eth1'), link('srvA', 'eth1', 'sw1', 'eth2'), link('srvB', 'eth1', 'sw1', 'eth3')],
    [{ x: 500, y: 40, w: 220, h: 380, label: 'Cluster, Dienstadresse 10.0.0.100', color: 'orange' }]);
}
export function tcpPathTopo({ fwAcl = [] } = {}) {
  const web = server('web', 840, 220, '10.0.2.80', 24, '10.0.2.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 6000 }];
  return topo('TCP über einen Engpass', [host('client', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 270, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 460, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.2.0/24', '10.0.23.3']]),
    router('fw', 650, 220, { eth1: '10.0.23.3/24', eth2: '10.0.2.1/24' }, [['0.0.0.0/0', '10.0.23.2']], { acl: fwAcl }), web],
  [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'fw', 'eth1'), link('fw', 'eth2', 'web', 'eth1')],
  [{ x: 210, y: 130, w: 310, h: 150, label: 'Tunnel-Strecke, MTU 1400', color: 'orange' }]);
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/store.js" <<'__PACKETPILOT_FILE_END__'
// Speicherung im Browser, robust gegen gesperrten Speicher
const KEY = 'packetpilot.v1';
let mem = { progress: {}, nets: {}, prefs: {} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) mem = { ...mem, ...JSON.parse(raw) };
} catch { /* privates Fenster o. ä. */ }

function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignorieren */ } }

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
    if (typeof d !== 'object' || !d) throw new Error('Keine gültige PacketPilot-Datei');
    mem = { progress: d.progress || {}, nets: d.nets || {}, prefs: d.prefs || mem.prefs };
    persist();
  }
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/ui.js" <<'__PACKETPILOT_FILE_END__'
// Kleine DOM-Helfer
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
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/widgets.js" <<'__PACKETPILOT_FILE_END__'
// Interaktive Übungen für die Lektionen
import { h, esc } from './ui.js';
import { I } from './icons.js';
import { inNet, parseCidr, isGroupMac, isLocalMac } from './net.js';

const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.');

export function renderWidget(step, el, done) {
  const fn = { quiz, label, stack, mac, lpm, build }[step.type];
  const wrap = h('div', { class: 'widget' });
  if (step.title) wrap.append(h('h2', {}, step.title));
  if (step.intro) wrap.append(h('div', { class: 'theory', style: { padding: 0, margin: 0 }, html: step.intro }));
  el.append(wrap);
  fn(step, wrap, done);
}

// ---------------------------------------------------------------- Quiz
function quiz(step, el, done) {
  const state = step.questions.map(() => false);
  const check = () => { if (state.every(Boolean)) done(); };
  step.questions.forEach((q, qi) => {
    const box = h('div', { class: 'quiz-q' }, h('div', { style: { fontWeight: 600 }, html: q.q }));
    const explain = h('div', { class: 'explain hidden', html: q.explain || '' });
    if (q.input) {
      const inp = h('input', { class: 'input mono', type: 'text', 'aria-label': 'Antwort' });
      const fb = h('span', { class: 'feedback' });
      const test = () => {
        const ok = q.input.some(a => norm(a) === norm(inp.value));
        fb.textContent = ok ? 'Richtig' : 'Noch nicht';
        fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
        if (ok) { state[qi] = true; explain.classList.remove('hidden'); inp.disabled = true; check(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') test(); });
      box.append(h('div', { class: 'row', style: { marginTop: '10px' } }, inp, q.unit ? h('span', { class: 'muted' }, q.unit) : null,
        h('button', { class: 'btn', onclick: test }, 'Prüfen'), fb));
    } else {
      const opts = h('div', { class: 'opts', role: 'radiogroup' });
      q.options.forEach((o, oi) => {
        const lab = h('label', {}, h('input', { type: 'radio', name: `q${step.id}-${qi}` }), h('span', { html: o }));
        lab.querySelector('input').addEventListener('change', () => {
          opts.querySelectorAll('label').forEach(l => l.classList.remove('right', 'wrong'));
          if (oi === q.correct) { lab.classList.add('right'); state[qi] = true; explain.classList.remove('hidden'); check(); }
          else { lab.classList.add('wrong'); explain.classList.add('hidden'); }
        });
        opts.append(lab);
      });
      box.append(opts);
    }
    box.append(explain);
    el.append(box);
  });
}

// ---------------------------------------------------------------- Frame beschriften
function label(step, el, done) {
  const rows = step.rows || [step.slots];
  const all = rows.flat();
  const labels = shuffle([...all.map(s => s.label), ...(step.distractors || [])]);
  let picked = null;
  const chips = h('div', { class: 'chips', 'aria-label': 'Begriffe' });
  const fill = new Map();
  const chipEls = new Map();
  const drawChips = () => {
    chips.innerHTML = '';
    const used = new Set(fill.values());
    for (const l of labels) {
      if (used.has(l)) continue;
      const c = h('button', { class: 'dchip' + (picked === l ? ' sel' : ''), draggable: 'true' }, l);
      c.addEventListener('click', () => { picked = picked === l ? null : l; drawChips(); });
      c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', l); picked = l; });
      chipEls.set(l, c);
      chips.append(c);
    }
    if (!chips.childElementCount) chips.append(h('span', { class: 'muted small' }, 'Alle Begriffe verteilt.'));
  };
  const slotEls = [];
  const put = (slot, se, l) => {
    for (const [k, v] of fill) if (v === l) fill.delete(k);
    fill.set(slot, l); picked = null;
    drawSlots(); drawChips();
  };
  const drawSlots = () => {
    for (const { slot, se } of slotEls) {
      const l = fill.get(slot);
      se.className = 'slot' + (l ? ' filled' : '');
      se.innerHTML = '';
      se.append(h('div', { style: { fontWeight: l ? 600 : 400, color: l ? 'var(--ink)' : 'var(--ink-3)' } }, l || 'hier ablegen'),
        h('div', { class: 'size' }, slot.size || ''));
      se.style.borderTop = `5px solid var(--l-${slot.kind || 'data'})`;
    }
  };
  const grid = h('div', { style: { display: 'grid', gap: '6px' } });
  for (const r of rows) {
    const rowEl = h('div', { class: 'slotrow' });
    for (const slot of r) {
      const se = h('button', { class: 'slot', style: { width: `${slot.w || 90}px` }, 'aria-label': 'Feld' });
      se.addEventListener('click', () => { if (picked) put(slot, se, picked); else if (fill.has(slot)) { fill.delete(slot); drawSlots(); drawChips(); } });
      se.addEventListener('dragover', e => { e.preventDefault(); se.classList.add('over'); });
      se.addEventListener('dragleave', () => se.classList.remove('over'));
      se.addEventListener('drop', e => { e.preventDefault(); put(slot, se, e.dataTransfer.getData('text/plain')); });
      slotEls.push({ slot, se });
      rowEl.append(se);
    }
    grid.append(rowEl);
  }
  const fb = h('div', { class: 'feedback' });
  const explain = h('div', { class: 'explain hidden', html: step.explain || '' });
  el.append(h('p', { class: 'muted small' }, 'Begriff anklicken oder ziehen und auf ein Feld legen. Ein belegtes Feld leert sich mit einem Klick.'),
    chips, grid,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      let right = 0;
      for (const { slot, se } of slotEls) {
        const ok = fill.get(slot) === slot.label;
        se.classList.toggle('right', ok); se.classList.toggle('wrong', !!fill.get(slot) && !ok);
        if (ok) right++;
      }
      const all = right === slotEls.length;
      fb.textContent = all ? 'Alles richtig zugeordnet.' : `${right} von ${slotEls.length} richtig. Falsche Felder sind rot markiert.`;
      fb.className = 'feedback ' + (all ? 'ok' : 'bad');
      if (all) { explain.classList.remove('hidden'); done(); }
    } }, 'Prüfen'), fb), explain);
  drawChips(); drawSlots();
}

// ---------------------------------------------------------------- Reihenfolge
function stack(step, el, done) {
  let order = shuffle(step.items.map((_, i) => i));
  if (order.every((v, i) => v === i)) order = order.reverse();
  const list = h('div', { class: 'stack-list' });
  const fb = h('div', { class: 'feedback' });
  const explain = h('div', { class: 'explain hidden', html: step.explain || '' });
  let dragIdx = null;
  const draw = () => {
    list.innerHTML = '';
    order.forEach((idx, pos) => {
      const it = step.items[idx];
      const row = h('div', { class: 'stack-item', draggable: 'true', style: { borderLeftColor: `var(--l-${it.kind || 'data'})` } },
        h('span', { html: I.grip, style: { color: 'var(--ink-3)' } }),
        h('div', {}, h('b', {}, it.name), it.size ? h('span', { class: 'muted small' }, `  ${it.size}`) : null),
        h('div', { class: 'row', style: { gap: '2px' } },
          h('button', { class: 'btn icon ghost', title: 'nach oben', html: I.up, disabled: pos === 0 ? true : null, onclick: () => { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'nach unten', html: I.down, disabled: pos === order.length - 1 ? true : null, onclick: () => { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; draw(); } })));
      row.addEventListener('dragstart', () => { dragIdx = pos; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => { e.preventDefault(); if (dragIdx === null) return; const [m] = order.splice(dragIdx, 1); order.splice(pos, 0, m); dragIdx = null; draw(); });
      list.append(row);
    });
  };
  draw();
  el.append(h('p', { class: 'muted small' }, step.hint || 'Ziehe die Blöcke in die richtige Reihenfolge oder benutze die Pfeile.'), list,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      const ok = order.every((v, i) => v === i);
      fb.textContent = ok ? 'Richtig.' : 'Noch nicht ganz. Denke daran: Welche Schicht kommt zuerst auf das Kabel?';
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      if (ok) { explain.classList.remove('hidden'); done(); }
    } }, 'Prüfen'), fb), explain);
}

// ---------------------------------------------------------------- MAC-Decoder
const OUI = { '00:50:56': 'VMware (ESXi)', '00:0c:29': 'VMware (Workstation)', '52:54:00': 'QEMU/KVM (lokal vergeben)', 'aa:c1:ab': 'containerlab (lokal vergeben)',
  '02:42:ac': 'Docker (ältere Versionen)', '00:1b:21': 'Intel', '3c:fd:fe': 'Intel', 'f4:4d:30': 'Elitegroup', '00:00:5e': 'IANA (VRRP: 00:00:5e:00:01:xx)', '01:00:5e': 'IPv4-Multicast', '33:33:00': 'IPv6-Multicast' };
export function classifyMac(m) {
  if (m === 'ff:ff:ff:ff:ff:ff') return 'Broadcast';
  if (isGroupMac(m)) return 'Multicast';
  return isLocalMac(m) ? 'Unicast, lokal vergeben' : 'Unicast, vom Hersteller';
}
function mac(step, el, done) {
  const inp = h('input', { class: 'input mono', value: '00:50:56:a3:1f:7c', 'aria-label': 'MAC-Adresse', style: { width: '210px' } });
  const out = h('div');
  const draw = () => {
    out.innerHTML = '';
    const m = inp.value.trim().toLowerCase().replace(/-/g, ':');
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)) { out.append(h('p', { class: 'muted' }, 'Format: sechs Hex-Paare, z. B. 00:50:56:a3:1f:7c')); return; }
    const b = parseInt(m.slice(0, 2), 16);
    const bits = h('div', { class: 'macbits' });
    for (let i = 7; i >= 0; i--) bits.append(h('div', { class: i <= 1 ? 'hl' : '' }, (b >> i) & 1, h('span', {}, 'b' + i)));
    const oui = OUI[m.slice(0, 8)];
    out.append(h('p', {}, 'Erstes Byte ', h('code', {}, m.slice(0, 2)), ' binär, die beiden markierten Bits entscheiden:'), bits,
      h('table', { class: 'rtable' },
        h('tr', {}, h('th', {}, 'Bit b0 (I/G)'), h('td', {}, (b & 1) ? '1: Gruppe (Multicast oder Broadcast)' : '0: einzelne Schnittstelle (Unicast)')),
        h('tr', {}, h('th', {}, 'Bit b1 (U/L)'), h('td', {}, (b & 2) ? '1: lokal vergeben' : '0: vom Hersteller vergeben (OUI)')),
        h('tr', {}, h('th', {}, 'OUI'), h('td', {}, `${m.slice(0, 8)}${oui ? '  ' + oui : '  (nicht in der kleinen Liste)'}`)),
        h('tr', {}, h('th', {}, 'Ergebnis'), h('td', {}, classifyMac(m)))));
  };
  inp.addEventListener('input', draw);
  el.append(h('div', { class: 'row' }, h('label', { class: 'field' }, 'MAC-Adresse ausprobieren', inp)), out);
  draw();
  const qs = step.classify || [];
  const state = qs.map(() => false);
  const box = h('div', { class: 'quiz-q', style: { marginTop: '16px' } }, h('div', { style: { fontWeight: 600 } }, 'Ordne diese Adressen zu:'));
  qs.forEach((m, i) => {
    const s = h('select', { class: 'input' }, ['bitte wählen', 'Unicast, vom Hersteller', 'Unicast, lokal vergeben', 'Multicast', 'Broadcast'].map(o => h('option', {}, o)));
    const fb = h('span', { class: 'feedback' });
    s.addEventListener('change', () => {
      const ok = s.value === classifyMac(m);
      fb.textContent = ok ? 'Richtig' : 'Nein'; fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      state[i] = ok;
      if (state.every(Boolean)) done();
    });
    box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('code', { style: { width: '150px' } }, m), s, fb));
  });
  if (qs.length) el.append(box); else done();
}

// ---------------------------------------------------------------- Longest Prefix Match
export function lpmAnswer(table, ip) {
  let best = null;
  for (const [pre, nh] of table) {
    const p = parseCidr(pre);
    if (p && inNet(ip, p.net, p.len) && (!best || p.len > best.len)) best = { len: p.len, nh };
  }
  return best ? best.nh : 'keine Route';
}
function lpm(step, el, done) {
  const t = h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, 'Ziel'), h('th', {}, 'Next Hop')),
    step.table.map(([p, n]) => h('tr', {}, h('td', {}, p), h('td', {}, n))));
  const nhs = [...new Set(step.table.map(x => x[1])), ...(step.table.some(x => x[0].endsWith('/0')) ? [] : ['keine Route'])];
  const state = step.dests.map(() => false);
  const qs = h('div', { style: { display: 'grid', gap: '8px', marginTop: '14px' } });
  step.dests.forEach((ip, i) => {
    const s = h('select', { class: 'input' }, h('option', {}, 'bitte wählen'), nhs.map(n => h('option', {}, n)));
    const fb = h('span', { class: 'feedback' });
    s.addEventListener('change', () => {
      const ans = lpmAnswer(step.table, ip);
      const ok = s.value === ans;
      fb.textContent = ok ? 'Richtig' : 'Nein, prüfe, welche Einträge passen und welcher am längsten ist';
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      state[i] = ok;
      if (state.every(Boolean)) done();
    });
    qs.append(h('div', { class: 'row' }, h('span', {}, 'Paket an'), h('code', { style: { width: '120px' } }, ip), h('span', {}, 'geht an'), s, fb));
  });
  el.append(t, qs);
}

// ---------------------------------------------------------------- Frame konstruieren
const ETHERTYPES = [['0x0800', '0x0800 IPv4'], ['0x0806', '0x0806 ARP'], ['0x8100', '0x8100 802.1Q-Tag'], ['0x86dd', '0x86DD IPv6'], ['len', 'Länge (802.3 mit LLC)']];
export const BUILD_BLOCKS = {
  eth: { name: 'Ethernet', kind: 'eth', fields: [['dst', 'Ziel-MAC', 'mac'], ['src', 'Quell-MAC', 'mac'], ['type', 'EtherType', ETHERTYPES]] },
  vlan: { name: '802.1Q-Tag', kind: 'vlan', fields: [['vid', 'VLAN-ID', 'num'], ['type', 'EtherType danach', ETHERTYPES]] },
  arp: { name: 'ARP', kind: 'arp', fields: [['op', 'Operation', [['1', '1 Request'], ['2', '2 Reply']]], ['sha', 'Sender-MAC', 'mac'], ['spa', 'Sender-IP', 'ip'], ['tha', 'Ziel-MAC', 'mac'], ['tpa', 'Ziel-IP', 'ip']] },
  stp: { name: 'BPDU', kind: 'stp', fields: [['root', 'Root-ID', 'bid'], ['cost', 'Root-Pfadkosten', 'num'], ['bridge', 'Bridge-ID (Absender)', 'bid']] },
  ip: { name: 'IPv4', kind: 'ip', fields: [['src', 'Quell-IP', 'ip'], ['dst', 'Ziel-IP', 'ip'], ['proto', 'Protocol', [['1', '1 ICMP'], ['6', '6 TCP'], ['17', '17 UDP']]], ['ttl', 'TTL', 'num']] },
  icmp: { name: 'ICMP', kind: 'icmp', fields: [['type', 'Typ', [['8', '8 Echo Request'], ['0', '0 Echo Reply'], ['3', '3 Destination Unreachable'], ['11', '11 Time Exceeded']]]] },
  udp: { name: 'UDP', kind: 'udp', fields: [['sport', 'Quell-Port', 'num'], ['dport', 'Ziel-Port', 'num']] },
  tcp: { name: 'TCP', kind: 'tcp', fields: [['sport', 'Quell-Port', 'num'], ['dport', 'Ziel-Port', 'num'], ['flags', 'Flags', [['SYN', 'SYN'], ['SYN,ACK', 'SYN, ACK'], ['ACK', 'ACK'], ['PSH,ACK', 'PSH, ACK'], ['FIN,ACK', 'FIN, ACK'], ['RST', 'RST'], ['RST,ACK', 'RST, ACK']]]] },
  dns: { name: 'DNS', kind: 'udp', fields: [['qr', 'Art', [['0', 'Anfrage (QR 0)'], ['1', 'Antwort (QR 1)']]], ['name', 'Gesuchter Name', 'name']] },
  http: { name: 'HTTP', kind: 'data', fields: [['msg', 'Nachricht', [['GET', 'GET / HTTP/1.1'], ['200', 'HTTP/1.1 200 OK']]]] },
  data: { name: 'Daten', kind: 'data', fields: [] }
};
function matches(exp, val) {
  if (exp === '*') return val !== '' && val !== undefined;
  if (Array.isArray(exp)) return exp.some(e => matches(e, val));
  if (exp && typeof exp === 'object' && exp.range) { const n = Number(val); return val !== '' && n >= exp.range[0] && n <= exp.range[1]; }
  return String(exp).toLowerCase() === String(val ?? '').trim().toLowerCase();
}
export function checkBuild(expected, frame) {
  const res = { ok: true, layers: [], msgs: [] };
  const n = Math.max(expected.length, frame.length);
  for (let i = 0; i < n; i++) {
    const e = expected[i], f = frame[i];
    if (!f) { res.ok = false; res.msgs.push(`Es fehlt noch eine Schicht nach ${BUILD_BLOCKS[frame[i - 1]?.block]?.name || 'dem Anfang'}.`); break; }
    if (!e) { res.ok = false; res.layers[i] = { wrongBlock: true }; res.msgs.push(`${BUILD_BLOCKS[f.block].name} ist zu viel.`); continue; }
    if (e.block !== f.block) { res.ok = false; res.layers[i] = { wrongBlock: true }; res.msgs.push(`An Stelle ${i + 1} gehört eine andere Schicht als ${BUILD_BLOCKS[f.block].name}.`); continue; }
    const bad = Object.entries(e.fields || {}).filter(([k, v]) => !matches(v, f.fields[k])).map(([k]) => k);
    res.layers[i] = { bad };
    if (bad.length) res.ok = false;
  }
  if (res.ok) res.msgs.push('Der Frame stimmt.');
  else if (!res.msgs.length) res.msgs.push('Die Schichten stimmen, rot markierte Felder noch nicht.');
  return res;
}
function build(step, el, done) {
  const frame = [];
  const allowed = step.blocks || ['eth', 'vlan', 'arp', 'stp', 'ip', 'icmp', 'udp', 'tcp', 'dns', 'http', 'data'];
  const addr = step.addresses || {};
  const macs = [...(addr.mac || []), ['ff:ff:ff:ff:ff:ff', 'Broadcast'], ['00:00:00:00:00:00', 'unbekannt (Nullen)'], ['01:80:c2:00:00:00', 'STP-Multicast']];
  const ips = [...(addr.ip || []), ['0.0.0.0', 'keine Adresse']];
  const optsFor = t => t === 'mac' ? macs.map(([v, l]) => [v, `${v}  ${l}`]) : t === 'ip' ? ips.map(([v, l]) => [v, `${v}  ${l}`]) : t === 'bid' ? (addr.bid || []).map(([v, l]) => [v, `${v}  ${l}`]) : t === 'name' ? (addr.name || []).map(n => [n, n]) : null;
  const pal = h('div', { class: 'fb-pal bld-pal' });
  for (const k of allowed) {
    const b = BUILD_BLOCKS[k];
    pal.append(h('button', { class: 'fb-blk', style: { '--lc': `var(--l-${b.kind})` }, onclick: () => { frame.push({ block: k, fields: {} }); draw(); } }, b.name, h('span', { class: 'sz', html: I.plus })));
  }
  const area = h('div', { class: 'bld-frame' });
  const fb = h('div', { class: 'feedback' });
  const explain = h('div', { class: 'explain hidden', html: step.explain || '' });
  let result = null;
  const draw = () => {
    area.innerHTML = '';
    if (!frame.length) area.append(h('div', { class: 'empty' }, 'Noch leer. Wähle links die Schichten in der Reihenfolge, in der sie auf das Kabel gehen.'));
    frame.forEach((layer, i) => {
      const b = BUILD_BLOCKS[layer.block];
      const lr = result?.layers[i];
      const card = h('div', { class: 'bld-layer' + (lr?.wrongBlock ? ' wrong' : ''), style: { '--lc': `var(--l-${b.kind})` } });
      card.append(h('div', { class: 'bld-head' }, h('b', {}, `${i + 1}. ${b.name}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'nach oben', html: I.up, disabled: i === 0 ? true : null, onclick: () => { [frame[i - 1], frame[i]] = [frame[i], frame[i - 1]]; result = null; draw(); } }),
        h('button', { class: 'btn icon ghost', title: 'entfernen', html: I.trash, onclick: () => { frame.splice(i, 1); result = null; draw(); } })));
      if (b.fields.length) {
        const g = h('div', { class: 'bld-fields' });
        for (const [k, label, t] of b.fields) {
          const opts = Array.isArray(t) ? t : optsFor(t);
          let inp;
          if (opts) {
            inp = h('select', { class: 'input mono' }, h('option', { value: '' }, 'wählen'), opts.map(([v, l]) => h('option', { value: v, selected: layer.fields[k] === v ? true : null }, l)));
          } else inp = h('input', { class: 'input mono', type: t === 'num' ? 'number' : 'text', value: layer.fields[k] ?? '', placeholder: t === 'num' ? 'Zahl' : '' });
          inp.addEventListener('change', () => { layer.fields[k] = inp.value; result = null; card.querySelectorAll('.bad').forEach(x => x.classList.remove('bad')); });
          if (lr?.bad?.includes(k)) inp.classList.add('bad');
          g.append(h('label', { class: 'field' }, label, inp));
        }
        card.append(g);
      }
      area.append(card);
    });
  };
  draw();
  el.append(h('div', { class: 'quiz-q', html: step.task }),
    h('div', { class: 'bld' }, pal, area),
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      result = checkBuild(step.expected, frame);
      draw();
      fb.textContent = result.msgs.join(' ');
      fb.className = 'feedback ' + (result.ok ? 'ok' : 'bad');
      if (result.ok) { explain.classList.remove('hidden'); done(); }
    } }, 'Prüfen'), h('button', { class: 'btn ghost', onclick: () => { frame.length = 0; result = null; fb.textContent = ''; draw(); } }, 'Leeren'), fb), explain);
}
export { esc };
__PACKETPILOT_FILE_END__
}

check_system() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo oder als root ausführen."
  [ -r /etc/os-release ] || die "/etc/os-release fehlt, unbekanntes System."
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" = "debian" ] && { [ "${VERSION_ID:-}" = "12" ] || [ "${VERSION_ID:-}" = "13" ]; }; then
    ok "Debian ${VERSION_ID} (${VERSION_CODENAME:-?}) erkannt"
  elif [ "$PP_FORCE" = "yes" ]; then
    warn "Nicht getestetes System (${PRETTY_NAME:-unbekannt}), fahre wegen --force trotzdem fort."
  else
    die "Getestet für Debian 12 und 13, gefunden: ${PRETTY_NAME:-unbekannt}. Mit --force trotzdem installieren."
  fi
}

port_in_use() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -Hltn "sport = :${PP_PORT}" 2>/dev/null | grep -q .
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    ok "nginx ist bereits installiert"
  else
    say "Installiere nginx"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq nginx >/dev/null
    ok "nginx installiert"
  fi
}

write_site() {
  say "Schreibe nginx-Konfiguration für Port ${PP_PORT}"
  local listen6="    listen [::]:${PP_PORT};"
  if [ ! -f /proc/net/if_inet6 ]; then
    listen6="    # IPv6 ist auf diesem System nicht verfügbar"
    warn "Kein IPv6 verfügbar, PacketPilot lauscht nur auf IPv4."
  fi
  cat > "$PP_SITE" <<NGINX
# PacketPilot ${PP_VERSION}, erzeugt von packetpilot-install.sh
server {
    listen ${PP_PORT};
${listen6}
    server_name _;

    root ${PP_WWW};
    index index.html;
    charset utf-8;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'" always;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location ~* \.(js|css)\$ {
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
NGINX
  ln -sf "$PP_SITE" "$PP_LINK"
  if [ "$PP_PORT" = "80" ] && [ -L /etc/nginx/sites-enabled/default ]; then
    warn "Port 80: Die nginx-Standardseite wird deaktiviert (nur der Link in sites-enabled, die Datei bleibt)."
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx-Konfiguration fehlerhaft, siehe oben."; }
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
  ok "nginx neu geladen"
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${PP_PORT}/tcp" >/dev/null && ok "ufw: Port ${PP_PORT}/tcp freigegeben"
  fi
}

# Bei einer erneuten Installation den bisherigen Port beibehalten
keep_port() {
  if [ "$PP_PORT_SET" = "no" ] && [ -f "$PP_SITE" ]; then
    local old
    old="$(awk '/^[[:space:]]*listen[[:space:]]+[0-9]+;/ { gsub(";", "", $2); print $2; exit }' "$PP_SITE")"
    if [ -n "$old" ] && [ "$old" != "$PP_PORT" ]; then
      PP_PORT="$old"
      ok "Bisheriger Port ${PP_PORT} wird beibehalten (ändern mit --port)"
    fi
  fi
}

do_install() {
  check_system
  keep_port
  if port_in_use && [ ! -f "$PP_SITE" ]; then
    warn "Port ${PP_PORT} wird bereits verwendet. Wähle bei Problemen einen anderen mit --port."
  fi
  install_nginx
  say "Schreibe Webdateien nach ${PP_WWW}"
  local tmp
  tmp="$(mktemp -d)"
  write_files "$tmp"
  mkdir -p "$PP_ROOT"
  rm -rf "${PP_WWW}.new"
  mv "$tmp" "${PP_WWW}.new"
  rm -rf "$PP_WWW"
  mv "${PP_WWW}.new" "$PP_WWW"
  echo "$PP_VERSION" > "${PP_ROOT}/VERSION"
  chown -R root:root "$PP_ROOT"
  find "$PP_WWW" -type d -exec chmod 755 {} +
  find "$PP_WWW" -type f -exec chmod 644 {} +
  ok "$(find "$PP_WWW" -type f | wc -l) Dateien installiert"
  write_site
  open_firewall
  local ips
  ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -3 || true)"
  echo
  say "PacketPilot ${PP_VERSION} ist bereit:"
  if [ -n "$ips" ]; then
    for ip in $ips; do echo "      http://${ip}:${PP_PORT}/"; done
  else
    echo "      http://<IP-dieses-Servers>:${PP_PORT}/"
  fi
  echo
  echo "    Fortschritt und eigene Netze speichert jeder Browser für sich."
  echo "    Aktualisieren: sudo bash packetpilot-install.sh --update. Entfernen: --uninstall"
}

do_update() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo oder als root ausführen."
  local tmp new
  tmp="$(mktemp)"
  say "Lade die neueste Version von github.com/${PP_REPO}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$PP_SCRIPT_URL" -o "$tmp" || die "Download fehlgeschlagen: ${PP_SCRIPT_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$PP_SCRIPT_URL" || die "Download fehlgeschlagen: ${PP_SCRIPT_URL}"
  else
    die "Weder curl noch wget gefunden. Installieren mit: apt install curl"
  fi
  bash -n "$tmp" || die "Das heruntergeladene Skript ist fehlerhaft, Abbruch."
  new="$(sed -n 's/^PP_VERSION="\(.*\)"$/\1/p' "$tmp" | head -1)"
  [ -n "$new" ] || die "Das heruntergeladene Skript sieht nicht nach PacketPilot aus."
  say "Installiert: $(cat "${PP_ROOT}/VERSION" 2>/dev/null || echo keine), verfügbar: ${new}"
  local args=()
  [ "$PP_PORT_SET" = "yes" ] && args+=(--port "$PP_PORT")
  [ "$PP_FORCE" = "yes" ] && args+=(--force)
  exec bash "$tmp" "${args[@]}"
}

do_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo oder als root ausführen."
  say "Entferne PacketPilot"
  rm -f "$PP_LINK" "$PP_SITE"
  rm -rf "$PP_ROOT"
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
  ok "PacketPilot entfernt. nginx selbst bleibt installiert (entfernen mit: apt purge nginx)."
}

do_extract() {
  [ -n "$PP_EXTRACT_DIR" ] || die "Zielordner angeben: --extract ./web"
  mkdir -p "$PP_EXTRACT_DIR"
  write_files "$PP_EXTRACT_DIR"
  ok "Webdateien nach ${PP_EXTRACT_DIR} entpackt. Testen z. B. mit: python3 -m http.server -d ${PP_EXTRACT_DIR} 8080"
}

case "$PP_ACTION" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  extract)   do_extract ;;
esac
