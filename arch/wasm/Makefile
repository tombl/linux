LD = $(LLVM_PREFIX)wasm-ld$(LLVM_SUFFIX)

WASM_FEATURES = -matomics -mbulk-memory -mexception-handling -mextended-const -mmultivalue -mmutable-globals -mnontrapping-fptoint -mreference-types -mrelaxed-simd -msign-ext -msimd128

cflags-y += -Wno-incompatible-library-redeclaration '-D__builtin_return_address=wasm_return_address' $(WASM_FEATURES) -mllvm -wasm-enable-sjlj
ldflags-y += --import-memory --max-memory=4294967296 --shared-memory --no-merge-data-segments

KBUILD_CFLAGS += $(cflags-y)
KBUILD_AFLAGS += $(aflags-y)
KBUILD_LDFLAGS += $(ldflags-y)

drivers-y += arch/wasm/drivers/

all: arch/wasm/vmlinux.wasm tools/wasm/sections.json

arch/wasm/vmlinux.wasm: vmlinux.o
	$(Q)cp vmlinux.o $@

tools/wasm/vmlinux.wasm: vmlinux.o
	$(Q)cp vmlinux.o $@

vmlinux.o.wat: vmlinux.o
	$(Q)wasm2wat $< --enable-all -o $@

tools/wasm/sections.json: arch/wasm/scripts/sections.pl vmlinux.o.wat
	$(Q)$(PERL) ./arch/wasm/scripts/sections.pl <vmlinux.o.wat >$@

define archhelp
  echo  '* vmlinux.wasm       - Kernel binary (arch/$(ARCH)/vmlinux.wasm)'
endef
