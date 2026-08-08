// SPDX-License-Identifier: MIT

import { Struct, U16LE } from "../bytes.ts";
import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
  type VirtqueueChain,
} from "./core.ts";

const Features = {
  SIZE: 1n << 0n,
} as const;

class ConsoleConfig extends Struct({
  columns: U16LE,
  rows: U16LE,
}) {}

/**
 * The console device: a `VirtioDevice` whose dimensions can be changed
 * after boot.
 */
export interface ConsoleDevice extends VirtioDevice {
  /**
   * Changes the console's dimensions; the console boots at 80×24. The guest
   * sees the new size and delivers `SIGWINCH` to the foreground process.
   */
  resize(columns: number, rows: number): void;
}

/**
 * A virtio console: a byte pipe to a tty, visible in the guest as
 * `/dev/hvc0`.
 *
 * `input` is a `ReadableStream` of bytes to the tty — what a keyboard would
 * send. `output` is a `WritableStream` of bytes from the tty — what a
 * terminal would render. Either may be `null`: `consoleDevice(null, output)`
 * is a read-only console, such as a boot log.
 */
export function consoleDevice(
  input: ReadableStream<Uint8Array> | null,
  output: WritableStream<Uint8Array> | null,
): ConsoleDevice {
  const reader = input?.getReader();
  const writer = output?.getWriter();
  const config_bytes = new Uint8Array(ConsoleConfig.size);
  const config = new ConsoleConfig(config_bytes);
  config.columns = 80;
  config.rows = 24;
  let pumping: Promise<void> | undefined;
  let reader_cancellation: Promise<void> | undefined;
  let writer_abortion: Promise<void> | undefined;

  // Host input and guest receive buffers arrive independently, so keep both
  // in JS-side queues and match them up in `flush_input` whenever either
  // side gains something new: a guest kick stashes chains, a host chunk
  // lands in the input queue. Input is held until the guest opens the
  // console port instead of being dropped.
  const receive_chains: VirtqueueChain[] = [];
  const pending_input: Uint8Array[] = [];
  let guest_ready = false;

  function reset() {
    // Receive descriptors belong to the old queue, but host input belongs to
    // the console and must survive the reset Linux performs during probing.
    receive_chains.length = 0;
    guest_ready = false;
  }

  function flush_input() {
    while (
      guest_ready && receive_chains.length > 0 && pending_input.length > 0
    ) {
      const chain = receive_chains.shift()!;
      const chunk = pending_input[0]!;
      const [desc, trailing] = chain;
      assert(desc && desc.writable, "receiver must be writable");
      assert(!trailing, "too many descriptors");

      const n = Math.min(chunk.byteLength, desc.array.byteLength);
      desc.array.set(chunk.subarray(0, n));
      chain.release(n);
      if (n < chunk.byteLength) pending_input[0] = chunk.subarray(n);
      else pending_input.shift();
    }
  }

  async function pump_input() {
    assert(reader);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending_input.push(value);
      flush_input();
    }
  }

  function notify_input(queue: Virtqueue) {
    for (const chain of queue) receive_chains.push(chain);
    flush_input();
    pumping ??= pump_input().catch(console.error);
  }

  async function notify_output(queue: Virtqueue) {
    // Linux exposes the legacy console receive queue before hvc0 is ready to
    // consume it. Its first output kick proves that the console handoff has
    // completed, so input queued before boot is safe to release from here.
    if (!guest_ready) {
      guest_ready = true;
      flush_input();
    }
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

  const controller = new VirtioController(
    { deviceId: 3, features: Features.SIZE, config: config_bytes },
    {
      queues: [reader ? notify_input : () => {}, notify_output],
      reset,
      stop() {
        reset();
        pending_input.length = 0;
        reader_cancellation ??= reader?.cancel();
        writer_abortion ??= writer?.abort();
      },
      async close() {
        const results = await Promise.allSettled([
          reader_cancellation,
          writer_abortion,
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      },
    },
  );

  function resize(columns: number, rows: number) {
    assert(
      Number.isInteger(columns) && columns > 0 && columns <= 0xffff,
      "console columns must be a positive 16-bit integer",
    );
    assert(
      Number.isInteger(rows) && rows > 0 && rows <= 0xffff,
      "console rows must be a positive 16-bit integer",
    );
    if (config.columns === columns && config.rows === rows) return;
    config.columns = columns;
    config.rows = rows;
    controller.updateConfig(config_bytes);
  }

  return controller.expose({ resize });
}
