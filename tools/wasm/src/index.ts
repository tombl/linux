import sections from "./build/sections.json" with { type: "json" };
import vmlinuxUrl from "./build/vmlinux.wasm";
import { type DeviceTreeNode, generate_devicetree } from "./devicetree.ts";
import { assert, EventEmitter, get_script_path, unreachable } from "./util.ts";
import { type Imports, type Instance, kernel_imports } from "./wasm.ts";
import type { InitMessage, WorkerMessage } from "./worker.ts";

const worker_url = get_script_path(() => import("./worker.ts"), import.meta);

const vmlinux_response = fetch(new URL(vmlinuxUrl, import.meta.url));
const vmlinux_promise = "compileStreaming" in WebAssembly
  ? WebAssembly.compileStreaming(vmlinux_response)
  : vmlinux_response.then((r) => r.arrayBuffer()).then(WebAssembly.compile);

export class Machine extends EventEmitter<{
  halt: void;
  restart: void;
  error: { error: Error; threadName: string };
}> {
  #boot_console: TransformStream<Uint8Array, Uint8Array>;
  #boot_console_writer: WritableStreamDefaultWriter<Uint8Array>;
  #workers: Worker[] = [];
  #memory: WebAssembly.Memory;

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
      rng: {
        compatible: "virtio,wasm",
        "host-id": 0,
        "virtio-device-id": 4, // entropy
      },
      // blk: {
      //   compatible: "virtio,wasm",
      //   "host-id": 1,
      //   "virtio-device-id": 2, // block
      // },
    };
  }

  async boot() {
    const devicetree = generate_devicetree(this.devicetree);
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
        get_devicetree: (buf: number, size: number) => {
          assert(
            size >= devicetree.byteLength,
            "Device tree truncated",
          );
          this.memory.set(devicetree.slice(0, size), buf);
        },
      },
      kernel: kernel_imports({
        is_worker: false,
        memory: this.#memory,
        spawn_worker,
        boot_console_write,
        boot_console_close,
      }),
      virtio: {
        get_config: unavailable,
        set_config: unavailable,
        get_features: unavailable,
        set_features: unavailable,
        set_vring_enable: unavailable,
        set_vring_num: unavailable,
        set_vring_addr: unavailable,
        configure_interrupt: unavailable,
        notify: unavailable,
      },
    } satisfies Imports;

    const instance =
      (await WebAssembly.instantiate(vmlinux, imports)) as Instance;
    instance.exports.boot();
  }
}
