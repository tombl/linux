import { assert } from "./util.ts";
import { type Imports, type Instance, kernel_imports } from "./wasm.ts";

export interface InitMessage {
  fn: number;
  arg: number;
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
  parent_user_module: WebAssembly.Module | null;
  parent_user_memory: WebAssembly.Memory | null;
}
export type WorkerMessage =
  | {
    type: "spawn_worker";
    fn: number;
    arg: number;
    name: string;
    user_module: WebAssembly.Module | null;
    user_memory: WebAssembly.Memory | null;
  }
  | { type: "boot_console_write"; message: ArrayBuffer }
  | { type: "boot_console_close" }
  | { type: "run_on_main"; fn: number; arg: number };

const unavailable = () => {
  throw new Error("not available on worker thread");
};

const postMessage = self.postMessage as (message: WorkerMessage) => void;

function user_imports({
  kernel_memory,
  get_kernel_instance,
  parent_user_module: parent_module,
  parent_user_memory: parent_memory,
}: {
  kernel_memory: WebAssembly.Memory;
  get_kernel_instance: () => Instance;
  parent_user_module: WebAssembly.Module | null;
  parent_user_memory: WebAssembly.Memory | null;
}): {
  module: WebAssembly.Module | null;
  memory: WebAssembly.Memory | null;
  imports: Imports["user"];
} {
  const HALT_USER = Symbol("halt user");

  const kernel_memory_buffer = new Uint8Array(kernel_memory.buffer);
  let module: WebAssembly.Module | null = null;
  let instance: WebAssembly.Instance | null = null;
  let memory: WebAssembly.Memory | null = null;

  function call_start(): void {
    assert(instance);
    const { _start } = instance.exports;
    assert(typeof _start === "function", "_start not found");
    _start();
    throw new Error("_start reached the end without exiting");
  }
  let call_entry = call_start;

  return {
    get module() {
      return module;
    },
    get memory() {
      return memory;
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

        // console.log("instantiating with", memory);
        try {
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
                  // if the instance changed, then this was the exec syscall,
                  // so call into the new instance:
                  call_entry = call_start;

                  // and we never want to return to the caller of the syscall, so
                  // skip straight to the catch block of the parent's call_entry
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
        } catch (error) {
          console.log("error instantiating user module:", String(error));
        }
      },
      call() {
        for (;;) {
          try {
            call_entry();
          } catch (error) {
            if (error === HALT_USER) continue;
            console.log("error running user module:", String(error));
            return;
          }
        }
      },
      switch_entry(fn, arg) {
        // This is called if this thread was created by a clone call,
        // and therefore we our entrypoint is a user-specified function.
        // Our custom variant of the clone syscall spawns a worker that calls
        // switch_entry, then immediately calls instantiate.

        assert(parent_module);
        assert(parent_memory);

        module = parent_module;
        memory = parent_memory;

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
    },
  };
}

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory, parent_user_module, parent_user_memory } =
    event.data;

  const user = user_imports({
    kernel_memory: memory,
    get_kernel_instance: () => instance,
    parent_user_module,
    parent_user_memory,
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
      spawn_worker(fn, arg, name, user_module, user_memory) {
        postMessage({
          type: "spawn_worker",
          fn,
          arg,
          name,
          user_module,
          user_memory,
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

  const instance = (new WebAssembly.Instance(vmlinux, imports)) as Instance;
  instance.exports.__indirect_function_table.get(fn)!(arg);
};
