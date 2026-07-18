import { platform } from "./platform.ts";
import { assert } from "./util.ts";
import {
  HALT_KERNEL,
  type Imports,
  type Instance,
  kernel_imports,
  type UserContext,
} from "./wasm.ts";

export interface InitMessage {
  fn: number;
  arg: number;
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
  user: UserContext | null;
}
export type WorkerMessage =
  | {
      type: "spawn_worker";
      fn: number;
      arg: number;
      name: string;
      user: UserContext | null;
    }
  | { type: "boot_console_write"; message: ArrayBuffer }
  | { type: "boot_console_close" }
  | { type: "run_on_main"; fn: number; arg: number };

const unavailable = () => {
  throw new Error("not available on worker thread");
};

const channel = platform.worker_channel();
const postMessage = channel.post as (message: WorkerMessage) => void;

function user_imports({
  kernel_memory,
  get_kernel_instance,
  parent_user: parent,
}: {
  kernel_memory: WebAssembly.Memory;
  get_kernel_instance: () => Instance;
  parent_user: UserContext | null;
}): {
  module: WebAssembly.Module | null;
  memory: WebAssembly.Memory | null;
  prepare(): void;
  imports: Imports["user"];
} {
  const HALT_USER = Symbol("halt user");

  const kernel_memory_buffer = new Uint8Array(kernel_memory.buffer);
  let module: WebAssembly.Module | null = parent?.module ?? null;
  let instance: WebAssembly.Instance | null = null;
  let memory: WebAssembly.Memory | null = parent?.memory ?? null;

  function user_atomic_word(uaddr: number): Int32Array | null {
    const address = uaddr >>> 0;
    if (
      !memory ||
      (address & 3) !== 0 ||
      address > memory.buffer.byteLength - Int32Array.BYTES_PER_ELEMENT
    ) {
      return null;
    }

    return new Int32Array(memory.buffer, address, 1);
  }

  function write_kernel_u32(addr: number, value: number): void {
    new DataView(kernel_memory.buffer).setUint32(addr, value, true);
  }

  function call_start(): void {
    assert(instance);
    const { _start } = instance.exports;
    assert(typeof _start === "function", "_start not found");
    _start();
    throw new Error("_start reached the end without exiting");
  }
  let call_entry = call_start;

  function instantiate(fresh_memory: boolean): void {
    assert(module);

    if (fresh_memory || !memory) {
      const size = 2048 + Math.floor(Math.random() * 1000);

      // TODO: read the real initial size from the module.
      // TOOD: enforce rlimit via maximum.
      memory = new WebAssembly.Memory({
        initial: size,
        maximum: size,
        shared: true,
      });
    }

    const kernel_instance = get_kernel_instance();
    instance = new WebAssembly.Instance(module, {
      env: { memory },
      linux: {
        syscall: (
          nr: number,
          arg0: number,
          arg1: number,
          arg2: number,
          arg3: number,
          arg4: number,
          arg5: number,
        ) => {
          const original_instance = instance;
          const ret = kernel_instance.exports.syscall(
            nr,
            arg0,
            arg1,
            arg2,
            arg3,
            arg4,
            arg5,
          );
          if (instance !== original_instance) {
            call_entry = call_start;
            throw HALT_USER;
          }
          return ret;
        },
        get_thread_area: kernel_instance.exports.get_thread_area,
        get_args_length: kernel_instance.exports.get_args_length,
        get_args: kernel_instance.exports.get_args,
      },
    });

    if ("memory" in instance.exports) {
      assert(instance.exports.memory instanceof WebAssembly.Memory);
      memory = instance.exports.memory;
    }
  }

  return {
    get module() {
      return module;
    },
    get memory() {
      return memory;
    },
    prepare() {
      if (parent) instantiate(false);
    },
    imports: {
      // program management:
      compile(buf, size) {
        const bytes = new Uint8Array(
          kernel_memory_buffer.slice(buf, buf + size),
        );
        try {
          module = new WebAssembly.Module(bytes);
          return 0;
        } catch {
          return -8; // exec format error
        }
      },
      instantiate(fresh_memory) {
        instantiate(Boolean(fresh_memory));
      },
      call() {
        for (;;) {
          try {
            call_entry();
          } catch (error) {
            if (error === HALT_USER) continue;
            if (error === HALT_KERNEL) throw error;
            console.log("error running user module:", String(error));
            return;
          }
        }
      },
      switch_entry(fn, arg) {
        // This is called if this thread was created by a clone call,
        // so its entrypoint is a user-specified function.
        // The worker prepares an instance sharing the parent's user context
        // before the kernel enters this callback.

        assert(parent);

        call_entry = () => {
          assert(instance);

          const { __indirect_function_table } = instance.exports;
          assert(
            __indirect_function_table instanceof WebAssembly.Table,
            "Invalid function table",
          );

          const f = __indirect_function_table.get(fn);
          assert(
            typeof f === "function" && f.length === 1,
            "Invalid function signature",
          );

          f(arg);

          // throw new Error("thread entrypoint reached the end without exiting");
          console.warn("thread entrypoint reached the end without exiting");
        };
      },

      // signal handling:
      call_signal_handler(fn, sig) {
        assert(instance);

        const { __indirect_function_table } = instance.exports;
        assert(
          __indirect_function_table instanceof WebAssembly.Table,
          "Invalid function table",
        );

        const f = __indirect_function_table.get(fn);
        assert(
          typeof f === "function" && f.length === 1,
          "Invalid function signature",
        );

        f(sig); // TODO: the siginfo overload
      },

      // memory:
      read(to, from, n) {
        assert(memory);
        const slice = new Uint8Array(memory.buffer, from, n);
        kernel_memory_buffer.set(slice, to);
        return n - slice.length;
      },
      write(to, from, n) {
        assert(memory);
        const slice = kernel_memory_buffer.subarray(from, from + n);
        new Uint8Array(memory.buffer, to, n).set(slice);
        return n - slice.length;
      },
      write_zeroes(to, n) {
        assert(memory);
        const slice = new Uint8Array(memory.buffer, to, n);
        slice.fill(0);
        return n - slice.length;
      },
      futex_atomic_op(oldval, uaddr, op, oparg) {
        const word = user_atomic_word(uaddr);
        if (!word) return -14; // bad address

        let old: number;
        switch (op) {
          case 0: // FUTEX_OP_SET
            old = Atomics.exchange(word, 0, oparg);
            break;
          case 1: // FUTEX_OP_ADD
            old = Atomics.add(word, 0, oparg);
            break;
          case 2: // FUTEX_OP_OR
            old = Atomics.or(word, 0, oparg);
            break;
          case 3: // FUTEX_OP_ANDN
            old = Atomics.and(word, 0, ~oparg);
            break;
          case 4: // FUTEX_OP_XOR
            old = Atomics.xor(word, 0, oparg);
            break;
          default:
            return -38; // function not implemented
        }

        write_kernel_u32(oldval, old);
        return 0;
      },
      futex_atomic_cmpxchg(oldval, uaddr, expected, replacement) {
        const word = user_atomic_word(uaddr);
        if (!word) return -14; // bad address

        const old = Atomics.compareExchange(word, 0, expected, replacement);
        write_kernel_u32(oldval, old);
        return 0;
      },
    },
  };
}

