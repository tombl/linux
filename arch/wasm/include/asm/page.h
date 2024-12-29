#ifndef _WASM_PAGE_H
#define _WASM_PAGE_H

#include <linux/pfn.h>
#include <asm-generic/memory_model.h>

#define PAGE_SHIFT 16 // 64KiB pages
#define PAGE_SIZE (1UL << PAGE_SHIFT)
#define PAGE_MASK (~(PAGE_SIZE - 1))

#define PAGE_OFFSET _AC(CONFIG_DEFAULT_MEM_START, UL)
#define PHYS_OFFSET _AC(CONFIG_DEFAULT_MEM_START, UL)

#define clear_page(pgaddr) memset((pgaddr), 0, PAGE_SIZE)
#define copy_page(to, from) memcpy((to), (from), PAGE_SIZE)

#define clear_user_page(pgaddr, vaddr, page) clear_page(pgaddr)
#define copy_user_page(vto, vfrom, vaddr, topg) \
	memcpy((vto), (vfrom), PAGE_SIZE)

typedef struct {
	/* page table entry */
	unsigned long pte;
} pte_t;

typedef struct {
	/* page global directory */
	unsigned long pgd;
} pgd_t;
typedef struct {
	/* page protection */
	unsigned long pgprot;
} pgprot_t;

typedef struct page *pgtable_t;

/* 
 * null implementations from asm-generic/pgtable-nopmd.h:
 * pmd_t - page middle directory entry
 * p4d_t - page 4 directory entry
 */

#define pte_val(x) ((x).pte)
#define pgd_val(x) ((x).pgd)
#define pgprot_val(x) ((x).pgprot)
#define __pte(x) ((pte_t){ (x) })
#define __pgd(x) ((pgd_t){ (x) })
#define __pgprot(x) ((pgprot_t){ (x) })

/* convert virtual address to physical address */
#define __pa(virt) ((unsigned long)(virt)-PAGE_OFFSET + PHYS_OFFSET)

/* convert physical address to virtual address */
#define __va(phys) ((void *)((unsigned long)(phys)-PHYS_OFFSET + PAGE_OFFSET))

#define virt_to_page(kaddr) pfn_to_page(__pa(kaddr) >> PAGE_SHIFT)
#define page_to_virt(page) __va(page_to_pfn(page) << PAGE_SHIFT)
#define virt_addr_valid(kaddr) pfn_valid(__pa(kaddr) >> PAGE_SHIFT)
#define page_to_phys(page) (page_to_pfn(page) << PAGE_SHIFT)

#define pfn_valid(pfn) ((pfn) < max_mapnr)

struct page;
void arch_alloc_page(struct page *page, int order);
#define HAVE_ARCH_ALLOC_PAGE

#include <asm-generic/getorder.h>

#endif
