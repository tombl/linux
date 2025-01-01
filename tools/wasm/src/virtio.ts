import {
  FixedArray,
  Struct,
  type Type,
  U16LE,
  U32LE,
  U64LE,
  U8,
} from "./bytes.ts";
import { assert } from "./util.ts";
import type { Imports } from "./wasm.ts";

const TransportFeatures = {
  VERSION_1: 1n << 32n,
  RING_PACKED: 1n << 34n,
  INDIRECT_DESC: 1n << 28n,
} as const;

const DescriptorFlags = {
  NEXT: 1 << 0,
  WRITE: 1 << 1,
  INDIRECT: 1 << 2,
  AVAIL: 1 << 7,
  USED: 1 << 15,
} as const;

function formatDescFlags(flags: number) {
  const f = [];
  if (flags & DescriptorFlags.NEXT) f.push("NEXT");
  if (flags & DescriptorFlags.WRITE) f.push("WRITE");
  if (flags & DescriptorFlags.INDIRECT) f.push("INDIRECT");
  if (flags & DescriptorFlags.AVAIL) f.push("AVAIL");
  if (flags & DescriptorFlags.USED) f.push("USED");
  return f.join(" ");
}

class VirtqDescriptor extends Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE,
}) {}

class Chain {
  #mem: DataView;
  #queue: Virtqueue;
  id: number;
  skip: number;
  desc: VirtqDescriptor[];

  constructor(
    mem: DataView,
    queue: Virtqueue,
    id: number,
    skip: number,
    desc: VirtqDescriptor[],
  ) {
    this.#mem = mem;
    this.#queue = queue;
    this.id = id;
    this.skip = skip;
    this.desc = desc;
  }

  release(written: number) {
    const queue = this.#queue;
    const desc = queue.desc[queue.used_idx];
    assert(desc);
    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== queue.wrap) throw new Error("ring full");

    let flags = 0;
    if (queue.wrap) flags |= DescriptorFlags.AVAIL | DescriptorFlags.USED;
    if (written > 0) flags |= DescriptorFlags.WRITE;

    desc.id = this.id;
    desc.len = written;
    desc.flags = flags;

    queue.used_idx += this.skip;
    if (queue.used_idx >= queue.size) {
      queue.used_idx -= queue.size;
      queue.wrap = !queue.wrap;
    }
  }

  *[Symbol.iterator]() {
    for (const desc of this.desc) {
      yield {
        array: new Uint8Array(this.#mem.buffer, Number(desc.addr), desc.len),
        writable: (desc.flags & DescriptorFlags.WRITE) !== 0,
      };
    }
  }
}

class Virtqueue {
  #mem: DataView;

  size: number;
  desc: VirtqDescriptor[];
  wrap = true;
  used_idx = 0;
  avail_idx = 0;

  constructor(
    mem: DataView,
    size: number,
    desc_addr: number,
  ) {
    assert(size !== 0);
    assert(mem.byteOffset === 0);
    this.#mem = mem;
    this.size = size;
    this.desc = FixedArray(VirtqDescriptor, size).get(mem, desc_addr);
  }

  #pop() {
    let i = this.#advance();
    if (i === null) return null;
    const head = i;

    let desc = this.desc[i];
    assert(desc);

    const chain = new Chain(
      this.#mem,
      this,
      desc.id,
      1,
      this.desc.slice(head, i + 1),
    );

    if (desc.flags & DescriptorFlags.NEXT) {
      do {
        i = this.#advance();
        if (i === null) throw new Error("no next descriptor is available");
        desc = this.desc[i];
        assert(desc);
      } while (desc.flags & DescriptorFlags.NEXT);
      chain.skip = i - head + 1;
      chain.desc = this.desc.slice(head, i + 1);
    } else if (desc.flags & DescriptorFlags.INDIRECT) {
      if (desc.len % VirtqDescriptor.size !== 0) {
        throw new Error("malformed indirect buffer");
      }
      chain.desc = FixedArray(VirtqDescriptor, desc.len / VirtqDescriptor.size)
        .get(this.#mem, Number(desc.addr));
    }

    return chain;
  }

