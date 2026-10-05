#!/usr/bin/env bash
# =============================================================================
#  PacketPilot 1.1.0
#  Understand networks by watching every packet.
#
#  Installs the learning web app on Debian 12 (Bookworm) or 13 (Trixie):
#  nginx serves the static files, everything else runs in the browser.
#  Nothing is downloaded from the internet except the nginx packages
#  (and, with --update, the latest script from GitHub).
#
#  Usage:
#    sudo bash packetpilot-install.sh                 Install or update (port 8080)
#    sudo bash packetpilot-install.sh --port 80       On a different port
#    sudo bash packetpilot-install.sh --update        Fetch the latest version from GitHub
#    sudo bash packetpilot-install.sh --uninstall     Remove
#    bash packetpilot-install.sh --extract ./web      Only extract the web files (no root)
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
    *) die "Unknown option: $1 (help with --help)" ;;
  esac
done

case "$PP_PORT" in
  ''|*[!0-9]*) die "Invalid port: ${PP_PORT}" ;;
esac
[ "$PP_PORT" -ge 1 ] && [ "$PP_PORT" -le 65535 ] || die "Port must be between 1 and 65535."

write_files() {
  local W="$1"
  mkdir -p "$W/css"
  cat > "$W/css/app.css" <<'__PACKETPILOT_FILE_END__'
/* PacketPilot: network diagram on cool paper, packet layers in cable colors */
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

  /* Layers = colors of the wire pairs (T568B) plus additions */
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

/* ---------- Skeleton ---------- */
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

/* ---------- Controls ---------- */
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

/* ---------- Home page / course ---------- */
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

/* ---------- Lesson ---------- */
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

/* ---------- Lab ---------- */
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

/* ---------- SVG network diagram ---------- */
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

/* ---------- Lab page and networks ---------- */
.labpage { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.labbar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.labbar .title { font-weight: 650; margin-right: 8px; }
.netgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; margin-top: 16px; }
.netcard { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 16px; display: grid; gap: 8px; align-content: start; }
.netcard svg { width: 100%; height: 120px; background: var(--paper); border-radius: var(--r-s); border: 1px solid var(--grid-strong); }
.netcard h3 { margin: 4px 0 0; }

/* ---------- Frame builder ---------- */
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PacketPilot</title>
<meta name="description" content="Understand networks by watching every packet: course, lab and frame builder.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='8' width='26' height='16' rx='3' fill='%2317253A'/%3E%3Crect x='7' y='12' width='3' height='8' rx='1' fill='%232F6FDB'/%3E%3Crect x='12' y='12' width='3' height='8' rx='1' fill='%231F9D68'/%3E%3Crect x='17' y='12' width='3' height='8' rx='1' fill='%238B5E3C'/%3E%3Crect x='22' y='12' width='3' height='8' rx='1' fill='%23EE7F1A'/%3E%3C/svg%3E">
<link rel="stylesheet" href="css/app.css">
<script>try{var t=JSON.parse(localStorage.getItem('packetpilot.v1')||'{}').prefs;if(t&&t.theme)document.documentElement.dataset.theme=t.theme}catch(e){}</script>
</head>
<body>
<div class="app">
  <nav class="rail" aria-label="Main navigation">
    <a class="logo" href="#/" title="PacketPilot" aria-label="PacketPilot home">
      <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true"><rect x="3" y="8" width="26" height="16" rx="3" fill="var(--ink)"/><rect x="7" y="12" width="3" height="8" rx="1" fill="var(--l-eth)"/><rect x="12" y="12" width="3" height="8" rx="1" fill="var(--l-ip)"/><rect x="17" y="12" width="3" height="8" rx="1" fill="var(--l-udp)"/><rect x="22" y="12" width="3" height="8" rx="1" fill="var(--l-arp)"/></svg>
    </a>
    <a href="#/" data-nav="course"><span data-icon="course"></span>Course</a>
    <a href="#/lab" data-nav="lab"><span data-icon="lab"></span>Lab</a>
    <a href="#/networks" data-nav="networks"><span data-icon="nets"></span>Networks</a>
    <a href="#/builder" data-nav="builder"><span data-icon="frame"></span>Frames</a>
    <span class="spacer"></span>
    <button id="theme" type="button" title="Light or dark"></button>
  </nav>
  <main class="main"></main>
</div>
<noscript><p style="padding:2rem">PacketPilot requires JavaScript.</p></noscript>
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
// PacketPilot: views and navigation
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
function clear() { cleanup.forEach(f => { try { f(); } catch { /* ignore */ } }); cleanup = []; main.innerHTML = ''; main.scrollTop = 0; }

// ---------------------------------------------------------------- Theme
function applyTheme() {
  const t = store.prefs.theme;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const btn = document.querySelector('#theme');
  const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
  btn.innerHTML = (dark ? I.sun : I.moon) + (dark ? 'Light' : 'Dark');
}
document.querySelector('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  store.setPref('theme', dark ? 'light' : 'dark');
  applyTheme();
});
applyTheme();

// ---------------------------------------------------------------- Home page and course
function lessonProgress(l) { return { done: store.lessonDone(l.id), steps: store.lessonSteps(l.id), total: l.steps.length }; }
function viewHome() {
  const page = h('div', { class: 'page' });
  const heroBox = h('div', { class: 'hero-lab' }, h('span', { class: 'caption' }, 'Live: pc1 pings srv1. Every stripe on the envelope is a layer.'));
  const flat = MODULES.flatMap(m => m.lessons);
  const next = flat.find(l => !store.lessonDone(l.id)) || flat[0];
  const doneCount = flat.filter(l => store.lessonDone(l.id)).length;
  page.append(h('section', { class: 'hero' },
    h('div', {},
      h('h1', {}, 'PacketPilot'),
      h('p', {}, 'Understand networks by watching every packet. Build networks, send packets in slow motion, take every frame apart layer by layer and find faults before they find you in a real network.'),
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('a', { class: 'btn primary', href: `#/lesson/${next.id}` }, doneCount ? 'Continue learning' : 'Start with lesson 1'),
        h('a', { class: 'btn', href: '#/lab' }, 'Open the free lab')),
      h('div', { class: 'small muted', style: { marginTop: '12px' } }, `${doneCount} of ${flat.length} lessons completed`)),
    heroBox));
  page.append(h('h2', { style: { marginTop: '18px' } }, 'Course'));
  const mods = h('div', { class: 'modules' });
  MODULES.forEach((m, mi) => {
    const lp = m.lessons.map(lessonProgress);
    const allDone = lp.every(x => x.done);
    const list = h('ol', { class: 'lessons' });
    m.lessons.forEach((l, li) => {
      const p = lp[li];
      list.append(h('li', {}, h('a', { href: `#/lesson/${l.id}` },
        h('span', { class: 'st' + (p.done ? ' ok' : ''), html: p.done ? I.check : I.circle }),
        h('span', {}, l.title),
        h('span', { class: 'meta' }, p.done ? 'done' : p.steps ? `${p.steps} of ${p.total} steps` : `${l.minutes} min`))));
    });
    const pct = Math.round(lp.filter(x => x.done).length / lp.length * 100);
    mods.append(h('article', { class: 'module' + (allDone ? ' done' : '') },
      h('div', { class: 'num', 'aria-hidden': 'true' }, String(mi + 1)),
      h('div', {},
        h('h2', {}, m.title),
        h('div', { class: 'bands', 'aria-hidden': 'true' }, m.bands.map(b => h('i', { class: `bg-${b}` }))),
        h('p', { class: 'muted' }, m.text),
        h('div', { class: 'progressbar', title: `${pct} % done` }, h('i', { style: { width: `${pct}%` } })),
        list)));
  });
  page.append(mods);
  page.append(h('h2', { style: { marginTop: '28px' } }, 'Coming soon'),
    h('div', { class: 'netgrid' }, UPCOMING.map(u => h('div', { class: 'netcard' }, h('h3', {}, u.title), h('p', { class: 'muted small' }, u.text)))));
  page.append(h('div', { class: 'row', style: { marginTop: '28px' } },
    h('button', { class: 'btn', html: I.download + 'Export progress and networks', onclick: () => download('packetpilot-export.json', store.exportAll()) }),
    h('button', { class: 'btn', html: I.upload + 'Import', onclick: async () => { const t = await pickFile(); if (!t) return; try { store.importAll(t); toast('Import successful'); route(); } catch (e) { toast(e.message); } } }),
    h('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset progress for all lessons?')) { store.resetProgress(); route(); } } }, 'Reset progress')));
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

// ---------------------------------------------------------------- Lesson
function viewLesson(id, stepIdx) {
  const f = findLesson(id);
  if (!f) return viewHome();
  const { module: m, lesson: l } = f;
  let cur = Math.min(Math.max(0, Number(stepIdx) || 0), l.steps.length - 1);
  if (stepIdx === undefined) { const first = l.steps.findIndex((_, i) => !store.stepDone(l.id, i)); cur = first < 0 ? 0 : first; }
  const step = l.steps[cur];
  const top = h('div', { class: 'lesson-top' },
    h('a', { class: 'btn icon ghost', href: '#/', title: 'Back to the course overview', html: I.left }),
    h('div', {}, h('div', { class: 'crumb' }, `Module ${MODULES.indexOf(m) + 1}: ${m.title}`), h('h1', {}, l.title)));
  const steps = h('div', { class: 'steps', 'aria-label': 'Steps' });
  l.steps.forEach((s, i) => steps.append(h('button', { class: (i === cur ? 'cur ' : '') + (store.stepDone(l.id, i) ? 'ok' : ''), title: s.title || s.type,
    onclick: () => go(i), 'aria-current': i === cur ? 'step' : null }, store.stepDone(l.id, i) && i !== cur ? '✓' : String(i + 1))));
  top.append(steps);
  const body = h('div', { class: 'lesson-body' });
  const nextBtn = h('button', { class: 'btn primary' });
  const status = h('span', { class: 'small muted' });
  const nav = h('div', { class: 'lesson-nav' },
    h('button', { class: 'btn', disabled: cur === 0 ? true : null, onclick: () => go(cur - 1), html: I.left + 'Back' }), status, nextBtn);
  const go = i => { location.hash = `#/lesson/${l.id}/${i}`; };
  const isLast = cur === l.steps.length - 1;
  const markDone = () => {
    store.markStep(l.id, cur);
    steps.children[cur].classList.add('ok');
    if (l.steps.every((_, i) => store.stepDone(l.id, i))) store.markLesson(l.id);
    nextBtn.disabled = false;
    status.textContent = step.type === 'theory' ? '' : 'Step complete';
  };
  const nl = nextLesson(l.id);
  nextBtn.innerHTML = isLast ? (nl ? 'Next lesson' : 'To the overview') + I.right : 'Next' + I.right;
  nextBtn.addEventListener('click', () => {
    if (!isLast) return go(cur + 1);
    location.hash = nl ? `#/lesson/${nl.id}` : '#/';
  });
  const done0 = store.stepDone(l.id, cur);
  if (step.type !== 'theory' && !done0) { nextBtn.disabled = true; status.textContent = step.type === 'lab' ? 'Complete the goals on the left to continue' : 'Solve the exercise to continue'; }
  main.append(h('div', { class: 'lesson' }, top, body, nav));

  if (step.type === 'theory') {
    body.append(h('article', { class: 'theory' }, h('h2', { style: { marginTop: 0 } }, step.title), h('div', { html: step.html })));
    markDone();
  } else if (step.type === 'lab') {
    labStep(step, body, markDone, done0, l.id + ':' + cur);
  } else {
    renderWidget({ ...step, id: l.id + cur }, body, markDone);
    if (done0) { nextBtn.disabled = false; status.textContent = 'Already done, but you can solve it again'; }
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
      const inp = h('input', { class: 'input mono', placeholder: g.placeholder || 'Answer', 'aria-label': 'Answer' });
      const fb = h('span', { class: 'small' });
      const test = () => {
        const exp = g.expect(lab.sim).map(x => String(x).toLowerCase().trim());
        const ok = exp.includes(inp.value.toLowerCase().trim());
        fb.textContent = ok ? '' : 'Not yet, take another close look';
        fb.style.color = 'var(--err)';
        if (ok) { goalState[i] = true; inp.disabled = true; evaluate(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') test(); });
      li.querySelector('.txt').append(h('div', { class: 'ask' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, inp, h('button', { class: 'btn', onclick: test }, 'Check')), fb));
    }
    list.append(li);
    return li;
  });
  col.append(list);
  const hintBox = h('div');
  if (step.hints?.length) {
    let shown = 0;
    const btn = h('button', { class: 'btn ghost', html: I.bulb + 'Show a hint' });
    btn.addEventListener('click', () => { hintBox.append(h('div', { class: 'hint' }, step.hints[shown++])); if (shown >= step.hints.length) btn.remove(); });
    col.append(btn, hintBox);
  }
  const outro = h('div');
  col.append(outro);
  col.append(h('div', { class: 'row', style: { marginTop: '16px' } },
    h('button', { class: 'btn ghost', html: I.reset + 'Reload network', onclick: () => { lab.load(step.topo()); ctx.inspected = []; } })));
  let finished = false;
  function evaluate() {
    step.goals.forEach((g, i) => {
      if (!goalState[i] && g.check && g.check(lab.sim, ctx)) goalState[i] = true;
      items[i].classList.toggle('ok', goalState[i]);
      items[i].querySelector('.st').innerHTML = goalState[i] ? I.check : I.circle;
    });
    if (!finished && goalState.every(Boolean)) {
      finished = true;
      outro.append(h('div', { class: 'done-banner' }, 'All goals reached.'));
      if (step.outro) outro.append(h('div', { class: 'theory', style: { padding: '10px 0 0' }, html: step.outro }));
      markDone();
    }
  }
  if (already) { const n = h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'You have already completed this step. You can still play through it again.'); col.insertBefore(n, list); }
  // Open the first console so it is clear where to start
  const firstDev = Object.keys(step.presets || {})[0];
  if (firstDev) lab.selectByName(firstDev, 'console');
}

// ---------------------------------------------------------------- Lab
function viewLab(presetId) {
  let topo;
  if (presetId) topo = PRESETS.find(p => p.id === presetId)?.make();
  if (!topo) topo = store.prefs.sandbox ? clone(store.prefs.sandbox) : PRESETS.find(p => p.id === 'routed').make();
  const nameIn = h('input', { class: 'input', value: topo.name || 'My network', 'aria-label': 'Network name', style: { width: '220px' } });
  const savedSel = h('select', { class: 'input', 'aria-label': 'Saved networks' });
  const fillSaved = () => {
    savedSel.innerHTML = '';
    savedSel.append(h('option', { value: '' }, 'Saved networks …'));
    for (const n of Object.keys(store.nets()).sort()) savedSel.append(h('option', { value: n }, n));
  };
  fillSaved();
  const root = h('div', { style: { minHeight: 0 } });
  const page = h('div', { class: 'labpage' }, h('div', { class: 'labbar' },
    h('span', { class: 'title' }, 'Lab'), nameIn,
    h('button', { class: 'btn', html: I.save + 'Save', onclick: () => { lab.sim.topo.name = nameIn.value.trim() || 'My network'; store.saveNet(lab.sim.topo.name, clone(lab.sim.topo)); fillSaved(); toast(`"${lab.sim.topo.name}" saved`); } }),
    savedSel,
    h('button', { class: 'btn ghost', onclick: () => { const n = savedSel.value; if (n && confirm(`Delete "${n}"?`)) { store.deleteNet(n); fillSaved(); } } }, 'Delete'),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => { if (confirm('Start an empty network? Unsaved changes will be lost.')) { lab.load({ name: 'My network', devices: [], links: [] }); nameIn.value = 'My network'; } } }, 'New'),
    h('a', { class: 'btn', href: '#/networks' }, 'Example networks'),
    h('button', { class: 'btn', html: I.download + 'Export', onclick: () => download(`${(lab.sim.topo.name || 'network').replace(/\W+/g, '-')}.json`, JSON.stringify(lab.sim.topo, null, 2)) }),
    h('button', { class: 'btn', html: I.upload + 'Import', onclick: async () => {
      const t = await pickFile(); if (!t) return;
      try { const d = JSON.parse(t); if (!Array.isArray(d.devices) || !Array.isArray(d.links)) throw new Error(); lab.load(d); nameIn.value = d.name || 'Imported'; toast('Network imported'); }
      catch { toast('This file is not a PacketPilot network'); }
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

// ---------------------------------------------------------------- Example networks
function viewNets() {
  const page = h('div', { class: 'page' }, h('h1', {}, 'Example networks'),
    h('p', { class: 'muted' }, 'Ready-made topologies to experiment with. A network opens in the lab, where you can change everything and save it under your own name.'));
  const grid = h('div', { class: 'netgrid' });
  for (const p of PRESETS) {
    grid.append(h('article', { class: 'netcard' }, preview(p.make()), h('h3', {}, p.title),
      h('div', { class: 'row' }, p.topics.map(t => h('span', { class: 'chip' }, t))),
      h('p', { class: 'muted small' }, p.text),
      h('div', {}, h('a', { class: 'btn primary', href: `#/lab/${p.id}` }, 'Open in the lab'))));
  }
  page.append(grid);
  main.append(page);
}

// ---------------------------------------------------------------- Router
// Older German links (#/lektion, #/labor, #/netze, #/baukasten) keep working
const ALIAS = { lektion: 'lesson', labor: 'lab', netze: 'networks', baukasten: 'builder' };
function route() {
  clear();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const nav = ALIAS[parts[0]] || parts[0] || '';
  document.querySelectorAll('.rail a').forEach(a => a.classList.toggle('active',
    (a.dataset.nav === 'course' && (nav === '' || nav === 'lesson')) || a.dataset.nav === nav));
  if (nav === 'lesson') viewLesson(parts[1], parts[2]);
  else if (nav === 'lab') viewLab(parts[1]);
  else if (nav === 'networks') viewNets();
  else if (nav === 'builder') { renderFrameBuilder(main); }
  else viewHome();
  document.title = 'PacketPilot';
}
window.addEventListener('hashchange', route);
route();
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/cli.js" <<'__PACKETPILOT_FILE_END__'
// Small command line per device, modeled on iproute2 and FRR
import { isIp, parseCidr } from './net.js';
import { PORTS } from './engine.js';

const pad = (s, n) => String(s).padEnd(n);

export function helpFor(dev) {
  const l = [];
  if (dev.l3) l.push(
    'ping <ip> [-c count] [-s size] [-M do|dont] [-t ttl]',
    'traceroute <ip>',
    'ip addr               show addresses (also: ip -br a)',
    'ip route              routing table (kernel)',
    'ip route get <ip>     which route does a packet take?',
    'ip route add <net> via <ip>   add a static route',
    'ip route del <net>    remove a static route',
    'ip neigh              ARP table',
    'ip neigh flush        flush the ARP table',
    'arping [-U|-A|-D] [-c n] <ip>   ARP request, gratuitous ARP (-U/-A), duplicate address check (-D)',
    'curl http://<ip>[:port]/         fetch HTTP over TCP',
    'nc -zv <ip> <port>    check whether a TCP port is open',
    'nc -u <ip> <port>     send a UDP datagram',
    'dig [@server] <name>  DNS query over UDP 53',
    'curl http://<name>/   DNS first, then TCP (DNS server in the configuration)',
    'ss -tan / ss -tuln    TCP connections / open ports');
  if (dev.type === 'router') l.push(
    'ip link add link eth1 name eth1.10 type vlan id 10   create a subinterface',
    'ip addr add 10.10.0.1/24 dev eth1.10   set an address',
    'ip link del eth1.10   delete a subinterface');
  l.push('ip link set <port> down|up   disconnect or reconnect the cable on this port');
  if (dev.type === 'router') l.push('show ip route         routing table in FRR style', 'sysctl net.ipv4.ip_forward=0|1');
  if (dev.bridge) l.push('bridge fdb            MAC table (also: show mac address-table)', 'bridge fdb flush      flush the MAC table');
  if (dev.type === 'switch') l.push('show spanning-tree    STP status: root, roles, states',
    'spanning-tree on|off  turn STP on or off',
    'spanning-tree priority <0-61440>   bridge priority (multiples of 4096)',
    'spanning-tree portfast <port> on|off   port as edge port',
    'spanning-tree cost <port> <cost>       port cost');
  if (dev.type === 'vtep') l.push('show vxlan            VXLAN segments, flood lists, MTU');
  l.push('clear                 clear the console');
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
      if (!dev.l3) return say('This device has no IP address. Pings can be sent from PCs, servers, routers and VTEPs.');
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
      if (!isIp(dst)) return say('ping: please enter a valid IPv4 address, e.g. ping 10.0.0.2');
      dev.ping(dst, o); return;
    }
    if (p[0] === 'traceroute' || p[0] === 'tracert') {
      if (!dev.l3) return say('This device has no IP address.');
      const dst = p.find((x, i) => i > 0 && isIp(x));
      if (!dst) return say('traceroute: please enter an IPv4 address.');
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
          sim.record(dev, 'info', `Address ${raw[0]}/${c.len} ${act === 'add' ? 'set on ' + ifn : 'removed from ' + ifn}`, { tag: 'addr-changed', data: { ifname: ifn } });
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
            if (n !== 'lo') say(`    link/ether ${dev.mac(n)}${c.vlan ? `  (${c.parent ? '802.1Q id' : 'VLAN tag'} ${c.vlan})` : ''}`);
            if (addr) say(`    inet ${addr}`);
          }
        }
        return;
      }
      if (/^r(oute)?$/.test(sub)) {
        const act = p[2];
        if (act === 'get') {
          const dst = p[3];
          if (!isIp(dst)) return say('Please enter an IP address.');
          if (dev.l3.isOwn(dst)) return say(`local ${dst} dev lo  (own address)`);
          const r = dev.l3.lookup(dst);
          if (!r) return say('RTNETLINK answers: Network is unreachable');
          const pm = dev.l3.pmtu.get(dst);
          return say(`${dst}${r.via ? ' via ' + r.via : ''} dev ${r.dev} src ${dev.l3.ifIp(r.dev)}   [match: ${r.net}/${r.len}]${pm ? `\n    cache mtu ${pm}` : ''}`);
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
            if (!dev.l3.routes().find(r => r.proto === 'S' && `${r.net}/${r.len}` === key)?.dev) say(`Note: next hop ${via} is not in any directly connected network, the route is inactive.`);
          } else {
            const before = dev.cfg.routes.length;
            dev.cfg.routes = dev.cfg.routes.filter(r => { const c = parseCidr(r.dst); return !c || `${c.net}/${c.len}` !== key; });
            if (before === dev.cfg.routes.length) return say('RTNETLINK answers: No such process');
          }
          sim.record(dev, 'info', `Route ${key} ${act === 'add' ? 'added' : 'removed'}`, { tag: 'route-changed', data: { dst: key, act } });
          sim.configChanged(dev.id);
          return say('OK');
        }
        for (const r of dev.l3.routes()) {
          if (r.proto === 'C') say(`${r.net}/${r.len} dev ${r.dev} proto kernel scope link src ${r.src}`);
          else say(`${r.len === 0 ? 'default' : r.net + '/' + r.len} via ${r.via}${r.dev ? ' dev ' + r.dev : '  (inactive: next hop unreachable)'}`);
        }
        return;
      }
      if (/^n(eigh|eighbor)?$/.test(sub)) {
        if (p[2] === 'flush') { dev.l3.arp.clear(); sim.record(dev, 'info', 'ARP table flushed', { tag: 'arp-flushed' }); return say('OK'); }
        const t = dev.l3.arpTable();
        if (!t.length) return say('(empty)');
        for (const e of t) say(`${e.ip} dev ${e.ifname}${e.mac ? ' lladdr ' + e.mac : ''} ${e.state}`);
        return;
      }
      return say('Unknown ip command. Type help.');
    }
    if (p[0] === 'ip' && p[1] === 'link') {
      const act = p[2];
      if (act === 'set') {
        const port = p[3], st = p[4];
        const l = sim.linkAt(dev.id, port);
        if (!l || !['up', 'down'].includes(st)) return say(l ? 'Syntax: ip link set eth1 down|up' : `${port || '?'}: no cable on this port`);
        sim.setLinkUp(l, st === 'up');
        return say('OK');
      }
      if (act === 'add' && dev.type === 'router') {
        const m = cmd.match(/ip link add link (\S+) name (\S+) type vlan id (\d+)/);
        if (!m) return say('Syntax: ip link add link eth1 name eth1.10 type vlan id 10');
        const [, par, name, vid] = m;
        if (!PORTS.router.includes(par)) return say(`${par}: not a physical interface`);
        if (dev.cfg.ifaces[name]) return say('RTNETLINK answers: File exists');
        const v = Number(vid);
        if (!(v >= 1 && v <= 4094)) return say('VLAN ID must be between 1 and 4094');
        if (Object.values(dev.cfg.ifaces).some(c => c.parent === par && Number(c.vlan) === v)) return say(`${par} already has a subinterface for VLAN ${v}`);
        dev.cfg.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 };
        sim.record(dev, 'info', `Subinterface ${name} created on ${par} for VLAN ${v}`, { tag: 'subif-added', data: { name, vlan: v } });
        sim.configChanged(dev.id);
        return say('OK');
      }
      if ((act === 'del' || act === 'delete') && dev.type === 'router') {
        const name = p[3];
        if (!dev.cfg.ifaces?.[name]?.parent) return say('Only subinterfaces can be deleted.');
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
      if (!dev.l3) return say('This device has no IP address.');
      const o = { mode: 'normal' }; let ip = null;
      for (let i = 1; i < p.length; i++) {
        if (p[i] === '-U') o.mode = 'gratuitous';
        else if (p[i] === '-A') o.mode = 'reply';
        else if (p[i] === '-D') o.mode = 'dad';
        else if (p[i] === '-c') o.count = Math.min(10, Math.max(1, Number(p[++i]) || 1));
        else if (p[i] === '-I') o.ifname = p[++i];
        else ip = p[i];
      }
      if (!isIp(ip)) { say(`$ ${cmd}`); return say('Syntax: arping [-U|-A|-D] [-c count] [-I interface] <ip>'); }
      if (o.ifname && !dev.cfg.ifaces?.[o.ifname]) { say(`$ ${cmd}`); return say(`arping: interface ${o.ifname} does not exist`); }
      dev.arping(ip, o); return;
    }
    if (p[0] === 'curl' && dev.l3) {
      const u = p.slice(1).find(x => !x.startsWith('-')) || '';
      const m = u.match(/^(?:http:\/\/)?([a-zA-Z0-9.-]+)(?::(\d+))?\/?$/);
      if (!m) { say(`$ ${cmd}`); return say('Syntax: curl http://10.0.0.10/ or curl http://web.lab:8080/'); }
      const port = m[2] ? Number(m[2]) : 80;
      if (isIp(m[1])) { dev.curl(m[1], port); return; }
      say(`$ ${cmd}`);
      dev.resolve(m[1], ip => ip ? dev.curl(ip, port, { noEcho: true }) : say(`curl: (6) Could not resolve host: ${m[1]}`)); return;
    }
    if (p[0] === 'nc' && dev.l3) {
      const args = p.slice(1).filter(x => !x.startsWith('-'));
      const flags = p.slice(1).filter(x => x.startsWith('-')).join('');
      const [ip, port] = args; const n = Number(port);
      if (!isIp(ip) || !(n >= 1 && n <= 65535)) { say(`$ ${cmd}`); return say('Syntax: nc -zv <ip> <port>  or  nc -u <ip> <port>'); }
      if (flags.includes('u')) dev.udpSend(ip, n, 32); else dev.ncz(ip, n);
      return;
    }
    if ((p[0] === 'dig' || p[0] === 'nslookup') && dev.l3) {
      let server = null, name = null;
      for (const x of p.slice(1)) { if (x.startsWith('@')) server = x.slice(1); else if (isIp(x) && p[0] === 'nslookup') server = x; else if (!x.startsWith('+')) name = x; }
      server ??= (dev.cfg.resolver || '');
      if (!name) { say(`$ ${cmd}`); return say('Syntax: dig @<server-ip> <name>   e.g. dig @10.0.2.53 web.lab'); }
      if (!isIp(server)) { say(`$ ${cmd}`); return say(';; No DNS server configured. Specify one with @<ip> or enter it in the configuration.'); }
      dev.dig(server, name); return;
    }
    if (p[0] === 'ss' && dev.l3) {
      const f = p.slice(1).join('');
      if (f.includes('l')) {
        say(`${pad('Netid', 7)}${pad('State', 9)}${pad('Local Address:Port', 24)}Service`);
        const svcs = dev.cfg.services || [];
        if (!svcs.length) return say('(no service is listening)');
        for (const s of svcs) if (f.includes(s.proto[0]) || !/[tu]/.test(f)) say(`${pad(s.proto, 7)}${pad(s.proto === 'tcp' ? 'LISTEN' : 'UNCONN', 9)}${pad('0.0.0.0:' + s.port, 24)}${s.name || ''}`);
        return;
      }
      say(`${pad('State', 13)}${pad('Local Address:Port', 24)}Peer Address:Port`);
      const rows = [...dev.l3.tcp.values()];
      if (!rows.length) return say('(no TCP connections)');
      for (const c of rows) say(`${pad(c.state, 13)}${pad((c.local || dev.l3.srcFor(c.rip)) + ':' + c.lport, 24)}${c.rip}:${c.rport}`);
      return;
    }
    if (dev.type === 'switch' && (p[0] === 'spanning-tree' || (p[0] === 'show' && /^span/.test(p[1] || '')))) {
      const b = dev.bridge, st = dev.cfg.stp;
      if (p[0] === 'spanning-tree') {
        const change = (text, data) => { sim.record(dev, 'info', text, { tag: 'stp-config', data }); sim.configChanged(dev.id); say('OK'); };
        if (p[1] === 'on' || p[1] === 'off') { st.enabled = p[1] === 'on'; return change(`Spanning tree ${st.enabled ? 'turned on' : 'turned off'}`, { enabled: st.enabled }); }
        if (p[1] === 'priority') {
          const v = Number(p[2]);
          if (!(v >= 0 && v <= 61440 && v % 4096 === 0)) return say('The priority must be a multiple of 4096 between 0 and 61440.');
          st.priority = v; return change(`Bridge priority set to ${v}`, { priority: v });
        }
        if (p[1] === 'portfast' || p[1] === 'cost') {
          const port = p[2];
          if (!dev.cfg.ports[port]) return say(`${port || '?'}: unknown port`);
          if (p[1] === 'portfast') { dev.cfg.ports[port].edge = p[3] !== 'off'; return change(`${port}: PortFast ${dev.cfg.ports[port].edge ? 'on' : 'off'}`, { port }); }
          const c = Number(p[3]);
          if (!(c >= 1 && c <= 200000000)) return say('Syntax: spanning-tree cost eth1 19');
          dev.cfg.ports[port].cost = c; return change(`${port}: port cost ${c}`, { port, cost: c });
        }
        return say('Syntax: spanning-tree on|off | priority <n> | portfast <port> on|off | cost <port> <n>');
      }
      const t = b.stpTable();
      if (!t) return say('Spanning tree is turned off. Turn it on with: spanning-tree on');
      say(`Root ID     ${t.root}${t.isRoot ? '   (this bridge is the root)' : ''}`);
      if (!t.isRoot) say(`            Cost ${t.rootCost}, root port ${t.rootPort}`);
      say(`Bridge ID   ${t.bridge}`);
      const tm = dev.bridge.timers();
      say(`Timers      Hello ${tm.hello} s, Max Age ${tm.maxAge} s`);
      say(`            Forward Delay ${tm.fwd} s`);
      say('');
      say(`${pad('Port', 6)}${pad('Role', 6)}${pad('State', 12)}${pad('Cost', 7)}Port ID`);
      for (const r of t.ports) say(`${pad(r.port, 6)}${pad({ root: 'Root', designated: 'Desg', alternate: 'Altn', disabled: 'Disa' }[r.role], 6)}${pad(r.state, 12)}${pad(r.cost, 7)}${r.id}${r.edge ? ' Edge' : ''}`);
      return;
    }
    if (p[0] === 'arp' && dev.l3) return runCommand(dev, 'ip neigh');
    if (p[0] === 'show' && p[1] === 'ip' && p[2] === 'route' && dev.l3) {
      say('Codes: C - connected, S - static, > - selected route, * - FIB route');
      for (const r of dev.l3.routes()) {
        if (r.proto === 'C') say(`C>* ${r.net}/${r.len} is directly connected, ${r.dev}`);
        else say(`S${r.dev ? '>*' : '  '} ${r.net}/${r.len} [1/0] via ${r.via}${r.dev ? ', ' + r.dev : ' inactive'}`);
      }
      return;
    }
    if (p[0] === 'sysctl' && dev.type === 'router') {
      const m = cmd.match(/ip_forward\s*=\s*([01])/);
      if (m) { dev.cfg.forwarding = m[1] === '1'; sim.record(dev, 'info', `IP forwarding ${dev.cfg.forwarding ? 'turned on' : 'turned off'}`, { tag: 'forwarding-changed', data: { on: dev.cfg.forwarding } }); sim.configChanged(dev.id); return say(`net.ipv4.ip_forward = ${m[1]}`); }
      return say(`net.ipv4.ip_forward = ${dev.cfg.forwarding !== false ? 1 : 0}`);
    }
    if ((p[0] === 'bridge' && p[1] === 'fdb') || (p[0] === 'show' && p[1] === 'mac')) {
      if (!dev.bridge) return say('This device has no bridge.');
      if (p[2] === 'flush') { dev.bridge.fdb.clear(); sim.record(dev, 'info', 'MAC table flushed', { tag: 'fdb-flushed' }); return say('OK'); }
      const t = dev.bridge.table();
      if (!t.length) return say('(empty)');
      say(`${pad('VLAN', 6)}${pad('MAC', 20)}${pad('Port', 12)}Age`);
      for (const e of t) say(`${pad(e.vid, 6)}${pad(e.mac, 20)}${pad(e.port, 12)}${e.age.toFixed(1)} s${e.remote ? '   dst ' + e.remote : ''}`);
      return;
    }
    if (p[0] === 'show' && p[1] === 'vxlan' && dev.type === 'vtep') {
      const ms = dev.maps();
      if (!ms.length) return say('(no VXLAN segments)');
      for (const m of ms) say(`vxlan${m.vni}: VNI ${m.vni} ↔ VLAN ${m.vlan}, local ${dev.localIp()}, dstport ${m.dstport || 4789}, mtu ${dev.vxlanMtu(m)}, flood ${(m.flood || []).join(', ') || '(empty)'}`);
      return;
    }
    say(`Unknown command: ${p[0]}. Type help for an overview.`);
  } finally {
    sim.emit('cli', { devId: dev.id, cmd });
  }
}

