.SUFFIXES:
MAKEFLAGS += -r --no-print-directory

ifneq ($(V),1)
Q = @
endif

ESBUILD ?= esbuild
TSC ?= tsc

.PHONY: all clean _kernel
all: dist/index.js dist/index.d.ts

clean:
	$(Q)rm -rf dist

_kernel:
	$(Q)$(MAKE) -C ../.. tools/wasm/src/build/vmlinux.wasm tools/wasm/src/build/sections.json tools/wasm/src/build/initramfs_data.cpio

dist/index.js: _kernel $(shell find src -type f)
	$(Q)$(ESBUILD) --bundle src/index.ts --outdir=dist --format=esm --splitting --sourcemap --loader:.wasm=file --loader:.img=file --loader:.cpio=binary

dist/index.d.ts: _kernel $(shell find src -type f -name '*.ts')
	$(Q)$(TSC)
