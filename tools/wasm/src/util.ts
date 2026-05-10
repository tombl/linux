export function assert(
  cond: unknown,
  message = "Assertation failed",
): asserts cond {
  if (!cond) throw new Error(message);
}

export function unreachable(_: never, message = "Unreachable reached"): never {
  throw new Error(message);
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
