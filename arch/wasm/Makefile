LD = $(LLVM_PREFIX)wasm-ld$(LLVM_SUFFIX)

WASM_FEATURES = -matomics -mbulk-memory -mextended-const -mmultivalue -mmutable-globals -mnontrapping-fptoint -mreference-types -msign-ext -msimd128

cflags-y += -Wno-incompatible-library-redeclaration -D__DISABLE_EXPORTS '-D__builtin_return_address=wasm_kernel_return_address' $(WASM_FEATURES) -mllvm -wasm-enable-sjlj
aflags-y += -D__DISABLE_EXPORTS
ldflags-y += --import-memory --max-memory=4294967296 --shared-memory --no-merge-data-segments --export-table

KBUILD_CFLAGS += $(cflags-y)
KBUILD_AFLAGS += $(aflags-y)
KBUILD_LDFLAGS += $(ldflags-y)

drivers-y += arch/wasm/drivers/
libs-y += arch/wasm/lib/

quiet_cmd_wasm2wat = WAT     $@
      cmd_wasm2wat = wasm2wat $< --enable-all -o $@

arch/wasm/vmlinux.wat: vmlinux.o FORCE
	$(call if_changed,wasm2wat)

quiet_cmd_wasm_sections = GEN     $@
      cmd_wasm_sections = $(PERL) arch/wasm/scripts/sections.pl <$< >$@

arch/wasm/sections.json: arch/wasm/vmlinux.wat arch/wasm/scripts/sections.pl FORCE
	$(call if_changed,wasm_sections)

quiet_cmd_wasm_objcopy = OBJCOPY $@
      cmd_wasm_objcopy = $(OBJCOPY) \
		--add-section=.linux.sections=arch/wasm/sections.json \
		--add-section=.linux.initramfs=usr/initramfs_inc_data \
		$< $@

vmlinux.wasm: vmlinux.o arch/wasm/sections.json FORCE
	$(call if_changed,wasm_objcopy)

define archhelp
  echo  '* vmlinux.wasm     - WebAssembly kernel image'
endef
