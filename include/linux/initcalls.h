/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _LINUX_INITCALLS_H
#define _LINUX_INITCALLS_H

#include <linux/init.h>
#include <linux/moduleparam.h>

#if __has_include(<generated/initcalls.h>)
# include <generated/initcalls.h>
#else
# warning no initcalls, you need to build twice.
# define enumerate_setup(X) panic("init placeholder");
# define enumerate_initcallearly(X) panic("init placeholder");
# define enumerate_initcallconsole(X) panic("init placeholder");
# define enumerate_initcall(X) panic("init placeholder");
# define enumerate_initcall1(X) panic("init placeholder");
# define enumerate_initcall1s(X) panic("init placeholder");
# define enumerate_initcall2(X) panic("init placeholder");
# define enumerate_initcall2s(X) panic("init placeholder");
# define enumerate_initcall3(X) panic("init placeholder");
# define enumerate_initcall3s(X) panic("init placeholder");
# define enumerate_initcall4(X) panic("init placeholder");
# define enumerate_initcall4s(X) panic("init placeholder");
# define enumerate_initcall5(X) panic("init placeholder");
# define enumerate_initcall5s(X) panic("init placeholder");
# define enumerate_initcallrootfs(X) panic("init placeholder");
# define enumerate_initcall6(X) panic("init placeholder");
# define enumerate_initcall6s(X) panic("init placeholder");
# define enumerate_initcall7(X) panic("init placeholder");
# define enumerate_initcall7s(X) panic("init placeholder");
# define enumerate_param(X)
#endif

#endif