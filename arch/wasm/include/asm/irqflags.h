#ifndef _WASM_IRQFLAGS_H
#define _WASM_IRQFLAGS_H

#include <asm/wasm_imports.h>

#define arch_local_irq_save arch_local_irq_save
static inline unsigned long arch_local_irq_save(void)
{
	return wasm_get_irq_enabled();
}

#define arch_local_irq_restore arch_local_irq_restore
static inline void arch_local_irq_restore(unsigned long flags)
{
	wasm_set_irq_enabled(flags);
}

#define arch_local_irq_enable arch_local_irq_enable
static inline void arch_local_irq_enable(void)
{
	wasm_set_irq_enabled(1);
}

#define arch_local_irq_disable arch_local_irq_disable
static inline void arch_local_irq_disable(void)
{
	wasm_set_irq_enabled(0);
}

#define arch_local_save_flags arch_local_save_flags
static inline unsigned long arch_local_save_flags(void)
{
	return wasm_get_irq_enabled();
}

#include <asm-generic/irqflags.h>

#endif
