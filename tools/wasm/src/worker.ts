import { assert } from "./util.ts";
import { type Imports, type Instance, kernel_imports } from "./wasm.ts";

export interface InitMessage {
  fn: number;
  arg: number;
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
}
export type WorkerMessage =
  | { type: "spawn_worker"; fn: number; arg: number; name: string }
  | { type: "boot_console_write"; message: ArrayBuffer }
  | { type: "boot_console_close" }
  | { type: "run_on_main"; fn: number; arg: number };

const unavailable = () => {
  throw new Error("not available on worker thread");
};

const postMessage = self.postMessage as (message: WorkerMessage) => void;

let user_module: WebAssembly.Module | null = null;
let user_instance: WebAssembly.Instance | null = null;

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory } = event.data;
  const mem = new Uint8Array(memory.buffer);

  const imports = {
    env: { memory },
    boot: {
      get_devicetree: unavailable,
      get_initramfs: unavailable,
    },
    user: {
      compile(buf, size) {
        const bytes = new Uint8Array(mem.slice(buf, buf + size));
        try {
          user_module = new WebAssembly.Module(bytes);
          return 0;
        } catch {
          return -8; // exec format error
        }
      },
      instantiate(stack, memory_base, table_size) {
        assert(user_module);

        try {
          user_instance = new WebAssembly.Instance(user_module, {
            env: {
              memory,
              __stack_pointer: new WebAssembly.Global({
                value: "i32",
                mutable: true,
              }, stack),
              __memory_base: memory_base,
              __indirect_function_table: new WebAssembly.Table({
                element: "anyfunc",
                initial: table_size,
              }),
              __table_base: 0,
            },
            linux: {
              syscall: instance.exports.syscall,
              get_thread_area: instance.exports.get_thread_area,
            },
          });

          const { __wasm_apply_data_relocs } = user_instance.exports;
          if (typeof __wasm_apply_data_relocs === "function") {
            __wasm_apply_data_relocs();
          }
        } catch (error) {
          console.warn("error instantiating user module:", error);
        }
    },
    },
    kernel: kernel_imports({
      is_worker: true,
      memory,
      spawn_worker(fn, arg, name) {
        postMessage({ type: "spawn_worker", fn, arg, name });
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
  instance.exports.call(fn, arg);

  assert(user_instance, "kernel thread stopped before user module was loaded");
  const { _start } = user_instance.exports;
  assert(typeof _start === "function", "_start not found");
  _start();
};
