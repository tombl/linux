#ifndef _WASM_PERCPU_H
#define _WASM_PERCPU_H

void *__percpu_section_remap(void __percpu *addr);

#define arch_remap_percpu_ptr(ptr) __percpu_section_remap(ptr)

#include <asm-generic/percpu.h>

#endif
