ESBUILD ?= esbuild

all: dist/index.js

dist/index.js: src/*.ts
	$(ESBUILD) --bundle src/index.ts --outdir=dist --format=esm --splitting --sourcemap --minify

