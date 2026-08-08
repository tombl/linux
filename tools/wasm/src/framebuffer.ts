// SPDX-License-Identifier: MIT

import { memory_bytes } from "./wasm.ts";

/** Minimal 2d context surface used by the presenter (canvas or offscreen). */
export type FramebufferContext2D = {
  createImageData(sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
};

export type FramebufferCanvas = {
  width: number;
  height: number;
  getContext(contextId: "2d"): FramebufferContext2D | null;
};

export interface FramebufferOptions {
  /** Target canvas. Sized to the framebuffer mode on attach. */
  canvas: FramebufferCanvas;
  /** Pixel width. Defaults to 1024. */
  width?: number;
  /** Pixel height. Defaults to 768. */
  height?: number;
  /** Bits per pixel. Only 32 (x8r8g8b8) is supported. */
  bpp?: number;
}

export interface FramebufferHost {
  readonly width: number;
  readonly height: number;
  readonly bpp: number;
  get_mode(width_ptr: number, height_ptr: number, bpp_ptr: number): void;
  present(
    addr: number,
    width: number,
    height: number,
    stride: number,
    bpp: number,
  ): void;
  close(): void;
}

/**
 * Host-side canvas presenter for the wasm framebuffer driver.
 * Kernel memory is copied into ImageData and painted with Canvas2D.
 */
export function createFramebufferHost(
  memory: WebAssembly.Memory,
  options: FramebufferOptions,
): FramebufferHost {
  const width = options.width ?? 1024;
  const height = options.height ?? 768;
  const bpp = options.bpp ?? 32;
  if (bpp !== 32) throw new Error("framebuffer only supports 32bpp");

  const canvas = options.canvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  const image = ctx.createImageData(width, height);
  let closed = false;
  let raf = 0;
  let dirty: Uint8Array | null = null;

  const paint = () => {
    raf = 0;
    if (closed || !dirty) return;
    const pixels = image.data;
    // Guest is x8r8g8b8 (byte order B,G,R,A on little-endian). Canvas wants RGBA.
    for (let y = 0; y < height; y++) {
      const src_row = y * (dirty.byteLength / height);
      const dst_row = y * width * 4;
      for (let x = 0; x < width; x++) {
        const s = src_row + x * 4;
        const d = dst_row + x * 4;
        pixels[d] = dirty[s + 2]!; // R
        pixels[d + 1] = dirty[s + 1]!; // G
        pixels[d + 2] = dirty[s]!; // B
        pixels[d + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    dirty = null;
  };

  return {
    width,
    height,
    bpp,
    get_mode(width_ptr, height_ptr, bpp_ptr) {
      const view = new DataView(memory.buffer);
      view.setUint32(width_ptr >>> 0, width, true);
      view.setUint32(height_ptr >>> 0, height, true);
      view.setUint32(bpp_ptr >>> 0, bpp, true);
    },
    present(addr, fb_width, fb_height, stride, fb_bpp) {
      if (closed) return;
      if (fb_width !== width || fb_height !== height || fb_bpp !== 32) return;
      const bytes = memory_bytes(memory, addr >>> 0, stride * height);
      if (!bytes) return;
      // Copy out of shared memory before rAF so concurrent guest writes are stable.
      dirty = bytes.slice();
      if (!raf) {
        raf = (globalThis.requestAnimationFrame ?? ((cb: FrameRequestCallback) =>
          setTimeout(cb, 16) as unknown as number))(paint);
      }
    },
    close() {
      closed = true;
      if (raf) {
        (globalThis.cancelAnimationFrame ?? clearTimeout)(raf);
        raf = 0;
      }
      dirty = null;
    },
  };
}

/** Wasm imports for the fb module. A null host still advertises a default mode. */
export function framebuffer_imports(
  memory: WebAssembly.Memory,
  host: FramebufferHost | null,
  defaults: { width: number; height: number; bpp: number } = {
    width: 1024,
    height: 768,
    bpp: 32,
  },
): ImportsFb {
  if (host) {
    return {
      get_mode: (w, h, b) => host.get_mode(w, h, b),
      present: (a, w, h, s, b) => host.present(a, w, h, s, b),
    };
  }
  return {
    get_mode(width_ptr, height_ptr, bpp_ptr) {
      const view = new DataView(memory.buffer);
      view.setUint32(width_ptr >>> 0, defaults.width, true);
      view.setUint32(height_ptr >>> 0, defaults.height, true);
      view.setUint32(bpp_ptr >>> 0, defaults.bpp, true);
    },
    present() {
      /* headless: discard frames */
    },
  };
}

export type ImportsFb = {
  get_mode(width_ptr: number, height_ptr: number, bpp_ptr: number): void;
  present(
    addr: number,
    width: number,
    height: number,
    stride: number,
    bpp: number,
  ): void;
};
