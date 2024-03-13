/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { assert, unreachable } from "./util.ts";

export type ToWorkerMessage = {
  type: "boot";
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
  devicetree: Uint8Array;
};

export type FromWorkerMessage =
  | { type: "boot-console-write"; message: Uint8Array }
  | { type: "boot-console-close" }
  | { type: "restart" }

function postMessage(
  message: FromWorkerMessage,
  transfer: Transferable[] = [],
) {
  self.postMessage(message, transfer);
}

interface Instance {
  exports: {
    start(): void;
  };
}

// const BACKTRACE_ADDRESS_RE = /wasm:.*:((?:0x)?[0-9a-f]+)\)$/gm;
// function iteratorNth<T>(iter: Iterator<T>, n: number) {
//   let value: T | undefined;
//   for (let i = 0; i < n; i++) value = iter.next().value;
//   return value;
// }

function boot(
  module: WebAssembly.Module,
  wasmMemory: WebAssembly.Memory,
  options: { type: "boot"; devicetree: Uint8Array },
) {
  const memory = new Uint8Array(wasmMemory.buffer);

  let irqflags = 0;
  const imports = {
    env: { memory: wasmMemory },
    kernel: {
      breakpoint() {
        // deno-lint-ignore no-debugger
        debugger;
      },
      halt() {
        self.close();
      },
      restart() {
        postMessage({ type: "restart" });
      },

      boot_console_write(msg: number, len: number) {
        const message = memory.slice(msg, msg + len);
        postMessage({ type: "boot-console-write", message }, [message.buffer]);
      },
      boot_console_close() {
        postMessage({ type: "boot-console-close" }, []);
      },

      return_address() {
        return 0;
      },
      // return_address(n: number) {
      //   const matches = new Error().stack?.matchAll(BACKTRACE_ADDRESS_RE);
      //   if (!matches) return -1;
      //   const match = iteratorNth(matches, n + 1);
      //   return parseInt(match?.[1] ?? "-1");
      // },

      set_irq_enabled(flags: number) {
        irqflags = flags;
      },
      get_irq_enabled() {
        return irqflags;
      },        
      get_dt(buf: number, size: number) {
        assert(options.type === "boot", "get_dt called on non-boot thread");
        assert(size >= options.devicetree.byteLength, "Device tree truncated");
        memory.set(options.devicetree.slice(0, size), buf);
      },

      get_now_nsec() {
        /*
          The more straightforward way to do this is
          `BigInt(Math.round(performance.now() * 1_000_000))`.
          Below is semantically identical but has less floating point
          inaccuracy.
          `performance.now()` has 5μs precision in the browser.
          In server runtimes it has full nanosecond precision, but this code
          rounds to the same 5μs precision.
        */
        return BigInt(Math.round(performance.now() * 200)) * 5000n;
      },

      get_stacktrace(buf: number, size: number) {
        // 5 lines: strip Error, strip 4 common lines of stack
        const trace = new TextEncoder().encode(
          new Error().stack?.split("\n").slice(5).join("\n"),
        );
        if (size >= trace.byteLength) {
          /// 46 = "."
          trace[size - 1] = 46;
          trace[size - 2] = 46;
          trace[size - 3] = 46;
        }
        memory.set(trace.slice(0, size), buf);
      },
    },
  } satisfies WebAssembly.Imports;

  const instances = [
    new WebAssembly.Instance(module, imports) as Instance
  ];

  switch (options.type) {
    case "boot":
      instances[0].exports.start();
      break;
    default:
      unreachable(options.type);
  }
}

self.addEventListener(
  "message",
  ({ data }: MessageEvent<ToWorkerMessage>) => {
    switch (data.type) {
      case "boot":
        boot(data.vmlinux, data.memory, {
          type: "boot",
          devicetree: data.devicetree,
        });
        break;
      default:
        unreachable(
          data.type,
          `invalid worker message type: ${(data as { type: string }).type}`,
        );
    }
  },
);
