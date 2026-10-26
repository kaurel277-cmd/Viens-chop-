#!/bin/bash
cd "$(dirname "$0")"
NODE_PATH=../node_modules ../node_modules/.bin/tailwindcss \
  -c tailwind.config.js -i input.css -o ../assets/css/tailwind.css --minify
