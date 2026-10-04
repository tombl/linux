/* SPDX-License-Identifier: GPL-2.0 */
/*
 * Host-tool compatibility for building the wasm kernel on a macOS host.
 * Included via -include for usr/gen_init_cpio only (see usr/Makefile).
 * Darwin has neither O_LARGEFILE (files are always large-file capable)
 * nor copy_file_range(); provide a plain read/write loop with the same
 * contract gen_init_cpio relies on (returns bytes copied, -1 on error).
 */
#ifndef _WASM_MACOS_HOST_COMPAT_H
#define _WASM_MACOS_HOST_COMPAT_H
#ifdef __APPLE__
#include <sys/types.h>
#include <unistd.h>
#include <errno.h>
#ifndef O_LARGEFILE
#define O_LARGEFILE 0
#endif
static inline ssize_t copy_file_range(int fd_in, off_t *off_in, int fd_out,
				      off_t *off_out, size_t len, unsigned int flags)
{
	char buf[65536];
	size_t total = 0;
	(void)off_in; (void)off_out; (void)flags;
	while (total < len) {
		size_t want = len - total < sizeof(buf) ? len - total : sizeof(buf);
		ssize_t n = read(fd_in, buf, want);
		if (n < 0) {
			if (errno == EINTR)
				continue;
			return total ? (ssize_t)total : -1;
		}
		if (n == 0)
			break;
		for (ssize_t done = 0; done < n;) {
			ssize_t w = write(fd_out, buf + done, n - done);
			if (w < 0) {
				if (errno == EINTR)
					continue;
				return -1;
			}
			done += w;
		}
		total += n;
	}
	return total;
}
#endif /* __APPLE__ */
#endif