channel.on_message((data) => {
  const { fn, arg, vmlinux, memory, user: parent_user } = data as InitMessage;

  const user = user_imports({
    kernel_memory: memory,
    get_kernel_instance: () => instance,
    parent_user,
  });

  const imports = {
    env: { memory },
    boot: {
      get_devicetree: unavailable,
      get_initramfs: unavailable,
    },
    user: user.imports,
    kernel: kernel_imports({
      is_worker: true,
      memory,
      spawn_worker(fn, arg, name, user) {
        postMessage({
          type: "spawn_worker",
          fn,
          arg,
          name,
          user,
        });
      },
      boot_console_write(message) {
        postMessage({ type: "boot_console_write", message });
      },
      boot_console_close() {
        postMessage({ type: "boot_console_close" });
      },
      run_on_main(fn, arg) {
        postMessage({ type: "run_on_main", fn, arg });
      },
      get_user_module() {
        return user.module;
      },
      get_user_memory() {
        return user.memory;
      },
    }),
    virtio: {
      set_features: unavailable,
      setup: unavailable,
      enable_vring: unavailable,
      disable_vring: unavailable,
      notify: unavailable,
    },
  } satisfies Imports;

  const instance = new WebAssembly.Instance(vmlinux, imports) as Instance;
  user.prepare();
  try {
    instance.exports.__indirect_function_table.get(fn)!(arg);
  } catch (error) {
    if (error === HALT_KERNEL) return;
    throw error;
  }
});
