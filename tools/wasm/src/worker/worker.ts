/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import {
  type FromWorkerMessage,
  FromWorkerMessageType,
  type ToWorkerMessage,
  ToWorkerMessageType,
} from "./messages.ts";
import { assert, ptr, u32, unreachable } from "../util.ts";
import { KernelImports } from "./kernel.ts";
import * as virtio from "./virtio.ts";

interface Instance extends WebAssembly.Instance {
  exports: {
    boot(): void;
    task(task: ptr): void;
    secondary(cpu: u32, idle: ptr): void;
  };
}

// const BACKTRACE_ADDRESS_RE = /wasm:.*:((?:0x)?[0-9a-f]+)\)$/gm;
// function iteratorNth<T>(iter: Iterator<T>, n: number) {
//   let value: T | undefined;
//   for (let i = 0; i < n; i++) value = iter.next().value;
//   return value;
// }

export function postMessage(
  message: FromWorkerMessage,
  transfer: Transferable[] = [],
) {
  self.postMessage(message, transfer);
}

self.onmessage = ({ data }: MessageEvent<ToWorkerMessage>) => {
  try {
    const memory = new Uint8Array(data.memory.buffer);

    const devices = new Map<u32, virtio.Device>();
    devices.set(0x4321 as u32, new virtio.Entropy());

    const imports = {
      env: { memory: data.memory },
      boot: {
        get_devicetree(buf: ptr, size: u32) {
          assert(
            data.type === ToWorkerMessageType.BOOT,
            "get_devicetree called on non-boot thread",
          );
          assert(
            size >= data.devicetree.byteLength,
            "Device tree truncated",
          );
          memory.set(data.devicetree.slice(0, size), buf);
        },
      },
      kernel: new KernelImports(memory) as unknown as WebAssembly.ModuleImports,
      virtio: new virtio.VirtioImports(
        memory,
        devices,
      ) as unknown as WebAssembly.ModuleImports,
    };

    const instance = new WebAssembly.Instance(
      data.vmlinux,
      imports,
    ) as Instance;

    switch (data.type) {
      case ToWorkerMessageType.BOOT:
        instance.exports.boot();
        break;
      case ToWorkerMessageType.TASK:
        instance.exports.task(data.task);
        break;
      case ToWorkerMessageType.SECONDARY:
        instance.exports.secondary(data.cpu, data.idle);
        break;
      default:
        unreachable(data);
    }
  } catch (error) {
    console.error(error);
    postMessage({
      type: FromWorkerMessageType.ERROR,
      error: error instanceof Error ? error : new Error(error),
    });
  }
};
