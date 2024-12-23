import {
  FixedArray,
  Struct,
  U16LE,
  U32LE,
  U64LE,
  U8,
  type Unwrap,
} from "./bytes.ts";
import { assert } from "./util.ts";
import type { Imports } from "./wasm.ts";

const EINVAL = 22;

const VIRTIO_F_VERSION_1 = 1n << 32n;
const VIRTIO_F_RING_PACKED = 1n << 34n;
const VIRTIO_F_EVENT_IDX = 1n << 29n;
const VIRTIO_F_INDIRECT_DESC = 1n << 28n;

const VIRTQ_DESC_F_NEXT = 1 << 0;
const VIRTQ_DESC_F_WRITE = 1 << 1;
const VIRTQ_DESC_F_INDIRECT = 1 << 2;
const VIRTQ_DESC_F_AVAIL = 1 << 7;
const VIRTQ_DESC_F_USED = 1 << 15;

class VirtqDescriptor extends Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE,
}) {}

const VIRTQ_AVAIL_F_NO_INTERRUPT = 1;
const VirtqAvail = (size: number) =>
  Struct({
    flags: U16LE,
    idx: U16LE,
    ring: FixedArray(U16LE, size),
    used_event: U16LE, // only if VIRTIO_F_EVENT_IDX
  });
type VirtqAvail = Unwrap<ReturnType<typeof VirtqAvail>>;

const VirtqUsedElem = Struct({
  id: U32LE,
  len: U32LE,
});
const VIRTQ_USED_F_NO_NOTIFY = 1;
const VirtqUsed = (size: number) =>
  Struct({
    flags: U16LE,
    idx: U16LE,
    ring: FixedArray(VirtqUsedElem, size),
    avail_event: U16LE, // only if VIRTIO_F_EVENT_IDX
  });
type VirtqUsed = Unwrap<ReturnType<typeof VirtqUsed>>;

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
    const avail = (desc.flags & VIRTQ_DESC_F_AVAIL) !== 0;
    const used = (desc.flags & VIRTQ_DESC_F_USED) !== 0;
    if (avail === used || avail !== queue.wrap) throw new Error("ring full");

    let flags = 0;
    if (queue.wrap) flags |= VIRTQ_DESC_F_AVAIL | VIRTQ_DESC_F_USED;
    if (written > 0) flags |= VIRTQ_DESC_F_WRITE;

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
      console.log(
        "VirtqDescriptor:",
        desc.addr.toString(16).padStart(8, "0"),
        desc.flags.toString(16),
        desc.id,
        desc.len,
      );
      yield new Uint8Array(this.#mem.buffer, Number(desc.addr), desc.len);
    }
  }
}

class Virtqueue {
  #mem: DataView;

  size: number;
  desc: VirtqDescriptor[];
  used: VirtqUsed;
  avail: VirtqAvail;
  wrap = true;
  used_idx = 0;
  avail_idx = 0;

  constructor(
    mem: DataView,
    size: number,
    desc_addr: number,
    used_addr: number,
    avail_addr: number,
  ) {
    assert(size !== 0);
    assert(mem.byteOffset === 0);
    this.#mem = mem;
    this.size = size;
    this.desc = FixedArray(VirtqDescriptor, size).get(mem, desc_addr);
    this.used = VirtqUsed(size).get(mem, used_addr);
    this.avail = VirtqAvail(size).get(mem, avail_addr);
  }

  pop() {
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

    if (desc.flags & VIRTQ_DESC_F_NEXT) {
      do {
        i = this.#advance();
        if (i === null) throw new Error("no next descriptor is available");
        desc = this.desc[i];
        assert(desc);
      } while (desc.flags & VIRTQ_DESC_F_NEXT);
      chain.skip = i - head + 1;
      chain.desc = this.desc.slice(head, i + 1);
    } else if (desc.flags & VIRTQ_DESC_F_INDIRECT) {
      if (desc.len % VirtqDescriptor.size !== 0) {
        throw new Error("malformed indirect buffer");
      }
      chain.desc = FixedArray(VirtqDescriptor, desc.len / VirtqDescriptor.size)
        .get(this.#mem, Number(desc.addr));
    }

    return chain;
  }

  #advance() {
    const desc = this.desc[this.avail_idx];
    assert(desc);

    const avail = (desc.flags & VIRTQ_DESC_F_AVAIL) !== 0;
    const used = (desc.flags & VIRTQ_DESC_F_USED) !== 0;
    if (avail === used || avail !== this.wrap) return null;

    const index = this.avail_idx;
    this.avail_idx = (this.avail_idx + 1) % this.size;
    return index;
  }
}

export abstract class VirtioDevice {
  abstract readonly ID: number;
  abstract readonly NVQS: number;

  config = new Uint8Array(0);
  features = VIRTIO_F_VERSION_1 | VIRTIO_F_RING_PACKED |
    VIRTIO_F_EVENT_IDX | VIRTIO_F_INDIRECT_DESC;

  trigger_interrupt = (kind: "config" | "vring"): void => {
    // this function is overwritten on device setup
    void kind;
    throw new Error("trigger_interrupt called before configure_interrupt");
  };

  vqs: Virtqueue[] = [];
  enable(vq: number, queue: Virtqueue) {
    this.vqs[vq] = queue;
    console.log("enable", vq, queue.size);
  }
  disable(vq: number) {
    const queue = this.vqs[vq];
    assert(queue);
    console.log("disable", vq);
  }

  abstract notify(vq: number): void;
}

export class EntropyDevice extends VirtioDevice {
  ID = 4;
  NVQS = 1;

  notify(vq: number) {
    const queue = this.vqs[vq];
    assert(queue);
    console.log("notify", vq, queue.size);

    const chain = queue.pop();
    assert(chain);
    let n = 0;
    for (const buf of chain) {
      crypto.getRandomValues(buf);
      n += buf.byteLength;
    }
    chain.release(n);

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
      if (!device) return -EINVAL;
      device.features = features;
      return 0;
    },

    enable_vring(dev, vq, size, desc_addr, used_addr, avail_addr) {
      const device = devices[dev];
      if (!device) return -EINVAL;
      if (vq >= device.NVQS) return -EINVAL;

      device.enable(
        vq,
        new Virtqueue(dv, size, desc_addr, used_addr, avail_addr),
      );

      return 0;
    },
    disable_vring(dev, vq) {
      const device = devices[dev];
      if (!device) return -EINVAL;
      if (vq >= device.NVQS) return -EINVAL;

      device.disable(vq);

      return 0;
    },

    configure_interrupt(
      dev,
      irq,
      is_config_addr,
      is_vring_addr,
    ) {
      const device = devices[dev];
      if (!device) return -EINVAL;

      device.trigger_interrupt = (kind) => {
        U8.set(dv, is_config_addr, kind === "config" ? 1 : 0);
        U8.set(dv, is_vring_addr, kind === "vring" ? 1 : 0);
        trigger_irq_for_cpu(0, irq); // TODO: balance?
      };

      return 0;
    },

    notify(dev, vq) {
      const device = devices[dev];
      if (!device) return -EINVAL;
      if (vq >= device.NVQS) return -EINVAL;

      device.notify(vq);

      return 0;
    },
  };
}
