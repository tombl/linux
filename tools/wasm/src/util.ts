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

export function getScriptPath(fn: () => void, meta: ImportMeta) {
  return new URL(
    fn.toString().match(/import\("(.*)"\)/)![1],
    meta.url,
  );
}
