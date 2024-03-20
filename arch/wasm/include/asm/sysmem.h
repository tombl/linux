#ifndef _WASM_SYSMEM_H
#define _WASM_SYSMEM_H

#include <linux/types.h>

void zones_init(void);
void early_tls_init(void);
void smp_tls_prepare(void);
void smp_tls_init(int cpu, bool init);

#endif