export { PORTS };
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/helpers.js" <<'__PACKETPILOT_FILE_END__'
// Helpers for lesson content and goal checks
export function bar(parts, caption = '') {
  // parts: [label, sizeText, kind, flex]
  const cells = parts.map(([l, s, k, f]) =>
    `<div style="flex:${f || 1} 0 0;min-width:54px;background:var(--l-${k});color:#fff;padding:6px 8px;border-right:1px solid rgba(255,255,255,.35)">
      <div style="font-weight:650;font-size:.82rem">${l}</div><div style="font-family:var(--mono);font-size:.72rem;opacity:.9">${s}</div></div>`).join('');
  return `<div style="display:flex;border-radius:8px;overflow:hidden;margin:14px 0 4px;border:1px solid var(--line)">${cells}</div>${caption ? `<div class="small muted">${caption}</div>` : ''}`;
}
export const note = (html, warn = false) => `<div class="note${warn ? ' warn' : ''}">${html}</div>`;

// Goal checks
export const pingOk = (from, to, o = {}) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received > 0
  && (o.size === undefined || e.data.size >= o.size) && (o.df === undefined || e.data.df === o.df));
export const pingFailed = (from, to, o = {}) => sim => sim.log.some(e => e.tag === 'ping-done' && e.dev === from && e.data.dst === to && e.data.received === 0
  && (o.size === undefined || e.data.size >= o.size));
export const tag = (dev, t, pred = () => true) => sim => sim.log.some(e => e.tag === t && (!dev || e.dev === dev) && pred(e.data || {}, e));
export const inspected = pred => (sim, ctx) => ctx.inspected.some(e => e.frame && pred(e.frame));
export const isArpReq = f => f.type === 'arp' && f.payload.op === 1;
export const isVxlan = f => f.type === 'ipv4' && f.payload.l4?.payload?.kind === 'vxlan';
export const all = (...fs) => (sim, ctx) => fs.every(f => f(sim, ctx));
// Ping succeeded after a specific event occurred
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

