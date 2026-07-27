// SPDX-License-Identifier: MIT

import { platform } from "./platform.ts";

export interface Instance extends WebAssembly.Instance {
  exports: {
    __indirect_function_table: WebAssembly.Table;
    boot(): void;
    trigger_irq(irq: number): void;
    syscall(
      nr: number,
      arg0: number,
      arg1: number,
      arg2: number,
      arg3: number,
      arg4: number,
      arg5: number,
    ): number;
    get_thread_area(): number;
    copy_siginfo(to: number): number;
    clear_siginfo(): void;
  };
}

export interface UserContext {
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
  // The JS API cannot recover a memory's maximum after construction.
  maximum_pages: number;
}

const supported_user_module_imports = new Set([
  "env\0memory\0memory",
  "linux\0syscall\0function",
  "linux\0get_thread_area\0function",
  "linux\0copy_siginfo\0function",
]);

/** Whether every import can be supplied when a userspace module is instantiated. */
export function user_module_imports_supported(
  module: WebAssembly.Module,
): boolean {
  return WebAssembly.Module.imports(module).every(({ module, name, kind }) =>
    supported_user_module_imports.has(`${module}\0${name}\0${kind}`)
  );
}

/**
 * Allocates a shared memory, halving the maximum whenever the engine refuses
 * to reserve that much address space, degrading as far as the initial size.
 */
export function allocate_shared_memory(
  initial_pages: number,
  preferred_maximum_pages: number,
  allocate: (
    descriptor: WebAssembly.MemoryDescriptor,
  ) => WebAssembly.Memory = (descriptor) => new WebAssembly.Memory(descriptor),
): { memory: WebAssembly.Memory; maximum_pages: number } {
  let maximum_pages = preferred_maximum_pages;
  for (;;) {
    try {
      return {
        memory: allocate({
          initial: initial_pages,
          maximum: maximum_pages,
          shared: true,
        }),
        maximum_pages,
      };
    } catch (error) {
      const smaller_maximum = Math.max(
        initial_pages,
        Math.floor(maximum_pages / 2),
      );
      if (!(error instanceof RangeError) || smaller_maximum >= maximum_pages) {
        throw error;
      }
      maximum_pages = smaller_maximum;
    }
  }
}

/*
 * Read memory.buffer immediately before constructing a view so growth in
 * another worker is visible. Turn invalid bounds and host exceptions into an
 * ordinary failure result for kernel copy helpers.
 *
 * Omitting length returns the remainder of the current memory. Fork uses this
 * to derive the child's initial page count and bytes from the same view.
 */
export function memory_bytes(
  memory: WebAssembly.Memory,
  address: number,
  length?: number,
): Uint8Array<ArrayBufferLike> | null {
  try {
    const buffer = memory.buffer;
    const view_length = length ?? buffer.byteLength - address;
    if (
      !Number.isSafeInteger(address) ||
      !Number.isSafeInteger(view_length) ||
      address < 0 ||
      view_length < 0 ||
      view_length > buffer.byteLength ||
      address > buffer.byteLength - view_length
    ) {
      return null;
    }
    return new Uint8Array(buffer, address, view_length);
  } catch {
    return null;
  }
}

const WASM_USER_MEMORY_NONE = 0;
const WASM_USER_MEMORY_SHARE = 1;
const WASM_USER_MEMORY_COPY = 2;

/** Values for the kernel.terminate_machine guest/host ABI. */
export enum MachineTerminationReason {
  Clean = 0,
  Panic = 1,
}

export interface Imports {
  env: { memory: WebAssembly.Memory };
  boot: {
    get_devicetree(buf: number, size: number): void;
    get_initramfs(buf: number, size: number): number;
  };
  kernel: {
    breakpoint(): void;
    halt_worker(): void;
    /** Reports that the whole machine ended, rather than only this worker. */
    terminate_machine(reason: MachineTerminationReason): void;
    boot_console_write(msg: number, len: number): void;
    boot_console_close(): void;
    return_address(_level: number): number;
    /** Unix time in nanoseconds, monotonically advancing during this session. */
    get_now_nsec(): bigint;
    get_stacktrace(buf: number, size: number): void;
    spawn_worker(
      fn: number,
      arg: number,
      comm: number,
      comm_len: number,
      user_memory: number,
    ): number;
    run_on_main(fn: number, arg: number): void;
  };
  user: {
    compile_begin(size: number): number;
    compile_write(buf: number, offset: number, size: number): number;
    compile_end(maximum_memory_pages: number): number;
    compile_abort(): void;
    instantiate(fresh_memory: number): void;
    call(): void;
    switch_entry(fn: number, arg: number): void;
    call_signal_handler(fn: number, sig: number): void;
    call_siginfo_handler(
      trampoline: number,
      fn: number,
      sig: number,
      code: number,
      pid: number,
      uid: number,
      value: number,
      timerid: number,
      overrun: number,
    ): void;
    read(to: number, from: number, n: number): number;
    write(to: number, from: number, n: number): number;
    write_zeroes(to: number, n: number): number;
    futex_atomic_op(
      oldval: number,
      uaddr: number,
      op: number,
      oparg: number,
    ): number;
    futex_atomic_cmpxchg(
      oldval: number,
      uaddr: number,
      expected: number,
      replacement: number,
    ): number;
  };
  virtio: {
    set_features(dev: number, features: bigint): void;

    setup(
      dev: number,
      config_irq: number,
      config_addr: number,
      config_len: number,
    ): void;

    enable_vring(
      dev: number,
      vq: number,
      size: number,
      desc_addr: number,
      irq: number,
    ): void;
    disable_vring(dev: number, vq: number): void;

    notify(dev: number, vq: number): void;
  };
}

