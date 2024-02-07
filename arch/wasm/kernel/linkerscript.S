# This file is a replacement for the regular linker script,
# as linker scripts are unsupported by wasm-ld.

# It declares a bunch of global variables that are used
# by the kernel to identify sections of memory.

# Reference: asm-generic/sections.h, asm-generic/vmlinux.lds.h

	.text
	.section .data,"",@

jiffies:
	.int32 0
	.size jiffies, 4

	.section custom_section_name, "", @
custom_data:
	.string "This is custom data in a custom section."
	.size custom_data, . - custom_data