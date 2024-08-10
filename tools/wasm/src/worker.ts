/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { assert, unreachable } from "./util.ts";

export type ToWorkerMessage =
  & {
    vmlinux: WebAssembly.Module;
    memory: WebAssembly.Memory;
  }
  & (
    | { type: "boot"; devicetree: Uint8Array }
    | { type: "task"; task: number }
    | { type: "secondary"; cpu: number; idle: number }
  );

export type FromWorkerMessage =
  | { type: "boot-console-write"; message: Uint8Array }
  | { type: "boot-console-close" }
  | { type: "halt" }
  | { type: "restart" }
  | { type: "spawn"; task: number; name: string }
  | { type: "error"; error: Error }
  | { type: "bringup-secondary"; cpu: number; idle: number };

interface Instance {
  exports: {
    boot(): void;
    task(task: number): void;
    secondary(cpu: number, idle: number): void;
  };
}

// const BACKTRACE_ADDRESS_RE = /wasm:.*:((?:0x)?[0-9a-f]+)\)$/gm;
// function iteratorNth<T>(iter: Iterator<T>, n: number) {
//   let value: T | undefined;
//   for (let i = 0; i < n; i++) value = iter.next().value;
//   return value;
// }

function postMessage(
  message: FromWorkerMessage,
  transfer: Transferable[] = [],
) {
  self.postMessage(message, transfer);
}

self.onmessage = ({ data }: MessageEvent<ToWorkerMessage>) => {
  try {
    const memory = new Uint8Array(data.memory.buffer);

    const imports = {
      env: { memory: data.memory },
      kernel: {
        breakpoint() {
          // deno-lint-ignore no-debugger
          debugger;
        },
        halt() {
          postMessage({ type: "halt" });
        },
        restart() {
          postMessage({ type: "restart" });
        },

        boot_console_write(msg: number, len: number) {
          const message = memory.slice(msg, msg + len);
          postMessage({ type: "boot-console-write", message }, [
            message.buffer,
          ]);
        },
        boot_console_close() {
          postMessage({ type: "boot-console-close" });
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

        get_dt(buf: number, size: number) {
          assert(data.type === "boot", "get_dt called on non-boot thread");
          assert(
            size >= data.devicetree.byteLength,
            "Device tree truncated",
          );
          memory.set(data.devicetree.slice(0, size), buf);
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
          return BigInt(
            Math.round((performance.now() + performance.timeOrigin) * 200),
          ) * 5000n;
        },

        get_stacktrace(buf: number, size: number) {
          // 5 lines: strip Error, strip 4 common lines of stack
          const trace = new TextEncoder().encode(
            new Error().stack?.split("\n").slice(5).join("\n"),
          );
          if (trace.byteLength > size) {
            /// 46 = "."
            trace[size - 1] = 46;
            trace[size - 2] = 46;
            trace[size - 3] = 46;
          }
          memory.set(trace.slice(0, size), buf);
        },

        new_worker(task: number, comm: number, commLen: number) {
          const name = new TextDecoder().decode(
            memory.slice(comm, comm + commLen),
          );
          postMessage({ type: "spawn", task, name });
        },

        bringup_secondary(cpu: number, idle: number) {
          postMessage({ type: "bringup-secondary", cpu, idle });
        },
      },
    } satisfies WebAssembly.Imports;

    const instance = new WebAssembly.Instance(
      data.vmlinux,
      imports,
    ) as Instance;

    switch (data.type) {
      case "boot":
        instance.exports.boot();
        break;
      case "task":
        instance.exports.task(data.task);
        break;
      case "secondary":
        instance.exports.secondary(data.cpu, data.idle);
        break;
      default:
        unreachable(data);
    }
  } catch (error) {
    console.error(error);
    postMessage({
      type: "error",
      error: error instanceof Error ? error : new Error(error),
    });
  }
};
