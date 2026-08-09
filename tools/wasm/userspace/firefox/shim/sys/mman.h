#ifndef FIREFOX_WASM_SYS_MMAN_H
#define FIREFOX_WASM_SYS_MMAN_H
/* Firefox-local anonymous mmap shim for wasm32-unknown-linux-musl. */
#include <stddef.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C" {
#endif

#define MAP_FAILED ((void *)-1)
#define MAP_SHARED 0x01
#define MAP_PRIVATE 0x02
#define MAP_FIXED 0x10
#define MAP_ANON 0x20
#define MAP_ANONYMOUS MAP_ANON
#define MAP_NORESERVE 0x4000
#define MAP_STACK 0x20000

#define PROT_NONE 0
#define PROT_READ 1
#define PROT_WRITE 2
#define PROT_EXEC 4

#define MS_ASYNC 1
#define MS_INVALIDATE 2
#define MS_SYNC 4

#define MREMAP_MAYMOVE 1
#define MREMAP_FIXED 2

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset);
int munmap(void *addr, size_t length);
int mprotect(void *addr, size_t len, int prot);
void *mremap(void *old_addr, size_t old_size, size_t new_size, int flags, ...);
int madvise(void *addr, size_t length, int flags);

#ifdef __cplusplus
}
#endif
#endif
