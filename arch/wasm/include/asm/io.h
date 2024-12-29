#ifndef _WASM_IO_H
#define _WASM_IO_H

#include <linux/types.h>
#include <linux/limits.h>
// #include "wasm_imports.h"

// void wasm_import(mmio, pre_read)(const volatile void __iomem *addr);
// void wasm_import(mmio, post_write)(const volatile void __iomem *addr);

#ifndef __raw_readb
#define __raw_readb __raw_readb
static inline u8 __raw_readb(const volatile void __iomem *addr)
{
	// wasm_mmio_pre_read(addr);
	return *(const volatile u8 __force *)addr;
}
#endif

#ifndef __raw_readw
#define __raw_readw __raw_readw
static inline u16 __raw_readw(const volatile void __iomem *addr)
{
	// wasm_mmio_pre_read(addr);
	return *(const volatile u16 __force *)addr;
}
#endif

#ifndef __raw_readl
#define __raw_readl __raw_readl
static inline u32 __raw_readl(const volatile void __iomem *addr)
{
	// wasm_mmio_pre_read(addr);
	return *(const volatile u32 __force *)addr;
}
#endif

#define __raw_writeb __raw_writeb
static inline void __raw_writeb(u8 value, volatile void __iomem *addr)
{
	*(volatile u8 __force *)addr = value;
	// wasm_mmio_post_write(addr);
}

#define __raw_writew __raw_writew
static inline void __raw_writew(u16 value, volatile void __iomem *addr)
{
	*(volatile u16 __force *)addr = value;
	// wasm_mmio_post_write(addr);
}

#define __raw_writel __raw_writel
static inline void __raw_writel(u32 value, volatile void __iomem *addr)
{
	*(volatile u32 __force *)addr = value;
	// wasm_mmio_post_write(addr);
}

#include <asm-generic/io.h>

#endif
