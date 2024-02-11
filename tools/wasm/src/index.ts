import { generateDevicetree } from "./devicetree.ts";
import type { FromWorkerMessage, ToWorkerMessage } from "./worker.ts";
import { unreachable } from "./util.ts";

const PAGE_SIZE = 1 << 16; // 64KiB

interface MachineEventMap {
  booted: CustomEvent<void>;
  error: CustomEvent<Error>;
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
  memoryPages = 1024, // 64MiB
  maxMemoryPages = memoryPages,
}: {
  cmdline: string;
  vmlinux: WebAssembly.Module;
  memoryPages?: number;
  maxMemoryPages?: number;
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

  const worker = new Worker(
    (self as { BUNDLED?: true }).BUNDLED
      ? new URL("./worker.js", import.meta.url)
      : import.meta.resolve("./worker.ts"),
    { type: "module" },
  );
  function postMessage(
    message: ToWorkerMessage,
    transfer: Transferable[] = [],
  ) {
    worker.postMessage(message, transfer);
  }

  const workers = new Map<number, Worker>();
  workers.set(0, worker);

  worker.addEventListener(
    "message",
    async ({ data }: MessageEvent<FromWorkerMessage>) => {
      switch (data.type) {
        case "boot-console-write":
          bootConsoleWriter.write(data.message);
          break;
        case "boot-console-close":
          await bootConsoleWriter.close();
          await bootConsole.writable.close();
          break;
        case "restart":
          // @ts-ignore
          globalThis?.location?.reload?.();
          break;
        case "error":
          emit("error", data.err);
          break;
        case "booted":
          emit("booted", undefined);
          break;
        case "spawn-worker":
          console.log("spawn worker", data.id);
          break;
        case "start-worker":
          console.log("start worker", data.id);
          break;
        default:
          unreachable(
            data,
            `invalid worker message type: ${(data as { type: string }).type}`,
          );
      }
    },
  );
  worker.addEventListener("error", (event) => {
    console.error(event.error);
  });

  const memory: WebAssembly.Memory = new WebAssembly.Memory({
    initial: memoryPages,
    maximum: maxMemoryPages,
    shared: true,
  });

  const devicetree = generateDevicetree({
    chosen: {
      "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
      bootargs: cmdline,
    },
    aliases: {},
    memory: {
      device_type: "memory",
      reg: [0, maxMemoryPages * PAGE_SIZE],
    },
  });

  postMessage(
    {
      type: "boot",
      module: vmlinux,
      memory,
      devicetree,
    },
    [devicetree.buffer],
  );

  const machine = eventTarget as unknown as Machine;
  machine.bootConsole = bootConsole.readable;
  return machine;
}
