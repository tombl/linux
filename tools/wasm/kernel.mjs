import { devicetree } from "./devicetree.mjs";

const PAGE = 65536; // 64KiB
const PAGES = 1024;
const MEMORY = PAGE * PAGES; // 64MiB

export async function boot(host) {
	const memory = new WebAssembly.Memory({ initial: PAGES });
	const mem = new Uint8Array(memory.buffer);

	let irq = 0;

	const dt = devicetree({
		chosen: {
			"rng-seed": crypto.getRandomValues(new Uint8Array(64)),
			bootargs: host.cmdline
		},
		aliases: {},
		memory: {
			device_type: "memory",
			reg: [0, MEMORY],
		},
	});

	function println(msg) {
		host.write(new TextEncoder().encode(`${msg}\n`));
	}

	try {
		const instance = await WebAssembly.instantiate(host.module, {
			env: { memory },
			kernel: {
				print(msg, len) {
					host.write(mem.slice(msg, msg + len));
				},
				set_irq_enabled(enabled) {
					irq = enabled;
				},
				get_irq_enabled() {
					return irq;
				},
				return_address() {
					return -1;
				},
				relax() {},
				get_now_nsec() {
					return BigInt(host.get_now_nsec());
				},
				get_dt(buf, size) {
					if (size < dt.byteLength) console.warn("device tree truncated");
					mem.set(dt.slice(0, size), buf);
				},
			},
		});

		instance.exports._start();
		println("[done]");
	} catch (e) {
		println(`${e}`);
		throw e;
	}
}
