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
import squashfsUrl from "./root.squashfs";

const squashfs = new Uint8Array(
  await (await fetch(new URL(squashfsUrl, import.meta.url))).arrayBuffer(),
);

const VIRTIO_F_VERSION_1 = 1n << 32n;
const VIRTIO_F_RING_PACKED = 1n << 34n;
const VIRTIO_F_INDIRECT_DESC = 1n << 28n;

const VIRTQ_DESC_F_NEXT = 1 << 0;
const VIRTQ_DESC_F_WRITE = 1 << 1;
const VIRTQ_DESC_F_INDIRECT = 1 << 2;
const VIRTQ_DESC_F_AVAIL = 1 << 7;
const VIRTQ_DESC_F_USED = 1 << 15;
function formatDescFlags(flags: number) {
  const f = [];
  if (flags & VIRTQ_DESC_F_NEXT) f.push("NEXT");
  if (flags & VIRTQ_DESC_F_WRITE) f.push("WRITE");
  if (flags & VIRTQ_DESC_F_INDIRECT) f.push("INDIRECT");
  if (flags & VIRTQ_DESC_F_AVAIL) f.push("AVAIL");
  if (flags & VIRTQ_DESC_F_USED) f.push("USED");
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
        formatDescFlags(desc.flags),
        desc.id,
        desc.len,
      );
      yield {
        array: new Uint8Array(this.#mem.buffer, Number(desc.addr), desc.len),
        writable: (desc.flags & VIRTQ_DESC_F_WRITE) !== 0,
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

export abstract class VirtioDevice<Config = {}> {
  abstract readonly ID: number;
  abstract readonly CONFIG_TYPE: Type<Config>;

  config: Config | null = null;

  features = VIRTIO_F_VERSION_1 | VIRTIO_F_RING_PACKED | VIRTIO_F_INDIRECT_DESC;

  trigger_interrupt = (kind: "config" | "vring"): void => {
    // this function is overwritten on device setup
    void kind;
    throw new Error("trigger_interrupt called before setup");
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

  setup_complete() {}
}

const EmptyStruct = Struct({});

class BlockDeviceGeometry extends Struct({
  cylinders: U16LE,
  heads: U8,
  sectors: U8,
}) {}

class BlockDeviceTopology extends Struct({
  physical_block_exp: U8,
  alignment_offset: U8,
  min_io_size: U16LE,
  opt_io_size: U32LE,
}) {}

class BlockDeviceConfig extends Struct({
  capacity: U64LE,
  size_max: U32LE,
  seg_max: U32LE,
  geometry: BlockDeviceGeometry,
  blk_size: U32LE,
  topology: BlockDeviceTopology,
  writeback: U8,
  unused: U8,
  num_queues: U16LE,
  max_discard_sectors: U32LE,
  max_discard_seg: U32LE,
  discard_sector_alignment: U32LE,
  max_write_zeroes_sectors: U32LE,
  max_write_zeroes_seg: U32LE,
  write_zeroes_may_unmap: U8,
}) {}

export class BlockDevice extends VirtioDevice<BlockDeviceConfig> {
  ID = 2;
  CONFIG_TYPE = BlockDeviceConfig;

  override setup_complete() {
    assert(this.config);
    this.config.capacity = BigInt(squashfs.length);
    this.trigger_interrupt("config");
  }

  override notify(vq: number) {
    assert(vq === 0);
    console.log("block notify", vq);
  }
}

export class EntropyDevice extends VirtioDevice {
  ID = 4;
  CONFIG_TYPE = EmptyStruct;

  override notify(vq: number) {
    assert(vq === 0);

    const queue = this.vqs[vq];
    assert(queue);
    console.log("entropy notify", vq, queue.size);

    const chain = queue.pop();
    assert(chain);
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
      device.features = features;
      return 0;
    },

    enable_vring(dev, vq, size, desc_addr) {
      const device = devices[dev];
      assert(device);

      device.enable(
        vq,
        new Virtqueue(dv, size, desc_addr),
      );

      return 0;
    },
    disable_vring(dev, vq) {
      const device = devices[dev];
      assert(device);

      device.disable(vq);

      return 0;
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

      assert(config_len >= device.CONFIG_TYPE.size, "config space too small");
      device.config = device.CONFIG_TYPE.get(dv, config_addr);

      device.trigger_interrupt = (kind) => {
        U8.set(dv, is_config_addr, kind === "config" ? 1 : 0);
        U8.set(dv, is_vring_addr, kind === "vring" ? 1 : 0);
        trigger_irq_for_cpu(0, irq); // TODO: balance?
      };

      device.setup_complete();

      return 0;
    },

    notify(dev, vq) {
      const device = devices[dev];
      assert(device);

      device.notify(vq);

      return 0;
    },
  };
}
