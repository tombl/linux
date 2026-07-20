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
    get_args_length(): number;
    get_args(buf: number): number;
  };
}

export interface UserContext {
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
  // The JS API cannot recover a memory's maximum after construction.
  maximum_pages: number;
}

const WASM_USER_MEMORY_NONE = 0;
const WASM_USER_MEMORY_SHARE = 1;
const WASM_USER_MEMORY_COPY = 2;

export interface Imports {
  env: { memory: WebAssembly.Memory };
  boot: {
    get_devicetree(buf: number, size: number): void;
    get_initramfs(buf: number, size: number): number;
  };
  kernel: {
    breakpoint(): void;
    halt_worker(): void;
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
    run_on_main,
    get_user_context,
  }: {
    is_worker: boolean;
    memory: WebAssembly.Memory;
    spawn_worker: (
      fn: number,
      arg: number,
      name: string,
      user: UserContext | null,
    ) => void;
    boot_console_write: (message: ArrayBuffer) => void;
    boot_console_close: () => void;
    run_on_main: (fn: number, arg: number) => void;
    get_user_context: () => UserContext | null;
  },
): Imports["kernel"] {
  return {
    breakpoint: () => {
      debugger;
    },
    halt_worker: () => {
      if (!is_worker) throw new Error("Halt called in main thread");
      platform.quit();
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
      if (user_memory !== WASM_USER_MEMORY_NONE) {
        const context = get_user_context();
        if (!context) return -22; // invalid argument

        const memory_pages = context.memory.buffer.byteLength / 0x10000;
        switch (user_memory) {
          case WASM_USER_MEMORY_SHARE:
            user = context;
            break;
          case WASM_USER_MEMORY_COPY:
            try {
              const copied = new WebAssembly.Memory({
                initial: memory_pages,
                maximum: context.maximum_pages,
                shared: true,
              });
              new Uint8Array(copied.buffer).set(
                new Uint8Array(context.memory.buffer),
              );
              user = {
                module: context.module,
                memory: copied,
                maximum_pages: context.maximum_pages,
              };
            } catch {
              return -12; // out of memory
            }
            break;
          default:
            return -22; // invalid argument
        }
      }
      spawn_worker(fn, arg, name, user);
      return 0;
    },

    run_on_main,
  };
}