// Display order: all of layer 2, then layer 3, VLAN/VXLAN, transport
export const MODULES = [m1, m4, m2, m3, m5];
export const UPCOMING = [
  { title: 'Static routing and ECMP', text: 'Several equally good paths, load balancing via hashes.' },
  { title: 'OSPF and BFD', text: 'Learn routes dynamically and detect failures in milliseconds.' },
  { title: 'VRRP', text: 'A gateway that does not fail.' },
  { title: 'DHCP and DNS in detail', text: 'Hand out addresses with a relay across routers, the DNS hierarchy and recursive resolution.' },
  { title: 'VPN', text: 'WireGuard and IPsec between sites, MTU with a double envelope.' },
  { title: 'BGP and EVPN', text: 'Routing between networks and a real control plane for VXLAN.' },
  { title: 'IPv6', text: 'Addresses, Neighbor Discovery instead of ARP, SLAAC and dual stack.' }
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
  id: 'm1', title: 'Ethernet, MAC and ARP', bands: ['eth', 'arp', 'vlan'],
  text: 'How data gets wrapped, what a frame looks like byte by byte, how a switch learns and how ARP translates IP addresses into MAC addresses.',
  lessons: [
    { id: 'm1-l1', title: 'Encapsulation: every layer wraps', minutes: 8, steps: [
      { type: 'theory', title: 'Every layer wraps', html: `
<p>Every layer treats whatever it receives from above as payload. It puts its own header in front and hands everything down. Ethernet also appends a checksum at the end. The receiver unwraps in reverse order.</p>
${bar([['Ethernet', '14 bytes', 'eth', 1.2], ['IPv4', '20 bytes', 'ip', 1.4], ['UDP', '8 bytes', 'udp', 1], ['Application data', 'any size', 'data', 3.2], ['FCS', '4 bytes', 'eth', .8]], 'This is how a UDP packet sits on the wire: Ethernet on the outside, the application on the inside.')}
<table><tr><th>Layer</th><th>Data unit</th><th>Addressed by</th><th>Device that decides here</th></tr>
<tr><td>Application</td><td>Message</td><td>Hostname, URL</td><td>Server, client</td></tr>
<tr><td>Transport</td><td>Segment (TCP), datagram (UDP)</td><td>Port</td><td>Firewall, load balancer</td></tr>
<tr><td>Internet</td><td>Packet</td><td>IP address</td><td>Router</td></tr>
<tr><td>Link</td><td>Frame</td><td>MAC address</td><td>Switch</td></tr></table>
${note('<b>Every device only looks as deep as it has to.</b> A switch reads the Ethernet header. A router unwraps the frame, reads the IP header, decides and wraps the packet in a <i>new</i> frame. Neither of them touches anything above that.')}
<p>In the lab you can see this on every packet: the colored stripes on the envelope are its layers, from outside to inside. Clicking a packet takes it apart in the packet inspector.</p>` },
      { type: 'stack', title: 'Put the parts in the right order', hint: 'The top is what goes over the wire first.',
        items: [{ name: 'Ethernet header', size: '14 bytes', kind: 'eth' }, { name: 'IPv4 header', size: '20 bytes', kind: 'ip' }, { name: 'UDP header', size: '8 bytes', kind: 'udp' },
          { name: 'Application data', size: 'e.g. a DNS query', kind: 'data' }, { name: 'FCS (checksum)', size: '4 bytes', kind: 'eth' }],
        explain: 'The outermost layer comes first so that every device can immediately read what it needs. Only the FCS sits at the end: the network card can only compute it once all bytes have gone by.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which header does a switch read to decide where a frame goes?', options: ['IP header', 'Ethernet header', 'UDP header', 'All headers'], correct: 1,
          explain: 'A switch works on layer 2. It only needs the destination MAC in the Ethernet header.' },
        { q: 'What does a router change in a packet it forwards?', options: ['Nothing, it just passes it on', 'The destination IP address', 'It builds a new Ethernet frame and decrements the TTL in the IP header', 'The UDP port'], correct: 2,
          explain: 'The router strips the old Ethernet header, subtracts one from the TTL and wraps the packet in a new frame for the next segment. IP addresses and ports stay the same (without NAT).' }] }
    ] },

    { id: 'm1-l2', title: 'The Ethernet frame byte by byte', minutes: 12, steps: [
      { type: 'theory', title: 'Structure of an Ethernet II frame', html: `
<p>Almost every network you work with uses <b>Ethernet II</b>. Before and after the actual frame there are additional fields of the physical layer.</p>
${bar([['Preamble', '7', 'frag', .9], ['SFD', '1', 'frag', .5], ['Dest. MAC', '6', 'eth', 1.1], ['Source MAC', '6', 'eth', 1.1], ['Type', '2', 'eth', .7], ['Payload', '46 to 1500', 'ip', 3], ['FCS', '4', 'eth', .7], ['IFG', '12', 'frag', .9]], 'Gray: physical layer, blue: Ethernet, green: payload (e.g. an IP packet). Numbers in bytes.')}
<table><tr><th>Field</th><th>Purpose</th></tr>
<tr><td>Preamble, SFD</td><td>Bit pattern that lets the receiver synchronize, the SFD marks the start. Part of the physical layer.</td></tr>
<tr><td>Destination MAC</td><td>Comes <b>first</b> so that a switch can decide as early as possible.</td></tr>
<tr><td>Source MAC</td><td>Sender. From this the switch learns where each device is connected.</td></tr>
<tr><td>EtherType</td><td>What the payload contains: <code>0x0800</code> IPv4, <code>0x0806</code> ARP, <code>0x86DD</code> IPv6, <code>0x8100</code> VLAN tag.</td></tr>
<tr><td>Payload</td><td>46 to 1500 bytes. A payload that is too short is filled up with zeros (padding). The upper limit is the <b>MTU</b>.</td></tr>
<tr><td>FCS</td><td>CRC-32 over the frame. If it does not match, the frame is <b>silently</b> dropped.</td></tr>
<tr><td>IFG</td><td>Minimum gap before the next frame.</td></tr></table>
${note('A frame is at least <b>64 bytes</b> long (destination MAC through FCS). This dates back to the time when everyone shared one cable: a sender had to notice a collision while it was still transmitting. An ARP message (28 bytes) is therefore padded to 46 bytes of payload.')}
<h2>What is left of 1 Gbit/s</h2>
<pre>On the wire:    8 + 14 + 1500 + 4 + 12          = 1538 bytes per frame
TCP payload:    1500 - 20 (IP) - 20 (TCP) - 12 (timestamps) = 1448 bytes
1448 / 1538 = 94.1 %   →   approx. 941 Mbit/s</pre>
<p>This is exactly the value <code>iperf3</code> measures on a clean gigabit link.</p>` },
      { type: 'label', title: 'Label the frame', distractors: ['TTL', 'Port', 'VNI'],
        slots: [{ label: 'Preamble', size: '7 bytes', kind: 'frag', w: 92 }, { label: 'SFD', size: '1 byte', kind: 'frag', w: 70 },
          { label: 'Dest. MAC', size: '6 bytes', kind: 'eth', w: 100 }, { label: 'Source MAC', size: '6 bytes', kind: 'eth', w: 100 },
          { label: 'EtherType', size: '2 bytes', kind: 'eth', w: 92 }, { label: 'Payload', size: '46 to 1500 bytes', kind: 'ip', w: 150 },
          { label: 'FCS', size: '4 bytes', kind: 'eth', w: 70 }],
        explain: 'You will not see the preamble and SFD in any capture, the network card removes them. Usually the FCS as well.' },
      { type: 'quiz', title: 'Calculating with frames', questions: [
        { q: 'Which EtherType identifies an ARP message?', input: ['0x0806', '806', '0806'], explain: '<code>0x0806</code> is ARP, <code>0x0800</code> IPv4.' },
        { q: 'How many bytes does a full frame (MTU 1500) occupy on the wire, including preamble, SFD and IFG?', input: ['1538'], unit: 'bytes', explain: '8 + 14 + 1500 + 4 + 12 = 1538.' },
        { q: 'An ARP message is 28 bytes long. How many bytes of padding does the network card append?', input: ['18'], unit: 'bytes', explain: 'Minimum payload of 46 bytes minus 28 bytes of ARP = 18 bytes of zeros.' },
        { q: 'A frame arrives with a wrong FCS. What happens?', options: ['The receiver requests it again', 'It is silently dropped, only an error counter on the card goes up', 'The switch corrects it', 'It is processed anyway'], correct: 1,
          explain: 'Ethernet has no retransmission. With <code>ethtool -S eth0</code> you can see the CRC errors. If needed, TCP has to retransmit.' }] }
    ] },

    { id: 'm1-l3', title: 'What a MAC address reveals', minutes: 8, steps: [
      { type: 'theory', title: 'Structure of the MAC address', html: `
<p>A MAC address has 48 bits and is only valid in the local segment. The first 3 bytes are the <b>OUI</b> (Organizationally Unique Identifier), which the IEEE assigns to manufacturers. <code>00:50:56</code> belongs to VMware, which is why the addresses of your VMs on ESXi start with it.</p>
<p>Two bits in the first byte have a special meaning:</p>
<table><tr><th>Bit</th><th>0</th><th>1</th></tr>
<tr><td><b>b0</b> (I/G)</td><td>Unicast: one interface</td><td>Group: multicast or broadcast</td></tr>
<tr><td><b>b1</b> (U/L)</td><td>assigned by the manufacturer</td><td>locally administered (Docker, containerlab, random MAC on a smartphone)</td></tr></table>
${note('You can spot locally administered addresses by the <b>second</b> hex digit: 2, 6, A or E. Examples: <code>02:42:…</code> in older Docker versions, <code>aa:c1:ab:…</code> in containerlab and here in the lab.')}
<table><tr><th>Address</th><th>Meaning</th></tr>
<tr><td><code>ff:ff:ff:ff:ff:ff</code></td><td>Broadcast, everyone in the segment</td></tr>
<tr><td><code>01:00:5e:…</code></td><td>IPv4 multicast, e.g. OSPF to 224.0.0.5</td></tr>
<tr><td><code>33:33:…</code></td><td>IPv6 multicast</td></tr>
<tr><td><code>00:00:5e:00:01:xx</code></td><td>virtual MAC of VRRP (chapter on gateway redundancy)</td></tr></table>` },
      { type: 'mac', title: 'Examine MAC addresses', classify: ['00:50:56:a3:1f:7c', 'aa:c1:ab:12:34:56', '01:00:5e:00:00:05', 'ff:ff:ff:ff:ff:ff', '02:42:ac:11:00:02', '33:33:00:00:00:01'] }
    ] },

    { id: 'm1-l4', title: 'How a switch learns', minutes: 15, steps: [
      { type: 'theory', title: 'MAC table, flooding and aging', html: `
<p>At first a switch knows no devices. It builds its <b>MAC table</b> solely from the <b>source MACs</b> of the frames it receives.</p>
<pre>Frame arrives on port eth3: source aa:aa, destination bb:bb
1. Learn:       aa:aa is on eth3
2. Forward:
   broadcast or multicast         → to all ports except eth3 (flood)
   bb:bb is in the table          → only to that port
   bb:bb is on eth3               → drop (filter)
   bb:bb unknown                  → to all ports except eth3 (flood)</pre>
<p>Entries expire after a while without traffic (<b>aging</b>, usually 300 seconds). This way the switch adapts when a device is plugged in elsewhere.</p>
<table><tr><th>Term</th><th>Meaning</th></tr>
<tr><td>Collision domain</td><td>Devices that share a medium. On a switch in full duplex, every port is its own.</td></tr>
<tr><td>Broadcast domain</td><td>All devices a broadcast reaches. A switch floods broadcasts, a router does not.</td></tr></table>
${note('A <b>hub</b> learns nothing and passes every frame on to everyone. In the next step you turn the switch into a hub by setting the aging time to 0, and see the difference.')}` },
      { type: 'lab', title: 'The switch learns', topo: switch3, edit: 'config',
        intro: '<p>pc1, pc2 and pc3 are connected to sw1. Double-click <b>pc1</b> to open its console and ping pc2.</p>',
        presets: { pc1: ['ping -c 2 10.0.0.2'], pc3: ['ip neigh'] },
        goals: [
          { text: 'Ping pc2 (10.0.0.2) from pc1.', check: pingOk('pc1', '10.0.0.2') },
          { text: 'On which port did sw1 learn the MAC address of pc2? Look it up under Tables on sw1.', ask: true, expect: () => ['eth2'], placeholder: 'e.g. eth1' },
          { text: 'pc3 saw the ARP request, but not a single ping. Set the aging time on sw1 to 0 and ping again. Now pc3 sees the ICMP packets too.',
            check: tag('pc3', 'frame-not-mine', d => d.kind === 'icmp') }],
        hints: ['You will find the aging time on sw1 at the very bottom of Configuration.', 'Filter the log to "Only pc3" to see what arrives at pc3.'],
        outro: '<p>With aging 0 the switch forgets every address immediately and has to flood everything like a hub. Every host then sees other hosts\' traffic: bad for security and for bandwidth. Feel free to set the aging time back to 300 afterwards.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'From what does a switch learn which port a device is connected to?', options: ['From the destination MAC', 'From the source MAC', 'From the IP address', 'From ARP'], correct: 1, explain: 'Only the source MAC reveals who is sending on that port.' },
        { q: 'A switch receives a frame for a MAC that is not in its table. What does it do?', options: ['Drop it', 'Ask via ARP', 'Send it to all ports in the VLAN except the incoming one', 'Send it to the router'], correct: 2,
          explain: 'Unknown unicast flooding. When the destination replies, the switch learns its port, and from then on traffic goes there directly.' }] }
    ] },

    { id: 'm1-l5', title: 'ARP: from IP to MAC', minutes: 15, steps: [
      { type: 'theory', title: 'How ARP works', html: `
<p>An application only knows the IP address of its destination, but an Ethernet frame needs a destination MAC. <b>ARP</b> (Address Resolution Protocol) finds it, and only for addresses in its <b>own</b> subnet.</p>
<pre>pc1 10.0.0.1 wants to send to 10.0.0.3 but does not know the MAC
1. Request (broadcast to ff:ff:ff:ff:ff:ff): Who has 10.0.0.3? Tell 10.0.0.1
2. Reply   (unicast to pc1):                  10.0.0.3 is at aa:c1:ab:…
3. Both add each other to their ARP table, pc3 already on the request.</pre>
${bar([['Ethernet', '14', 'eth', 1.4], ['HW/proto type', '4', 'arp', 1], ['Lengths', '2', 'arp', .7], ['Operation', '2', 'arp', .8], ['Sender MAC/IP', '10', 'arp', 1.6], ['Target MAC/IP', '10', 'arp', 1.6]], 'ARP sits directly in the Ethernet frame (EtherType 0x0806), without an IP header. The message is always 28 bytes.')}
<p>Linux calls the ARP table the <b>neighbor table</b> (<code>ip neigh</code>). An entry is <code>REACHABLE</code> as long as it has been recently confirmed, then <code>STALE</code>. If a request goes unanswered, it becomes <code>FAILED</code>, and the host itself reports <code>Destination Host Unreachable</code>.</p>
${note('A <b>gratuitous ARP</b> announces one\'s own IP unsolicited. VRRP, MetalLB and kube-vip use it during a failover: all neighbors update their table immediately.')}
${note('ARP has <b>no authentication</b>. Any device in the segment can send replies, and most systems believe them. Protection comes from Dynamic ARP Inspection on switches, small segments and encryption on higher layers.', true)}` },
      { type: 'lab', title: 'Watch ARP', topo: switch3, edit: 'config',
        intro: '<p>Feel free to turn the speed down: this way you can see how the request goes to everyone and only one reply comes back.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.3', 'ip neigh'], pc2: ['ping -c 1 10.0.0.99'] },
        goals: [
          { text: 'Ping pc3 (10.0.0.3) from pc1.', check: pingOk('pc1', '10.0.0.3') },
          { text: 'Click the ARP request in the log and look at it in the packet inspector.', check: inspected(isArpReq) },
          { text: 'Which target MAC is in the request?', ask: true, expect: () => ['00:00:00:00:00:00'], placeholder: 'xx:xx:xx:xx:xx:xx' },
          { text: 'From pc2, ping the address 10.0.0.99, which does not exist. Who reports "Destination Host Unreachable"?',
            check: tag('pc2', 'arp-failed', d => d.ip === '10.0.0.99') },
          { text: 'From which IP address did the "Destination Host Unreachable" message come?', ask: true, expect: () => ['10.0.0.2'] }],
        outro: '<p>The message does not come from a router but from pc2 itself: its three ARP requests went unanswered.</p>' },
      { type: 'build', title: 'Build the ARP request yourself', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: '<p><b>pc1</b> (10.0.0.1) wants to reach <b>pc3</b> (10.0.0.3) but does not know its MAC. Build the frame that pc1 sends first.</p>',
        addresses: { mac: [[M('pc1'), 'pc1'], [M('pc2'), 'pc2'], [M('pc3'), 'pc3'], [M('sw1'), 'sw1']], ip: [['10.0.0.1', 'pc1'], ['10.0.0.2', 'pc2'], ['10.0.0.3', 'pc3']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('pc1'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('pc1'), spa: '10.0.0.1', tha: '00:00:00:00:00:00', tpa: '10.0.0.3' } }],
        explain: 'The Ethernet destination is broadcast so that pc3 receives the question at all. In the ARP part the MAC being looked for is still unknown, hence zeros. There is no IP header: ARP sits directly in the Ethernet frame.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'To which destination MAC is an ARP request sent?', options: ['To the MAC of the gateway', 'To ff:ff:ff:ff:ff:ff', 'To 00:00:00:00:00:00', 'To the MAC of the switch'], correct: 1, explain: 'The request is a broadcast, the reply a unicast.' },
        { q: 'Why does pc3 know the MAC of pc1 after the ping, even though pc3 never asked itself?', options: ['The switch told it', 'pc3 learned it from the request (sender MAC and IP)', 'Via DHCP', 'It does not'], correct: 1,
          explain: 'The request contains the sender MAC and sender IP. Whoever is asked adds the asker right away, since it is about to reply to it.' }] }
    ] },

    { id: 'm1-garp', title: 'Gratuitous ARP and failover', minutes: 20, steps: [
      { type: 'theory', title: 'ARP messages nobody asked for', html: `
<p>Besides request and reply, ARP has two special forms that you will see in every capture:</p>
<table><tr><th>Message</th><th>Sender IP</th><th>Target IP</th><th>Purpose</th></tr>
<tr><td><b>Gratuitous ARP</b></td><td>its own</td><td>its own</td><td>"This address is now at my MAC." Neighbors with an entry for the address update it immediately.</td></tr>
<tr><td><b>ARP probe</b></td><td>0.0.0.0</td><td>the desired one</td><td>"Is anyone already using this address?" If someone answers, there is a conflict (RFC 5227).</td></tr></table>
<p>Both are broadcast to everyone. A gratuitous ARP is usually phrased as a request, sometimes as a reply. Linux only uses it to update <b>existing</b> entries and does not create new ones.</p>
<h2>When a device sends a gratuitous ARP</h2>
<ul><li>when an interface comes up, to announce its own address and notice conflicts</li>
<li>during a <b>failover</b>: VRRP, keepalived, kube-vip or MetalLB move a service address to another machine</li>
<li>after a live migration of a VM, so that the switches learn the MAC on the new port</li></ul>
<h2>The neighbor states on Linux</h2>
<table><tr><th>State</th><th>Meaning</th></tr>
<tr><td>REACHABLE</td><td>recently confirmed (around 30 seconds)</td></tr>
<tr><td>STALE</td><td>still in use, but no longer confirmed</td></tr>
<tr><td>DELAY</td><td>a packet went to a STALE entry, wait 5 seconds to see whether a confirmation arrives</td></tr>
<tr><td>PROBE</td><td>three unicast requests directly to the stored MAC</td></tr>
<tr><td>FAILED</td><td>no answer, the entry is discarded, the next packet asks again via broadcast</td></tr></table>
${note('Without a gratuitous ARP, a client keeps sending its packets to the <b>old</b> MAC after a failover until its neighbor check fails. That easily adds up to 30 to 40 seconds of outage. With a gratuitous ARP it is over after milliseconds.')}
<pre>arping -U -c 3 -I eth0 10.0.0.100   # send a gratuitous ARP (like keepalived)
arping -D -I eth0 10.0.0.100        # check whether the address is free</pre>` },
      { type: 'build', title: 'Build the gratuitous ARP', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp'],
        task: `<p>The service address <code>10.0.0.100</code> moves from srvA to <b>srvB</b>. Build the message with which srvB tells all neighbors that 10.0.0.100 is now at its MAC (phrased as a request).</p>`,
        addresses: { mac: [[M('srvA'), 'srvA'], [M('srvB'), 'srvB'], [M('client'), 'client']], ip: [['10.0.0.100', 'service address'], ['10.0.0.12', 'srvB'], ['10.0.0.5', 'client']] },
        expected: [
          { block: 'eth', fields: { dst: 'ff:ff:ff:ff:ff:ff', src: M('srvB'), type: '0x0806' } },
          { block: 'arp', fields: { op: '1', sha: M('srvB'), spa: '10.0.0.100', tha: ['00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'], tpa: '10.0.0.100' } }],
        explain: 'Sender IP and target IP are the same, which makes the message "gratuitous". Nobody has to reply. Everyone who has 10.0.0.100 in their table replaces the old MAC with that of srvB.' },
      { type: 'lab', title: 'Failover without gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: `<p>srvA holds the service address 10.0.0.100. Start a long ping on the client. Then let srvA fail (disconnect the cable) and give srvB the address 10.0.0.100. No gratuitous ARP is sent <b>yet</b>. The speed slider or the fast-forward button makes the waiting go faster.</p>`,
        presets: { client: ['ping -c 60 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['ip addr add 10.0.0.100/24 dev eth1'] },
        goals: [
          { text: 'Start the ping and let srvA fail while it is running.', check: sim => sim.log.some(e => e.tag === 'link-down') && sim.log.some(e => e.dev === 'client' && e.tag === 'arp-learned') },
          { text: 'Give srvB the address 10.0.0.100.', check: sim => sim.dev('srvB').cfg.ifaces.eth1.ip === '10.0.0.100' },
          { text: 'Wait until the client discards the old MAC and asks again.', check: tag('client', 'nud-failed', d => d.ip === '10.0.0.100') },
          { text: 'In which state does the client send unicast requests to the old MAC?', ask: true, expect: () => ['probe'] },
          { text: 'srvB answers the pings.', check: tag('srvB', 'echo-request-received') }],
        hints: ['The commands are available as buttons in the console of each device.', 'In the log under "Only client" you can see how the entry ages and is checked.'],
        outro: '<p>Count the lost pings: for about 35 seconds every packet went to a MAC that no longer existed. This is exactly the gap the gratuitous ARP closes.</p>' },
      { type: 'lab', title: 'Failover with gratuitous ARP', topo: failoverTopo, edit: 'config',
        intro: '<p>The same again, but this time srvB announces the address with <code>arping -U</code> after taking it over. First check with an ARP probe whether the address is really free.</p>',
        presets: { client: ['ping -c 30 10.0.0.100', 'ip neigh'], srvA: ['ip link set eth1 down'], srvB: ['arping -D -c 2 10.0.0.100', 'ip addr add 10.0.0.100/24 dev eth1', 'arping -U -c 1 10.0.0.100'] },
        goals: [
          { text: 'From srvB, use arping -D to check whether 10.0.0.100 is taken while srvA is still running. The probe reports a conflict.', check: tag('srvB', 'arping-done', d => d.mode === 'dad' && d.replies > 0) },
          { text: 'Start the ping, let srvA fail, give srvB the address and send the gratuitous ARP.', check: tag('client', 'garp-updated', d => d.ip === '10.0.0.100') },
          { text: 'srvB answers the pings without the client having to ask again.', check: sim => sim.log.some(e => e.dev === 'srvB' && e.tag === 'echo-request-received') && !sim.log.some(e => e.dev === 'client' && e.tag === 'nud-failed') },
          { text: 'Click the gratuitous ARP in the log. Which sender IP does it carry?', ask: true, expect: () => ['10.0.0.100'] }],
        hints: ['The order matters: first take over the address, then send the gratuitous ARP.'],
        outro: '<p>The client rewrote its entry immediately. This is exactly how keepalived and kube-vip work: whoever takes over the address immediately sends a gratuitous ARP. Along the way, the switches learn which port the MAC of srvB is on.</p>' }
    ] },

    { id: 'm1-l6', title: 'A packet across a router', minutes: 18, steps: [
      { type: 'theory', title: 'MAC hop by hop, IP end to end', html: `
<p>When a host wants to send to an IP address <b>outside</b> its subnet, it does not ask for that address's MAC but for the MAC of its <b>default gateway</b>.</p>
<pre>pc1 192.168.10.10/24 → srv1 192.168.20.20
1. Is 192.168.20.20 in 192.168.10.0/24?  No → to the gateway 192.168.10.1
2. ARP asks for 192.168.10.1, not for 192.168.20.20
3. r1 accepts the frame, reads the destination IP, finds the route, TTL 64 → 63
4. r1 asks via ARP on eth2 for 192.168.20.20 and builds a new frame</pre>
<table><tr><th></th><th>Segment LAN A (pc1 → r1)</th><th>Segment LAN B (r1 → srv1)</th></tr>
<tr><td>Source MAC</td><td>pc1</td><td>r1 eth2</td></tr><tr><td>Destination MAC</td><td>r1 eth1</td><td>srv1</td></tr>
<tr><td>Source IP</td><td>192.168.10.10</td><td>192.168.10.10</td></tr><tr><td>Destination IP</td><td>192.168.20.20</td><td>192.168.20.20</td></tr>
<tr><td>TTL</td><td>64</td><td><b>63</b></td></tr></table>
${note('<b>Remember:</b> MAC addresses are valid hop by hop and are rewritten by every router. IP addresses are valid end to end and stay the same as long as there is no NAT in between.')}
<table><tr><th>Symptom</th><th>Typical cause</th></tr>
<tr><td>Own subnet works, everything beyond it does not</td><td>Gateway wrong or missing</td></tr>
<tr><td>Host asks via ARP for the remote destination instead of the gateway</td><td>Netmask too large, e.g. /16 instead of /24</td></tr>
<tr><td>Packet arrives, the reply does not</td><td>The destination has no gateway, the return path is missing</td></tr></table>` },
      { type: 'lab', title: 'Prove the rule yourself', topo: routed, edit: 'config',
        intro: '<p>Ping srv1 from pc1. Then click the ping packets that r1 sends and receives in the log and read the values in the packet inspector. The filter "Only r1" helps.</p>',
        presets: { pc1: ['ping -c 1 192.168.20.20'] },
        goals: [
          { text: 'Ping srv1 (192.168.20.20) from pc1.', check: pingOk('pc1', '192.168.20.20') },
          { text: 'Which IP address did pc1 ask for via ARP?', ask: true, expect: () => ['192.168.10.1'] },
          { text: 'Which destination MAC does the ping have in LAN A?', ask: true, expect: s => [s.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' },
          { text: 'Which source MAC does the same ping have in LAN B?', ask: true, expect: s => [s.dev('r1').mac('eth2')], placeholder: 'aa:c1:ab:…' },
          { text: 'Which TTL does the ping have in LAN B?', ask: true, expect: () => ['63'] },
          { text: 'Set the prefix on pc1 to 16 and ping again. Which address does pc1 now ask for via ARP?', ask: true, expect: () => ['192.168.20.20'] }],
        hints: ['The MAC addresses of r1 are shown in the Console tab of r1 with the command ip addr.', 'A ping in LAN B is a frame that r1 sends out of eth2.'],
        outro: '<p>With /16, pc1 believes 192.168.20.20 is in its own network and asks for it directly. Nobody answers, and pc1 itself reports "Destination Host Unreachable". Set the prefix back to 24.</p>' }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m2.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, pingOk, pingFailed, tag } from './helpers.js';
import { PRESETS, chainTopo, topo, host, server, router, link } from '../presets.js';

const mtuTopo = () => PRESETS.find(p => p.id === 'mtu').make();
const brokenReturn = () => { const t = chainTopo(); t.name = 'Missing return path'; t.devices.find(d => d.id === 'r2').routes = [{ dst: '10.0.4.0/24', via: '10.0.23.3' }]; return t; };
const blackhole = () => topo('PMTUD blackhole', [
  host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'),
  router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']], {
    acl: [{ action: 'allow', proto: 'icmp', icmpType: 8, src: 'any', dst: 'any' }, { action: 'allow', proto: 'icmp', icmpType: 0, src: 'any', dst: 'any' },
      { action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }),
  router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]),
  server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
[link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'srv1', 'eth1', 1400)]);

export default {
  id: 'm2', title: 'IP and routing', bands: ['ip', 'icmp', 'udp'],
  text: 'The IPv4 header, how routers decide, TTL and traceroute, the return path, MTU with Path MTU Discovery and rules on routers.',
  lessons: [
    { id: 'm2-l1', title: 'The IPv4 header', minutes: 12, steps: [
      { type: 'theory', title: 'What every IP packet contains', html: `
<p>Every IPv4 packet starts with at least 20 bytes of header. Every router reads it, and even changes two fields.</p>
<table><tr><th>Field</th><th>Bits</th><th>Purpose</th></tr>
<tr><td>Version, IHL</td><td>4 + 4</td><td>4 and the header length in 32-bit words (usually 5 = 20 bytes)</td></tr>
<tr><td>TOS (DSCP, ECN)</td><td>8</td><td>Priority for QoS and congestion notification</td></tr>
<tr><td>Total Length</td><td>16</td><td>Length including the header, at most 65,535</td></tr>
<tr><td>Identification, Flags, Offset</td><td>16 + 3 + 13</td><td>Fragmentation. The <b>DF</b> flag forbids splitting</td></tr>
<tr><td><b>TTL</b></td><td>8</td><td>Every router subtracts 1, at 0 the packet is dropped</td></tr>
<tr><td>Protocol</td><td>8</td><td>1 ICMP, 6 TCP, 17 UDP, 50 ESP, 89 OSPF</td></tr>
<tr><td><b>Header Checksum</b></td><td>16</td><td>Covers only the header. Recomputed at every hop because of the TTL</td></tr>
<tr><td>Source IP, destination IP</td><td>32 + 32</td><td>Stay the same end to end (without NAT)</td></tr></table>
${note('The <b>Protocol</b> field plays the same role as the EtherType in the Ethernet frame: it says how to read the payload. OSPF runs directly on IP with protocol 89, BGP on the other hand over TCP port 179.')}` },
      { type: 'label', title: 'Label the IPv4 header', distractors: ['Dest. MAC', 'Port', 'VNI'],
        rows: [
          [{ label: 'Version', size: '4 bits', kind: 'ip', w: 70 }, { label: 'IHL', size: '4 bits', kind: 'ip', w: 70 }, { label: 'TOS', size: '8 bits', kind: 'ip', w: 130 }, { label: 'Total Length', size: '16 bits', kind: 'ip', w: 250 }],
          [{ label: 'Identification', size: '16 bits', kind: 'ip', w: 250 }, { label: 'Flags', size: '3 bits', kind: 'ip', w: 70 }, { label: 'Fragment Offset', size: '13 bits', kind: 'ip', w: 198 }],
          [{ label: 'TTL', size: '8 bits', kind: 'ip', w: 130 }, { label: 'Protocol', size: '8 bits', kind: 'ip', w: 136 }, { label: 'Header Checksum', size: '16 bits', kind: 'ip', w: 256 }],
          [{ label: 'Source IP', size: '32 bits', kind: 'ip', w: 530 }],
          [{ label: 'Destination IP', size: '32 bits', kind: 'ip', w: 530 }]],
        explain: 'Each row has 32 bits. The first five rows are the 20 bytes of the standard header.' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Which protocol number does UDP have?', input: ['17'], explain: '1 ICMP, 6 TCP, 17 UDP.' },
        { q: 'Why does a router have to recompute the header checksum for every packet?', options: ['Because the destination IP changes', 'Because it changes the TTL and the checksum covers the header', 'Because Ethernet requires it', 'It does not have to'], correct: 1,
          explain: 'The TTL is part of the header. When it changes, the old checksum no longer matches.' }] }
    ] },

    { id: 'm2-l2', title: 'The routing decision', minutes: 12, steps: [
      { type: 'theory', title: 'Routing table and longest prefix match', html: `
<p>Hosts and routers decide using the same procedure. A router simply also forwards packets that are not addressed to itself.</p>
<pre>$ ip route
default via 192.168.10.1 dev eth1                         ← default route
10.20.0.0/16 via 192.168.10.254 dev eth1                  ← static route
192.168.10.0/24 dev eth1 proto kernel scope link          ← connected route</pre>
<table><tr><th>Entry</th><th>ARP asks for</th></tr>
<tr><td>Connected route (directly attached)</td><td>the <b>destination</b> itself</td></tr>
<tr><td>Route with <code>via</code></td><td>the <b>next hop</b></td></tr></table>
${note('<b>Longest prefix match:</b> if several entries match, the most specific one wins, i.e. the one with the longest prefix. The order in the table does not matter. For prefixes of equal length, the origin decides: connected before static.')}
<p>On Linux, <code>ip route get &lt;destination&gt;</code> shows the decision for a destination without sending a packet. You can try this in every console in the lab, too.</p>` },
      { type: 'lpm', title: 'Where does the packet go?', table: [['10.0.0.0/8', 'A'], ['10.1.0.0/16', 'B'], ['10.1.2.0/24', 'C'], ['10.1.2.64/26', 'D'], ['0.0.0.0/0', 'E']],
        dests: ['10.1.2.77', '10.1.2.200', '10.9.9.9', '10.1.3.1', '172.16.5.5'] },
      { type: 'lpm', title: 'And without a default route?', table: [['192.168.0.0/16', 'R1'], ['192.168.10.0/24', 'R2'], ['192.168.10.128/25', 'R3']],
        dests: ['192.168.10.130', '192.168.10.5', '192.168.11.5', '8.8.8.8'] }
    ] },

    { id: 'm2-l3', title: 'TTL and traceroute', minutes: 12, steps: [
      { type: 'theory', title: 'How traceroute reveals the routers', html: `
<p>The TTL prevents a packet from circling forever when there is a routing error. The router that sets it to 0 drops the packet and sends <b>ICMP Time Exceeded</b> to the sender.</p>
<p><code>traceroute</code> takes advantage of this: it sends packets with TTL 1, 2, 3 … Every router along the way gives itself away with its Time Exceeded message. Linux sends UDP to high ports (from 33434) for this, and at the end the destination answers with <b>Port Unreachable</b>.</p>
<pre> 1  10.0.1.1    0.4 ms     ← TTL 1 expired at r1
 2  10.0.12.2   0.6 ms     ← TTL 2 expired at r2
 3  10.0.23.3   0.8 ms
 4  10.0.4.10   1.0 ms     ← destination: Port Unreachable</pre>
${note('A <code>*</code> only means that no answer came from this hop. Many routers rate-limit Time Exceeded but forward without any problem. The initial TTL often reveals the system: Linux 64, Windows 128, many network devices 255.')}` },
      { type: 'lab', title: 'Trace the path', topo: chainTopo, edit: 'view',
        intro: '<p>pc1 reaches srv1 via three routers. Start a traceroute on pc1 and watch at which router each packet dies.</p>',
        presets: { pc1: ['traceroute 10.0.4.10', 'ping -c 1 -t 2 10.0.4.10'] },
        goals: [
          { text: 'Run traceroute 10.0.4.10 on pc1.', check: tag('pc1', 'trace-done', d => d.reached) },
          { text: 'Which address answers at the second hop?', ask: true, expect: () => ['10.0.12.2'] },
          { text: 'Send a ping with TTL 2 (ping -c 1 -t 2 10.0.4.10). Which router reports Time Exceeded?', ask: true, expect: () => ['r2', '10.0.12.2'] },
          { text: 'With which TTL does the reply from srv1 arrive for a normal ping?', ask: true, expect: () => ['61'] }],
        outro: '<p>Three routers, so 64 - 3 = 61. The answer at the second hop comes from the address of the interface through which r2 sends the message back to pc1.</p>' }
    ] },

    { id: 'm2-l4', title: 'The return path counts just as much', minutes: 15, steps: [
      { type: 'theory', title: 'Routing only ever applies in one direction', html: `
<p>Every router on the way needs a route to the destination, and every router on the way back needs a route to the <b>source</b>. If the return path is missing, the ping reaches the destination but the reply never comes back. This is the most common mistake with static routing.</p>
${note('How to troubleshoot: <b>1.</b> Does the packet reach the destination? <b>2.</b> Does the destination have a route back? <b>3.</b> Does every router on the way back have a route to the source? Check with <code>ip route get</code> on every device.')}
<p>When the forward and return traffic take different paths, this is called <b>asymmetric routing</b>. It is allowed, but stateful firewalls drop such connections because they only see one direction.</p>` },
      { type: 'lab', title: 'Find the missing return path', topo: brokenReturn, edit: 'config',
        intro: '<p>pc1 cannot reach srv1. Find out where the problem is and fix it with a static route.</p>',
        presets: { pc1: ['ping -c 2 10.0.4.10'], r2: ['ip route', 'ip route get 10.0.1.10'] },
        goals: [
          { text: 'Ping srv1 from pc1 and observe: the ping fails.', check: pingFailed('pc1', '10.0.4.10') },
          { text: 'Show that the echo request still reaches srv1 (filter the log: Only srv1).', check: tag('srv1', 'echo-request-received') },
          { text: 'Which router has no route back to 10.0.1.0/24?', ask: true, expect: () => ['r2'] },
          { text: 'Add the missing route and ping again until it works.', check: pingOk('pc1', '10.0.4.10') }],
        hints: ['Look under Tables on r2 to see which networks it knows.', 'r2 is missing: destination 10.0.1.0/24 via 10.0.12.1. In the console: ip route add 10.0.1.0/24 via 10.0.12.1'] }
    ] },

    { id: 'm2-l5', title: 'MTU and Path MTU Discovery', minutes: 15, steps: [
      { type: 'theory', title: 'Too large for the path', html: `
<p>If a packet is larger than the MTU of the next link, a router has two options:</p>
<table><tr><th>DF flag</th><th>What the router does</th></tr>
<tr><td>not set</td><td>Splits the packet into <b>fragments</b>. Only the destination reassembles them. If one fragment is lost, everything is lost.</td></tr>
<tr><td>set</td><td>Drops the packet and sends back <b>ICMP Fragmentation Needed</b> with the matching MTU. The sender remembers the MTU and sends smaller packets. This is <b>Path MTU Discovery</b>.</td></tr></table>
<pre>ping -M do -s 1472 dest     1472 + 8 (ICMP) + 20 (IP) = 1500 bytes, DF set
ping -M dont -s 1472 dest   same size, fragmentation allowed</pre>
${note('After a Fragmentation Needed message, Linux already rejects packets that are too large locally: <code>ping: local error: message too long, mtu=1400</code>. With <code>ip route get</code> you can see the learned MTU.')}` },
      { type: 'lab', title: 'The bottleneck', topo: mtuTopo, edit: 'view',
        intro: '<p>The link between r1 and r2 only has MTU 1400. Test it from pc1.</p>',
        presets: { pc1: ['ping -c 2 -M do -s 1472 10.0.2.20', 'ping -c 1 -M dont -s 1472 10.0.2.20', 'ip route get 10.0.2.20'] },
        goals: [
          { text: 'Send a ping with 1472 bytes and DF (-M do). Which MTU does r1 report back?', ask: true, expect: () => ['1400'] },
          { text: 'pc1 remembers the MTU of the path.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Send the same ping without DF (-M dont). r1 fragments the packet, and the ping gets through.', check: pingOk('pc1', '10.0.2.20', { size: 1472, df: false }) },
          { text: 'Into how many fragments did r1 split the packet?', ask: true, expect: () => ['2'] },
          { text: 'What is the largest value for -s with which the ping works with -M do?', ask: true, expect: () => ['1372'] }],
        outro: '<p>1372 + 8 + 20 = 1400. That is exactly how large an IP packet may be across the narrowest link.</p>' }
    ] },

    { id: 'm2-l6', title: 'Rules and the PMTUD blackhole', minutes: 15, steps: [
      { type: 'theory', title: 'Rules on routers', html: `
<p>Routers and firewalls filter packets with <b>rules</b>. The rules are checked from top to bottom, and the <b>first matching</b> one applies. Typical actions are allow, drop (silently) and reject (with an ICMP message).</p>
<p>A common mistake: ICMP is blocked completely except for ping because it is supposedly "insecure". This also makes <b>Fragmentation Needed</b> (ICMP type 3) disappear. Small packets get through, large ones vanish without a trace: SSH works, large downloads hang. This is called a <b>PMTUD blackhole</b>.</p>
<table><tr><th>ICMP type</th><th>Meaning</th><th>Block it?</th></tr>
<tr><td>8 / 0</td><td>Echo Request / Reply</td><td>rate-limiting it from outside is acceptable</td></tr>
<tr><td>3</td><td>Destination Unreachable, incl. Fragmentation Needed</td><td><b>never</b></td></tr>
<tr><td>11</td><td>Time Exceeded</td><td>better not, otherwise traceroute stops working</td></tr></table>` },
      { type: 'lab', title: 'Fix the blackhole', topo: blackhole, edit: 'config',
        intro: '<p>r1 only allows ping (types 8 and 0) and drops all other ICMP. The MTU between r2 and srv1 is 1400.</p>',
        presets: { pc1: ['ping -c 1 10.0.2.20', 'ping -c 1 -M do -s 1472 10.0.2.20', 'ping -c 1 -M do -s 1372 10.0.2.20'] },
        goals: [
          { text: 'A normal ping from pc1 to srv1 works.', check: pingOk('pc1', '10.0.2.20') },
          { text: 'A ping with -M do -s 1472 vanishes without any message. Find in the log where the ICMP message from r2 ends up.', check: tag('r1', 'acl-drop') },
          { text: 'Add a rule on r1 that allows ICMP type 3, and place it above the drop rule. Now pc1 learns the MTU.', check: tag('pc1', 'pmtu-learned') },
          { text: 'Send a ping with -M do -s 1372.', check: pingOk('pc1', '10.0.2.20', { size: 1372, df: true }) }],
        hints: ['You will find the rules under Configuration on r1. New rule: allow, ICMP, type 3, then move it up with the arrow.'] }
    ] },

    { id: 'm2-l7', title: 'Control plane and data plane', minutes: 6, steps: [
      { type: 'theory', title: 'Who decides, who forwards?', html: `
<table><tr><th></th><th>Control plane</th><th>Data plane</th></tr>
<tr><td>Task</td><td>Find out which paths exist</td><td>Forward every packet</td></tr>
<tr><td>How often</td><td>on changes in the network</td><td>millions of times per second</td></tr>
<tr><td>Linux with FRR</td><td>FRR: ospfd, bgpd, zebra</td><td>the kernel</td></tr>
<tr><td>Result</td><td>Entries in the routing table</td><td>Packets on the right interface</td></tr></table>
<p>If the router knows the same route from several sources, the lowest <b>administrative distance</b> wins: connected 0, static 1, eBGP 20, OSPF 110, iBGP 200.</p>
${note('If the control plane hangs, the data plane keeps forwarding with the existing routes. It just no longer reacts to changes. You know the same principle from Kubernetes: the API server and scheduler decide, kubelet and kube-proxy carry it out.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A route to 10.0.0.0/24 is static and is also known via OSPF. Which one wins?', options: ['OSPF, because it is dynamic', 'The static one, distance 1 instead of 110', 'The one with the lower metric', 'Both alternately'], correct: 1, explain: 'For the same prefix, the administrative distance decides.' },
        { q: 'Which distance does an OSPF route have in FRR?', input: ['110'] }] }
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
  id: 'm3', title: 'VLAN and VXLAN', bands: ['vlan', 'udp', 'vxlan'],
  text: 'Separate layer 2 segments with 802.1Q, understand trunks and stretch segments across a routed network with VXLAN.',
  lessons: [
    { id: 'm3-l1', title: 'VLANs and the 802.1Q tag', minutes: 10, steps: [
      { type: 'theory', title: 'Several switches in one', html: `
<p>A <b>VLAN</b> splits a switch into several logical switches. Each VLAN is its own broadcast domain. There is no layer 2 connection between VLANs, only through a router.</p>
<p>So that switches can still tell which VLAN a frame belongs to, a 4 byte <b>tag</b> is inserted after the source MAC:</p>
${bar([['Dest. MAC', '6', 'eth', 1.1], ['Source MAC', '6', 'eth', 1.1], ['TPID 0x8100', '2', 'vlan', 1.2], ['PCP DEI VID', '2', 'vlan', 1.2], ['EtherType', '2', 'eth', .9], ['Payload', 'up to 1500', 'ip', 2.4], ['FCS', '4', 'eth', .7]], 'The frame gets 4 bytes longer, the MTU stays 1500.')}
<table><tr><th>Field</th><th>Bits</th><th>Meaning</th></tr>
<tr><td>TPID</td><td>16</td><td><code>0x8100</code> sits where the EtherType would otherwise be</td></tr>
<tr><td>PCP</td><td>3</td><td>Priority 0 to 7</td></tr><tr><td>DEI</td><td>1</td><td>may be dropped first under congestion</td></tr>
<tr><td>VID</td><td>12</td><td>VLAN number, usable 1 to 4094</td></tr></table>` },
      { type: 'label', title: 'Label the tag', distractors: ['TTL', 'VNI'],
        slots: [{ label: 'TPID', size: '16 bits', kind: 'vlan', w: 210 }, { label: 'PCP', size: '3 bits', kind: 'vlan', w: 74 }, { label: 'DEI', size: '1 bit', kind: 'vlan', w: 58 }, { label: 'VID', size: '12 bits', kind: 'vlan', w: 170 }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'How many VLANs can you use with 12 bits?', input: ['4094'], explain: '2<sup>12</sup> = 4096, of which 0 and 4095 are reserved.' },
        { q: 'Which value is in the TPID?', input: ['0x8100', '8100'] }] }
    ] },

    { id: 'm3-l2', title: 'Access port and trunk', minutes: 15, steps: [
      { type: 'theory', title: 'When frames carry a tag', html: `
<table><tr><th>Port</th><th>On the wire</th><th>Typical for</th></tr>
<tr><td><b>Access</b></td><td>without a tag, the port belongs to exactly one VLAN</td><td>PC, printer, server with one network</td></tr>
<tr><td><b>Trunk</b></td><td>with a tag, several VLANs over one cable</td><td>switch to switch, router, hypervisor</td></tr></table>
<p>On a trunk, one VLAN may additionally run without a tag, the <b>native VLAN</b>. If it does not match on both sides, two VLANs get connected without anyone noticing.</p>
${note('Your VMs on ESXi know this: for the VM, the port group is an access port. The vSwitch only adds the tag when the frame leaves the host via the uplink (a trunk).')}` },
      { type: 'lab', title: 'Connect two switches properly', topo: () => vlanTopo(false), edit: 'config',
        intro: '<p>a10 and b10 belong in VLAN 10, a20 and b20 in VLAN 20. But the cable between s1 and s2 is an access port in VLAN 1 on both sides. Turn it into a trunk.</p>',
        presets: { a10: ['ping -c 1 10.10.0.2'], a20: ['ping -c 1 10.20.0.2'] },
        goals: [
          { text: 'a10 reaches b10 (10.10.0.2).', check: pingOk('a10', '10.10.0.2') },
          { text: 'a20 reaches b20 (10.20.0.2).', check: pingOk('a20', '10.20.0.2') },
          { text: 'Click a frame in the log that s1 sends out of eth8, and find the tag in the packet inspector.', check: inspected(f => !!f.vlan) },
          { text: 'Which VID do the frames from a20 carry on the trunk?', ask: true, expect: () => ['20'] }],
        hints: ['On s1 and s2 under Configuration: set eth8 to trunk, allowed VLANs 10,20.'] }
    ] },

    { id: 'm3-stick', title: 'Routing between VLANs: router on a stick', minutes: 18, steps: [
      { type: 'theory', title: 'One cable, many networks', html: `
<p>Between VLANs you need a router. With a dedicated router port per VLAN, you quickly run out of ports with ten VLANs. The solution: the router is attached to a trunk with <b>one</b> cable and has a <b>subinterface</b> per VLAN instead. Each subinterface only sends and receives frames with its VLAN tag and has its own IP address, the gateway of the respective VLAN.</p>
<pre># Linux
ip link add link eth1 name eth1.10 type vlan id 10
ip addr add 10.10.0.1/24 dev eth1.10
ip link add link eth1 name eth1.20 type vlan id 20
ip addr add 10.20.0.1/24 dev eth1.20

# Cisco IOS
interface GigabitEthernet0/0.10
 encapsulation dot1Q 10
 ip address 10.10.0.1 255.255.255.0</pre>
<h2>The path of a packet from a1 (VLAN 10) to b1 (VLAN 20)</h2>
<pre>a1 → sw1      untagged, access port in VLAN 10
sw1 → r1      tag 10 on the trunk
r1            accepts it on eth1.10, routes, sends out of eth1.20
r1 → sw1      tag 20 on the trunk, same cable back
sw1 → b1      untagged, access port in VLAN 20</pre>
${note('All subinterfaces share the MAC address of the physical interface. That is no problem because each VLAN is its own segment.')}
${note('Every routed packet crosses the same cable twice. With a lot of traffic between VLANs this link becomes a bottleneck. Larger networks therefore route directly in the switch (layer 3 switch with one SVI per VLAN).', true)}` },
      { type: 'lab', title: 'Set up the subinterfaces', topo: () => stickTopo(false), edit: 'config',
        intro: '<p>sw1 is fully configured: a1 and a2 in VLAN 10, b1 and b2 in VLAN 20, eth8 as a trunk to r1. On r1 everything is missing. Create the two subinterfaces, under Configuration or in the console.</p>',
        presets: { r1: ['ip link add link eth1 name eth1.10 type vlan id 10', 'ip link add link eth1 name eth1.20 type vlan id 20', 'ip addr add 10.10.0.1/24 dev eth1.10', 'ip addr add 10.20.0.1/24 dev eth1.20', 'ip -br a'], a1: ['ping -c 2 10.20.0.11'] },
        goals: [
          { text: 'r1 has a subinterface for VLAN 10 with 10.10.0.1/24.', check: sim => subif(sim, 10, '10.10.0.1') },
          { text: 'r1 has a subinterface for VLAN 20 with 10.20.0.1/24.', check: sim => subif(sim, 20, '10.20.0.1') },
          { text: 'Ping b1 (10.20.0.11) from a1.', check: pingOk('a1', '10.20.0.11') },
          { text: 'Click a frame that r1 sends with tag 20.', check: inspected(f => f.vlan?.vid === 20 && f.type === 'ipv4') },
          { text: 'How many times does the ping from a1 cross the cable between sw1 and r1 on its way to b1?', ask: true, expect: () => ['2', 'twice'] },
          { text: 'Which source MAC does the frame have that r1 sends in VLAN 20?', ask: true, expect: sim => [sim.dev('r1').mac('eth1')], placeholder: 'aa:c1:ab:…' }],
        hints: ['The commands are available as buttons in the console of r1.', 'Under Configuration: Subinterfaces, parent eth1, enter the VLAN, Create. Then enter the IP.'],
        outro: '<p>The source MAC is that of eth1, no matter which subinterface r1 sends through. The only thing that distinguishes the VLANs is the tag.</p>' },
      { type: 'build', title: 'Build the frame on the trunk', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp'],
        task: `<p>a1 (10.10.0.11) pings b1 (10.20.0.11). Build the echo request as <b>r1</b> sends it over the trunk towards b1. MAC of r1 eth1: <code>${M('r1')}</code>.</p>`,
        addresses: { mac: [[M('a1'), 'a1'], [M('b1'), 'b1'], [M('r1'), 'r1 eth1'], [M('sw1'), 'sw1']], ip: [['10.10.0.11', 'a1'], ['10.20.0.11', 'b1'], ['10.10.0.1', 'r1 eth1.10'], ['10.20.0.1', 'r1 eth1.20']] },
        expected: [
          { block: 'eth', fields: { dst: M('b1'), src: M('r1'), type: '0x8100' } },
          { block: 'vlan', fields: { vid: '20', type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.11', dst: '10.20.0.11', proto: '1', ttl: '63' } },
          { block: 'icmp', fields: { type: '8' } }],
        explain: 'The EtherType in the Ethernet header is 0x8100 and announces the tag. Only after the tag does the actual EtherType 0x0800 follow. r1 decremented the TTL by one, the IP addresses stay the same.' }
    ] },

    { id: 'm3-l3', title: 'VXLAN: Ethernet in UDP', minutes: 12, steps: [
      { type: 'theory', title: 'Layer 2 across a routed network', html: `
<p>VLANs need a continuous layer 2 path and are limited to 4094. Modern data centers therefore route every link and lay layer 2 segments on top as an <b>overlay</b>. The standard protocol for this is <b>VXLAN</b> (RFC 7348): it wraps an entire Ethernet frame in a UDP packet.</p>
${bar([['Ethernet', '14', 'eth', 1], ['IPv4', '20', 'ip', 1.1], ['UDP 4789', '8', 'udp', 1], ['VXLAN', '8', 'vxlan', 1], ['Ethernet', '14', 'eth', 1], ['Host IP packet', 'up to 1500', 'ip', 2.6]], 'The underlay on the outside, the host\'s unchanged frame on the inside.')}
<table><tr><th>Term</th><th>Meaning</th></tr>
<tr><td>Underlay</td><td>the routed network, only knows the addresses of the VTEPs</td></tr>
<tr><td>Overlay</td><td>the layer 2 segments on top</td></tr>
<tr><td>VTEP</td><td>wraps and unwraps frames (VXLAN Tunnel Endpoint)</td></tr>
<tr><td>VNI</td><td>number of the segment, 24 bits, over 16 million</td></tr></table>
${note('Why UDP? UDP goes through any IP network. And the VTEP computes the UDP source port from the inner frame: different connections get different ports, and routers with several equally good paths (ECMP) spread them across those paths.')}
${note('If you do not specify one, Linux uses the old port <b>8472</b>. Always specify <code>dstport 4789</code>, otherwise two VTEPs talk past each other.', true)}
<p>For broadcasts and unknown destinations (BUM traffic), a VTEP sends a copy to every VTEP in its <b>flood list</b> (head-end replication). From the frames it unwraps, it learns which MAC is behind which VTEP: <b>flood and learn</b>.</p>` },
      { type: 'stack', title: 'Assemble the VXLAN packet', hint: 'The top is what goes over the underlay wire first.',
        items: [{ name: 'Outer Ethernet header', size: '14 bytes', kind: 'eth' }, { name: 'Outer IPv4 header (VTEP → VTEP)', size: '20 bytes', kind: 'ip' }, { name: 'UDP, destination port 4789', size: '8 bytes', kind: 'udp' },
          { name: 'VXLAN header with VNI', size: '8 bytes', kind: 'vxlan' }, { name: 'Inner Ethernet header (srv1 → srv2)', size: '14 bytes', kind: 'eth' }, { name: 'Inner IPv4 header', size: '20 bytes', kind: 'ip' }, { name: 'ICMP Echo Request', size: '64 bytes', kind: 'icmp' }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'How many bytes does VXLAN put in front of the host\'s IP packet (without the outer Ethernet header)?', input: ['50'], unit: 'bytes', explain: '20 (IP) + 8 (UDP) + 8 (VXLAN) + 14 (inner Ethernet header).' },
        { q: 'Which UDP destination port is assigned to VXLAN?', input: ['4789'] },
        { q: 'A router in the underlay has no route to the servers\' networks. Does VXLAN still work?', options: ['No', 'Yes, it only has to reach the addresses of the VTEPs', 'Only with multicast'], correct: 1 }] }
    ] },

    { id: 'm3-l4', title: 'VXLAN in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Take a VXLAN frame apart', topo: () => vxlanTopo(), edit: 'view',
        intro: '<p>srv1 and srv2 are in the same subnet, but on different VTEPs. core routes in between. Turn the speed down and watch how the packet gets a second envelope along the way.</p>',
        presets: { srv1: ['ping -c 2 192.168.10.12'], vtep1: ['bridge fdb', 'show vxlan'], core: ['ip route'] },
        goals: [
          { text: 'Ping srv2 (192.168.10.12) from srv1.', check: pingOk('srv1', '192.168.10.12') },
          { text: 'Click a VXLAN frame between vtep1 and core and expand all layers.', check: inspected(isVxlan) },
          { text: 'Which source IP does the outer IP packet from vtep1 have?', ask: true, expect: () => ['10.255.0.1'] },
          { text: 'Which VNI does the frame carry?', ask: true, expect: () => ['10010'] },
          { text: 'Does core know a route to 192.168.10.0/24? (yes or no)', ask: true, expect: () => ['no'] }],
        outro: '<p>The MAC table of vtep1 lists srv2 with the note <code>dst 10.255.0.2</code>: vtep1 learned from the unwrapped frame which VTEP srv2 is behind.</p>' }
    ] },

    { id: 'm3-l5', title: 'Troubleshooting the overlay', minutes: 12, steps: [
      { type: 'theory', title: 'From the bottom up', html: `
<p>If an overlay does not work, always check in this order:</p>
<ol><li><b>Underlay:</b> Can the VTEPs reach each other? Ping between the loopbacks.</li>
<li><b>Do VXLAN packets arrive?</b> Filter the log at the receiving VTEP.</li>
<li><b>Are they unwrapped?</b> VNI and UDP port must be the same on both sides.</li>
<li><b>Local:</b> Is the VLAN correct on the port to the server?</li></ol>` },
      { type: 'lab', title: 'Something is wrong', topo: () => vxlanTopo({ vni2: 10011 }), edit: 'config',
        intro: '<p>The connection between srv1 and srv2 is broken. Find the fault and fix it.</p>',
        presets: { srv1: ['ping -c 1 192.168.10.12'], vtep1: ['ping -c 1 10.255.0.2', 'show vxlan'], vtep2: ['show vxlan'] },
        goals: [
          { text: 'The ping from srv1 to srv2 fails.', check: tag('srv1', 'ping-done', d => d.received === 0) },
          { text: 'Find the message in the log that explains why vtep2 drops the packets.', check: tag('vtep2', 'vxlan-vni-unknown') },
          { text: 'Fix the fault until the ping works.', check: pingOk('srv1', '192.168.10.12') }],
        hints: ['Compare the VXLAN segments on vtep1 and vtep2 under Configuration.'] }
    ] },

    { id: 'm3-l6', title: 'The MTU trap', minutes: 12, steps: [
      { type: 'theory', title: '50 bytes that break everything', html: `
<p>VXLAN puts 50 bytes in front of every packet. A full packet of 1500 bytes becomes 1550 bytes in the underlay. Linux therefore automatically sets the MTU of a VXLAN interface to the MTU of the uplink minus 50.</p>
${note('If a frame does not fit, it is <b>silently dropped</b>. To the hosts the VTEP is a switch, and a switch does not send ICMP messages; it does not even have an IP address in the segment. Ping works, large transfers hang.', true)}
<table><tr><th>Solution</th><th>Assessment</th></tr>
<tr><td>Underlay MTU of 1550 or jumbo frames (9000)</td><td>Standard in the data center, the hosts notice nothing</td></tr>
<tr><td>Hosts in the overlay on MTU 1450</td><td>Necessary if the underlay cannot be adjusted</td></tr></table>` },
      { type: 'lab', title: 'Stumble and fix it', topo: () => vxlanTopo(), edit: 'config',
        intro: '<p>Send a large packet with DF from srv1 to srv2 and watch closely where it disappears.</p>',
        presets: { srv1: ['ping -c 1 -M do -s 1472 192.168.10.12', 'ping -c 1 -M do -s 1422 192.168.10.12'], vtep1: ['show vxlan'] },
        goals: [
          { text: 'Send ping -c 1 -M do -s 1472 192.168.10.12 on srv1. The packet disappears without a message.', check: tag('vtep1', 'vxlan-mtu-drop') },
          { text: 'Which MTU does the VXLAN interface of vtep1 have?', ask: true, expect: () => ['1450'] },
          { text: 'Raise the MTU of both underlay cables to 1550 (click the cable) and send the ping again.', check: pingOk('srv1', '192.168.10.12', { size: 1472, df: true }) }],
        hints: ['The underlay cables are vtep1 ↔ core and vtep2 ↔ core.'],
        outro: '<p>With 1550 in the underlay, the VXLAN interface automatically has MTU 1500 again, and the servers notice nothing of the encapsulation.</p>' }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js/course"
  cat > "$W/js/course/m4.js" <<'__PACKETPILOT_FILE_END__'
import { bar, note, pingOk, tag, pingOkAfter, linkBetween } from './helpers.js';
import { stpTriangle, stpSquare } from '../presets.js';
import { macFor } from '../net.js';

// Bridge IDs as in the engine: priority plus MAC of the bridge
const bmac = id => macFor(id + '/bridge');
const bidOf = (sim, id) => `${sim.dev(id).cfg.stp.priority}.${bmac(id)}`;
const lowestBid = (sim, ids) => ids.map(id => ({ id, prio: Number(sim.dev(id).cfg.stp.priority), mac: bmac(id) }))
  .sort((a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac))[0].id;
const TRI = ['sw1', 'sw2', 'sw3'];
// With equal priority, the switch with the highest MAC is certainly not the root
const NOT_ROOT = [...TRI].sort((a, b) => bmac(b).localeCompare(bmac(a)))[0];
const blockedPorts = (sim, ids) => ids.flatMap(id => (sim.dev(id).bridge.stpTable()?.ports || []).filter(p => p.role === 'alternate').map(p => [id, p.port]));
const portAnswers = list => list.flatMap(([d, p]) => [`${d} ${p}`, `${d}:${p}`, `${d}/${p}`, `${d}-${p}`]);
const stpOn = ids => sim => ids.every(id => sim.dev(id)?.bridge?.stp);

export default {
  id: 'm4', title: 'Spanning tree', bands: ['eth', 'stp'],
  text: 'Redundant cabling without a broadcast storm: how switches elect a root bridge, block ports and fail over after an outage.',
  lessons: [
    { id: 'm4-l1', title: 'Why loops bring a network down', minutes: 12, steps: [
      { type: 'theory', title: 'Redundancy without protection', html: `
<p>A single cable between two switches is a single point of failure. So you cable redundantly: if one path fails, there is a second one. But this creates a <b>loop</b>, and Ethernet is not built for that.</p>
<table><tr><th>IP packet</th><th>Ethernet frame</th></tr>
<tr><td>has a TTL, every router subtracts 1, at 0 it ends</td><td>has <b>no</b> such field, a frame can circle forever</td></tr></table>
<p>What happens in a triangle of three switches when pc1 sends a single ARP request:</p>
<pre>1. sw2 floods the broadcast to sw1 and to sw3
2. sw1 floods it on to sw3, sw3 floods it on to sw1
3. Both copies arrive at sw2 again, which floods them again
4. Every round creates new copies, none disappears</pre>
<p>The consequences are called a <b>broadcast storm</b>: the links fill up, every host has to process every broadcast, and the MAC tables keep jumping back and forth (<b>MAC flapping</b>) because the same source MAC shows up on different ports in turn. Within seconds the whole segment grinds to a halt.</p>
${note('The solution is the <b>Spanning Tree Protocol</b> (STP, IEEE 802.1D). The switches exchange small messages, the <b>BPDUs</b>, and use them to compute a tree without loops. Surplus ports are blocked. If an active path fails, STP releases a blocked port again.')}
${note('A cable that accidentally connects two wall sockets in the same office is enough for a loop. That is why STP is normally turned on on switches, even where nobody intentionally cabled redundantly.', true)}` },
      { type: 'lab', title: 'One ping brings the network down', topo: () => stpTriangle({ enabled: false }), edit: 'config',
        intro: '<p>Three switches in a triangle, spanning tree is off everywhere. Ping pc2 from pc1 and watch what happens to the ARP request. The simulation halts as soon as a switch has seen the same frame too often.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2'], sw2: ['bridge fdb', 'show spanning-tree'] },
        goals: [
          { text: 'Ping pc2 (10.0.0.2) from pc1 and trigger the storm.', check: tag(null, 'storm') },
          { text: 'What kind of frame is circling in the loop?', ask: true, expect: () => ['arp', 'arp request', 'arp-request', 'broadcast', 'arp broadcast'], placeholder: 'e.g. ICMP' },
          { text: 'Reset the state and turn on spanning tree on sw1, sw2 and sw3 under Configuration.', check: stpOn(TRI) },
          { text: 'Wait until the dots on the ports are green or red, and ping again. Now the reply arrives.', check: pingOk('pc1', '10.0.0.2') }],
        hints: ['The button with the circular arrow at the top left resets the state.', 'The timers are set to "fast": a port needs 8 seconds to reach Forwarding. With the fast-forward button it happens immediately.'],
        outro: '<p>A red dot shows a blocked port. It keeps receiving BPDUs but does not forward a single frame. This way the cable stays plugged in as a spare without forming a loop.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Why does an Ethernet frame circle endlessly in a loop, but an IP packet does not?', options: ['Ethernet is faster', 'The Ethernet header has no TTL field', 'Switches do not delete frames', 'IP packets are smaller'], correct: 1,
          explain: 'Routers decrement the TTL and drop the packet at 0. A switch does not change the frame and cannot detect a loop.' },
        { q: 'What does MAC flapping mean?', options: ['A MAC address changes randomly', 'The same source MAC shows up on different ports in turn', 'The switch forgets all addresses', 'Two hosts have the same IP'], correct: 1,
          explain: 'In a loop, the frame from pc1 arrives via several paths. Each time, the switch records pc1 on a different port. Many switches report this in their log, a good indicator of a loop.' }] }
    ] },

    { id: 'm4-l2', title: 'Electing the root bridge', minutes: 15, steps: [
      { type: 'theory', title: 'Bridge ID and BPDUs', html: `
<p>Spanning tree builds the tree from a root, the <b>root bridge</b>. The switch with the lowest <b>bridge ID</b> is elected:</p>
${bar([['Priority', '4 bits', 'stp', 1], ['System ID (VLAN)', '12 bits', 'stp', 1.6], ['MAC address of the bridge', '48 bits', 'eth', 3]], '8 bytes in total. The priority counts first, in case of a tie the MAC.')}
<p>The priority is <b>32768</b> by default and can only be changed in steps of <b>4096</b>, because the lower 12 bits are reserved for the VLAN number. If all switches have the same priority, the lowest MAC address wins, often the oldest switch in the network. That is why the root is chosen deliberately, usually a central switch with priority 4096 or 0.</p>
<h2>How the election works</h2>
<pre>1. Every switch starts up and considers itself the root
2. It sends BPDUs to 01:80:c2:00:00:00 every 2 seconds
3. If it hears a BPDU with a lower root ID, it adopts that root
4. In the end only the root sends its own BPDUs, the others relay them</pre>
<table><tr><th>Field in the BPDU</th><th>Meaning</th></tr>
<tr><td>Root ID</td><td>whom the sender considers the root</td></tr>
<tr><td>Root path cost</td><td>how expensive the sender's path to the root is</td></tr>
<tr><td>Bridge ID, port ID</td><td>who is sending, through which port</td></tr>
<tr><td>Hello, max age, forward delay</td><td>timers the root sets for everyone (2, 20, 15 seconds)</td></tr>
<tr><td>Flags</td><td>among others, topology change</td></tr></table>
${note('BPDUs are not Ethernet II frames. They use the older 802.3 format with a length field instead of an EtherType and an LLC header (DSAP and SSAP 0x42). You can see this in the packet inspector.')}` },
      { type: 'quiz', title: 'Who wins?', questions: [
        { q: 'Three switches: A <code>32768.00:1a:2b:00:00:01</code>, B <code>4096.00:1a:2b:ff:ff:ff</code>, C <code>32768.00:00:00:00:00:02</code>. Who becomes root?', options: ['A', 'B', 'C'], correct: 1,
          explain: 'The priority counts first. 4096 is lower than 32768, so the MAC no longer matters.' },
        { q: 'A and C remain. Which of the two would have the lower bridge ID?', options: ['A', 'C'], correct: 1, explain: 'Same priority, so the MAC decides: 00:00:00:… is lower than 00:1a:2b:….' },
        { q: 'Which priority can you not configure?', options: ['0', '4096', '20000', '61440'], correct: 2, explain: '20000 is not a multiple of 4096.' }] },
      { type: 'build', title: 'Build a BPDU from the root', blocks: ['eth', 'vlan', 'arp', 'stp', 'ip', 'udp', 'data'],
        task: `<p><b>sw1</b> is the root bridge with bridge ID <code>4096.${bmac('sw1')}</code>. Build the BPDU that sw1 sends out of its port eth1 (MAC of eth1: <code>${macFor('sw1/eth1')}</code>).</p>`,
        addresses: { mac: [[macFor('sw1/eth1'), 'sw1 eth1'], [macFor('sw2/eth1'), 'sw2 eth1']], bid: [[`4096.${bmac('sw1')}`, 'sw1'], [`32768.${bmac('sw2')}`, 'sw2'], [`32768.${bmac('sw3')}`, 'sw3']] },
        expected: [
          { block: 'eth', fields: { dst: '01:80:c2:00:00:00', src: macFor('sw1/eth1'), type: 'len' } },
          { block: 'stp', fields: { root: `4096.${bmac('sw1')}`, cost: '0', bridge: `4096.${bmac('sw1')}` } }],
        explain: 'The root has a cost of 0 to itself and is also the sender. The destination MAC is the reserved multicast address for bridges, which no switch forwards. Instead of an EtherType, the header contains the payload length (802.3), followed by the LLC header.' },
      { type: 'lab', title: 'Find the root and pick a new one', topo: () => stpTriangle({ enabled: true }), edit: 'config',
        intro: `<p>All three switches have the default priority 32768. Find out who became root, and then choose a new root yourself. Use <code>show spanning-tree</code> in a switch's console or look under Tables to see the state.</p>`,
        presets: { sw1: ['show spanning-tree'], sw2: ['show spanning-tree'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Which switch is the root bridge?', ask: true, expect: sim => [lowestBid(sim, TRI)], placeholder: 'e.g. sw2' },
          { text: 'Why that one? Which MAC address does its bridge ID have?', ask: true, expect: sim => [bmac(lowestBid(sim, TRI))], placeholder: 'aa:c1:ab:…' },
          { text: `Make <b>${NOT_ROOT}</b> the root bridge by lowering its priority. All switches must recognize it as the root.`,
            check: sim => TRI.every(id => sim.dev(id).bridge.stpTable()?.root === bidOf(sim, NOT_ROOT)) }],
        hints: ['You set the priority under Configuration on the switch, in the Spanning tree section.', 'It also works in the console: spanning-tree priority 4096'],
        outro: '<p>The new root takes over immediately: as soon as the others hear its better BPDU, they adopt the root ID and recompute their ports.</p>' }
    ] },

    { id: 'm4-l3', title: 'Port roles and path costs', minutes: 18, steps: [
      { type: 'theory', title: 'Root port, designated, alternate', html: `
<p>Once the root is settled, every switch assigns roles to its ports. All decisions follow the same chain of comparisons: lower cost, then lower bridge ID of the sender, then lower port ID.</p>
<table><tr><th>Role</th><th>Rule</th><th>State</th></tr>
<tr><td><b>Root port</b></td><td>Every switch except the root has exactly one: the port with the cheapest path to the root.</td><td>Forwarding</td></tr>
<tr><td><b>Designated port</b></td><td>Every cable segment has exactly one: on the switch that offers the cheapest path to the root there. All ports of the root are designated.</td><td>Forwarding</td></tr>
<tr><td><b>Alternate</b></td><td>Everything that is left. A backup path to the root.</td><td>Blocking</td></tr></table>
<h2>Costs</h2>
<p>The root path cost is the sum of the port costs on the way to the root, each counted at the <b>receiving</b> port. Faster links cost less:</p>
<table><tr><th>Speed</th><th>802.1D (short)</th><th>802.1t (long)</th></tr>
<tr><td>10 Mbit/s</td><td>100</td><td>2,000,000</td></tr><tr><td>100 Mbit/s</td><td>19</td><td>200,000</td></tr>
<tr><td>1 Gbit/s</td><td>4</td><td>20,000</td></tr><tr><td>10 Gbit/s</td><td>2</td><td>2,000</td></tr></table>
<h2>Worked through on the ring</h2>
<pre>Ring: sw1 (root) – sw2 – sw3 – sw4 – sw1, all links cost 4
sw2: root port to sw1, cost 4
sw4: root port to sw1, cost 4
sw3: two paths with cost 8, via sw2 or via sw4
     tie → the neighbor with the lower bridge ID wins
Segment sw2–sw3: sw2 offers 4, sw3 offers 8 → sw2 is designated
Segment sw3–sw4: the same, sw4 is designated
→ The port of sw3 towards the "loser" is left over: alternate, blocking</pre>
${note('The roles tell you where traffic flows. A frame from one end of the ring to the other always takes the path via the root, even if a shorter path exists that is currently blocked.')}` },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'How many root ports does the root bridge have?', input: ['0', 'none', 'zero'], explain: 'The root does not need a path to itself. All of its ports are designated.' },
        { q: 'A switch reaches the root directly via a 100 Mbit link (cost 19) or via two gigabit hops (4 + 4). Which path becomes the root port?', options: ['The direct 100 Mbit link', 'The path via two gigabit hops', 'Both, STP balances the load'], correct: 1,
          explain: '4 + 4 = 8 is less than 19. STP counts costs, not hops. And STP never balances load across two paths; that would require several instances (MSTP) or layer 3 routing with ECMP.' },
        { q: 'On a segment, both switches offer the same cost to the root. Who gets the designated port?', options: ['The one with the lower bridge ID', 'The one with the higher MAC', 'Both', 'Neither'], correct: 0 }] },
      { type: 'lab', title: 'Predict and move the blocked port', topo: stpSquare, edit: 'config',
        intro: '<p>Four switches in a ring, sw1 is root (priority 4096). Let the network converge briefly and then compare the dots on the ports with your calculation. R stands for root port, D for designated, A for alternate.</p>',
        presets: { sw3: ['show spanning-tree', 'spanning-tree cost eth2 19'], sw2: ['show spanning-tree'], sw4: ['show spanning-tree'], pc1: ['ping -c 2 10.0.0.3'] },
        goals: [
          { text: 'Which port blocks? Answer with switch and port, e.g. sw2 eth1.', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Via which neighbor does sw3 reach the root?', ask: true, expect: sim => { const t = sim.dev('sw3').bridge.stpTable(); const l = sim.linkAt('sw3', t?.rootPort || ''); return l ? [l.a.dev === 'sw3' ? l.b.dev : l.a.dev] : []; } },
          { text: 'Raise a port cost on sw3 so that sw3 reaches the root via <b>sw2</b>.', check: sim => sim.dev('sw3').bridge.stpTable()?.rootPort === 'eth1' },
          { text: 'Which port blocks now?', ask: true, expect: sim => portAnswers(blockedPorts(sim, ['sw1', 'sw2', 'sw3', 'sw4'])), placeholder: 'sw? eth?' },
          { text: 'Ping pc3 (10.0.0.3) from pc1. The path goes via sw2.', check: pingOk('pc1', '10.0.0.3') }],
        hints: ['sw3 eth1 leads to sw2, sw3 eth2 to sw4.', 'Costs count at the receiving port. Make the path via sw4 more expensive: cost of sw3 eth2 to 19.'],
        outro: '<p>With port costs you control which link is the backup. In practice, costs are usually left at the default and only the root is chosen deliberately. Costs are adjusted when links have different speeds or a specific link should be preferred.</p>' }
    ] },

    { id: 'm4-l4', title: 'Port states, timers and PortFast', minutes: 15, steps: [
      { type: 'theory', title: 'Why a new port needs 30 seconds', html: `
<p>A port that becomes active must not forward right away: it could close a loop before all switches know the new situation. That is why it goes through several states:</p>
<table><tr><th>State</th><th>Duration</th><th>BPDUs</th><th>learns MACs</th><th>forwards</th></tr>
<tr><td>Blocking</td><td>up to 20 s (max age)</td><td>receives</td><td>no</td><td>no</td></tr>
<tr><td>Listening</td><td>15 s (forward delay)</td><td>sends and receives</td><td>no</td><td>no</td></tr>
<tr><td>Learning</td><td>15 s (forward delay)</td><td>sends and receives</td><td><b>yes</b></td><td>no</td></tr>
<tr><td>Forwarding</td><td>permanent</td><td>sends and receives</td><td>yes</td><td><b>yes</b></td></tr></table>
<p>Learning exists so that the switch fills its MAC table before it forwards. Otherwise it would have to flood every frame at first.</p>
${note('The problem in practice: a PC is plugged in, and nothing works for 30 seconds. DHCP times out, a PXE boot fails. The solution is called <b>PortFast</b> (Cisco) or <b>edge port</b> (standard): ports to end devices go to Forwarding immediately.')}
<p>If a BPDU still arrives on an edge port, there is obviously a switch connected there. The port then loses its edge status and takes part in STP normally. With <b>BPDU Guard</b>, such a port is even shut down, a good protection against switches people bring along.</p>
${note('<b>RSTP</b> (802.1w, the standard today) negotiates new ports in fractions of a second instead of waiting for timers. The roles and the root election work the same as here. A Linux bridge only speaks classic STP; for RSTP you need the <code>mstpd</code> service.')}` },
      { type: 'lab', title: 'Watch the states and turn on PortFast', topo: () => stpTriangle({ enabled: true, rootPrio: 4096, timers: 'standard' }), edit: 'config',
        intro: '<p>This time the standard timers are running. Watch the dots on the ports: yellow means Listening or Learning. The log can be filtered to "Spanning tree only". The fast-forward button skips waiting time.</p>',
        presets: { sw2: ['show spanning-tree'], sw3: ['show spanning-tree', 'spanning-tree portfast eth5 on'], pc1: ['ping -c 1 10.0.0.2'] },
        goals: [
          { text: 'Wait until the port of pc1 (sw2 eth5) forwards.', check: tag('sw2', 'stp-state', d => d.port === 'eth5' && d.state === 'forwarding') },
          { text: 'After how many seconds of simulation time was that? (whole number)', ask: true,
            expect: sim => { const e = sim.log.find(x => x.dev === 'sw2' && x.tag === 'stp-state' && x.data?.port === 'eth5' && x.data.state === 'forwarding'); return e ? [String(Math.round(e.t / 1000)), '30'] : ['30']; } },
          { text: 'Turn on PortFast for eth5 on sw3. Then briefly disconnect pc2\'s cable and reconnect it: the port forwards immediately.', check: tag('sw3', 'stp-state', d => d.port === 'eth5' && d.edge) },
          { text: 'In which state does a port learn MAC addresses but not forward anything yet?', ask: true, expect: () => ['learning'] }],
        hints: ['You disconnect a cable by clicking it and unchecking "Link up".'],
        outro: '<p>Edge ports belong on every port to an end device. Between switches they stay off, otherwise a loop could briefly form when plugging in.</p>' }
    ] },

    { id: 'm4-l5', title: 'Failure and convergence', minutes: 15, steps: [
      { type: 'theory', title: 'When a path goes away', html: `
<p>Spanning tree has to distinguish two kinds of failures:</p>
<table><tr><th>Failure</th><th>How the switch notices</th><th>Duration with 802.1D</th></tr>
<tr><td>direct: its own root port loses the link</td><td>immediately</td><td>30 s (listening + learning)</td></tr>
<tr><td>indirect: the path breaks somewhere else</td><td>BPDUs stop arriving, after max age the information expires</td><td>up to 50 s (20 + 15 + 15)</td></tr></table>
<h2>Topology change</h2>
<p>After failing over, the MAC tables are no longer correct: they still point to the old path. Without countermeasures, frames would run into nowhere until aging (300 s). That is why a switch reports a <b>topology change</b> (TC) towards the root, the root sets the TC flag in its BPDUs, and all switches then quickly flush their MAC tables. After that, addresses are learned again via the new path.</p>
${note('A TC also occurs when an ordinary port of an end device goes to Forwarding. Without PortFast, every PC that is switched on briefly triggers a flush of the MAC tables in the entire network. Another reason for edge ports.')}` },
      { type: 'lab', title: 'Pull a cable', topo: () => stpTriangle({ enabled: true, rootPrio: 4096 }), edit: 'config',
        intro: '<p>sw1 is root. Let the network converge and check with a ping that everything works. Then interrupt the cable between sw1 and sw2 and watch how STP releases the backup path.</p>',
        presets: { pc1: ['ping -c 1 10.0.0.2', 'ping -c 12 10.0.0.2'], sw2: ['show spanning-tree', 'ip link set eth1 down'], sw3: ['show spanning-tree'] },
        goals: [
          { text: 'Ping pc2 from pc1 as soon as all ports are green or red.', check: pingOk('pc1', '10.0.0.2') },
          { text: 'Which switch has the blocked port?', ask: true, expect: sim => {
            const cut = sim.log.find(x => x.tag === 'link-down');
            const ev = sim.log.filter(x => x.tag === 'stp-state' && x.data?.state === 'blocking' && (!cut || x.seq < cut.seq));
            return ev.length ? [ev[ev.length - 1].dev] : blockedPorts(sim, TRI).map(([d]) => d);
          } },
          { text: 'Interrupt the cable between sw1 and sw2.', check: sim => linkBetween(sim, 'sw1', 'sw2')?.up === false },
          { text: 'Which port of sw2 is now the root port?', ask: true, expect: sim => [sim.dev('sw2').bridge.stpTable()?.rootPort || ''] },
          { text: 'Ping again until replies come back.', check: pingOkAfter('pc1', '10.0.0.2', e => e.tag === 'link-down') }],
        hints: ['A running ping -c 12 nicely shows how long the interruption lasts.', 'In the log under "Spanning tree only" you can see the topology change and the flushing of the MAC tables.'],
        outro: '<p>With the fast lab timers, failing over takes 8 seconds, with the standard timers 30. Rapid spanning tree usually manages it in under a second. Where failover has to be even faster, you rely on layer 3 with routing instead of large layer 2 domains.</p>' },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'Why do switches flush their MAC tables after a topology change?', options: ['To save memory', 'Because the entries still point to the old path', 'So that STP restarts', 'They do not'], correct: 1 },
        { q: 'A switch no longer hears BPDUs on its root port, but the link is still up. How long does it wait (802.1D) before discarding the information?', input: ['20'], unit: 'seconds', explain: 'That is max age. After that come listening and learning with 15 seconds each.' },
        { q: 'Which measure shortens failover the most?', options: ['Hello timer at 1 second', 'Rapid spanning tree (802.1w)', 'Higher root priority', 'More redundant cables'], correct: 1 }] }
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
  mac: [[M('client'), 'client'], [M('r1'), 'r1 eth1 (gateway)'], [M('web'), 'web'], [M('dns'), 'dns']],
  ip: [['10.10.0.10', 'client'], ['10.10.0.1', 'r1 eth1'], ['10.20.0.80', 'web'], ['10.20.0.53', 'dns']],
  name: ['web.lab', 'dns.lab', 'client.lab']
};
const EPHEMERAL = { range: [1024, 65535] };
const tcpDoneAfter = (evTag, port) => sim => {
  const ev = sim.log.find(e => e.tag === evTag);
  return !!ev && sim.log.some(e => e.seq > ev.seq && e.tag === 'tcp-done' && e.data.ok && (!port || e.data.port === port));
};

export default {
  id: 'm5', title: 'Transport: UDP, TCP and services', bands: ['ip', 'udp', 'tcp'],
  text: 'Ports and sockets, DNS over UDP, the three-way handshake, refused and filtered connections, MSS and the path MTU from TCP\'s point of view.',
  lessons: [
    { id: 'm5-l1', title: 'Ports, sockets and UDP', minutes: 10, steps: [
      { type: 'theory', title: 'Who gets the packet?', html: `
<p>The IP address brings a packet to the right host. But many programs run on the host at the same time. Which one gets the data is decided by the transport layer using <b>ports</b>: 16-bit numbers from 0 to 65535.</p>
<table><tr><th>Range</th><th>Name</th><th>Examples</th></tr>
<tr><td>0 to 1023</td><td>Well-known ports, on Linux only with root privileges</td><td>22 SSH, 53 DNS, 80 HTTP, 443 HTTPS</td></tr>
<tr><td>1024 to 49151</td><td>registered ports</td><td>3306 MySQL, 5432 PostgreSQL, 4789 VXLAN</td></tr>
<tr><td>49152 to 65535</td><td>dynamic ports for clients (IANA)</td><td>Linux uses 32768 to 60999 by default</td></tr></table>
<p>A server <b>listens</b> on a fixed port. A client gets a random <b>source port</b> from the operating system. The combination of protocol, source IP, source port, destination IP and destination port (the <b>5-tuple</b>) uniquely determines which connection a packet belongs to. That is why a browser can have ten connections open to the same web server.</p>
<h2>UDP: simple and fast</h2>
${bar([['Source port', '2', 'udp', 1], ['Dest. port', '2', 'udp', 1], ['Length', '2', 'udp', 1], ['Checksum', '2', 'udp', 1], ['Data', 'any size', 'data', 2.6]], 'The UDP header is only 8 bytes.')}
<p>UDP delivers datagrams without a connection, without acknowledgment, without retransmission and without ordering. Whatever gets lost is gone, unless the application takes care of it itself. That is intentional: DNS, DHCP, NTP, syslog, VoIP, VXLAN, WireGuard and QUIC (HTTP/3) use UDP because they want to be fast or handle reliability themselves.</p>
${note('If a UDP datagram arrives on a port where nothing is listening, the host replies with ICMP <b>Port Unreachable</b> (type 3, code 3). <code>ss -tuln</code> shows which ports are open on a Linux host.')}` },
      { type: 'label', title: 'Label the UDP header', distractors: ['TTL', 'Sequence number', 'Flags'],
        slots: [{ label: 'Source port', size: '16 bits', kind: 'udp', w: 130 }, { label: 'Dest. port', size: '16 bits', kind: 'udp', w: 130 }, { label: 'Length', size: '16 bits', kind: 'udp', w: 130 }, { label: 'Checksum', size: '16 bits', kind: 'udp', w: 130 }] },
      { type: 'quiz', title: 'Quick check', questions: [
        { q: 'A client queries a DNS server. Which port is the destination port on the way there?', options: ['A random high port', '53', '80', '67'], correct: 1, explain: 'In the reply the ports are swapped: source 53, destination the client\'s random port.' },
        { q: 'What happens if a UDP datagram is lost on the way?', options: ['UDP resends it after a timeout', 'Nothing, unless the application asks again', 'The router sends it again', 'The receiver requests it'], correct: 1 },
        { q: 'How long is the UDP header?', input: ['8'], unit: 'bytes' }] }
    ] },

    { id: 'm5-l2', title: 'DNS over UDP', minutes: 15, steps: [
      { type: 'theory', title: 'One question, one answer', html: `
<p>DNS translates names into addresses. A query almost always fits into a single UDP datagram, and so does the answer. If no answer comes, the client simply asks again after a few seconds.</p>
<pre>client  →  dns   UDP 51234 → 53   query: A record for web.lab?
dns     →  client UDP 53 → 51234  answer: web.lab A 10.20.0.80</pre>
<table><tr><th>Response code</th><th>Meaning</th></tr>
<tr><td>NOERROR</td><td>Name found, address in the answer section</td></tr>
<tr><td>NXDOMAIN</td><td>the name does not exist</td></tr>
<tr><td>SERVFAIL</td><td>the server could not answer the question</td></tr></table>
<p><code>dig @10.20.0.53 web.lab</code> queries a specific server. Without <code>@</code>, dig uses the configured DNS server (on Linux from <code>/etc/resolv.conf</code>). Programs like <code>curl</code> or <code>ping</code> first resolve a name and only then send the actual packet.</p>
${note('Answers over 512 bytes (e.g. with DNSSEC) switch to TCP port 53. A firewall that only allows UDP 53 therefore sometimes causes strange errors.')}` },
      { type: 'build', title: 'Build the DNS query', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'dns'],
        task: '<p>The <b>client</b> (10.10.0.10, gateway 10.10.0.1) asks the DNS server <b>dns</b> (10.20.0.53) for <code>web.lab</code>. The DNS server is in a different subnet. Build the frame as it leaves the client\'s cable.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.53', proto: '17', ttl: '64' } },
          { block: 'udp', fields: { sport: EPHEMERAL, dport: '53' } },
          { block: 'dns', fields: { qr: '0', name: 'web.lab' } }],
        explain: 'The destination MAC is that of the gateway, because the DNS server is in a different network. The IP addresses are valid end to end. The source port is any high port chosen by the operating system.' },
      { type: 'lab', title: 'Resolve names', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>The client asks the server dns. Open the client\'s console and look at the query and the answer in the packet inspector.</p>',
        presets: { client: ['dig @10.20.0.53 web.lab', 'dig @10.20.0.53 doesnotexist.lab', 'nc -u 10.20.0.53 5353'], dns: ['ss -tuln'] },
        goals: [
          { text: 'Use dig to ask the server 10.20.0.53 for web.lab.', check: tag('client', 'dns-done', d => d.ok && d.name === 'web.lab') },
          { text: 'Click the DNS query in the log and expand it in the packet inspector.', check: inspected(isDns) },
          { text: 'Which source port does the client\'s query have?', ask: true,
            expect: sim => sim.log.filter(e => e.dev === 'client' && e.kind === 'send' && e.frame && isDns(e.frame) && !e.frame.payload.l4.payload.qr).map(e => String(e.frame.payload.l4.sport)) },
          { text: 'Ask for a name that does not exist. Which status does dig report?', ask: true, expect: () => ['nxdomain'] },
          { text: 'Use nc -u to send a UDP datagram to a port on which dns is not listening.', check: tag('dns', 'port-unreachable-sent') }],
        hints: ['The status is in the ->>HEADER<<- line of the dig output.'],
        outro: '<p>dns answers the closed port with ICMP Port Unreachable. This way the client learns that nobody is listening there. Without this message, for example because a firewall drops it, a closed UDP port looks exactly like a lost packet.</p>' }
    ] },

    { id: 'm5-l3', title: 'TCP: the three-way handshake', minutes: 18, steps: [
      { type: 'theory', title: 'Reliable over an unreliable network', html: `
<p>TCP turns individual IP packets into a reliable <b>byte stream</b>: every byte is numbered, the receiver acknowledges what it has received, and anything missing is sent again. Before data flows, both sides agree on their starting numbers.</p>
${bar([['Ports', '4', 'tcp', 1], ['Sequence number', '4', 'tcp', 1.2], ['Acknowledgment', '4', 'tcp', 1.2], ['Length, flags', '2', 'tcp', 1], ['Window', '2', 'tcp', .8], ['Checksum, urgent', '4', 'tcp', 1.1], ['Options', '0 to 40', 'tcp', 1], ['Data', '', 'data', 1.6]], 'At least 20 bytes of header, up to 60 bytes with options.')}
<table><tr><th>Flag</th><th>Meaning</th></tr>
<tr><td>SYN</td><td>Open a connection, set the starting number</td></tr>
<tr><td>ACK</td><td>The acknowledgment field is valid. Always set from the second segment on.</td></tr>
<tr><td>PSH</td><td>Hand the data to the application immediately</td></tr>
<tr><td>FIN</td><td>I will not send anything more, clean end</td></tr>
<tr><td>RST</td><td>Abort: port closed or connection unknown</td></tr></table>
<h2>Setup and teardown</h2>
<pre>client                                 web:80
  SYN       seq=1000          MSS 1460  →          LISTEN
            ←  SYN, ACK  seq=5000 ack=1001  MSS 1460
  ACK       seq=1001 ack=5001           →          ESTABLISHED
  PSH, ACK  GET / HTTP/1.1 (78 bytes)   →
            ←  ACK, data: HTTP/1.1 200 OK …
  FIN, ACK                              →
            ←  FIN, ACK
  ACK                                   →          closed</pre>
<p>SYN and FIN count as one byte, which is why the server acknowledges the 1000 with 1001. The starting numbers are random so that nobody can inject foreign segments into a connection. The SYN also contains the <b>MSS</b> (maximum segment size): the maximum number of data bytes a segment may carry, normally the MTU minus 40.</p>
${note('A router reads none of this. To it, a TCP segment is an IP packet like any other. Only stateful firewalls and load balancers look at ports and flags.')}` },
      { type: 'label', title: 'Label the TCP header', distractors: ['TTL', 'VNI', 'Length (UDP)'],
        rows: [[{ label: 'Source port', size: '16 bits', kind: 'tcp', w: 200 }, { label: 'Dest. port', size: '16 bits', kind: 'tcp', w: 200 }],
          [{ label: 'Sequence number', size: '32 bits', kind: 'tcp', w: 406 }],
          [{ label: 'Acknowledgment number', size: '32 bits', kind: 'tcp', w: 406 }],
          [{ label: 'Header length', size: '4 bits', kind: 'tcp', w: 100 }, { label: 'Flags', size: '12 bits', kind: 'tcp', w: 96 }, { label: 'Window', size: '16 bits', kind: 'tcp', w: 200 }],
          [{ label: 'Checksum', size: '16 bits', kind: 'tcp', w: 200 }, { label: 'Urgent pointer', size: '16 bits', kind: 'tcp', w: 200 }]],
        explain: 'The window says how many bytes the receiver can still take in. This lets it slow down a sender that is too fast (flow control).' },
      { type: 'stack', title: 'Put the segments in the right order', hint: 'The top is the first segment of a short HTTP connection.',
        items: [{ name: 'client → web: SYN', kind: 'tcp' }, { name: 'web → client: SYN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' },
          { name: 'client → web: PSH, ACK with GET /', kind: 'data' }, { name: 'web → client: ACK with HTTP/1.1 200 OK', kind: 'data' },
          { name: 'client → web: FIN, ACK', kind: 'tcp' }, { name: 'web → client: FIN, ACK', kind: 'tcp' }, { name: 'client → web: ACK', kind: 'tcp' }] },
      { type: 'build', title: 'Build the first segment', blocks: ['eth', 'vlan', 'arp', 'ip', 'icmp', 'udp', 'tcp', 'http'],
        task: '<p>The <b>client</b> (10.10.0.10) opens a connection to the web server <b>web</b> (10.20.0.80, port 80) in a different subnet. Build the first frame of this connection as it leaves the client\'s cable.</p>',
        addresses: ADDR,
        expected: [
          { block: 'eth', fields: { dst: M('r1'), src: M('client'), type: '0x0800' } },
          { block: 'ip', fields: { src: '10.10.0.10', dst: '10.20.0.80', proto: '6', ttl: '64' } },
          { block: 'tcp', fields: { sport: EPHEMERAL, dport: '80', flags: 'SYN' } }],
        explain: 'The first segment only carries the SYN flag and no data yet. The HTTP request only follows after the handshake.' }
    ] },

    { id: 'm5-l4', title: 'TCP in the lab', minutes: 15, steps: [
      { type: 'lab', title: 'Fetch a web page', topo: () => servicesTopo(), edit: 'config',
        intro: '<p>Fetch the page <code>http://web.lab/</code> from the client. curl first resolves the name via DNS and then opens the TCP connection. Turn the speed down and follow the segments.</p>',
        presets: { client: ['curl http://web.lab/', 'curl http://10.20.0.80/'], web: ['ss -tuln', 'ss -tan'] },
        goals: [
          { text: 'Fetch http://web.lab/.', check: tag('client', 'tcp-done', d => d.ok && d.mode === 'http') },
          { text: 'Click the first SYN segment and look at its options.', check: inspected(isTcpSyn) },
          { text: 'Which MSS does the client announce in the SYN?', ask: true, expect: () => ['1460'] },
          { text: 'In how many segments does web send the response?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-response').map(e => String(e.data.segments)) },
          { text: 'Which flags does the second segment of the handshake have?', ask: true, expect: () => ['syn, ack', 'syn,ack', 'syn ack', 'syn/ack', 'synack', 'syn-ack', 'ack, syn', 'ack,syn'] }],
        hints: ['In the log the segments are called SYN, SYN/ACK and so on. Filter to "Only client".', 'The response is 3000 bytes. Calculate with the MSS.'],
        outro: '<p>The 3000 byte response does not fit into one segment: web splits it according to the MSS. The client acknowledges every segment. In real networks it often only acknowledges every second one (delayed ACK), and the sender sends several segments without waiting for acknowledgments (window).</p>' }
    ] },

    { id: 'm5-l5', title: 'Refused, filtered, prohibited', minutes: 15, steps: [
      { type: 'theory', title: 'Three ways a connection fails', html: `
<table><tr><th>What you see</th><th>What happened</th><th>Typical cause</th></tr>
<tr><td><code>Connection refused</code> immediately</td><td>An RST came back in response to the SYN</td><td>Nothing is listening on the port, or a firewall rejects with RST</td></tr>
<tr><td><code>timed out</code> after seconds</td><td>Nothing at all came back in response to the SYN, the client repeats it several times</td><td>A firewall drops silently (DROP), or the host is gone</td></tr>
<tr><td><code>No route to host</code> or <code>prohibited</code></td><td>An ICMP error came back</td><td>No ARP for the destination, or a firewall rejects with ICMP</td></tr></table>
<p><code>nc -zv host port</code> only tests the connection setup and is well suited to distinguish these cases.</p>
${note('A firewall that rejects with RST uses the server\'s address as the sender. To the client, a rejected port therefore looks exactly like a closed one. Only the firewall\'s log or a capture on both sides shows the difference.')}
${note('DROP or REJECT? DROP reveals less, but makes every client wait until the timeout. For internal networks REJECT is often friendlier; at the border to the internet DROP is usually used.')}` },
      { type: 'lab', title: 'Find out what stops the connection', topo: () => servicesTopo({ acl: [
        { action: 'drop', proto: 'tcp', port: 80, src: 'any', dst: '10.20.0.80/32' },
        { action: 'reject', proto: 'tcp', port: 443, src: 'any', dst: '10.20.0.80/32' }] }), edit: 'config',
        intro: '<p>A colleague reports: "web.lab does not work". web runs HTTP (80) and HTTPS (443), SSH (22) is not installed. Examine the three ports from the client.</p>',
        presets: { client: ['nc -zv 10.20.0.80 22', 'nc -zv 10.20.0.80 80', 'nc -zv 10.20.0.80 443', 'curl http://web.lab/'], web: ['ss -tuln'] },
        goals: [
          { text: 'Test port 22. The connection is refused immediately.', check: tag('client', 'tcp-refused', d => d.port === 22) },
          { text: 'Test port 80. This time the connection times out.', check: tag('client', 'tcp-timeout', d => d.port === 80) },
          { text: 'Test port 443. Here too: refused, even though the service is running.', check: tag('client', 'tcp-refused', d => d.port === 443) },
          { text: 'Which device actually sent the RST for port 443?', ask: true, expect: () => ['r1'] },
          { text: 'Change the rules on r1 so that HTTP to web is allowed, and fetch http://web.lab/.', check: tag('client', 'tcp-done', d => d.ok && d.port === 80 && d.mode === 'http') }],
        hints: ['How often did the client send its SYN for port 80? The log shows it.', 'You will find the rules under Configuration on r1. The first matching one applies.'],
        outro: '<p>Port 22 and port 443 looked the same to the client, but the cause was completely different: once no service, once a rule on r1. The log of r1 gives it away with "Rule 2 (reject) matches".</p>' }
    ] },

    { id: 'm5-l6', title: 'Segments, MSS and the path MTU', minutes: 18, steps: [
      { type: 'theory', title: 'TCP does not fragment, TCP segments', html: `
<p>TCP sets the DF bit in every packet. Instead of IP fragments it uses smaller segments. How large they may be is negotiated by both sides in the handshake with the MSS: each side announces the MTU of its interface minus 40 (20 IP, 20 TCP). But both only know their own link.</p>
<pre>client ── r1 ══ MTU 1400 ══ r2 ── fw ── web
MSS in the handshake: 1460 and 1460 → web sends segments of 1500 bytes
r2 cannot forward them (DF set) → ICMP Fragmentation Needed, MTU 1400 to web
web remembers the path MTU and resends the data, now with 1360 bytes per segment</pre>
<p>This is <b>Path MTU Discovery</b> (module IP and routing) from TCP's point of view. If the ICMP message does not arrive, the infamous <b>PMTUD blackhole</b> appears:</p>
<table><tr><th>Symptom</th><th>Explanation</th></tr>
<tr><td>The connection is established, then it hangs</td><td>SYN, SYN/ACK and ACK are small and fit, the full data segments do not</td></tr>
<tr><td>SSH login works, at the first <code>ls</code> in a large directory it freezes</td><td>small packets get through, large ones do not</td></tr>
<tr><td>Web pages load halfway</td><td>the beginning fits into small segments, the rest does not</td></tr></table>
<h2>Remedy</h2>
<p>The clean solution: do not filter ICMP type 3 code 4. Where that is out of your hands, <b>MSS clamping</b> on the router in front of the narrow spot helps. It rewrites the MSS in every forwarded SYN, so both sides send small segments from the start:</p>
<pre>iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN \\
         -j TCPMSS --set-mss 1360</pre>
${note('Typical places for this are VPN tunnels, PPPoE (MTU 1492) and VXLAN without jumbo frames in the underlay.')}` },
      { type: 'lab', title: 'Path MTU Discovery with TCP', topo: () => tcpPathTopo(), edit: 'config',
        intro: '<p>Between r1 and r2 there is a section with MTU 1400. The response from web is 6000 bytes. Fetch it and watch how web adjusts its segments.</p>',
        presets: { client: ['curl http://10.0.2.80/'], web: ['ip route get 10.0.1.10'] },
        goals: [
          { text: 'Fetch http://10.0.2.80/ from the client.', check: tag('client', 'tcp-done', d => d.ok) },
          { text: 'Which router sent ICMP Fragmentation Needed?', ask: true, expect: sim => sim.log.filter(e => e.tag === 'frag-needed-sent').map(e => e.dev) },
          { text: 'With which MSS does web resend the data?', ask: true, expect: sim => sim.log.filter(e => e.dev === 'web' && e.tag === 'tcp-retransmit').map(e => String(e.data.mss)) }],
        outro: '<p>In the console, web now also has an entry <code>cache mtu 1400</code> with <code>ip route get 10.0.1.10</code>. This is how Linux remembers the path MTU per destination.</p>' },
      { type: 'lab', title: 'The blackhole and MSS clamping', topo: () => tcpPathTopo({ fwAcl: [{ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }] }), edit: 'config',
        intro: '<p>Someone has blocked all ICMP on fw. Fetch the page again and compare. Then fix the problem without touching the rule on fw.</p>',
        presets: { client: ['curl http://10.0.2.80/'], r1: ['show ip route'] },
        goals: [
          { text: 'Fetch http://10.0.2.80/. The connection is up, but the data does not arrive.', check: tag('client', 'tcp-stalled') },
          { text: 'Was the three-way handshake completed? (yes or no)', ask: true, expect: () => ['yes'] },
          { text: 'Set up MSS clamping on r1 so that the segments fit through the narrow spot, and fetch the page again.', check: tcpDoneAfter('tcp-stalled') }],
        hints: ['You will find MSS clamping on r1 under Configuration, below IP forwarding.', 'MTU 1400 minus 40 bytes for IP and TCP.'],
        outro: '<p>With MSS clamping, the client only announces 1360 in the SYN, and the SYN/ACK from web is also adjusted on the way back. Neither side sends a segment that is too large any more, ICMP is not needed at all.</p>' }
    ] }
  ]
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/engine.js" <<'__PACKETPILOT_FILE_END__'
// PacketPilot simulation engine: event-driven, no DOM
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
export const STP_PRESETS = { standard: { hello: 2, fwd: 15, maxAge: 20 }, fast: { hello: 1, fwd: 4, maxAge: 6 } };
// Networks saved by older versions still use the German name of the fast timers
STP_PRESETS.schnell = STP_PRESETS.fast;

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
    this.record(A, up ? 'info' : 'err', `Link ${A?.name} ${l.a.if} ↔ ${B?.name} ${l.b.if} is ${up ? 'up again' : 'down'}`, { tag: up ? 'link-up' : 'link-down' });
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
    if (!link) { if (!quiet) this.record(dev, 'drop', `${ifname} is not connected, frame is lost`, { frame }); return; }
    if (!link.up) { if (!quiet) this.record(dev, 'drop', `Link on ${ifname} is down, frame is lost`, { frame, tag: 'link-down-drop' }); return; }
    const plen = framePayloadLen(frame);
    if (plen > link.mtu) {
      this.record(dev, 'drop', `Frame does not fit through the link on ${ifname} (payload ${plen} > MTU ${link.mtu}), silently dropped`, { frame, tag: 'link-mtu-drop' });
      return;
    }
    const peer = link.a.dev === dev.id && link.a.if === ifname ? link.b : link.a;
    const f = clone(frame);
    const fl = { id: f.id + ':' + this.seq, frame: f, link, from: dev.id, fromIf: ifname, to: peer.dev, toIf: peer.if, t0: this.time, t1: this.time + T.linkDelay };
    this.inflight.push(fl);
    this.record(dev, 'send', `sends via ${ifname}: ${summary(f)}`, { frame: f, tag: quiet ? 'bpdu-sent' : null });
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

