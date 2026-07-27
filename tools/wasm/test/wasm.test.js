// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { ethernetNetwork } from "../dist/virtio/net.js";
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
