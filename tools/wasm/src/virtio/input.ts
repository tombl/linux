// SPDX-License-Identifier: MIT

import { Struct, U8, U16LE, U32LE, U64LE } from "../bytes.ts";
import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
  type VirtqueueChain,
} from "./core.ts";

const VirtioInputConfigSelect = {
  UNSET: 0x00,
  ID_NAME: 0x01,
  ID_SERIAL: 0x02,
  ID_DEVIDS: 0x03,
  PROP_BITS: 0x10,
  EV_BITS: 0x11,
  ABS_INFO: 0x12,
} as const;

export const InputEventType = {
  SYN: 0x00,
  KEY: 0x01,
  REL: 0x02,
  ABS: 0x03,
} as const;

export const InputSynCode = {
  REPORT: 0,
} as const;

export const InputKeyCode = {
  ESC: 1,
  KEY_1: 2,
  KEY_2: 3,
  KEY_3: 4,
  KEY_4: 5,
  KEY_5: 6,
  KEY_6: 7,
  KEY_7: 8,
  KEY_8: 9,
  KEY_9: 10,
  KEY_0: 11,
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
} as const;

export const InputButtonCode = {
  LEFT: 0x110,
  RIGHT: 0x111,
  MIDDLE: 0x112,
  SIDE: 0x113,
  EXTRA: 0x114,
} as const;

export const InputRelCode = {
  X: 0x00,
  Y: 0x01,
  HWHEEL: 0x06,
  WHEEL: 0x08,
} as const;

class VirtioInputConfig extends Struct({
  select: U8,
  subsel: U8,
  size: U8,
  reserved0: U8,
  reserved1: U8,
  reserved2: U8,
  reserved3: U8,
  reserved4: U8,
  u0: U64LE,
  u1: U64LE,
  u2: U64LE,
  u3: U64LE,
  u4: U64LE,
  u5: U64LE,
  u6: U64LE,
  u7: U64LE,
  u8: U64LE,
  u9: U64LE,
  u10: U64LE,
  u11: U64LE,
  u12: U64LE,
  u13: U64LE,
  u14: U64LE,
  u15: U64LE,
}) {}

class VirtioInputEvent extends Struct({
  type: U16LE,
  code: U16LE,
  value: U32LE,
}) {}

type InputDeviceKind = "keyboard" | "pointer" | "mouse";

export interface InputDeviceOptions {
  kind: InputDeviceKind;
  name?: string;
  serial?: string;
  vendor?: number;
  product?: number;
  version?: number;
  keys?: readonly number[];
  buttons?: readonly number[];
  relAxes?: readonly number[];
  maxPendingEvents?: number;
}

export interface InputDevice extends VirtioDevice {
  enqueue(type: number, code: number, value: number): void;
  key(code: number, down: boolean): void;
  enqueueKeyEvent(code: number, down: boolean): void;
  button(code: number, down: boolean): void;
  enqueueButtonEvent(code: number, down: boolean): void;
  rel(code: number, value: number): void;
  relative(code: number, value: number): void;
  enqueueRelativeEvent(code: number, value: number): void;
  move(dx: number, dy: number): void;
  enqueueWheelEvent(delta: number): void;
  sync(): void;
  frame(
    events: Iterable<{ type: number; code: number; value: number }>,
  ): void;
}

function set_bit(bitmap: Uint8Array, bit: number) {
  assert(bit >= 0 && Number.isInteger(bit), `invalid input bit ${bit}`);
  const index = bit >> 3;
  assert(index < bitmap.byteLength, `input bit ${bit} exceeds bitmap`);
  bitmap[index] = bitmap[index]! | (1 << (bit & 7));
}

function bitmap_for(bits: Iterable<number>) {
  const bitmap = new Uint8Array(128);
  for (const bit of bits) set_bit(bitmap, bit);
  let size = bitmap.byteLength;
  while (size > 0 && bitmap[size - 1] === 0) size--;
  return bitmap.subarray(0, size);
}

function copy_config_payload(config: Uint8Array, payload: Uint8Array) {
  config.fill(0, 2);
  const size = Math.min(payload.byteLength, 128);
  config[2] = size;
  config.set(payload.subarray(0, size), 8);
}

function encode_ascii(value: string, max_length = 128) {
  return new TextEncoder().encode(value).subarray(0, max_length);
}

const DEFAULT_KEYBOARD_KEYS = [
  ...Array.from({ length: 88 }, (_, i) => i + 1),
  InputKeyCode.RIGHTCTRL,
  InputKeyCode.RIGHTALT,
  InputKeyCode.HOME,
  InputKeyCode.UP,
  InputKeyCode.PAGEUP,
  InputKeyCode.LEFT,
  InputKeyCode.RIGHT,
  InputKeyCode.END,
  InputKeyCode.DOWN,
  InputKeyCode.PAGEDOWN,
  InputKeyCode.INSERT,
  InputKeyCode.DELETE,
] as const;

const DEFAULT_POINTER_BUTTONS = [
  InputButtonCode.LEFT,
  InputButtonCode.RIGHT,
  InputButtonCode.MIDDLE,
] as const;

const DEFAULT_POINTER_REL_AXES = [
  InputRelCode.X,
  InputRelCode.Y,
  InputRelCode.WHEEL,
] as const;