// ---------------------------------------------------------------- Devices
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

  // ---- Sending
  output(pkt, ctx = {}) {
    if (this.isOwn(pkt.dst)) { this.sim.schedule(0.01, () => this.deliver(pkt, 'lo')); return { ok: true }; }
    const r = this.lookup(pkt.dst);
    if (!r) {
      if (ctx.forwarded) {
        this.dev.record('drop', `no route to ${pkt.dst}, sends ICMP Network Unreachable to ${pkt.src}`, { tag: 'no-route', data: { dst: pkt.dst } });
        this.icmpError(pkt, 3, 0);
      } else this.dev.record('err', `no route to ${pkt.dst}: Network is unreachable`, { tag: 'no-route', data: { dst: pkt.dst } });
      return { ok: false, error: 'Network is unreachable' };
    }
    const mtu = this.mtu(r.dev);
    if (pkt.totalLength > mtu) {
      if (pkt.df) {
        if (ctx.forwarded) {
          this.dev.record('drop', `Packet (${pkt.totalLength} bytes) larger than MTU ${mtu} of ${r.dev} and DF set: dropped, ICMP Fragmentation Needed to ${pkt.src}`, { tag: 'frag-needed-sent', data: { mtu } });
          this.icmpError(pkt, 3, 4, { mtu });
        }
        return { ok: false, error: `message too long, mtu=${mtu}`, mtu };
      }
      const frags = this.fragment(pkt, mtu);
      this.dev.record('info', `Packet (${pkt.totalLength} bytes) larger than MTU ${mtu}: split into ${frags.length} fragments`, { tag: 'fragmented', data: { count: frags.length, mtu } });
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
        this.dev.record('err', `no ARP reply from ${nh} after ${T.arpRetries} attempts`, { tag: 'arp-failed', data: { ip: nh } });
        const q = this.pending.get(nh) || [];
        this.pending.delete(nh);
        for (const { pkt } of q) {
          if (this.isOwn(pkt.src)) for (const s of [...this.sessions]) s.onArpFail?.(pkt);
          else this.icmpError(pkt, 3, 1);
        }
        return;
      }
      entry.tries++;
      this.dev.record('info', `does not know the MAC of ${nh} and asks via ARP (attempt ${entry.tries})`, { tag: 'arp-request-sent', data: { ip: nh } });
      this.sendFrame(egress, BCAST, 'arp', arpPacket(1, this.dev.mac(egress), myIp, null, nh));
      this.sim.schedule(T.arpTimeout, ask);
    };
    ask();
  }
  // Neighbor Unreachability Detection: verify stale entries
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
          this.dev.record('err', `${nh} no longer answers at ${e.mac}: ARP entry deleted (FAILED). The next packet triggers a new ARP request.`, { tag: 'nud-failed', data: { ip: nh } });
          return;
        }
        this.dev.record('info', `checks via unicast ARP whether ${nh} is still reachable at ${e.mac} (probe ${n})`, { tag: 'nud-probe', data: { ip: nh } });
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
    if (changed && !quiet) this.dev.record('learn', `adds ${ip} → ${mac} to the ARP table (${how})`, { tag: 'arp-learned', data: { ip, mac } });
    const q = this.pending.get(ip);
    if (q) { this.pending.delete(ip); for (const { pkt, egress } of q) this.sendFrame(egress, mac, 'ipv4', pkt); }
  }
  arpTable() {
    return [...this.arp.entries()].map(([ip, e]) => ({ ip, mac: e.mac, ifname: e.ifname,
      state: e.state === 'REACHABLE' && this.sim.time - e.t > T.reachable ? 'STALE' : e.state }));
  }

  // ---- Receiving
  receive(phys, frame) {
    if (frame.type === 'stp') return;
    const vid = frame.vlan ? frame.vlan.vid : 0;
    const ifname = this.logicalFor(phys, vid);
    if (!ifname) {
      this.dev.record('drop', vid ? `drops frame with VLAN tag ${vid} on ${phys}: no matching (sub)interface` : `drops untagged frame on ${phys}: interface expects a tag`,
        { frame, tag: 'vlan-mismatch' });
      return;
    }
    const myMac = this.dev.mac(phys);
    if (frame.dst !== myMac && frame.dst !== BCAST) {
      this.dev.record('ignore', `sees a frame to ${frame.dst} on ${phys}: not for me, dropped`,
        { frame, tag: 'frame-not-mine', data: { type: frame.type, kind: frame.type === 'ipv4' ? frame.payload.l4?.kind : 'arp' } });
      return;
    }
    // Confirm reachability: traffic from the neighbor keeps the ARP entry fresh
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
        this.dev.record('err', `Address conflict: ${a.sha} also claims ${myIp}`, { frame, tag: 'ip-conflict' });
        return;
      }
      const e = this.arp.get(a.spa);
      if (e && e.mac) {
        if (e.mac !== a.sha) this.dev.record('learn', `updates ${a.spa}: ${e.mac} → ${a.sha} (gratuitous ARP)`, { frame, tag: 'garp-updated', data: { ip: a.spa, mac: a.sha } });
        this.learnArp(a.spa, a.sha, ifname, 'gratuitous ARP', true);
      } else this.dev.record('ignore', `Gratuitous ARP from ${a.spa}: no entry present, nothing to update`, { frame, tag: 'garp-ignored' });
      return;
    }
    if (a.op === 1 && a.spa === '0.0.0.0') {
      if (myIp && a.tpa === myIp) {
        this.dev.record('info', `answers an ARP probe: ${myIp} is already in use`, { frame, tag: 'dad-reply' });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, '0.0.0.0'));
      }
      return;
    }
    if (a.op === 1) {
      if (myIp && a.tpa === myIp) {
        this.learnArp(a.spa, a.sha, ifname, 'learned from the request');
        this.dev.record('info', `answers the ARP request: ${myIp} is at ${myMac}`, { tag: 'arp-reply-sent', data: { ip: myIp } });
        this.sendFrame(ifname, a.sha, 'arp', arpPacket(2, myMac, myIp, a.sha, a.spa));
      } else this.dev.record('ignore', `ARP request for ${a.tpa} is not for me, ignored`, { frame, tag: 'arp-ignored' });
    } else if (a.op === 2) {
      if (a.tpa === '0.0.0.0') return;
      if (this.arp.has(a.spa) || this.pending.has(a.spa)) this.learnArp(a.spa, a.sha, ifname, 'from the reply');
      else this.dev.record('ignore', `unsolicited ARP reply from ${a.spa} ignored`, { frame, tag: 'arp-unsolicited' });
    }
  }
  rxIp(ifname, ip, frame) {
    if (this.isOwn(ip.dst)) {
      if (ip.frag) return this.reassemble(ip, ifname);
      return this.deliver(ip, ifname, frame);
    }
    if (!this.forwarding) {
      this.dev.record('drop', `Packet to ${ip.dst} is not for me, and I do not forward (ip_forward=0)`, { frame, tag: 'not-forwarding' });
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
      this.dev.record('drop', `Rule ${m.index} (${m.rule.action === 'reject' ? 'reject' : 'drop'}) matches: packet ${ip.src} > ${ip.dst} is not forwarded`, { frame, tag: 'acl-drop', data: { rule: m.index } });
      if (m.rule.action === 'reject') {
        if (ip.proto === PROTO.TCP && ip.l4?.flags?.SYN) this.sendTcp(ip.src, tcp(ip.l4.dport, ip.l4.sport, 0, ip.l4.seq + 1, { RST: true, ACK: true }), ip.dst);
        else this.icmpError(ip, 3, 13);
      }
      return;
    }
    if (ip.ttl <= 1) {
      this.dev.record('drop', `TTL of ${ip.src} > ${ip.dst} expired, sends ICMP Time Exceeded to ${ip.src}`, { frame, tag: 'ttl-expired' });
      this.icmpError(ip, 11, 0);
      return;
    }
    const r = this.lookup(ip.dst);
    const out = clone(ip);
    out.ttl = ip.ttl - 1;
    const clamp = Number(this.cfg.mssClamp || 0);
    if (clamp && out.proto === PROTO.TCP && out.l4?.flags?.SYN && out.l4.mss > clamp) {
      this.dev.record('info', `adjusts the MSS in the SYN from ${out.l4.mss} to ${clamp} (MSS clamping)`, { frame, tag: 'mss-clamped', data: { from: out.l4.mss, to: clamp } });
      out.l4.mss = clamp;
    }
    out.checksum = ipChecksum(out);
    if (r) this.dev.record('fwd', `forwards ${ip.src} > ${ip.dst}: route ${r.net}/${r.len}${r.via ? ' via ' + r.via : ' direct'} out ${r.dev}, TTL ${ip.ttl} → ${out.ttl}`,
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
      this.dev.record('info', `reassembles ${r.parts.length} fragments into one packet of ${full.totalLength} bytes`, { tag: 'reassembled' });
      this.deliver(full, ifname);
    }
  }
  service(proto, port) { return (this.cfg.services || []).find(s => s.proto === proto && Number(s.port) === port); }
  deliver(ip, ifname, frame) {
    const l4 = ip.l4;
    if (!l4) return;
    if (l4.kind === 'icmp') {
      if (l4.type === 8) {
        this.dev.record('ok', `receives Echo Request from ${ip.src} (seq ${l4.seq}) and replies`, { frame, tag: 'echo-request-received', data: { from: ip.src } });
        this.output(ipPacket({ src: ip.dst, dst: ip.src, proto: PROTO.ICMP, df: ip.df, trace: ip.trace, l4: icmp(0, 0, { ident: l4.ident, seq: l4.seq, dataLen: l4.dataLen }) }), {});
        return;
      }
      if (l4.type === 0) {
        this.dev.record('ok', `receives Echo Reply from ${ip.src} (seq ${l4.seq})`, { frame, tag: 'echo-reply-received', data: { from: ip.src, size: l4.dataLen } });
        for (const s of [...this.sessions]) s.onEchoReply?.(ip);
        return;
      }
      if (l4.type === 3 || l4.type === 11) {
        if (l4.type === 3 && l4.code === 4 && l4.mtu && l4.orig) {
          this.pmtu.set(l4.orig.dst, l4.mtu);
          this.dev.record('learn', `remembers: path to ${l4.orig.dst} has MTU ${l4.mtu} (Path MTU Discovery)`, { frame, tag: 'pmtu-learned', data: { mtu: l4.mtu } });
          if (l4.orig.proto === PROTO.TCP) this.tcpPmtu(l4.orig, l4.mtu);
        } else this.dev.record('err', `receives ICMP ${icmpName(l4.type, l4.code)} from ${ip.src}`, { frame, tag: 'icmp-error-received', data: { type: l4.type, code: l4.code } });
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
        this.dev.record('ok', `receives a UDP datagram from ${ip.src}:${l4.sport} on port ${l4.dport} (${svc.name || 'service'})`, { frame, tag: 'udp-received', data: { port: l4.dport, from: ip.src } });
        return;
      }
      this.dev.record('info', `UDP port ${l4.dport} is closed, sends ICMP Port Unreachable to ${ip.src}`, { frame, tag: 'port-unreachable-sent', data: { port: l4.dport } });
      this.icmpError(ip, 3, 3);
    }
  }
  answerDns(ip, svc, frame) {
    const q = ip.l4.payload;
    const name = q.qname.toLowerCase().replace(/\.$/, '');
    const recs = (this.cfg.dns || []).filter(r => String(r.name).toLowerCase().replace(/\.$/, '') === name && isIp(r.ip));
    const ans = { kind: 'dns', id: q.id, qr: 1, qname: q.qname, answers: recs.map(r => ({ name: q.qname, ip: r.ip })), rcode: recs.length ? 'NOERROR' : 'NXDOMAIN' };
    this.dev.record('ok', `answers the DNS query for ${q.qname}: ${recs.length ? recs.map(r => r.ip).join(', ') : 'NXDOMAIN (unknown)'}`, { frame, tag: 'dns-answered', data: { name: q.qname, found: !!recs.length } });
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
  // After ICMP Fragmentation Needed: resend unacknowledged data with a smaller MSS
  tcpPmtu(orig, mtu) {
    for (const c of this.tcp.values()) {
      if (c.client || !c.resp || c.lport !== orig.sport || c.rip !== orig.dst || c.rport !== orig.dport) continue;
      const mss = Math.min(c.peerMss, mtu - 40);
      if (mss >= c.curMss || c.acked >= c.resp.start + c.resp.total) continue;
      this.dev.record('info', `resends the unacknowledged data from byte ${c.acked - c.resp.start}, now in segments of ${mss} bytes`, { tag: 'tcp-retransmit', data: { mss } });
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
          this.dev.record('info', `no service on TCP port ${s.dport}: replies with RST`, { frame, tag: 'tcp-rst-sent', data: { port: s.dport } });
          this.sendTcp(ip.src, tcp(s.dport, s.sport, 0, s.seq + 1, { RST: true, ACK: true }), ip.dst);
          return;
        }
        const conn = { state: 'SYN_RECEIVED', lport: s.dport, rip: ip.src, rport: s.sport, iss: nextIsn(this.sim), rcvNxt: s.seq + 1, peerMss: s.mss || 536, svc, local: ip.dst };
        conn.sndNxt = conn.iss + 1;
        this.tcp.set(key, conn);
        this.dev.record('info', `Service ${svc.name || ''} on port ${s.dport} accepts the connection: SYN/ACK`, { frame, tag: 'tcp-synack-sent', data: { port: s.dport } });
        this.sendTcp(ip.src, tcp(s.dport, s.sport, conn.iss, conn.rcvNxt, { SYN: true, ACK: true }, { mss: this.mssFor(ip.src) }), ip.dst);
        return;
      }
      if (!s.flags.RST) this.sendTcp(ip.src, tcp(s.dport, s.sport, s.ack, s.seq + (s.dataLen || 0), { RST: true, ACK: true }), ip.dst);
      return;
    }
    if (s.flags.RST) { this.tcp.delete(key); this.dev.record('info', `Connection to ${ip.src}:${s.sport} terminated by RST`, { frame, tag: 'tcp-reset' }); return; }
    if (c.state === 'SYN_RECEIVED' && s.flags.ACK && s.ack === c.sndNxt) {
      c.state = 'ESTABLISHED';
      this.dev.record('ok', `Connection with ${ip.src}:${s.sport} established (ESTABLISHED)`, { frame, tag: 'tcp-established', data: { port: c.lport } });
    }
    if (s.dataLen > 0 && s.seq === c.rcvNxt) {
      c.rcvNxt += s.dataLen;
      const total = Number(c.svc.size ?? 2000);
      const mss = Math.min(c.peerMss, this.mssFor(ip.src), (this.pmtu.get(ip.src) || 65535) - 40);
      const n = Math.max(1, Math.ceil(total / mss));
      this.dev.record('info', `receives ${s.dataLen} bytes${s.app ? ' (' + s.app + ')' : ''} and replies with ${total} bytes in ${n} segment${n > 1 ? 's' : ''} (MSS ${mss})`,
        { frame, tag: 'tcp-response', data: { segments: n, bytes: total, mss } });
      c.resp = { start: c.sndNxt, total, app: c.svc.name === 'http' ? `HTTP/1.1 200 OK, ${total} bytes` : c.svc.name === 'ssh' ? 'SSH-2.0-OpenSSH_9.6' : `${c.svc.name || 'response'}` };
      c.acked = c.sndNxt;
      this.sendResponse(c, mss, c.sndNxt);
      return;
    }
    if (c.resp && s.flags.ACK && s.ack > (c.acked ?? 0)) c.acked = s.ack;
    if (s.flags.FIN) {
      c.rcvNxt += 1;
      this.sendTcp(ip.src, tcp(c.lport, c.rport, c.sndNxt, c.rcvNxt, { FIN: true, ACK: true }), c.local);
      c.sndNxt += 1; c.state = 'LAST_ACK';
      this.dev.record('info', `${ip.src} closes the connection: FIN/ACK back`, { frame, tag: 'tcp-fin' });
      return;
    }
    if (c.state === 'LAST_ACK' && s.flags.ACK && s.ack === c.sndNxt) {
      this.tcp.delete(key);
      this.dev.record('ok', `Connection with ${ip.src}:${s.sport} closed`, { frame, tag: 'tcp-closed' });
    }
  }
}

