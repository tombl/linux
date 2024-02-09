/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _LINUX_INITCALLS_H
#define _LINUX_INITCALLS_H

#include <linux/init.h>

#if __has_include(<generated/initcalls.h>)
# include <generated/initcalls.h>
#else
# warning no initcalls, you need to build twice.
# define enumerate_setup(X)
# define enumerate_initcallearly(X)
# define enumerate_initcallconsole(X)
# define enumerate_initcall(X)
# define enumerate_initcall1(X)
# define enumerate_initcall1s(X)
# define enumerate_initcall2(X)
# define enumerate_initcall2s(X)
# define enumerate_initcall3(X)
# define enumerate_initcall3s(X)
# define enumerate_initcall4(X)
# define enumerate_initcall4s(X)
# define enumerate_initcall5(X)
# define enumerate_initcall5s(X)
# define enumerate_initcallrootfs(X)
# define enumerate_initcall6(X)
# define enumerate_initcall6s(X)
# define enumerate_initcall7(X)
# define enumerate_initcall7s(X)
#endif

#endif