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

export const Abs = {
  X: 0x00,
  Y: 0x01,
} as const;

/** Common Linux KEY_* / BTN_* codes (include/uapi/linux/input-event-codes.h). */
export const Key = {
  RESERVED: 0,
  ESC: 1,
  "1": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
  "6": 7,
  "7": 8,
  "8": 9,
  "9": 10,
  "0": 11,
  MINUS: 12,
  EQUAL: 13,
  BACKSPACE: 14,
  TAB: 15,
  Q: 16,
  W: 17,
  E: 18,
  R: 19,
  T: 20,
  Y: 21,
  U: 22,
  I: 23,
  O: 24,
  P: 25,
  LEFTBRACE: 26,
  RIGHTBRACE: 27,
  ENTER: 28,
  LEFTCTRL: 29,
  A: 30,
  S: 31,
  D: 32,
  F: 33,
  G: 34,
  H: 35,
  J: 36,
  K: 37,
  L: 38,
  SEMICOLON: 39,
  APOSTROPHE: 40,
  GRAVE: 41,
  LEFTSHIFT: 42,
  BACKSLASH: 43,
  Z: 44,
  X: 45,
  C: 46,
  V: 47,
  B: 48,
  N: 49,
  M: 50,
  COMMA: 51,
  DOT: 52,
  SLASH: 53,
  RIGHTSHIFT: 54,
  LEFTALT: 56,
  SPACE: 57,
  CAPSLOCK: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  F11: 87,
  F12: 88,
  RIGHTCTRL: 97,
  RIGHTALT: 100,
  HOME: 102,
  UP: 103,
  PAGEUP: 104,
  LEFT: 105,
  RIGHT: 106,
  END: 107,
  DOWN: 108,
  PAGEDOWN: 109,
  INSERT: 110,
  DELETE: 111,
  /** Mouse buttons (BTN_*). */
  BTN_LEFT: 0x110,
  BTN_RIGHT: 0x111,
  BTN_MIDDLE: 0x112,
} as const;

const CFG_ID_NAME = 0x01;
const CFG_ID_SERIAL = 0x02;
const CFG_ID_DEVIDS = 0x03;
const CFG_PROP_BITS = 0x10;
const CFG_EV_BITS = 0x11;
const CFG_ABS_INFO = 0x12;

/** INPUT_PROP_DIRECT — tablet-like absolute pointer. */
const PROP_DIRECT = 0x01;

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

function write_absinfo(
  config: Uint8Array,
  min: number,
  max: number,
  fuzz = 0,
  flat = 0,
  res = 0,
): number {
  config.fill(0, 8);
  const view = new DataView(config.buffer, config.byteOffset + 8, 20);
  view.setUint32(0, min >>> 0, true);
  view.setUint32(4, max >>> 0, true);
  view.setUint32(8, fuzz >>> 0, true);
  view.setUint32(12, flat >>> 0, true);
  view.setUint32(16, res >>> 0, true);
  return 20;
}

/**
 * A virtio-input keyboard/mouse. Host code calls `send` with Linux evdev
 * triples; the guest sees `/dev/input/event*`.
 */
export interface InputDevice extends VirtioDevice {
  /** Queue a single input event (type/code/value). */
  send(type: number, code: number, value: number): void;
  /** Convenience: key/button press/release + SYN_REPORT. */
  key(code: number, down: boolean): void;
  /** Convenience: relative mouse motion + SYN_REPORT. */
  move(dx: number, dy: number): void;
  /** Convenience: absolute pointer position + SYN_REPORT. */
  abs(x: number, y: number): void;
  /** Convenience: mouse button press/release + SYN_REPORT. */
  button(code: number, down: boolean): void;
  /** Convenience: vertical wheel ticks + SYN_REPORT. */
  wheel(delta: number): void;
}

