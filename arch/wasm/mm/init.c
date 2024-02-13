#include <asm/page.h>
#include <asm/sysmem.h>
#include <linux/bug.h>
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
	pr_info("mem_init\n");

	memblock_free_all();

	tls_init();
}

extern void __wasm_init_tls(void *location);

void* tls_per_cpu[NR_CPUS] = {0};
void tls_init(void)
{
	size_t tls_size = __builtin_wasm_tls_size(), tls_align = __builtin_wasm_tls_align();
	void *tls = kmalloc(tls_size, GFP_KERNEL);

	pr_info("tls_init(%lu, %lu) = %p\n", tls_size, tls_align, tls);

	if (!tls)
		panic("failed to allocate thread local storage");
	if (((uintptr_t)tls) & (tls_align - 1))
		panic("thread local storage is incorrectly aligned");

	__wasm_init_tls(tls);

	tls_per_cpu[smp_processor_id()] = tls;
}

#ifdef CONFIG_SMP
void __init setup_per_cpu_areas(void) {}
#endif