// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { consoleDevice } from "../src/virtio/console.ts";
import { ethernetDevice, ethernetNetwork } from "../src/virtio/net.ts";
import {
  VirtioController,
  close_virtio_device,
  virtio_device_description,
  virtio_imports,
} from "../src/virtio/core.ts";
import {
  allocate_shared_memory,
  memory_bytes,
  user_module_imports_supported,
} from "../src/wasm.ts";

function wasm_module(hex: string) {
  return new WebAssembly.Module(
    Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16)),
  );
}

const memory = new WebAssembly.Memory({
  initial: 1,
  maximum: 1,
  shared: true,
});

function allocator_succeeding_at(successful_maximum: number, attempts: number[]) {
  return (descriptor: WebAssembly.MemoryDescriptor) => {
    attempts.push(descriptor.maximum!);
    if (descriptor.maximum !== successful_maximum) throw new RangeError();
    return memory;
  };
}

test("shared memory allocation backs off by halves", () => {
  const attempts: number[] = [];
  const allocated = allocate_shared_memory(
    100,
    1000,
    allocator_succeeding_at(250, attempts),
  );

  assert.deepEqual(attempts, [1000, 500, 250]);
  assert.strictEqual(allocated.memory, memory);
  assert.equal(allocated.maximum_pages, 250);
});

test("the initial size is the floor", () => {
  const attempts: number[] = [];
  const allocated = allocate_shared_memory(
    100,
    1000,
    allocator_succeeding_at(100, attempts),
  );

  assert.deepEqual(attempts, [1000, 500, 250, 125, 100]);
  assert.equal(allocated.maximum_pages, 100);
});

test("a RangeError at the initial size is propagated", () => {
  const attempts: number[] = [];
  const error = new RangeError("out of memory");

  assert.throws(
    () =>
      allocate_shared_memory(100, 1000, (descriptor) => {
        attempts.push(descriptor.maximum!);
        throw error;
      }),
    (thrown) => thrown === error,
  );
  assert.deepEqual(attempts, [1000, 500, 250, 125, 100]);
});

test("a non-RangeError is propagated without retrying", () => {
  const attempts: number[] = [];
  const error = new TypeError("invalid descriptor");

  assert.throws(
    () =>
      allocate_shared_memory(100, 1000, (descriptor) => {
        attempts.push(descriptor.maximum!);
        throw error;
      }),
    (thrown) => thrown === error,
  );
  assert.deepEqual(attempts, [1000]);
});

test("memory views include growth performed by another worker", async () => {
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 2,
    shared: true,
  });
  const worker = new Worker(
    `
      const { parentPort, workerData } = require("node:worker_threads");
      workerData.grow(1);
      parentPort.postMessage(workerData.buffer.byteLength);
    `,
    { eval: true, workerData: memory },
  );

  try {
    const [worker_length] = await once(worker, "message");
    assert.equal(worker_length, 2 * 0x10000);

    const bytes = memory_bytes(memory, 0x10000);
    assert.equal(bytes?.byteLength, 0x10000);
    assert.equal(memory_bytes(memory, 2 * 0x10000, 1), null);
  } finally {
    await worker.terminate();
  }
});

test("userspace modules may only import the supported host ABI", () => {
  const supported = wasm_module(
    "0061736d0100000001040160000002200203656e76066d656d6f727902030101" +
      "056c696e75780773797363616c6c0000",
  );
  const unsupported = wasm_module(
    "0061736d0100000001040160000002190203656e76066d656d6f727902030101" +
      "046576696c01660000",
  );

  assert.equal(user_module_imports_supported(supported), true);
  assert.equal(user_module_imports_supported(unsupported), false);
});

test("closing an Ethernet network drops traffic from attached ports", async () => {
  const network = ethernetNetwork();
  let received = 0;
  const sender = network.addPort(() => {});
  network.addPort(() => {
    received += 1;
  });
  const frame = Uint8Array.from([
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0x02,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x08,
    0x00,
  ]);

  await sender.send(frame);
  assert.equal(received, 1);

  network.close();
  await sender.send(frame);
  assert.equal(received, 1);
  assert.throws(() => network.addPort(() => {}));
});

