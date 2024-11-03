#ifndef _WASM_IRQ_H
#define _WASM_IRQ_H

#define IPI_IRQ 1
#define FIRST_EXT_IRQ 2
#define NR_IRQS 64

int wasm_alloc_irq(void);
void wasm_free_irq(int irq);

#include <asm-generic/irq.h>

#endif