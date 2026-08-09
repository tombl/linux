#include "sys/mman.h"

#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef PAGE_SIZE
#define PAGE_SIZE 4096
#endif

void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset) {
  (void)prot;
  if (length == 0) {
    errno = EINVAL;
    return MAP_FAILED;
  }

  /* Commit / decommit over a previously reserved region. */
  if ((flags & MAP_FIXED) && addr != NULL) {
    return addr;
  }

  if (!(flags & MAP_ANONYMOUS)) {
    /* File-backed map: read into RAM. */
    if (fd < 0) {
      errno = EBADF;
      return MAP_FAILED;
    }
    void *p = NULL;
    if (posix_memalign(&p, PAGE_SIZE, length) != 0) {
      errno = ENOMEM;
      return MAP_FAILED;
    }
    memset(p, 0, length);
    size_t got = 0;
    while (got < length) {
      ssize_t n = pread(fd, (char *)p + got, length - got, offset + (off_t)got);
      if (n < 0) {
        free(p);
        return MAP_FAILED;
      }
      if (n == 0) {
        break;
      }
      got += (size_t)n;
    }
    return p;
  }

  void *p = NULL;
  if (posix_memalign(&p, PAGE_SIZE, length) != 0) {
    errno = ENOMEM;
    return MAP_FAILED;
  }
  memset(p, 0, length);
  return p;
}

int munmap(void *addr, size_t length) {
  (void)length;
  free(addr);
  return 0;
}

int mprotect(void *addr, size_t len, int prot) {
  (void)addr;
  (void)len;
  (void)prot;
  return 0;
}

void *mremap(void *old_addr, size_t old_size, size_t new_size, int flags, ...) {
  (void)flags;
  if (new_size == old_size) {
    return old_addr;
  }
  void *p = realloc(old_addr, new_size);
  if (!p) {
    errno = ENOMEM;
    return MAP_FAILED;
  }
  if (new_size > old_size) {
    memset((char *)p + old_size, 0, new_size - old_size);
  }
  return p;
}

int madvise(void *addr, size_t length, int flags) {
  (void)addr;
  (void)length;
  (void)flags;
  return 0;
}
