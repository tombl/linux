#include <asm/sysmem.h>
#include <linux/init.h>
#include <linux/memblock.h>
#include <linux/mm_types.h>
#include <linux/slab.h>

int wasm_mm_init_context(struct mm_struct *mm)
{
	/*
	 * The mm may have been memcpy'd from its parent (dup_mm); the
	 * cmdline copy belongs to the old image and must not be shared.
	 * binfmt_wasm installs a fresh copy at exec time.
	 */
	mm->context.cmdline = NULL;
	mm->context.cmdline_len = 0;
	return 0;
}

void wasm_mm_destroy_context(struct mm_struct *mm)
{
	kfree(mm->context.cmdline);
	mm->context.cmdline = NULL;
	mm->context.cmdline_len = 0;
}

void __init zones_init(void)
{
	unsigned long max_zone_pfn[MAX_NR_ZONES] = { 0 };

	max_low_pfn = PHYS_PFN(memblock_end_of_DRAM());
	max_pfn = max_low_pfn;
	max_mapnr = max_pfn;

	max_zone_pfn[ZONE_NORMAL] = max_low_pfn;
#ifdef CONFIG_HIGHMEM
	max_zone_pfn[ZONE_HIGHMEM] = max_pfn;
#endif

	free_area_init(max_zone_pfn);
};

void __init mem_init(void)
{
	memblock_free_all();
}
