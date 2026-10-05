#!/usr/bin/env bash
# Baut aus src/ das eigenständige Installationsskript packetpilot-install.sh
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(cat VERSION)"
OUT="packetpilot-install.sh"
DELIM="__PACKETPILOT_FILE_END__"

if grep -rq "$DELIM" src; then echo "Der Trenner $DELIM kommt in src/ vor, bitte ändern." >&2; exit 1; fi

{
  sed "s/@@VERSION@@/${VERSION}/" installer/head.sh
  echo 'write_files() {'
  echo '  local W="$1"'
  find src -type f ! -name package.json | sort | while read -r f; do
    rel="${f#src/}"
    dir="$(dirname "$rel")"
    [ "$dir" != "." ] && echo "  mkdir -p \"\$W/${dir}\""
    echo "  cat > \"\$W/${rel}\" <<'${DELIM}'"
    cat "$f"
    # Sicherstellen, dass die Datei mit einem Zeilenumbruch endet
    [ -n "$(tail -c1 "$f")" ] && echo
    echo "${DELIM}"
  done
  echo '}'
  cat installer/tail.sh
} > "$OUT"
chmod +x "$OUT"
bash -n "$OUT"
echo "Gebaut: $OUT ($(du -h "$OUT" | cut -f1), Version ${VERSION})"
