#include <linux/memblock.h>
#include <linux/minmax.h>
#include <linux/mm.h>
#include <linux/panic.h>
#include <linux/spinlock.h>

static DEFINE_RAW_SPINLOCK(memory_grow_lock);

static void materialize_memory(unsigned long desired)
{
	unsigned long flags, current_pages, target;
	long previous;

	/* Linear memory never shrinks, so most calls need no lock. */
	if (__builtin_wasm_memory_size(0) >= desired)
		return;

	raw_spin_lock_irqsave(&memory_grow_lock, flags);
	current_pages = __builtin_wasm_memory_size(0);
	if (current_pages < desired) {
		/*
		 * At least double, up to the memory's maximum (max_pfn, from
		 * the devicetree; growth is exact until arch_zone_limits_init()
		 * sets it), so that the memory grows a handful of times in its
		 * life rather than once per allocation: in WebKit, growing a
		 * shared memory can crash the page while another worker
		 * destroys an instance of it. Depending on the engine and
		 * platform, the extra pages are committed or zeroed before the
		 * kernel uses them. If the engine cannot provide that much,
		 * settle for the request itself.
		 */
		target = max(desired, min(2 * current_pages, max_pfn));
		previous = __builtin_wasm_memory_grow(0, target - current_pages);
		if (previous < 0 && target != desired)
			previous = __builtin_wasm_memory_grow(0, desired - current_pages);
		if (previous < 0)
			panic("wasm: failed to grow kernel memory from %lu to %lu pages",
			      current_pages, desired);
	}
	raw_spin_unlock_irqrestore(&memory_grow_lock, flags);
}

void __init arch_memblock_materialize(phys_addr_t base, phys_addr_t size)
{
	materialize_memory(PFN_UP(base + size));
}

void arch_alloc_page(struct page *page, int order)
{
	materialize_memory(page_to_pfn(page) + (1UL << order));
}
