// SPDX-License-Identifier: MIT

import { Struct, U16LE, U32LE } from "../bytes.ts";
import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
  type VirtqueueChain,
} from "./core.ts";

/** Linux input event types / codes used by the guest virtio-input driver. */
export const Ev = {
  SYN: 0x00,
  KEY: 0x01,
  REL: 0x02,
  ABS: 0x03,
  REP: 0x14,
} as const;

export const Syn = {
  REPORT: 0,
} as const;

export const Rel = {
  X: 0x00,
  Y: 0x01,
  WHEEL: 0x08,
} as const;

export const Key = {
  RESERVED: 0,
  ESC: 1,
  A: 30,
  LEFTSHIFT: 42,
  LEFTCTRL: 29,
  LEFTALT: 56,
  SPACE: 57,
  ENTER: 28,
  BACKSPACE: 14,
  TAB: 15,
  UP: 103,
  LEFT: 105,
  RIGHT: 106,
  DOWN: 108,
} as const;

const CFG_ID_NAME = 0x01;
const CFG_ID_SERIAL = 0x02;
const CFG_ID_DEVIDS = 0x03;
const CFG_PROP_BITS = 0x10;
const CFG_EV_BITS = 0x11;

class InputEvent extends Struct({
  type: U16LE,
  code: U16LE,
  value: U32LE,
}) {}

function set_bit(bitmap: Uint8Array, bit: number) {
  bitmap[bit >> 3]! |= 1 << (bit & 7);
}

function write_string(config: Uint8Array, text: string): number {
  const bytes = new TextEncoder().encode(text);
  config.fill(0, 8);
  const n = Math.min(bytes.length, 128);
  config.set(bytes.subarray(0, n), 8);
  return n;
}

/**
 * A virtio-input keyboard/mouse. Host code calls `send` with Linux evdev
 * triples; the guest sees `/dev/input/event*`.
 */
export interface InputDevice extends VirtioDevice {
  /** Queue a single input event (type/code/value). */
  send(type: number, code: number, value: number): void;
  /** Convenience: key press/release + SYN_REPORT. */
  key(code: number, down: boolean): void;
  /** Convenience: relative mouse motion + SYN_REPORT. */
  move(dx: number, dy: number): void;
}

export function inputDevice(options?: {
  name?: string;
  serial?: string;
}): InputDevice {
  const name = options?.name ?? "wasm keyboard";
  const serial = options?.serial ?? "wasm0";
  const config_bytes = new Uint8Array(8 + 128);

  const keybits = new Uint8Array(128);
  for (let code = 1; code <= 248; code++) set_bit(keybits, code);
  const relbits = new Uint8Array(16);
  set_bit(relbits, Rel.X);
  set_bit(relbits, Rel.Y);
  set_bit(relbits, Rel.WHEEL);

  const respond = (guest: Uint8Array) => {
    const select = guest[0]!;
    const subsel = guest[1]!;
    guest.fill(0, 2);
    guest[0] = select;
    guest[1] = subsel;
    switch (select) {
      case CFG_ID_NAME:
        guest[2] = write_string(guest, name);
        break;
      case CFG_ID_SERIAL:
        guest[2] = write_string(guest, serial);
        break;
      case CFG_ID_DEVIDS:
      case CFG_PROP_BITS:
        guest[2] = 0;
        break;
      case CFG_EV_BITS:
        guest.fill(0, 8);
        if (subsel === Ev.KEY) {
          guest.set(keybits, 8);
          guest[2] = keybits.length;
        } else if (subsel === Ev.REL) {
          guest.set(relbits, 8);
          guest[2] = relbits.length;
        } else if (subsel === Ev.REP) {
          guest[8] = 0xff;
          guest[2] = 1;
        } else {
          guest[2] = 0;
        }
        break;
      default:
        guest[2] = 0;
        break;
    }
  };

  // Seed initial config so attach publishes a valid buffer.
  config_bytes[0] = CFG_ID_NAME;
  respond(config_bytes);

  const pending: Array<{ type: number; code: number; value: number }> = [];
  const event_chains: VirtqueueChain[] = [];

  function flush() {
    while (pending.length > 0 && event_chains.length > 0) {
      const chain = event_chains.shift()!;
      const evt = pending.shift()!;
      const [desc, trailing] = chain;
      assert(desc && desc.writable, "input event buffer must be writable");
      assert(!trailing, "input event must be a single descriptor");
      assert(desc.array.byteLength >= InputEvent.size);
      const view = new InputEvent(desc.array.subarray(0, InputEvent.size));
      view.type = evt.type;
      view.code = evt.code;
      view.value = evt.value;
      chain.release(InputEvent.size);
    }
  }

  const controller = new VirtioController(
    {
      deviceId: 18, // VIRTIO_ID_INPUT
      config: config_bytes,
    },
    {
      queues: [
        (queue: Virtqueue) => {
          for (const chain of queue) event_chains.push(chain);
          flush();
        },
        (queue: Virtqueue) => {
          for (const chain of queue) chain.release(0);
        },
      ],
      configWritten(guest) {
        respond(guest);
        // Keep the controller's shadow copy aligned for later updateConfig.
        config_bytes.set(guest.subarray(0, config_bytes.byteLength));
      },
      reset() {
        event_chains.length = 0;
      },
    },
  );

  const api = {
    send(type: number, code: number, value: number) {
      pending.push({ type, code, value });
      flush();
    },
    key(code: number, down: boolean) {
      this.send(Ev.KEY, code, down ? 1 : 0);
      this.send(Ev.SYN, Syn.REPORT, 0);
    },
    move(dx: number, dy: number) {
      if (dx) this.send(Ev.REL, Rel.X, dx);
      if (dy) this.send(Ev.REL, Rel.Y, dy);
      this.send(Ev.SYN, Syn.REPORT, 0);
    },
  };
  return controller.expose(api) as unknown as InputDevice;
}
