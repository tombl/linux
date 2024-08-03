#include <asm/globals.h>
#include <asm/sysmem.h>
#include <linux/cpumask.h>
#include <linux/log2.h>
#include <linux/memblock.h>
#include <linux/slab.h>

extern void __wasm_init_tls(void *location);
size_t __per_cpu_size;

void early_tls_init(void)
{
	void *tls = __builtin_wasm_tls_base();
	BUG_ON(xchg(&__per_cpu_offset[0], tls) != (void *)-1);
}

void smp_tls_prepare(void)
{
	int cpu;
	for_each_possible_cpu(cpu) {
		void *tls;
		if (cpu == 0)
			continue;

		tls = memblock_alloc(__per_cpu_size,
				     __builtin_wasm_tls_align());
		if (!tls)
			panic("failed to allocate thread local storage: %i\n",
			      cpu);
		BUG_ON(xchg(&__per_cpu_offset[cpu], tls) != (void *)-1);
	}

#if 0
	for_each_possible_cpu(cpu)
		pr_info("tls %i\t= %p", cpu, __per_cpu_offset[cpu]);
#endif
}

void smp_tls_init(int cpu, bool init)
{
	void* tls = __per_cpu_offset[cpu];
	BUG_ON(tls == (void *)-1);
	if (init)
		__wasm_init_tls(tls);
	else
		set_tls_base(tls);
}
