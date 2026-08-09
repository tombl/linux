// Demo boot: canvas framebuffer + virtio console/input + smoke/GUI rootfs.
import {
  spawnMachine,
  consoleDevice,
  entropyDevice,
  blockDevice,
  inputDevice,
  Key,
} from "../dist/index.js";

const status = document.getElementById("status");
const consoleEl = document.getElementById("console");
const bootBtn = document.getElementById("boot");
const canvas = document.getElementById("fb");

const FB_W = 1024;
const FB_H = 768;

function log(line) {
  consoleEl.textContent += `${line}\n`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/** Browser KeyboardEvent.code → Linux KEY_* (layout-independent). */
const codeToLinux = {
  Escape: Key.ESC,
  Digit1: Key["1"],
  Digit2: Key["2"],
  Digit3: Key["3"],
  Digit4: Key["4"],
  Digit5: Key["5"],
  Digit6: Key["6"],
  Digit7: Key["7"],
  Digit8: Key["8"],
  Digit9: Key["9"],
  Digit0: Key["0"],
  Minus: Key.MINUS,
  Equal: Key.EQUAL,
  Backspace: Key.BACKSPACE,
  Tab: Key.TAB,
  KeyQ: Key.Q,
  KeyW: Key.W,
  KeyE: Key.E,
  KeyR: Key.R,
  KeyT: Key.T,
  KeyY: Key.Y,
  KeyU: Key.U,
  KeyI: Key.I,
  KeyO: Key.O,
  KeyP: Key.P,
  BracketLeft: Key.LEFTBRACE,
  BracketRight: Key.RIGHTBRACE,
  Enter: Key.ENTER,
  ControlLeft: Key.LEFTCTRL,
  ControlRight: Key.RIGHTCTRL,
  KeyA: Key.A,
  KeyS: Key.S,
  KeyD: Key.D,
  KeyF: Key.F,
  KeyG: Key.G,
  KeyH: Key.H,
  KeyJ: Key.J,
  KeyK: Key.K,
  KeyL: Key.L,
  Semicolon: Key.SEMICOLON,
  Quote: Key.APOSTROPHE,
  Backquote: Key.GRAVE,
  ShiftLeft: Key.LEFTSHIFT,
  ShiftRight: Key.RIGHTSHIFT,
  Backslash: Key.BACKSLASH,
  KeyZ: Key.Z,
  KeyX: Key.X,
  KeyC: Key.C,
  KeyV: Key.V,
  KeyB: Key.B,
  KeyN: Key.N,
  KeyM: Key.M,
  Comma: Key.COMMA,
  Period: Key.DOT,
  Slash: Key.SLASH,
  AltLeft: Key.LEFTALT,
  AltRight: Key.RIGHTALT,
  Space: Key.SPACE,
  CapsLock: Key.CAPSLOCK,
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,
  ArrowUp: Key.UP,
  ArrowDown: Key.DOWN,
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
  Home: Key.HOME,
  End: Key.END,
  PageUp: Key.PAGEUP,
  PageDown: Key.PAGEDOWN,
  Insert: Key.INSERT,
  Delete: Key.DELETE,
};

function mapKey(ev) {
  if (codeToLinux[ev.code] !== undefined) return codeToLinux[ev.code];
  // Fallback for odd browsers: letter keys via ev.key.
  if (ev.key && ev.key.length === 1) {
    const c = ev.key.toLowerCase();
    if (c >= "a" && c <= "z") return Key.A + (c.charCodeAt(0) - 97);
  }
  return null;
}

function mapButton(button) {
  if (button === 0) return Key.BTN_LEFT;
  if (button === 1) return Key.BTN_MIDDLE;
  if (button === 2) return Key.BTN_RIGHT;
  return null;
}

function canvasCoords(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * FB_W;
  const y = ((ev.clientY - rect.top) / rect.height) * FB_H;
  return {
    x: Math.max(0, Math.min(FB_W - 1, Math.round(x))),
    y: Math.max(0, Math.min(FB_H - 1, Math.round(y))),
  };
}

async function loadBytes(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {
      /* try next */
    }
  }
  return null;
}

