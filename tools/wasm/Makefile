.SUFFIXES:
MAKEFLAGS += -r --no-print-directory

ifneq ($(V),1)
Q = @
endif

TSC ?= tsc
PERL ?= perl
TAR ?= tar
PACKAGE = linux.tgz
PACKAGE_DIR = npm-package
PACKAGE_VERSION ?=
BUILD_ASSETS = vmlinux.wasm

.PHONY: all clean pack
all: dist/index.js dist/index.d.ts vmlinux.wasm

clean:
	$(Q)rm -rf dist $(PACKAGE_DIR) $(PACKAGE) $(BUILD_ASSETS)

vmlinux.wasm:
	$(Q)$(MAKE) -C ../.. tools/wasm/vmlinux.wasm

dist/index.js dist/index.d.ts &: $(shell find src -type f)
	$(Q)$(TSC)

pack: clean $(PACKAGE)

$(PACKAGE): all package.json
	$(Q)rm -rf $(PACKAGE_DIR) $@
	$(Q)mkdir -p $(PACKAGE_DIR)/package
	$(Q)cp package.json $(PACKAGE_DIR)/package/
	$(Q)cp vmlinux.wasm $(PACKAGE_DIR)/package/
ifneq ($(PACKAGE_VERSION),)
	$(Q)$(PERL) -0pi -e 's/"version":\s*"[^"]+"/"version": "$(PACKAGE_VERSION)"/' $(PACKAGE_DIR)/package/package.json
endif
	$(Q)cp -r dist $(PACKAGE_DIR)/package/
	$(Q)$(TAR) --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -czf $@ -C $(PACKAGE_DIR) package
