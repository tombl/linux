interface Type<T> {
  get(dv: DataView, offset: number): T;
  set(dv: DataView, offset: number, value: T): void;
  size: number;
}
export type Unwrap<T> = T extends Type<infer U> ? U : never;

export function Struct<T extends object>(
  layout: { [K in keyof T]: Type<T[K]> },
) {
  let size = 0;

  const TheStruct = class {
    #dv: DataView;
    constructor(dv: DataView) {
      this.#dv = dv;
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
  } as { new (dv: DataView): T };

  const type: Type<T> = {
    get(dv, offset) {
      if (offset !== 0) dv = new DataView(dv.buffer, dv.byteOffset + offset);
      return new TheStruct(dv);
    },
    set(dv, offset, value) {
      if (offset !== 0) dv = new DataView(dv.buffer, dv.byteOffset + offset);
      Object.assign(new TheStruct(dv), value);
    },
    size,
  };

  return Object.assign(TheStruct, type);
}

export function FixedArray<T>(
  { get, set, size }: Type<T>,
  length: number,
): Type<T[]> {
  return {
    get(dv, offset) {
      const arr = Array<T>(length);
      for (let i = 0; i < length; i++) {
        arr[i] = get(dv, offset + size * i);
      }
      return arr;
    },
    set(dv, offset, value) {
      for (let i = 0; i < length; i++) {
        set(dv, offset + size * i, value[i]!);
      }
    },
    size: size * length,
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
export const U64LE: Type<bigint> = {
  get(dv, offset) {
    return dv.getBigUint64(offset, true);
  },
  set(dv, offset, value) {
    dv.setBigUint64(offset, value, true);
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
