#!/usr/bin/env bash
# Builds the standalone installer script packetpilot-install.sh from src/
set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(cat VERSION)"
OUT="packetpilot-install.sh"
DELIM="__PACKETPILOT_FILE_END__"

if grep -rq "$DELIM" src; then echo "The delimiter $DELIM occurs in src/, please change it." >&2; exit 1; fi

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
    # Make sure the file ends with a newline
    [ -n "$(tail -c1 "$f")" ] && echo
    echo "${DELIM}"
  done
  echo '}'
  cat installer/tail.sh
} > "$OUT"
chmod +x "$OUT"
bash -n "$OUT"
echo "Built: $OUT ($(du -h "$OUT" | cut -f1), version ${VERSION})"
