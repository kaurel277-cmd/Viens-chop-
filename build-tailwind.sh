#!/usr/bin/env bash
# Recompile Tailwind (aucun CDN, tout est local).
#   npm i -D tailwindcss@3
#   ./build-tailwind.sh
set -e
cd "$(dirname "$0")"
BIN="./node_modules/.bin/tailwindcss"
[ -x "$BIN" ] || BIN="/home/user/audit/node_modules/.bin/tailwindcss"
echo "@tailwind base;
@tailwind components;
@tailwind utilities;" > /tmp/vc-input.css
"$BIN" -c tailwind.config.js -i /tmp/vc-input.css --minify -o assets/css/tailwind.css
echo "tailwind.css : $(du -h assets/css/tailwind.css | cut -f1)"
