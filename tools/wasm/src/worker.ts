// SPDX-License-Identifier: MIT

import { platform } from "./platform.ts";
import { assert } from "./util.ts";
import { read_wasm_memories } from "./wasm_binary.ts";
import {
  HALT_KERNEL,
  type Imports,
  type Instance,
  kernel_imports,
  type MachineTerminationReason,
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
  | { type: "terminate_machine"; reason: MachineTerminationReason }
  | { type: "run_on_main"; fn: number; arg: number }
  | { type: "worker_exit" };

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
  context: UserContext | null;
  prepare(): void;
  imports: Imports["user"];
} {
  const HALT_USER = Symbol("halt user");

  let context: UserContext | null = parent;
  let instance: WebAssembly.Instance | null = null;
  let pending_module_bytes: Uint8Array<ArrayBuffer> | null = null;
  let pending: UserContext | null = null;
  // One slot per nested SA_SIGINFO callback; null means its trampoline has
  // not requested the active signal payload yet.
  const siginfo_copy_results: (number | null)[] = [];

  function user_atomic_word(uaddr: number): Int32Array | null {
    const address = uaddr >>> 0;
    if (
      !context ||
      (address & 3) !== 0 ||
      address >
        context.memory.buffer.byteLength - Int32Array.BYTES_PER_ELEMENT
    ) {
      return null;
    }

    return new Int32Array(context.memory.buffer, address, 1);
  }

  function write_kernel_u32(addr: number, value: number): void {
    new DataView(kernel_memory.buffer).setUint32(addr >>> 0, value, true);
  }

  function call_start(): void {
    assert(instance);
    const { _start } = instance.exports;
    assert(typeof _start === "function", "_start not found");
    _start();
    throw new Error("_start reached the end without exiting");
  }
  let call_entry = call_start;

  function create_instance(context: UserContext): WebAssembly.Instance {
    const kernel_instance = get_kernel_instance();
    return new WebAssembly.Instance(context.module, {
      env: { memory: context.memory },
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
        copy_siginfo: (to: number) => {
          const result = kernel_instance.exports.copy_siginfo(to);
          const current = siginfo_copy_results.length - 1;
          if (current >= 0) siginfo_copy_results[current] = result;
          return result;
        },
      },
    });
  }

  function instantiate(fresh_memory: boolean): void {
    if (fresh_memory) {
      assert(pending);
      context = pending;
      pending = null;
    }

    assert(context);
    instance = create_instance(context);
  }

  return {
    get context() {
      return context;
    },
    prepare() {
      if (parent) instantiate(false);
    },
    imports: {
      // program management:
      compile_begin(size) {
        pending_module_bytes = null;
        pending = null;
        try {
          pending_module_bytes = new Uint8Array(size >>> 0);
          return 0;
        } catch {
          return -12; // out of memory
        }
      },
      compile_write(buf, offset, size) {
        const source = buf >>> 0;
        const destination = offset >>> 0;
        const length = size >>> 0;
        const kernel_buffer = kernel_memory.buffer;
        if (
          !pending_module_bytes ||
          source > kernel_buffer.byteLength - length ||
          destination > pending_module_bytes.length - length
        ) {
          return -22; // invalid argument
        }
        pending_module_bytes.set(
          new Uint8Array(kernel_buffer, source, length),
          destination,
        );
        return 0;
      },
      compile_end(maximum_memory_pages) {
        const bytes = pending_module_bytes;
        pending_module_bytes = null;
        if (!bytes) return -22; // invalid argument

        const rlimit_pages = maximum_memory_pages >>> 0;
        let module: WebAssembly.Module;
        let minimum: number;
        let maximum: number;
        try {
          const memories = read_wasm_memories(bytes);
          const memory_import = memories.imports[0];
          if (
            memories.definitions.length !== 0 ||
            memories.imports.length !== 1 ||
            !memory_import ||
            memory_import.module !== "env" ||
            memory_import.name !== "memory" ||
            memory_import.type.address !== "i32" ||
            !memory_import.type.shared ||
            memory_import.type.maximum === undefined
          ) {
            return -8; // exec format error
          }

          module = new WebAssembly.Module(bytes);
          const compiled_memory_imports = WebAssembly.Module.imports(
            module,
          ).filter(
            ({ kind }) => kind === "memory",
          );
          if (
            compiled_memory_imports.length !== 1 ||
            compiled_memory_imports[0]?.module !== "env" ||
            compiled_memory_imports[0]?.name !== "memory"
          ) {
            return -8; // exec format error
          }

          minimum = Number(memory_import.type.minimum);
          maximum = Math.min(
            Number(memory_import.type.maximum),
            rlimit_pages,
          );
        } catch {
          return -8; // exec format error
        }

        if (maximum < minimum) return -12; // out of memory

        let memory: WebAssembly.Memory;
        try {
          memory = new WebAssembly.Memory({
            initial: minimum,
            maximum,
            shared: true,
          });
        } catch {
          return -12; // out of memory
        }

        const next_context = { module, memory, maximum_pages: maximum };
        pending = next_context;
        return 0;
      },
      compile_abort() {
        pending_module_bytes = null;
        pending = null;
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
            console.error("error running user module:", error);
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

          const f = __indirect_function_table.get(fn >>> 0);
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

        const f = __indirect_function_table.get(fn >>> 0);
        assert(
          typeof f === "function" && f.length === 1,
          "Invalid function signature",
        );

        f(sig);
      },
      call_siginfo_handler(trampoline, fn, sig) {
        assert(instance);

        const { __indirect_function_table } = instance.exports;
        assert(
          __indirect_function_table instanceof WebAssembly.Table,
          "Invalid function table",
        );

        const f = __indirect_function_table.get(trampoline >>> 0);
        assert(
          typeof f === "function" && f.length === 2,
          "Invalid siginfo trampoline",
        );

        siginfo_copy_results.push(null);
        try {
          f(fn, sig);
          return siginfo_copy_results.at(-1) ?? -22;
        } finally {
          // Non-local exits can unwind the kernel callback before its C cleanup.
          try {
            get_kernel_instance().exports.clear_siginfo();
          } finally {
            siginfo_copy_results.pop();
          }
        }
      },

      // memory:
      read(to, from, n) {
        assert(context);
        const destination = to >>> 0;
        const source = from >>> 0;
        const length = n >>> 0;
        new Uint8Array(kernel_memory.buffer, destination, length).set(
          new Uint8Array(context.memory.buffer, source, length),
        );
        return 0;
      },
      write(to, from, n) {
        assert(context);
        const destination = to >>> 0;
        const source = from >>> 0;
        const length = n >>> 0;
        new Uint8Array(context.memory.buffer, destination, length).set(
          new Uint8Array(kernel_memory.buffer, source, length),
        );
        return 0;
      },
      write_zeroes(to, n) {
        assert(context);
        const destination = to >>> 0;
        const length = n >>> 0;
        new Uint8Array(context.memory.buffer, destination, length).fill(0);
        return 0;
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
      terminate_machine(reason) {
        postMessage({ type: "terminate_machine", reason });
      },
      run_on_main(fn, arg) {
        postMessage({ type: "run_on_main", fn, arg });
      },
      get_user_context() {
        return user.context;
      },
      worker_exit() {
        postMessage({ type: "worker_exit" });
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
    instance.exports.__indirect_function_table.get(fn >>> 0)!(arg);
  } catch (error) {
    if (error === HALT_KERNEL) return;
    throw error;
  }
});
