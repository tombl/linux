#!/usr/bin/env node
import { start } from "./dist/index.js";
import { readFile } from "node:fs/promises";
import { Writable } from "node:stream";
import Worker from "./worker.mjs";

globalThis.Worker = Worker;

const machine = start({
  cmdline: process.argv[2] ?? "no_hash_pointers",
  vmlinux: await WebAssembly.compile(
    await readFile(`${import.meta.dirname}/vmlinux.wasm`),
  ),
});

machine.bootConsole.pipeTo(Writable.toWeb(process.stdout));

machine.addEventListener("error", ({ detail: { error, workerName } }) => {
  console.log(`Error in ${workerName}:`, error);
});