test("virtio-net preserves pending frames but drops receive chains on reset", async () => {
  const network = ethernetNetwork();
  const device = ethernetDevice(network, {
    macAddress: [0x02, 0, 0, 0, 0, 1],
  });
  const sender = network.addPort(() => {});
  const net_memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  const imports = virtio_imports({
    memory: net_memory,
    devices: [device],
    trigger_irq() {},
    on_error(error) {
      throw error;
    },
  });
  const queue_receive = (ring: number, address: number) => {
    const descriptor = new DataView(net_memory.buffer, ring, 16);
    descriptor.setBigUint64(0, BigInt(address), true);
    descriptor.setUint32(8, 64, true);
    descriptor.setUint16(12, 0, true);
    descriptor.setUint16(14, (1 << 7) | (1 << 1), true);
  };

  queue_receive(0, 64);
  imports.enable_vring(0, 0, 1, 0, 1);
  imports.notify(0, 0);
  imports.reset(0);
  imports.disable_vring(0, 0);

  const frame = Uint8Array.from([
    0x02,
    0,
    0,
    0,
    0,
    1,
    0x02,
    0,
    0,
    0,
    0,
    2,
    0x08,
    0x00,
  ]);
  await sender.send(frame);
  assert.deepEqual([...new Uint8Array(net_memory.buffer, 64, 26)], Array(26).fill(0));

  queue_receive(128, 256);
  imports.enable_vring(0, 0, 1, 128, 2);
  imports.notify(0, 0);
  await Promise.resolve();
  assert.deepEqual(
    [...new Uint8Array(net_memory.buffer, 256 + 12, frame.byteLength)],
    [...frame],
  );

  sender.close();
  await close_virtio_device(device);
  network.close();
});

