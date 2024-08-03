#ifndef _WASM_SECTIONS_H
#define _WASM_SECTIONS_H

#include <linux/types.h>

// https://github.com/llvm/llvm-project/blob/d2e4a725da5b4cbef8b5c1446f29fed1487aeab0/lld/wasm/Symbols.h#L515
extern void __global_base, __data_end;
extern void __stack_low, __stack_high;
extern void __heap_base, __heap_end;

extern void *__per_cpu_load, *__per_cpu_start, *__per_cpu_end;

static inline bool init_section_contains(void *virt, size_t size)
{
	return false;
}
static inline bool init_section_intersects(void *virt, size_t size) {
	return false;
}

static inline bool is_kernel_core_data(unsigned long addr)
{
	return addr >= (unsigned long)&__global_base &&
		addr < (unsigned long)&__data_end;
}
static inline bool is_kernel_rodata(unsigned long addr)
{
	return false;
}
static inline bool is_kernel_inittext(unsigned long addr)
{
	return false;
}
static inline bool __is_kernel_text(unsigned long addr) {
	return false;
}

static inline bool __is_kernel_inittext(unsigned long addr) {
	return false;
}

static inline bool __is_kernel(unsigned long addr) {
	return false;
}

#define dereference_function_descriptor(p) ((void *)(p))
#define dereference_kernel_function_descriptor(p) ((void *)(p))

#endif
