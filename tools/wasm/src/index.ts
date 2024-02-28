import { generateDevicetree } from "./devicetree.ts";
import type { FromWorkerMessage, ToWorkerMessage } from "./worker.ts";
import { unreachable } from "./util.ts";

const PAGE_SIZE = 1 << 16; // 64KiB

interface MachineEventMap {
  error: CustomEvent<{ error: Error; workerName: string }>;
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
}: {
  cmdline: string;
  vmlinux: WebAssembly.Module;
  memoryPages?: number;
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

  function newWorker(name: string) {
    const worker = new Worker(
      new URL(
        (() => {
          import("./worker.ts");
        }).toString().match(/import\("(.*)"\)/)![1],
        import.meta.url,
      ),
      { type: "module", name },
    );
    function postMessage(
      message: ToWorkerMessage,
      transfer: Transferable[] = [],
    ) {
      worker.postMessage(message, transfer);
    }

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
            // @ts-ignore: reloads browsers, inert on deno/node
            globalThis?.location?.reload?.();
            break;
          case "error":
            emit("error", { error: data.err, workerName: name });
            break;
          default:
            unreachable(
              data,
              `invalid worker message type: ${(data as { type: string }).type}`,
            );
        }
      },
    );
    worker.addEventListener("error", (event) => emit("error", event.error));

    return { postMessage };
  }

  const memory: WebAssembly.Memory = new WebAssembly.Memory({
    initial: memoryPages,
    maximum: memoryPages,
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
      reg: [0, memoryPages * PAGE_SIZE],
    },
  });

  newWorker("entry").postMessage(
    {
      type: "boot",
      vmlinux,
      memory,
      devicetree,
    },
    [devicetree.buffer],
  );

  const machine = eventTarget as unknown as Machine;
  machine.bootConsole = bootConsole.readable;
  return machine;
}
