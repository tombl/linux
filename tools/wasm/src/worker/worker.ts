import { bootstrapWorker } from "../rpc.ts";
import { assert, type ptr, type u32 } from "../util.ts";
import { KernelImports } from "./kernel.ts";
import * as virtio from "./virtio.ts";

interface Instance extends WebAssembly.Instance {
  exports: {
    boot(): void;
    task(task: ptr): void;
    secondary(cpu: u32, idle: ptr): void;
    trigger_irq_for_cpu(cpu: u32, irq: u32): void;
  };
}

declare global {
  function interrupt(cpu: u32, irq: u32): void;
}

export interface MainExposed {
  bootConsoleWrite(message: ArrayBuffer): Promise<void>;
  bootConsoleClose(): Promise<void>;
  restart(): void;
  spawnTask(task: ptr, name: string): void;
  error(error: Error): void;
  bringupSecondary(cpu: u32, idle: ptr): void;
}

const virtioDevices = new Map<u32, virtio.Device>();
virtioDevices.set(0x4321 as u32, new virtio.Entropy());

export class WorkerExposed {
  // deno-lint-ignore no-explicit-any
  #imports: any = {};
  #memory!: Uint8Array;

  #setup(
    memory: WebAssembly.Memory,
  ) {
    this.#memory = new Uint8Array(memory.buffer);
    Object.assign(this.#imports, {
      env: { memory },
      kernel: new KernelImports(this.#memory),
      virtio: new virtio.Imports(this.#memory, virtioDevices),
      boot: {
        get_devicetree: () => {
          throw new Error("not available on this thread");
        },
      },
    });
  }
  #instantiate(vmlinux: WebAssembly.Module) {
    return new WebAssembly.Instance(vmlinux, this.#imports) as Instance;
  }

  boot(
    vmlinux: WebAssembly.Module,
    memory: WebAssembly.Memory,
    devicetreeBuffer: ArrayBuffer,
  ) {
    this.#setup(memory);
    const devicetree = new Uint8Array(devicetreeBuffer);

    this.#imports.boot = {
      get_devicetree: (buf: ptr, size: u32) => {
        assert(
          size >= devicetree.byteLength,
          "Device tree truncated",
        );
        this.#memory.set(devicetree.slice(0, size), buf);
      },
    };

    this.#instantiate(vmlinux).exports.boot();
  }

  task(vmlinux: WebAssembly.Module, memory: WebAssembly.Memory, task: ptr) {
    this.#setup(memory);
    this.#instantiate(vmlinux).exports.task(task);
  }

  secondary(
    vmlinux: WebAssembly.Module,
    memory: WebAssembly.Memory,
    cpu: u32,
    idle: ptr,
  ) {
    this.#setup(memory);
    this.#instantiate(vmlinux).exports.secondary(cpu, idle);
  }
}

export const main = await bootstrapWorker<WorkerExposed, MainExposed>(
  new WorkerExposed(),
);
