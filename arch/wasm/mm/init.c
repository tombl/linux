#include <asm-generic/memory_model.h>
#include <asm/page.h>
#include <linux/dma-map-ops.h>
#include <linux/init.h>
#include <linux/printk.h>
#include <linux/memblock.h>
#include <linux/mm.h>
#include <linux/mmzone.h>

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
	void *alloc;
	
	early_printk("mem_init\n");

	memblock_free_all();

	alloc = kmalloc(64, 0);
	early_printk("malloc() = %p\n", alloc);
}
