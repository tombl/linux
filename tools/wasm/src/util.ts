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

export type u8 = Branded<number, "u8">;
export type u32 = Branded<number, "u32">;
export type u64 = Branded<bigint, "u64">;
export type ptr = Branded<number, "ptr">;
export const NULL = 0 as ptr;

export function getScriptPath(fn: () => void, importMeta: ImportMeta) {
  const match = fn.toString().match(/import\("(.*)"\)/)?.[1];
  assert(match, "Could not find imported path");
  return new URL(match, importMeta.url);
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
