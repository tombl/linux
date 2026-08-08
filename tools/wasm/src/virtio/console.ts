// SPDX-License-Identifier: MIT

import { Struct, U16LE, U32LE } from "../bytes.ts";
import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
  type VirtqueueChain,
} from "./core.ts";

const Features = {
  SIZE: 1n << 0n,
  MULTIPORT: 1n << 1n,
} as const;

const ControlEvents = {
  DEVICE_READY: 0,
  PORT_ADD: 1,
  PORT_READY: 3,
  CONSOLE_PORT: 4,
  RESIZE: 5,
  PORT_OPEN: 6,
} as const;

const PORT_0 = 0;

class ConsoleConfig extends Struct({
  columns: U16LE,
  rows: U16LE,
  max_nr_ports: U32LE,
}) {}

class ControlMessage extends Struct({
  id: U32LE,
  event: U16LE,
  value: U16LE,
}) {}

interface QueuedControl {
  event: number;
  bytes: Uint8Array;
}

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
 *
 * The multiport control protocol is used even though this device has one
 * port. It gives the guest a way to tell the host exactly when the console
 * port is open, so input queued during guest setup is not delivered early
 * and discarded.
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
  config.max_nr_ports = 1;
  let pumping: Promise<void> | undefined;
  let reader_cancellation: Promise<void> | undefined;
  let writer_abortion: Promise<void> | undefined;
  let stopped = false;

  // Host input and guest receive buffers arrive independently, so keep both
  // in JS-side queues and match them up in `flush_input` whenever either
  // side gains something new: a guest kick stashes chains, a host chunk
  // lands in the input queue. Input is held until the guest opens the
  // console port instead of being dropped.
  const receive_chains: VirtqueueChain[] = [];
  const pending_input: Uint8Array[] = [];
  const control_chains: VirtqueueChain[] = [];
  const outbound_control: QueuedControl[] = [];
  let device_ready = false;
  let port_ready = false;
  let guest_connected = false;

  function control_packet(event: number, value: number) {
    const bytes = new Uint8Array(ControlMessage.size);
    const message = new ControlMessage(bytes);
    message.id = PORT_0;
    message.event = event;
    message.value = value;
    return { event, bytes };
  }

  function resize_packet() {
    const packet = control_packet(ControlEvents.RESIZE, 0);
    const bytes = new Uint8Array(ControlMessage.size + 4);
    bytes.set(packet.bytes);
    const resized = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    resized.setUint16(ControlMessage.size, config.columns, true);
    resized.setUint16(ControlMessage.size + 2, config.rows, true);
    return { event: ControlEvents.RESIZE, bytes };
  }

  function write_control(chain: VirtqueueChain, packet: Uint8Array) {
    const buffers = [...chain];
    assert(buffers.length > 0, "empty control receiver");
    assert(
      buffers.every(({ writable }) => writable),
      "control receiver must be writable",
    );
    assert(
      buffers.reduce((length, { array }) => length + array.byteLength, 0) >=
        packet.byteLength,
      "control buffer too small",
    );

    let offset = 0;
    for (const { array } of buffers) {
      const n = Math.min(array.byteLength, packet.byteLength - offset);
      array.set(packet.subarray(offset, offset + n));
      offset += n;
      if (offset === packet.byteLength) break;
    }
    chain.release(packet.byteLength);
  }

  function flush_control() {
    while (control_chains.length > 0 && outbound_control.length > 0) {
      const chain = control_chains.shift()!;
      const packet = outbound_control.shift()!;
      write_control(chain, packet.bytes);
    }
  }

  function send_control(event: number, value: number) {
    outbound_control.push(control_packet(event, value));
    flush_control();
  }

  function queue_resize() {
    const packet = resize_packet();
    const index = outbound_control.findIndex(
      ({ event }) => event === ControlEvents.RESIZE,
    );
    if (index < 0) {
      outbound_control.push(packet);
      return;
    }

    outbound_control[index]!.bytes = packet.bytes;
    for (let i = outbound_control.length - 1; i > index; i--) {
      if (outbound_control[i]!.event === ControlEvents.RESIZE) {
        outbound_control.splice(i, 1);
      }
    }
  }

  function announce_port_state() {
    outbound_control.push(control_packet(ControlEvents.CONSOLE_PORT, 1));
    outbound_control.push(resize_packet());
    outbound_control.push(control_packet(ControlEvents.PORT_OPEN, 1));
    flush_control();
  }

  function reset() {
    receive_chains.length = 0;
    control_chains.length = 0;
    outbound_control.length = 0;
    device_ready = false;
    port_ready = false;
    guest_connected = false;
  }

  function flush_input() {
    while (
      guest_connected && receive_chains.length > 0 && pending_input.length > 0
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

  function notify_control_receive(queue: Virtqueue) {
    for (const chain of queue) control_chains.push(chain);
    flush_control();
  }

  function read_control(chain: VirtqueueChain) {
    const bytes = new Uint8Array(ControlMessage.size);
    let offset = 0;
    for (const { array, writable } of chain) {
      assert(!writable, "control transmitter must be readable");
      const n = Math.min(array.byteLength, bytes.byteLength - offset);
      bytes.set(array.subarray(0, n), offset);
      offset += n;
    }
    assert(offset === bytes.byteLength, "control message too small");
    return new ControlMessage(bytes);
  }

  function notify_control_transmit(queue: Virtqueue) {
    for (const chain of queue) {
      const message = read_control(chain);

      switch (message.event) {
        case ControlEvents.DEVICE_READY:
          if (message.value === 1) {
            if (device_ready) break;
            device_ready = true;
            send_control(ControlEvents.PORT_ADD, 1);
          } else if (message.value === 0) {
            device_ready = false;
            port_ready = false;
            guest_connected = false;
            outbound_control.length = 0;
          }
          break;
        case ControlEvents.PORT_READY:
          if (message.id !== PORT_0) break;
          if (message.value === 1) {
            if (port_ready) break;
            port_ready = true;
            announce_port_state();
          } else if (message.value === 0) {
            port_ready = false;
            guest_connected = false;
            outbound_control.length = 0;
          }
          break;
        case ControlEvents.PORT_OPEN:
          if (
            message.id === PORT_0 && port_ready &&
            (message.value === 0 || message.value === 1)
          ) {
            guest_connected = message.value === 1;
            flush_input();
          }
          break;
      }

      // This is a device-readable chain; no bytes were written into it.
      chain.release(0);
    }
  }

  const controller = new VirtioController(
    {
      deviceId: 3,
      features: Features.SIZE | Features.MULTIPORT,
      config: config_bytes,
    },
    {
      queues: [
        reader ? notify_input : () => {},
        notify_output,
        notify_control_receive,
        notify_control_transmit,
      ],
      reset,
      stop() {
        stopped = true;
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
    if (!stopped && port_ready) {
      queue_resize();
      flush_control();
    }
  }

  return controller.expose({ resize });
}
