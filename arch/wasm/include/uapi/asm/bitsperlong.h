#ifndef _WASM_BITSPERLONG_H
#define _WASM_BITSPERLONG_H

#define __kernel_size_t __kernel_size_t

typedef unsigned long __kernel_size_t;
typedef long __kernel_ssize_t;
typedef long __kernel_ptrdiff_t;

#include <asm-generic/bitsperlong.h>

#endif