#ifndef _WASM_SYSMEM_H
#define _WASM_SYSMEM_H

void zones_init(void);
void early_tls_init(void);
void smp_tls_prepare(void);
void smp_tls_init(int cpu);

#endif
