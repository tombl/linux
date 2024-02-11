#include <asm-generic/memory_model.h>
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

__asm__(".globaltype __tls_align, i32, immutable\n"
	".globaltype __tls_size, i32, immutable\n");

void tls_init(void)
{
	void *tls;
	size_t tls_size, tls_align;

	__asm__("global.get __tls_align\n"
		"local.set %0\n"
		"global.get __tls_size\n"
		"local.set %1"
		: "=r"(tls_align), "=r"(tls_size));

	tls = kmalloc(tls_size, GFP_KERNEL); // TODO(wasm): this leaks
	pr_info("tls_init(%zu, %zu) = %lu\n", tls_size, tls_align,
		(uintptr_t)tls);

	if (!tls)
		panic("failed to allocate thread local storage");
	if (((uintptr_t)tls) & (tls_align - 1))
		panic("thread local storage is incorrectly aligned");

	__wasm_init_tls(tls);
}
