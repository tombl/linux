import { FixedArray, Struct, U16LE, U32LE, U64LE, U8 } from "../bytes.ts";
import { assert } from "../util.ts";
import type { Imports } from "../wasm.ts";

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

class VirtqDescriptor extends Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE,
}) {}

export interface VirtqueueBuffer {
  readonly array: Uint8Array;
  readonly writable: boolean;
}

export interface VirtqueueChain extends Iterable<VirtqueueBuffer> {
  release(written: number): void;
}

export interface Virtqueue extends Iterable<VirtqueueChain> {}

class Chain implements VirtqueueChain {
  #mem: DataView;
  #desc: VirtqDescriptor[];
  #release: (written: number) => void;

  constructor(
    mem: DataView,
    desc: VirtqDescriptor[],
    release: (written: number) => void,
  ) {
    this.#mem = mem;
    this.#desc = desc;
    this.#release = release;
  }

  release(written: number) {
    this.#release(written);
  }

  *[Symbol.iterator]() {
    for (const desc of this.#desc) {
      yield {
        array: new Uint8Array(this.#mem.buffer, Number(desc.addr), desc.len),
        writable: (desc.flags & DescriptorFlags.WRITE) !== 0,
      };
    }
  }
}

class PackedVirtqueue implements Virtqueue {
  #mem: DataView;
  #size: number;
  #desc: VirtqDescriptor[];
  #avail_wrap = true;
  #used_wrap = true;
  #used_idx = 0;
  #avail_idx = 0;

  constructor(mem: DataView, size: number, desc_addr: number) {
    assert(size !== 0);
    assert(mem.byteOffset === 0);
    this.#mem = mem;
    this.#size = size;
    this.#desc = FixedArray(VirtqDescriptor, size).get(mem, desc_addr);
  }

  #pop() {
    let i = this.#advance();
    if (i === null) return null;

    let desc = this.#desc[i];
    assert(desc);
    const id = desc.id;
    let skip = 1;
    let chain_desc = [desc];

    if (desc.flags & DescriptorFlags.NEXT) {
      do {
        i = this.#advance();
        if (i === null) throw new Error("no next descriptor is available");
        desc = this.#desc[i];
        assert(desc);
        chain_desc.push(desc);
        skip += 1;
      } while (desc.flags & DescriptorFlags.NEXT);
    } else if (desc.flags & DescriptorFlags.INDIRECT) {
      if (desc.len % VirtqDescriptor.size !== 0) {
        throw new Error("malformed indirect buffer");
      }
      chain_desc = FixedArray(
        VirtqDescriptor,
        desc.len / VirtqDescriptor.size,
      ).get(this.#mem, Number(desc.addr));
    }

    return new Chain(
      this.#mem,
      chain_desc,
      (written) => this.#release(id, skip, written),
    );
  }

  *[Symbol.iterator]() {
    let chain;
    while ((chain = this.#pop())) yield chain;
  }

  #advance() {
    const desc = this.#desc[this.#avail_idx];
    assert(desc);

    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== this.#avail_wrap) return null;

    const index = this.#avail_idx;
    this.#avail_idx += 1;
    if (this.#avail_idx >= this.#size) {
      this.#avail_idx = 0;
      this.#avail_wrap = !this.#avail_wrap;
    }
    return index;
  }

  #release(id: number, skip: number, written: number) {
    const desc = this.#desc[this.#used_idx];
    assert(desc);
    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== this.#used_wrap) {
      throw new Error("ring full");
    }

    let flags = 0;
    if (this.#used_wrap) flags |= DescriptorFlags.AVAIL | DescriptorFlags.USED;
    if (written > 0) flags |= DescriptorFlags.WRITE;

    desc.id = id;
    desc.len = written;
    desc.flags = flags;

    this.#used_idx += skip;
    if (this.#used_idx >= this.#size) {
      this.#used_idx -= this.#size;
      this.#used_wrap = !this.#used_wrap;
    }
  }
}

type InterruptKind = "config" | "vring";
type Interrupt = (kind: InterruptKind) => void;

export interface VirtioDeviceOptions {
  deviceId: number;
  /** Device-specific feature bits; transport features are added automatically. */
  features?: bigint;
  config?: Uint8Array;
}

export type VirtqueueHandler = (
  queue: Virtqueue,
  controller: VirtioController,
) => void | PromiseLike<void>;

export interface VirtioDriver {
  readonly queues: readonly VirtqueueHandler[];
  close?(controller: VirtioController): void;
}

interface TransportDevice {
  readonly device_id: number;
  readonly features: bigint;
  readonly config: Uint8Array;
  attach(config: Uint8Array, interrupt: Interrupt): void;
  notify(vq: number, queue: Virtqueue): void | PromiseLike<void>;
  close(): void;
}

const transport_device = Symbol("virtio transport device");

export interface VirtioDevice {
  readonly [transport_device]: TransportDevice;
}

export class VirtioController {
  readonly device: VirtioDevice;
  readonly raiseInterrupt: (kind: InterruptKind) => void;
  readonly updateConfig: (config: Uint8Array) => void;
  readonly close: () => void;
  readonly expose: <API extends object>(api: API) => VirtioDevice & API;

