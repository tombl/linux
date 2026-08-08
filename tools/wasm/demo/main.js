// Demo boot: canvas framebuffer + virtio console/input + GUI rootfs when present.
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

function log(line) {
  consoleEl.textContent += `${line}\n`;
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

const browserKeyToLinux = {
  Escape: Key.ESC,
  Enter: Key.ENTER,
  Backspace: Key.BACKSPACE,
  Tab: Key.TAB,
  " ": Key.SPACE,
  Control: Key.LEFTCTRL,
  Shift: Key.LEFTSHIFT,
  Alt: Key.LEFTALT,
  ArrowUp: Key.UP,
  ArrowDown: Key.DOWN,
  ArrowLeft: Key.LEFT,
  ArrowRight: Key.RIGHT,
};

function mapKey(ev) {
  if (browserKeyToLinux[ev.key] !== undefined) return browserKeyToLinux[ev.key];
  if (ev.key.length === 1) {
    const c = ev.key.toLowerCase();
    if (c >= "a" && c <= "z") return Key.A + (c.charCodeAt(0) - 97);
  }
  return null;
}

async function loadRootfs() {
  // Prefer a locally built GUI rootfs; fall back to a tiny probe image later.
  for (const url of ["./rootfs.ext4", "/rootfs.ext4"]) {
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
  const rootfs = await loadRootfs();
  const input = new TransformStream();
  const output = new TransformStream();
  const keyboard = inputDevice({ name: "wasm keyboard" });

  canvas.addEventListener("keydown", (ev) => {
    const code = mapKey(ev);
    if (code == null) return;
    ev.preventDefault();
    keyboard.key(code, true);
  });
  canvas.addEventListener("keyup", (ev) => {
    const code = mapKey(ev);
    if (code == null) return;
    ev.preventDefault();
    keyboard.key(code, false);
  });
  canvas.addEventListener("mousemove", (ev) => {
    if (ev.buttons || ev.movementX || ev.movementY) {
      keyboard.move(ev.movementX | 0, ev.movementY | 0);
    }
  });

  const devices = [
    consoleDevice(input.readable, output.writable),
    entropyDevice(),
    keyboard,
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
      log(dec.decode(value, { stream: true }));
    }
  })();

  try {
    const machine = await spawnMachine({
      cpus: Math.min(2, navigator.hardwareConcurrency || 2),
      cmdline: rootfs
        ? "root=/dev/vda rootfstype=ext4 rw init=/init"
        : undefined,
      devices,
      framebuffer: { canvas, width: 1024, height: 768, bpp: 32 },
    });
    status.textContent = rootfs
      ? "running (GUI rootfs)"
      : "running (no rootfs — framebuffer probe only)";
    canvas.focus();
    log("[host] machine started");
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
