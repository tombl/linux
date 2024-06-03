#include <linux/mm.h>
#include <linux/panic.h>

// This function is currently useless because the initial and maximum sizes
// are set to the same value. I did that because it seems the page allocator
// is starting from the end of memory and working its way down, which makes
// growing useless anyway.
void arch_alloc_page(struct page *page, int order)
{
	unsigned long desired = page_to_pfn(page),
		      size = __builtin_wasm_memory_size(0);

	if (size < desired)
		if (__builtin_wasm_memory_grow(0, desired - size) < 0)
			pr_err("failed to grow memory\n");
}