/** A virtio input device with keyboard or relative-pointer capabilities. */
export function inputDevice(options: InputDeviceOptions): InputDevice {
  const config_bytes = new Uint8Array(VirtioInputConfig.size);
  const name = encode_ascii(options.name ?? `wasm virtio ${options.kind}`);
  const serial = encode_ascii(options.serial ?? `wasm-${options.kind}-0`);
  const ids = new Uint8Array(8);
  const id_view = new DataView(ids.buffer);
  id_view.setUint16(0, 0x06, true);
  id_view.setUint16(2, options.vendor ?? 0x1d6b, true);
  id_view.setUint16(
    4,
    options.product ?? (options.kind === "keyboard" ? 1 : 2),
    true,
  );
  id_view.setUint16(6, options.version ?? 1, true);

  const key_bits = bitmap_for(
    options.kind === "keyboard"
      ? (options.keys ?? DEFAULT_KEYBOARD_KEYS)
      : (options.buttons ?? DEFAULT_POINTER_BUTTONS),
  );
  const rel_bits = bitmap_for(
    options.kind === "pointer" || options.kind === "mouse"
      ? (options.relAxes ?? DEFAULT_POINTER_REL_AXES)
      : [],
  );
  const max_pending_events = options.maxPendingEvents ?? 1024;
  const pending_events: Uint8Array[] = [];
  let event_buffers: VirtqueueChain[] = [];

  function refresh_config(controller: VirtioController) {
    const select = config_bytes[0] ?? 0;
    const subsel = config_bytes[1] ?? 0;
    let payload = new Uint8Array();

    switch (select) {
      case VirtioInputConfigSelect.ID_NAME:
        payload = name;
        break;
      case VirtioInputConfigSelect.ID_SERIAL:
        payload = serial;
        break;
      case VirtioInputConfigSelect.ID_DEVIDS:
        payload = ids;
        break;
      case VirtioInputConfigSelect.EV_BITS:
        switch (subsel) {
          case InputEventType.SYN:
            payload = bitmap_for([InputSynCode.REPORT]);
            break;
          case InputEventType.KEY:
            payload = key_bits;
            break;
          case InputEventType.REL:
            payload = rel_bits;
            break;
        }
        break;
      case VirtioInputConfigSelect.PROP_BITS:
      case VirtioInputConfigSelect.ABS_INFO:
      case VirtioInputConfigSelect.UNSET:
        break;
    }

    copy_config_payload(config_bytes, payload);
    controller.updateConfig(config_bytes);
  }

  function flush_events() {
    while (pending_events.length > 0 && event_buffers.length > 0) {
      const event = pending_events.shift()!;
      const chain = event_buffers.shift()!;
      const [desc, trailing] = chain;
      assert(desc?.writable, "input event buffer must be writable");
      assert(!trailing, "input event buffer should be one descriptor");
      assert(
        desc.array.byteLength >= event.byteLength,
        "input event buffer is too small",
      );
      desc.array.set(event);
      chain.release(event.byteLength);
    }
  }

  function notify_events(queue: Virtqueue) {
    for (const chain of queue) event_buffers.push(chain);
    flush_events();
  }

  function notify_status(queue: Virtqueue) {
    for (const chain of queue) chain.release(0);
  }

  const controller = new VirtioController(
    { deviceId: 18, config: config_bytes },
    {
      queues: [notify_events, notify_status],
      configChanged(config, next_controller) {
        config_bytes.set(config);
        refresh_config(next_controller);
      },
      queueDisabled(vq) {
        if (vq === 0) event_buffers = [];
      },
    },
  );

  function enqueue(type: number, code: number, value: number) {
    const bytes = new Uint8Array(VirtioInputEvent.size);
    const event = new VirtioInputEvent(bytes);
    event.type = type;
    event.code = code;
    event.value = value >>> 0;
    if (pending_events.length >= max_pending_events) pending_events.shift();
    pending_events.push(bytes);
    flush_events();
  }

  function key(code: number, down: boolean) {
    enqueue(InputEventType.KEY, code, down ? 1 : 0);
  }

  function sync() {
    enqueue(InputEventType.SYN, InputSynCode.REPORT, 0);
  }

  const api = {
    enqueue,
    key,
    enqueueKeyEvent(code: number, down: boolean) {
      key(code, down);
      sync();
    },
    button: key,
    enqueueButtonEvent(code: number, down: boolean) {
      key(code, down);
      sync();
    },
    rel(code: number, value: number) {
      if (value !== 0) enqueue(InputEventType.REL, code, value);
    },
    relative(code: number, value: number) {
      api.rel(code, value);
    },
    enqueueRelativeEvent(code: number, value: number) {
      api.rel(code, value);
      sync();
    },
    move(dx: number, dy: number) {
      api.rel(InputRelCode.X, dx);
      api.rel(InputRelCode.Y, dy);
    },
    enqueueWheelEvent(delta: number) {
      api.rel(InputRelCode.WHEEL, delta);
      sync();
    },
    sync,
    frame(events: Iterable<{ type: number; code: number; value: number }>) {
      for (const event of events) {
        enqueue(event.type, event.code, event.value);
      }
      sync();
    },
  };
  return controller.expose(api);
}
