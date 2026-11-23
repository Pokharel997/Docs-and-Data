#!/bin/bash
# Builds the browser extension into extension/dist (load it at chrome://extensions → Load unpacked).
#   bash extension/build.sh          → extension/dist
#   bash extension/build.sh --zip    → also extension/data-docs-extension.zip
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
cp ../web/*.html ../web/*.css ../web/*.js ../web/*.svg dist/
cp manifest.json background.js dist/
cp -R icons dist/
# ext.js (viewer ↔ desktop app) runs before extras.js, which starts the page
python3 - <<'EOF'
p = 'dist/index.html'
s = open(p, encoding='utf-8').read()
s = s.replace('<script src="extras.js"></script>', '<script src="ext.js"></script>\n<script src="extras.js"></script>')
s = s.replace('<title>Docs &amp; Data</title>', '<title>New tab · Docs &amp; Data</title>')
open(p, 'w', encoding='utf-8').write(s)
EOF
if [[ "${1:-}" == "--zip" ]]; then
  rm -f data-docs-extension.zip
  (cd dist && zip -qr ../data-docs-extension.zip .)
  echo "extension/data-docs-extension.zip"
fi
echo "Built extension/dist"
