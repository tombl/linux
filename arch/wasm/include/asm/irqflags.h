#ifndef _WASM_IRQFLAGS_H
#define _WASM_IRQFLAGS_H

#include <asm/smp.h>
#include <linux/cache.h>
#include <linux/threads.h>

struct __wasm_irqflag {
	unsigned long flags ____cacheline_aligned;
};

extern struct __wasm_irqflag wasm_irqflags[NR_CPUS] __cacheline_aligned;

#define arch_local_irq_restore arch_local_irq_restore
static inline void arch_local_irq_restore(unsigned long flags)
{
	wasm_irqflags[raw_smp_processor_id()].flags = flags;
}

#define arch_local_save_flags arch_local_save_flags
static inline unsigned long arch_local_save_flags(void)
{
	return wasm_irqflags[raw_smp_processor_id()].flags;
}

#include <asm-generic/irqflags.h>

#endif
