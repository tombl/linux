import type { WorkerContext, WorkerDefault } from "../device.ts";
import { bootstrapWorker } from "../rpc.ts";
import { assert, type ptr, type u32 } from "../util.ts";
import { KernelImports } from "./kernel.ts";

interface Instance extends WebAssembly.Instance {
  exports: {
    boot(): void;
    task(task: ptr): void;
    secondary(cpu: u32, idle: ptr): void;
    trigger_irq_for_cpu(cpu: u32, irq: u32): void;
  };
}

export interface MainExposed {
  bootConsoleWrite(message: ArrayBuffer): Promise<void>;
  bootConsoleClose(): Promise<void>;
  restart(): void;
  spawnTask(task: ptr, name: string): void;
  error(error: Error): void;
  bringupSecondary(cpu: u32, idle: ptr): void;
}

export class WorkerExposed {
  // deno-lint-ignore no-explicit-any
  #imports: any = {};
  #wasmMemory!: WebAssembly.Memory;
  #memory!: Uint8Array;

  #setup(
    memory: WebAssembly.Memory,
  ) {
    this.#wasmMemory = memory;
    this.#memory = new Uint8Array(memory.buffer);
    Object.assign(this.#imports, {
      env: { memory },
      kernel: new KernelImports(this.#memory),
      boot: {
        get_devicetree: () => {
          throw new Error("not available on this thread");
        },
      },
      mmio: {
        pre_read: (addr: ptr) => {},
        post_write: (addr: ptr) => {},
      },
    });
  }
  #instantiate(vmlinux: WebAssembly.Module) {
    return WebAssembly.instantiate(vmlinux, this.#imports) as Promise<Instance>;
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

    this.#instantiate(vmlinux)
      .then((instance) => instance.exports.boot());
  }

  task(vmlinux: WebAssembly.Module, memory: WebAssembly.Memory, task: ptr) {
    this.#setup(memory);
    this.#instantiate(vmlinux)
      .then((instance) => instance.exports.task(task));
  }

  secondary(
    vmlinux: WebAssembly.Module,
    memory: WebAssembly.Memory,
    cpu: u32,
    idle: ptr,
  ) {
    this.#setup(memory);
    this.#instantiate(vmlinux)
      .then((instance) => instance.exports.secondary(cpu, idle));
  }

  async import(name: string, url: string) {
    const mod = (await import(url)) as { default: WorkerDefault<any> };
    const ctx: WorkerContext = { memory: this.#wasmMemory };
    const added = await mod.default(ctx, main);
    if (added.imports) {
      assert(!(name in this.#imports));
      this.#imports[name] = added.imports;
    }
  }
}

export const main = await bootstrapWorker<WorkerExposed, MainExposed>(
  new WorkerExposed(),
);
