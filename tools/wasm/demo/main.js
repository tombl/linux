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
  const initramfs = await loadBytes([
    "./initramfs.cpio",
    "/demo/initramfs.cpio",
  ]);
  const rootfs = initramfs
    ? null
    : await loadBytes(["./rootfs.ext4", "/demo/rootfs.ext4"]);

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
    if (ev.movementX || ev.movementY) {
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
      framebuffer: { canvas, width: 1024, height: 768, bpp: 32 },
    });
    status.textContent = initramfs
      ? "running (initramfs smoke)"
      : rootfs
      ? "running (ext4 rootfs)"
      : "running (no userspace image)";
    canvas.focus();
    log("[host] machine started");
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
