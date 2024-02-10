export function assert(cond: unknown, message = "Assertation failed"): asserts cond {
  if (!cond) throw new Error(message);
}

export function unreachable(_: never, message = "Unreachable reached"): never {
  throw new Error(message);
}