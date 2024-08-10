import { generateDevicetree } from "./devicetree.ts";
import type { FromWorkerMessage, ToWorkerMessage } from "./worker.ts";
import { unreachable } from "./util.ts";

const PAGE_SIZE = 1 << 16; // 64KiB

interface MachineEventMap {
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
  memoryPages = 1024, // 64MiB
  cpus = navigator.hardwareConcurrency,
}: {
  cmdline: string;
  vmlinux: WebAssembly.Module;
  sections: Record<string, number[]>;
  memoryPages?: number;
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

  function newWorker(
    name: string,
    initMessage: ToWorkerMessage,
    initTransfer: Transferable[],
  ) {
    const worker = new Worker(
      new URL(
        (() => {
          import("./worker.ts");
        }).toString().match(/import\("(.*)"\)/)![1],
        import.meta.url,
      ),
      { type: "module", name },
    );

    worker.onmessage = async ({ data }: MessageEvent<FromWorkerMessage>) => {
      switch (data.type) {
        case "boot-console-write":
          bootConsoleWriter.write(data.message);
          break;
        case "boot-console-close":
          await bootConsoleWriter.close();
          await bootConsole.writable.close();
          break;
        case "restart":
          emit("restart", undefined);
          break;
        case "spawn":
          newWorker(data.name, {
            type: "task",
            task: data.task,
            vmlinux,
            memory,
          }, []);
          break;
        case "error":
          emit("error", { error: data.error, threadName: name });
          break;
        case "bringup-secondary":
          newWorker(`entry${data.cpu}`, {
            type: "secondary",
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

  const memory = new WebAssembly.Memory({
    initial: memoryPages,
    maximum: memoryPages,
    shared: true,
  });

  const devicetree = generateDevicetree({
    "#address-cells": 1,
    "#size-cells": 1,
    ncpus: cpus,
    chosen: {
      "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
      bootargs: cmdline,
    },
    aliases: {},
    memory: {
      device_type: "memory",
      reg: [0, memoryPages * PAGE_SIZE],
    },
    "data-sections": sections,
  });

  newWorker(
    "entry",
    { type: "boot", devicetree, vmlinux, memory },
    [devicetree.buffer],
  );

  const machine = eventTarget as Partial<Machine>;
  machine.bootConsole = bootConsole.readable;
  return machine as Machine;
}