test("console input is held until the guest opens its port", async () => {
  const console_memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  let input_controller!: ReadableStreamDefaultController<Uint8Array>;
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      input_controller = controller;
    },
  });
  const output: string[] = [];
  const device = consoleDevice(
    input,
    new WritableStream({
      write(chunk) {
        output.push(new TextDecoder().decode(chunk));
      },
    }),
  );
  const description = virtio_device_description(device);
  assert.notEqual(description.features & (1n << 1n), 0n);
  assert.equal(new DataView(description.config.buffer).getUint32(4, true), 1);
  device.resize(100, 40);
  const imports = virtio_imports({
    memory: console_memory,
    devices: [device],
    trigger_irq() {},
    on_error(error) {
      throw error;
    },
  });

  const RECEIVE_RING = 0;
  const CONTROL_RECEIVE_RING = 128;
  const CONTROL_TRANSMIT_RING = 512;
  const descriptor_at = (ring: number, slot: number) =>
    new DataView(console_memory.buffer, ring + slot * 16, 16);
  const queue_descriptor = (
    ring: number,
    slot: number,
    address: number,
    length: number,
    writable: boolean,
    next = false,
  ) => {
    const descriptor = descriptor_at(ring, slot);
    descriptor.setBigUint64(0, BigInt(address), true);
    descriptor.setUint32(8, length, true);
    descriptor.setUint16(12, slot, true);
    descriptor.setUint16(
      14,
      (1 << 7) | (writable ? 1 << 1 : 0) | (next ? 1 : 0),
      true,
    );
  };

  interface QueuedBuffer {
    ring_slot: number;
    parts: { address: number; length: number }[];
  }
  let control_receive_slot = 0;
  let control_receive_address = 2048;
  const control_buffers: QueuedBuffer[] = [];
  const queue_control_buffer = (...lengths: number[]) => {
    const buffer: QueuedBuffer = {
      ring_slot: control_receive_slot,
      parts: [],
    };
    for (const [index, length] of lengths.entries()) {
      const address = control_receive_address;
      control_receive_address += 32;
      buffer.parts.push({ address, length });
      queue_descriptor(
        CONTROL_RECEIVE_RING,
        control_receive_slot++,
        address,
        length,
        true,
        index + 1 < lengths.length,
      );
    }
    control_buffers.push(buffer);
  };
  const read_control_buffer = (index: number) => {
    const buffer = control_buffers[index]!;
    const bytes = new Uint8Array(
      buffer.parts.reduce((length, part) => length + part.length, 0),
    );
    let offset = 0;
    for (const part of buffer.parts) {
      bytes.set(
        new Uint8Array(console_memory.buffer, part.address, part.length),
        offset,
      );
      offset += part.length;
    }
    return new DataView(bytes.buffer);
  };
  const assert_control = (
    index: number,
    event: number,
    value: number,
    length = 8,
  ) => {
    const packet = read_control_buffer(index);
    assert.equal(packet.getUint32(0, true), 0, "control packet targets port 0");
    assert.equal(packet.getUint16(4, true), event);
    assert.equal(packet.getUint16(6, true), value);
    assert.equal(
      descriptor_at(CONTROL_RECEIVE_RING, control_buffers[index]!.ring_slot)
        .getUint32(8, true),
      length,
      "used length is the control packet length",
    );
    return packet;
  };

  let control_transmit_slot = 0;
  let control_transmit_address = 4096;
  const send_control = async (
    id: number,
    event: number,
    value: number,
    split_at?: number,
  ) => {
    const bytes = new Uint8Array(8);
    const packet = new DataView(bytes.buffer);
    packet.setUint32(0, id, true);
    packet.setUint16(4, event, true);
    packet.setUint16(6, value, true);
    const lengths = split_at === undefined ? [8] : [split_at, 8 - split_at];
    const first_slot = control_transmit_slot;
    let offset = 0;
    for (const [index, length] of lengths.entries()) {
      const address = control_transmit_address;
      control_transmit_address += 32;
      new Uint8Array(console_memory.buffer, address, length).set(
        bytes.subarray(offset, offset + length),
      );
      queue_descriptor(
        CONTROL_TRANSMIT_RING,
        control_transmit_slot++,
        address,
        length,
        false,
        index + 1 < lengths.length,
      );
      offset += length;
    }
    imports.notify(0, 3);
    for (let i = 0; i < 10; i++) {
      if (
        descriptor_at(CONTROL_TRANSMIT_RING, first_slot).getUint16(14, true) &
          (1 << 15)
      ) break;
      await Promise.resolve();
    }
    assert.notEqual(
      descriptor_at(CONTROL_TRANSMIT_RING, first_slot).getUint16(14, true) &
        (1 << 15),
      0,
      "guest-to-host control chain was released",
    );
    assert.equal(
      descriptor_at(CONTROL_TRANSMIT_RING, first_slot).getUint32(8, true),
      0,
      "guest-to-host control used length is zero",
    );
  };

  imports.enable_vring(0, 0, 4, RECEIVE_RING, 1);
  imports.enable_vring(0, 2, 16, CONTROL_RECEIVE_RING, 2);
  imports.enable_vring(0, 3, 16, CONTROL_TRANSMIT_RING, 3);

  queue_descriptor(RECEIVE_RING, 0, 1024, 8, true);
  imports.notify(0, 0);

  // The first host control packet and the first guest control packet are both
  // split across descriptors to exercise modern virtqueue framing.
  queue_control_buffer(3, 5);
  for (let i = 0; i < 10; i++) queue_control_buffer(16);
  imports.notify(0, 2);

  // The host writes "hi" before the guest opens /dev/hvc0, and the input
  // handler holds it despite an available receive descriptor.
  input_controller.enqueue(new TextEncoder().encode("hi"));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual([...new Uint8Array(console_memory.buffer, 1024, 2)], [0, 0]);

  // DEVICE_READY gets only PORT_ADD. The current size was changed before the
  // guest became ready, so it is retained for the later RESIZE packet.
  await send_control(0xffffffff, 0, 0);
  assert.equal(
    descriptor_at(CONTROL_RECEIVE_RING, control_buffers[0]!.ring_slot)
      .getUint32(8, true),
    3,
    "DEVICE_READY failure emits no port state",
  );
  await send_control(0xffffffff, 0, 1, 3);
  assert_control(0, 1, 1);
  assert.deepEqual([...new Uint8Array(console_memory.buffer, 1024, 2)], [0, 0]);
  await send_control(0xffffffff, 0, 1);
  assert.equal(
    descriptor_at(CONTROL_RECEIVE_RING, control_buffers[1]!.ring_slot)
      .getUint32(8, true),
    16,
    "duplicate DEVICE_READY emits no duplicate PORT_ADD",
  );

  // PORT_READY is answered synchronously, without timing gaps, with console
  // designation, current size, and host-open state in protocol order.
  await send_control(1, 3, 1);
  assert.equal(
    descriptor_at(CONTROL_RECEIVE_RING, control_buffers[1]!.ring_slot)
      .getUint32(8, true),
    16,
    "an unknown port emits no console state",
  );
  await send_control(0, 3, 1);
  assert_control(1, 4, 1);
  const resize = assert_control(2, 5, 0, 12);
  assert.equal(resize.getUint16(8, true), 100);
  assert.equal(resize.getUint16(10, true), 40);
  assert_control(3, 6, 1);
  assert.deepEqual([...new Uint8Array(console_memory.buffer, 1024, 2)], [0, 0]);
  await send_control(0, 3, 1);
  assert.equal(
    descriptor_at(CONTROL_RECEIVE_RING, control_buffers[4]!.ring_slot)
      .getUint32(8, true),
    16,
    "duplicate PORT_READY emits no duplicate port state",
  );

  // Only the guest's PORT_OPEN opens the input gate.
  await send_control(0, 6, 1);
  assert.deepEqual(
    [...new Uint8Array(console_memory.buffer, 1024, 2)],
    [0x68, 0x69],
  );

  // Closing the guest side holds new input. Reset invalidates the old receive
  // chain but preserves that host input for the restored console.
  await send_control(0, 6, 0);
  queue_descriptor(RECEIVE_RING, 1, 1056, 8, true);
  imports.notify(0, 0);
  input_controller.enqueue(new TextEncoder().encode("!"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(new Uint8Array(console_memory.buffer, 1056, 1)[0], 0);

  imports.reset(0);
  for (let queue = 0; queue < 4; queue++) {
    imports.disable_vring(0, queue);
  }
  new Uint8Array(console_memory.buffer, RECEIVE_RING, 4 * 16).fill(0);
  new Uint8Array(console_memory.buffer, CONTROL_RECEIVE_RING, 16 * 16).fill(0);
  new Uint8Array(console_memory.buffer, CONTROL_TRANSMIT_RING, 16 * 16).fill(0);
  control_receive_slot = 0;
  control_transmit_slot = 0;
  control_buffers.length = 0;

  imports.enable_vring(0, 0, 4, RECEIVE_RING, 1);
  imports.enable_vring(0, 2, 16, CONTROL_RECEIVE_RING, 2);
  imports.enable_vring(0, 3, 16, CONTROL_TRANSMIT_RING, 3);
  queue_descriptor(RECEIVE_RING, 0, 1088, 8, true);
  imports.notify(0, 0);
  for (let i = 0; i < 8; i++) queue_control_buffer(16);
  imports.notify(0, 2);

  // virtcons_restore sends PORT_READY for its existing port without another
  // DEVICE_READY. The host must replay all current port state, then wait for
  // the restored guest's PORT_OPEN before delivering the preserved input.
  await send_control(0, 3, 1);
  assert_control(0, 4, 1);
  const restored_resize = assert_control(1, 5, 0, 12);
  assert.equal(restored_resize.getUint16(8, true), 100);
  assert.equal(restored_resize.getUint16(10, true), 40);
  assert_control(2, 6, 1);
  assert.equal(new Uint8Array(console_memory.buffer, 1056, 1)[0], 0);
  assert.equal(new Uint8Array(console_memory.buffer, 1088, 1)[0], 0);
  await send_control(0, 6, 1);
  assert.equal(new Uint8Array(console_memory.buffer, 1056, 1)[0], 0);
  assert.equal(new Uint8Array(console_memory.buffer, 1088, 1)[0], 0x21);

  // Once ready, resize() uses the multiport RESIZE control event rather than
  // relying solely on a config interrupt, which Linux intentionally ignores.
  device.resize(120, 50);
  const live_resize = assert_control(3, 5, 0, 12);
  assert.equal(live_resize.getUint16(8, true), 120);
  assert.equal(live_resize.getUint16(10, true), 50);

  // A failed PORT_READY closes the gate and emits no console state. A later
  // successful readiness report refreshes the complete state immediately.
  await send_control(0, 3, 0);
  device.resize(132, 60);
  assert.equal(read_control_buffer(4).getUint16(4, true), 0);
  await send_control(0, 3, 1);
  assert_control(4, 4, 1);
  const refreshed_resize = assert_control(5, 5, 0, 12);
  assert.equal(refreshed_resize.getUint16(8, true), 132);
  assert.equal(refreshed_resize.getUint16(10, true), 60);
  assert_control(6, 6, 1);

  input_controller.close();
  await close_virtio_device(device);
});

