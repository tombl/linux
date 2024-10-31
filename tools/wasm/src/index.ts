import sections from "./build/sections.json" with { type: "json" };
import vmlinuxUrl from "./build/vmlinux.wasm";
import type { Device, DeviceController } from "./device.ts";
import { type DeviceTreeNode, generateDevicetree } from "./devicetree.ts";
import { sendBootstrap, transfer } from "./rpc.ts";
import {
  assert,
  deepAssign,
  EventEmitter,
  getModuleURL,
  PAGE_SIZE,
} from "./util.ts";
import type { MainExposed, WorkerExposed } from "./worker/worker.ts";

export { mmio } from "./devices/mmio/index.ts";

const vmlinuxResponse = fetch(new URL(vmlinuxUrl, import.meta.url));
const vmlinux = "compileStreaming" in WebAssembly
  ? WebAssembly.compileStreaming(vmlinuxResponse)
  : vmlinuxResponse.then((r) => r.arrayBuffer()).then(WebAssembly.compile);

export class Machine extends EventEmitter<{
  halt: void;
  restart: void;
  error: { error: Error; threadName: string };
}> {
  #bootConsole: TransformStream<Uint8Array, Uint8Array>;
  #bootConsoleWriter: WritableStreamDefaultWriter<Uint8Array>;
  #workers: Worker[] = [];
  #memory: WebAssembly.Memory;
  #nextInterrupt = 10; // same as FIRST_EXT_IRQ in arch/wasm/include/asm/irq.h

  memory: Uint8Array;
  devicetree: DeviceTreeNode = {
    "#address-cells": 1,
    "#size-cells": 1,
    chosen: { sections },
    aliases: {},
    "reserved-memory": {
      "#address-cells": 1,
      "#size-cells": 1,
      ranges: undefined,
    },
  };

  get bootConsole() {
    return this.#bootConsole.readable;
  }

  constructor(options: {
    cmdline?: string;
    memoryMib?: number;
    cpus?: number;
    devices?: Device<any>[];
  }) {
    super();
    this.#bootConsole = new TransformStream<Uint8Array, Uint8Array>();
    this.#bootConsoleWriter = this.#bootConsole.writable.getWriter();

    const BYTES_PER_MIB = 0x100000;
    const bytes = (options.memoryMib ?? 128) * BYTES_PER_MIB;
    const pages = bytes / PAGE_SIZE;
    this.#memory = new WebAssembly.Memory({
      initial: pages,
      maximum: pages,
      shared: true,
    });
    assert(this.#memory.buffer.byteLength === bytes);
    this.memory = new Uint8Array(this.#memory.buffer);

    this.updateDevicetree({
      chosen: {
        "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
        bootargs: options.cmdline ?? "no_hash_pointers",
        ncpus: options.cpus ?? navigator.hardwareConcurrency,
      },
      memory: {
        device_type: "memory",
        reg: [0, bytes],
      },
    });

    for (const device of options.devices ?? []) this.addDevice(device);
  }

  updateDevicetree(devicetree: DeviceTreeNode) {
    deepAssign(this.devicetree, devicetree);
  }

  allocInterrupt() {
    return this.#nextInterrupt++;
  }

  #installedControllers = new Map<DeviceController<unknown>, unknown[]>();
  #extraWorkers: URL[] = [];
  addDevice(device: Device<any>) {
    const installed = this.#installedControllers.get(device);
    if (installed) {
      installed.push(device.config);
    } else {
      this.#installedControllers.set(device.controller, [device.config]);
    }
  }

  async boot() {
    for (const [controller, configs] of this.#installedControllers) {
      await controller.setup?.(this, configs);
      if (controller.workerURL) {
        this.#extraWorkers.push(controller.workerURL);
      }
    }

    const devicetree = generateDevicetree(this.devicetree);
    const worker = await this.#spawn("entry");
    await worker.boot(await vmlinux, this.#memory, transfer(devicetree.buffer));
  }

  async #spawn(name: string) {
    const worker = new Worker(
      getModuleURL(() => import("./worker/worker.ts"), import.meta),
      { type: "module", name },
    );
    this.#workers.push(worker);

    const remote = await sendBootstrap<MainExposed, WorkerExposed>(worker, {
      bootConsoleWrite: async (message) => {
        await this.#bootConsoleWriter.write(new Uint8Array(message));
      },
      bootConsoleClose: async () => {
        await Promise.all([
          this.#bootConsoleWriter.close(),
          this.#bootConsole.writable.close(),
        ]);
      },
      restart: () => {
        this.emit("restart", undefined);
      },
      spawnTask: async (task, name) => {
        const worker = await this.#spawn(name);
        await worker.task(await vmlinux, this.#memory, task);
      },
      error: (error) => {
        this.emit("error", { error, threadName: name });
      },
      bringupSecondary: async (cpu, idle) => {
        const worker = await this.#spawn(`entry${cpu}`);
        await worker.secondary(await vmlinux, this.#memory, cpu, idle);
      },
    });

    for (const url of this.#extraWorkers) {
      await remote.import(name, url.toString());
    }

    return remote;
  }
}
