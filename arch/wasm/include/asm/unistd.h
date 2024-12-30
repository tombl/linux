#define _WASM_UNISTD_H
#ifdef _WASM_UNISTD_H

#include <uapi/asm/unistd.h>

#define sys_mmap2 sys_mmap_pgoff
#define __ARCH_WANT_SYS_CLONE

#endif