// SPDX-License-Identifier: MIT

import { Struct, U16LE, U32LE, U64LE } from "../bytes.ts";
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

interface Descriptor {
  addr: bigint;
  len: number;
  id: number;
  flags: number;
}

/** One descriptor's view into the machine's memory. */
export interface VirtqueueBuffer {
  readonly array: Uint8Array;
  /** Whether the guest driver allows the device to write to this buffer. */
  readonly writable: boolean;
}

/** A chain of descriptors making up one request. */
export interface VirtqueueChain extends Iterable<VirtqueueBuffer> {
  /** Completes the chain, reporting how many bytes the device wrote. */
  release(written: number): void;
}

/** A virtqueue: iterate it to take the pending chains. */
export interface Virtqueue extends Iterable<VirtqueueChain> {}

class Chain implements VirtqueueChain {
  #memory: WebAssembly.Memory;
  #desc: Descriptor[];
  #release: (written: number) => void;

  constructor(
    memory: WebAssembly.Memory,
    desc: Descriptor[],
    release: (written: number) => void,
  ) {
    this.#memory = memory;
    this.#desc = desc;
    this.#release = release;
  }

  release(written: number) {
    this.#release(written);
  }

  *[Symbol.iterator]() {
    for (const desc of this.#desc) {
      yield {
        array: new Uint8Array(
          this.#memory.buffer,
          Number(desc.addr),
          desc.len,
        ),
        writable: (desc.flags & DescriptorFlags.WRITE) !== 0,
      };
    }
  }
}

class PackedVirtqueue implements Virtqueue {
  #memory: WebAssembly.Memory;
  #size: number;
  #desc_addr: number;
  #on_release: () => void;
  #avail_wrap = true;
  #used_wrap = true;
  #used_idx = 0;
  #avail_idx = 0;

  constructor(
    memory: WebAssembly.Memory,
    size: number,
    desc_addr: number,
    on_release: () => void,
  ) {
    assert(size !== 0);
    this.#memory = memory;
    this.#size = size;
    this.#desc_addr = desc_addr;
    this.#on_release = on_release;
  }

  #descriptor(index: number) {
    const desc = VirtqDescriptor.get(
      new DataView(this.#memory.buffer),
      this.#desc_addr + VirtqDescriptor.size * index,
    );
    return {
      addr: desc.addr,
      len: desc.len,
      id: desc.id,
      flags: desc.flags,
    };
  }

  #indirect_descriptors(address: number, count: number) {
    const descriptors: Descriptor[] = [];
    for (let i = 0; i < count; i++) {
      const desc = VirtqDescriptor.get(
        new DataView(this.#memory.buffer),
        address + VirtqDescriptor.size * i,
      );
      descriptors.push({
        addr: desc.addr,
        len: desc.len,
        id: desc.id,
        flags: desc.flags,
      });
    }
    return descriptors;
  }

  #pop() {
    let i = this.#advance();
    if (i === null) return null;

    let desc = this.#descriptor(i);
    const id = desc.id;
    let skip = 1;
    let chain_desc = [desc];

