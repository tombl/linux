dist/index.js: src/*.ts
	esbuild --bundle src/index.ts --outdir=dist --format=esm --splitting --sourcemap --minify

all: dist/index.js
