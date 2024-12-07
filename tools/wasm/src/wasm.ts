export interface Instance extends WebAssembly.Instance {
  exports: {
    boot(): void;
    worker_entry(fn: number, arg: number): void;
    trigger_irq_for_cpu(cpu: number, irq: number): void;
  };
}

export interface Imports {
  env: { memory: WebAssembly.Memory };
  boot: {
    get_devicetree(buf: number, size: number): void;
  };
  kernel: {
    breakpoint(): void;
    halt(): void;
    restart(): void;
    boot_console_write(msg: number, len: number): void;
    boot_console_close(): void;
    return_address(_level: number): number;
    get_now_nsec(): bigint;
    get_stacktrace(buf: number, size: number): void;
    spawn_worker(fn: number, arg: number, comm: number, commLen: number): void;
  };
  virtio: {
    get_config(
      dev: number,
      offset: number,
      buf_addr: number,
      buf_len: number,
    ): void;
    set_config(
      dev: number,
      offset: number,
      buf_addr: number,
      buf_len: number,
    ): void;

    get_features(dev: number, features_addr: number): number;
    set_features(dev: number, features: bigint): number;

    configure_interrupt(
      dev: number,
      irq: number,
      is_config_addr: number,
      is_vring_addr: number,
    ): number;

    enable_vring(
      dev: number,
      vq: number,
      size: number,
      desc_addr: number,
      used_addr: number,
      avail_addr: number,
    ): number;
    disable_vring(dev: number, vq: number): number;

    notify(dev: number, vq: number): number;
  };
}

export function kernel_imports(
  {
    is_worker,
    memory,
    spawn_worker,
    boot_console_write,
    boot_console_close,
  }: {
    is_worker: boolean;
    memory: WebAssembly.Memory;
    spawn_worker: (fn: number, arg: number, name: string) => void;
    boot_console_write: (message: ArrayBuffer) => void;
    boot_console_close: () => void;
  },
): Imports["kernel"] {
  const mem = new Uint8Array(memory.buffer);
  return {
    breakpoint: () => {
      // deno-lint-ignore no-debugger
      debugger;
    },
    halt: () => {
      if (!is_worker) throw new Error("Halt called in main thread");
      self.close();
    },
    restart: () => {
      // TODO: plumb this to the main thread, emit an event
      throw new Error("Restart not implemented");
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

    spawn_worker: (fn, arg, comm, commLen) => {
      const name = new TextDecoder().decode(
        mem.slice(comm, comm + commLen),
      );
      spawn_worker(fn, arg, name);
    },
  };
}
