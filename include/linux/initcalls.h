/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _LINUX_INITCALLS_H
#define _LINUX_INITCALLS_H

#include <linux/init.h>
#include <linux/moduleparam.h>

#if __has_include(<generated/initcalls.h>)
# include <generated/initcalls.h>
#else
static int __placeholder_s(char* _) {
        panic("initcalls not generated");
}
static int __placeholder_i(void) {
        panic("initcalls not generated");
}
static struct obs_kernel_param __placeholder_setup = {
        "placeholder",
        __placeholder_s,
        0,
};
static initcall_entry_t __placeholder_initcall = __placeholder_i;
static const struct kernel_param __placeholder_param = {};

# warning no initcalls, you need to build twice.
# define enumerate_setup(X) X(__placeholder_setup)
# define enumerate_param(X) X(__placeholder_param)
# define enumerate_initcallearly(X) X(__placeholder_initcall)
# define enumerate_initcallconsole(X) X(__placeholder_initcall)
# define enumerate_initcall(X) X(__placeholder_initcall)
# define enumerate_initcall1(X) X(__placeholder_initcall)
# define enumerate_initcall1s(X) X(__placeholder_initcall)
# define enumerate_initcall2(X) X(__placeholder_initcall)
# define enumerate_initcall2s(X) X(__placeholder_initcall)
# define enumerate_initcall3(X) X(__placeholder_initcall)
# define enumerate_initcall3s(X) X(__placeholder_initcall)
# define enumerate_initcall4(X) X(__placeholder_initcall)
# define enumerate_initcall4s(X) X(__placeholder_initcall)
# define enumerate_initcall5(X) X(__placeholder_initcall)
# define enumerate_initcall5s(X) X(__placeholder_initcall)
# define enumerate_initcallrootfs(X) X(__placeholder_initcall)
# define enumerate_initcall6(X) X(__placeholder_initcall)
# define enumerate_initcall6s(X) X(__placeholder_initcall)
# define enumerate_initcall7(X) X(__placeholder_initcall)
# define enumerate_initcall7s(X) X(__placeholder_initcall)
#endif

#endif