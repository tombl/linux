.SUFFIXES:
MAKEFLAGS += -r --no-print-directory

ifneq ($(V),1)
Q = @
endif

ESBUILD ?= esbuild
TSC ?= tsc
NPM ?= npm
PACKAGE = linux.tgz
PACKAGE_DIR = npm-package
PACKAGE_VERSION ?=

.PHONY: all clean pack _kernel
all: dist/index.js dist/index.d.ts

clean:
	$(Q)rm -rf dist $(PACKAGE_DIR) $(PACKAGE)

_kernel:
	$(Q)$(MAKE) -C ../.. tools/wasm/src/build/vmlinux.wasm tools/wasm/src/build/sections.json
	$(Q)$(MAKE) -C ../.. tools/wasm/src/build/initramfs_data.cpio

dist/index.js: _kernel $(shell find src -type f)
	$(Q)$(ESBUILD) --bundle src/index.ts --outdir=dist --format=esm --splitting --sourcemap --loader:.wasm=file --loader:.img=file --loader:.cpio=binary

dist/index.d.ts: _kernel $(shell find src -type f -name '*.ts')
	$(Q)$(TSC)

pack: clean $(PACKAGE)

$(PACKAGE): all package.json
	$(Q)rm -rf $(PACKAGE_DIR) $@
	$(Q)mkdir -p $(PACKAGE_DIR)
	$(Q)cp package.json $(PACKAGE_DIR)/
ifneq ($(PACKAGE_VERSION),)
	$(Q)cd $(PACKAGE_DIR) && $(NPM) version --no-git-tag-version "$(PACKAGE_VERSION)" >/dev/null
endif
	$(Q)cp -r dist $(PACKAGE_DIR)/
	$(Q)cd $(PACKAGE_DIR) && npm_config_cache="$${TMPDIR:-..}/npm-cache" $(NPM) pack --pack-destination ..
	$(Q)mv *.tgz $@