    if (desc.flags & DescriptorFlags.NEXT) {
      do {
        i = this.#advance();
        if (i === null) throw new Error("no next descriptor is available");
        desc = this.#descriptor(i);
        chain_desc.push(desc);
        skip += 1;
      } while (desc.flags & DescriptorFlags.NEXT);
    } else if (desc.flags & DescriptorFlags.INDIRECT) {
      if (desc.len % VirtqDescriptor.size !== 0) {
        throw new Error("malformed indirect buffer");
      }
      chain_desc = this.#indirect_descriptors(
        Number(desc.addr),
        desc.len / VirtqDescriptor.size,
      );
    }

    return new Chain(
      this.#memory,
      chain_desc,
      (written) => this.#release(id, skip, written),
    );
  }

  *[Symbol.iterator]() {
    let chain;
    while ((chain = this.#pop())) yield chain;
  }

  #advance() {
    const desc = this.#descriptor(this.#avail_idx);

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
    const desc = VirtqDescriptor.get(
      new DataView(this.#memory.buffer),
      this.#desc_addr + VirtqDescriptor.size * this.#used_idx,
    );
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

    this.#on_release();
  }
}

type RaiseConfigInterrupt = () => void;

/** The identity, features, and configuration space of a virtio device. */
export interface VirtioDeviceOptions {
  /** The virtio device ID: 1 is net, 3 is console, 4 is entropy. */
  deviceId: number;
  /** Device-specific feature bits; transport features are added automatically. */
  features?: bigint;
  /** The device's configuration space, read by the guest driver. */
  config?: Uint8Array;
}

/** Called when the guest driver notifies a virtqueue. */
export type VirtqueueHandler = (
  queue: Virtqueue,
  controller: VirtioController,
) => void | PromiseLike<void>;

/** The behavior of a device behind a `VirtioController`. */
export interface VirtioDriver {
  /** One handler per virtqueue. */
  readonly queues: readonly VirtqueueHandler[];
  /** Synchronously starts cancellation needed to unblock queue handlers. */
  stop?(): void;
  /** Called after in-flight queue handlers settle when the device is closed. */
  close?(controller: VirtioController): void | PromiseLike<void>;
}

interface TransportDevice {
  readonly device_id: number;
  readonly features: bigint;
  readonly config: Uint8Array;
  attach(
    get_config: () => Uint8Array,
    raise_config: RaiseConfigInterrupt,
  ): void;
  notify(vq: number, queue: Virtqueue): void | PromiseLike<void>;
  close(): Promise<void>;
}

const transport_device = Symbol("virtio transport device");

/** A virtio device that can be attached to a machine. */
export interface VirtioDevice {
  readonly [transport_device]: TransportDevice;
}

/**
 * The device side of a virtio device: feature negotiation, virtqueues,
 * configuration space, and interrupts. A custom device constructs one with
 * a device ID and queue handlers, and attaches the resulting `device` to
 * the machine.
 */
export class VirtioController {
  /** The attachable device. */
  readonly device: VirtioDevice;
  /** Pushes a new configuration to the guest and raises a config-change interrupt. */
  readonly updateConfig: (config: Uint8Array) => void;
  /** Idempotently starts closing the device. */
  readonly close: () => void;
  /** Merges extra methods into the public device object; callable once. */
  readonly expose: <API extends object>(api: API) => VirtioDevice & API;

  /** Creates a virtio device backed by `driver`. */
  constructor(options: VirtioDeviceOptions, driver: VirtioDriver) {
    const config = options.config?.slice() ?? new Uint8Array();
    let get_guest_config: (() => Uint8Array) | undefined;
    let raise_config: RaiseConfigInterrupt | undefined;
    let config_pending = false;
    let closed = false;
    let close_promise: Promise<void> | undefined;
    const active = new Set<Promise<void>>();
    let exposed = false;

    const start_close = () => {
      if (close_promise) return close_promise;
      closed = true;
      close_promise = (async () => {
        let failure: PromiseRejectedResult | undefined;
        try {
          driver.stop?.();
        } catch (reason) {
          failure = { status: "rejected", reason };
        }
        const results = await Promise.allSettled(active);
        failure ??= results.find((result) => result.status === "rejected");
        try {
          await driver.close?.(this);
        } catch (reason) {
          failure ??= { status: "rejected", reason };
        }
        if (failure) throw failure.reason;
      })();
      void close_promise.catch(() => {});
      return close_promise;
    };

    const endpoint: TransportDevice = {
      device_id: options.deviceId,
      features: TransportFeatures.VERSION_1 |
        TransportFeatures.RING_PACKED |
        TransportFeatures.INDIRECT_DESC |
        (options.features ?? 0n),
      config,

      attach: (next_get_config, next_raise_config) => {
        assert(!closed, "cannot attach a closed virtio device");
        assert(!get_guest_config, "virtio device is already attached");
        next_get_config().set(config);
        get_guest_config = next_get_config;
        raise_config = next_raise_config;
        if (config_pending) {
          config_pending = false;
          raise_config();
        }
      },

      notify: (vq, queue) => {
        if (closed) return;
        const handler = driver.queues[vq];
        assert(handler, `virtio device has no queue ${vq}`);
        const completion = Promise.withResolvers<void>();
        active.add(completion.promise);
        try {
          Promise.resolve(handler(queue, this)).then(
            completion.resolve,
            completion.reject,
          );
        } catch (error) {
          completion.reject(error);
        }
        void completion.promise
          .finally(() => active.delete(completion.promise))
          .catch(() => {});
        return completion.promise;
      },

      close: start_close,
    };
    const device = {} as VirtioDevice;
    Object.defineProperty(device, transport_device, { value: endpoint });
    this.device = device;

    this.updateConfig = (next_config) => {
      assert(
        next_config.byteLength === config.byteLength,
        "virtio config size cannot change",
      );
      config.set(next_config);
      get_guest_config?.().set(config);
      if (closed) return;
      if (raise_config) raise_config();
      else config_pending = true;
    };

    this.close = () => void start_close();
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
  return device[transport_device].close();
}

export function virtio_imports({
  memory,
  devices,
  trigger_irq,
  on_error,
}: {
  memory: WebAssembly.Memory;
  devices: readonly VirtioDevice[];
  trigger_irq: (irq: number) => void;
  on_error: (error: unknown) => void;
}): Imports["virtio"] {
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

    enable_vring(dev, vq, size, desc_addr, irq) {
      const device = states[dev];
      assert(device);
      const state = queue_state(device, vq);
      // Interrupt once per synchronous batch of released chains.
      let armed = false;
      const queue: PackedVirtqueue = new PackedVirtqueue(
        memory,
        size,
        desc_addr >>> 0,
        () => {
          if (armed) return;
          armed = true;
          queueMicrotask(() => {
            armed = false;
            if (state.queue === queue) trigger_irq(irq);
          });
        },
      );
      state.queue = queue;
      if (state.pending) void drain_notifications(device, vq);
    },
    disable_vring(dev, vq) {
      const device = states[dev];
      assert(device);
      const state = device.queues[vq];
      assert(state?.queue);
      state.queue = undefined;
    },

    setup(dev, config_irq, config_addr, config_len) {
      const address = config_addr >>> 0;
      const length = config_len >>> 0;
      const device = states[dev]?.device;
      assert(device);
      assert(length >= device.config.byteLength, "config space too small");
      device.attach(
        () => new Uint8Array(memory.buffer, address, length),
        () => trigger_irq(config_irq),
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
