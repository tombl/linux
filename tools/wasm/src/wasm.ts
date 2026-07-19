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
    compile_end(): number;
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
    get_user_module,
    get_user_memory,
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
    get_user_module: () => WebAssembly.Module | null;
    get_user_memory: () => WebAssembly.Memory | null;
  },
): Imports["kernel"] {
  const mem = new Uint8Array(memory.buffer);
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
      boot_console_write(memory.buffer.slice(msg, msg + len));
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
      // 5 lines: strip Error, strip 4 common lines of stack
      const trace = new TextEncoder().encode(
        new Error().stack?.split("\n").slice(5).join("\n"),
      );
      if (trace.byteLength > size) {
        /// 46 = "."
        trace[size - 1] = 46;
        trace[size - 2] = 46;
        trace[size - 3] = 46;
      }
      mem.set(trace.slice(0, size), buf);
    },

    spawn_worker: (fn, arg, comm, comm_len, user_memory) => {
      const name = new TextDecoder().decode(
        mem.slice(comm, comm + comm_len),
      );
      let user: UserContext | null = null;
      if (user_memory !== WASM_USER_MEMORY_NONE) {
        const module = get_user_module();
        const memory = get_user_memory();
        if (!module || !memory) return -22; // invalid argument

        const memory_pages = memory.buffer.byteLength / 0x10000;
        switch (user_memory) {
          case WASM_USER_MEMORY_SHARE:
            user = { module, memory };
            break;
          case WASM_USER_MEMORY_COPY:
            try {
              const copied = new WebAssembly.Memory({
                initial: memory_pages,
                maximum: memory_pages,
                shared: true,
              });
              new Uint8Array(copied.buffer).set(
                new Uint8Array(memory.buffer),
              );
              user = { module, memory: copied };
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
