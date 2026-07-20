// SPDX-License-Identifier: MIT

import { type DeviceTreeNode, generate_devicetree } from "./devicetree.ts";
import { platform, type WorkerHandle } from "./platform.ts";
import { assert, unreachable } from "./util.ts";
import { read_wasm_memories, type WasmMemoryType } from "./wasm_binary.ts";
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
  MachineTerminationReason,
  type UserContext,
} from "./wasm.ts";
import type { InitMessage, WorkerMessage } from "./worker.ts";

export type { DeviceTreeNode } from "./devicetree.ts";
export {
  VirtioController,
  type VirtioDevice,
  type VirtioDeviceOptions,
  type VirtioDriver,
  type Virtqueue,
  type VirtqueueBuffer,
  type VirtqueueChain,
  type VirtqueueHandler,
} from "./virtio/core.ts";
export { blockDevice, type BlockDeviceStorage } from "./virtio/block.ts";
export { consoleDevice } from "./virtio/console.ts";
export { entropyDevice } from "./virtio/entropy.ts";
export {
  type VsockConnection,
  type VsockDevice,
  vsockDevice,
} from "./virtio/vsock.ts";

type MaybePromise<T> = T | PromiseLike<T>;

/** The resources and boot configuration of a Linux machine. */
export interface SpawnMachineOptions {
  /** Kernel command line arguments, appended after `console=hvc0`. */
  cmdline?: string;
  /** Virtual CPUs to boot, one Web Worker each. Defaults to the host's hardware concurrency. */
  cpus?: number;
  /** The machine's virtio devices, in device tree order. */
  devices: readonly VirtioDevice[];
  /** Initial ramdisk loaded into memory and passed to the kernel. */
  initcpio?: MaybePromise<ArrayBufferView>;
  /** Recursively merged over the generated device tree before boot. */
  devicetree?: DeviceTreeNode;
}

/**
 * A booted Linux machine: one shared WebAssembly memory, one Web Worker per
 * virtual CPU, and its virtio devices.
 */
export interface Machine extends Disposable {
  /** The machine's physical memory. */
  readonly memory: WebAssembly.Memory;
  /** Kernel output from before the console device is available. */
  readonly bootConsole: ReadableStream<Uint8Array>;
  /** Settles when closed, rejecting if the machine failed unexpectedly. */
  readonly closed: Promise<void>;
  /** Idempotently shuts down the workers and owned devices. */
  close(): void;
}

export class MachinePanicError extends Error {
  constructor() {
    super("kernel panic");
    this.name = "MachinePanicError";
  }
}

const resources = (async () => {
  const { bytes, module: vmlinux } = await platform.load_wasm(
    new URL("../vmlinux.wasm", import.meta.url),
  );

  const memories = read_wasm_memories(bytes);
  assert(
    memories.imports.length === 1 && memories.definitions.length === 0,
    "Kernel must define exactly one imported memory",
  );
  const memory = memories.imports[0]!;
  assert(
    memory.module === "env" && memory.name === "memory",
    "Kernel memory must be imported as env.memory",
  );
  assert(
    memory.type.address === "i32" && memory.type.shared,
    "Kernel memory must be a shared memory32",
  );

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
    memory: memory.type,
    sections,
    initramfs,
  };
})();

const PAGE_SIZE = 0x10000;
// Leave the final wasm32 page out so the physical-memory size fits in u32.
const KERNEL_MEMORY_MAXIMUM_PAGES = 0xffff;
const KERNEL_MEMORY_BYTES = KERNEL_MEMORY_MAXIMUM_PAGES * PAGE_SIZE;

function kernel_initial_pages(
  memory: WasmMemoryType,
  initcpio_size: number,
): number {
  const maximum = BigInt(KERNEL_MEMORY_MAXIMUM_PAGES);
  assert(
    memory.minimum <= maximum &&
      memory.maximum !== undefined && memory.maximum >= maximum,
    "Kernel memory limits are incompatible with a 4 GiB - 64 KiB memory",
  );
  const initcpio_pages = Math.ceil(initcpio_size / PAGE_SIZE);
  const initial = Number(memory.minimum) + initcpio_pages;
  assert(
    initial <= KERNEL_MEMORY_MAXIMUM_PAGES,
    "Initramfs does not fit in kernel memory",
  );
  return initial;
}

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

