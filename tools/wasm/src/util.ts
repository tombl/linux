export function assert(
  cond: unknown,
  message = "Assertation failed",
): asserts cond {
  if (!cond) throw new Error(message);
}

export function unreachable(_: never, message = "Unreachable reached"): never {
  throw new Error(message);
}

declare const BRANDED: unique symbol;
export type Branded<T, B> = T & { [BRANDED]: B };

export const PAGE_SIZE = 0x10000;

export type u8 = Branded<number, "u8">;
export type u32 = Branded<number, "u32">;
export type u64 = Branded<bigint, "u64">;
export type ptr = Branded<number, "ptr">;
export const NULL = 0 as ptr;

export type ModuleURL<Exports> = Branded<URL, ["ModuleURL", Exports]>;
export type UnwrapModuleURL<T> = T extends ModuleURL<infer Exports> ? Exports : never;

export function getModuleURL<T>(fn: () => Promise<T>, importMeta: ImportMeta) {
  const match = fn.toString().match(/import\("(.*)"\)/)?.[1];
  assert(match, "Could not find imported path");
  return new URL(match, importMeta.url) as ModuleURL<T>;
}

export class EventEmitter<Events> {
  #subscribers: { [K in keyof Events]?: Set<(data: Events[K]) => void> } = {};
  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void) {
    (this.#subscribers[event] ??= new Set()).add(handler);
  }
  off<K extends keyof Events>(event: K, handler: (data: Events[K]) => void) {
    this.#subscribers[event]?.delete(handler);
  }
  protected emit<K extends keyof Events>(event: K, data: Events[K]) {
    this.#subscribers[event]?.forEach((handler) => handler(data));
  }
}

export function deepAssign<T extends object>(target: T, ...sources: T[]) {
  for (const source of sources) {
    for (const key in source) {
      if (typeof source[key] === "object" && source[key]?.constructor === Object) {
        assert(typeof target[key] === "object" || target[key] === undefined);
        // @ts-expect-error
        target[key] = deepAssign(target[key] ?? {}, source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  return target;
}