  *[Symbol.iterator]() {
    let chain;
    while (chain = this.#pop()) yield chain;
  }

  #advance() {
    const desc = this.desc[this.avail_idx];
    assert(desc);

    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== this.wrap) return null;

    const index = this.avail_idx;
    this.avail_idx = (this.avail_idx + 1) % this.size;
    return index;
  }
}

export abstract class VirtioDevice<Config extends object = object> {
  abstract readonly ID: number;
  abstract config_bytes: Uint8Array;
  abstract config: Config;

  features = TransportFeatures.VERSION_1 | TransportFeatures.RING_PACKED |
    TransportFeatures.INDIRECT_DESC;

  trigger_interrupt = (kind: "config" | "vring"): void => {
    // this function is overwritten on device setup
    void kind;
    throw new Error("trigger_interrupt called before setup");
  };

  vqs: Virtqueue[] = [];
  enable(vq: number, queue: Virtqueue) {
    this.vqs[vq] = queue;
    console.log("enable", this.constructor.name, vq, queue.size);
  }
  disable(vq: number) {
    const queue = this.vqs[vq];
    assert(queue);
    console.log("disable", this.constructor.name, vq);
  }

  abstract notify(vq: number): void;

  setup_complete() {}
}

class EmptyStruct extends Struct({}) {}

const BlockDeviceFeatures = {
  RO: 1n << 5n,
  FLUSH: 1n << 9n,
} as const;

class BlockDeviceConfig extends Struct({
  capacity: U64LE,
}) {}

class BlockDeviceRequest extends Struct({
  type: U32LE,
  reserved: U32LE,
  sector: U64LE,
}) {}

const BlockDeviceRequestType = {
  IN: 0,
  OUT: 1,
  FLUSH: 4,
  GET_ID: 8,
} as const;

const BlockDeviceStatus = {
  OK: 0,
  IOERR: 1,
  UNSUPP: 2,
} as const;

export class BlockDevice extends VirtioDevice<BlockDeviceConfig> {
  ID = 2;
  config_bytes = new Uint8Array(BlockDeviceConfig.size);
  config = new BlockDeviceConfig(this.config_bytes);

  #storage: Uint8Array;

