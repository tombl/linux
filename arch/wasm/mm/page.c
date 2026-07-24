#include <linux/mm.h>
#include <linux/panic.h>
#include <linux/spinlock.h>

static DEFINE_RAW_SPINLOCK(memory_grow_lock);

static void materialize_memory(unsigned long desired)
{
	unsigned long flags, current_pages;
	long previous;

	raw_spin_lock_irqsave(&memory_grow_lock, flags);
	current_pages = __builtin_wasm_memory_size(0);
	if (current_pages < desired) {
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
