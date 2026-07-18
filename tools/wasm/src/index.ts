/// <reference lib="esnext.disposable" preserve="true" />

import { type DeviceTreeNode, generate_devicetree } from "./devicetree.ts";
import { assert, unreachable } from "./util.ts";
import {
  close_virtio_device,
  virtio_device_description,
  virtio_imports,
  type VirtioDevice,
} from "./virtio/core.ts";
import {
  type Imports,
  type Instance,
  kernel_imports,
  type UserContext,
} from "./wasm.ts";
import type { InitMessage, WorkerMessage } from "./worker.ts";

export type { DeviceTreeNode } from "./devicetree.ts";
export {
  type VirtioDevice,
  VirtioController,
  type VirtioDeviceOptions,
  type VirtioDriver,
  type Virtqueue,
  type VirtqueueBuffer,
  type VirtqueueChain,
  type VirtqueueHandler,
} from "./virtio/core.ts";
export { type BlockDeviceStorage, blockDevice } from "./virtio/block.ts";
export { consoleDevice } from "./virtio/console.ts";
export { entropyDevice } from "./virtio/entropy.ts";
export {
  vsockDevice,
  type VsockConnection,
  type VsockDevice,
} from "./virtio/vsock.ts";

type MaybePromise<T> = T | PromiseLike<T>;

export interface SpawnMachineOptions {
  cmdline?: string;
  memoryMib?: number;
  cpus?: number;
  devices: readonly VirtioDevice[];
  initcpio?: MaybePromise<ArrayBufferView>;
  /** Recursively merged over the generated device tree before boot. */
  devicetree?: DeviceTreeNode;
}

export interface Machine extends Disposable {
  readonly memory: Uint8Array;
  /** Kernel output from before the console device is available. */
  readonly bootConsole: ReadableStream<Uint8Array>;
  /** Settles when closed, rejecting if the machine failed unexpectedly. */
  readonly closed: Promise<void>;
  /** Idempotently shuts down the workers and owned devices. */
  close(): void;
}

const resources = (async () => {
  const vmlinux_response = fetch(new URL("../vmlinux.wasm", import.meta.url));

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

function is_devicetree_node(value: unknown): value is DeviceTreeNode {
  return typeof value === "object" && value?.constructor === Object;
}

function merge_devicetree(target: DeviceTreeNode, source: DeviceTreeNode) {
  for (const [name, value] of Object.entries(source)) {
    const current = target[name];
    if (is_devicetree_node(current) && is_devicetree_node(value)) {
      merge_devicetree(current, value);
    } else {
      target[name] = value;
    }
  }
}

export async function spawnMachine(
  options: SpawnMachineOptions,
): Promise<Machine> {
  const devices = options.devices;
  const workers: Worker[] = [];
  let closed = false;

  const closed_promise = Promise.withResolvers<void>();
  // Lifecycle promises on platform objects do not cause unhandled rejections
  // merely because a consumer chooses not to observe them.
  void closed_promise.promise.catch(() => {});

  const boot_console = new TransformStream<Uint8Array, Uint8Array>();
  const boot_console_writer = boot_console.writable.getWriter();
  const boot_console_write = (message: ArrayBuffer) => {
    void boot_console_writer.write(new Uint8Array(message)).catch(() => {});
  };
  const boot_console_close = () => {
    void boot_console_writer.close().catch(() => {});
  };

  const finish = (error?: unknown) => {
    if (closed) return;
    closed = true;
    for (const device of devices) close_virtio_device(device);
    for (const worker of workers) worker.terminate();
    workers.length = 0;
    boot_console_close();
    if (error === undefined) closed_promise.resolve();
    else closed_promise.reject(error);
  };
  const close = () => finish();

  try {
    const PAGE_SIZE = 0x10000;
    const BYTES_PER_MIB = 0x100000;
    const bytes = (options.memoryMib ?? 128) * BYTES_PER_MIB;
    const pages = bytes / PAGE_SIZE;
    const wasm_memory = new WebAssembly.Memory({
      initial: pages,
      maximum: pages,
      shared: true,
    });
    assert(wasm_memory.buffer.byteLength === bytes);
    const memory = new Uint8Array(wasm_memory.buffer);

    const devicetree: DeviceTreeNode = {
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

    for (const [i, dev] of devices.entries()) {
      const device = virtio_device_description(dev);
      devicetree[`virtio${i}`] = {
        compatible: `virtio,wasm`,
        "host-id": i,
        "virtio-device-id": device.device_id,
        features: device.features,
        config: device.config,
      };
    }
    const memory_reservations: { address: number; size: number }[] = [];
    const initcpio = options.initcpio ? await options.initcpio : undefined;

    if (initcpio) {
      assert(
        INITCPIO_ADDR + initcpio.byteLength <= memory.byteLength,
        "Initramfs does not fit in machine memory",
      );
      const chosen = devicetree.chosen as DeviceTreeNode;
      chosen["linux,initrd-start"] = INITCPIO_ADDR;
      chosen["linux,initrd-end"] = INITCPIO_ADDR + initcpio.byteLength;
      memory.set(
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
    (devicetree.chosen as DeviceTreeNode).sections = sections;
    if (options.devicetree) merge_devicetree(devicetree, options.devicetree);

    const generated_devicetree = generate_devicetree(devicetree, {
      memory_reservations,
    });

    // The imports must exist before instantiation returns the instance they
    // call back into, but they only run once exports.boot() starts the kernel.
    let instance: Instance | undefined;

    const spawn_worker = (
      fn: number,
      arg: number,
      name: string,
      user: UserContext | null,
    ) => {
      if (closed) return;
      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
        name,
      });
      workers.push(worker);
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
            assert(instance);
            instance.exports.__indirect_function_table.get(event.data.fn)!(
              event.data.arg,
            );
            break;
          default:
            unreachable(event.data);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(
          event.error instanceof Error
            ? event.error
            : new Error(event.message || "machine worker failed"),
        );
      };
      worker.postMessage(
        {
          fn,
          arg,
          vmlinux,
          memory: wasm_memory,
          user,
        } satisfies InitMessage,
      );
    };

    const unavailable = () => {
      throw new Error("not available on main thread");
    };

    const imports = {
      env: { memory: wasm_memory },
      boot: {
        get_devicetree: (buf, size) => {
          assert(
            size >= generated_devicetree.byteLength,
            "Device tree truncated",
          );
          memory.set(generated_devicetree, buf);
        },
        get_initramfs: (buf, size) => {
          assert(size >= initramfs.byteLength, "Initramfs truncated");
          memory.set(initramfs, buf);
          return initramfs.byteLength;
        },
      },
      kernel: kernel_imports({
        is_worker: false,
        memory: wasm_memory,
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
        memory: wasm_memory,
        devices,
        on_error: finish,
        trigger_irq(irq) {
          assert(instance);
          instance.exports.trigger_irq(irq);
        },
      }),
    } satisfies Imports;

    instance = (await WebAssembly.instantiate(vmlinux, imports)) as Instance;
    instance.exports.boot();

    return {
      memory,
      bootConsole: boot_console.readable,
      closed: closed_promise.promise,
      close,
      [Symbol.dispose]: close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
