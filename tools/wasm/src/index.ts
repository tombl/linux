import initramfs from "./build/initramfs_data.cpio";
import sections from "./build/sections.json" with { type: "json" };
import vmlinuxUrl from "./build/vmlinux.wasm";
import { type DeviceTreeNode, generate_devicetree } from "./devicetree.ts";
import init2 from "./init2.cpio";
import { assert, EventEmitter, get_script_path, unreachable } from "./util.ts";
import {
  BlockDevice,
  EntropyDevice,
  virtio_imports,
  VirtioDevice,
} from "./virtio.ts";
import { type Imports, type Instance, kernel_imports } from "./wasm.ts";
import type { InitMessage, WorkerMessage } from "./worker.ts";

const worker_url = get_script_path(() => import("./worker.ts"), import.meta);

const vmlinux_response = fetch(new URL(vmlinuxUrl, import.meta.url));
const vmlinux_promise = "compileStreaming" in WebAssembly
  ? WebAssembly.compileStreaming(vmlinux_response)
  : vmlinux_response.then((r) => r.arrayBuffer()).then(WebAssembly.compile);

const INIT2_ADDR = 0x200000;

export class Machine extends EventEmitter<{
  halt: void;
  restart: void;
  error: { error: Error; threadName: string };
}> {
  #boot_console: TransformStream<Uint8Array, Uint8Array>;
  #boot_console_writer: WritableStreamDefaultWriter<Uint8Array>;
  #workers: Worker[] = [];
  #memory: WebAssembly.Memory;
  #devices: VirtioDevice[];

  memory: Uint8Array;
  devicetree: DeviceTreeNode;

  get bootConsole() {
    return this.#boot_console.readable;
  }

  constructor(options: {
    cmdline?: string;
    memoryMib?: number;
    cpus?: number;
  }) {
    super();
    this.#boot_console = new TransformStream<Uint8Array, Uint8Array>();
    this.#boot_console_writer = this.#boot_console.writable.getWriter();

    this.#devices = [new EntropyDevice() /*, new BlockDevice()*/];

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

    this.devicetree = {
      "#address-cells": 1,
      "#size-cells": 1,
      chosen: {
        "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
        bootargs: options.cmdline ?? "no_hash_pointers",
        ncpus: options.cpus ?? navigator.hardwareConcurrency,
        sections,
        "linux,initrd-start": INIT2_ADDR,
        "linux,initrd-end": INIT2_ADDR + init2.byteLength,
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
      },
    };

    this.memory.set(init2, INIT2_ADDR);

    for (const [i, dev] of this.#devices.entries()) {
      this.devicetree[`virtio${i}`] = {
        compatible: `virtio,wasm`,
        "host-id": i,
        "virtio-device-id": dev.ID,
        features: dev.features,
        config: dev.config_bytes,
      };
    }
  }

  async boot() {
    const devicetree = generate_devicetree(this.devicetree, {
      memory_reservations: [
        { address: INIT2_ADDR, size: init2.byteLength },
      ],
    });
    const vmlinux = await vmlinux_promise;

    const boot_console_write = (message: ArrayBuffer) => {
      this.#boot_console_writer.write(new Uint8Array(message));
    };
    const boot_console_close = () => {
      this.#boot_console_writer.close();
    };

    const spawn_worker = (fn: number, arg: number, name: string) => {
      const worker = new Worker(worker_url, { type: "module", name });
      this.#workers.push(worker);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        switch (event.data.type) {
          case "spawn_worker":
            spawn_worker(event.data.fn, event.data.arg, event.data.name);
            break;
          case "boot_console_write":
            boot_console_write(event.data.message);
            break;
          case "boot_console_close":
            boot_console_close();
            break;
          case "run_on_main":
            instance.exports.call(event.data.fn, event.data.arg);
            break;
          default:
            unreachable(event.data);
        }
      };
      worker.postMessage(
        { fn, arg, vmlinux, memory: this.#memory } satisfies InitMessage,
      );
    };

    const unavailable = () => {
      throw new Error("not available on main thread");
    };

    const imports = {
      env: { memory: this.#memory },
      boot: {
        get_devicetree: (buf, size) => {
          assert(size >= devicetree.byteLength, "Device tree truncated");
          this.memory.set(devicetree, buf);
        },
        get_initramfs: (buf, size) => {
          assert(size >= initramfs.byteLength, "Initramfs truncated");
          this.memory.set(initramfs, buf);
          return initramfs.byteLength;
        },
      },
      kernel: kernel_imports({
        is_worker: false,
        memory: this.#memory,
        spawn_worker,
        boot_console_write,
        boot_console_close,
        run_on_main: unavailable,
      }),
      virtio: virtio_imports({
        memory: this.#memory,
        devices: this.#devices,
        trigger_irq_for_cpu(cpu, irq) {
          instance.exports.trigger_irq_for_cpu(cpu, irq);
        },
      }),
    } satisfies Imports;

    const instance =
      (await WebAssembly.instantiate(vmlinux, imports)) as Instance;
    // @ts-expect-error
    globalThis.instance = instance;
    // @ts-expect-error
    globalThis.memory = this.#memory;
    instance.exports.boot();
  }
}
