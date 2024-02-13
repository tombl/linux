#ifndef _WASM_IRQFLAGS_H
#define _WASM_IRQFLAGS_H

#include <asm/wasm_imports.h>

#define arch_local_irq_restore arch_local_irq_restore
static inline void arch_local_irq_restore(unsigned long flags)
{
	wasm_set_irq_enabled(flags);
}

#define arch_local_save_flags arch_local_save_flags
static inline unsigned long arch_local_save_flags(void)
{
	return wasm_get_irq_enabled();
}

#include <asm-generic/irqflags.h>

#endif
