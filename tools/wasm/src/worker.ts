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
  const dv = new DataView(memory.buffer);

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
    virtio: {
      get_features(dev, features_addr) {
        console.log("get_features", dev, features_addr);
        dv.setBigUint64(features_addr, 0n);
        return 0;
      },
      set_features(dev, features) {
        console.log("set_features", dev, features);
        return 0;
      },
      set_vring_enable(dev, vq, enable) {
        console.log("set_vring_enable", dev, vq, enable);
        return -1;
      },
      set_vring_num(dev, vq, num) {
        console.log("set_vring_num", dev, vq, num);
        return -1;
      },
      set_vring_addr(dev, vq, desc, used, avail) {
        console.log("set_vring_addr", dev, vq, desc, used, avail);
        return -1;
      },
      set_interrupt_addrs(dev, is_config_addr, is_vring_addr) {
        console.log("set_interrupt_addrs", dev, is_config_addr, is_vring_addr);
        return 0;
      },
      notify(dev, vq) {
        console.log("notify", dev, vq);
        return 0;
      },
    },
  } satisfies Imports;

  const instance = (new WebAssembly.Instance(vmlinux, imports)) as Instance;
  instance.exports.worker_entry(fn, arg);
};
