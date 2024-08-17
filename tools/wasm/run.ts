#!/usr/bin/env -S deno run --allow-read
import { Machine } from "./src/index.ts";
import sections from "./sections.json" with { type: "json" };
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { assert } from "./src/util.ts";

const args = parseArgs(Deno.args, {
  string: ["cmdline"],
  boolean: ["help"],
  default: {
    cmdline: "no_hash_pointers",
    memory: 128,
    cpus: navigator.hardwareConcurrency,
  },
  alias: { cmdline: "c", memory: "m", cpus: "j", help: "h" },
});

if (args.help) {
  console.log(`usage: run.ts [options]

options:
  -c, --cmdline <string>  Command line arguments to pass to the kernel (default: "no_hash_pointers")
  -m, --memory <number>   Amount of memory to allocate in MiB (default: 128)
  -j, --cpus <number>     Number of CPUs to use (default: number of CPUs on the machine)
  -h, --help              Show this help message
`);
  Deno.exit(0);
}

assert(typeof args.cpus === "number", "cpus must be a number");
assert(typeof args.memory === "number", "memory must be a number");

const machine = new Machine({
  cmdline: args.cmdline,
  memoryMib: args.memory,
  cpus: args.cpus,

  vmlinux: await WebAssembly.compileStreaming(
    await fetch(new URL("vmlinux.wasm", import.meta.url)),
  ),
  sections,
});

machine.bootConsole.pipeTo(Deno.stdout.writable);

machine.on("halt", () => {
  console.log("halting...");
  Deno.exit(1);
});

machine.on("restart", () => {
  console.log("reboot requested. halting...");
  Deno.exit(0);
});

machine.on("error", ({ error, threadName }) => {
  console.log(`Error in ${threadName}:`, error);
});

machine.boot();
