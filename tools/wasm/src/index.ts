import { DeviceTreeNode, generateDevicetree } from "./devicetree.ts";
import { sendBootstrap, transfer } from "./rpc.ts";
import { assert, EventEmitter, getScriptPath, u32 } from "./util.ts";
import * as virtio from "./virtio.ts";
import { Entropy } from "./worker/virtio.ts";
import type { MainExposed, WorkerExposed } from "./worker/worker.ts";

export class Machine extends EventEmitter<{
  halt: void;
  restart: void;
  error: { error: Error; threadName: string };
}> {
  #bootConsole: TransformStream<Uint8Array, Uint8Array>;
  #bootConsoleWriter: WritableStreamDefaultWriter<Uint8Array>;
  #workers: Worker[] = [];
  #vmlinux: WebAssembly.Module;
  #memory: WebAssembly.Memory;
  #Worker: typeof globalThis.Worker;

  memory: Uint8Array;
  devicetree: DeviceTreeNode;

  get bootConsole() {
    return this.#bootConsole.readable;
  }

  constructor(options: {
    cmdline?: string;
    vmlinux: WebAssembly.Module;
    sections: Record<string, number[]>;
    memoryMib?: number;
    cpus?: number;
    Worker?: typeof globalThis.Worker;
  }) {
    super();
    this.#bootConsole = new TransformStream<Uint8Array, Uint8Array>();
    this.#bootConsoleWriter = this.#bootConsole.writable.getWriter();
    this.#vmlinux = options.vmlinux;
    this.#Worker = options.Worker ?? globalThis.Worker;

    const PAGE_SIZE = 0x10000;
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

    // this is a slightly arbitrary choice, but as long as this is
    // less than the number of pages the module requests, there will be
    // no overlap
    let mmioBase = PAGE_SIZE * 32;
    const mmioAlloc = (size: number) => {
      const ptr = mmioBase;
      mmioBase += size;
      return [ptr, size];
    };

    const RNG_REG = mmioAlloc(0x100);
    const rng = new virtio.Registers(
      this.memory.subarray(RNG_REG[0], RNG_REG[0] + RNG_REG[1]),
    );

    rng.magic = 0x74726976 as u32; // "virt" in ascii
    rng.version = 2 as u32;
    rng.deviceId = Entropy.DEVICE_ID;
    rng.vendorId = 0x7761736d as u32; // "wasm" in ascii
    rng.driverFeatures = virtio.F_VERSION_1;

    this.devicetree = {
      "#address-cells": 1,
      "#size-cells": 1,
      chosen: {
        "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
        bootargs: options.cmdline ?? "no_hash_pointers",
        ncpus: options.cpus ?? navigator.hardwareConcurrency,
        sections: options.sections,
      },
      aliases: {},
      memory: {
        device_type: "memory",
        reg: [0, bytes],
      },
      "reserved-memory": {
        "#address-cells": 1,
        "#size-cells": 1,
        ranges: undefined,
        rng: {
          reg: RNG_REG,
        },
      },
      // disk: {
      //   compatible: "virtio,wasm",
      //   "host-id": 0x7777,
      //   "virtio-id": 2, // blk
      //   interrupts: 31,
      // },
      // rng: {
      //   compatible: "virtio,wasm",
      //   "host-id": 0x4321,
      //   "virtio-id": Entropy.DEVICE_ID,
      //   interrupts: 32,
      // },
      rng: {
        compatible: "virtio,mmio",
        reg: RNG_REG,
        interrupts: [42],
      },
    };
  }

  async boot() {
    const devicetree = generateDevicetree(this.devicetree);
    await (await this.#spawn("entry")).boot(
      this.#vmlinux,
      this.#memory,
      transfer(devicetree.buffer),
    );
  }

  #spawn(name: string) {
    const worker = new this.#Worker(
      getScriptPath(() => import("./worker/worker.ts"), import.meta),
      { type: "module", name },
    );
    this.#workers.push(worker);
    return sendBootstrap<MainExposed, WorkerExposed>(worker, {
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
        await (await this.#spawn(name)).task(this.#vmlinux, this.#memory, task);
      },
      error: (error) => {
        this.emit("error", { error, threadName: name });
      },
      bringupSecondary: async (cpu, idle) => {
        await (await this.#spawn(`entry${cpu}`)).secondary(
          this.#vmlinux,
          this.#memory,
          cpu,
          idle,
        );
      },
    });
  }
}
