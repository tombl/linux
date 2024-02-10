/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { assert, unreachable } from "./util.ts";

const getImports = (
  wasmMemory: WebAssembly.Memory,
  memory = new Uint8Array(wasmMemory.buffer),
): WebAssembly.Imports => {
  return {
    env: { memory: wasmMemory },
    kernel: {
      boot_console_write(msg: number, len: number) {
        console.log(new TextDecoder().decode(memory.slice(msg, msg + len)));
      },
      boot_console_close() {},
      get_dt(_buf: number, _size: number) {
        throw new Error("The device tree is only available on the boot thread");
      },

      set_irq_enabled(_enabled: number) {},
      get_irq_enabled() {},
      return_address() {
        return -1;
      },
      relax() {},
      get_now_nsec() {
        /*
          the more straightforward way to do this is
          `BigInt(Math.round(performance.now() * 1_000_000))`
          below is semantically identical but has less floating point
          inaccuracy.
          `performance.now()` has 5μs precision in the browser.
          In server runtimes it has full nanosecond precision, but this code
          rounds to the same 5μs
          */
        return BigInt(Math.round(performance.now() * 200)) * 5000n;
      },
    },
  };
};

export type ToWorkerMessage = {
  type: "boot";
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
  devicetree: Uint8Array;
};

export type FromWorkerMessage =
  | { type: "boot-console-write"; message: Uint8Array }
  | { type: "boot-console-close" }
  | { type: "booted" };

function postMessage(
  message: FromWorkerMessage,
  transfer: Transferable[] = [],
) {
  self.postMessage(message, transfer);
}

self.addEventListener(
  "message",
  async ({ data }: MessageEvent<ToWorkerMessage>) => {
    switch (data.type) {
      case "boot": {
        const memory = new Uint8Array(data.memory.buffer);
        const imports = getImports(data.memory, memory);

        imports.kernel.boot_console_write = (msg: number, len: number) => {
          const message = memory.slice(msg, msg + len);
          postMessage({ type: "boot-console-write", message }, [message.buffer]);
        };
        imports.kernel.boot_console_close = () => {
          postMessage({ type: "boot-console-close" }, []);
        }
        imports.kernel.get_dt = (buf: number, size: number) => {
          assert(size >= data.devicetree.byteLength, "Device tree truncated");
          memory.set(data.devicetree.slice(0, size), buf);
        };

        const instance = await WebAssembly.instantiate(data.module, imports);

        (instance.exports as { _start(): void })._start();

        postMessage({ type: "booted" });
        break;
      }
      default:
        unreachable(data.type, `invalid worker message type: ${data.type}`);
    }
  },
);
