#!/bin/sh
npm ci

esbuild xterm/src.js --bundle --format=esm --outfile=xterm/dist.js
cp node_modules/@xterm/xterm/css/xterm.css xterm/xterm.css
