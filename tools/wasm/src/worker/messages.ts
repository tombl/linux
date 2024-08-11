import { ptr, u32 } from "../util.ts";

export const enum ToWorkerMessageType {
  BOOT,
  TASK,
  SECONDARY,
}

export type ToWorkerMessage =
  & {
    vmlinux: WebAssembly.Module;
    memory: WebAssembly.Memory;
  }
  & (
    | { type: ToWorkerMessageType.BOOT; devicetree: Uint8Array }
    | { type: ToWorkerMessageType.TASK; task: ptr }
    | { type: ToWorkerMessageType.SECONDARY; cpu: u32; idle: ptr }
  );

export const enum FromWorkerMessageType {
  BOOT_CONSOLE_WRITE,
  BOOT_CONSOLE_CLOSE,
  HALT,
  RESTART,
  SPAWN,
  ERROR,
  BRINGUP_SECONDARY,
}

export type FromWorkerMessage =
  | {
    type: FromWorkerMessageType.BOOT_CONSOLE_WRITE;
    message: Uint8Array;
  }
  | { type: FromWorkerMessageType.BOOT_CONSOLE_CLOSE }
  | { type: FromWorkerMessageType.HALT }
  | { type: FromWorkerMessageType.RESTART }
  | { type: FromWorkerMessageType.SPAWN; task: ptr; name: string }
  | { type: FromWorkerMessageType.ERROR; error: Error }
  | {
    type: FromWorkerMessageType.BRINGUP_SECONDARY;
    cpu: u32;
    idle: ptr;
  };
