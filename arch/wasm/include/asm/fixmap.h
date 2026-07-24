#ifndef _WASM_FIXMAP_H
#define _WASM_FIXMAP_H

#include <linux/threads.h>
#include <asm/kmap_size.h>

enum fixed_addresses {
#ifdef CONFIG_HAVE_TCM
	FIX_TCM = TCM_NR_PAGES,
#endif
#ifdef CONFIG_HIGHMEM
	FIX_KMAP_BEGIN,
	FIX_KMAP_END = FIX_KMAP_BEGIN + (KM_MAX_IDX * NR_CPUS) - 1,
#endif
	__end_of_fixed_addresses
};

#define FIXADDR_TOP 0xfe000000
#define FIXADDR_SIZE (__end_of_fixed_addresses << PAGE_SHIFT)
#define FIXADDR_START (FIXADDR_TOP - FIXADDR_SIZE)

#include <asm-generic/fixmap.h>

#endif