export const HALT_KERNEL = Symbol("halt kernel");

export function kernel_imports(
  {
    is_worker,
    memory,
    spawn_worker,
    boot_console_write,
    boot_console_close,
    terminate_machine,
    run_on_main,
    get_user_context,
    worker_exit,
  }: {
    is_worker: boolean;
    memory: WebAssembly.Memory;
    spawn_worker: (
      fn: number,
      arg: number,
      name: string,
      user: UserContext | null,
      copy_user_memory: boolean,
    ) => number;
    boot_console_write: (message: ArrayBuffer) => void;
    boot_console_close: () => void;
    terminate_machine: (reason: MachineTerminationReason) => void;
    run_on_main: (fn: number, arg: number) => void;
    get_user_context: () => UserContext | null;
    /** Reports that this worker's kernel thread halted and the worker is closing. */
    worker_exit: () => void;
  },
): Imports["kernel"] {
  return {
    breakpoint: () => {
      debugger;
    },
    halt_worker: () => {
      if (!is_worker) throw new Error("Halt called in main thread");
      // Messages posted after platform.quit() are not guaranteed to arrive.
      worker_exit();
      platform.quit();
      throw HALT_KERNEL;
    },
    terminate_machine: (reason) => {
      if (!is_worker) {
        throw new Error("Machine termination called in main thread");
      }
      terminate_machine(reason);
      throw HALT_KERNEL;
    },

    boot_console_write: (msg, len) => {
      const address = msg >>> 0;
      const length = len >>> 0;
      boot_console_write(
        new Uint8Array(memory.buffer, address, length).slice().buffer,
      );
    },
    boot_console_close,

    return_address: (_level) => {
      return 0;
    },

    get_now_nsec: () => {
      /*
        The more straightforward way to do this is
        `BigInt(Math.round(performance.now() * 1_000_000))`.
        Below is semantically identical but has less floating point
        inaccuracy.
        `performance.now()` has 5μs precision in the browser.
        In server runtimes it has full nanosecond precision, but this code
        rounds to the same 5μs precision.
      */
      return BigInt(
        Math.round((performance.now() + performance.timeOrigin) * 200),
      ) * 5000n;
    },

    get_stacktrace: (buf, size) => {
      const address = buf >>> 0;
      const capacity = size >>> 0;
      // 5 lines: strip Error, strip 4 common lines of stack
      const trace = new TextEncoder().encode(
        new Error().stack?.split("\n").slice(5).join("\n"),
      );
      if (trace.byteLength > capacity && capacity >= 3) {
        /// 46 = "."
        trace[capacity - 1] = 46;
        trace[capacity - 2] = 46;
        trace[capacity - 3] = 46;
      }
      new Uint8Array(memory.buffer).set(
        trace.subarray(0, capacity),
        address,
      );
    },

    spawn_worker: (fn, arg, comm, comm_len, user_memory) => {
      const comm_address = comm >>> 0;
      const comm_length = comm_len >>> 0;
      const name = new TextDecoder().decode(
        new Uint8Array(memory.buffer, comm_address, comm_length).slice(), // copy to transfer to non-shared backing
      );
      let user: UserContext | null = null;
      let copy_user_memory = false;
      if (user_memory !== WASM_USER_MEMORY_NONE) {
        const context = get_user_context();
        if (!context) return -22; // invalid argument

        switch (user_memory) {
          case WASM_USER_MEMORY_SHARE:
            user = context;
            break;
          case WASM_USER_MEMORY_COPY:
            user = context;
            copy_user_memory = true;
            break;
          default:
            return -22; // invalid argument
        }
      }
      return spawn_worker(fn, arg, name, user, copy_user_memory);
    },

    run_on_main,
  };
}
