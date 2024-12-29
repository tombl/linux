#include <linux/ptrace.h>

void show_regs(struct pt_regs *fp)
{
	pr_info("show_regs");
	BUG();
}
