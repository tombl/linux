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

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory } = event.data;

  const imports = {
    env: { memory },
    boot: {
      get_devicetree: unavailable,
      get_initramfs: unavailable,
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
};
