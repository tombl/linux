#ifndef _WASM_PGTABLE_H
#define _WASM_PGTABLE_H

#include <asm/page.h>
#include <asm-generic/pgtable-nopmd.h>

#define swapper_pg_dir ((pgd_t *)0)

#define _PAGE_PRESENT (1 << 0)
#define _PAGE_DIRTY (1 << 1)
#define _PAGE_ACCESSED (1 << 2)
#define _PAGE_READ (1 << 3)
#define _PAGE_WRITE (1 << 4)
#define _PAGE_EXECUTE (1 << 5)
#define _PAGE_USER (1 << 6)

#define PAGE_NONE __pgprot(_PAGE_PRESENT | _PAGE_USER)
#define PAGE_READONLY \
	__pgprot(_PAGE_PRESENT | _PAGE_USER | _PAGE_READ | _PAGE_EXECUTE)
#define PAGE_COPY PAGE_READONLY
#define PAGE_EXEC \
	__pgprot(_PAGE_PRESENT | _PAGE_USER | _PAGE_READ | _PAGE_EXECUTE)
#define PAGE_COPY_EXEC PAGE_EXEC
#define PAGE_SHARED                                        \
	__pgprot(_PAGE_PRESENT | _PAGE_USER | _PAGE_READ | \
		 _PAGE_EXECUTE | \ _PAGE_WRITE)
#define PAGE_KERNEL \
	__pgprot(_PAGE_PRESENT | _PAGE_READ | _PAGE_WRITE | _PAGE_EXECUTE)

#define VMALLOC_START 0
#define VMALLOC_END 0xffffffff
#define KMAP_START 0
#define KMAP_END 0xffffffff
#define HAVE_ARCH_UNMAPPED_AREA

extern unsigned long empty_zero_page[PAGE_SIZE / sizeof(unsigned long)];
#define ZERO_PAGE(vaddr) (virt_to_page(empty_zero_page))

#endif
