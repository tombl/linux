#include <asm/globals.h>
#include <asm/sysmem.h>
#include <linux/cpumask.h>
#include <linux/log2.h>
#include <linux/slab.h>

extern void __wasm_init_tls(void *location);
extern size_t __per_cpu_size;

void early_tls_init(void)
{
	void *tls;
	__per_cpu_size = __roundup_pow_of_two(__builtin_wasm_tls_size());
	tls = __builtin_alloca(__per_cpu_size);
	__per_cpu_offset[0] = tls;
	__wasm_init_tls(tls);
}

void smp_tls_prepare(void)
{
	int cpu;
	size_t align = __builtin_wasm_tls_align();
	size_t size = __per_cpu_size;

	for_each_possible_cpu(cpu) {
		void *tls;
		if (cpu == 0)
			continue;

		tls = kzalloc(size, 0);
		if (!tls)
			panic("failed to allocate thread local storage: %i\n",
			      cpu);
		if (((uintptr_t)tls) & (align - 1))
			panic("thread local storage is incorrectly aligned: %i\n",
			      cpu);

		BUG_ON(__per_cpu_offset[cpu] != (void *)-1);
		__per_cpu_offset[cpu] = tls;
	}

#if 0
	for_each_possible_cpu(cpu)
		pr_info("tls %i\t= %p", cpu, __per_cpu_offset[cpu]);
#endif
}



void smp_tls_init(int cpu, bool init)
{
	BUG_ON(__per_cpu_offset[cpu] == (void *)-1);
	if (init) {
		set_tls_base(__per_cpu_offset[cpu]);
	} else {
		__wasm_init_tls((void *)__per_cpu_offset[cpu]);
	}
}