test("virtio reset invalidates stale chains and pending notifications", async () => {
  const reset_memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  const work = Promise.withResolvers<void>();
  let notifications = 0;
  let resets = 0;
  let interrupts = 0;
  let release_stale_chain!: () => void;
  const controller = new VirtioController(
    { deviceId: 1 },
    {
      queues: [async (queue) => {
        notifications += 1;
        const [chain] = queue;
        assert(chain);
        if (notifications === 1) {
          release_stale_chain = () => chain.release(1);
          await work.promise;
        } else {
          chain.release(1);
        }
      }],
      reset() {
        resets += 1;
      },
    },
  );
  const imports = virtio_imports({
    memory: reset_memory,
    devices: [controller.device],
    trigger_irq() {
      interrupts += 1;
    },
    on_error(error) {
      throw error;
    },
  });
  const queue_descriptor = (ring: number, address: number) => {
    const descriptor = new DataView(reset_memory.buffer, ring, 16);
    descriptor.setBigUint64(0, BigInt(address), true);
    descriptor.setUint32(8, 1, true);
    descriptor.setUint16(12, 0, true);
    descriptor.setUint16(14, (1 << 7) | (1 << 1), true);
    return descriptor;
  };

  const stale_descriptor = queue_descriptor(0, 64);
  imports.enable_vring(0, 0, 1, 0, 1);
  imports.notify(0, 0);
  imports.notify(0, 0);
  assert.equal(notifications, 1);

  imports.reset(0);
  assert.equal(resets, 1);
  // Linux deletes each queue after resetting the device. This must remain
  // harmless even though reset already invalidated and detached the queue.
  imports.disable_vring(0, 0);
  release_stale_chain();
  await Promise.resolve();
  assert.equal(stale_descriptor.getUint32(8, true), 1);
  assert.equal(stale_descriptor.getUint16(14, true), (1 << 7) | (1 << 1));
  assert.equal(interrupts, 0);

  work.resolve();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(notifications, 1, "reset discarded the coalesced old kick");

  const restored_descriptor = queue_descriptor(128, 192);
  imports.enable_vring(0, 0, 1, 128, 2);
  imports.notify(0, 0);
  for (let i = 0; i < 10; i++) {
    if (restored_descriptor.getUint16(14, true) & (1 << 15)) break;
    await Promise.resolve();
  }
  assert.equal(notifications, 2);
  assert.equal(restored_descriptor.getUint32(8, true), 1);
  assert.notEqual(restored_descriptor.getUint16(14, true) & (1 << 15), 0);
  await Promise.resolve();
  assert.equal(interrupts, 1);
});

