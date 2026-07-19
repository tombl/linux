// The seam between web APIs (browsers) and node builtins (node, deno).
// Selected at runtime by the presence of process.getBuiltinModule, so bundlers
// only ever see the web path and never try to resolve node builtins.

import { assert } from "./util.ts";

export interface WorkerHandle {
  post(message: unknown): void;
  terminate(): void;
}

export interface WorkerHandlers {
  on_message(message: unknown): void;
  on_error(error: Error): void;
}

/** A worker's connection back to the thread that spawned it. */
export interface WorkerChannel {
  post(message: unknown): void;
  on_message(handler: (message: unknown) => void): void;
}

interface Platform {
  load_wasm(url: URL): Promise<{
    bytes: Uint8Array<ArrayBuffer>;
    module: WebAssembly.Module;
  }>;
  spawn_worker(name: string, handlers: WorkerHandlers): WorkerHandle;
  worker_channel(): WorkerChannel;
  quit(): void;
}

const web: Platform = {
  async load_wasm(url) {
    const response = await fetch(url);
    // native code caching is only supported with the *Streaming functions, so use it:
    const module = await WebAssembly.compileStreaming(response.clone());
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, module };
  },
  spawn_worker(name, handlers) {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
      name,
    });
    worker.onmessage = (event) => handlers.on_message(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      handlers.on_error(
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "machine worker failed"),
      );
    };
    return {
      post: (message) => worker.postMessage(message),
      terminate: () => worker.terminate(),
    };
  },
  worker_channel() {
    return {
      post: (message) => self.postMessage(message),
      on_message: (handler) => {
        self.onmessage = (event) => handler(event.data);
      },
    };
  },
  quit() {
    self.close();
  },
};

// Hand-written types for the slices of the node builtins we use, so that
// @types/node doesn't leak into a web-first package.
interface NodeWorker {
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
  on(event: "message", handler: (message: unknown) => void): this;
  on(event: "error", handler: (error: Error) => void): this;
}

interface NodeParentPort {
  postMessage(message: unknown): void;
  on(event: "message", handler: (message: unknown) => void): this;
}

interface GetBuiltinModule {
  (id: "node:fs/promises"): {
    readFile(path: URL): Promise<Uint8Array<ArrayBuffer>>;
  };
  (id: "node:worker_threads"): {
    Worker: new (filename: URL, options: { name: string }) => NodeWorker;
    parentPort: NodeParentPort | null;
  };
}

interface NodeProcess {
  getBuiltinModule?: GetBuiltinModule;
  exit(code: number): never;
}

function node(
  getBuiltinModule: GetBuiltinModule,
  process: NodeProcess,
): Platform {
  const { readFile } = getBuiltinModule("node:fs/promises");
  const { Worker, parentPort } = getBuiltinModule("node:worker_threads");
  return {
    async load_wasm(url) {
      const bytes = await readFile(url);
      return { bytes, module: await WebAssembly.compile(bytes) };
    },
    spawn_worker(name, handlers) {
      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        name,
      });
      worker.on("message", handlers.on_message);
      worker.on("error", handlers.on_error);
      return {
        post: (message) => worker.postMessage(message),
        terminate: () => void worker.terminate(),
      };
    },
    worker_channel() {
      assert(parentPort, "not in a worker");
      return {
        post: (message) => parentPort.postMessage(message),
        on_message: (handler) => parentPort.on("message", handler),
      };
    },
    quit() {
      process.exit(0);
    },
  };
}

const process = (globalThis as { process?: NodeProcess }).process;
const getBuiltinModule = process?.getBuiltinModule;

export const platform: Platform = getBuiltinModule && process
  ? node(getBuiltinModule, process)
  : web;
