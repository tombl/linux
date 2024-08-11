#include <linux/irqchip.h>
#include <linux/mod_devicetable.h>

static int wasm_irq_map(struct irq_domain *d, unsigned int irq,
			irq_hw_number_t hw)
{
	pr_info("wasm_irq_map: %d -> %lu\n", irq, hw);

	// if (hw < FIRST_EXT_IRQ) {
	// 	irq_set_percpu_devid(irq);
	// 	irq_set_chip_and_handler(irq, &dummy_irq_chip, handle_percpu_irq);
	// } else {
	irq_set_chip_and_handler(irq, &dummy_irq_chip, handle_simple_irq);
	// }

	return 0;
}

static const struct irq_domain_ops wasm_irq_ops = {
	.xlate = irq_domain_xlate_onecell,
	.map = wasm_irq_map,
};

static int __init init_wasm_intc(struct device_node *intc,
				 struct device_node *parent)
{
	struct irq_domain *root_domain;

	pr_info("init wasm irq");

	root_domain = irq_domain_add_linear(NULL, NR_IRQS, &wasm_irq_ops, NULL);
	if (!root_domain)
		panic("root irq domain not available\n");

	irq_set_default_host(root_domain);

#ifdef CONFIG_SMP
	irq_create_mapping(root_domain, IPI_IRQ);
#endif

	return 0;
}

IRQCHIP_DECLARE(wasm_intc, "wasm,intc", init_wasm_intc);

struct of_device_id __irqchip_of_table[2] = { __of_table_wasm_intc, {} };
