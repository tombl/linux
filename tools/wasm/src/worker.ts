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
  | { type: "boot_console_close" };

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory } = event.data;

  const imports = {
    env: { memory },
    boot: {
      get_devicetree(_buf, _size) {
        throw new Error("get_devicetree on worker thread");
      },
    },
    kernel: kernel_imports({
      is_worker: true,
      memory,
      spawn_worker(fn, arg, name) {
        self.postMessage(
          { type: "spawn_worker", fn, arg, name } satisfies WorkerMessage,
        );
      },
      boot_console_write(message) {
        self.postMessage(
          { type: "boot_console_write", message } satisfies WorkerMessage,
        );
      },
      boot_console_close() {
        self.postMessage(
          { type: "boot_console_close" } satisfies WorkerMessage,
        );
      },
    }),
  } satisfies Imports;

  const instance = (new WebAssembly.Instance(vmlinux, imports)) as Instance;
  instance.exports.worker_entry(fn, arg);
};