// ---------------------------------------------------------------- Sessions
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
    this.dev.print(`PING ${this.dst}: ${this.size} bytes of data, ${IP_HDR + ICMP_HDR + this.size} byte IP packet`);
    this.sendNext();
  }
  sendNext() {
    if (this.done) return;
    const seq = ++this.seq;
    const total = IP_HDR + ICMP_HDR + this.size;
    const r = this.l3.lookup(this.dst);
    if (!r && !this.l3.isOwn(this.dst)) { this.dev.print('ping: connect: Network is unreachable'); this.dev.record('err', `ping ${this.dst}: no route`, { tag: 'no-route' }); return this.finish(true); }
    const lim = Math.min(this.l3.pmtu.get(this.dst) || Infinity, r ? this.l3.mtu(r.dev) : 65536);
    this.sent++;
    if (this.df && total > lim) {
      this.dev.print(`ping: local error: message too long, mtu=${lim}`);
      this.dev.record('err', `Packet of ${total} bytes with DF does not fit (MTU ${lim}), rejected locally`, { tag: 'local-mtu-error', data: { mtu: lim } });
      this.errors++;
    } else {
      const pkt = ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, ttl: this.ttl, proto: PROTO.ICMP, df: this.df, l4: icmp(8, 0, { ident: this.ident, seq, dataLen: this.size }) });
      const t0 = this.sim.time;
      const ev = this.sim.schedule(T.replyTimeout, () => { if (this.open.has(seq)) { this.open.delete(seq); this.dev.print(`icmp_seq=${seq}: no answer (timeout)`); this.checkEnd(); } });
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
    this.dev.print(`${ICMP_HDR + l4.dataLen} bytes from ${ip.src}: icmp_seq=${l4.seq} ttl=${ip.ttl} time=${(this.sim.time - o.t0).toFixed(2)} ms`);
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
    if (!aborted) { this.dev.print(`--- ${this.dst} ping statistics ---`); this.dev.print(`${this.sent} packets transmitted, ${this.received} received${this.errors ? `, ${this.errors} errors` : ''}, ${loss}% packet loss`); }
    this.dev.record(this.received ? 'ok' : 'err', `ping to ${this.dst} finished: ${this.received} of ${this.sent} answered`,
      { tag: 'ping-done', data: { dst: this.dst, sent: this.sent, received: this.received, size: this.size, df: this.df } });
  }
}

class TraceSession extends Session {
  constructor(l3, dst, o) { super(l3); Object.assign(this, { dst, max: o.maxHops ?? 8 }); this.ttl = 0; this.port = 33433; this.hops = []; }
  start() { this.begin(); this.dev.print(`$ traceroute -n ${this.dst}`); this.dev.print(`traceroute to ${this.dst}, ${this.max} hops max`); this.next(); }
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
    this.dev.record(reached ? 'ok' : 'err', `traceroute to ${this.dst} finished${reached ? ', destination reached' : ''}`, { tag: 'trace-done', data: { dst: this.dst, reached, hops: this.hops.length, path: this.hops } });
  }
}

