#include <linux/cache.h>
#include <linux/cpumask.h>
#include <linux/export.h>
#include <linux/gfp_types.h>
#include <linux/panic.h>
#include <linux/printk.h>
#include <linux/slab.h>
#include <linux/threads.h>

extern size_t __per_cpu_size;
void *__per_cpu_offset[NR_CPUS] __read_mostly = { [0 ... NR_CPUS - 1] =
							  (void *)-1 };
EXPORT_SYMBOL(__per_cpu_offset);

bool __percpu_is_static(void *ptr)
{
	// TODO(wasm): just have a char[10000][NR_CPUS] for all static pcpu.
	// it'd make bounds checking much cheaper, and eliminate the early kmalloc
	int i;
	for_each_possible_cpu(i) {
		void *base = __per_cpu_offset[i];
		if (base == (void *)-1) continue;
		if (ptr >= base && ptr < (base + __per_cpu_size)) {
			return true;
		}
	}
	return false;
}

/**
 * pcpu_alloc - the percpu allocator
 * @size: size of area to allocate in bytes
 * @align: alignment of area (max PAGE_SIZE)
 * @reserved: allocate from the reserved chunk if available
 * @gfp: allocation flags
 *
 * Allocate percpu area of @size bytes aligned at @align.  If @gfp doesn't
 * contain %GFP_KERNEL, the allocation is atomic. If @gfp has __GFP_NOWARN
 * then no warning will be triggered on invalid or failed allocation
 * requests.
 *
 * RETURNS:
 * Percpu pointer to the allocated area on success, NULL on failure.
 */
static void __percpu *pcpu_alloc(size_t size, size_t align, bool reserved,
				 gfp_t gfp)
{
	void *ptr;
	// TODO(wasm): some allocators believe that pcpu_alloc works before
	// the main allocator is initialized. 
	// we'll eventually need an early buffer to hand chunks out of.
	ptr = kmalloc(size * NR_CPUS, gfp);
	BUG_ON(((uintptr_t)ptr) & (align - 1)); // incorrect alignment
	return ptr;
}

/**
 * __alloc_percpu_gfp - allocate dynamic percpu area
 * @size: size of area to allocate in bytes
 * @align: alignment of area (max PAGE_SIZE)
 * @gfp: allocation flags
 *
 * Allocate zero-filled percpu area of @size bytes aligned at @align.  If
 * @gfp doesn't contain %GFP_KERNEL, the allocation doesn't block and can
 * be called from any context but is a lot more likely to fail. If @gfp
 * has __GFP_NOWARN then no warning will be triggered on invalid or failed
 * allocation requests.
 *
 * RETURNS:
 * Percpu pointer to the allocated area on success, NULL on failure.
 */
void __percpu *__alloc_percpu_gfp(size_t size, size_t align, gfp_t gfp)
{
	return pcpu_alloc(size, align, false, gfp);
}
EXPORT_SYMBOL_GPL(__alloc_percpu_gfp);

/**
 * __alloc_percpu - allocate dynamic percpu area
 * @size: size of area to allocate in bytes
 * @align: alignment of area (max PAGE_SIZE)
 *
 * Equivalent to __alloc_percpu_gfp(size, align, %GFP_KERNEL).
 */
void __percpu *__alloc_percpu(size_t size, size_t align)
{
	return pcpu_alloc(size, align, false, GFP_KERNEL);
}
EXPORT_SYMBOL_GPL(__alloc_percpu);

void free_percpu(void __percpu *ptr)
{
	panic("free_percpu(%p) is unimplemented", ptr);
}
EXPORT_SYMBOL_GPL(free_percpu);
