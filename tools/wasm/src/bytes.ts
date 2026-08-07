// SPDX-License-Identifier: MIT

import { assert } from "./util.ts";

const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface Type<T> {
  get(dv: DataView, offset: number): T;
  set(dv: DataView, offset: number, value: T): void;
  size: number;
}
export type Unwrap<T> = T extends Type<infer U> ? U : never;

export function Struct<T extends object>(
  layout: { [K in keyof T]: Type<T[K]> },
) {
  let size = 0;

  return class {
    #dv: DataView;
    constructor(view: ArrayBufferView) {
      this.#dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    }

    static {
      for (
        const [key, type] of Object.entries(
          layout as Record<PropertyKey, Type<unknown>>,
        )
      ) {
        const offset = size;
        Object.defineProperty(this.prototype, key, {
          get() {
            return type.get(this.#dv, offset);
          },
          set(value) {
            type.set(this.#dv, offset, value);
          },
        });
        size += type.size;
      }
    }

    static get(dv: DataView, offset: number) {
      if (offset !== 0) dv = new DataView(dv.buffer, dv.byteOffset + offset);
      return new this(dv);
    }
    static set(dv: DataView, offset: number, value: T) {
      if (offset !== 0) dv = new DataView(dv.buffer, dv.byteOffset + offset);
      Object.assign(new this(dv), value);
    }
    static size = size;

    toJSON() {
      const obj = {} as T;
      for (const key in layout) {
        obj[key] = (this as unknown as T)[key];
      }
      return obj;
    }
  } as { new (view: ArrayBufferView): T } & Type<T>;
}

export function FixedArray<T>(
  type: Type<T>,
  length: number,
): Type<T[]> {
  assert(Number.isInteger(length) && length > 0);
  return {
    get(dv, offset) {
      const arr = Array<T>(length);
      for (let i = 0; i < length; i++) {
        const element_offset = offset + type.size * i;
        let value = type.get(dv, element_offset);
        Object.defineProperty(arr, i, {
          enumerable: true,
          get: () => value,
          set: (next: T) => {
            type.set(dv, element_offset, next);
            value = type.get(dv, element_offset);
          },
        });
      }
      // Keep the array's shape fixed; freezing leaves accessor setters usable.
      Object.freeze(arr);
      return arr;
    },
    set(dv, offset, value) {
      for (let i = 0; i < length; i++) {
        type.set(dv, offset + type.size * i, value[i]!);
      }
    },
    size: type.size * length,
  };
}

export const U8: Type<number> = {
  get(dv, offset) {
    return dv.getUint8(offset);
  },
  set(dv, offset, value) {
    dv.setUint8(offset, value);
  },
  size: 1,
};
export const U16LE: Type<number> = {
  get(dv, offset) {
    return dv.getUint16(offset, true);
  },
  set(dv, offset, value) {
    dv.setUint16(offset, value, true);
  },
  size: 2,
};
export const U32LE: Type<number> = {
  get(dv, offset) {
    return dv.getUint32(offset, true);
  },
  set(dv, offset, value) {
    dv.setUint32(offset, value, true);
  },
  size: 4,
};
export const I32LE: Type<number> = {
  get(dv, offset) {
    return dv.getInt32(offset, true);
  },
  set(dv, offset, value) {
    dv.setInt32(offset, value, true);
  },
  size: 4,
};
export const U64LE: Type<bigint> = {
  get(dv, offset) {
    return dv.getBigUint64(offset, true);
  },
  set(dv, offset, value) {
    dv.setBigUint64(offset, value, true);
  },
  size: 8,
};
export const I64LE: Type<bigint> = {
  get(dv, offset) {
    return dv.getBigInt64(offset, true);
  },
  set(dv, offset, value) {
    dv.setBigInt64(offset, value, true);
  },
  size: 8,
};
export const U16BE: Type<number> = {
  get(dv, offset) {
    return dv.getUint16(offset, false);
  },
  set(dv, offset, value) {
    dv.setUint16(offset, value, false);
  },
  size: 2,
};
export const U32BE: Type<number> = {
  get(dv, offset) {
    return dv.getUint32(offset, false);
  },
  set(dv, offset, value) {
    dv.setUint32(offset, value, false);
  },
  size: 4,
};
export const U64BE: Type<bigint> = {
  get(dv, offset) {
    return dv.getBigUint64(offset, false);
  },
  set(dv, offset, value) {
    dv.setBigUint64(offset, value, false);
  },
  size: 8,
};

export interface Allocated<T> {
  value: T;
}

/** A sequential little-endian reader over a byte buffer. */
export class Reader {
  #array: Uint8Array;
  #dv: DataView;
  /** The number of bytes consumed so far. */
  offset = 0;

  constructor(array: Uint8Array) {
    this.#array = array;
    this.#dv = new DataView(array.buffer, array.byteOffset, array.byteLength);
  }

  #take(length: number) {
    if (length < 0 || this.offset + length > this.#array.byteLength) {
      throw new RangeError("read past the end of the buffer");
    }
    const offset = this.offset;
    this.offset += length;
    return offset;
  }

  u8() {
    return this.#dv.getUint8(this.#take(1));
  }
  u16() {
    return this.#dv.getUint16(this.#take(2), true);
  }
  u32() {
    return this.#dv.getUint32(this.#take(4), true);
  }
  i32() {
    return this.#dv.getInt32(this.#take(4), true);
  }
  u64() {
    return this.#dv.getBigUint64(this.#take(8), true);
  }
  i64() {
    return this.#dv.getBigInt64(this.#take(8), true);
  }

  skip(length: number) {
    this.#take(length);
  }

  bytes(length: number) {
    const offset = this.#take(length);
    return this.#array.subarray(offset, offset + length);
  }

  /** Reads a `Type` at the current position and advances past it. */
  struct<T>(type: Type<T>): T {
    return type.get(this.#dv, this.#take(type.size));
  }

  /** Reads a NUL-terminated UTF-8 string, consuming the terminator. */
  cstring() {
    const end = this.#array.indexOf(0, this.offset);
    if (end < 0) throw new RangeError("unterminated string");
    const bytes = this.bytes(end - this.offset);
    this.skip(1);
    try {
      return utf8.decode(bytes);
    } catch {
      throw new RangeError("string is not valid UTF-8");
    }
  }
}

export class Bytes {
  #array: Uint8Array;
  length = 0;

  get capacity() {
    return this.#array.length;
  }
  get array() {
    return this.#array.slice(0, this.length);
  }

  constructor(capacity = 32) {
    this.#array = new Uint8Array(capacity);
  }

  #ensure_capacity(capacity: number) {
    if (this.#array.length < capacity) {
      let length = this.#array.length;
      while (length < capacity) length *= 2;
      const next = new Uint8Array(length);
      next.set(this.#array);
      this.#array = next;
      this.#dv = undefined;
    }
  }

  bump(length: number) {
    const offset = this.length;
    this.#ensure_capacity(this.length + length);
    this.length += length;
    return offset;
  }

  append(bytes: Uint8Array) {
    const offset = this.bump(bytes.length);
    this.#array.set(bytes, offset);
  }

  #dv?: DataView;
  get dv() {
    return this.#dv ??= new DataView(this.#array.buffer);
  }

  alloc<T>(type: Type<T>): Allocated<T> {
    const offset = this.bump(type.size);
    const self = this;
    return {
      get value() {
        return type.get(self.dv, offset);
      },
      set value(value: T) {
        type.set(self.dv, offset, value);
      },
    };
  }
}