bootBtn.addEventListener("click", async () => {
  bootBtn.disabled = true;
  status.textContent = "booting…";
  // Prefer the GUI initramfs (Xfbdev + WM/xterm). Fall back to ext4.
  const initramfs = await loadBytes([
    "./initramfs.cpio",
    "/demo/initramfs.cpio",
  ]);
  const rootfs = initramfs
    ? null
    : await loadBytes(["./rootfs.ext4", "/demo/rootfs.ext4"]);

  const input = new TransformStream();
  const output = new TransformStream();
  const pointer = inputDevice({
    name: "wasm keyboard/mouse",
    absXMax: FB_W - 1,
    absYMax: FB_H - 1,
  });

  canvas.tabIndex = 0;
  canvas.style.outline = "none";
  canvas.style.touchAction = "none";

  canvas.addEventListener("keydown", (ev) => {
    const code = mapKey(ev);
    if (code == null) return;
    ev.preventDefault();
    pointer.key(code, true);
  });
  canvas.addEventListener("keyup", (ev) => {
    const code = mapKey(ev);
    if (code == null) return;
    ev.preventDefault();
    pointer.key(code, false);
  });

  canvas.addEventListener("pointermove", (ev) => {
    const { x, y } = canvasCoords(ev);
    pointer.abs(x, y);
  });
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.focus();
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    const { x, y } = canvasCoords(ev);
    pointer.abs(x, y);
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, true);
    ev.preventDefault();
  });
  canvas.addEventListener("pointerup", (ev) => {
    const { x, y } = canvasCoords(ev);
    pointer.abs(x, y);
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, false);
    ev.preventDefault();
  });
  canvas.addEventListener("pointercancel", (ev) => {
    const btn = mapButton(ev.button);
    if (btn != null) pointer.button(btn, false);
  });
  canvas.addEventListener(
    "wheel",
    (ev) => {
      // Linux REL_WHEEL: positive = up. Browser deltaY: positive = down.
      const steps = Math.max(1, Math.round(Math.abs(ev.deltaY) / 100));
      pointer.wheel(ev.deltaY < 0 ? steps : -steps);
      ev.preventDefault();
    },
    { passive: false },
  );
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  const devices = [
    consoleDevice(input.readable, output.writable),
    entropyDevice(),
    pointer,
  ];
  if (rootfs) {
    devices.push(
      blockDevice({
        capacity: rootfs.byteLength,
        read: (offset, length) => rootfs.subarray(offset, offset + length),
        write: (offset, data) => {
          rootfs.set(data, offset);
        },
      }),
    );
  }

  const reader = output.readable.getReader();
  (async () => {
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      log(dec.decode(new Uint8Array(value), { stream: true }));
    }
  })();

  try {
    const machine = await spawnMachine({
      cpus: Math.min(2, navigator.hardwareConcurrency || 2),
      cmdline: rootfs
        ? "root=/dev/vda rootfstype=ext4 rw rootwait init=/init"
        : "rdinit=/init",
      initcpio: initramfs ?? undefined,
      devices,
      framebuffer: { canvas, width: FB_W, height: FB_H, bpp: 32 },
    });
    status.textContent = initramfs
      ? "running (gui initramfs)"
      : rootfs
        ? "running (gui ext4 rootfs)"
        : "running (no userspace image)";
    canvas.focus();
    log("[host] machine started (absolute pointer + keyboard → virtio-input)");
    const bootReader = machine.bootConsole.getReader();
    (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await bootReader.read();
        if (done) break;
        log(dec.decode(new Uint8Array(value), { stream: true }));
      }
    })();
    machine.closed.catch((err) => {
      status.textContent = `stopped: ${err}`;
      log(String(err));
    });
  } catch (err) {
    status.textContent = "boot failed";
    log(String(err?.stack || err));
    bootBtn.disabled = false;
  }
});
