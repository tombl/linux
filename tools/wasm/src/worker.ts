/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { assert, unreachable } from "./util.ts";

const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number) {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

export type ToWorkerMessage = {
  type: "boot";
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
  devicetree: Uint8Array;
} | {
  type: "start";
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
  arg: number;
};

export type FromWorkerMessage =
  | { type: "boot-console-write"; message: Uint8Array }
  | { type: "boot-console-close" }
  | { type: "restart" }
  | { type: "error"; err: Error }
  | { type: "new-worker"; arg: number; name: string };

function postMessage(
  message: FromWorkerMessage,
  transfer: Transferable[] = [],
) {
  self.postMessage(message, transfer);
}

interface Instance {
  exports: {
    start(): void;
    task_entry(worker: number): void;
  };
}

const IDLE = Symbol("idle");

async function boot(
  module: WebAssembly.Module,
  wasmMemory: WebAssembly.Memory,
  options: { type: "boot"; devicetree: Uint8Array } | {
    type: "secondary";
    task: number;
  },
) {
  const memory = new Uint8Array(wasmMemory.buffer);

  let irqflags = 0;
  const instance = (await WebAssembly.instantiate(module, {
    env: { memory: wasmMemory },
    kernel: {
      breakpoint() {
        // deno-lint-ignore no-debugger
        debugger;
      },
      boot_console_write(msg: number, len: number) {
        const message = memory.slice(msg, msg + len);
        postMessage({ type: "boot-console-write", message }, [message.buffer]);
      },
      boot_console_close() {
        postMessage({ type: "boot-console-close" }, []);
      },
      relax() {
        sleepSync(1);
      },
      restart() {
        postMessage({ type: "restart" });
      },
      get_dt(buf: number, size: number) {
        assert(options.type === "boot", "get_dt called on non-boot thread");
        assert(size >= options.devicetree.byteLength, "Device tree truncated");
        memory.set(options.devicetree.slice(0, size), buf);
      },

      set_irq_enabled(flags: number) {
        irqflags = flags;
      },
      get_irq_enabled() {
        return irqflags;
      },

      return_address() {
        return -1;
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
        console.assert(size >= trace.byteLength, "Stacktrace truncated");
        memory.set(trace.slice(0, size), buf);
      },

      new_worker(arg: number, name: number) {
        postMessage({
          type: "new-worker",
          arg,
          name: new TextDecoder().decode(memory.slice(name, name + 16)),
        });
      },

      idle() {
        throw IDLE;
      },
    },
  })) as Instance;

  try {
    switch (options.type) {
      case "boot":
        instance.exports.start();
        break;
      case "secondary":
        instance.exports.task_entry(options.task);
        break;
      default:
        unreachable(options);
    }
  } catch (err) {
    if (err === IDLE) {
      console.log("idle", options.type, name);
      return;
    }
    postMessage({ type: "error", err });
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
      case "start":
        boot(data.vmlinux, data.memory, {
          type: "secondary",
          task: data.arg,
        });
        break;
      default:
        unreachable(
          data,
          `invalid worker message type: ${(data as { type: string }).type}`,
        );
    }
  },
);
