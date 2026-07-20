// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { allocate_shared_memory } from "../dist/wasm.js";

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

test("shared memory allocation backs off by halves to 512 MiB", () => {
  const attempts = [];
  const allocated = allocate_shared_memory(
    1,
    0xffff,
    allocator_succeeding_at(8192, attempts),
  );

  assert.deepEqual(attempts, [0xffff, 32767, 16383, 8192]);
  assert.strictEqual(allocated.memory, memory);
  assert.equal(allocated.maximum_pages, 8192);
});

test("the initial size is the floor when it exceeds 512 MiB", () => {
  const attempts = [];
  const allocated = allocate_shared_memory(
    10_000,
    0xffff,
    allocator_succeeding_at(10_000, attempts),
  );

  assert.deepEqual(attempts, [0xffff, 32767, 16383, 10_000]);
  assert.equal(allocated.maximum_pages, 10_000);
});

test("a RangeError at the floor is propagated", () => {
  const attempts = [];
  const error = new RangeError("out of memory");

  assert.throws(
    () =>
      allocate_shared_memory(1, 8192, (descriptor) => {
        attempts.push(descriptor.maximum);
        throw error;
      }),
    (thrown) => thrown === error,
  );
  assert.deepEqual(attempts, [8192]);
});

test("a non-RangeError is propagated without retrying", () => {
  const attempts = [];
  const error = new TypeError("invalid descriptor");

  assert.throws(
    () =>
      allocate_shared_memory(1, 0xffff, (descriptor) => {
        attempts.push(descriptor.maximum);
        throw error;
      }),
    (thrown) => thrown === error,
  );
  assert.deepEqual(attempts, [0xffff]);
});
