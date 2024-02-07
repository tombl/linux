#include "linux/mm.h"
#include "linux/mmzone.h"
#include <asm-generic/memory_model.h>
#include <asm/page.h>
#include <linux/init.h>
#include <linux/memblock.h>

void __init setup_arch_memory(void)
{
	unsigned long max_zone_pfn[MAX_NR_ZONES] = {0};
	max_zone_pfn[ZONE_NORMAL] = max_low_pfn;
	free_area_init(max_zone_pfn);
}