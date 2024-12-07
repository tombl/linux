import {
  FixedArray,
  Struct,
  U16LE,
  U32LE,
  U64LE,
  U8,
  type Unwrap,
} from "./bytes.ts";
import { type Imports, type Instance, kernel_imports } from "./wasm.ts";

export interface InitMessage {
  fn: number;
  arg: number;
  vmlinux: WebAssembly.Module;
  memory: WebAssembly.Memory;
}
export type WorkerMessage =
  | { type: "spawn_worker"; fn: number; arg: number; name: string }
  | { type: "boot_console_write"; message: ArrayBuffer }
  | { type: "boot_console_close" };

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
// const VirtqDescriptor = Struct({
//   addr: U64LE,
//   len: U32LE,
//   flags: U16LE,
//   next: U16LE,
// });
// type VirtqDescriptor = Unwrap<typeof VirtqDescriptor>;

const VirtqDescriptor = Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE,
});
type VirtqDescriptor = Unwrap<typeof VirtqDescriptor>;

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

class Virtqueue {
  #dv: DataView;

  // ring stuff:
  size: number;
  desc: VirtqDescriptor[];
  used: VirtqUsed;
  avail: VirtqAvail;

  // queue stuff:
  count_used = 0;
  used_wrap_count = true;
  last_avail = 0;

  constructor(
    dv: DataView,
    size: number,
    desc_addr: number,
    used_addr: number,
    avail_addr: number,
  ) {
    this.#dv = dv;
    this.size = size;
    this.desc = FixedArray(VirtqDescriptor, size).get(dv, desc_addr);
    this.used = VirtqUsed(size).get(dv, used_addr);
    this.avail = VirtqAvail(size).get(dv, avail_addr);
  }

  take() {
    if (this.count_used >= this.size) {
      throw new Error("Virtqueue size exceeded");
    }

    const last_seen = this.desc[this.last_avail]!;
    console.log("flags:", last_seen.flags.toString(16));
    let id;
    let count = 0;
    const descs = [];
    if (last_seen.flags & VIRTQ_DESC_F_INDIRECT) {
      ({ id } = last_seen);
      const max = last_seen.len / VirtqDescriptor.size;
      for (let i = 0; i < max; i++) descs.push(this.desc[i]!);
      count = 1;
    } else {
      for (
        let i = 0;
        this.desc[i] !== undefined && this.desc[i]!.flags & VIRTQ_DESC_F_NEXT;
        i = (i + 1) % this.size
      ) {
        if (++count > this.size) throw new Error("looped");
        descs.push(this.desc[i]!);
      }
      if (descs.length) ({ id } = descs.at(-1)!);
    }

    const readable = [];
    const writable = [];
    for (const desc of descs) {
      if (desc.flags & VIRTQ_DESC_F_WRITE) writable.push(desc);
      else readable.push(desc);
    }

    this.count_used += count;
    this.last_avail += count;
    if (this.last_avail > this.size) {
      this.last_avail -= this.size;
      this.used_wrap_count = !this.used_wrap_count;
    }

    return { id, count, readable, writable };
  }
}

abstract class VirtioDevice {
  readonly nvqs: number;
  constructor(nvqs: number) {
    this.nvqs = nvqs;
  }

  config = new Uint8Array(0);
  features = VIRTIO_F_VERSION_1 | VIRTIO_F_RING_PACKED |
    VIRTIO_F_EVENT_IDX |
    VIRTIO_F_INDIRECT_DESC;

  trigger_interrupt = (kind: "config" | "vring"): void => {
    // this function is overwritten on device setup
    void kind;
    throw new Error("unreachable");
  };

  abstract enable(vq: number, queue: Virtqueue): void;
  abstract disable(vq: number): void;
  abstract notify(vq: number): void;
}

class EntropyDevice extends VirtioDevice {
  constructor() {
    super(1);
  }

  vqs: Virtqueue[] = [];
  enable(vq: number, queue: Virtqueue) {
    this.vqs[vq] = queue;
    console.log("enable", vq, queue);
  }
  disable(vq: number) {
    // const queue = this.vqs[vq];
    console.log("disable", vq);
  }
  notify(vq: number) {
    const queue = this.vqs[vq]!;
    console.log("notify", vq, queue);

    const elem = queue.take();
    console.log(elem);
    // TODO fill with bytes, enqueue buffer

    this.trigger_interrupt("vring");
  }
}

const devices: VirtioDevice[] = [new EntropyDevice()];

self.onmessage = (event: MessageEvent<InitMessage>) => {
  const { fn, arg, vmlinux, memory } = event.data;
  const dv = new DataView(memory.buffer);

  const imports = {
    env: { memory },
    boot: {
      get_devicetree(_buf, _size) {
        throw new Error(
          "get_devicetree on worker thread",
        );
      },
    },
    kernel: kernel_imports({
      is_worker: true,
      memory,
      spawn_worker(fn, arg, name) {
        self.postMessage(
          {
            type: "spawn_worker",
            fn,
            arg,
            name,
          } satisfies WorkerMessage,
        );
      },
      boot_console_write(message) {
        self.postMessage(
          {
            type: "boot_console_write",
            message,
          } satisfies WorkerMessage,
        );
      },
      boot_console_close() {
        self.postMessage(
          {
            type: "boot_console_close",
          } satisfies WorkerMessage,
        );
      },
    }),
    virtio: {
      get_config(dev, offset, buf_addr, buf_len) {
        const device = devices[dev];
        if (!device) return -EINVAL;

        const buf = new Uint8Array(
          memory.buffer,
          buf_addr,
          buf_len,
        );
        buf.set(device.config.subarray(
          offset,
          offset + buf_len,
        ));
      },
      set_config(dev, offset, buf_addr, buf_len) {
        const device = devices[dev];
        if (!device) return -EINVAL;

        const buf = new Uint8Array(
          memory.buffer,
          buf_addr,
          buf_len,
        );
        device.config.set(buf, offset);
      },

      get_features(dev, features_addr) {
        const device = devices[dev];
        if (!device) return -EINVAL;
        U64LE.set(dv, features_addr, device.features);
        return 0;
      },
      set_features(dev, features) {
        const device = devices[dev];
        if (!device) return -EINVAL;
        device.features = features;
        return 0;
      },

      enable_vring(dev, vq, size, desc_addr, used_addr, avail_addr) {
        const device = devices[dev];
        if (!device) return -EINVAL;
        if (vq >= device.nvqs) return -EINVAL;

        device.enable(
          vq,
          new Virtqueue(dv, size, desc_addr, used_addr, avail_addr),
        );

        return 0;
      },
      disable_vring(dev, vq) {
        const device = devices[dev];
        if (!device) return -EINVAL;
        if (vq >= device.nvqs) return -EINVAL;

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

        device.trigger_interrupt = (
          kind,
        ) => {
          U8.set(
            dv,
            is_config_addr,
            kind === "config" ? 1 : 0,
          );
          U8.set(
            dv,
            is_vring_addr,
            kind === "vring" ? 1 : 0,
          );
          instance.exports.trigger_irq_for_cpu(0, irq); // TODO: balance?
        };

        return 0;
      },

      notify(dev, vq) {
        const device = devices[dev];
        if (!device) return -EINVAL;
        if (vq >= device.nvqs) return -EINVAL;

        device.notify(vq);

        return 0;
      },
    },
  } satisfies Imports;

  const instance = (new WebAssembly.Instance(vmlinux, imports)) as Instance;
  instance.exports.worker_entry(fn, arg);
};
