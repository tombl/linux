LD = $(LLVM_PREFIX)wasm-ld$(LLVM_SUFFIX)

WASM_FEATURES = -matomics -mbulk-memory -mexception-handling -mextended-const -mmultivalue -mmutable-globals -mnontrapping-fptoint -mreference-types -mrelaxed-simd -msign-ext -msimd128

cflags-y += -Wno-incompatible-library-redeclaration '-D__builtin_return_address=wasm_kernel_return_address' $(WASM_FEATURES) -mllvm -wasm-enable-sjlj
ldflags-y += --import-memory --max-memory=4294967296 --shared-memory --no-merge-data-segments

KBUILD_CFLAGS += $(cflags-y)
KBUILD_AFLAGS += $(aflags-y)
KBUILD_LDFLAGS += $(ldflags-y)

drivers-y += arch/wasm/drivers/

arch/wasm/vmlinux.wat: vmlinux.o
	$(Q)wasm2wat $< --enable-all -o $@

arch/wasm/sections.json: arch/wasm/scripts/sections.pl arch/wasm/vmlinux.wat
	$(Q)$(PERL) arch/wasm/scripts/sections.pl <arch/wasm/vmlinux.wat >$@

tools/wasm/src/build/vmlinux.wasm: vmlinux.o
	$(Q)mkdir -p tools/wasm/src/build
	$(Q)cp $< $@

tools/wasm/src/build/sections.json: arch/wasm/sections.json
	$(Q)mkdir -p tools/wasm/src/build
	$(Q)cp $< $@

define archhelp
  echo  '* tools/wasm       - WebAssembly host library'
endef
