#include <asm-generic/memory_model.h>
#include <asm/page.h>
#include <linux/dma-map-ops.h>
#include <linux/init.h>
#include <linux/printk.h>
#include <linux/memblock.h>
#include <linux/mm.h>
#include <linux/mmzone.h>

static char bootmem[0x100000] = { 0 }; // 1MB

void __init bootmem_init(void)
{
	memblock_add((phys_addr_t)&bootmem, sizeof(bootmem));

	early_printk("memory size: %u\n", memblock_phys_mem_size());
}

void __init zones_init(void)
{
	unsigned long max_zone_pfn[MAX_NR_ZONES] = { 0 };
	max_zone_pfn[ZONE_NORMAL] = max_low_pfn;
	free_area_init(max_zone_pfn);
	early_printk("zones_init\n");
};

void __init mem_init(void)
{
	early_printk("mem_init\n");
	memblock_free_all();
}
