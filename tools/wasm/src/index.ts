import { type DeviceTreeNode, generate_devicetree } from "./devicetree.ts";
import { assert, EventEmitter, unreachable } from "./util.ts";
import { virtio_imports, VirtioDevice } from "./virtio.ts";
import {
  type Imports,
  type Instance,
  type UserContext,
  kernel_imports,
} from "./wasm.ts";
import type { InitMessage, WorkerMessage } from "./worker.ts";

export {
  BlockDevice,
  type BlockDeviceStorage,
  ConsoleDevice,
  EntropyDevice,
  VirtioDevice,
  type VsockConnection,
  VsockDevice,
} from "./virtio.ts";

type MaybePromise<T> = T | PromiseLike<T>;

export interface MachineOptions {
  cmdline?: string;
  memoryMib?: number;
  cpus?: number;
  devices: VirtioDevice[];
  initcpio?: MaybePromise<ArrayBufferView>;
}

const resources = (async () => {
  const vmlinux_response = fetch(
    new URL("../vmlinux.wasm", import.meta.url),
  );

  let vmlinux: WebAssembly.Module;
  if ("compileStreaming" in WebAssembly) {
    vmlinux = await WebAssembly.compileStreaming(vmlinux_response);
  } else {
    const buffer = await (await vmlinux_response).arrayBuffer();
    vmlinux = await WebAssembly.compile(buffer);
  }

  const custom_section = (name: string) => {
    const sections = WebAssembly.Module.customSections(vmlinux, name);
    const section = sections[0];
    assert(section && sections.length === 1, `Missing custom section: ${name}`);
    return section;
  };

  const sections = JSON.parse(
    new TextDecoder().decode(custom_section(".linux.sections")),
  );
  const initramfs = new Uint8Array(custom_section(".linux.initramfs"));

  return {
    vmlinux,
    sections,
    initramfs,
  };
})();

const INITCPIO_ADDR = 0x200000;

export class Machine extends EventEmitter<{ error: ErrorEvent }> {
  #boot_console: TransformStream<Uint8Array, Uint8Array>;
  #boot_console_writer: WritableStreamDefaultWriter<Uint8Array>;
  #workers: Worker[] = [];
  #memory: WebAssembly.Memory;
  #devices: VirtioDevice[];
  #initcpio?: MaybePromise<ArrayBufferView>;
  #boot_promise?: Promise<void>;
  #closed = false;

  memory: Uint8Array;
  devicetree: DeviceTreeNode;

  get bootConsole() {
    return this.#boot_console.readable;
  }

  constructor(options: MachineOptions) {
    super();
    this.#boot_console = new TransformStream<Uint8Array, Uint8Array>();
    this.#boot_console_writer = this.#boot_console.writable.getWriter();
    this.#devices = options.devices;
    this.#initcpio = options.initcpio;

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
        bootargs: `console=hvc0 ${options.cmdline ?? ""}`,
        ncpus: options.cpus ?? navigator.hardwareConcurrency,
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

  boot() {
    if (this.#closed) return Promise.reject(new Error("machine is closed"));
    return (this.#boot_promise ??= this.#boot());
  }

  async #boot() {
    const memory_reservations: { address: number; size: number }[] = [];
    const initcpio = this.#initcpio ? await this.#initcpio : undefined;
    if (this.#closed) throw new Error("machine is closed");

    if (initcpio) {
      assert(
        INITCPIO_ADDR + initcpio.byteLength <= this.memory.byteLength,
        "Initramfs does not fit in machine memory",
      );
      const chosen = this.devicetree.chosen as DeviceTreeNode;
      chosen["linux,initrd-start"] = INITCPIO_ADDR;
      chosen["linux,initrd-end"] = INITCPIO_ADDR + initcpio.byteLength;
      this.memory.set(
        new Uint8Array(
          initcpio.buffer,
          initcpio.byteOffset,
          initcpio.byteLength,
        ),
        INITCPIO_ADDR,
      );
      memory_reservations.push({
        address: INITCPIO_ADDR,
        size: initcpio.byteLength,
      });
    }

    const { sections, vmlinux, initramfs } = await resources;
    (this.devicetree.chosen as DeviceTreeNode).sections = sections;

    const devicetree = generate_devicetree(this.devicetree, {
      memory_reservations,
    });

    const boot_console_write = (message: ArrayBuffer) => {
      this.#boot_console_writer.write(new Uint8Array(message)).catch(() => {
        // Ignore errors if the console is closed
      });
    };
    const boot_console_close = () => {
      this.#boot_console_writer.close();
    };

    const spawn_worker = (
      fn: number,
      arg: number,
      name: string,
      user: UserContext | null,
    ) => {
      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
        name,
      });
      this.#workers.push(worker);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        switch (event.data.type) {
          case "spawn_worker":
            spawn_worker(
              event.data.fn,
              event.data.arg,
              event.data.name,
              event.data.user,
            );
            break;
          case "boot_console_write":
            boot_console_write(event.data.message);
            break;
          case "boot_console_close":
            boot_console_close();
            break;
          case "run_on_main":
            instance.exports.__indirect_function_table
              .get(event.data.fn)!(event.data.arg);
            break;
          default:
            unreachable(event.data);
        }
      };
      worker.onerror = (event) => {
        this.emit("error", event);
      };
      worker.postMessage(
        {
          fn,
          arg,
          vmlinux,
          memory: this.#memory,
          user,
        } satisfies InitMessage,
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
        get_user_module: unavailable,
        get_user_memory: unavailable,
      }),
      user: {
        compile: unavailable,
        instantiate: unavailable,
        call: unavailable,
        switch_entry: unavailable,
        call_signal_handler: unavailable,
        read: unavailable,
        write: unavailable,
        write_zeroes: unavailable,
        futex_atomic_op: unavailable,
        futex_atomic_cmpxchg: unavailable,
      },
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
    if (this.#closed) return;
    instance.exports.boot();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const device of this.#devices) device.close();
    for (const worker of this.#workers) worker.terminate();
    this.#workers.length = 0;
    void this.#boot_console_writer.close().catch(() => {});
  }
}
