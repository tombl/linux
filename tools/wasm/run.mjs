#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { boot } from "./kernel.mjs";

const [, , path = "vmlinux", cmdline = ""] = process.argv;

const vmlinux = await fs.readFile(path);

await boot({
	module: await WebAssembly.compile(vmlinux),
	cmdline,
	write(msg) {
		process.stdout.write(msg);
	},
	get_now_nsec() {
		return process.hrtime.bigint();
	}
})
