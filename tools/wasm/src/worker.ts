// SPDX-License-Identifier: MIT

import { platform } from "./platform.ts";
import { assert } from "./util.ts";
import { read_wasm_memories } from "./wasm_binary.ts";
import {
  allocate_shared_memory,
  HALT_KERNEL,
  type Imports,
  type Instance,
  kernel_imports,
  type MachineTerminationReason,
  memory_bytes,
  user_module_imports_supported,
  type UserContext,
} from "./wasm.ts";

export interface InitMessage {
  type: "init";
  fn: number;
  arg: number;
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
  user: UserContext | null;
  /** One-shot user-memory copy result: 0 pending, 1 complete, negative errno. */
  user_copy_status: Int32Array<SharedArrayBuffer> | null;
}
export interface ForwardedInitMessage {
  type: "forwarded_init";
  port: MessagePort;
}
export type WorkerMessage =
  | {
    type: "spawn_worker";
    name: string;
    port: MessagePort;
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
const postMessage = channel.post as (
  message: WorkerMessage,
  transfer?: Transferable[],
) => void;

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

  function copy_bytes(
    destination_memory: WebAssembly.Memory,
    destination: number,
    source_memory: WebAssembly.Memory,
    source: number,
    length: number,
  ): number {
    const to = memory_bytes(destination_memory, destination, length);
    const from = memory_bytes(source_memory, source, length);
    if (!to || !from) return length;

    try {
      to.set(from);
      return 0;
    } catch {
      return length;
    }
  }

  function user_atomic_word(uaddr: number): Int32Array | null {
    const address = uaddr >>> 0;
    if (!context || (address & 3) !== 0) return null;

    const bytes = memory_bytes(
      context.memory,
      address,
      Int32Array.BYTES_PER_ELEMENT,
    );
    return bytes ? new Int32Array(bytes.buffer, bytes.byteOffset, 1) : null;
  }

  function write_kernel_u32(addr: number, value: number): boolean {
    const bytes = memory_bytes(
      kernel_memory,
      addr >>> 0,
      Uint32Array.BYTES_PER_ELEMENT,
    );
    if (!bytes) return false;

    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      0,
      value,
      true,
    );
    return true;
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
          if (!user_module_imports_supported(module)) {
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

        let allocated: ReturnType<typeof allocate_shared_memory>;
        try {
          allocated = allocate_shared_memory(minimum, maximum);
        } catch {
          return -12; // out of memory
        }

        const next_context = { module, ...allocated };
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
        const length = n >>> 0;
        if (!context) return length;
        return copy_bytes(
          kernel_memory,
          to >>> 0,
          context.memory,
          from >>> 0,
          length,
        );
      },
      write(to, from, n) {
        const length = n >>> 0;
        if (!context) return length;
        return copy_bytes(
          context.memory,
          to >>> 0,
          kernel_memory,
          from >>> 0,
          length,
        );
      },
      write_zeroes(to, n) {
        const length = n >>> 0;
        if (!context) return length;
        const destination = memory_bytes(context.memory, to >>> 0, length);
        if (!destination) return length;

        try {
          destination.fill(0);
          return 0;
        } catch {
          return length;
        }
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

        return write_kernel_u32(oldval, old) ? 0 : -14; // bad address
      },
      futex_atomic_cmpxchg(oldval, uaddr, expected, replacement) {
        const word = user_atomic_word(uaddr);
        if (!word) return -14; // bad address

        const old = Atomics.compareExchange(word, 0, expected, replacement);
        return write_kernel_u32(oldval, old) ? 0 : -14; // bad address
      },
    },
  };
}

function start({
  fn,
  arg,
  vmlinux,
  memory,
  user: initial_user_context,
  user_copy_status,
}: InitMessage) {
  let user_context = initial_user_context;
  if (user_copy_status) {
    assert(user_context);
    // fork.c permits COPY only for a single-user mm, and the caller blocks
    // until publication below, so the source is stable. Allocate here so the
    // private backing store is owned by the destination isolate, not the
    // long-lived parent.
    try {
      const source = memory_bytes(user_context.memory, 0);
      if (!source) throw new RangeError("invalid source memory");
      const copied = allocate_shared_memory(
        source.byteLength / 0x10000,
        user_context.maximum_pages,
      );
      const destination = memory_bytes(copied.memory, 0, source.byteLength);
      if (!destination) throw new RangeError("invalid destination memory");
      destination.set(source);
      user_context = { module: user_context.module, ...copied };
      Atomics.store(user_copy_status, 0, 1);
    } catch {
      Atomics.store(user_copy_status, 0, -12);
    }
    Atomics.notify(user_copy_status, 0);
    if (Atomics.load(user_copy_status, 0) < 0) {
      postMessage({ type: "worker_exit" });
      platform.quit();
      return;
    }
  }

  const user = user_imports({
    kernel_memory: memory,
    get_kernel_instance: () => instance,
    parent_user: user_context,
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
      spawn_worker(fn, arg, name, user, copy_user_memory) {
        const direct = new MessageChannel();
        postMessage(
          {
            type: "spawn_worker",
            name,
            port: direct.port1,
          },
          [direct.port1],
        );
        const user_copy_status = copy_user_memory
          ? new Int32Array(new SharedArrayBuffer(4))
          : null;
        direct.port2.postMessage(
          {
            type: "init",
            fn,
            arg,
            vmlinux,
            memory,
            user,
            user_copy_status,
          } satisfies InitMessage,
        );
        if (!user_copy_status) return 0;
        // If publication wins the race, wait returns "not-equal"; no wakeup
        // is lost.
        Atomics.wait(user_copy_status, 0, 0);
        const result = Atomics.load(user_copy_status, 0);
        assert(
          result === 1 || result < 0,
          "copy wait completed without a result",
        );
        return result === 1 ? 0 : result;
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
}

channel.on_message((raw) => {
  const message = raw as InitMessage | ForwardedInitMessage;

  // Initial workers receive InitMessage directly from the page. Workers
  // spawned by another worker receive their InitMessage over this port, which
  // works around a WebKit bug reclaiming shared Wasm memory across JS VMs.
  if (message.type === "forwarded_init") {
    message.port.onmessage = ({ data }) => {
      message.port.close();
      start(data as InitMessage);
    };
    message.port.start();
    return;
  }

  start(message);
});
