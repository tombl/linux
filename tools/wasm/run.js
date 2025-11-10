#!/usr/bin/env -S deno run --allow-all
import {
  BlockDevice,
  ConsoleDevice,
  EntropyDevice,
  Machine,
} from "./dist/index.js";
import { parseArgs } from "node:util";
import { assert } from "./src/util.ts";

const defaultMemory = navigator.hardwareConcurrency > 16 ? 256 : 128;

const args = parseArgs({
  args: Deno.args,
  allowNegative: true,
  options: {
    cmdline: {
      short: "c",
      type: "string",
      default: "",
    },
    memory: {
      short: "m",
      type: "string",
      default: defaultMemory.toString(),
    },
    initcpio: {
      short: "i",
      type: "string",
      default: import.meta.url
        .replace("run.js", "initramfs.cpio")
        .replace("file://", ""),
    },
    cpus: {
      short: "j",
      type: "string",
      default: navigator.hardwareConcurrency.toString(),
    },
    help: {
      short: "h",
      type: "boolean",
      default: false,
    },
    console: {
      type: "boolean",
      default: true,
    },
    entropy: {
      type: "boolean",
      default: true,
    },
    disk: {
      type: "string",
      default: [],
      multiple: true,
    },
  },
}).values;

if (args.help) {
  console.log(`usage: run.ts [options]

options:
  -c, --cmdline <string>  Command line arguments to pass to the kernel
  -m, --memory <number>   Amount of memory to allocate in MiB (default: ${defaultMemory})
  -i, --initcpio <string> Path to the initramfs to boot
  -j, --cpus <number>     Number of CPUs to use (default: number of CPUs on the machine)
      --no-console        Don't attach a console device
      --no-entropy        Don't attach an entropy device
      --disk <string>     Path to a disk image to use (can be specified multiple times)
  -h, --help              Show this help message
`);
  Deno.exit(0);
}

assert(!isNaN(parseInt(args.cpus)), "cpus must be a number");
assert(!isNaN(parseInt(args.memory)), "memory must be a number");

const devices = [];

if (args.console) {
  devices.push(new ConsoleDevice(Deno.stdin.readable, Deno.stdout.writable));
}

if (args.entropy) {
  devices.push(new EntropyDevice());
}

for (const disk of args.disk) {
  let readonly = false;
  const file = await Deno.open(disk, { read: true, write: true }).catch(() => {
    readonly = true;
    return Deno.open(disk, { read: true });
  });
  const { size } = await file.stat();

  devices.push(
    new BlockDevice({
      read: async (offset, length) => {
        const array = new Uint8Array(length);
        file.seekSync(offset, Deno.SeekMode.Start);
        let n = 0;
        while (n < array.byteLength) {
          const chunk = file.readSync(array.subarray(n));
          if (chunk === null) break;
          n += chunk;
        }
        return array.subarray(0, n);
      },
      write: readonly ? undefined : async (offset, data) => {
        file.seekSync(offset, Deno.SeekMode.Start);
        let n = 0;
        while (n < data.byteLength) {
          n += file.writeSync(data.subarray(n));
        }
        return n;
      },
      flush: () => file.sync(),
      capacity: size,
    }),
  );
}

const machine = new Machine({
  cmdline: args.cmdline,
  memoryMib: parseInt(args.memory),
  cpus: parseInt(args.cpus),
  devices,
  initcpio: await Deno.readFile(args.initcpio),
});

machine.bootConsole.pipeTo(Deno.stderr.writable, { preventClose: true });

machine.on("error", ({ error }) => {
  console.error(error);
});

machine.boot();
