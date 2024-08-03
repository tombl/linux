#!/usr/bin/env -S deno run --allow-read
import { start } from "./src/index.ts";
import sections from "./sections.json" with { type: "json" };

const machine = start({
  cmdline: "no_hash_pointers",
  vmlinux: await WebAssembly.compileStreaming(
    await fetch(new URL("vmlinux.wasm", import.meta.url)),
  ),
  sections,
});

machine.bootConsole.pipeTo(Deno.stdout.writable);

machine.addEventListener("restart", () => {
  console.log("reboot requested. halting...");
  Deno.exit(0);
});

machine.addEventListener("error", ({ detail: { error, threadName } }) => {
  console.log(`Error in ${threadName}:`, error);
});
