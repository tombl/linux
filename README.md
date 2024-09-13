# Linux WebAssembly port

[Try it in your browser.](https://linux.tombl.dev)

- [x] All the build infrastructure
- [x] Reimplementation of the ELF/linker features the kernel relies on
- [x] Kernel threads
  - Mapped to JavaScript workers
  - Complete multicore support
- [ ] Implement virtio in the host library
  - [ ] Implement a block device
- [ ] `binfmt_wasm`
- [ ] Jumping into userspace
- [ ] Expose syscall dispatch

## Eventually:

- virtio-rng backed by `crypto.getRandomValues()`
- virtio-net to connect multiple machines
  - and service worker loopback
- virtio-console to support multiple terminals
- virtio-fs backed by the [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- vsock to implement custom javascript integrations
  - unrestricted vscode in the browser?
- port lots of software
  - wrap/patch compilers to support `wasm32-linux`
    - both for cross-compilation and self-hosting
  - tailscale for full networking?
  - an x86_64 emulator like qemu/blink/box64?
- `/dev/fetch` as a character device exposing a HTTP proxy interface
  - parses requests and invokes `fetch()`
- canvas2d framebuffer driver?
- virtio-gl backed by WebGL?
- [wayland?](https://github.com/udevbe/greenfield)
- MMU support?
  - hopefully [WebAssembly/memory-control](https://github.com/WebAssembly/memory-control) is enough
  - otherwise instrument all memory access and implement a simple software MMU
- support dynamic linking
  - might need to wait for the [ABI](https://github.com/WebAssembly/tool-conventions/blob/main/DynamicLinking.md) to stabilize

---

> [If we add another architecture in the future, it may instead
> be something like the LLVM bitcode or WebAssembly, who knows?](https://lore.kernel.org/all/CAK8P3a2-wyXxctVtJxniUoeShASMhF-6Z1vyvfBnr6wKJuioAQ@mail.gmail.com/)