  constructor(storage: Uint8Array) {
    super();
    this.#storage = storage;
    this.features |= BlockDeviceFeatures.FLUSH;
    this.config.capacity = BigInt(this.#storage.byteLength / 512);
  }

  override notify(vq: number) {
    assert(vq === 0);

    const queue = this.vqs[vq];
    assert(queue);

    for (const chain of queue) {
      const [header, data, status, trailing] = chain;
      assert(header && !header.writable, "header must be readonly");
      assert(
        header.array.byteLength === BlockDeviceRequest.size,
        `header size is ${header.array.byteLength}`,
      );
      assert(data, "data must exist");
      assert(status && status.writable, "status must be writable");
      assert(
        status.array.byteLength === 1,
        `status size is ${status.array.byteLength}`,
      );
      assert(!trailing, "too many descriptors");

      const request = new BlockDeviceRequest(header.array);

      let n = 0;
      switch (request.type) {
        case BlockDeviceRequestType.IN: {
          assert(data.writable, "data must be writable when IN");
          const start = Number(request.sector) * 512;
          let end = start + data.array.byteLength;
          if (end >= this.#storage.length) end = this.#storage.length - 1;
          data.array.set(this.#storage.subarray(start, end));
          n = end - start;
          status.array[0] = BlockDeviceStatus.OK;
          break;
        }
        default:
          console.error("unknown request type", request.type);
          status.array[0] = BlockDeviceStatus.UNSUPP;
      }

      chain.release(n);
    }
    this.trigger_interrupt("vring");
  }
}

export class ConsoleDevice extends VirtioDevice<EmptyStruct> {
  ID = 3;
  config_bytes = new Uint8Array(0);
  config = new EmptyStruct(this.config_bytes);

  #input: ReadableStream<Uint8Array>;
  #output: WritableStreamDefaultWriter<Uint8Array>;
  constructor(
    input: ReadableStream<Uint8Array>,
    output: WritableStream<Uint8Array>,
  ) {
    super();
    this.#input = input;
    this.#output = output.getWriter();
  }

  #writing: Promise<void> | null = null;
  async #writer(queue: Virtqueue) {
    const queueIter = queue[Symbol.iterator]();
    for await (let chunk of this.#input) {
      while (chunk.length > 0) {
        const chain = queueIter.next().value;
        if (!chain) {
          console.warn("no more descriptors, dropping console input");
          break;
        }

        const [desc, trailing] = chain;
        assert(desc && desc.writable, "receiver must be writable");
        assert(!trailing, "too many descriptors");

        const n = Math.min(chunk.length, desc.array.byteLength);
        desc.array.set(chunk.subarray(0, n));
        chunk = chunk.subarray(n);
        chain.release(n);
      }
    }
  }

  override async notify(vq: number) {
    const queue = this.vqs[vq];
    assert(queue);

    switch (vq) {
      case 0:
        this.#writing ??= this.#writer(queue);
        break;
      case 1:
        for (const chain of queue) {
          let n = 0;
          for (const { array, writable } of chain) {
            assert(!writable, "transmitter must be readable");
            await this.#output.write(array);
            n += array.byteLength;
          }
          chain.release(n);
        }
        break;
      default:
        console.error("ConsoleDevice: unknown vq", vq);
    }
  }
}

export class EntropyDevice extends VirtioDevice<EmptyStruct> {
  ID = 4;
  config_bytes = new Uint8Array(0);
  config = new EmptyStruct(this.config_bytes);

  override notify(vq: number) {
    assert(vq === 0);

    const queue = this.vqs[vq];
    assert(queue);

    for (const chain of queue) {
      let n = 0;
      for (const { array, writable } of chain) {
        assert(writable);

        // can't use crypto.getRandomValues on a SharedArrayBuffer
        const arr = new Uint8Array(array.length);
        crypto.getRandomValues(arr);
        array.set(arr);

        n += array.byteLength;
      }
      chain.release(n);
    }

    this.trigger_interrupt("vring");
  }
}

export function virtio_imports(
  {
    memory,
    devices,
    trigger_irq_for_cpu,
  }: {
    memory: WebAssembly.Memory;
    devices: VirtioDevice[];
    trigger_irq_for_cpu: (cpu: number, irq: number) => void;
  },
): Imports["virtio"] {
  const dv = new DataView(memory.buffer);

  return {
    set_features(dev, features) {
      const device = devices[dev];
      assert(device);
      assert(
        device.features === features,
        "the kernel should accept every feature we offer, and no more",
      );
    },

    enable_vring(dev, vq, size, desc_addr) {
      const device = devices[dev];
      assert(device);
      device.enable(
        vq,
        new Virtqueue(dv, size, desc_addr),
      );
    },
    disable_vring(dev, vq) {
      const device = devices[dev];
      assert(device);
      device.disable(vq);
    },

    setup(
      dev,
      irq,
      is_config_addr,
      is_vring_addr,
      config_addr,
      config_len,
    ) {
      const device = devices[dev];
      assert(device);

      const config_type = device.config.constructor as unknown as Type<object>;
      assert(config_len >= config_type.size, "config space too small");

      const new_config_bytes = new Uint8Array(
        dv.buffer,
        config_addr,
        config_len,
      );
      new_config_bytes.set(device.config_bytes);
      device.config_bytes = new_config_bytes;
      device.config = config_type.get(dv, config_addr);

      device.trigger_interrupt = (kind) => {
        U8.set(dv, is_config_addr, kind === "config" ? 1 : 0);
        U8.set(dv, is_vring_addr, kind === "vring" ? 1 : 0);
        trigger_irq_for_cpu(0, irq); // TODO: balance?
      };

      device.setup_complete();
    },

    notify(dev, vq) {
      const device = devices[dev];
      assert(device);
      device.notify(vq);
    },
  };
}