  constructor(options: VirtioDeviceOptions, driver: VirtioDriver) {
    const config = options.config?.slice() ?? new Uint8Array();
    let guest_config: Uint8Array | undefined;
    let interrupt: Interrupt | undefined;
    const pending_interrupts = new Set<InterruptKind>();
    let closed = false;
    let closing = false;
    let exposed = false;

    const close = () => {
      if (closed || closing) return;
      closing = true;
      try {
        driver.close?.(this);
      } finally {
        closed = true;
        closing = false;
      }
    };

    const endpoint: TransportDevice = {
      device_id: options.deviceId,
      features: TransportFeatures.VERSION_1 |
        TransportFeatures.RING_PACKED |
        TransportFeatures.INDIRECT_DESC |
        (options.features ?? 0n),
      config,

      attach(next_config, next_interrupt) {
        assert(!closed && !closing, "cannot attach a closed virtio device");
        assert(!guest_config, "virtio device is already attached");
        next_config.set(config);
        guest_config = next_config;
        interrupt = next_interrupt;
        for (const kind of pending_interrupts) interrupt(kind);
        pending_interrupts.clear();
      },

      notify(vq, queue) {
        if (closed) return;
        const handler = driver.queues[vq];
        assert(handler, `virtio device has no queue ${vq}`);
        return handler(queue, this_controller);
      },

      close,
    };
    const this_controller = this;

    const device = {} as VirtioDevice;
    Object.defineProperty(device, transport_device, { value: endpoint });
    this.device = device;

    this.raiseInterrupt = (kind) => {
      if (closed) return;
      if (interrupt) interrupt(kind);
      else pending_interrupts.add(kind);
    };

    this.updateConfig = (next_config) => {
      assert(
        next_config.byteLength === config.byteLength,
        "virtio config size cannot change",
      );
      config.set(next_config);
      guest_config?.set(config);
      this.raiseInterrupt("config");
    };

    this.close = close;
    this.expose = <API extends object>(api: API) => {
      assert(!exposed, "virtio device API is already exposed");
      exposed = true;
      Object.defineProperties(device, Object.getOwnPropertyDescriptors(api));
      return device as VirtioDevice & API;
    };
  }
}

interface VirtqueueState {
  queue: Virtqueue | undefined;
  /** A kernel notification arrived while its previous handler was in flight. */
  pending: boolean;
  notifying: boolean;
}

interface TransportState {
  device: TransportDevice;
  queues: VirtqueueState[];
}

export function virtio_device_description(device: VirtioDevice) {
  const transport = device[transport_device];
  return {
    device_id: transport.device_id,
    features: transport.features,
    config: transport.config,
  };
}

export function close_virtio_device(device: VirtioDevice) {
  device[transport_device].close();
}

export function virtio_imports({
  memory,
  devices,
  trigger_irq_for_cpu,
  on_error,
}: {
  memory: WebAssembly.Memory;
  devices: readonly VirtioDevice[];
  trigger_irq_for_cpu: (cpu: number, irq: number) => void;
  on_error: (error: unknown) => void;
}): Imports["virtio"] {
  const dv = new DataView(memory.buffer);
  const states: TransportState[] = devices.map((device) => ({
    device: device[transport_device],
    queues: [],
  }));

  function queue_state(device: TransportState, vq: number) {
    return (device.queues[vq] ??= {
      queue: undefined,
      pending: false,
      notifying: false,
    });
  }

  const drain_notifications = async (device: TransportState, vq: number) => {
    const state = queue_state(device, vq);
    if (state.notifying || !state.queue) return;

    state.notifying = true;
    try {
      do {
        state.pending = false;
        await device.device.notify(vq, state.queue);
      } while (state.pending && state.queue);
    } catch (error) {
      on_error(error);
    } finally {
      state.notifying = false;
    }
  };

  return {
    set_features(dev, features) {
      const device = states[dev]?.device;
      assert(device);
      assert(
        device.features === features,
        "the kernel should accept every feature we offer, and no more",
      );
    },

    enable_vring(dev, vq, size, desc_addr) {
      const device = states[dev];
      assert(device);
      const state = queue_state(device, vq);
      state.queue = new PackedVirtqueue(dv, size, desc_addr);
      if (state.pending) void drain_notifications(device, vq);
    },
    disable_vring(dev, vq) {
      const device = states[dev];
      assert(device);
      const state = device.queues[vq];
      assert(state?.queue);
      state.queue = undefined;
    },

    setup(dev, irq, is_config_addr, is_vring_addr, config_addr, config_len) {
      const device = states[dev]?.device;
      assert(device);
      assert(config_len >= device.config.byteLength, "config space too small");
      device.attach(
        new Uint8Array(dv.buffer, config_addr, config_len),
        (kind) => {
          U8.set(dv, is_config_addr, kind === "config" ? 1 : 0);
          U8.set(dv, is_vring_addr, kind === "vring" ? 1 : 0);
          trigger_irq_for_cpu(0, irq); // TODO: balance?
        },
      );
    },

    notify(dev, vq) {
      const device = states[dev];
      assert(device);
      queue_state(device, vq).pending = true;
      void drain_notifications(device, vq);
    },
  };
}
