#ifndef _WASM_IRQ_H
#define _WASM_IRQ_H

#define IPI_IRQ 1
#define TIMER_IRQ 2
#define FIRST_EXT_IRQ 3
#define NR_IRQS 256

int wasm_alloc_irq(void);
void wasm_free_irq(int irq);

#include <asm-generic/irq.h>

#endif