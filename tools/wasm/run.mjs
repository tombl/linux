#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { devicetree } from "./devicetree.mjs";

const [, , path = "vmlinux", cmdline = ""] = process.argv;

const vmlinux = await fs.readFile(path);

const memory = new WebAssembly.Memory({ initial: 100 });
const mem = new Uint8Array(memory.buffer);

let irq = 0;

const dt = devicetree({ model: "foomod" });

const { instance } = await WebAssembly.instantiate(vmlinux, {
	env: { memory },
	kernel: {
		print(msg, len) {
			process.stdout.write(mem.slice(msg, msg + len));
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
			return process.hrtime.bigint();
		},
		get_dt(buf, size) {
			mem.set(dt.slice(0, size), buf);
		},
	},
});

instance.exports._start();
console.log("done!");