export function inputDevice(options?: {
  name?: string;
  serial?: string;
  /** Absolute X axis max (inclusive). Default 1023. */
  absXMax?: number;
  /** Absolute Y axis max (inclusive). Default 767. */
  absYMax?: number;
}): InputDevice {
  const name = options?.name ?? "wasm keyboard/mouse";
  const serial = options?.serial ?? "wasm0";
  const absXMax = options?.absXMax ?? 1023;
  const absYMax = options?.absYMax ?? 767;
  const config_bytes = new Uint8Array(8 + 128);

  // KEY_* through 255 plus BTN_LEFT/RIGHT/MIDDLE (0x110-0x112).
  const keybits = new Uint8Array(64);
  for (let code = 1; code <= 255; code++) set_bit(keybits, code);
  set_bit(keybits, Key.BTN_LEFT);
  set_bit(keybits, Key.BTN_RIGHT);
  set_bit(keybits, Key.BTN_MIDDLE);

  const relbits = new Uint8Array(16);
  set_bit(relbits, Rel.X);
  set_bit(relbits, Rel.Y);
  set_bit(relbits, Rel.WHEEL);

  const absbits = new Uint8Array(8);
  set_bit(absbits, Abs.X);
  set_bit(absbits, Abs.Y);

  const propbits = new Uint8Array(1);
  set_bit(propbits, PROP_DIRECT);

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
        guest[2] = 0;
        break;
      case CFG_PROP_BITS:
        guest.fill(0, 8);
        guest.set(propbits, 8);
        guest[2] = propbits.length;
        break;
      case CFG_EV_BITS:
        guest.fill(0, 8);
        if (subsel === Ev.KEY) {
          guest.set(keybits, 8);
          guest[2] = keybits.length;
        } else if (subsel === Ev.REL) {
          guest.set(relbits, 8);
          guest[2] = relbits.length;
        } else if (subsel === Ev.ABS) {
          guest.set(absbits, 8);
          guest[2] = absbits.length;
        } else if (subsel === Ev.REP) {
          guest[8] = 0xff;
          guest[2] = 1;
        } else {
          guest[2] = 0;
        }
        break;
      case CFG_ABS_INFO:
        if (subsel === Abs.X) {
          guest[2] = write_absinfo(guest, 0, absXMax);
        } else if (subsel === Abs.Y) {
          guest[2] = write_absinfo(guest, 0, absYMax);
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
  /** Cap host→guest backlog so a stalled reader cannot OOM the page. */
  const MAX_PENDING_EVENTS = 512;

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

  function enqueue(type: number, code: number, value: number) {
    if (pending.length >= MAX_PENDING_EVENTS) {
      // Drop the oldest half; keep recent motion/keys so the guest recovers.
      pending.splice(0, pending.length >> 1);
    }
    pending.push({ type, code, value });
    flush();
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
      enqueue(type, code, value);
    },
    key(code: number, down: boolean) {
      enqueue(Ev.KEY, code, down ? 1 : 0);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    move(dx: number, dy: number) {
      if (dx) enqueue(Ev.REL, Rel.X, dx);
      if (dy) enqueue(Ev.REL, Rel.Y, dy);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    abs(x: number, y: number) {
      const cx = Math.max(0, Math.min(absXMax, x | 0));
      const cy = Math.max(0, Math.min(absYMax, y | 0));
      // Coalesce consecutive absolute samples still waiting for the guest.
      // pointermove can exceed 100Hz; replacing the tail keeps latency low
      // without growing an unbounded backlog.
      const n = pending.length;
      if (n >= 3) {
        const a = pending[n - 3]!;
        const b = pending[n - 2]!;
        const c = pending[n - 1]!;
        if (
          a.type === Ev.ABS &&
          a.code === Abs.X &&
          b.type === Ev.ABS &&
          b.code === Abs.Y &&
          c.type === Ev.SYN &&
          c.code === Syn.REPORT
        ) {
          a.value = cx;
          b.value = cy;
          flush();
          return;
        }
      }
      enqueue(Ev.ABS, Abs.X, cx);
      enqueue(Ev.ABS, Abs.Y, cy);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    button(code: number, down: boolean) {
      enqueue(Ev.KEY, code, down ? 1 : 0);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    wheel(delta: number) {
      if (!delta) return;
      enqueue(Ev.REL, Rel.WHEEL, delta | 0);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
  };
  return controller.expose(api) as unknown as InputDevice;
}
