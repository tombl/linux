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
  const delivered = Promise.withResolvers<void>();
  const imports = virtio_imports({
    memory: console_memory,
    devices: [device],
    trigger_irq() {
      delivered.resolve();
    },
    on_error(error) {
      throw error;
    },
  });

  // A packed vring with one receive descriptor (at 64, length 4) that is not
  // yet available: the guest console port is not open.
  const descriptor = new DataView(console_memory.buffer);
  descriptor.setBigUint64(0, 64n, true);
  descriptor.setUint32(8, 4, true);
  descriptor.setUint16(12, 0, true);
  descriptor.setUint16(14, 0, true);
  imports.enable_vring(0, 0, 1, 0, 1);
  imports.notify(0, 0);

  // The host writes "hi" before the guest opens /dev/hvc0, and the input
  // handler runs while the descriptor is still unavailable.
  input_controller.enqueue(new TextEncoder().encode("hi"));
  await Promise.resolve();

  // Linux resets the device while probing it. The old descriptor must be
  // discarded, while input queued by the host survives for the replacement
  // queue that represents the opened console port.
  imports.reset(0);
  imports.disable_vring(0, 0);
  const replacement_ring = 128;
  const replacement = new DataView(console_memory.buffer, replacement_ring, 16);
  replacement.setBigUint64(0, 256n, true);
  replacement.setUint32(8, 4, true);
  replacement.setUint16(12, 0, true);
  replacement.setUint16(14, (1 << 7) | (1 << 1), true);
  imports.enable_vring(0, 0, 1, replacement_ring, 1);
  imports.notify(0, 0);
  const undelivered = new Promise((resolve) => setTimeout(resolve, 50));
  await Promise.race([delivered.promise, undelivered]);

  assert.deepEqual([...new Uint8Array(console_memory.buffer, 64, 2)], [0, 0]);
  const buffer = new Uint8Array(console_memory.buffer, 256, 4);
  assert.deepEqual(
    [...buffer.slice(0, 2)],
    [0x68, 0x69],
    "input must be held until the console port opens",
  );
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
