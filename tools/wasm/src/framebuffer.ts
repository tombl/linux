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
 * Convert guest little-endian x8r8g8b8 (memory bytes B,G,R,A → u32 0xAARRGGBB)
 * into Canvas ImageData RGBA (u32 0xAABBGGRR). Alpha is forced opaque.
 *
 * Uses word-sized loads/stores; much faster than a per-channel nested loop.
 */
export function swizzle_bgra_to_rgba(
  dst: Uint8ClampedArray,
  src: Uint8Array,
  width: number,
  height: number,
  stride: number,
) {
  const pixels = width * height;
  const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, pixels);
  // Prefer a single tight copy when stride matches the packed row width.
  if (stride === width * 4 && src.byteOffset % 4 === 0) {
    const src32 = new Uint32Array(src.buffer, src.byteOffset, pixels);
    for (let i = 0; i < pixels; i++) {
      const p = src32[i]!;
      dst32[i] =
        (p & 0xff00ff00) |
        ((p & 0x000000ff) << 16) |
        ((p & 0x00ff0000) >> 16) |
        0xff000000;
    }
    return;
  }
  for (let y = 0; y < height; y++) {
    const row_offset = src.byteOffset + y * stride;
    const row = new Uint32Array(src.buffer, row_offset, width);
    const dst_row = y * width;
    for (let x = 0; x < width; x++) {
      const p = row[x]!;
      dst32[dst_row + x] =
        (p & 0xff00ff00) |
        ((p & 0x000000ff) << 16) |
        ((p & 0x00ff0000) >> 16) |
        0xff000000;
    }
  }
}

/**
 * Host-side canvas presenter for the wasm framebuffer driver.
 * Kernel memory is swizzled into ImageData and painted with Canvas2D.
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
  let dirty = false;
  // Recycled staging buffer so present() does not allocate 3MiB per frame.
  let staging: Uint8Array | null = null;

  let present_stride = width * 4;

  const schedule_paint = () => {
    if (raf || closed) return;
    const request =
      globalThis.requestAnimationFrame ??
      ((cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number);
    raf = request(() => {
      raf = 0;
      if (closed || !dirty || !staging) return;
      dirty = false;
      // Convert at most once per animation frame even if the guest queued
      // many presents while the main thread was busy.
      swizzle_bgra_to_rgba(
        image.data,
        staging,
        width,
        height,
        present_stride,
      );
      ctx.putImageData(image, 0, 0);
    });
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
      if (stride < width * 4) return;
      const bytes = memory_bytes(memory, addr >>> 0, stride * height);
      if (!bytes) return;

      // Snapshot out of shared memory before the guest draws again. Reuse the
      // staging allocation; only the first frame (or a mode change) allocates.
      const need = stride * height;
      if (!staging || staging.byteLength !== need) {
        staging = new Uint8Array(need);
      }
      staging.set(bytes);
      present_stride = stride;
      dirty = true;
      schedule_paint();
    },
    close() {
      closed = true;
      if (raf) {
        (globalThis.cancelAnimationFrame ?? clearTimeout)(raf);
        raf = 0;
      }
      dirty = false;
      staging = null;
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
