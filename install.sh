#!/usr/bin/env bash
set -euo pipefail
UUID='bottom-window-bar@dabartmess.github.com'
SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DST="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$DST/schemas"
cp "$SRC/metadata.json" "$SRC/extension.js" "$SRC/prefs.js" "$SRC/stylesheet.css" "$DST/"
cp "$SRC/schemas/"*.gschema.xml "$DST/schemas/"
if ! command -v glib-compile-schemas >/dev/null 2>&1; then
    echo 'Missing glib-compile-schemas. Install package libglib2.0-bin.' >&2
    exit 1
fi
glib-compile-schemas "$DST/schemas"
echo "Installed to $DST"
echo 'If GNOME does not detect the new extension, log out and log back in (especially on Wayland).'
echo "Then run: gnome-extensions enable '$UUID'"
echo "Preferences: gnome-extensions prefs '$UUID'"