class ArpingSession extends Session {
  constructor(l3, target, o) { super(l3); Object.assign(this, { target, mode: o.mode || 'normal', count: o.count ?? (o.mode === 'normal' ? 3 : o.mode === 'dad' ? 2 : 1), ifname: o.ifname }); this.sent = 0; this.replies = 0; }
  start() {
    this.begin();
    const ifn = this.ifname || this.l3.ifaces().find(i => i.name !== 'lo')?.name;
    this.ifname = ifn;
    const myIp = this.l3.ifIp(ifn);
    if (!ifn || !myIp) { this.dev.print('arping: no interface with an IP address'); return this.end(); }
    const flag = { normal: '', gratuitous: '-U ', reply: '-A ', dad: '-D ' }[this.mode];
    this.dev.print(`$ arping ${flag}-c ${this.count} -I ${ifn} ${this.target}`);
    this.dev.print(`ARPING ${this.target} from ${this.mode === 'dad' ? '0.0.0.0' : myIp} ${ifn}`);
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
      this.dev.record('info', this.mode === 'gratuitous' || this.mode === 'reply' ? `announces ${myIp} at ${mac} unsolicited (gratuitous ARP)` : this.mode === 'dad' ? `checks via ARP probe whether ${this.target} is already in use` : `asks for ${this.target} via arping`,
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
    this.dev.print(`Sent ${this.sent} probes${this.mode === 'gratuitous' || this.mode === 'reply' ? '' : `, received ${this.replies} responses`}`);
    if (this.mode === 'dad') this.dev.print(this.replies ? `Address ${this.target} is already in use (conflict).` : `Address ${this.target} is free.`);
    this.dev.record(this.mode === 'dad' && this.replies ? 'err' : 'ok', `arping finished (${this.mode})`, { tag: 'arping-done', data: { mode: this.mode, target: this.target, replies: this.replies } });
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
      this.dev.record('err', `TCP connection to ${this.dst}:${this.port}: no answer to SYN (filtered?)`, { tag: 'tcp-timeout', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    const wait = T.tcpSyn[this.tries++];
    this.dev.record('info', `opens a TCP connection to ${this.dst}:${this.port}: SYN${this.tries > 1 ? ' (retry ' + (this.tries - 1) + ')' : ''}`, { tag: 'tcp-syn-sent', data: { dst: this.dst, port: this.port } });
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
      this.dev.record('err', `${this.dst}:${this.port} refuses (RST): port closed or connection rejected`, { tag: 'tcp-refused', data: { dst: this.dst, port: this.port } });
      return this.finish(false);
    }
    if (this.state === 'SYN_SENT' && s.flags.SYN && s.flags.ACK && s.ack === this.iss + 1) {
      this.sim.cancel(this.timer);
      this.rcvNxt = s.seq + 1; this.sndNxt = this.iss + 1; this.peerMss = s.mss;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.setState('ESTABLISHED');
      this.dev.record('ok', `Three-way handshake with ${this.dst}:${this.port} complete (ESTABLISHED)`, { tag: 'tcp-established', data: { dst: this.dst, port: this.port, client: true } });
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
        this.dev.print(`${this.bytes} bytes received in ${this.segments} segment${this.segments > 1 ? 's' : ''} (MSS ${Math.max(...[s.dataLen, this.firstLen || 0])})`);
        this.close();
      }
      this.firstLen ??= s.dataLen;
      return;
    }
    if (this.state === 'FIN_WAIT' && s.flags.FIN) {
      this.rcvNxt += 1;
      this.l3.sendTcp(this.dst, tcp(this.lport, this.port, this.sndNxt, this.rcvNxt, { ACK: true }));
      this.dev.record('ok', `Connection to ${this.dst}:${this.port} closed cleanly`, { tag: 'tcp-closed', data: { client: true } });
      this.finish(true);
    }
  }
  armStall() {
    this.sim.cancel(this.timer);
    this.timer = this.sim.schedule(T.tcpStall, () => {
      if (this.done || this.state !== 'ESTABLISHED') return;
      this.dev.print(`curl: (28) Operation timed out after ${T.tcpStall} milliseconds with ${this.bytes} bytes received`);
      this.dev.record('err', `Connection to ${this.dst}:${this.port} is up, but the response does not arrive (${this.bytes} bytes received)`, { tag: 'tcp-stalled', data: { dst: this.dst, port: this.port, bytes: this.bytes } });
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
    const txt = l4.type === 11 ? 'TTL exceeded' : l4.code === 13 ? 'Communication administratively prohibited' : l4.code === 3 ? 'Connection refused' : 'No route to host';
    this.dev.print(`${this.tool}: ${this.dst} port ${this.port}: ${txt} (ICMP from ${ip.src})`);
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
    this.dev.record(ok ? 'ok' : 'err', `${this.tool} ${this.dst}:${this.port} finished`, { tag: 'tcp-done', data: { dst: this.dst, port: this.port, ok: !!ok, bytes: this.bytes, segments: this.segments, mode: this.mode } });
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
    this.dev.record('info', `asks ${this.server} via DNS (UDP 53) for ${this.name}`, { tag: 'dns-query', data: { name: this.name } });
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
    this.dev.record(ok ? 'ok' : 'err', ok ? `DNS: ${this.name} is ${answer}` : `DNS lookup ${this.name} without result`, { tag: 'dns-done', data: { name: this.name, ok, answer } });
    if (this.then) { if (answer) this.dev.print(`${this.name} → ${answer} (DNS via ${this.server})`); this.then(answer); }
  }
}

class UdpSend extends Session {
  constructor(l3, dst, port, len) { super(l3); Object.assign(this, { dst, port, len }); this.sport = 49152 + Math.floor(this.sim.random() * 16000); }
  start() {
    this.begin();
    this.dev.print(`$ echo test | nc -u -w1 ${this.dst} ${this.port}`);
    const res = this.l3.output(ipPacket({ src: this.l3.srcFor(this.dst), dst: this.dst, proto: PROTO.UDP, l4: udp(this.sport, this.port, { kind: 'data', len: this.len }) }), {});
    if (!res.ok) { this.dev.print(`nc: ${res.error}`); return this.end(); }
    this.dev.print(`${this.len} bytes sent as a UDP datagram. UDP does not wait for any acknowledgment.`);
    this.sim.schedule(2000, () => this.end());
  }
  onIcmpError(ip) { const o = ip.l4.orig; if (!o || o.sport !== this.sport || this.done) return; this.dev.print(`Note: received ICMP ${icmpName(ip.l4.type, ip.l4.code)} from ${ip.src}`); this.end(); }
}

// ---------------------------------------------------------------- Hosts and routers
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
    if (!isIp(this.cfg.resolver)) { this.print(`${name}: no DNS server configured`); this.record('err', `cannot resolve ${name}: no DNS server configured`, { tag: 'dns-no-resolver' }); return cb(null); }
    const s = new DigSession(this.l3, this.cfg.resolver, name, cb); s.start(); return s;
  }
  udpSend(dst, port, len = 32) { const s = new UdpSend(this.l3, dst, port, len); s.start(); return s; }
}
class Router extends Host {}

// ---------------------------------------------------------------- Bridge with spanning tree
const cmpBid = (a, b) => (a.prio - b.prio) || a.mac.localeCompare(b.mac);
const cmpPort = (a, b) => { const [ap, an] = a.split('.').map(Number), [bp, bn] = b.split('.').map(Number); return (ap - bp) || (an - bn); };
function cmpVec(a, b) {
  return cmpBid(a.root, b.root) || (a.cost - b.cost) || cmpBid(a.bridge, b.bridge) || cmpPort(a.port, b.port) || (a.rx && b.rx ? cmpPort(a.rx, b.rx) : 0);
}
const ROLE_TEXT = { root: 'Root port', designated: 'Designated', alternate: 'Alternate (blocked)', disabled: 'disabled' };
const STATE_TEXT = { blocking: 'Blocking', listening: 'Listening', learning: 'Learning', forwarding: 'Forwarding', disabled: 'Disabled' };

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
      this.dev.record('drop', `${p} is in state ${STATE_TEXT[ps.state]} (STP): frame dropped`, { frame, tag: 'stp-drop', data: { port: p, state: ps.state } });
      return;
    }
    const vid = from.vid ?? this.vidIn(p, frame);
    if (vid === null) {
      this.dev.record('drop', `Frame on ${p} matches no allowed VLAN (${frame.vlan ? 'tag ' + frame.vlan.vid : 'untagged'}), dropped`, { frame, tag: 'vlan-drop', data: { port: p } });
      return;
    }
    const inner = clone(frame); inner.vlan = null;
    if (this.ageingMs > 0 && !isGroupMac(frame.src) && from.learning !== false) {
      const key = vid + '|' + frame.src;
      const old = this.fdb.get(key);
      this.fdb.set(key, { port: p, t: this.sim.time, remote: from.remote || null });
      if (!old || old.port !== p || old.remote !== (from.remote || null)) {
        const flap = old && old.port !== p && this.sim.time - old.t < 1000;
        this.dev.record('learn', flap ? `MAC flapping: ${frame.src} jumps from ${old.port} to ${p}` : `learns: ${frame.src} is in VLAN ${vid} on ${p}${from.remote ? ' (behind VTEP ' + from.remote + ')' : ''}`,
          { tag: flap ? 'mac-flap' : 'mac-learned', data: { mac: frame.src, port: p, vid, remote: from.remote || null } });
      }
    }
    if (ps && ps.state === 'learning') { this.dev.record('drop', `${p} is in state Learning: MAC learned, but frame not forwarded`, { frame, tag: 'stp-learning' }); return; }
    const e = !isGroupMac(frame.dst) && this.ageingMs > 0 ? this.entry(vid, frame.dst) : null;
    if (e && (!this.stp || e.port.startsWith('vxlan') || this.stp.ports.get(e.port)?.state === 'forwarding')) {
      if (e.port === p) { this.dev.record('drop', `Destination ${frame.dst} is on the same port ${p}, frame is filtered`, { frame, tag: 'filtered' }); return; }
      this.dev.record('fwd', `forwards to ${e.port} (MAC table: ${frame.dst})`, { frame, tag: 'switched', data: { port: e.port } });
      this.egress(e.port, inner, vid, e.remote);
      return;
    }
    // Loop detection: the same broadcast keeps coming back
    if (isGroupMac(frame.dst) || !e) {
      const n = (this.seen.get(frame.id) || 0) + 1;
      this.seen.set(frame.id, n);
      if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
      if (n === 2) this.dev.record('err', `sees the same frame (${frame.type === 'arp' ? 'ARP' : 'IP'} from ${frame.src}) for the second time: the network has a loop!`, { frame, tag: 'loop-detected' });
      if (n >= T.loopHalt) return this.sim.halt(this.dev, `Broadcast storm: ${this.dev.name} has flooded the same frame ${n} times. Ethernet has no TTL, without spanning tree it circles forever. Simulation halted.`);
    }
    const why = frame.dst === BCAST ? 'Broadcast' : isGroupMac(frame.dst) ? 'Multicast' : this.ageingMs === 0 ? 'aging 0: learns nothing, floods everything' : `destination ${frame.dst} unknown`;
    const targets = this.allPorts().filter(x => x !== p && this.carries(x, vid) && !(from.remote && x.startsWith('vxlan')));
    this.dev.record('fwd', targets.length ? `floods to ${targets.join(', ')} (${why})` : `no other port in VLAN ${vid} (${why})`, { frame, tag: 'flooded', data: { ports: targets, why } });
    for (const t of targets) this.egress(t, inner, vid, null);
  }
  egress(p, inner, vid, remote) {
    if (p.startsWith('vxlan')) return this.dev.vxlanOut(p, inner, remote);
    const c = this.portCfg(p);
    const f = clone(inner);
    if (c.mode === 'trunk' && Number(c.native) !== vid) f.vlan = { vid, pcp: 0 };
    this.dev.transmit(p, f);
  }

  // ---------- Spanning tree (IEEE 802.1D, simplified)
  timers() { return STP_PRESETS[this.cfg.stp.timers] || STP_PRESETS.standard; }
  myId() { return { prio: Number(this.cfg.stp.priority ?? 32768), mac: macFor(this.dev.id + '/bridge') }; }
  portId(p) { return `128.${PORTS.switch.indexOf(p) + 1}`; }
  physUp(p) { const l = this.sim.linkAt(this.dev.id, p); return !!l && l.up; }
  stpStart() {
    if (this.stp) return;
    this.stp = { ports: new Map(), rootPort: null, rootId: this.myId(), rootCost: 0, tcUntil: 0, lastFlush: -1e9, timer: null };
    this.dev.record('info', `starts spanning tree (bridge ID ${fmtBid(this.myId())}) and initially considers itself the root`, { tag: 'stp-start' });
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
    this.dev.record('info', 'Spanning tree turned off: all ports forward immediately', { tag: 'stp-stop' });
  }
  stpHello() {
    const now = this.sim.time, { maxAge } = this.timers();
    let changed = false;
    for (const [p, ps] of this.stp.ports) {
      if (ps.info && now - ps.info.t > maxAge * 1000) {
        ps.info = null; changed = true;
        this.dev.record('err', `${p}: no BPDU for ${maxAge} s (max age), the stored information expires`, { tag: 'stp-maxage', data: { port: p } });
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
    if (ps.edge) { ps.edge = false; ps.edgeLost = true; this.dev.record('err', `${p} is configured as an edge port but receives a BPDU: loses edge status`, { frame, tag: 'stp-edge-lost', data: { port: p } }); }
    const isNew = !ps.info || cmpBid(ps.info.root, b.root) || ps.info.cost !== b.cost || cmpBid(ps.info.bridge, b.bridge);
    ps.info = { root: b.root, cost: b.cost, bridge: b.bridge, port: b.port, age: b.age, t: this.sim.time };
    if (isNew) this.dev.record('learn', `${p} receives BPDU: root ${fmtBid(b.root)}, cost ${b.cost}, from ${fmtBid(b.bridge)}`, { frame, tag: 'stp-bpdu', data: { port: p } });
    if (b.tc && p === this.stp.rootPort && this.sim.time - this.stp.lastFlush > 5000) {
      this.stp.lastFlush = this.sim.time;
      this.fdb.clear();
      this.stp.tcUntil = Math.max(this.stp.tcUntil, this.sim.time + this.timers().fwd * 1000);
      this.dev.record('info', 'Topology change reported: MAC table flushed, addresses are learned again', { tag: 'stp-tc-flush' });
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
      this.dev.record('info', rootPort ? `new root bridge: ${fmtBid(st.rootId)}, root port ${rootPort}, cost ${st.rootCost}` : 'is now the root bridge itself', { tag: 'stp-root', data: { root: fmtBid(st.rootId), rootPort } });
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
    if (role !== prev && !initial) this.dev.record('info', `${p} becomes ${ROLE_TEXT[role]}`, { tag: 'stp-role', data: { port: p, role } });
    if (role === 'alternate') {
      if (ps.state !== 'blocking') {
        const wasFwd = ps.state === 'forwarding';
        this.sim.cancel(ps.timer); ps.state = 'blocking';
        this.dev.record('info', `${p}: state Blocking (prevents a loop)`, { tag: 'stp-state', data: { port: p, state: 'blocking' } });
        if (wasFwd) this.topologyChange();
      }
      return;
    }
    if (ps.edge && role === 'designated') {
      if (ps.state !== 'forwarding') { this.sim.cancel(ps.timer); ps.state = 'forwarding'; this.dev.record('info', `${p} is an edge port (PortFast): Forwarding immediately`, { tag: 'stp-state', data: { port: p, state: 'forwarding', edge: true } }); }
      return;
    }
    if (ps.state === 'blocking' || ps.state === 'disabled') {
      ps.state = 'listening';
      this.dev.record('info', `${p}: state Listening (${this.timers().fwd} s, not forwarding anything yet)`, { tag: 'stp-state', data: { port: p, state: 'listening' } });
      const fwd = this.timers().fwd * 1000;
      ps.timer = this.sim.schedule(fwd, () => {
        if (!this.stp || ps.state !== 'listening') return;
        ps.state = 'learning';
        this.dev.record('info', `${p}: state Learning (${this.timers().fwd} s, learns MAC addresses, not forwarding yet)`, { tag: 'stp-state', data: { port: p, state: 'learning' } });
        ps.timer = this.sim.schedule(fwd, () => {
          if (!this.stp || ps.state !== 'learning') return;
          ps.state = 'forwarding';
          this.dev.record('ok', `${p}: state Forwarding, now forwarding`, { tag: 'stp-state', data: { port: p, state: 'forwarding' } });
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
      this.dev.record('info', 'Topology change: MAC table flushed and change reported via BPDU', { tag: 'stp-tc', data: {} });
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
export const STP_TEXT = { ROLE: ROLE_TEXT, STATE: STATE_TEXT };

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
      this.record('drop', `${port}: frame with ${plen} bytes of payload is larger than the MTU ${vm} of the VXLAN interface, silently dropped (no ICMP message on layer 2)`, { frame: inner, tag: 'vxlan-mtu-drop', data: { mtu: vm, len: plen } });
      return;
    }
    const targets = remote ? [remote] : (m.flood || []).filter(isIp);
    if (!targets.length) { this.record('drop', `${port}: flood list is empty, frame goes to no VTEP`, { frame: inner, tag: 'vxlan-no-flood' }); return; }
    const src = this.localIp();
    for (const t of targets) {
      const pkt = ipPacket({ src, dst: t, proto: PROTO.UDP, df: false, trace: traceOf(inner) ?? undefined,
        l4: udp(hashFlow(inner.src + inner.dst + (inner.type === 'ipv4' ? inner.payload.src + inner.payload.dst + inner.payload.proto : 'arp')),
          Number(m.dstport || VXLAN_PORT), { kind: 'vxlan', vni: Number(m.vni), frame: clone(inner) }) });
      this.record('info', `encapsulates in VXLAN (VNI ${m.vni}) and sends ${remote ? 'via unicast' : 'via head-end replication'} to VTEP ${t}`, { frame: ethFrame(this.mac('eth1'), '00:00:00:00:00:00', 'ipv4', pkt), tag: 'vxlan-encap', data: { vni: Number(m.vni), dst: t } });
      this.l3.output(pkt, {});
    }
  }
  onUdp(ip) {
    const l4 = ip.l4;
    if (l4.payload?.kind !== 'vxlan') return false;
    const onPort = this.maps().filter(m => Number(m.dstport || VXLAN_PORT) === l4.dport);
    if (!onPort.length) return false;
    const m = onPort.find(x => Number(x.vni) === l4.payload.vni);
    if (!m) { this.record('drop', `Received VXLAN with VNI ${l4.payload.vni} from ${ip.src}, but no segment with this VNI: dropped`, { tag: 'vxlan-vni-unknown', data: { vni: l4.payload.vni } }); return true; }
    this.record('info', `decapsulates VXLAN from ${ip.src} (VNI ${m.vni} → VLAN ${m.vlan})`, { tag: 'vxlan-decap', data: { vni: Number(m.vni), from: ip.src } });
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
// Frame builder: stack layers freely, check rules, compute sizes
import { h } from './ui.js';

const BLOCKS = {
  eth: { name: 'Ethernet', size: 14, kind: 'eth', note: 'Destination MAC, source MAC, EtherType' },
  vlan: { name: '802.1Q tag', size: 4, kind: 'vlan', note: 'TPID 0x8100, PCP, DEI, VID' },
  arp: { name: 'ARP', size: 28, kind: 'arp', note: 'Request or reply' },
  stp: { name: 'BPDU (with LLC)', size: 38, kind: 'stp', note: 'Spanning tree: root ID, cost, bridge ID, timers' },
  ip: { name: 'IPv4', size: 20, kind: 'ip', note: 'TTL, protocol, addresses' },
  icmp: { name: 'ICMP', size: 8, kind: 'icmp', note: 'Echo, Unreachable, Time Exceeded' },
  udp: { name: 'UDP', size: 8, kind: 'udp', note: 'Ports, length, checksum' },
  tcp: { name: 'TCP', size: 20, kind: 'tcp', note: 'Ports, sequence, flags (without options)' },
  vxlan: { name: 'VXLAN', size: 8, kind: 'vxlan', note: 'Flags, VNI' },
  data: { name: 'Data', size: null, kind: 'data', note: 'Application payload' }
};
const PRESETS = {
  'Ping': ['eth', 'ip', 'icmp', 'data'],
  'ARP request': ['eth', 'arp'],
  'Ping in VLAN 10': ['eth', 'vlan', 'ip', 'icmp', 'data'],
  'DNS over UDP': ['eth', 'ip', 'udp', 'data'],
  'TCP SYN': ['eth', 'ip', 'tcp'],
  'BPDU': ['eth', 'stp'],
  'Ping over VXLAN': ['eth', 'ip', 'udp', 'vxlan', 'eth', 'ip', 'icmp', 'data']
};

function validate(seq) {
  const msgs = [], bad = new Set();
  const err = (i, m) => { bad.add(i); msgs.push(m); };
  if (!seq.length) return { msgs: ['Drag layers into the tray. Whatever goes onto the wire first is at the very front.'], bad, ok: false, empty: true };
  if (seq[0] !== 'eth') err(0, 'A frame always starts with the Ethernet header.');
  for (let i = 0; i < seq.length; i++) {
    const b = seq[i], prev = seq[i - 1], next = seq[i + 1];
    if (b === 'vlan' && prev !== 'eth') err(i, 'The 802.1Q tag follows directly after the Ethernet header (after the source MAC).');
    if (b === 'eth' && i > 0 && prev !== 'vxlan') err(i, 'A second Ethernet header only makes sense after a VXLAN header (inner frame).');
    if ((b === 'ip' || b === 'arp') && !['eth', 'vlan'].includes(prev)) err(i, `${BLOCKS[b].name} belongs directly in the Ethernet frame (EtherType).`);
    if (b === 'arp' && next) err(i + 1, 'ARP has no further payload, nothing follows it.');
    if (b === 'stp' && !['eth', 'vlan'].includes(prev)) err(i, 'A BPDU sits directly in the Ethernet frame (802.3 with LLC).');
    if (b === 'stp' && next) err(i + 1, 'Nothing follows the BPDU.');
    if (['icmp', 'udp', 'tcp'].includes(b) && prev !== 'ip') err(i, `${BLOCKS[b].name} is carried in an IP packet (protocol field).`);
    if (b === 'vxlan' && prev !== 'udp') err(i, 'VXLAN is carried in UDP (destination port 4789).');
    if (b === 'vxlan' && next !== 'eth') err(i, 'The inner Ethernet frame follows the VXLAN header.');
    if (b === 'data' && !['udp', 'tcp', 'icmp'].includes(prev)) err(i, 'Application data is carried in UDP, TCP or ICMP.');
    if (b === 'data' && next) err(i + 1, 'Only the FCS comes after the data.');
    if (b === 'vlan' && seq.filter(x => x === 'vlan').length > 2) err(i, 'More than two tags (QinQ) are unusual.');
  }
  return { msgs: msgs.length ? msgs : ['Valid frame.'], bad, ok: !msgs.length };
}

export function renderFrameBuilder(root) {
  let seq = [...PRESETS['Ping']];
  let dataLen = 56;
  let dragFrom = null;
  const pal = h('div', { class: 'fb-pal' });
  for (const [k, b] of Object.entries(BLOCKS)) {
    const el = h('div', { class: 'fb-blk', draggable: 'true', style: { '--lc': `var(--l-${b.kind})` }, tabindex: '0', role: 'button', title: `${b.note}. Click to append at the end.` },
      b.name, h('span', { class: 'sz' }, b.size === null ? 'variable' : `${b.size} B`));
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
  const presetRow = h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Templates:'),
    ...Object.keys(PRESETS).map(n => h('button', { class: 'btn', onclick: () => { seq = [...PRESETS[n]]; draw(); } }, n)),
    h('button', { class: 'btn ghost', onclick: () => { seq = []; draw(); } }, 'Clear'));

  function draw() {
    drop.innerHTML = '';
    const v = validate(seq);
    seq.forEach((k, i) => {
      const b = BLOCKS[k];
      const size = b.size ?? dataLen;
      const cell = h('div', { class: `fb-cell bg-${b.kind}${v.bad.has(i) ? ' bad' : ''}`, draggable: 'true', 'data-i': i,
        style: { flex: `${Math.max(1, Math.log2(size + 2))} 0 auto` } },
        h('span', { class: 'n' }, b.name), h('span', { class: 'sz' }, `${size} bytes`),
        h('button', { title: 'remove', 'aria-label': `Remove ${b.name}`, onclick: () => { seq.splice(i, 1); draw(); } }, '✕'));
      cell.addEventListener('dragstart', () => { dragFrom = i; });
      drop.append(cell);
    });
    if (v.empty) drop.append(h('div', { class: 'muted', style: { alignSelf: 'center', padding: '0 8px' } }, 'Drop here'));
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
      stat(`${total} B`, 'Frame without FCS (as tcpdump shows it)'),
      stat(`${frameLen} B`, total + 4 < 64 ? `with FCS, padded to 64 bytes (${64 - total - 4} bytes of padding)` : 'with FCS'),
      stat(`${wire} B`, 'on the wire with preamble, SFD and inter-frame gap'),
      stat(`${payload} B`, mtuOk ? 'payload of the outer frame, fits in MTU 1500' : 'payload over 1500: needs a larger MTU (jumbo)'),
      stat(useful ? `${(useful / wire * 100).toFixed(1)} %` : '0 %', 'share of application data on the wire'));
    if (!mtuOk) stats.lastChild.previousSibling.style.borderColor = 'var(--err)';
  }
  root.append(h('div', { class: 'page' },
    h('h1', {}, 'Frame builder'),
    h('p', { class: 'muted' }, 'Stack headers into a frame and see right away whether the order is correct and how much space each layer takes.'),
    presetRow,
    h('div', { class: 'fb' }, pal, h('div', {},
      drop,
      h('div', { class: 'row', style: { marginTop: '10px' } }, h('label', { class: 'field' }, 'Data size (bytes)', dataIn),
        h('span', { class: 'small muted', style: { maxWidth: '52ch' } }, 'Tip: with "Ping over VXLAN" and 1472 bytes of data you can see why the underlay needs 1550 bytes.')),
      msgs, stats))));
  draw();
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/icons.js" <<'__PACKETPILOT_FILE_END__'
// Custom line icons, 24x24, stroke=currentColor
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

// Device symbols for the network diagram (40x40, own colors via CSS)
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
// Packet inspector: layers, fields, byte bar
import { dissect, summary } from './packets.js';
import { frameLen, frameWireLen } from './net.js';
import { h, esc } from './ui.js';

export function renderInspector(el, entry, { onTrace } = {}) {
  el.innerHTML = '';
  if (!entry || !entry.frame) {
    el.append(h('div', { class: 'empty' }, 'Click a packet in the network diagram or a row in the log to take it apart layer by layer.'));
    return;
  }
  const f = entry.frame;
  const layers = dissect(f);
  const total = frameLen(f);
  el.append(h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, summary(f)));
  el.append(h('div', { class: 'muted small' },
    `${entry.dev ? entry.dev + ', ' : ''}t = ${(entry.t / 1000).toFixed(4)} s, ${total} bytes without FCS, ${frameWireLen(f)} bytes in the frame with FCS`));
  const bar = h('div', { class: 'bytebar', title: 'Share of each layer in the frame size' });
  for (const l of layers) bar.append(h('i', { class: `bg-${l.kind}`, style: { flex: `${Math.max(l.bytes, 1)} 0 0` }, title: `${l.name}: ${l.bytes} bytes` }));
  el.append(bar, h('div', { class: 'bytelegend' }, h('span', {}, '0'), h('span', {}, `${total} bytes`)));
  if (entry.trace && onTrace) el.append(h('div', { class: 'row', style: { margin: '6px 0' } },
    h('button', { class: 'btn', onclick: () => onTrace(entry.trace) }, 'Trace this packet\'s path')));
  for (const l of layers) {
    const d = h('details', { class: `layer lc-${l.kind}${l.depth ? ' inner' : ''}`, open: l.depth === 0 && ['ip', 'arp', 'vxlan', 'icmp'].includes(l.kind) ? true : null });
    d.append(h('summary', {}, l.name, h('span', { class: 'b' }, `${l.bytes} bytes`)));
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
// Lab: network diagram editor, animation, side panel, log and inspector
import { Sim, PORTS, TYPE_NAMES, TIMING, newId, normalizeDevice, traceOf, STP_TEXT } from './engine.js';
import { layerKinds, shortLabel } from './packets.js';
import { isIp } from './net.js';
import { h, svgEl, toast, iconBtn } from './ui.js';
import { I, DEV_ICON } from './icons.js';
import { renderInspector } from './inspector.js';
import { configPanel, tablesPanel, consolePanel } from './panels.js';

const CARD_W = 76, CARD_H = 60;
const NAME_PREFIX = { pc: 'pc', server: 'srv', router: 'r', switch: 'sw', vtep: 'vtep' };
export const ZONE_COLORS = [['blue', 'Blue'], ['violet', 'Violet'], ['green', 'Green'], ['orange', 'Orange'], ['pink', 'Pink'], ['yellow', 'Yellow'], ['gray', 'Gray']];
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
    this.load(opts.topo || { name: 'New network', devices: [], links: [] }, true);
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

  // ------------------------------------------------------------ Structure
  build() {
    const o = this.opts;
    this.root.innerHTML = '';
    this.el = h('div', { class: `lab${o.compact ? ' compact' : ''}${this.canEditTopo ? '' : ' no-palette'}` });
    // Palette
    this.palette = h('div', { class: 'palette', 'aria-label': 'Devices' });
    if (this.canEditTopo) {
      for (const t of o.palette) {
        const it = h('button', { class: 'pal-item', draggable: 'true', title: `Add ${TYPE_NAMES[t]} (drag or click)` },
          h('span', { html: `<svg viewBox="0 0 40 40">${DEV_ICON[t]}</svg>` }), TYPE_NAMES[t]);
        it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pp-device', t); e.dataTransfer.effectAllowed = 'copy'; });
        it.addEventListener('click', () => this.addDevice(t));
        this.palette.append(it);
      }
      this.palette.append(h('div', { class: 'pal-sep' }));
      this.cableBtn = h('button', { class: 'pal-item', title: 'Draw a cable: click one device, then the second (key K)', html: `<span>${I.cable}</span>Cable`,
        onclick: () => this.setConnect(!this.connectMode) });
      this.palette.append(this.cableBtn);
      const area = h('button', { class: 'pal-item', draggable: 'true', title: 'Area for organizing: colored rectangle with a label (drag or click)', html: `<span>${I.area}</span>Area` });
      area.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pp-device', 'zone'); e.dataTransfer.effectAllowed = 'copy'; });
      area.addEventListener('click', () => this.addZone());
      this.palette.append(area);
    }
    // Canvas
    this.canvasWrap = h('div', { class: 'canvas-wrap' });
    this.svg = svgEl('svg', { class: `net${this.canEditTopo ? '' : ' ro'}`, role: 'img', 'aria-label': 'Network diagram' });
    this.gZones = svgEl('g'); this.gLinks = svgEl('g'); this.gDevs = svgEl('g'); this.gPkts = svgEl('g');
    this.svg.append(this.gZones, this.gLinks, this.gDevs, this.gPkts);
    this.canvasWrap.append(this.svg);
    this.bindCanvas();
    // Player
    this.playBtn = iconBtn(I.pause, 'Pause (space)', () => this.setPlaying(!this.playing));
    this.timeEl = h('span', { class: 'time' }, 't = 0.0000 s');
    const speed = h('input', { type: 'range', min: '0', max: '100', value: String(this.speedToSlider(this.msPerHop)), 'aria-label': 'Speed' });
    this.speedLbl = h('span', { class: 'speedlbl' });
    speed.addEventListener('input', () => { this.msPerHop = this.sliderToSpeed(Number(speed.value)); this.showSpeed(); });
    this.showSpeed();
    this.player = h('div', { class: 'player' },
      h('div', { class: 'bar' }, this.playBtn,
        iconBtn(I.step, 'Next event (right arrow)', () => this.stepOnce()),
        iconBtn(I.ffwd, 'Fast-forward 5 seconds without animation (e.g. for STP timers)', () => this.fastForward(5000)),
        iconBtn(I.reset, 'Reset state: clear tables, packets and log', () => this.resetState()),
        this.timeEl),
      h('div', { class: 'bar' }, h('span', { class: 'speedlbl', style: { paddingLeft: '6px' } }, 'Speed'), speed, this.speedLbl),
      this.bpduBar = h('div', { class: 'bar hidden' }, this.bpduBtn = h('button', { class: 'tog on', title: 'Show or hide BPDUs in the network diagram', onclick: () => this.toggleBpdu() }, 'BPDUs')),
      h('span', { class: 'grow' }),
      h('div', { class: 'bar' }, iconBtn(I.fit, 'Fit view', () => this.fit(true))));
    this.canvasWrap.append(this.player);
    this.overlay = h('div', { class: 'hint-overlay hidden' });
    this.stormEl = h('div', { class: 'storm hidden', role: 'alert' });
    this.canvasWrap.append(this.overlay, this.stormEl);
    // Side panel
    this.side = h('div', { class: 'side' });
    // Dock
    this.logEl = h('div', { class: 'log', role: 'log' });
    this.filterSel = h('select', { class: 'input', 'aria-label': 'Filter log' });
    this.filterSel.addEventListener('change', () => { this.logFilter = this.filterSel.value; if (this.logFilter !== 'trace') this.setTrace(null); this.renderLog(); });
    this.inspEl = h('div', { class: 'inspector' });
    this.dock = h('div', { class: 'dock' },
      h('div', { class: 'dock-col' }, h('div', { class: 'dock-head' }, 'Events', h('span', { class: 'grow' }), this.filterSel,
        iconBtn(I.trash, 'Clear log', () => { this.sim.log = []; this.renderLog(); })), this.logEl),
      h('div', { class: 'dock-col' }, h('div', { class: 'dock-head' }, 'Packet inspector'), this.inspEl));
    this.el.append(this.palette, this.canvasWrap, this.side, this.dock);
    this.root.append(this.el);
    renderInspector(this.inspEl, null);
  }
  speedToSlider(ms) { return Math.round(100 - (Math.log(ms / 60) / Math.log(4000 / 60)) * 100); }
  sliderToSpeed(v) { return Math.round(60 * Math.pow(4000 / 60, (100 - v) / 100)); }
  showSpeed() { this.speedLbl.textContent = `${(this.msPerHop / 1000).toFixed(this.msPerHop < 1000 ? 2 : 1)} s per cable`; }

  // ------------------------------------------------------------ Loading
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
    toast('State reset: ARP and MAC tables are empty');
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

  // ------------------------------------------------------------ Drawing the network diagram
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
        // Pointing down: pass below the device's name and address
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
        const tt = svgEl('title'); tt.textContent = `${P.name} ${end.if}: ${STP_TEXT.ROLE[ps.role]}, ${STP_TEXT.STATE[ps.state]}${ps.edge ? ', edge port' : ''}`;
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
      if (st) { const t = svgEl('text', { class: 'stpbadge', x: CARD_W / 2, y: CARD_H + 28 }); t.textContent = st.isRoot ? `Root bridge, prio ${d.stp.priority}` : `STP, Prio ${d.stp.priority}`; g.append(t); }
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
      return sub ? `${sub} Subinterface${sub > 1 ? 's' : ''}` : n ? `${n} addresses` : '';
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

  // ------------------------------------------------------------ Interaction
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
    if (!pa || !pb) { toast(`${!pa ? A.name : B.name} has no free port left`); this.connectFrom = null; this.render(); return; }
    const l = this.sim.addLink({ id: newId('l'), a: { dev: a, if: pa }, b: { dev: b, if: pb }, mtu: 1500, up: true });
    this.connectFrom = null;
    toast(`${A.name} ${pa} ↔ ${B.name} ${pb} connected`);
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
  // ------------------------------------------------------------ Areas
  zoneEl(z) {
    const sel = this.sel?.kind === 'zone' && this.sel.id === z.id;
    const g = svgEl('g', { class: `zone-g c-${zoneColor(z)}${sel ? ' sel' : ''}`, 'data-id': z.id });
    g.append(svgEl('rect', { class: 'zone', x: z.x, y: z.y, width: z.w, height: z.h, rx: 14 }));
    const label = z.label || 'Area';
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
    const z = { id: newId('z'), x: Math.round((x - w / 2) / 12) * 12, y: Math.round((y - hh / 2) / 12) * 12, w, h: hh, label: `Area ${(this.sim.topo.zones || []).length + 1}`, color };
    this.sim.topo.zones.push(z);
    this.render();
    this.select({ kind: 'zone', id: z.id });
    this.emit('added', z);
  }
  renderZoneSide() {
    const z = this.sim.topo.zones.find(x => x.id === this.sel.id);
    if (!z) { this.sel = null; return this.renderSide(); }
    const name = h('input', { class: 'input', value: z.label || '', placeholder: 'e.g. VLAN 10, office, underlay', disabled: this.canEditTopo ? null : true });
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
    this.side.append(h('div', { class: 'side-head' }, h('span', { html: I.area }), h('div', { class: 'grow', style: { fontWeight: 650 } }, 'Area'),
      this.canEditTopo ? iconBtn(I.trash, 'Remove area (Del), the devices stay', () => this.deleteSelected(), 'danger') : null), h('div'),
      h('div', { class: 'side-body' },
        h('h4', {}, 'Label'), name,
        h('h4', {}, 'Color'), sw,
        h('h4', {}, 'Contents'),
        h('p', { class: 'small' }, inside.length ? inside.map(d => d.name).join(', ') : 'No devices in this area.'),
        h('p', { class: 'small muted' }, 'Areas are only for organizing and have no effect on the simulation. Move them by the tab (devices inside move along), resize them at the bottom right corner.')));
  }

  deleteSelected() {
    if (!this.canEditTopo || !this.sel) return;
    if (this.sel.kind === 'zone') { this.sim.topo.zones = this.sim.topo.zones.filter(z => z.id !== this.sel.id); this.select(null); this.render(); this.emit('deleted'); return; }
    if (this.sel.kind === 'dev') { const n = this.sim.dev(this.sel.id)?.name; this.sim.removeDevice(this.sel.id); toast(`${n} removed`); }
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
    if (this.connectMode) msg = this.connectFrom ? 'Now click the second device' : 'Cable: click the first device (Esc cancels)';
    else if (!this.sim.topo.devices.length && this.canEditTopo) msg = 'Drag devices from the left bar onto the canvas';
    this.overlay.textContent = msg;
    this.overlay.classList.toggle('hidden', !msg);
  }

  // ------------------------------------------------------------ Side panel
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
        h('div', { style: { fontWeight: 650 } }, this.sim.topo.name || 'Network'),
        h('div', { class: 'small muted' }, `${this.sim.topo.devices.length} devices, ${this.sim.topo.links.length} cables`))));
      side.append(h('div'));
      side.append(h('div', { class: 'side-body' },
        h('h4', {}, 'How to use the lab'),
        h('ul', { class: 'small', style: { paddingLeft: '18px', margin: 0, display: 'grid', gap: '6px' } },
          this.canEditTopo ? h('li', {}, 'Drag devices from the left bar onto the canvas.') : null,
          this.canEditTopo ? h('li', {}, 'Cable (key K): click one device, then the second. Free ports are chosen automatically.') : null,
          this.canEditTopo ? h('li', {}, 'Areas organize the canvas: colored rectangles with a label, move them by the tab, resize them at the corner.') : null,
          h('li', {}, 'Click a device: configuration, tables and console appear here. Double-click opens the console directly.'),
          h('li', {}, 'Type e.g. ping 10.0.0.2 in the console and watch the packets travel.'),
          h('li', {}, 'Space pauses time, the right arrow advances one event. The speed slider sets the slow motion.'),
          h('li', {}, 'Clicking a packet takes it apart into its layers in the packet inspector.')),
        h('h4', {}, 'Layer colors'),
        h('div', { class: 'row small' }, ...[['eth', 'Ethernet'], ['vlan', '802.1Q'], ['arp', 'ARP'], ['stp', 'STP'], ['ip', 'IPv4'], ['icmp', 'ICMP'], ['udp', 'UDP'], ['tcp', 'TCP'], ['vxlan', 'VXLAN']]
          .map(([k, n]) => h('span', { class: 'chip' }, h('i', { class: `bg-${k}`, style: { width: '10px', height: '10px', borderRadius: '2px', display: 'inline-block' } }), n)))));
      return;
    }
    if (this.sel.kind === 'link') return this.renderLinkSide();
    if (this.sel.kind === 'zone') return this.renderZoneSide();
    const dev = this.sim.dev(this.sel.id);
    if (!dev) { this.sel = null; return this.renderSide(); }
    const nameIn = h('input', { class: 'name', value: dev.name, 'aria-label': 'Device name', disabled: this.canEditTopo ? null : true });
    nameIn.addEventListener('change', () => {
      const v = nameIn.value.trim().replace(/\s+/g, '-');
      if (!v || this.sim.topo.devices.some(d => d !== dev.cfg && d.name === v)) { nameIn.value = dev.name; return toast('Name empty or already taken'); }
      dev.cfg.name = v; this.render(); this.emit('renamed');
    });
    side.append(h('div', { class: 'side-head' },
      h('span', { class: 'devglyph', html: `<svg viewBox="0 0 40 40" width="34" height="34">${DEV_ICON[dev.type]}</svg>` }),
      h('div', { class: 'grow' }, nameIn, h('div', { class: 'small muted', style: { paddingLeft: '5px' } }, TYPE_NAMES[dev.type])),
      this.canEditTopo ? iconBtn(I.trash, 'Remove device (Del)', () => this.deleteSelected(), 'danger') : null));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const [k, label, icon] of [['config', 'Configuration', I.sliders], ['tables', 'Tables', I.table], ['console', 'Console', I.terminal]]) {
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
    up.addEventListener('change', () => { this.sim.setLinkUp(l, up.checked); this.render(); this.emit('config', { link: l.id, msg: up.checked ? 'Link on' : 'Link off' }); });
    this.side.append(h('div', { class: 'side-head' }, h('span', { html: I.cable }), h('div', { class: 'grow', style: { fontWeight: 650 } }, 'Cable'),
      this.canEditTopo ? iconBtn(I.trash, 'Remove cable (Del)', () => this.deleteSelected(), 'danger') : null), h('div'),
      h('div', { class: 'side-body' },
        h('dl', { class: 'kv' }, h('dt', {}, 'Side A'), h('dd', {}, `${A.name} ${l.a.if}`), h('dt', {}, 'Side B'), h('dd', {}, `${B.name} ${l.b.if}`)),
        h('h4', {}, 'MTU (payload bytes per frame)'), mtu,
        h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'Both ends use this MTU. Frames with a larger payload are lost on this cable.'),
        h('label', { class: 'row', style: { marginTop: '10px' } }, up, 'Link up (cable plugged in)')));
  }

  // ------------------------------------------------------------ Log
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
    const opts = [['all', 'All events'], ['nosend', 'Decisions only']];
    if (this.sim.topo.devices.some(d => d.type === 'switch' && d.stp?.enabled) || this.logFilter === 'stp' || this.logFilter === 'bpdu') opts.push(['stp', 'Spanning tree only'], ['bpdu', 'Everything, including BPDUs sent']);
    if (this.traceId) opts.push(['trace', 'Traced packet']);
    for (const d of this.sim.topo.devices) opts.push(['dev:' + d.id, `Only ${d.name}`]);
    this.filterSel.innerHTML = '';
    for (const [v, t] of opts) this.filterSel.append(h('option', { value: v, selected: v === this.logFilter ? true : null }, t));
    this.logEl.innerHTML = '';
    const list = this.sim.log.filter(e => this.logVisible(e)).slice(-600);
    if (!list.length) this.logEl.append(h('div', { class: 'empty', style: { padding: '10px' } }, 'Nothing has happened yet. Open the console of a device and send a ping.'));
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
    if (t) { this.logFilter = 'trace'; toast('The log now shows only this packet, the devices involved are highlighted'); }
    else if (this.logFilter === 'trace') this.logFilter = 'all';
    this.render(); this.renderLog();
  }

  // ------------------------------------------------------------ Time and animation
  setPlaying(p) {
    this.playing = p;
    this.playBtn.innerHTML = p ? I.pause : I.play;
    this.playBtn.title = p ? 'Pause (space)' : 'Play (space)';
  }
  stepOnce() {
    this.setPlaying(false);
    if (!this.sim.step()) toast('No further events');
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
    if (this.sim.halted) return toast('The simulation is halted. Reset the state.');
    this.sim.runFor(ms);
    this.drawPackets();
    this.render();
    if (this.tab === 'tables') this.renderSide();
    toast(`Fast-forwarded ${ms / 1000} s, now t = ${(this.sim.time / 1000).toFixed(1)} s`);
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
    this.stormEl.append(h('div', {}, h('b', {}, 'Simulation halted. '), info.text),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => this.resetState() }, 'Reset state'),
        h('span', { class: 'small muted' }, 'Then remove the loop or turn on spanning tree.')));
  }

  // ------------------------------------------------------------ Helpers for lessons
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
// Static preview of a topology and the live mini simulation on the home page
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

/** Live simulation: pc1 pings in a loop through a router */
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
// Helper functions for addresses and packet sizes. No DOM, also usable in Node.

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

// Stable MAC from a name (containerlab style aa:c1:ab:xx:xx:xx)
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

// ---------- Sizes ----------
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
/** Length from destination MAC to end of payload, without FCS (as tcpdump shows it) */
export function frameLen(f) {
  return ETH_HDR + (f.vlan ? VLAN_TAG : 0) + framePayloadLen(f);
}
export function framePayloadLen(f) {
  if (f.type === 'arp') return ARP_LEN;
  if (f.type === 'ipv4') return f.payload.totalLength;
  if (f.type === 'stp') return LLC_LEN + BPDU_LEN;
  return f.payload?.len || 0;
}
/** On the wire: with FCS and padding to 64 bytes */
export function frameWireLen(f) { return Math.max(64, frameLen(f) + FCS); }

export function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/packets.js" <<'__PACKETPILOT_FILE_END__'
// Building, describing and dissecting frames
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
export const tcpFlags = f => ['SYN', 'FIN', 'RST', 'PSH', 'ACK'].filter(k => f[k]).join(', ') || 'none';
export const fmtBid = b => b ? `${b.prio}.${b.mac}` : '';

// Simplified but deterministic header checksum (changes with TTL)
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
  '0/0': 'Echo Reply', '8/0': 'Echo Request', '11/0': 'Time Exceeded (TTL expired)',
  '3/0': 'Destination Unreachable: Network Unreachable', '3/1': 'Destination Unreachable: Host Unreachable',
  '3/3': 'Destination Unreachable: Port Unreachable', '3/4': 'Destination Unreachable: Fragmentation Needed',
  '3/13': 'Destination Unreachable: Communication Administratively Prohibited'
};
export function icmpName(t, c) { return ICMP_NAMES[`${t}/${c}`] || `Type ${t} code ${c}`; }

/** Short label for the animation */
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
/** Layers from outside to inside, for the stripes on the packet */
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

