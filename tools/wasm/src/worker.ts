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
let user_memory: WebAssembly.Memory | null = null;
let user_memory_buffer: Uint8Array | null = null;

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory } = event.data;
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

        // TODO: shared memory support by postMessage-ing the buffer back to the main thread
        // and having it pass all known memories back to newly spawned workers.
        // TODO: read the real initial size from the module.
        // TOOD: enforce rlimit via maximum.
        user_memory = new WebAssembly.Memory({
          initial: 10,
          maximum: 100,
        });
        user_memory_buffer = new Uint8Array(user_memory.buffer);

        try {
          user_instance = new WebAssembly.Instance(user_module, {
            env: { memory: user_memory },
            linux: {
              syscall: instance.exports.syscall,
              get_thread_area: instance.exports.get_thread_area,
            },
          });
        } catch (error) {
          console.warn("error instantiating user module:", error);
        }
      },
      read(to, from, n) {
        assert(user_memory_buffer);
        const slice = user_memory_buffer.subarray(from, from + n);
        memory_buffer.set(slice, to);
        return n - slice.length;
      },
      write(to, from, n) {
        assert(user_memory_buffer);
        const slice = memory_buffer.subarray(from, from + n);
        user_memory_buffer.set(slice, to);
        return n - slice.length;
      },
      write_zeroes(to, n) {
        assert(user_memory_buffer);
        const slice = user_memory_buffer.subarray(to, to + n);
        slice.fill(0);
        return n - slice.length;
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
