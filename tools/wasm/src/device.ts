import type { Machine } from "./index.ts";
import type { RemoteOf } from "./rpc.ts";
import type { ModuleURL } from "./util.ts";

type MaybePromise<T> = T | Promise<T>;

export interface WorkerContext {
  memory: WebAssembly.Memory;
}

export type WorkerDefault<T> = (
  ctx: WorkerContext,
  main: RemoteOf<T>,
) => MaybePromise<{ imports?: WebAssembly.ModuleImports }>;

export interface DeviceController<Config> {
  name: string;
  setup?(machine: Machine, devices: Config[]): MaybePromise<void>;
  workerURL?: ModuleURL<{ default: WorkerDefault<any> }>;
}

export interface Device<T> {
  name: string;
  controller: DeviceController<T>;
  config: T;
}
