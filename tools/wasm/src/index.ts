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
  allocate_shared_memory,
  type Imports,
  type Instance,
  kernel_imports,
  MachineTerminationReason,
  type UserContext,
} from "./wasm.ts";
import type {
  ForwardedInitMessage,
  InitMessage,
  WorkerMessage,
} from "./worker.ts";

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
export { type ConsoleDevice, consoleDevice } from "./virtio/console.ts";
export { entropyDevice } from "./virtio/entropy.ts";
export {
  type VirtioFileSystem,
  type VirtioFileSystemAttributes,
  type VirtioFileSystemCreateContext,
  type VirtioFileSystemDirectoryEntry,
  type VirtioFileSystemDeviceOptions,
  VirtioFileSystemError,
  type VirtioFileSystemErrorCode,
  type VirtioFileSystemHandle,
  type VirtioFileSystemNode,
  type VirtioFileSystemSetAttributes,
  type VirtioFileSystemStat,
  type VirtioFileSystemTimestamp,
  virtioFileSystemDevice,
} from "./virtio/fs.ts";
export {
  type EthernetDevice,
  ethernetDevice,
  type EthernetDeviceOptions,
  type EthernetNetwork,
  ethernetNetwork,
  type EthernetPort,
  type MacAddress,
} from "./virtio/net.ts";
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
  const workers = new Set<WorkerHandle>();
  let closed = false;
  let failed = false;
  let finish_error: unknown;
  let finish_promise: Promise<void> | undefined;

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

  const finish = () => {
    if (finish_promise) return finish_promise;
    closed = true;
    finish_promise = (async () => {
      const device_closes = devices.map((device) => close_virtio_device(device));
      for (const result of await Promise.allSettled(device_closes)) {
        if (result.status === "rejected" && !failed) {
          failed = true;
          finish_error = result.reason;
        }
      }
      try {
        await Promise.all(Array.from(workers, (worker) => worker.terminate()));
      } catch (termination_error) {
        if (!failed) {
          failed = true;
          finish_error = termination_error;
        }
      }
      boot_console_close();
      if (failed) closed_promise.reject(finish_error);
      else closed_promise.resolve();
    })();
    return finish_promise;
  };
  const fail = (error: unknown) => {
    if (!failed) {
      failed = true;
      finish_error = error;
    }
    return finish();
  };
  const close = () => void finish();

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
    const { memory: wasm_memory, maximum_pages } = allocate_shared_memory(
      pages,
      KERNEL_MEMORY_MAXIMUM_PAGES,
    );
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
        reg: [0, maximum_pages * PAGE_SIZE],
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

    const start_worker = (
      name: string,
      init: InitMessage | ForwardedInitMessage,
    ) => {
      if (closed) return;
      const worker = platform.spawn_worker(name, {
        on_message(raw) {
          const message = raw as WorkerMessage;
          switch (message.type) {
            case "spawn_worker":
              try {
                start_worker(message.name, {
                  type: "forwarded_init",
                  port: message.port,
                });
              } catch (error) {
                void fail(error);
              }
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
                  void fail(new MachinePanicError());
                  break;
                default:
                  void fail(
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
            case "worker_exit": {
              // The worker closes itself after posting this message. Calling
              // terminate() here races that orderly shutdown and leaks the
              // worker's address-space reservations in WebKit.
              workers.delete(worker);
              break;
            }
            default:
              unreachable(message);
          }
        },
        on_error: fail,
      });
      workers.add(worker);
      worker.post(
        init,
        init.type === "forwarded_init" ? [init.port] : undefined,
      );
    };

    const spawn_worker = (
      fn: number,
      arg: number,
      name: string,
      user: UserContext | null,
      copy_user_memory: boolean,
    ) => {
      // COPY originates only from userspace clone in a worker; never block the
      // browser's main agent waiting for a memory snapshot.
      assert(!copy_user_memory);
      start_worker(name, {
        type: "init",
        fn,
        arg,
        vmlinux,
        memory: wasm_memory,
        user,
        user_copy_status: null,
      });
      return 0;
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
        worker_exit: unavailable,
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
        on_error: fail,
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
