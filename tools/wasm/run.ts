#!/usr/bin/env -S deno run --allow-read
import { start } from "./src/index.ts";

const machine = start({
  cmdline: "no_hash_pointers",
  vmlinux: await WebAssembly.compileStreaming(
    await fetch(new URL("vmlinux.wasm", import.meta.url)),
  ),
});

machine.bootConsole.pipeTo(Deno.stdout.writable);

machine.addEventListener("error", ({ detail: { error, workerName } }) => {
  console.log(`Error in ${workerName}:`, error);
});
