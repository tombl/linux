#ifndef _WASM_SMP_H
#define _WASM_SMP_H

#ifdef CONFIG_SMP

#define raw_smp_processor_id() (current_thread_info()->cpu)

struct cpumask;
void arch_send_call_function_ipi_mask(const struct cpumask *mask);
void arch_send_call_function_single_ipi(int cpu);

#endif

#endif
