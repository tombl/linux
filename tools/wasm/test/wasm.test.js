// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { ethernetNetwork } from "../dist/virtio/net.js";
import {
  close_virtio_device,
  VirtioController,
  virtio_imports,
} from "../dist/virtio/core.js";
import {
  allocate_shared_memory,
  memory_bytes,
  user_module_imports_supported,
} from "../dist/wasm.js";

function wasm_module(hex) {
  return new WebAssembly.Module(
    Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16)),
  );
}

const memory = new WebAssembly.Memory({
  initial: 1,
  maximum: 1,
  shared: true,
});

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function allocator_succeeding_at(successful_maximum, attempts) {
  return (descriptor) => {
    attempts.push(descriptor.maximum);
    if (descriptor.maximum !== successful_maximum) throw new RangeError();
    return memory;
  };
}

test("shared memory allocation backs off by halves", () => {
  const attempts = [];
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
  const attempts = [];
  const allocated = allocate_shared_memory(
    100,
    1000,
    allocator_succeeding_at(100, attempts),
  );

  assert.deepEqual(attempts, [1000, 500, 250, 125, 100]);
  assert.equal(allocated.maximum_pages, 100);
});

test("a RangeError at the initial size is propagated", () => {
  const attempts = [];
  const error = new RangeError("out of memory");

  assert.throws(
    () =>
      allocate_shared_memory(100, 1000, (descriptor) => {
        attempts.push(descriptor.maximum);
        throw error;
      }),
    (thrown) => thrown === error,
  );
  assert.deepEqual(attempts, [1000, 500, 250, 125, 100]);
});

test("a non-RangeError is propagated without retrying", () => {
  const attempts = [];
  const error = new TypeError("invalid descriptor");

  assert.throws(
    () =>
      allocate_shared_memory(100, 1000, (descriptor) => {
        attempts.push(descriptor.maximum);
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

test("virtio close drains active queue work before one-time cleanup", async () => {
  const work = deferred();
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
  const work = deferred();
  let closes = 0;
  let controller;
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
  const work = deferred();
  const events = [];
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
