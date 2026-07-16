# Downstream survey and roadmap signals

Snapshot: 2026-07-16.

This is a survey of public references to `tombl/linux`, every visible branch of
its public GitHub forks, and the unpublished kernel integration described by
[`kilian-ai/linuxontab`](https://github.com/kilian-ai/linuxontab/commits/feature/linux-kernel-integration/).
It is intended to capture downstream usage, bugs worth reproducing upstream,
and feature demand. Private repositories, deleted branches, and uncommitted
work are necessarily absent.

GitHub's exact code search returned eight ordinary hits and 29 with
`fork:true`. Most of the additional results are copied unchanged through forks
of the same repositories. The meaningful independent references are discussed
below.

## Bugs

### High-confidence upstream candidates

#### Virtio console does not signal TX completion

[`JoyciAkira/linux@0368e704`](https://github.com/JoyciAkira/linux/commit/0368e704cd4f)
observes that `ConsoleDevice.notify()` consumes and releases TX descriptors but
does not raise the vring completion interrupt. Once the ring fills, a guest
writer can wait forever for descriptors it was never told had completed.

The proposed fix is the same completion notification used by other devices: a
call to `this.trigger_interrupt("vring")` after releasing TX chains. This looks
correct and should be taken with a regression test that writes more than one
ring's worth of console output.

#### WASM userspace heap is capped by a zero `end_brk`

[`JoyciAkira/linux@b4a4a31b`](https://github.com/JoyciAkira/linux/commit/b4a4a31b20f184d41d519132d8090194553639c9)
sets `current->mm->context.end_brk` in `binfmt_wasm`. In a NO-MMU `mm`, the
field is otherwise zero-initialized and prevents `brk` growth near the initial
WASM memory limit. Their headless Chromium harness reports that allocations
previously stopped around 47 MiB, while the patched loader handled cumulative
allocations of 380 MiB and a separate 512 MiB allocation while growing WASM
memory to 1 GiB.

This should be taken after normal review, preferably spelling the value as
`ULONG_MAX` and retaining a reduced version of their browser regression
harness.

#### Virtio IRQs can be lost for work running away from CPU 0

[`JoyciAkira/linux@457aaee2`](https://github.com/JoyciAkira/linux/commit/457aaee29717)
reports that host virtio completions are always delivered to CPU 0. A process
blocked on another CPU could consequently fail to wake; their Blink/Node test
made no block requests until interrupt delivery was changed.

Their patch broadcasts every completion to every active CPU. That recovers
their workload, but is not a good final design: it can run a shared device
handler concurrently on multiple CPUs and amplify interrupts. Treat the report
as confirmation that explicit IRQ routing or affinity is needed, and test block
and console I/O from non-zero CPUs.

#### Section extraction stopped at `data.drop_reasons`

[`linuxontab@9c9922c3`](https://github.com/kilian-ai/linuxontab/commit/9c9922c310867f2c41f747de184d8e9f3aff9859)
reports that the old `sections.pl` terminator `/data\.drop/` also matched a
segment named `data.drop_reasons`. That stopped extraction before percpu data,
so the kernel failed once the network configuration introduced that segment.

This is already fixed in this checkout: `arch/wasm/scripts/sections.pl` now
uses `^\s*data\.drop\b`. Keep a fixture containing `data.drop_reasons` if the
script gains tests.

### Needs upstream reproduction or a different fix

#### Device-tree virtio nodes were not instantiated as platform devices

LinuxOnTab says its generated device tree contained the expected virtio nodes
and the `virtio_wasm` driver was built, but the driver never probed. Calling
`of_platform_populate()` during `setup_arch()` hung; an unpublished
`subsys_initcall` that populated the tree later allowed the system to boot and
probe the devices. See commits
[`06464d11`](https://github.com/kilian-ai/linuxontab/commit/06464d11c257845905a84f3f71557d00a53c2f01)
and [`cda0da6e`](https://github.com/kilian-ai/linuxontab/commit/cda0da6e70b7792b44f0e4de991db356196a7a3f).

The source patch was not published, and standard OF code already has an
`arch_initcall_sync` population path. Reproduce this with `CONFIG_NET` and
multiple virtio devices before adopting an architecture-specific second
population call. It may be an initcall ordering or configuration problem rather
than missing population in general.

#### Full network configuration overflowed percpu/vmalloc state with SMP

The same LinuxOnTab investigation forced `cpus: 1`, saying multiple CPUs plus
the larger network-enabled kernel caused a percpu vmalloc overflow. There is no
source patch or minimal reproduction. Test a network-enabled defconfig with
several CPUs and verify section sizing, percpu allocation, and the device-tree
memory limit.

#### Writable virtio block I/O could wedge the browser

LinuxOnTab added a writable `BlockDevice` and successfully mounted an ext4 root
read-write. Later commits made `apk update` read-only or a no-op because both
network fetches and virtio/ext4 writes appeared to wedge the browser. See
[`a946863f`](https://github.com/kilian-ai/linuxontab/commit/a946863f225999ef832887c7465aeadcc00ce6cd)
and [`18bf81e1`](https://github.com/kilian-ai/linuxontab/commit/18bf81e1123dcde45d3b8f39b0410201d55888a7e).

This remains unresolved and deserves a small repeated-write/flush test against
an in-memory block backend. Distinguish a transport completion bug, main-thread
starvation, filesystem behaviour, and storage implementation latency.

#### User-module instantiation failures were swallowed and surfaced as SIGSEGV

LinuxOnTab found that user programs built without `-matomics`,
`-mbulk-memory`, `--shared-memory`, and a maximum memory declared non-shared
imported memory. Instantiating them against the runtime's shared
`WebAssembly.Memory` failed with a `LinkError`; the error was caught, execution
continued with no instance, and the process later died as a misleading
SIGSEGV. [`e3e1fd71`](https://github.com/kilian-ai/linuxontab/commit/e3e1fd71621ae713ac7d02d1b104eb7f8db77740)

The ABI requirements should be documented and enforced by the toolchain, but
the runtime should also fail the exec cleanly and expose the original
instantiation error instead of continuing.

#### Network device descriptor handling had three correctness bugs

LinuxOnTab's compiled `NetworkDevice` initially used a 10-byte RX header,
dropped frames when the guest had not supplied descriptors, and released TX
chains with a written length of zero. Its later fix:

- uses the 12-byte mergeable RX header expected by the guest and sets
  `num_buffers = 1`;
- queues frames until RX descriptors become available; and
- releases TX chains with their actual consumed length.

The same commit also fixes several bugs in its browser-side TCP implementation:
reversed packet direction, missing ACKs, duplicate SYN handling, and retransmit
forwarding. [`84cd4bff`](https://github.com/kilian-ai/linuxontab/commit/84cd4bff268a71f14bf8653422c2f83d64d6657c)

The virtio parts should inform an upstream network-device implementation and
tests. The hand-written TCP/SLIRP fixes belong to the consumer transport.

#### Console reset accumulated input handlers and stale readers

LinuxOnTab's reset path registered another `term.onData()` callback on every
boot and left the old `bootConsole` reader alive. Keystrokes were sent multiple
times and old boots continued writing into the terminal. It fixed this by
disposing the old input subscription and cancelling the reader loop.
[`12c07b3c`](https://github.com/kilian-ai/linuxontab/commit/12c07b3c69b397ba4fcf89002e86c2fe7c868fe7)

This is consumer code, but the host library could make machine disposal and
stream cancellation explicit so every embedding does not rediscover it.

#### Ctrl-C did not signal foreground processes without a controlling TTY

Two LinuxOnTab iterations first used `setsid` and finally `getty` so opening
`hvc0` establishes a controlling terminal and calls `TIOCSCTTY`. Previously
`^C` echoed but `tty->ctrl.pgrp` was empty, so no SIGINT reached the foreground
process. See [`c790b5f7`](https://github.com/kilian-ai/linuxontab/commit/c790b5f7fce49f84607dd26ffd42d50147feaa9a)
and [`f10fed61`](https://github.com/kilian-ai/linuxontab/commit/f10fed6102e0469e93c44b90c71c62df04eb2723).

This is primarily an initramfs integration requirement. The example image and
documentation should start the console through `getty` rather than a bare PID
1 shell.

#### Asyncify-based `fork()` hangs at nesting depth three

LinuxOnTab implements `fork()` and `vfork()` outside the unpublished kernel
source by intercepting sentinel syscalls in the worker runtime. It Asyncify-
unwinds the parent, copies its entire linear memory, invokes kernel `clone`,
then rewinds parent and child to the call site. Their custom package manager
works around a repeatable hang when pipelines or substitutions create fork
nesting depth three or greater. See
[`1f593bf6`](https://github.com/kilian-ai/linuxontab/commit/1f593bf6b4932480b433b7b0b58b3f277f26678a),
[`4856fb2d`](https://github.com/kilian-ai/linuxontab/commit/4856fb2d6b287ef891ce73871b78041386428a56),
and [`b1849039`](https://github.com/kilian-ai/linuxontab/commit/b1849039ce8037de73de2e54ec1713800670d355).

This is useful evidence that real software needs `fork`, but the implementation
is experimental: `vfork` is not given true parent-suspension/shared-memory
semantics, every process needs an Asyncify transform and 128 KiB buffer, and
deep forks hang. Do not take it as a kernel fix without first defining the
process-memory and continuation ABI.

### Downstream and toolchain bugs worth tracking

- LinuxOnTab fixed a BusyBox hush NO-MMU pipe bug by passing `&next_infd`
  rather than the new pipe's read end for the first command. Pipelines such as
  `echo hello | cat` had hung. This belongs in the WASM BusyBox fork.
  [`7b5cb89d`](https://github.com/kilian-ai/linuxontab/commit/7b5cb89dea3f60b385d274deb8825a81107af6cd)
- Direct BusyBox HTTPS consumed roughly 100% CPU and froze the tab. LinuxOnTab
  eventually proxied TLS through browser `fetch()` and made guest HTTP plain.
  This is partly crypto performance and partly a missing host-networking
  facility, not a kernel correctness fix.
  [`a80812e7`](https://github.com/kilian-ai/linuxontab/commit/a80812e73175ca3d00153a967c631482ab41d7ae)
- User binaries that were not transformed with `wasm-opt --asyncify` hung on
  blocking operations. LinuxOnTab now transforms staged executables and
  preserves their execute bits. The build should make this ABI property
  explicit and machine-checkable.
  [`f1788c28`](https://github.com/kilian-ai/linuxontab/commit/f1788c2814e87099f203bf491c57d369d83083f9)
- Their WISP integration found several transport-specific failures: CONNECT
  ports must be little-endian, UDP/53 is unavailable on their Fly backend,
  raw destination IPs may be blocked, and IPv6/IPv4-mapped accepts are
  unreliable in their stack. These are useful networking tests but not all are
  properties of the kernel.

## Feature requests

### End-to-end networking

Networking is the strongest repeated request.

[`JoyciAkira/linux@839f8416`](https://github.com/JoyciAkira/linux/commit/839f8416f6749839d7988506d979fadf6dcf0142)
adds a host-side virtio-net device and an Ethernet-frame bridge interface, but
only supplies a loopback bridge. LinuxOnTab independently built a more complete
stack: `CONFIG_NET`/`CONFIG_VIRTIO_NET`, a host `NetworkDevice`, ARP gateway,
TCP over WISP v1, DNS over DoH, ICMP echo replies, static guest configuration,
and inbound TCP tunnel injection. The first integration is described in
[`95a222b6`](https://github.com/kilian-ai/linuxontab/commit/95a222b6c3c08448d5ae99aeeda0e8db768090cc).

An upstream milestone should include:

- the guest networking defconfig;
- a tested virtio-net host device with RX backpressure;
- a transport-neutral Ethernet-frame interface;
- at least one supported browser transport;
- DNS and HTTPS guidance; and
- tests for TCP, UDP/DNS, ICMP, large transfers, reconnect, and non-zero CPUs.

The browser transport need not be the hand-written TCP implementation in
LinuxOnTab, but consumers should not need to implement virtio framing again.

### Writable persistent block storage and a real root filesystem

LinuxOnTab boots through an initramfs into a writable 64 MiB ext4 image and an
Alpine-like filesystem, using `BlockDevice` write and flush callbacks. It then
adds BusyBox, SQLite, Dropbear, an `apk`-like package registry, and a repeatable
rootfs build. [`8475f4f6`](https://github.com/kilian-ai/linuxontab/commit/8475f4f65f825013b7d56bbbb021547bf8c93b3f)

The immediate request is a well-tested writable block backend. Longer term,
persistent browser storage (OPFS or the File System API) and a documented
rootfs build path would make the project usable as more than a boot demo.

### POSIX timers in the default usable configuration

LinuxOnTab rebuilt with `CONFIG_POSIX_TIMERS=y` so `timer_create`,
`setitimer`, `alarm`, and time-based commands work; `ping -c N` then observed
its one-second intervals. [`789a424e`](https://github.com/kilian-ai/linuxontab/commit/789a424e5384434f031e5c9a8190ad1f0f6a974f)

The current defconfig still disables POSIX timers. Enable them unless there is
a known architecture limitation, and include sleep/alarm/timer tests.

### Supported `fork()`/`vfork()` semantics

LinuxOnTab's Asyncify experiment is strong demand from shells, package tools,
inetd, Dropbear, and SFTP. It also demonstrates the cost and complexity of
leaving continuations entirely to each consumer. A roadmap decision is needed:

- support a defined Asyncify continuation ABI;
- wait for and use a WebAssembly stack-switching/continuation facility; or
- explicitly support only `clone`-style applications and provide porting
  guidance.

Whichever direction is chosen should specify memory copying/sharing, file and
credential inheritance, parent suspension for `vfork`, nested forks, error
propagation, and toolchain transforms.

### `setjmp`/`longjmp` runtime support

LinuxOnTab adds an Emscripten-style SJLJ runtime and JavaScript `invoke_*` /
`emscripten_longjmp` imports for programs built with
`--enable-emscripten-sjlj`. This enables parsers, shells, and other software
that uses non-local jumps. [`96ab250f`](https://github.com/kilian-ai/linuxontab/commit/96ab250ffdc5093f172cd3d48d0caa12a414ff05)

This belongs in the supported libc/toolchain/runtime ABI rather than being
copied into each application.

### Multi-user credentials and SSH/SFTP workloads

Because the defconfig has `CONFIG_MULTIUSER=n`, LinuxOnTab found the user/group
syscalls needed by Dropbear returned `ENOSYS`. It binary-patched twelve kernel
stubs and several Dropbear operations to return success, eventually bringing
up SSH and SFTP. [`1206bd9f`](https://github.com/kilian-ai/linuxontab/commit/1206bd9f14140a265d4654968a7bdde537c87d74)

Returning success without changing credentials is not safe or correct and
must not be adopted. The feature request is to enable `CONFIG_MULTIUSER` and
test the actual credential syscalls, or document that the port is permanently
single-user and provide applications with an explicit, honest compatibility
mode.

### Guest-to-host capabilities

[`Mabbs/linux-source`](https://github.com/Mabbs/linux-source) proposes
[`/dev/jsexec`](https://github.com/tombl/linux/pull/24): guest userspace writes
JavaScript that is evaluated in the browser's main-thread context and reads
back its result. Follow-up commits copy out of `SharedArrayBuffer` before
decoding and delegate worker execution to the main thread for DOM access.

This demonstrates demand for browser integration, but an unrestricted,
world-writable `eval()` device with DOM and local-storage authority should not
be enabled by default. Prefer an opt-in capability/RPC device with operations
registered by the embedding application, request IDs, bounded data, per-open
state, cancellation, and no ambient DOM authority.

LinuxOnTab's browser TLS gateway and inbound TCP bridge reinforce the same
request. Existing roadmap ideas such as vsock and `/dev/fetch` are safer
foundations than arbitrary evaluation.

### Process and syscall observability

JoyciAkira's `feature/sr010-process-observability` branch adds run identity,
monotonic event sequencing, WASM exec, clone/worker, task-death and signal
events, a host callback, and an opt-in syscall trace ring. This was used to
localize deterministic Node/Blink failures.

The debugging need is real. If adopted, keep it optional and build it as a
general tracing API with a stable event schema rather than unconditional
product-specific hooks.

### Deployment support

Mabbs' independent
[`GitHub Pages deployment`](https://github.com/Mabbs/linux) and
[`write-up`](https://github.com/Mabbs/mabbs.github.io/blob/main/_posts/2025-12-01-linux.md)
found that the port worked on Safari, but GitHub Pages initially failed because
it did not supply COOP/COEP headers. Both Mabbs and LinuxOnTab added
`coi-serviceworker` so `SharedArrayBuffer` works on a static host.

Publish a supported deployment recipe covering real COOP/COEP headers, a
service-worker fallback, cache busting of WASM/rootfs artifacts, and Chromium
and Safari smoke tests. The host library should also define a clean
boot/reset/dispose lifecycle for workers and console streams.

### Reproducible userspace and package builds

LinuxOnTab consumes `tombl/distro` to build BusyBox, SQLite, Dropbear and its
musl sysroot, then adds a Makefile, rootfs staging tree, package repacker, and
CI. Its work exposed required properties which should be encoded by the
official toolchain rather than remembered by consumers:

- the `wasm32-unknown-linux-musl` target;
- shared imported memory with atomics and an explicit maximum;
- any required Asyncify or SJLJ transforms;
- preservation of executable modes;
- ABI validation before packaging; and
- useful instantiation diagnostics.

### Linux 7.x, wasm64, KUnit, and configuration coverage

[`joelseverin/linux-wasm`](https://github.com/joelseverin/linux-wasm/blob/master/README.md)
is an independent port whose current Linux 7.0 work aims to combine the best
parts of both implementations. It reports wasm32 and experimental wasm64
support, allnoconfig/allyesconfig builds, and passing KUnit tests, while still
lacking this port's virtio and device-tree features.

Coordinate on rebasing, wasm64, KUnit, and configuration correctness rather
than duplicating them independently.

## Fork inventory

All visible branches were compared against `tombl/linux:wasm`.

| Fork | Branches inspected | Distinct downstream work |
|---|---|---|
| [`Mabbs/linux-source`](https://github.com/Mabbs/linux-source) | `wasm` | Three commits: `/dev/jsexec` and two fixes to it |
| [`JoyciAkira/linux`](https://github.com/JoyciAkira/linux) | `wasm`, `wasm-m114b2`, `wasm-m114-runtime-io-fixes`, `wasm-m114-node-verifier`, `feature/sr010-process-observability`, `codex/r5-virtio-net` | Sixteen-commit union: heap and virtio fixes, Node/Blink verification, tracing, process events, and virtio-net |
| [`moon-jam/tombl-linux`](https://github.com/moon-jam/tombl-linux) | `wasm` | Adds manual `workflow_dispatch` to CI |
| [`Zubnix/linux-wasm-port`](https://github.com/Zubnix/linux-wasm-port) | `wasm` | One old standalone Vite runner experiment plus merge commits; superseded by `tools/wasm` |
| [`Apothic-AI/tombl-linux`](https://github.com/Apothic-AI/tombl-linux) | `wasm` | No unique commits |
| [`ScriptedAlchemy/linux`](https://github.com/ScriptedAlchemy/linux) | `wasm` | No unique commits |
| [`devdoshi/linux`](https://github.com/devdoshi/linux) | `wasm` | No unique commits |
| [`oscarhermoso/tombl-linux`](https://github.com/oscarhermoso/tombl-linux) | `wasm` | No unique commits |

The JoyciAkira branches are cumulative rather than six separate patch sets.
The `wasm-m114b2` work grows into runtime-I/O fixes and the Node verifier;
`feature/sr010-process-observability` adds telemetry; and
`codex/r5-virtio-net` adds the network prototype.

## How downstreams are using the port

- JoyciAkira runs real Node.js under a WASM build of the Blink x86-64 emulator.
  That stresses large binaries and heaps, block and console I/O, multicore wake
  ups, deterministic browser automation, and process/syscall debugging.
- LinuxOnTab is attempting a browser-local Linux environment with networking,
  writable ext4, a package manager, SQLite, SSH/SFTP, and inbound port tunnels.
  Its kernel source is ignored and unpublished, but its 61 integration commits,
  compiled JavaScript runtime, binaries, and build scripts expose the findings
  above. No exact kernel source revision or auditable source diff is available.
- Mabbs deployed the project to GitHub Pages, tested Safari, and wants direct
  guest access to browser facilities.
- The OCaml.org WASM roundup highlights the port's Worker-based SMP, virtio,
  architecture glue, and educational value.

The consistent direction is from a kernel demonstration toward a browser
application platform. The recurring needs are networking, reliable memory and
I/O under realistic workloads, a reproducible userspace toolchain, host
capabilities, observability, and straightforward static-site deployment.

## Suggested order

1. Take the console-completion and `end_brk` fixes with regression tests.
2. Reproduce and fix multicore IRQ routing, platform population, SMP percpu
   sizing, and writable block-I/O hangs.
3. Land an end-to-end, transport-neutral virtio-net path.
4. Make the supported defconfig usable: timers, networking, and an explicit
   decision on multi-user credentials.
5. Specify the user-module ABI and fail exec cleanly when it is violated.
6. Decide and document the continuation strategy for `fork`, blocking calls,
   and `setjmp`/`longjmp`.
7. Provide persistent storage, deployment recipes, and realistic browser
   integration tests.
8. Design capability-based host integration and optional observability APIs.
9. Coordinate with `joelseverin/linux-wasm` on Linux 7.x, wasm64, KUnit, and
   configuration coverage.
