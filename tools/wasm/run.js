#!/usr/bin/env -S deno run --allow-read
import {
  BlockDevice,
  ConsoleDevice,
  EntropyDevice,
  Machine,
} from "./dist/index.js";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { assert } from "./src/util.ts";

const defaultMemory = navigator.hardwareConcurrency > 16 ? 256 : 128;

const args = parseArgs(Deno.args, {
  string: ["cmdline"],
  boolean: ["help"],
  default: {
    cmdline: "",
    memory: defaultMemory,
    cpus: navigator.hardwareConcurrency,
    initcpio: import.meta.url
      .replace("run.js", "initramfs.cpio")
      .replace("file://", ""),
  },
  alias: { cmdline: "c", memory: "m", initcpio: "i", cpus: "j", help: "h" },
});

if (args.help) {
  console.log(`usage: run.ts [options]

options:
  -c, --cmdline <string>  Command line arguments to pass to the kernel
  -m, --memory <number>   Amount of memory to allocate in MiB (default: ${defaultMemory})
  -i, --initcpio <string> Path to the initramfs to boot
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
  devices: [
    new ConsoleDevice(Deno.stdin.readable, Deno.stdout.writable),
    new EntropyDevice(),
    new BlockDevice(new Uint8Array(8 * 1024 * 1024)),
  ],
  initcpio: await Deno.readFile(args.initcpio),
});

machine.bootConsole.pipeTo(Deno.stderr.writable, { preventClose: true });

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
