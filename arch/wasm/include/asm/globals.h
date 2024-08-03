#ifndef _WASM_GLOBALS_H
#define _WASM_GLOBALS_H

__asm__(".globaltype __stack_pointer, i32\n");
static inline void set_stack_pointer(void *ptr)
{
	__asm__ volatile("local.get %0\n"
			 "global.set __stack_pointer" ::"r"(ptr));
}

__asm__(".globaltype __tls_base, i32\n");
static inline void set_tls_base(void *ptr)
{
	__asm__ volatile("local.get %0\n"
			 "global.set __tls_base" ::"r"(ptr));
}

#endif
