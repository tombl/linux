#ifndef _WASM_IO_H
#define _WASM_IO_H

#include <linux/types.h>
#include <linux/limits.h>

#define __raw_writeb __raw_writeb
static inline void __raw_writeb(u8 value, volatile void __iomem *addr)
{
	*(volatile u8 __force *)addr = value;
        __builtin_wasm_memory_atomic_notify((void*)addr, U32_MAX);
}

#define __raw_writew __raw_writew
static inline void __raw_writew(u16 value, volatile void __iomem *addr)
{
	*(volatile u16 __force *)addr = value;
        __builtin_wasm_memory_atomic_notify((void*)addr, U32_MAX);
}

#define __raw_writel __raw_writel
static inline void __raw_writel(u32 value, volatile void __iomem *addr)
{
	*(volatile u32 __force *)addr = value;
        __builtin_wasm_memory_atomic_notify((void*)addr, U32_MAX);
}

#include <asm-generic/io.h>

#endif