/**
 * Boots the packaged kernel and resolves once it is running: the devices
 * are live and the kernel is executing from then on. What runs next is up
 * to the initramfs and kernel command line.
 *
 * In a browser the page must be cross-origin isolated, because the
 * machine's memory is shared between workers.
 *
 * @example
 * ```ts
 * const machine = await spawnMachine({
 *   cpus: navigator.hardwareConcurrency,
 *   initcpio: initramfs,
 *   devices: [
 *     consoleDevice(input, output),
 *     entropyDevice(),
 *     blockDevice(disk),
 *   ],
 * });
 * ```
 */
export async function spawnMachine(
  options: SpawnMachineOptions,
): Promise<Machine> {
  const devices = options.devices;
  const workers: WorkerHandle[] = [];
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

  const finish = async (error?: unknown) => {
    if (closed) return;
    closed = true;
    for (const device of devices) close_virtio_device(device);
    try {
      await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
    } catch (termination_error) {
      error ??= termination_error;
    }
    boot_console_close();
    if (error === undefined) closed_promise.resolve();
    else closed_promise.reject(error);
  };
  const close = () => finish();

  try {
    const { sections, vmlinux, initramfs, memory: memory_type } =
      await resources;
    const initcpio = options.initcpio ? await options.initcpio : undefined;
    const module_pages = Number(memory_type.minimum);
    const initcpio_addr = module_pages * PAGE_SIZE;
    const pages = kernel_initial_pages(
      memory_type,
      initcpio?.byteLength ?? 0,
    );
    const wasm_memory = new WebAssembly.Memory({
      initial: pages,
      maximum: KERNEL_MEMORY_MAXIMUM_PAGES,
      shared: true,
    });
    assert(wasm_memory.buffer.byteLength === pages * PAGE_SIZE);

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
        reg: [0, KERNEL_MEMORY_BYTES],
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

    if (initcpio) {
      const chosen = devicetree.chosen as DeviceTreeNode;
      chosen["linux,initrd-start"] = initcpio_addr;
      chosen["linux,initrd-end"] = initcpio_addr + initcpio.byteLength;
      new Uint8Array(wasm_memory.buffer).set(
        new Uint8Array(
          initcpio.buffer,
          initcpio.byteOffset,
          initcpio.byteLength,
        ),
        initcpio_addr,
      );
      memory_reservations.push({
        address: initcpio_addr,
        size: initcpio.byteLength,
      });
    }

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
      const worker = platform.spawn_worker(name, {
        on_message(raw) {
          const message = raw as WorkerMessage;
          switch (message.type) {
            case "spawn_worker":
              spawn_worker(message.fn, message.arg, message.name, message.user);
              break;
            case "boot_console_write":
              boot_console_write(message.message);
              break;
            case "boot_console_close":
              boot_console_close();
              break;
            case "terminate_machine":
              switch (message.reason) {
                case MachineTerminationReason.Clean:
                  void finish();
                  break;
                case MachineTerminationReason.Panic:
                  void finish(new MachinePanicError());
                  break;
                default:
                  void finish(
                    new Error(
                      `unknown machine termination reason: ${message.reason}`,
                    ),
                  );
              }
              break;
            case "run_on_main":
              assert(instance);
              instance.exports.__indirect_function_table.get(message.fn >>> 0)!(
                message.arg,
              );
              break;
            default:
              unreachable(message);
          }
        },
        on_error: finish,
      });
      workers.push(worker);
      worker.post(
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
          const address = buf >>> 0;
          const capacity = size >>> 0;
          assert(
            capacity >= generated_devicetree.byteLength,
            "Device tree truncated",
          );
          new Uint8Array(wasm_memory.buffer).set(
            generated_devicetree,
            address,
          );
        },
        get_initramfs: (buf, size) => {
          const address = buf >>> 0;
          const capacity = size >>> 0;
          assert(capacity >= initramfs.byteLength, "Initramfs truncated");
          new Uint8Array(wasm_memory.buffer).set(initramfs, address);
          return initramfs.byteLength;
        },
      },
      kernel: kernel_imports({
        is_worker: false,
        memory: wasm_memory,
        spawn_worker,
        boot_console_write,
        boot_console_close,
        terminate_machine: unavailable,
        run_on_main: unavailable,
        get_user_context: unavailable,
      }),
      user: {
        compile_begin: unavailable,
        compile_write: unavailable,
        compile_end: unavailable,
        compile_abort: unavailable,
        instantiate: unavailable,
        call: unavailable,
        switch_entry: unavailable,
        call_signal_handler: unavailable,
        call_siginfo_handler: unavailable,
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
      memory: wasm_memory,
      bootConsole: boot_console.readable,
      closed: closed_promise.promise,
      close,
      [Symbol.dispose]: close,
    };
  } catch (error) {
    await finish();
    throw error;
  }
}
