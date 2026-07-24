#ifndef _WASM_HIGHMEM_H
#define _WASM_HIGHMEM_H

#include <asm-generic/kmap_size.h>
#include <asm-generic/fixmap.h>

#define LAST_PKMAP 1024
#define LAST_PKMAP_MASK (LAST_PKMAP - 1)
#define PKMAP_NR(virt) ((virt - PKMAP_BASE) >> PAGE_SHIFT)
#define PKMAP_ADDR(nr) (PKMAP_BASE + ((nr) << PAGE_SHIFT))

#define PKMAP_BASE (FIXADDR_START - PAGE_SIZE * LAST_PKMAP)

#endif