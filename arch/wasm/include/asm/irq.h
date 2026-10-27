#ifndef _WASM_IRQ_H
#define _WASM_IRQ_H

#include <linux/types.h>

#define IPI_IRQ 1
#define TIMER_IRQ 2
#define FIRST_EXT_IRQ 3
#define NR_IRQS 256

int wasm_alloc_irq(void);
void wasm_free_irq(int irq);
u64 wasm_get_timer_deadline(void);
void wasm_timer_check(void);

/* Exported to the host, which raises interrupts with them too. */
void trigger_irq(irq_hw_number_t irq);
void trigger_irq_for_cpu(unsigned int cpu, irq_hw_number_t irq);

#include <asm-generic/irq.h>

#endif
