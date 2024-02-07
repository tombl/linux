#!/usr/bin/env node
import * as fs from "node:fs/promises";

const [, , path = "vmlinux", cmdline = ""] = process.argv;

const vmlinux = await fs.readFile(path);

const memory = new WebAssembly.Memory({ initial: 4 });
const mem = new Uint8Array(memory.buffer);

let irq = 0;

const { instance } = await WebAssembly.instantiate(vmlinux, {
	env: { memory },
	kernel: {
		print(msg, len) {
			process.stdout.write(mem.slice(msg, msg + len));
			process.stdout.write("\n");
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
	},
});

instance.exports._start();
