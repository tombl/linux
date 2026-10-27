// SPDX-License-Identifier: GPL-2.0-only
/*
 * The machine's power button. The host presses it through the power_button
 * export, which raises an interrupt; its work runs the kernel's orderly
 * power-off or reboot, so /sbin/poweroff or /sbin/reboot in the guest shuts
 * the system down the way its init does. This is how a hypervisor asks a
 * guest to shut down, as Xen's control/shutdown does.
 */
#include <linux/init.h>
#include <linux/interrupt.h>
#include <linux/irq.h>
#include <linux/reboot.h>
#include <linux/workqueue.h>
#include <asm/irq.h>

void trigger_irq(irq_hw_number_t irq);

/* Values are part of the guest/host ABI. */
enum wasm_power_action {
	WASM_POWER_OFF = 1,
	WASM_POWER_REBOOT = 2,
};

static irq_hw_number_t power_hwirq;
static atomic_t power_action;

static void power_work_fn(struct work_struct *work)
{
	switch (atomic_xchg(&power_action, 0)) {
	case WASM_POWER_OFF:
		orderly_poweroff(false);
		break;
	case WASM_POWER_REBOOT:
		orderly_reboot();
		break;
	}
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
	if (ret)
		return ret;
	smp_store_release(&power_hwirq, irqd_to_hwirq(irq_get_irq_data(irq)));
	return 0;
}
device_initcall(power_button_init);

/*
 * Returns 0 once the press is delivered, or -EAGAIN before the button
 * exists, early in boot, when the host should retry or pull the plug.
 */
__attribute__((export_name("power_button"))) int power_button(int action)
{
	irq_hw_number_t hwirq = smp_load_acquire(&power_hwirq);

	if (action != WASM_POWER_OFF && action != WASM_POWER_REBOOT)
		return -EINVAL;
	if (!hwirq)
		return -EAGAIN;
	atomic_set(&power_action, action);
	trigger_irq(hwirq);
	return 0;
}
