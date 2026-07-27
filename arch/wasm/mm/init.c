#include <linux/init.h>
#include <linux/memblock.h>
#include <linux/mm.h>
#include <linux/slab.h>

int wasm_init_new_context(struct task_struct *tsk, struct mm_struct *mm)
{
	/*
	 * dup_mm() copied this from the parent, but a fork never inherits
	 * pending exec state.
	 */
	mm->context.exec_args = NULL;
	return 0;
}

void wasm_destroy_context(struct mm_struct *mm)
{
	kfree(mm->context.exec_args);
}

void __init arch_zone_limits_init(unsigned long *max_zone_pfn)
{
	max_low_pfn = PHYS_PFN(memblock_end_of_DRAM());
	max_pfn = max_low_pfn;
	max_mapnr = max_pfn;

	max_zone_pfn[ZONE_NORMAL] = max_low_pfn;
#ifdef CONFIG_HIGHMEM
	max_zone_pfn[ZONE_HIGHMEM] = max_pfn;
#endif
}

void __init mem_init(void)
{
}
