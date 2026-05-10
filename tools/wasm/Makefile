.SUFFIXES:
MAKEFLAGS += -r --no-print-directory

ifneq ($(V),1)
Q = @
endif

TSC ?= tsc
NPM ?= npm
PACKAGE = linux.tgz
PACKAGE_DIR = npm-package
PACKAGE_VERSION ?=
BUILD_ASSETS = vmlinux.wasm

.PHONY: all clean pack _kernel
all: dist/index.js dist/index.d.ts _kernel

clean:
	$(Q)rm -rf dist $(PACKAGE_DIR) $(PACKAGE) $(BUILD_ASSETS)

_kernel:
	$(Q)$(MAKE) -C ../.. tools/wasm/vmlinux.wasm

dist/index.js dist/index.d.ts &: $(shell find src -type f)
	$(Q)$(TSC)

pack: clean $(PACKAGE)

$(PACKAGE): all package.json
	$(Q)rm -rf $(PACKAGE_DIR) $@
	$(Q)mkdir -p $(PACKAGE_DIR)
	$(Q)cp package.json $(PACKAGE_DIR)/
	$(Q)cp vmlinux.wasm $(PACKAGE_DIR)/
ifneq ($(PACKAGE_VERSION),)
	$(Q)cd $(PACKAGE_DIR) && $(NPM) version --no-git-tag-version "$(PACKAGE_VERSION)" >/dev/null
endif
	$(Q)cp -r dist $(PACKAGE_DIR)/
	$(Q)cd $(PACKAGE_DIR) && npm_config_cache="$${TMPDIR:-..}/npm-cache" $(NPM) pack --pack-destination ..
	$(Q)mv *.tgz $@
