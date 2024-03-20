#ifndef _WASM_GLOBALS
#define _WASM_GLOBALS

#include <linux/compiler_attributes.h>

__asm__(".globaltype __stack_pointer, i32\n");
static void __always_inline set_stack_pointer(void *ptr)
{
	__asm__ volatile("local.get %0\n"
			 "global.set __stack_pointer" ::"r"(ptr));
}

__asm__(".globaltype __tls_base, i32\n");
static void __always_inline set_tls_base(void *ptr)
{
	__asm__ volatile("local.get %0\n"
			 "global.set __tls_base" ::"r"(ptr));
}

#endif