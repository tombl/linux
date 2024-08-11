import { generateDevicetree } from "./devicetree.ts";
import {
  type FromWorkerMessage,
  FromWorkerMessageType,
  type ToWorkerMessage,
  ToWorkerMessageType,
} from "./worker/messages.ts";
import { assert, getScriptPath, unreachable } from "./util.ts";
import { Entropy } from "./worker/virtio.ts";

interface MachineEventMap {
  halt: CustomEvent<void>;
  restart: CustomEvent<void>;
  error: CustomEvent<{ error: Error; threadName: string }>;
}

interface Machine {
  bootConsole: ReadableStream<Uint8Array>;

  addEventListener<K extends keyof MachineEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: MachineEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MachineEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: MachineEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export function start({
  cmdline,
  vmlinux,
  sections,
  memoryMib = 128,
  cpus = navigator.hardwareConcurrency,
}: {
  cmdline: string;
  vmlinux: WebAssembly.Module;
  sections: Record<string, number[]>;
  memoryMib?: number;
  cpus?: number;
}) {
  const bootConsole = new TransformStream<Uint8Array, Uint8Array>();
  const bootConsoleWriter = bootConsole.writable.getWriter();

  const eventTarget = new EventTarget();
  function emit<K extends keyof MachineEventMap>(
    type: K,
    detail: MachineEventMap[K]["detail"],
  ) {
    eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
  }

  const workers: Worker[] = [];

  function newWorker(
    name: string,
    initMessage: ToWorkerMessage,
    initTransfer: Transferable[],
  ) {
    const worker = new Worker(
      getScriptPath(() => import("./worker/worker.ts"), import.meta),
      { type: "module", name },
    );
    workers.push(worker);

    worker.onmessage = async ({ data }: MessageEvent<FromWorkerMessage>) => {
      switch (data.type) {
        case FromWorkerMessageType.BOOT_CONSOLE_WRITE:
          bootConsoleWriter.write(data.message);
          break;
        case FromWorkerMessageType.BOOT_CONSOLE_CLOSE:
          await bootConsoleWriter.close();
          await bootConsole.writable.close();
          break;
        case FromWorkerMessageType.HALT:
          emit("halt", undefined);
          for (const worker of workers) {
            worker.terminate();
          }
          break;
        case FromWorkerMessageType.RESTART:
          emit("restart", undefined);
          break;
        case FromWorkerMessageType.SPAWN:
          newWorker(data.name, {
            type: ToWorkerMessageType.TASK,
            task: data.task,
            vmlinux,
            memory,
          }, []);
          break;
        case FromWorkerMessageType.ERROR:
          emit("error", { error: data.error, threadName: name });
          for (const worker of workers) {
            worker.terminate();
          }
          break;
        case FromWorkerMessageType.BRINGUP_SECONDARY:
          newWorker(`entry${data.cpu}`, {
            type: ToWorkerMessageType.SECONDARY,
            cpu: data.cpu,
            idle: data.idle,
            vmlinux,
            memory,
          }, []);
          break;
        default:
          unreachable(
            data,
            `invalid worker message type: ${(data as { type: string }).type}`,
          );
      }
    };

    worker.postMessage(initMessage, initTransfer);
  }

  const PAGES_PER_MIB = 16;
  const BYTES_PER_MIB = 0x100000;
  const memoryPages = memoryMib * PAGES_PER_MIB;
  const memoryBytes = memoryMib * BYTES_PER_MIB;

  const memory = new WebAssembly.Memory({
    initial: memoryPages,
    maximum: memoryPages,
    shared: true,
  });
  assert(memory.buffer.byteLength === memoryBytes);

  const devicetree = generateDevicetree({
    "#address-cells": 1,
    "#size-cells": 1,
    chosen: {
      "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
      bootargs: cmdline,
      ncpus: cpus,
      sections,
    },
    aliases: {},
    memory: {
      device_type: "memory",
      reg: [0, memoryBytes],
    },
    viorng: {
      compatible: "virtio,wasm",
      "host-id": 0x4321,
      "virtio-id": Entropy.DEVICE_ID,
    },
  });

  newWorker(
    "entry",
    { type: ToWorkerMessageType.BOOT, devicetree, vmlinux, memory },
    [devicetree.buffer],
  );

  const machine = eventTarget as Partial<Machine>;
  machine.bootConsole = bootConsole.readable;
  return machine as Machine;
}