test("virtio close drains active queue work before one-time cleanup", async () => {
  const work = Promise.withResolvers<void>();
  let notifications = 0;
  let closes = 0;
  const controller = new VirtioController(
    { deviceId: 1 },
    {
      queues: [async () => {
        notifications += 1;
        await work.promise;
      }],
      close() {
        closes += 1;
      },
    },
  );
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  const imports = virtio_imports({
    memory,
    devices: [controller.device],
    trigger_irq() {},
    on_error(error) {
      throw error;
    },
  });
  const descriptor = new DataView(memory.buffer);
  descriptor.setBigUint64(0, 64n, true);
  descriptor.setUint32(8, 1, true);
  descriptor.setUint16(12, 0, true);
  descriptor.setUint16(14, 1 << 7, true);
  imports.enable_vring(0, 0, 1, 0, 1);
  imports.notify(0, 0);

  assert.equal(notifications, 1);
  const closing = close_virtio_device(controller.device);
  assert.strictEqual(close_virtio_device(controller.device), closing);
  let settled = false;
  void closing.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(closes, 0);

  work.resolve();
  await closing;
  assert.equal(closes, 1);
  imports.notify(0, 0);
  await Promise.resolve();
  assert.equal(notifications, 1);
});

test("virtio close reports driver cleanup failure exactly once", async () => {
  const error = new Error("cleanup failed");
  let closes = 0;
  const controller = new VirtioController(
    { deviceId: 1 },
    {
      queues: [],
      close() {
        closes += 1;
        throw error;
      },
    },
  );

  const closing = close_virtio_device(controller.device);
  await assert.rejects(closing, (thrown) => thrown === error);
  await assert.rejects(
    close_virtio_device(controller.device),
    (thrown) => thrown === error,
  );
  assert.equal(closes, 1);
});