/** One-line description in the style of tcpdump */
export function summary(f) {
  const tag = f.vlan ? `vlan ${f.vlan.vid}, ` : '';
  if (f.type === 'stp') {
    const b = f.payload;
    return `STP BPDU: Root ${fmtBid(b.root)}, cost ${b.cost}, from bridge ${fmtBid(b.bridge)} port ${b.port}${b.tc ? ', topology change' : ''}`;
  }
  if (f.type === 'arp') {
    const a = f.payload;
    if (a.spa === a.tpa) return `${tag}Gratuitous ARP ${a.op === 1 ? 'Request' : 'Reply'}: ${a.spa} is at ${a.sha}`;
    if (a.spa === '0.0.0.0') return `${tag}ARP probe: is anyone using ${a.tpa}?`;
    return a.op === 1 ? `${tag}ARP Request: who has ${a.tpa}? Tell ${a.spa}`
      : `${tag}ARP Reply: ${a.spa} is at ${a.sha}`;
  }
  const ip = f.payload;
  const base = `${ip.src} > ${ip.dst}`;
  if (ip.frag && !ip.frag.first) return `${tag}IP fragment ${base}, id ${ip.id}, offset ${ip.fragOffset}, ${ip.frag.len} bytes${ip.mf ? ', more follow' : ', last'}`;
  const l4 = ip.l4;
  let s;
  if (l4.kind === 'icmp') {
    if (l4.type === 8 || l4.type === 0) s = `ICMP ${l4.type === 8 ? 'Echo Request' : 'Echo Reply'} ${base}, seq ${l4.seq}, TTL ${ip.ttl}, ${ip.totalLength} bytes`;
    else s = `ICMP ${icmpName(l4.type, l4.code)}${l4.mtu ? ` (MTU ${l4.mtu})` : ''} ${base}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'vxlan') {
    s = `VXLAN ${base}, VNI ${l4.payload.vni}, UDP ${l4.sport} > ${l4.dport}  ⟶  ${summary(l4.payload.frame)}`;
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    s = d.qr ? `DNS response ${base}: ${d.qname} ${d.rcode === 'NOERROR' ? '→ ' + d.answers.map(a => a.ip).join(', ') : d.rcode}`
      : `DNS query ${base}: A ${d.qname}?`;
  } else if (l4.kind === 'udp') {
    s = `UDP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport}, TTL ${ip.ttl}`;
  } else if (l4.kind === 'tcp') {
    s = `TCP ${ip.src}.${l4.sport} > ${ip.dst}.${l4.dport} [${tcpFlags(l4.flags)}] seq ${l4.seq}${l4.flags.ACK ? ' ack ' + l4.ack : ''}${l4.dataLen ? ', ' + l4.dataLen + ' bytes of data' : ''}${l4.app ? ' (' + l4.app + ')' : ''}`;
  } else s = `IP ${base}`;
  if (ip.frag?.first) s += ` (first fragment, more follow)`;
  return tag + s;
}

function macNote(m) {
  if (m === BCAST) return 'Broadcast, to everyone in the segment';
  if (isGroupMac(m)) return 'Multicast (I/G bit = 1)';
  return isLocalMac(m) ? 'Unicast, locally administered (U/L bit = 1)' : 'Unicast, assigned by the manufacturer';
}

/** Splits a frame into layers for the packet inspector */
export function dissect(f, depth = 0) {
  const layers = [];
  const pre = depth ? 'Inner ' : '';
  if (f.type === 'stp') {
    const b = f.payload;
    layers.push({ kind: 'eth', depth, name: 'IEEE 802.3 (with length field)', bytes: ETH_HDR, fields: [
      ['Destination MAC', f.dst, 'Group address for bridges, never forwarded'], ['Source MAC', f.src, 'MAC of the sending switch port'],
      ['Length', `${LLC_LEN + BPDU_LEN} bytes`, 'No EtherType: values up to 1500 are a length']] });
    layers.push({ kind: 'stp', depth, name: 'LLC', bytes: LLC_LEN, fields: [['DSAP / SSAP', '0x42 / 0x42', 'Spanning Tree'], ['Control', '0x03', 'Unnumbered Information']] });
    layers.push({ kind: 'stp', depth, name: 'STP Configuration BPDU', bytes: BPDU_LEN, fields: [
      ['Protocol / Version', '0 / 0 (802.1D)', ''], ['Flags', b.tc ? 'Topology Change' : 'none', b.tc ? 'Receivers shorten the aging of their MAC table' : ''],
      ['Root Bridge ID', fmtBid(b.root), 'Priority.MAC of the bridge the sender believes is the root'],
      ['Root Path Cost', String(b.cost), 'Sender\'s cost to the root'],
      ['Bridge ID', fmtBid(b.bridge), 'Who is sending'], ['Port ID', b.port, 'Priority.number of the sending port'],
      ['Message Age', `${b.age} s`, ''], ['Max Age / Hello / Forward Delay', `${b.maxAge} / ${b.hello} / ${b.fwd} s`, 'Timers set by the root']] });
    return layers;
  }
  layers.push({ kind: 'eth', depth, name: `${pre}Ethernet II`, bytes: ETH_HDR, fields: [
    ['Destination MAC', f.dst, macNote(f.dst)],
    ['Source MAC', f.src, macNote(f.src)],
    ['EtherType', f.vlan ? '0x8100 (802.1Q tag follows)' : (f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)'), 'Says how to read the payload']
  ]});
  if (f.vlan) layers.push({ kind: 'vlan', depth, name: `${pre}802.1Q tag`, bytes: VLAN_TAG, fields: [
    ['TPID', '0x8100', 'Identifies the tag'],
    ['PCP (priority)', String(f.vlan.pcp || 0), '0 to 7'],
    ['DEI', '0', 'May be dropped under congestion'],
    ['VID (VLAN)', String(f.vlan.vid), 'Usable 1 to 4094'],
    ['EtherType', f.type === 'arp' ? '0x0806 (ARP)' : '0x0800 (IPv4)', '']
  ]});
  if (f.type === 'arp') {
    const a = f.payload;
    layers.push({ kind: 'arp', depth, name: `${pre}ARP ${a.op === 1 ? 'Request' : 'Reply'}`, bytes: ARP_LEN, fields: [
      ['Hardware Type', '1 (Ethernet)', ''], ['Protocol Type', '0x0800 (IPv4)', ''],
      ['Hardware / Protocol Length', '6 / 4', ''],
      ['Operation', a.op === 1 ? '1 (Request)' : '2 (Reply)', ''],
      ['Sender MAC', a.sha, ''], ['Sender IP', a.spa, ''],
      ['Target MAC', a.tha, a.op === 1 ? 'Still unknown, hence zeros' : ''], ['Target IP', a.tpa, a.spa === a.tpa ? 'Same as sender IP: gratuitous ARP' : a.spa === '0.0.0.0' ? 'Probe: sender IP 0.0.0.0' : '']
    ]});
    return layers;
  }
  const ip = f.payload;
  const flags = [ip.df ? 'DF' : null, ip.mf ? 'MF' : null].filter(Boolean).join(', ') || 'none';
  layers.push({ kind: 'ip', depth, name: `${pre}IPv4`, bytes: IP_HDR, fields: [
    ['Version / IHL', '4 / 5 (20 bytes)', ''],
    ['Total Length', `${ip.totalLength} bytes`, 'Header and payload'],
    ['Identification', String(ip.id), 'Same in all fragments of a packet'],
    ['Flags', flags, ip.df ? 'Don\'t Fragment: routers must not fragment' : 'Routers may fragment'],
    ['Fragment Offset', `${ip.fragOffset} bytes`, ''],
    ['TTL', String(ip.ttl), 'Every router subtracts 1'],
    ['Protocol', `${ip.proto} (${ip.proto === 1 ? 'ICMP' : ip.proto === 17 ? 'UDP' : ip.proto === 6 ? 'TCP' : '?'})`, ''],
    ['Header Checksum', hex4(ip.checksum), 'Recomputed at every hop'],
    ['Source IP', ip.src, 'Stays the same end to end'],
    ['Destination IP', ip.dst, '']
  ]});
  if (ip.frag && !ip.frag.first) {
    layers.push({ kind: 'frag', depth, name: 'Fragment data', bytes: ip.frag.len, fields: [
      ['Content', `${ip.frag.len} bytes`, 'Continuation of the first fragment, without its own ICMP or UDP header']] });
    return layers;
  }
  const l4 = ip.l4;
  if (l4.kind === 'icmp') {
    const fields = [['Type / Code', `${l4.type} / ${l4.code}`, icmpName(l4.type, l4.code)]];
    if (l4.type === 8 || l4.type === 0) fields.push(['Identifier / Sequence', `${l4.ident} / ${l4.seq}`, ''], ['Data', `${l4.dataLen} bytes`, '']);
    if (l4.mtu) fields.push(['Next-Hop MTU', String(l4.mtu), 'The maximum size the packet may have']);
    if (l4.orig) fields.push(['Concerns packet', `${l4.orig.src} > ${l4.orig.dst}`, 'Copy of the original header']);
    layers.push({ kind: 'icmp', depth, name: `${pre}ICMP ${icmpName(l4.type, l4.code)}`, bytes: ICMP_HDR + (l4.dataLen || 0), fields });
  } else if (l4.kind === 'tcp') {
    layers.push({ kind: 'tcp', depth, name: `${pre}TCP`, bytes: tcpHdrLen(l4), fields: [
      ['Source port', String(l4.sport), l4.sport >= 49152 ? 'Ephemeral port of the client' : ''],
      ['Destination port', String(l4.dport), l4.dport === 80 ? 'HTTP' : l4.dport === 22 ? 'SSH' : l4.dport === 443 ? 'HTTPS' : ''],
      ['Sequence number', String(l4.seq), 'Number of the first byte in this segment'],
      ['Acknowledgment number', l4.flags.ACK ? String(l4.ack) : '0', l4.flags.ACK ? 'Next byte expected' : 'only valid with ACK'],
      ['Header length', `${tcpHdrLen(l4)} bytes`, l4.mss ? 'with MSS option' : ''],
      ['Flags', tcpFlags(l4.flags), ''], ['Window', String(l4.win), 'How many bytes the peer may send unacknowledged'],
      ...(l4.mss ? [['MSS option', String(l4.mss), 'Largest segment this host accepts']] : [])] });
    if (l4.dataLen) layers.push({ kind: 'data', depth, name: 'Application data', bytes: l4.dataLen, fields: [['Content', `${l4.dataLen} bytes${l4.app ? ': ' + l4.app : ''}`, '']] });
  } else if (l4.kind === 'udp' && l4.payload?.kind === 'dns') {
    const d = l4.payload;
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [['Source port', String(l4.sport), ''], ['Destination port', String(l4.dport), l4.dport === 53 || l4.sport === 53 ? 'DNS' : ''], ['Length', `${UDP_HDR + udpPayloadLen(l4)} bytes`, '']] });
    layers.push({ kind: 'data', depth, name: `DNS ${d.qr ? 'response' : 'query'}`, bytes: dnsLen(d), fields: [
      ['ID', String(d.id), 'Matches response and query to each other'], ['QR', d.qr ? '1 (response)' : '0 (query)', ''],
      ['Question', `${d.qname} A`, ''], ...(d.qr ? [['Response code', d.rcode, ''], ...d.answers.map(a => ['Answer', `${a.name} A ${a.ip}`, 'TTL 300'])] : [])] });
  } else if (l4.kind === 'udp') {
    const vx = l4.payload?.kind === 'vxlan';
    layers.push({ kind: 'udp', depth, name: `${pre}UDP`, bytes: UDP_HDR, fields: [
      ['Source port', String(l4.sport), vx ? 'Hash over the inner frame (distribution with ECMP)' : ''],
      ['Destination port', String(l4.dport), vx ? (l4.dport === 4789 ? 'VXLAN (IANA)' : 'Not the standard port 4789!') : (l4.dport >= 33434 && l4.dport < 33534 ? 'traceroute probe' : '')],
      ['Length', `${UDP_HDR + (vx ? VXLAN_HDR + frameLen(l4.payload.frame) : (l4.payload?.len || 0))} bytes`, '']
    ]});
    if (vx) {
      layers.push({ kind: 'vxlan', depth, name: 'VXLAN', bytes: VXLAN_HDR, fields: [
        ['Flags', '0x08 (I: VNI valid)', ''], ['VNI', String(l4.payload.vni), 'Number of the overlay segment, 24 bits']] });
      layers.push(...dissect(l4.payload.frame, depth + 1));
    } else if (l4.payload?.len) {
      layers.push({ kind: 'data', depth, name: 'Data', bytes: l4.payload.len, fields: [['Content', `${l4.payload.len} bytes`, '']] });
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
// Side panel: configuration, tables and console of a device
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

// ---------------------------------------------------------------- Configuration
export function configPanel(dev, ctx) {
  const { sim, changed, locked, rerender } = ctx;
  const c = dev.cfg;
  const box = h('div');
  const upd = (fn, msg) => { fn(); changed(msg); };
  if (locked) box.append(h('div', { class: 'hint' }, 'The configuration is locked in this step. Observe the network and use the console and tables.'));

  if (c.type === 'pc' || c.type === 'server') {
    const i = c.ifaces.eth1;
    box.append(h('h4', {}, 'Network card eth1'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr' } },
        h('span', {}, 'IP address'), ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name}: IP ${v || 'removed'}`), '192.168.10.10'),
        h('span', {}, 'Prefix'), numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name}: prefix /${v}`)),
        h('span', {}, 'Gateway'), ipInput(c.gw, v => upd(() => c.gw = v, `${dev.name}: gateway ${v || 'removed'}`), 'empty = none'),
        h('span', {}, 'VLAN tag'), numInput(i.vlan, 1, 4094, v => upd(() => i.vlan = v, `${dev.name}: VLAN tag ${v ?? 'off'}`), 'no tag')),
      h('dl', { class: 'kv', style: { marginTop: '10px' } }, h('dt', {}, 'MAC'), h('dd', {}, dev.mac('eth1'))),
      h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'A VLAN tag sends all frames with an 802.1Q tag, like a subinterface eth1.10 on Linux. Without a tag the host fits on an access port.'),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '90px 1fr', marginTop: '8px' } },
        h('span', {}, 'DNS server'), ipInput(c.resolver, v => upd(() => c.resolver = v, `${dev.name}: DNS server ${v || 'removed'}`), 'for curl/ping with names')));
    box.append(servicesEditor(dev, upd), dnsEditor(dev, upd));
  }

  if (c.type === 'router' || c.type === 'vtep') {
    const names = c.type === 'router' ? [...PORTS.router, 'lo'] : ['eth1', 'lo'];
    box.append(h('h4', {}, c.type === 'vtep' ? 'Underlay (layer 3)' : 'Interfaces'));
    const g = h('div', { class: 'cfg-grid' });
    for (const n of names) {
      const i = c.ifaces[n];
      const linked = n === 'lo' || !!sim.linkAt(dev.id, n);
      g.append(h('span', { class: 'if', title: linked ? 'connected' : 'not connected' }, n + (linked ? '' : ' ○')),
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'no IP'}`), n === 'lo' ? 'Loopback' : ''),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)));
    }
    box.append(g);
    if (c.type === 'router') box.append(subifEditor(dev, upd, sim, rerender));
    if (c.type === 'router') {
      const fw = h('input', { type: 'checkbox', checked: c.forwarding !== false ? true : null });
      fw.addEventListener('change', () => upd(() => c.forwarding = fw.checked, `${dev.name}: forwarding ${fw.checked ? 'on' : 'off'}`));
      box.append(h('label', { class: 'row', style: { marginTop: '10px', fontSize: '.88rem' } }, fw, 'IP forwarding (net.ipv4.ip_forward = 1)'));
      const clamp = numInput(c.mssClamp, 536, 9000, v => upd(() => c.mssClamp = v, `${dev.name}: MSS clamping ${v ?? 'off'}`), 'off');
      clamp.style.width = '90px';
      box.append(h('div', { class: 'row', style: { marginTop: '6px', fontSize: '.88rem' } }, 'MSS clamping', clamp,
        h('span', { class: 'small muted' }, 'lowers the MSS in forwarded SYN segments')));
    }
    box.append(routesEditor(dev, upd));
    if (c.type === 'router') box.append(aclEditor(dev, upd));
  }

  if (c.type === 'switch' || c.type === 'vtep') {
    box.append(h('h4', {}, c.type === 'vtep' ? 'Local bridge ports' : 'Ports'));
    const ports = c.type === 'switch' ? PORTS.switch : ['eth2', 'eth3', 'eth4'];
    const shown = ports.filter(p => sim.linkAt(dev.id, p));
    if (!shown.length) box.append(h('div', { class: 'empty' }, 'No port connected yet.'));
    const g = h('div', { class: 'cfg-grid ports' });
    for (const p of shown) {
      const pc = c.ports[p];
      const vl = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'nowrap' } });
      const drawVl = () => {
        vl.innerHTML = '';
        if (pc.mode === 'trunk') {
          const al = h('input', { class: 'input mono', value: pc.allowed ?? '1-4094', title: 'Allowed VLANs, e.g. 10,20 or 1-4094', style: { width: '78px' } });
          al.addEventListener('change', () => upd(() => pc.allowed = al.value.trim() || '1-4094', `${dev.name} ${p}: allowed ${al.value}`));
          vl.append(al, h('span', { class: 'small muted' }, 'native'), numInput(pc.native, 1, 4094, v => upd(() => pc.native = v, `${dev.name} ${p}: native VLAN ${v ?? 'none'}`), '–'));
          vl.lastChild.style.width = '58px';
        } else {
          const n = numInput(pc.vlan ?? 1, 1, 4094, v => upd(() => pc.vlan = v ?? 1, `${dev.name} ${p}: VLAN ${v}`));
          n.style.width = '74px';
          vl.append(h('span', { class: 'small muted' }, 'VLAN'), n);
        }
      };
      drawVl();
      g.append(h('span', { class: 'if' }, p),
        select([['access', 'Access'], ['trunk', 'Trunk']], pc.mode, v => { upd(() => pc.mode = v, `${dev.name} ${p}: ${v === 'trunk' ? 'trunk' : 'access'}`); drawVl(); }),
        vl);
    }
    box.append(g);
    box.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 90px', marginTop: '10px' } },
      h('span', { class: 'small' }, 'MAC table aging time (s), 0 = learns nothing'),
      numInput(c.ageing, 0, 3600, v => upd(() => c.ageing = v ?? 300, `${dev.name}: aging ${v} s`))));
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
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('b', { class: 'mono small' }, n), h('span', { class: 'small muted' }, `tag ${i.vlan} on ${i.parent}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'Remove subinterface', html: I.trash, onclick: () => { upd(() => delete c.ifaces[n], `${dev.name}: ${n} removed`); rerender?.(); } })),
      h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '1fr 70px' } },
        ipInput(i.ip, v => upd(() => i.ip = v, `${dev.name} ${n}: ${v || 'no IP'}`), '10.10.0.1'),
        numInput(i.prefix, 0, 32, v => upd(() => i.prefix = v ?? 24, `${dev.name} ${n}: /${v}`)))));
  }
  if (!subs.length) list.append(h('div', { class: 'empty' }, 'None. A subinterface sends and receives frames with a specific VLAN tag; this is how a router routes between VLANs over a single cable (router on a stick).'));
  const parent = select(PORTS.router.map(p => [p, p]), PORTS.router.find(p => sim.linkAt(dev.id, p)) || 'eth1', () => {});
  const vid = h('input', { class: 'input mono', type: 'number', min: 1, max: 4094, placeholder: 'VLAN', style: { width: '80px' } });
  const add = h('button', { class: 'btn', html: I.plus + ' Create', onclick: () => {
    const v = Math.round(Number(vid.value)), par = parent.value;
    if (!(v >= 1 && v <= 4094)) return vid.classList.add('bad');
    const name = `${par}.${v}`;
    if (c.ifaces[name]) return vid.classList.add('bad');
    upd(() => { c.ifaces[name] = { parent: par, vlan: v, ip: '', prefix: 24 }; }, `${dev.name}: ${name} created`);
    rerender?.();
  } });
  wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px', flexWrap: 'nowrap' } }, parent, vid, add),
    h('p', { class: 'small muted' }, 'The physical interface does not need its own IP for this. On the switch, the port must be a trunk that allows these VLANs.'));
  return wrap;
}

function stpEditor(dev, upd, sim, shown, rerender) {
  const c = dev.cfg, st = c.stp;
  const wrap = h('div');
  const on = h('input', { type: 'checkbox', checked: st.enabled ? true : null });
  on.addEventListener('change', () => { upd(() => st.enabled = on.checked, `${dev.name}: spanning tree ${on.checked ? 'on' : 'off'}`); rerender?.(); });
  wrap.append(h('h4', {}, 'Spanning tree (802.1D)'),
    h('label', { class: 'row', style: { fontSize: '.88rem' } }, on, 'Spanning tree enabled'));
  if (!st.enabled) { wrap.append(h('p', { class: 'small muted' }, 'Off: all ports forward immediately. If the network has a loop, broadcasts circle endlessly.')); return wrap; }
  const prios = []; for (let p = 0; p <= 61440; p += 4096) prios.push([p, String(p) + (p === 32768 ? ' (default)' : '')]);
  const timers = st.timers === 'schnell' ? 'fast' : st.timers;
  wrap.append(h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '110px 1fr', marginTop: '6px' } },
    h('span', { class: 'small' }, 'Bridge priority'), select(prios, st.priority, v => upd(() => st.priority = Number(v), `${dev.name}: priority ${v}`)),
    h('span', { class: 'small' }, 'Timers'), select([['standard', 'Standard (hello 2, forward delay 15, max age 20)'], ['fast', 'Fast for the lab (1 / 4 / 6)']], timers, v => upd(() => st.timers = v, `${dev.name}: timers ${v}`))));
  const b = dev.bridge.stpTable();
  if (b) wrap.append(h('dl', { class: 'kv', style: { marginTop: '8px' } }, h('dt', {}, 'Bridge ID'), h('dd', { class: 'mono' }, b.bridge), h('dt', {}, 'Root'), h('dd', { class: 'mono' }, b.isRoot ? 'this bridge' : `${b.root} via ${b.rootPort}, cost ${b.rootCost}`)));
  if (shown.length) {
    const g = h('div', { class: 'cfg-grid', style: { gridTemplateColumns: '50px 80px 1fr', marginTop: '8px' } }, h('span', { class: 'small muted' }, 'Port'), h('span', { class: 'small muted' }, 'Cost'), h('span', { class: 'small muted' }, 'Edge (PortFast)'));
    for (const p of shown) {
      const pc = c.ports[p];
      const edge = h('input', { type: 'checkbox', checked: pc.edge ? true : null });
      edge.addEventListener('change', () => upd(() => pc.edge = edge.checked, `${dev.name} ${p}: PortFast ${edge.checked ? 'on' : 'off'}`));
      const cost = numInput(pc.cost ?? 4, 1, 200000000, v => upd(() => pc.cost = v ?? 4, `${dev.name} ${p}: cost ${v}`));
      g.append(h('span', { class: 'if' }, p), cost, h('label', { class: 'row small' }, edge, dev.bridge.stp?.ports.get(p)?.edgeLost ? 'BPDU received, edge lost' : ''));
    }
    wrap.append(g);
  }
  wrap.append(h('p', { class: 'small muted' }, `Cost 4 corresponds to 1 Gbit/s, 19 to 100 Mbit/s. Edge ports for end devices go to Forwarding immediately.`));
  return wrap;
}

function servicesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Services (listening ports)'));
    const list = h('div', { class: 'list' });
    c.services.forEach((sv, idx) => {
      const name = h('input', { class: 'input', value: sv.name || '', placeholder: 'Name', style: { minWidth: 0, flex: '1 1 0' } });
      name.addEventListener('change', () => upd(() => sv.name = name.value.trim(), `${dev.name}: service ${name.value}`));
      const port = numInput(sv.port, 1, 65535, v => upd(() => sv.port = v ?? sv.port, `${dev.name}: port ${v}`));
      port.style.width = '78px';
      const size = numInput(sv.size, 0, 100000, v => upd(() => sv.size = v ?? 0, `${dev.name}: response ${v} bytes`), 'bytes');
      size.style.width = '90px';
      const proto = select([['tcp', 'TCP'], ['udp', 'UDP']], sv.proto, v => { upd(() => sv.proto = v, `${dev.name}: ${v}`); draw(); });
      proto.style.width = '74px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, proto, port, name,
          h('button', { class: 'btn icon ghost', title: 'Remove service', html: I.trash, onclick: () => { upd(() => c.services.splice(idx, 1), `${dev.name}: service removed`); draw(); } })),
        sv.proto === 'tcp' ? h('div', { class: 'row small muted', style: { flexWrap: 'nowrap' } }, 'Response', size, 'bytes') : null));
    });
    if (!c.services.length) list.append(h('div', { class: 'empty' }, 'No service. A TCP connection is refused with RST, UDP with ICMP Port Unreachable.'));
    wrap.append(list, h('div', { class: 'row', style: { marginTop: '6px' } },
      h('button', { class: 'btn', html: I.plus + ' Web server (TCP 80)', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 80, name: 'http', size: 2000 }), `${dev.name}: web server`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' DNS (UDP 53)', onclick: () => { upd(() => c.services.push({ proto: 'udp', port: 53, name: 'dns' }), `${dev.name}: DNS service`); draw(); } }),
      h('button', { class: 'btn', html: I.plus + ' Other', onclick: () => { upd(() => c.services.push({ proto: 'tcp', port: 8080, name: 'app', size: 500 }), `${dev.name}: service`); draw(); } })),
    h('p', { class: 'small muted' }, 'For TCP, bytes is the size of the response. It is split into segments of MSS size.'));
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
    wrap.append(h('h4', {}, 'DNS entries (A records)'));
    const list = h('div', { class: 'list' });
    c.dns.forEach((r, idx) => {
      const name = h('input', { class: 'input mono', value: r.name, placeholder: 'web.lab' });
      name.addEventListener('change', () => upd(() => r.name = name.value.trim().toLowerCase(), `${dev.name}: DNS ${name.value}`));
      list.append(h('div', { class: 'item' }, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, name, h('span', { class: 'small muted' }, 'A'),
        ipInput(r.ip, v => upd(() => r.ip = v, `${dev.name}: DNS ${r.name} → ${v}`), '10.0.0.10'),
        h('button', { class: 'btn icon ghost', title: 'Remove entry', html: I.trash, onclick: () => { upd(() => c.dns.splice(idx, 1), `${dev.name}: DNS entry removed`); draw(); } }))));
    });
    if (!c.dns.length) list.append(h('div', { class: 'empty' }, 'No entries. Every query ends with NXDOMAIN.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Entry', onclick: () => { upd(() => c.dns.push({ name: 'new.lab', ip: '' }), `${dev.name}: DNS entry`); draw(); } }));
  };
  draw();
  return wrap;
}

function routesEditor(dev, upd) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'Static routes'));
    const list = h('div', { class: 'list' });
    c.routes.forEach((r, idx) => {
      const dst = h('input', { class: 'input mono', value: r.dst, placeholder: '10.0.0.0/24' });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); dst.classList.remove('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: route ${dst.value}`); });
      const act = dev.l3.routes().find(x => x.proto === 'S' && x.via === r.via && parseCidr(r.dst) && x.net === parseCidr(r.dst).net);
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, dst, h('span', { class: 'small muted' }, 'via'),
          ipInput(r.via, v => upd(() => r.via = v, `${dev.name}: next hop ${v}`), 'Next hop'),
          h('button', { class: 'btn icon ghost', title: 'Remove route', html: I.trash, onclick: () => { upd(() => c.routes.splice(idx, 1), `${dev.name}: route removed`); draw(); } })),
        act && !act.dev ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, 'Inactive: the next hop is not in any directly connected network') : null));
    });
    if (!c.routes.length) list.append(h('div', { class: 'empty' }, 'None. The device knows directly connected networks on its own.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Add route',
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
    wrap.append(h('h4', {}, 'Rules for forwarded packets'),
      h('p', { class: 'small muted' }, 'From top to bottom, the first matching rule applies. If none matches, the packet is forwarded.'));
    const list = h('div', { class: 'list' });
    c.acl.forEach((r, idx) => {
      const src = h('input', { class: 'input mono', value: r.src || 'any', placeholder: 'any' });
      const dst = h('input', { class: 'input mono', value: r.dst || 'any', placeholder: 'any' });
      src.addEventListener('change', () => { if (!parseCidr(src.value)) return src.classList.add('bad'); upd(() => r.src = src.value.trim(), `${dev.name}: rule ${idx + 1}`); });
      dst.addEventListener('change', () => { if (!parseCidr(dst.value)) return dst.classList.add('bad'); upd(() => r.dst = dst.value.trim(), `${dev.name}: rule ${idx + 1}`); });
      const type = numInput(r.icmpType, 0, 255, v => upd(() => r.icmpType = v, `${dev.name}: rule ${idx + 1}`), 'all');
      const portIn = (rr, i) => { const n = numInput(rr.port, 1, 65535, v => upd(() => rr.port = v, `${dev.name}: rule ${i + 1} port ${v ?? 'all'}`), 'all'); n.style.width = '84px'; return n; };
      type.style.width = '64px';
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'small' }, `#${idx + 1}`),
          select([['allow', 'allow'], ['drop', 'drop'], ['reject', 'reject']], r.action, v => upd(() => r.action = v, `${dev.name}: rule ${idx + 1}`)),
          select([['any', 'all protocols'], ['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP']], r.proto || 'any', v => { upd(() => r.proto = v, `${dev.name}: rule ${idx + 1}`); draw(); }),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'move up', html: I.up, disabled: idx === 0 ? true : null, onclick: () => { upd(() => c.acl.splice(idx - 1, 0, c.acl.splice(idx, 1)[0]), `${dev.name}: order`); draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'Remove rule', html: I.trash, onclick: () => { upd(() => c.acl.splice(idx, 1), `${dev.name}: rule removed`); draw(); } })),
        h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('span', { class: 'small muted' }, 'from'), src, h('span', { class: 'small muted' }, 'to'), dst),
        (r.proto === 'icmp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'ICMP type'), type, h('span', { class: 'small muted' }, '0 reply, 3 unreachable, 8 request, 11 TTL')) : null,
        (r.proto === 'tcp' || r.proto === 'udp') ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Dest. port'), portIn(r, idx), h('span', { class: 'small muted' }, 'empty = all ports')) : null,
        r.action === 'reject' ? h('div', { class: 'small muted' }, r.proto === 'tcp' ? 'Reject answers a SYN with TCP RST.' : 'Reject sends ICMP "administratively prohibited" to the sender.') : null));
    });
    if (!c.acl.length) list.append(h('div', { class: 'empty' }, 'No rules, everything is forwarded.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Add rule',
      onclick: () => { upd(() => c.acl.push({ action: 'drop', proto: 'icmp', src: 'any', dst: 'any' }), `${dev.name}: rule added`); draw(); } }));
  };
  draw();
  return wrap;
}

function vxlanEditor(dev, upd, sim) {
  const c = dev.cfg;
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(h('h4', {}, 'VXLAN segments'));
    const list = h('div', { class: 'list' });
    c.vxlans.forEach((m, idx) => {
      const flood = h('input', { class: 'input mono', value: (m.flood || []).join(', '), placeholder: '10.255.0.2' });
      flood.addEventListener('change', () => {
        const ips = flood.value.split(/[,\s]+/).filter(Boolean);
        if (ips.some(x => !isIp(x))) return flood.classList.add('bad');
        flood.classList.remove('bad'); upd(() => m.flood = ips, `${dev.name}: flood list ${ips.join(', ') || 'empty'}`);
      });
      const learn = h('input', { type: 'checkbox', checked: m.learning !== false ? true : null });
      learn.addEventListener('change', () => upd(() => m.learning = learn.checked, `${dev.name}: learning ${learn.checked ? 'on' : 'off'}`));
      list.append(h('div', { class: 'item' },
        h('div', { class: 'row' }, h('b', { class: 'mono small' }, `vxlan${m.vni}`), h('span', { class: 'grow' }),
          h('button', { class: 'btn icon ghost', title: 'Remove segment', html: I.trash, onclick: () => { upd(() => c.vxlans.splice(idx, 1), `${dev.name}: segment removed`); draw(); } })),
        h('div', { class: 'cfg-grid vx' },
          h('label', { class: 'field' }, 'VNI', numInput(m.vni, 1, 16777215, v => { upd(() => m.vni = v, `${dev.name}: VNI ${v}`); draw(); })),
          h('label', { class: 'field' }, 'Local VLAN', numInput(m.vlan, 1, 4094, v => upd(() => m.vlan = v, `${dev.name}: VLAN ${v}`))),
          h('label', { class: 'field' }, 'UDP dest. port', numInput(m.dstport ?? 4789, 1, 65535, v => upd(() => m.dstport = v ?? 4789, `${dev.name}: port ${v}`))),
          h('label', { class: 'field' }, `MTU (auto ${dev.vxlanMtu({ ...m, mtu: null })})`, numInput(m.mtu, 68, 9000, v => upd(() => m.mtu = v, `${dev.name}: VXLAN MTU ${v ?? 'auto'}`), 'auto'))),
        h('label', { class: 'field' }, 'Flood list (remote VTEPs)', flood),
        h('label', { class: 'row small' }, learn, 'Learn MAC addresses from the tunnel (flood and learn)')));
    });
    if (!c.vxlans.length) list.append(h('div', { class: 'empty' }, 'No segment. A segment connects a local VLAN to a VNI.'));
    wrap.append(list, h('button', { class: 'btn', style: { marginTop: '6px' }, html: I.plus + ' Add segment',
      onclick: () => { upd(() => c.vxlans.push({ vni: 10000 + (c.vxlans.length + 1) * 10, vlan: (c.vxlans.length + 1) * 10, flood: [], dstport: 4789, learning: true }), `${dev.name}: segment added`); draw(); } }),
    h('p', { class: 'small muted', style: { marginTop: '8px' } }, `Tunnel source: ${dev.localIp() || '(no address)'}. Linux adjusts the MTU automatically: MTU of eth1 minus 50.`));
  };
  draw();
  return wrap;
}

// ---------------------------------------------------------------- Tables
export function tablesPanel(dev, sim) {
  const box = h('div');
  const tbl = (head, rows) => {
    if (!rows.length) return h('div', { class: 'empty' }, '(empty)');
    return h('table', { class: 'tbl' }, h('tr', {}, head.map(x => h('th', {}, x))), rows.map(r => h('tr', {}, r.map(x => h('td', {}, x ?? '')))));
  };
  if (dev.l3) {
    box.append(h('h4', {}, 'Routing table'),
      tbl(['Destination', 'via', 'dev', ''], dev.l3.routes().map(r => [`${r.net}/${r.len}`, r.via || 'direct', r.dev || '–', r.proto === 'C' ? 'C' : (r.dev ? 'S' : 'S inactive')])));
    box.append(h('h4', {}, 'ARP table'),
      tbl(['IP', 'MAC', 'dev', 'State'], dev.l3.arpTable().map(e => [e.ip, e.mac || '–', e.ifname, e.state])));
    if (dev.l3.pmtu.size) box.append(h('h4', {}, 'Learned path MTU'), tbl(['Destination', 'MTU'], [...dev.l3.pmtu].map(([k, v]) => [k, v])));
    const conns = [...dev.l3.tcp.values()];
    if (conns.length) box.append(h('h4', {}, 'TCP connections'), tbl(['State', 'Local', 'Peer'], conns.map(c => [c.state, `:${c.lport}`, `${c.rip}:${c.rport}`])));
    if (dev.cfg.services?.length) box.append(h('h4', {}, 'Listening services'), tbl(['Proto', 'Port', 'Service'], dev.cfg.services.map(s => [s.proto.toUpperCase(), s.port, s.name || ''])));
  }
  if (dev.type === 'switch') {
    const t = dev.bridge.stpTable();
    if (t) {
      box.append(h('h4', {}, 'Spanning tree'),
        h('dl', { class: 'kv' }, h('dt', {}, 'Root'), h('dd', { class: 'mono' }, t.root + (t.isRoot ? ' (this bridge)' : '')),
          h('dt', {}, 'Bridge'), h('dd', { class: 'mono' }, t.bridge),
          ...(t.isRoot ? [] : [h('dt', {}, 'Root port'), h('dd', {}, `${t.rootPort}, cost ${t.rootCost}`)])),
        tbl(['Port', 'Role', 'State', 'Cost'], t.ports.map(p => [p.port + (p.edge ? ' (edge)' : ''), STP_TEXT.ROLE[p.role], STP_TEXT.STATE[p.state], p.cost])));
    }
  }
  if (dev.bridge) {
    box.append(h('h4', {}, 'MAC table'),
      tbl(['VLAN', 'MAC', 'Port', 'Age'], dev.bridge.table().map(e => [e.vid, e.mac, e.remote ? `${e.port} → ${e.remote}` : e.port, e.age.toFixed(1) + ' s'])));
  }
  if (dev.type === 'vtep') {
    box.append(h('h4', {}, 'VXLAN'), tbl(['Interface', 'VLAN', 'Port', 'MTU', 'Flood'],
      dev.maps().map(m => [`vxlan${m.vni}`, m.vlan, m.dstport || 4789, dev.vxlanMtu(m), (m.flood || []).join(', ') || '(empty)'])));
  }
  return box;
}

