#ifndef _WASM_PERCPU_H
#define _WASM_PERCPU_H

#define arch_remap_percpu_ptr(ptr) __percpu_section_remap(ptr)

#include <asm-generic/percpu.h>

void *__percpu_section_remap(const void __percpu *addr);

#endif
