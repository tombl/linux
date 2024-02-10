#!/usr/bin/env -S deno run --allow-read
import { start } from "./src/index.ts";

const machine = start({
  cmdline: "",
  vmlinux: await WebAssembly.compile(
    await Deno.readFile(new URL("vmlinux.wasm", import.meta.url)),
  ),
});

machine.bootConsole.pipeTo(Deno.stdout.writable);

machine.addEventListener("booted", () => {
  console.log("booted");
});
