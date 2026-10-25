#ifndef _WASM_SIGNAL_H
#define _WASM_SIGNAL_H

#include <uapi/asm/signal.h>

#define __ARCH_UAPI_SA_FLAGS (SA_RESTORER | SA_WASM_CANCEL)

#endif
