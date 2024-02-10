dist/index.js: src/*.ts
	esbuild --bundle src/index.ts src/worker.ts --outdir=dist --format=esm --splitting --define:self.BUNDLED=true --sourcemap