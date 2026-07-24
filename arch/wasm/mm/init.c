#include <linux/init.h>
#include <linux/memblock.h>

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
