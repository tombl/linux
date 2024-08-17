#!/usr/bin/env node
import { Machine } from "./dist/index.js";
import { readFile } from "node:fs/promises";
import { Writable } from "node:stream";
import Worker from "./worker.mjs";

const machine = new Machine({
  cmdline: process.argv[2] ?? "no_hash_pointers",
  vmlinux: await WebAssembly.compile(
    await readFile(`${import.meta.dirname}/vmlinux.wasm`),
  ),
  sections: JSON.parse(
    await readFile(`${import.meta.dirname}/sections.json`, "utf8"),
  ),
  Worker,
});

machine.bootConsole.pipeTo(Writable.toWeb(process.stdout));

machine.on("halt", () => {
  console.log("halting...");
  process.exit(1);
});

machine.on("restart", () => {
  console.log("reboot requested. halting...");
  process.exit(0);
});

machine.on("error", ({ error, threadName }) => {
  console.log(`Error in ${threadName}:`, error);
});

machine.boot();
