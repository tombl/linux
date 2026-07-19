// SPDX-License-Identifier: MIT

import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
} from "./core.ts";

export function consoleDevice(
  input: ReadableStream<Uint8Array> | null,
  output: WritableStream<Uint8Array> | null,
): VirtioDevice {
  const reader = input?.getReader();
  const writer = output?.getWriter();
  let writing: Promise<void> | undefined;

  async function write_input(queue: Virtqueue) {
    assert(reader);
    const queue_iter = queue[Symbol.iterator]();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let chunk = value;

      while (chunk.length > 0) {
        const chain = queue_iter.next().value;
        if (!chain) {
          console.warn("no more descriptors, dropping console input");
          break;
        }

        const [desc, trailing] = chain;
        assert(desc && desc.writable, "receiver must be writable");
        assert(!trailing, "too many descriptors");

        const n = Math.min(chunk.length, desc.array.byteLength);
        desc.array.set(chunk.subarray(0, n));
        chunk = chunk.subarray(n);
        chain.release(n);
      }
    }
  }

  function notify_input(queue: Virtqueue) {
    return (writing ??= write_input(queue));
  }

  async function notify_output(queue: Virtqueue) {
    for (const chain of queue) {
      let n = 0;
      for (const { array, writable } of chain) {
        assert(!writable, "transmitter must be readable");
        await writer?.write(array);
        n += array.byteLength;
      }
      chain.release(n);
    }
  }

  return new VirtioController(
    { deviceId: 3 },
    {
      queues: [reader ? notify_input : () => {}, notify_output],
      close() {
        void reader?.cancel().catch(() => {});
        void writer?.close().catch(() => {});
      },
    },
  ).device;
}
