// corrosponds to arch/wasm/kernel/wasm_imports.h

import { FromWorkerMessageType } from "./messages.ts";
import { NULL, ptr, u32, u64 } from "../util.ts";
import { postMessage } from "./worker.ts";

export class KernelImports {
  #memory: Uint8Array;
  constructor(memory: Uint8Array) {
    this.#memory = memory;
  }

  breakpoint = (): void => {
    // deno-lint-ignore no-debugger
    debugger;
  };
  halt = (): void => {
    postMessage({ type: FromWorkerMessageType.HALT });
  };
  restart = (): void => {
    postMessage({ type: FromWorkerMessageType.RESTART });
  };

  boot_console_write = (msg: ptr, len: u32): void => {
    const message = this.#memory.slice(msg, msg + len);
    postMessage({ type: FromWorkerMessageType.BOOT_CONSOLE_WRITE, message }, [
      message.buffer,
    ]);
  };
  boot_console_close = (): void => {
    postMessage({ type: FromWorkerMessageType.BOOT_CONSOLE_CLOSE });
  };

  return_address = (_level: u32): ptr => {
    // const matches = new Error().stack?.matchAll(BACKTRACE_ADDRESS_RE);
    // if (!matches) return -1;
    // const match = iteratorNth(matches, level + 1);
    // return parseInt(match?.[1] ?? "-1");
    return NULL;
  };

  get_now_nsec = (): u64 => {
    /*
        The more straightforward way to do this is
        `BigInt(Math.round(performance.now() * 1_000_000))`.
        Below is semantically identical but has less floating point
        inaccuracy.
        `performance.now()` has 5μs precision in the browser.
        In server runtimes it has full nanosecond precision, but this code
        rounds to the same 5μs precision.
      */
    return (
      BigInt(
        Math.round((performance.now() + performance.timeOrigin) * 200),
      ) * 5000n
    ) as u64;
  };

  get_stacktrace = (buf: ptr, size: u32): void => {
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
    this.#memory.set(trace.slice(0, size), buf);
  };

  new_worker = (task: ptr, comm: ptr, commLen: u32) => {
    const name = new TextDecoder().decode(
      this.#memory.slice(comm, comm + commLen),
    );
    postMessage({ type: FromWorkerMessageType.SPAWN, task, name });
  };

  bringup_secondary = (cpu: u32, idle: ptr) => {
    postMessage({ type: FromWorkerMessageType.BRINGUP_SECONDARY, cpu, idle });
  };
}
