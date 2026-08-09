#!/usr/bin/env node
// Headless smoke: boot gui initramfs with virtio-net → local WS TCP proxy,
// wait for init.sh's `wget google.com` result on the console.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  spawnMachine,
  consoleDevice,
  entropyDevice,
  createNetwork,
  attach_guest,
  wsTcpProxyNetwork,
} from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const initramfs = new Uint8Array(
  fs.readFileSync(path.join(__dirname, "initramfs.cpio")),
);

const proxyUrl = process.env.PROXY_URL || "ws://127.0.0.1:4173";
const network = createNetwork(wsTcpProxyNetwork({ proxyUrl }));
const attached = attach_guest(network);

const input = new TransformStream();
const output = new TransformStream();
const devices = [
  consoleDevice(input.readable, output.writable),
  entropyDevice(),
  attached.attachment.device,
];

let consoleText = "";
const reader = output.readable.getReader();
(async () => {
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(new Uint8Array(value), { stream: true });
    consoleText += chunk;
    process.stdout.write(chunk);
  }
})();

const machine = await spawnMachine({
  cpus: 2,
  cmdline: "rdinit=/init",
  initcpio: initramfs,
  devices,
});

const bootReader = machine.bootConsole.getReader();
(async () => {
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await bootReader.read();
    if (done) break;
    const chunk = dec.decode(new Uint8Array(value), { stream: true });
    consoleText += chunk;
    process.stdout.write(chunk);
  }
})();

const deadline = Date.now() + 120_000;
let result = "timeout";
while (Date.now() < deadline) {
  if (consoleText.includes("network: wget google.com ok")) {
    result = "ok";
    break;
  }
  if (consoleText.includes("network: wget google.com FAILED")) {
    result = "failed";
    break;
  }
  if (consoleText.includes("network: no eth0")) {
    result = "no-eth0";
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}

machine.close();
attached.attachment.close();
network.close();

console.log(`\n[net-smoke] result=${result}`);
process.exit(result === "ok" ? 0 : 1);
