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

const HALT_USER = Symbol("halt");

let user_module: WebAssembly.Module | null = null;
let user_instance: WebAssembly.Instance | null = null;
let user_memory: WebAssembly.Memory | null = null;

function original_call_user_entry(): void {
  assert(user_instance);
  const { _start } = user_instance.exports;
  assert(typeof _start === "function", "_start not found");
  _start();
  throw new Error("_start reached the end without exiting");
}
let call_user_entry = original_call_user_entry;

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory, parent_user_module, parent_user_memory } =
    event.data;
  const memory_buffer = new Uint8Array(memory.buffer);

  const imports = {
    env: { memory },
    boot: {
      get_devicetree: unavailable,
      get_initramfs: unavailable,
    },
    user: {
      compile(buf, size) {
        const bytes = new Uint8Array(memory_buffer.slice(buf, buf + size));
        try {
          user_module = new WebAssembly.Module(bytes);
          return 0;
        } catch {
          return -8; // exec format error
        }
      },
      instantiate() {
        assert(user_module);

        // TODO: read the real initial size from the module.
        // TOOD: enforce rlimit via maximum.
        if (!user_memory) {
          user_memory = new WebAssembly.Memory({
            initial: 2048,
            maximum: 2048,
            shared: true,
          });
        }

        try {
          user_instance = new WebAssembly.Instance(user_module, {
            env: { memory: user_memory },
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
                const original_user_instance = user_instance;
                const ret = instance.exports.syscall(
                  nr,
                  arg0,
                  arg1,
                  arg2,
                  arg3,
                  arg4,
                  arg5,
                );
                if (user_instance !== original_user_instance) {
                  call_user_entry = original_call_user_entry;
                  call_user_entry();
                  throw HALT_USER;
                }
                return ret;
              },
              get_thread_area: instance.exports.get_thread_area,
              get_args_length: instance.exports.get_args_length,
              get_args: instance.exports.get_args,
            },
          });

          if ("memory" in user_instance.exports) {
            assert(user_instance.exports.memory instanceof WebAssembly.Memory);
            user_memory = user_instance.exports.memory;
          }
        } catch (error) {
          console.log("error instantiating user module:", String(error));
        }
      },
      call() {
        try {
          call_user_entry();
        } catch (error) {
          console.log("error running user module:", String(error));
        }
      },
      switch_entry(fn, arg) {
        assert(parent_user_module);
        assert(parent_user_memory);

        user_module = parent_user_module;
        user_memory = parent_user_memory;

        call_user_entry = () => {
          assert(user_instance);

          const { __indirect_function_table } = user_instance.exports;
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
        };
      },
      read(to, from, n) {
        assert(user_memory);
        const slice = new Uint8Array(user_memory.buffer, from, n);
        memory_buffer.set(slice, to);
        return n - slice.length;
      },
      write(to, from, n) {
        assert(user_memory);
        const slice = memory_buffer.subarray(from, from + n);
        new Uint8Array(user_memory.buffer, to, n).set(slice);
        return n - slice.length;
      },
      write_zeroes(to, n) {
        assert(user_memory);
        const slice = new Uint8Array(user_memory.buffer, to, n);
        slice.fill(0);
        return n - slice.length;
      },
    },
    kernel: kernel_imports({
      is_worker: true,
      memory,
      spawn_worker(fn, arg, name, user_module, user_memory) {
        // these should be non-null for threads spawned via clone()
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
        return user_module;
      },
      get_user_memory() {
        return user_memory;
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
