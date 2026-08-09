/* wasm32 musl hides fork(); Rust std / libc still reference the symbol.
 * Provide an ENOSYS stub so we can link. Aurora uses posix_spawn for PTYs. */
#include <errno.h>
#include <sys/types.h>
#include <unistd.h>

pid_t fork(void) {
  errno = ENOSYS;
  return -1;
}
