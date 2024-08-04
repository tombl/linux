#ifndef _WASM_SMP_H
#define _WASM_SMP_H

#include "globals.h"

#ifdef CONFIG_SMP

#define raw_smp_processor_id() get_current_cpu()

struct cpumask;
void arch_send_call_function_ipi_mask(const struct cpumask *mask);
void arch_send_call_function_single_ipi(int cpu);

#endif

#endif