// ---------------------------------------------------------------- Console
export function consolePanel(dev, sim, presets = []) {
  const pre = h('pre', { 'aria-live': 'polite' });
  const draw = () => { pre.textContent = dev.consoleLines.join('\n') || 'Type help for an overview of the commands.'; pre.scrollTop = pre.scrollHeight; };
  draw();
  const input = h('input', { class: 'input', placeholder: dev.l3 ? 'e.g. ping 192.168.20.20' : 'e.g. bridge fdb', spellcheck: 'false', autocomplete: 'off' });
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
  const el = h('div', { class: 'console' }, pre, h('div', { class: 'in' }, input, h('button', { class: 'btn primary', onclick: () => { run(input.value); input.value = ''; input.focus(); } }, 'Run')), quick);
  el.refresh = draw;
  el.focusInput = () => input.focus();
  return el;
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/presets.js" <<'__PACKETPILOT_FILE_END__'
// Building blocks for topologies and the example networks
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

// -------------------------------------------------------------- Example networks
export const PRESETS = [
  { id: 'switch3', title: 'One switch, three PCs', topics: ['Ethernet', 'ARP', 'Switching'],
    text: 'The smallest useful network. Watch ARP and how the switch fills its MAC table.',
    make: () => topo('One switch, three PCs', [
      host('pc1', 120, 120, '10.0.0.1'), host('pc2', 120, 320, '10.0.0.2'), host('pc3', 520, 220, '10.0.0.3'), sw('sw1', 320, 220)],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('pc3', 'eth1', 'sw1', 'eth3')]) },
  { id: 'routed', title: 'Two subnets and a router', topics: ['Routing', 'ARP', 'TTL'],
    text: 'LAN A and LAN B, connected via r1. Ideal for seeing how MAC addresses and TTL change per segment.',
    make: () => topo('Two subnets and a router', [
      host('pc1', 100, 120, '192.168.10.10', 24, '192.168.10.1'), host('pc2', 100, 320, '192.168.10.11', 24, '192.168.10.1'),
      sw('sw1', 290, 220), router('r1', 480, 220, { eth1: '192.168.10.1/24', eth2: '192.168.20.1/24' }),
      server('srv1', 680, 220, '192.168.20.20', 24, '192.168.20.1')],
    [link('pc1', 'eth1', 'sw1', 'eth1'), link('pc2', 'eth1', 'sw1', 'eth2'), link('r1', 'eth1', 'sw1', 'eth4'), link('r1', 'eth2', 'srv1', 'eth1')]) },
  { id: 'chain', title: 'Three routers in a row', topics: ['Static routing', 'traceroute'],
    text: 'Static routes across three routers. Run traceroute 10.0.4.10 on pc1.',
    make: chainTopo },
  { id: 'mtu', title: 'Bottleneck with a small MTU', topics: ['MTU', 'PMTUD', 'Fragmentation'],
    text: 'The link between r1 and r2 only has MTU 1400. Try ping -s 1472 -M do and -M dont.',
    make: () => topo('Bottleneck with a small MTU', [
      host('pc1', 100, 220, '10.0.1.10', 24, '10.0.1.1'), router('r1', 300, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['10.0.2.0/24', '10.0.12.2']]),
      router('r2', 500, 220, { eth1: '10.0.12.2/24', eth2: '10.0.2.1/24' }, [['10.0.1.0/24', '10.0.12.1']]), server('srv1', 700, 220, '10.0.2.20', 24, '10.0.2.1')],
    [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'srv1', 'eth1')]) },
  { id: 'vlans', title: 'VLANs over a trunk', topics: ['VLAN', '802.1Q', 'Trunk'],
    text: 'Two switches, two VLANs, a trunk in between. Take a look at the tags on the trunk.',
    make: vlanTopo },
  { id: 'campus', title: 'Campus with routing between VLANs', topics: ['VLAN', 'Routing', 'Rules'],
    text: 'Clients in VLAN 10, servers in VLAN 20, r1 routes between them. Try out rules on r1.',
    make: () => topo('Campus with routing between VLANs', [
      host('client1', 100, 100, '10.10.0.11', 24, '10.10.0.1'), host('client2', 100, 300, '10.10.0.12', 24, '10.10.0.1'),
      server('web', 640, 100, '10.20.0.80', 24, '10.20.0.1'), server('dns', 640, 300, '10.20.0.53', 24, '10.20.0.1'),
      sw('sw1', 370, 200, { eth1: acc(10), eth2: acc(10), eth3: acc(20), eth4: acc(20), eth5: acc(10), eth6: acc(20) }),
      router('r1', 370, 400, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' })],
    [link('client1', 'eth1', 'sw1', 'eth1'), link('client2', 'eth1', 'sw1', 'eth2'), link('web', 'eth1', 'sw1', 'eth3'), link('dns', 'eth1', 'sw1', 'eth4'),
      link('r1', 'eth1', 'sw1', 'eth5'), link('r1', 'eth2', 'sw1', 'eth6')]) },
  { id: 'vxlan', title: 'VXLAN over a routed underlay', topics: ['VXLAN', 'Underlay', 'Overlay'],
    text: 'Two VTEPs, a router in between, two segments. The router does not know the servers\' networks.',
    make: () => vxlanTopo({ two: true }) },
  { id: 'stp', title: 'Redundancy with spanning tree', topics: ['STP', 'Redundancy', 'Root bridge'],
    text: 'Three switches in a triangle. STP blocks one port. Disconnect a cable and watch the network fail over.',
    make: () => stpTriangle({ enabled: true, rootPrio: 4096 }) },
  { id: 'loop', title: 'Loop without spanning tree', topics: ['Broadcast storm', 'Loop'],
    text: 'The same triangle, but STP is off. A single ping is enough for a broadcast storm.',
    make: () => stpTriangle({ enabled: false }) },
  { id: 'stpsquare', title: 'Four switches in a ring', topics: ['STP', 'Port costs', 'Port roles'],
    text: 'Which port blocks, and how do you move it with port costs?',
    make: () => stpSquare() },
  { id: 'stick', title: 'Router-on-a-Stick', topics: ['Subinterfaces', 'VLAN', 'Trunk'],
    text: 'One router, one cable, two VLANs: r1 routes via the subinterfaces eth1.10 and eth1.20.',
    make: () => stickTopo(true) },
  { id: 'services', title: 'Web and DNS', topics: ['TCP', 'UDP', 'DNS', 'Rules'],
    text: 'A client, a web server, a DNS server. curl http://web.lab/ first resolves the name and then opens a TCP connection.',
    make: () => servicesTopo() },
  { id: 'failover', title: 'Failover with gratuitous ARP', topics: ['ARP', 'GARP', 'Failover'],
    text: 'The service address 10.0.0.100 moves from srvA to srvB. Try it with and without gratuitous ARP.',
    make: () => failoverTopo() },
  { id: 'tcppath', title: 'TCP across a bottleneck', topics: ['TCP', 'MSS', 'PMTUD'],
    text: 'Only MTU 1400 between r1 and r2. The web server has to shrink its segments.',
    make: () => tcpPathTopo() },
  { id: 'empty', title: 'Empty network', topics: ['Your own network'],
    text: 'An empty canvas for your own topology.',
    make: () => topo('My network', [], []) }
];

export function chainTopo() {
  return topo('Three routers in a row', [
    host('pc1', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 250, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 420, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.4.0/24', '10.0.23.3']]),
    router('r3', 590, 220, { eth1: '10.0.23.3/24', eth2: '10.0.4.1/24' }, [['0.0.0.0/0', '10.0.23.2']]),
    server('srv1', 760, 220, '10.0.4.10', 24, '10.0.4.1')],
  [link('pc1', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1'), link('r2', 'eth2', 'r3', 'eth1'), link('r3', 'eth2', 'srv1', 'eth1')]);
}
export function vlanTopo(trunked = true) {
  const up = trunked ? trunk('10,20', 1) : acc(1);
  return topo('VLANs over a trunk', [
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
  return topo('VXLAN over a routed underlay', devs, links,
    [{ x: 20, y: 40, w: 860, h: 130, label: two ? 'Overlay: VNI 10010 (192.168.10.0/24) and VNI 10020 (192.168.20.0/24)' : 'Overlay: VNI 10010, 192.168.10.0/24', kind: 'overlay' },
      { x: 150, y: 320, w: 580, h: 120, label: 'Underlay: routed, only knows the VTEP loopbacks', kind: 'underlay' }]);
}

// -------------------------------------------------------------- Spanning tree, subinterfaces, services
const stpCfg = (enabled, prio = 32768, timers = 'fast') => ({ stp: { enabled, priority: prio, timers } });
export function stpTriangle({ enabled = true, rootPrio = 32768, timers = 'fast', edge = false } = {}) {
  const pcPort = edge ? { mode: 'access', vlan: 1, edge: true } : acc(1);
  return topo(enabled ? 'Redundancy with spanning tree' : 'Loop without spanning tree', [
    sw('sw1', 400, 110, {}, stpCfg(enabled, rootPrio, timers)), sw('sw2', 230, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers)), sw('sw3', 570, 300, { eth5: pcPort }, stpCfg(enabled, 32768, timers)),
    host('pc1', 80, 300, '10.0.0.1'), host('pc2', 720, 300, '10.0.0.2')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw1', 'eth2', 'sw3', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth2'),
    link('pc1', 'eth1', 'sw2', 'eth5'), link('pc2', 'eth1', 'sw3', 'eth5')],
  [{ x: 160, y: 40, w: 480, h: 330, label: 'Redundant cabling: three paths, one loop', color: 'yellow' }]);
}
export function stpSquare() {
  return topo('Four switches in a ring', [
    sw('sw1', 240, 110, {}, stpCfg(true, 4096)), sw('sw2', 560, 110, {}, stpCfg(true)), sw('sw3', 560, 340, { eth5: acc(1) }, stpCfg(true)), sw('sw4', 240, 340, {}, stpCfg(true)),
    host('pc1', 80, 110, '10.0.0.1'), host('pc3', 720, 340, '10.0.0.3')],
  [link('sw1', 'eth1', 'sw2', 'eth1'), link('sw2', 'eth2', 'sw3', 'eth1'), link('sw3', 'eth2', 'sw4', 'eth2'), link('sw4', 'eth1', 'sw1', 'eth2'),
    link('pc1', 'eth1', 'sw1', 'eth5'), link('pc3', 'eth1', 'sw3', 'eth5')],
  [{ x: 170, y: 40, w: 460, h: 370, label: 'Ring of four switches, sw1 is root', color: 'yellow' }]);
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
    { x: 290, y: 14, w: 220, h: 146, label: 'Router with subinterfaces', color: 'gray' }]);
}
export function servicesTopo({ acl = [] } = {}) {
  const web = server('web', 640, 110, '10.20.0.80', 24, '10.20.0.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 3000 }, { proto: 'tcp', port: 443, name: 'https', size: 3000 }];
  const dns = server('dns', 640, 330, '10.20.0.53', 24, '10.20.0.1');
  dns.services = [{ proto: 'udp', port: 53, name: 'dns' }];
  dns.dns = [{ name: 'web.lab', ip: '10.20.0.80' }, { name: 'dns.lab', ip: '10.20.0.53' }, { name: 'intranet.lab', ip: '10.20.0.80' }];
  const c1 = host('client', 100, 220, '10.10.0.10', 24, '10.10.0.1');
  c1.resolver = '10.20.0.53';
  return topo('Web and DNS', [c1, router('r1', 300, 220, { eth1: '10.10.0.1/24', eth2: '10.20.0.1/24' }, [], { acl }), sw('sw1', 470, 220), web, dns],
    [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'sw1', 'eth1'), link('web', 'eth1', 'sw1', 'eth2'), link('dns', 'eth1', 'sw1', 'eth3')],
    [{ x: 400, y: 40, w: 340, h: 380, label: 'Server network 10.20.0.0/24', color: 'green' }]);
}
export function failoverTopo() {
  const a = server('srvA', 600, 110, '10.0.0.100'), b = server('srvB', 600, 330, '10.0.0.12');
  return topo('Failover with gratuitous ARP', [host('client', 120, 220, '10.0.0.5'), sw('sw1', 360, 220), a, b],
    [link('client', 'eth1', 'sw1', 'eth1'), link('srvA', 'eth1', 'sw1', 'eth2'), link('srvB', 'eth1', 'sw1', 'eth3')],
    [{ x: 500, y: 40, w: 220, h: 380, label: 'Cluster, service address 10.0.0.100', color: 'orange' }]);
}
export function tcpPathTopo({ fwAcl = [] } = {}) {
  const web = server('web', 840, 220, '10.0.2.80', 24, '10.0.2.1');
  web.services = [{ proto: 'tcp', port: 80, name: 'http', size: 6000 }];
  return topo('TCP across a bottleneck', [host('client', 80, 220, '10.0.1.10', 24, '10.0.1.1'),
    router('r1', 270, 220, { eth1: '10.0.1.1/24', eth2: '10.0.12.1/24' }, [['0.0.0.0/0', '10.0.12.2']]),
    router('r2', 460, 220, { eth1: '10.0.12.2/24', eth2: '10.0.23.2/24' }, [['10.0.1.0/24', '10.0.12.1'], ['10.0.2.0/24', '10.0.23.3']]),
    router('fw', 650, 220, { eth1: '10.0.23.3/24', eth2: '10.0.2.1/24' }, [['0.0.0.0/0', '10.0.23.2']], { acl: fwAcl }), web],
  [link('client', 'eth1', 'r1', 'eth1'), link('r1', 'eth2', 'r2', 'eth1', 1400), link('r2', 'eth2', 'fw', 'eth1'), link('fw', 'eth2', 'web', 'eth1')],
  [{ x: 210, y: 130, w: 310, h: 150, label: 'Tunnel section, MTU 1400', color: 'orange' }]);
}
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/store.js" <<'__PACKETPILOT_FILE_END__'
// Storage in the browser, robust against blocked storage
const KEY = 'packetpilot.v1';
let mem = { progress: {}, nets: {}, prefs: {} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) mem = { ...mem, ...JSON.parse(raw) };
} catch { /* private window or similar */ }

function persist() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* ignore */ } }

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
    if (typeof d !== 'object' || !d) throw new Error('Not a valid PacketPilot file');
    mem = { progress: d.progress || {}, nets: d.nets || {}, prefs: d.prefs || mem.prefs };
    persist();
  }
};
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/ui.js" <<'__PACKETPILOT_FILE_END__'
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
__PACKETPILOT_FILE_END__
  mkdir -p "$W/js"
  cat > "$W/js/widgets.js" <<'__PACKETPILOT_FILE_END__'
// Interactive exercises for the lessons
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
      const inp = h('input', { class: 'input mono', type: 'text', 'aria-label': 'Answer' });
      const fb = h('span', { class: 'feedback' });
      const test = () => {
        const ok = q.input.some(a => norm(a) === norm(inp.value));
        fb.textContent = ok ? 'Correct' : 'Not yet';
        fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
        if (ok) { state[qi] = true; explain.classList.remove('hidden'); inp.disabled = true; check(); }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') test(); });
      box.append(h('div', { class: 'row', style: { marginTop: '10px' } }, inp, q.unit ? h('span', { class: 'muted' }, q.unit) : null,
        h('button', { class: 'btn', onclick: test }, 'Check'), fb));
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

// ---------------------------------------------------------------- Label the frame
function label(step, el, done) {
  const rows = step.rows || [step.slots];
  const all = rows.flat();
  const labels = shuffle([...all.map(s => s.label), ...(step.distractors || [])]);
  let picked = null;
  const chips = h('div', { class: 'chips', 'aria-label': 'Terms' });
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
    if (!chips.childElementCount) chips.append(h('span', { class: 'muted small' }, 'All terms placed.'));
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
      se.append(h('div', { style: { fontWeight: l ? 600 : 400, color: l ? 'var(--ink)' : 'var(--ink-3)' } }, l || 'drop here'),
        h('div', { class: 'size' }, slot.size || ''));
      se.style.borderTop = `5px solid var(--l-${slot.kind || 'data'})`;
    }
  };
  const grid = h('div', { style: { display: 'grid', gap: '6px' } });
  for (const r of rows) {
    const rowEl = h('div', { class: 'slotrow' });
    for (const slot of r) {
      const se = h('button', { class: 'slot', style: { width: `${slot.w || 90}px` }, 'aria-label': 'Field' });
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
  el.append(h('p', { class: 'muted small' }, 'Click or drag a term and drop it on a field. Clicking a filled field clears it.'),
    chips, grid,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      let right = 0;
      for (const { slot, se } of slotEls) {
        const ok = fill.get(slot) === slot.label;
        se.classList.toggle('right', ok); se.classList.toggle('wrong', !!fill.get(slot) && !ok);
        if (ok) right++;
      }
      const all = right === slotEls.length;
      fb.textContent = all ? 'Everything placed correctly.' : `${right} of ${slotEls.length} correct. Wrong fields are marked red.`;
      fb.className = 'feedback ' + (all ? 'ok' : 'bad');
      if (all) { explain.classList.remove('hidden'); done(); }
    } }, 'Check'), fb), explain);
  drawChips(); drawSlots();
}

// ---------------------------------------------------------------- Order
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
          h('button', { class: 'btn icon ghost', title: 'move up', html: I.up, disabled: pos === 0 ? true : null, onclick: () => { [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]]; draw(); } }),
          h('button', { class: 'btn icon ghost', title: 'move down', html: I.down, disabled: pos === order.length - 1 ? true : null, onclick: () => { [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]]; draw(); } })));
      row.addEventListener('dragstart', () => { dragIdx = pos; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => { e.preventDefault(); if (dragIdx === null) return; const [m] = order.splice(dragIdx, 1); order.splice(pos, 0, m); dragIdx = null; draw(); });
      list.append(row);
    });
  };
  draw();
  el.append(h('p', { class: 'muted small' }, step.hint || 'Drag the blocks into the right order or use the arrows.'), list,
    h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => {
      const ok = order.every((v, i) => v === i);
      fb.textContent = ok ? 'Correct.' : 'Not quite yet. Remember: which layer goes onto the wire first?';
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      if (ok) { explain.classList.remove('hidden'); done(); }
    } }, 'Check'), fb), explain);
}

// ---------------------------------------------------------------- MAC decoder
const OUI = { '00:50:56': 'VMware (ESXi)', '00:0c:29': 'VMware (Workstation)', '52:54:00': 'QEMU/KVM (locally administered)', 'aa:c1:ab': 'containerlab (locally administered)',
  '02:42:ac': 'Docker (older versions)', '00:1b:21': 'Intel', '3c:fd:fe': 'Intel', 'f4:4d:30': 'Elitegroup', '00:00:5e': 'IANA (VRRP: 00:00:5e:00:01:xx)', '01:00:5e': 'IPv4 multicast', '33:33:00': 'IPv6 multicast' };
export function classifyMac(m) {
  if (m === 'ff:ff:ff:ff:ff:ff') return 'Broadcast';
  if (isGroupMac(m)) return 'Multicast';
  return isLocalMac(m) ? 'Unicast, locally administered' : 'Unicast, from the manufacturer';
}
function mac(step, el, done) {
  const inp = h('input', { class: 'input mono', value: '00:50:56:a3:1f:7c', 'aria-label': 'MAC address', style: { width: '210px' } });
  const out = h('div');
  const draw = () => {
    out.innerHTML = '';
    const m = inp.value.trim().toLowerCase().replace(/-/g, ':');
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)) { out.append(h('p', { class: 'muted' }, 'Format: six hex pairs, e.g. 00:50:56:a3:1f:7c')); return; }
    const b = parseInt(m.slice(0, 2), 16);
    const bits = h('div', { class: 'macbits' });
    for (let i = 7; i >= 0; i--) bits.append(h('div', { class: i <= 1 ? 'hl' : '' }, (b >> i) & 1, h('span', {}, 'b' + i)));
    const oui = OUI[m.slice(0, 8)];
    out.append(h('p', {}, 'First byte ', h('code', {}, m.slice(0, 2)), ' in binary, the two highlighted bits decide:'), bits,
      h('table', { class: 'rtable' },
        h('tr', {}, h('th', {}, 'Bit b0 (I/G)'), h('td', {}, (b & 1) ? '1: group (multicast or broadcast)' : '0: single interface (unicast)')),
        h('tr', {}, h('th', {}, 'Bit b1 (U/L)'), h('td', {}, (b & 2) ? '1: locally administered' : '0: assigned by the manufacturer (OUI)')),
        h('tr', {}, h('th', {}, 'OUI'), h('td', {}, `${m.slice(0, 8)}${oui ? '  ' + oui : '  (not in the short list)'}`)),
        h('tr', {}, h('th', {}, 'Result'), h('td', {}, classifyMac(m)))));
  };
  inp.addEventListener('input', draw);
  el.append(h('div', { class: 'row' }, h('label', { class: 'field' }, 'Try a MAC address', inp)), out);
  draw();
  const qs = step.classify || [];
  const state = qs.map(() => false);
  const box = h('div', { class: 'quiz-q', style: { marginTop: '16px' } }, h('div', { style: { fontWeight: 600 } }, 'Classify these addresses:'));
  qs.forEach((m, i) => {
    const s = h('select', { class: 'input' }, ['please choose', 'Unicast, from the manufacturer', 'Unicast, locally administered', 'Multicast', 'Broadcast'].map(o => h('option', {}, o)));
    const fb = h('span', { class: 'feedback' });
    s.addEventListener('change', () => {
      const ok = s.value === classifyMac(m);
      fb.textContent = ok ? 'Correct' : 'No'; fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
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
  return best ? best.nh : 'no route';
}
function lpm(step, el, done) {
  const t = h('table', { class: 'rtable' }, h('tr', {}, h('th', {}, 'Destination'), h('th', {}, 'Next hop')),
    step.table.map(([p, n]) => h('tr', {}, h('td', {}, p), h('td', {}, n))));
  const nhs = [...new Set(step.table.map(x => x[1])), ...(step.table.some(x => x[0].endsWith('/0')) ? [] : ['no route'])];
  const state = step.dests.map(() => false);
  const qs = h('div', { style: { display: 'grid', gap: '8px', marginTop: '14px' } });
  step.dests.forEach((ip, i) => {
    const s = h('select', { class: 'input' }, h('option', {}, 'please choose'), nhs.map(n => h('option', {}, n)));
    const fb = h('span', { class: 'feedback' });
    s.addEventListener('change', () => {
      const ans = lpmAnswer(step.table, ip);
      const ok = s.value === ans;
      fb.textContent = ok ? 'Correct' : 'No, check which entries match and which one is the longest';
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      state[i] = ok;
      if (state.every(Boolean)) done();
    });
    qs.append(h('div', { class: 'row' }, h('span', {}, 'Packet to'), h('code', { style: { width: '120px' } }, ip), h('span', {}, 'goes to'), s, fb));
  });
  el.append(t, qs);
}

// ---------------------------------------------------------------- Build a frame
const ETHERTYPES = [['0x0800', '0x0800 IPv4'], ['0x0806', '0x0806 ARP'], ['0x8100', '0x8100 802.1Q tag'], ['0x86dd', '0x86DD IPv6'], ['len', 'Length (802.3 with LLC)']];
export const BUILD_BLOCKS = {
  eth: { name: 'Ethernet', kind: 'eth', fields: [['dst', 'Destination MAC', 'mac'], ['src', 'Source MAC', 'mac'], ['type', 'EtherType', ETHERTYPES]] },
  vlan: { name: '802.1Q tag', kind: 'vlan', fields: [['vid', 'VLAN ID', 'num'], ['type', 'Following EtherType', ETHERTYPES]] },
  arp: { name: 'ARP', kind: 'arp', fields: [['op', 'Operation', [['1', '1 Request'], ['2', '2 Reply']]], ['sha', 'Sender MAC', 'mac'], ['spa', 'Sender IP', 'ip'], ['tha', 'Target MAC', 'mac'], ['tpa', 'Target IP', 'ip']] },
  stp: { name: 'BPDU', kind: 'stp', fields: [['root', 'Root ID', 'bid'], ['cost', 'Root path cost', 'num'], ['bridge', 'Bridge ID (sender)', 'bid']] },
  ip: { name: 'IPv4', kind: 'ip', fields: [['src', 'Source IP', 'ip'], ['dst', 'Destination IP', 'ip'], ['proto', 'Protocol', [['1', '1 ICMP'], ['6', '6 TCP'], ['17', '17 UDP']]], ['ttl', 'TTL', 'num']] },
  icmp: { name: 'ICMP', kind: 'icmp', fields: [['type', 'Type', [['8', '8 Echo Request'], ['0', '0 Echo Reply'], ['3', '3 Destination Unreachable'], ['11', '11 Time Exceeded']]]] },
  udp: { name: 'UDP', kind: 'udp', fields: [['sport', 'Source port', 'num'], ['dport', 'Destination port', 'num']] },
  tcp: { name: 'TCP', kind: 'tcp', fields: [['sport', 'Source port', 'num'], ['dport', 'Destination port', 'num'], ['flags', 'Flags', [['SYN', 'SYN'], ['SYN,ACK', 'SYN, ACK'], ['ACK', 'ACK'], ['PSH,ACK', 'PSH, ACK'], ['FIN,ACK', 'FIN, ACK'], ['RST', 'RST'], ['RST,ACK', 'RST, ACK']]]] },
  dns: { name: 'DNS', kind: 'udp', fields: [['qr', 'Kind', [['0', 'Query (QR 0)'], ['1', 'Response (QR 1)']]], ['name', 'Queried name', 'name']] },
  http: { name: 'HTTP', kind: 'data', fields: [['msg', 'Message', [['GET', 'GET / HTTP/1.1'], ['200', 'HTTP/1.1 200 OK']]]] },
  data: { name: 'Data', kind: 'data', fields: [] }
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
    if (!f) { res.ok = false; res.msgs.push(`A layer is still missing after ${BUILD_BLOCKS[frame[i - 1]?.block]?.name || 'the start'}.`); break; }
    if (!e) { res.ok = false; res.layers[i] = { wrongBlock: true }; res.msgs.push(`${BUILD_BLOCKS[f.block].name} is one too many.`); continue; }
    if (e.block !== f.block) { res.ok = false; res.layers[i] = { wrongBlock: true }; res.msgs.push(`Position ${i + 1} needs a different layer than ${BUILD_BLOCKS[f.block].name}.`); continue; }
    const bad = Object.entries(e.fields || {}).filter(([k, v]) => !matches(v, f.fields[k])).map(([k]) => k);
    res.layers[i] = { bad };
    if (bad.length) res.ok = false;
  }
  if (res.ok) res.msgs.push('The frame is correct.');
  else if (!res.msgs.length) res.msgs.push('The layers are correct, the fields marked red are not yet.');
  return res;
}
function build(step, el, done) {
  const frame = [];
  const allowed = step.blocks || ['eth', 'vlan', 'arp', 'stp', 'ip', 'icmp', 'udp', 'tcp', 'dns', 'http', 'data'];
  const addr = step.addresses || {};
  const macs = [...(addr.mac || []), ['ff:ff:ff:ff:ff:ff', 'Broadcast'], ['00:00:00:00:00:00', 'unknown (zeros)'], ['01:80:c2:00:00:00', 'STP multicast']];
  const ips = [...(addr.ip || []), ['0.0.0.0', 'no address']];
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
    if (!frame.length) area.append(h('div', { class: 'empty' }, 'Still empty. On the left, pick the layers in the order in which they go onto the wire.'));
    frame.forEach((layer, i) => {
      const b = BUILD_BLOCKS[layer.block];
      const lr = result?.layers[i];
      const card = h('div', { class: 'bld-layer' + (lr?.wrongBlock ? ' wrong' : ''), style: { '--lc': `var(--l-${b.kind})` } });
      card.append(h('div', { class: 'bld-head' }, h('b', {}, `${i + 1}. ${b.name}`), h('span', { class: 'grow' }),
        h('button', { class: 'btn icon ghost', title: 'move up', html: I.up, disabled: i === 0 ? true : null, onclick: () => { [frame[i - 1], frame[i]] = [frame[i], frame[i - 1]]; result = null; draw(); } }),
        h('button', { class: 'btn icon ghost', title: 'remove', html: I.trash, onclick: () => { frame.splice(i, 1); result = null; draw(); } })));
      if (b.fields.length) {
        const g = h('div', { class: 'bld-fields' });
        for (const [k, label, t] of b.fields) {
          const opts = Array.isArray(t) ? t : optsFor(t);
          let inp;
          if (opts) {
            inp = h('select', { class: 'input mono' }, h('option', { value: '' }, 'choose'), opts.map(([v, l]) => h('option', { value: v, selected: layer.fields[k] === v ? true : null }, l)));
          } else inp = h('input', { class: 'input mono', type: t === 'num' ? 'number' : 'text', value: layer.fields[k] ?? '', placeholder: t === 'num' ? 'number' : '' });
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
    } }, 'Check'), h('button', { class: 'btn ghost', onclick: () => { frame.length = 0; result = null; fb.textContent = ''; draw(); } }, 'Clear'), fb), explain);
}
export { esc };
__PACKETPILOT_FILE_END__
}

check_system() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  [ -r /etc/os-release ] || die "/etc/os-release is missing, unknown system."
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" = "debian" ] && { [ "${VERSION_ID:-}" = "12" ] || [ "${VERSION_ID:-}" = "13" ]; }; then
    ok "Detected Debian ${VERSION_ID} (${VERSION_CODENAME:-?})"
  elif [ "$PP_FORCE" = "yes" ]; then
    warn "Untested system (${PRETTY_NAME:-unknown}), continuing anyway because of --force."
  else
    die "Tested on Debian 12 and 13, found: ${PRETTY_NAME:-unknown}. Use --force to install anyway."
  fi
}

port_in_use() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -Hltn "sport = :${PP_PORT}" 2>/dev/null | grep -q .
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    ok "nginx is already installed"
  else
    say "Installing nginx"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq nginx >/dev/null
    ok "nginx installed"
  fi
}

write_site() {
  say "Writing nginx configuration for port ${PP_PORT}"
  local listen6="    listen [::]:${PP_PORT};"
  if [ ! -f /proc/net/if_inet6 ]; then
    listen6="    # IPv6 is not available on this system"
    warn "No IPv6 available, PacketPilot only listens on IPv4."
  fi
  cat > "$PP_SITE" <<NGINX
# PacketPilot ${PP_VERSION}, generated by packetpilot-install.sh
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
    warn "Port 80: the nginx default site is disabled (only the link in sites-enabled, the file stays)."
    rm -f /etc/nginx/sites-enabled/default
  fi
  nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx configuration is invalid, see above."; }
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl reload nginx
  ok "nginx reloaded"
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${PP_PORT}/tcp" >/dev/null && ok "ufw: port ${PP_PORT}/tcp opened"
  fi
}

# Keep the previous port when reinstalling
keep_port() {
  if [ "$PP_PORT_SET" = "no" ] && [ -f "$PP_SITE" ]; then
    local old
    old="$(awk '/^[[:space:]]*listen[[:space:]]+[0-9]+;/ { gsub(";", "", $2); print $2; exit }' "$PP_SITE")"
    if [ -n "$old" ] && [ "$old" != "$PP_PORT" ]; then
      PP_PORT="$old"
      ok "Keeping previous port ${PP_PORT} (change with --port)"
    fi
  fi
}

do_install() {
  check_system
  keep_port
  if port_in_use && [ ! -f "$PP_SITE" ]; then
    warn "Port ${PP_PORT} is already in use. If you run into problems, choose another one with --port."
  fi
  install_nginx
  say "Writing web files to ${PP_WWW}"
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
  ok "$(find "$PP_WWW" -type f | wc -l) files installed"
  write_site
  open_firewall
  local ips
  ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.' | head -3 || true)"
  echo
  say "PacketPilot ${PP_VERSION} is ready:"
  if [ -n "$ips" ]; then
    for ip in $ips; do echo "      http://${ip}:${PP_PORT}/"; done
  else
    echo "      http://<IP-of-this-server>:${PP_PORT}/"
  fi
  echo
  echo "    Each browser stores progress and your own networks separately."
  echo "    Update: sudo bash packetpilot-install.sh --update. Remove: --uninstall"
}

do_update() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  local tmp new
  tmp="$(mktemp)"
  say "Downloading the latest version from github.com/${PP_REPO}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$PP_SCRIPT_URL" -o "$tmp" || die "Download failed: ${PP_SCRIPT_URL}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$PP_SCRIPT_URL" || die "Download failed: ${PP_SCRIPT_URL}"
  else
    die "Neither curl nor wget found. Install with: apt install curl"
  fi
  bash -n "$tmp" || die "The downloaded script is broken, aborting."
  new="$(sed -n 's/^PP_VERSION="\(.*\)"$/\1/p' "$tmp" | head -1)"
  [ -n "$new" ] || die "The downloaded script does not look like PacketPilot."
  say "Installed: $(cat "${PP_ROOT}/VERSION" 2>/dev/null || echo none), available: ${new}"
  local args=()
  [ "$PP_PORT_SET" = "yes" ] && args+=(--port "$PP_PORT")
  [ "$PP_FORCE" = "yes" ] && args+=(--force)
  exec bash "$tmp" "${args[@]}"
}

do_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "Please run with sudo or as root."
  say "Removing PacketPilot"
  rm -f "$PP_LINK" "$PP_SITE"
  rm -rf "$PP_ROOT"
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
  ok "PacketPilot removed. nginx itself stays installed (remove with: apt purge nginx)."
}

do_extract() {
  [ -n "$PP_EXTRACT_DIR" ] || die "Specify a target folder: --extract ./web"
  mkdir -p "$PP_EXTRACT_DIR"
  write_files "$PP_EXTRACT_DIR"
  ok "Web files extracted to ${PP_EXTRACT_DIR}. Test e.g. with: python3 -m http.server -d ${PP_EXTRACT_DIR} 8080"
}

case "$PP_ACTION" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  extract)   do_extract ;;
esac
