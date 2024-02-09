import { devicetree } from "./devicetree.mjs";

const memory = new WebAssembly.Memory({ initial: 100 });
const mem = new Uint8Array(memory.buffer);

let irq = 0;

const dt = devicetree({});

async function boot({ path, cmdline }) {
	try {
		const { instance } = await WebAssembly.instantiateStreaming(fetch(path), {
			env: { memory },
			kernel: {
				print(msg, len) {
					const buf = mem.slice(msg, msg + len).buffer;
					postMessage({ action: "print", buf }, { transfer: [buf] });
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
				get_cmdline(buf, size) {
					mem.set(new TextEncoder().encode(`${cmdline}\0`).slice(0, size), buf);
				},
				get_now_nsec() {
					return BigInt(Math.round(performance.now() * 1_000_000));
				},
				get_dt(buf, size) {
					mem.set(dt.slice(0, size), buf);
				},
			},
		});
		instance.exports._start();
		postMessage({ action: "done" });
	} catch (e) {
		console.error(e);
		postMessage({ action: "error", message: String(e) });
	}
}

globalThis.onmessage = (event) => {
	switch (event.data.action) {
		case "boot":
			boot(event.data);
			break;
		default:
			throw new Error(`unhandled event ${event.data.action}`);
	}
};