test("virtio tracks a handler before it can reentrantly close", async () => {
  const work = Promise.withResolvers<void>();
  let closes = 0;
  let controller!: VirtioController;
  controller = new VirtioController(
    { deviceId: 1 },
    {
      queues: [() => {
        controller.close();
        return work.promise;
      }],
      close() {
        closes += 1;
      },
    },
  );
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  const imports = virtio_imports({
    memory,
    devices: [controller.device],
    trigger_irq() {},
    on_error(error) {
      throw error;
    },
  });
  const descriptor = new DataView(memory.buffer);
  descriptor.setBigUint64(0, 64n, true);
  descriptor.setUint32(8, 1, true);
  descriptor.setUint16(12, 0, true);
  descriptor.setUint16(14, 1 << 7, true);
  imports.enable_vring(0, 0, 1, 0, 1);
  imports.notify(0, 0);

  const closing = close_virtio_device(controller.device);
  await Promise.resolve();
  assert.equal(closes, 0);
  work.resolve();
  await closing;
  assert.equal(closes, 1);
});

test("virtio stop can unblock a handler before final cleanup", async () => {
  const work = Promise.withResolvers<void>();
  const events: string[] = [];
  const controller = new VirtioController(
    { deviceId: 1 },
    {
      queues: [async () => {
        events.push("notify");
        await work.promise;
      }],
      stop() {
        events.push("stop");
        work.resolve();
      },
      close() {
        events.push("close");
      },
    },
  );
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  const imports = virtio_imports({
    memory,
    devices: [controller.device],
    trigger_irq() {},
    on_error(error) {
      throw error;
    },
  });
  const descriptor = new DataView(memory.buffer);
  descriptor.setBigUint64(0, 64n, true);
  descriptor.setUint32(8, 1, true);
  descriptor.setUint16(12, 0, true);
  descriptor.setUint16(14, 1 << 7, true);
  imports.enable_vring(0, 0, 1, 0, 1);
  imports.notify(0, 0);

  await close_virtio_device(controller.device);
  assert.deepEqual(events, ["notify", "stop", "close"]);
});
