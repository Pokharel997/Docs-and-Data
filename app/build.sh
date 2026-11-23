#!/bin/bash
# Builds "Data & Docs.app". Pass --install to copy it into /Applications (or ~/Applications) and register it.
set -euo pipefail
cd "$(dirname "$0")"

NAME="Data & Docs"
APP="build/$NAME.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

echo "→ Compiling"
swiftc -O -target "$(uname -m)-apple-macos13.3" -o "$APP/Contents/MacOS/DataDocs" main.swift

echo "→ Bundling resources"
cp Info.plist "$APP/Contents/"
cp ../web/*.html ../web/*.css ../web/*.js ../web/*.svg "$APP/Contents/Resources/web/"

echo "→ Generating icon"
swift make-icon.swift build/icon.png
ICONSET=build/AppIcon.iconset && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) build/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "→ Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"

if [[ "${1:-}" == "--install" ]]; then
  DEST=/Applications
  [[ -w $DEST ]] || DEST="$HOME/Applications"
  mkdir -p "$DEST"
  rm -rf "$DEST/$NAME.app"
  ditto "$APP" "$DEST/$NAME.app"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/$NAME.app"
  echo "✓ Installed to $DEST/$NAME.app"
else
  echo "✓ Built $APP"
fi
