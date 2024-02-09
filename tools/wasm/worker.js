import { boot } from "./kernel.mjs";

globalThis.onmessage = async (event) => {
	switch (event.data.action) {
		case "boot":
			boot({
				module: await WebAssembly.compileStreaming(fetch(event.data.path)),
				cmdline: event.data.cmdline,
				write(msg) {
					postMessage(
						{ action: "print", msg: msg.buffer },
						{ transfer: [msg.buffer] },
					);
				},
				get_now_nsec() {
					return Math.round(performance.now() * 1_000_000);
				},
			});
			break;
		default:
			throw new Error(`unhandled event ${event.data.action}`);
	}
};
