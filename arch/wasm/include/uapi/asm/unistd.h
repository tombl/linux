#define _WASM_UNISTD_H
#ifdef _WASM_UNISTD_H

#define __ARCH_WANT_RENAMEAT
#define __ARCH_WANT_STAT64
#define __ARCH_WANT_SET_GET_RLIMIT
#define __ARCH_WANT_TIME32_SYSCALLS
#define __ARCH_WANT_SYNC_FILE_RANGE2
#define __ARCH_WANT_NO_MEMORY_SYSCALLS
#define __ARCH_WANT_NO_RT_SIGRETURN

#include <asm-generic/unistd.h>

#define __NR_set_thread_area (__NR_arch_specific_syscall + 0)
__SYSCALL(__NR_set_thread_area, sys_set_thread_area)

#endif
