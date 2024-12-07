import { Struct, U16LE, U32LE, U64LE, U8 } from "./bytes.ts";
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

// With current transports, virtqueues are located in guest memory allocated by the driver.
// Each packed virtqueue consists of three parts:

//     Descriptor Ring - occupies the Descriptor Area

// Where the Descriptor Ring in turn consists of descriptors, and where each descriptor can contain the following parts:

//     Buffer ID
//     Element Address
//     Element Length
//     Flags

// A buffer consists of zero or more device-readable physically-contiguous elements followed by zero or more
// physically-contiguous device-writable elements (each buffer has at least one element).

// When the driver wants to send such a buffer to the device, it writes at least one available descriptor
// describing elements of the buffer into the Descriptor Ring. The descriptor(s) are associated with a
// buffer by means of a Buffer ID stored within the descriptor.

// The driver then notifies the device. When the device has finished processing the buffer,
// it writes a used device descriptor including the Buffer ID into the Descriptor Ring
// (overwriting a driver descriptor previously made available), and sends a used event notification.

// The Descriptor Ring is used in a circular manner: the driver writes descriptors into the ring in order.
// After reaching the end of the ring, the next descriptor is placed at the head of the ring.
// Once the ring is full of driver descriptors, the driver stops sending new requests and waits for the device
// to start processing descriptors and to write out some used descriptors before making new driver descriptors available.

// Similarly, the device reads descriptors from the ring in order and detects that a driver descriptor has been made available.
// As processing of descriptors is completed, used descriptors are written by the device back into the ring.

const Descriptor = Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE,
});

class Virtqueue {
  device: VirtioDevice;
  size = 0;
  desc_addr = 0;
  used_addr = 0;
  avail_addr = 0;

  constructor(device: VirtioDevice) {
    this.device = device;
  }

  enable() {
    console.log("enable", this);
  }
  disable() {
    throw new Error("not implemented");
  }
  notify() {
    console.log("notify", this);
  }
}

abstract class VirtioDevice {
  abstract vqs: Virtqueue[];
  config = new Uint8Array(0);
  features = VIRTIO_F_VERSION_1 | VIRTIO_F_RING_PACKED |
    VIRTIO_F_EVENT_IDX |
    VIRTIO_F_INDIRECT_DESC;

  trigger_interrupt = (is_config: boolean, is_vring: boolean): void => {
    // this function is overwritten on device setup
    void is_config, is_vring;
    throw new Error("unreachable");
  };
}

class EntropyDevice extends VirtioDevice {
  requestq: Virtqueue = new Virtqueue(this);
  vqs = [this.requestq];
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
      set_vring_enable(dev, vq, enable) {
        const device = devices[dev];
        if (!device) return -EINVAL;

        const virtqueue = device.vqs[vq];
        if (!virtqueue) return -EINVAL;

        if (enable) virtqueue.enable();
        else virtqueue.disable();

        return 0;
      },
      set_vring_num(dev, vq, num) {
        const device = devices[dev];
        if (!device) return -EINVAL;

        const virtqueue = device.vqs[vq];
        if (!virtqueue) return -EINVAL;

        virtqueue.size = num;

        return 0;
      },
      set_vring_addr(dev, vq, desc, used, avail) {
        const device = devices[dev];
        if (!device) return -EINVAL;

        const virtqueue = device.vqs[vq];
        if (!virtqueue) return -EINVAL;

        virtqueue.desc_addr = desc;
        virtqueue.used_addr = used;
        virtqueue.avail_addr = avail;

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
          is_config,
          is_vring,
        ) => {
          U8.set(
            dv,
            is_config_addr,
            is_config ? 1 : 0,
          );
          U8.set(
            dv,
            is_vring_addr,
            is_vring ? 1 : 0,
          );
          instance.exports.trigger_irq_for_cpu(
            0,
            irq,
          ); // TODO: balance?
        };

        return 0;
      },
      notify(dev, vq) {
        const device = devices[dev];
        if (!device) return -EINVAL;

        const virtqueue = device.vqs[vq];
        if (!virtqueue) return -EINVAL;

        virtqueue.notify();

        return 0;
      },
    },
  } satisfies Imports;

  const instance = (new WebAssembly.Instance(vmlinux, imports)) as Instance;
  instance.exports.worker_entry(fn, arg);
};
