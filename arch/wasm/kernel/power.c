// SPDX-License-Identifier: GPL-2.0-only
/*
 * The machine's power button. The host presses it through the power_button
 * export, which raises an interrupt the kernel allocated. Its work runs
 * /sbin/poweroff or /sbin/reboot, as orderly_poweroff() and orderly_reboot()
 * do, so that the guest's init shuts the system down, as Hyper-V's shutdown
 * service does.
 *
 * The first press of a boot wins: once init has a request, a second one could
 * only compete with it, so later presses fail with -EBUSY.
 *
 * If the command cannot be run, for example because the image has none, the
 * work forces the issue as orderly_poweroff(true) and orderly_reboot() do: an
 * emergency sync, which is not waited for, then an immediate power-off or
 * restart, so data that was not yet written is lost as if the plug had been
 * pulled. Unlike them, it does so under system_transition_mutex, as reboot(2)
 * does, and only while no shutdown is under way, so it never races one that
 * the guest started. If the command runs but init ignores it, nothing
 * happens, and the host decides when to pull the plug.
 */
#include <linux/fs.h>
#include <linux/init.h>
#include <linux/interrupt.h>
#include <linux/irq.h>
#include <linux/kernel.h>
#include <linux/mutex.h>
#include <linux/reboot.h>
#include <linux/suspend.h>
#include <linux/umh.h>
#include <linux/workqueue.h>
#include <asm/irq.h>
#include <asm/wasm_imports.h>

static irq_hw_number_t power_hwirq;
/* The action of this boot's first press, or 0 before one. */
static atomic_t power_action;

static void power_work_fn(struct work_struct *work)
{
	static char *envp[] = {
		"HOME=/",
		"PATH=/sbin:/bin:/usr/sbin:/usr/bin",
		NULL
	};
	bool off = atomic_read(&power_action) == WASM_POWER_OFF;
	char *argv[] = { off ? "/sbin/poweroff" : "/sbin/reboot", NULL };
	int ret;

	pr_info("power button: %s\n", off ? "powering off" : "rebooting");
	ret = call_usermodehelper(argv[0], argv, envp, UMH_WAIT_EXEC);
	if (!ret)
		return;

	mutex_lock(&system_transition_mutex);
	if (system_state > SYSTEM_RUNNING) {
		pr_info("power button: a shutdown is already under way\n");
		mutex_unlock(&system_transition_mutex);
		return;
	}
	pr_warn("power button: %s failed (%d), forcing the issue\n", argv[0],
		ret);
	emergency_sync();
	if (off)
		kernel_power_off();
	else
		kernel_restart(NULL);
	mutex_unlock(&system_transition_mutex);
}

static DECLARE_WORK(power_work, power_work_fn);

static irqreturn_t power_interrupt(int irq, void *dev_id)
{
	schedule_work(&power_work);
	return IRQ_HANDLED;
}

static int __init power_button_init(void)
{
	int irq = wasm_alloc_irq();
	int ret;

	if (irq < 0)
		return irq;
	ret = request_irq(irq, power_interrupt, 0, "power-button", NULL);
	if (ret) {
		wasm_free_irq(irq);
		return ret;
	}
	/* Pairs with power_button(): a pressable button has a handler. */
	smp_store_release(&power_hwirq, irqd_to_hwirq(irq_get_irq_data(irq)));
	return 0;
}
device_initcall(power_button_init);

__attribute__((export_name("power_button"))) int
power_button(enum wasm_power_action action)
{
	/* Pairs with power_button_init(). */
	irq_hw_number_t hwirq = smp_load_acquire(&power_hwirq);

	if (action != WASM_POWER_OFF && action != WASM_POWER_REBOOT)
		return -EINVAL;
	if (!hwirq)
		return -EAGAIN;
	/* The work checks again, under system_transition_mutex. */
	if (system_state > SYSTEM_RUNNING)
		return -EBUSY;
	/* A full barrier on success, so the work sees the action. */
	if (atomic_cmpxchg(&power_action, 0, action))
		return -EBUSY;
	trigger_irq(hwirq);
	return 0;
}
