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
    if grep -Iq . "$f"; then
      echo "  cat > \"\$W/${rel}\" <<'${DELIM}'"
      cat "$f"
      # Make sure the file ends with a newline
      [ -n "$(tail -c1 "$f")" ] && echo
    else
      # Binary files (fonts) travel as base64
      echo "  base64 -d > \"\$W/${rel}\" <<'${DELIM}'"
      base64 -w 76 "$f"
    fi
    echo "${DELIM}"
  done
  echo '}'
  cat installer/tail.sh
} > "$OUT"
chmod +x "$OUT"
bash -n "$OUT"

# The container deployment files name the same version as the installer
sed -i -E "s/^version: .*/version: ${VERSION}/; s/^appVersion: .*/appVersion: \"${VERSION}\"/" deploy/helm/packetpilot/Chart.yaml
sed -i -E "s#(image: ghcr.io/santiagotoro2023/packetpilot:)[0-9][^ ]*#\1${VERSION}#" deploy/kubernetes/packetpilot.yaml
# The design system starter kit (docs/design/kit) carries exact copies of the shared files
KIT=docs/design/kit
cp src/css/base.css "$KIT/css/base.css"
cp src/js/ui.js "$KIT/js/ui.js"
cp src/fonts/* "$KIT/fonts/"
sed -n '1,/^};$/p' src/js/icons.js > "$KIT/js/icons.js"
echo "Built: $OUT ($(du -h "$OUT" | cut -f1), version ${VERSION})"
