# SPDX-License-Identifier: MIT

.SUFFIXES:
MAKEFLAGS += -r --no-print-directory

ifneq ($(V),1)
Q = @
endif

TSC ?= tsc
NODE ?= node
HOSTCC ?= cc
PERL ?= perl
TAR ?= tar
PACKAGE = linux.tgz
PACKAGE_DIR = npm-package
PACKAGE_VERSION ?=
BUILD_ASSETS = vmlinux.wasm

.PHONY: all check clean pack vmlinux.wasm
all: dist/index.js dist/index.d.ts vmlinux.wasm

check: dist/index.js dist/index.d.ts
	$(Q)$(TSC) -p test
	$(Q)$(NODE) --test

clean:
	$(Q)rm -rf dist $(PACKAGE_DIR) $(PACKAGE) $(BUILD_ASSETS)

vmlinux.wasm:
	$(Q)$(MAKE) -C ../.. HOSTCC="$(HOSTCC)" tools/wasm/vmlinux.wasm

dist/index.js dist/index.d.ts &: $(shell find src -type f)
	$(Q)$(TSC)

pack:
	$(Q)rm -rf $(PACKAGE_DIR) $(PACKAGE) $(BUILD_ASSETS)
	$(Q)$(MAKE) $(PACKAGE)

$(PACKAGE): all package.json README.md LICENSE
	$(Q)rm -rf $(PACKAGE_DIR) $@
	$(Q)mkdir -p $(PACKAGE_DIR)/package
	$(Q)cp package.json $(PACKAGE_DIR)/package/
	$(Q)cp README.md LICENSE $(PACKAGE_DIR)/package/
	$(Q)cp vmlinux.wasm $(PACKAGE_DIR)/package/
ifneq ($(PACKAGE_VERSION),)
	$(Q)$(PERL) -0pi -e 's/"version":\s*"[^"]+"/"version": "$(PACKAGE_VERSION)"/' $(PACKAGE_DIR)/package/package.json
endif
	$(Q)cp -r dist $(PACKAGE_DIR)/package/
	$(Q)$(TAR) --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -czf $@ -C $(PACKAGE_DIR) package
