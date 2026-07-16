import {
  FixedArray,
  Struct,
  type Type,
  U16LE,
  U32LE,
  U64LE,
  U8,
} from "./bytes.ts";
import { assert } from "./util.ts";
import type { Imports } from "./wasm.ts";

const TransportFeatures = {
  VERSION_1: 1n << 32n,
  RING_PACKED: 1n << 34n,
  INDIRECT_DESC: 1n << 28n,
} as const;

const DescriptorFlags = {
  NEXT: 1 << 0,
  WRITE: 1 << 1,
  INDIRECT: 1 << 2,
  AVAIL: 1 << 7,
  USED: 1 << 15,
} as const;

class VirtqDescriptor extends Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE,
}) {}

class Chain {
  #mem: DataView;
  #queue: Virtqueue;
  id: number;
  skip: number;
  desc: VirtqDescriptor[];

  constructor(
    mem: DataView,
    queue: Virtqueue,
    id: number,
    skip: number,
    desc: VirtqDescriptor[],
  ) {
    this.#mem = mem;
    this.#queue = queue;
    this.id = id;
    this.skip = skip;
    this.desc = desc;
  }

  release(written: number) {
    const queue = this.#queue;
    const desc = queue.desc[queue.used_idx];
    assert(desc);
    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== queue.used_wrap) {
      throw new Error("ring full");
    }

    let flags = 0;
    if (queue.used_wrap) flags |= DescriptorFlags.AVAIL | DescriptorFlags.USED;
    if (written > 0) flags |= DescriptorFlags.WRITE;

    desc.id = this.id;
    desc.len = written;
    desc.flags = flags;

    queue.used_idx += this.skip;
    if (queue.used_idx >= queue.size) {
      queue.used_idx -= queue.size;
      queue.used_wrap = !queue.used_wrap;
    }
  }

  *[Symbol.iterator]() {
    for (const desc of this.desc) {
      yield {
        array: new Uint8Array(this.#mem.buffer, Number(desc.addr), desc.len),
        writable: (desc.flags & DescriptorFlags.WRITE) !== 0,
      };
    }
  }
}

class Virtqueue {
  #mem: DataView;

  size: number;
  desc: VirtqDescriptor[];
  avail_wrap = true;
  used_wrap = true;
  used_idx = 0;
  avail_idx = 0;

  constructor(mem: DataView, size: number, desc_addr: number) {
    assert(size !== 0);
    assert(mem.byteOffset === 0);
    this.#mem = mem;
    this.size = size;
    this.desc = FixedArray(VirtqDescriptor, size).get(mem, desc_addr);
  }

  #pop() {
    let i = this.#advance();
    if (i === null) return null;
    const head = i;

    let desc = this.desc[i];
    assert(desc);

    const chain = new Chain(
      this.#mem,
      this,
      desc.id,
      1,
      this.desc.slice(head, i + 1),
    );

    if (desc.flags & DescriptorFlags.NEXT) {
      do {
        i = this.#advance();
        if (i === null) throw new Error("no next descriptor is available");
        desc = this.desc[i];
        assert(desc);
      } while (desc.flags & DescriptorFlags.NEXT);
      chain.skip = i - head + 1;
      chain.desc = this.desc.slice(head, i + 1);
    } else if (desc.flags & DescriptorFlags.INDIRECT) {
      if (desc.len % VirtqDescriptor.size !== 0) {
        throw new Error("malformed indirect buffer");
      }
      chain.desc = FixedArray(
        VirtqDescriptor,
        desc.len / VirtqDescriptor.size,
      ).get(this.#mem, Number(desc.addr));
    }

    return chain;
  }

  *[Symbol.iterator]() {
    let chain;
    while ((chain = this.#pop())) yield chain;
  }

  #advance() {
    const desc = this.desc[this.avail_idx];
    assert(desc);

    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== this.avail_wrap) return null;

    const index = this.avail_idx;
    this.avail_idx += 1;
    if (this.avail_idx >= this.size) {
      this.avail_idx = 0;
      this.avail_wrap = !this.avail_wrap;
    }
    return index;
  }
}

export interface VirtqueueState {
  queue: Virtqueue | undefined;
  /** A kernel notification arrived while a notify() call was in flight. */
  pending: boolean;
  notifying: boolean;
}

export abstract class VirtioDevice<Config extends object = object> {
  abstract readonly ID: number;
  abstract config_bytes: Uint8Array;
  abstract config: Config;

  features = TransportFeatures.VERSION_1 |
    TransportFeatures.RING_PACKED |
    TransportFeatures.INDIRECT_DESC;

  trigger_interrupt = (kind: "config" | "vring"): void => {
    // this function is overwritten on device setup
    void kind;
    throw new Error("trigger_interrupt called before setup");
  };

  /** Slots are created lazily: the kernel may notify a queue before enabling it. */
  vqs: VirtqueueState[] = [];
  vq(n: number): VirtqueueState {
    return (this.vqs[n] ??= {
      queue: undefined,
      pending: false,
      notifying: false,
    });
  }
  enable(vq: number, queue: Virtqueue) {
    this.vq(vq).queue = queue;
  }
  disable(vq: number) {
    const state = this.vqs[vq];
    assert(state?.queue);
    state.queue = undefined;
  }
  abstract notify(vq: number): void | PromiseLike<void>;

  setup_complete() {}
  close() {}
}

class EmptyStruct extends Struct({}) {}

class VsockConfig extends Struct({
  guest_cid: U64LE,
}) {}

class VsockHeader extends Struct({
  src_cid: U64LE,
  dst_cid: U64LE,
  src_port: U32LE,
  dst_port: U32LE,
  len: U32LE,
  type: U16LE,
  op: U16LE,
  flags: U32LE,
  buf_alloc: U32LE,
  fwd_cnt: U32LE,
}) {}

const VsockType = {
  STREAM: 1,
} as const;

const VsockOp = {
  REQUEST: 1,
  RESPONSE: 2,
  RST: 3,
  SHUTDOWN: 4,
  RW: 5,
  CREDIT_UPDATE: 6,
  CREDIT_REQUEST: 7,
} as const;

const VsockShutdown = {
  RCV: 1,
  SEND: 2,
} as const;

const HOST_CID = 2n;
const DEFAULT_VSOCK_BUF_ALLOC = 256 * 1024;
const MAX_VSOCK_PAYLOAD = 2048;

function concat_bytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class VsockConnection {
  local_port: number;
  peer_port: number;

  #device: VsockDevice;
  #read_buffer: Uint8Array[] = [];
  #read_waiters: ((value: Uint8Array) => void)[] = [];
  #credit_waiters: (() => void)[] = [];
  #closed = false;
  #bytes_read = 0;
  #bytes_written = 0;
  #last_credit_update = 0;
  #peer_buf_alloc = DEFAULT_VSOCK_BUF_ALLOC;
  #peer_fwd_cnt = 0;
  #write_tail = Promise.resolve();

  constructor(device: VsockDevice, local_port: number, peer_port: number) {
    this.#device = device;
    this.local_port = local_port;
    this.peer_port = peer_port;
  }

  get bytes_read() {
    return this.#bytes_read;
  }

  update_credit(buf_alloc: number, fwd_cnt: number) {
    this.#peer_buf_alloc = buf_alloc;
    this.#peer_fwd_cnt = fwd_cnt;
    this.#wake_credit_waiters();
  }

  enqueue(data: Uint8Array) {
    if (this.#closed || data.byteLength === 0) return;
    const waiter = this.#read_waiters.shift();
    if (waiter) {
      waiter(data);
    } else {
      this.#read_buffer.push(data.slice());
    }
  }

  close_from_peer() {
    if (this.#closed) return;
    this.#closed = true;
    while (this.#read_waiters.length > 0) {
      this.#read_waiters.shift()!(new Uint8Array());
    }
    this.#wake_credit_waiters();
  }

  async #read_chunk(): Promise<Uint8Array> {
    const chunk = this.#read_buffer.shift();
    if (chunk) return chunk;
    if (this.#closed) return new Uint8Array();
    return new Promise((resolve) => this.#read_waiters.push(resolve));
  }

  #consume(length: number) {
    this.#bytes_read = (this.#bytes_read + length) >>> 0;
    const consumed = (this.#bytes_read - this.#last_credit_update) >>> 0;
    if (consumed >= DEFAULT_VSOCK_BUF_ALLOC / 4) {
      this.#last_credit_update = this.#bytes_read;
      this.#device.send_credit_update(this);
    }
  }

  async read(): Promise<Uint8Array> {
    const chunk = await this.#read_chunk();
    this.#consume(chunk.byteLength);
    return chunk;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = await this.#read_chunk();
      if (chunk.byteLength === 0) break;
      const n = Math.min(chunk.byteLength, length - offset);
      out.set(chunk.subarray(0, n), offset);
      offset += n;
      this.#consume(n);
      if (n < chunk.byteLength) {
        this.#read_buffer.unshift(chunk.subarray(n).slice());
      }
    }
    return out.subarray(0, offset);
  }

  write(data: Uint8Array): Promise<void> {
    const bytes = data.slice();
    const result = this.#write_tail.then(() => this.#write(bytes));
    this.#write_tail = result.catch(() => {});
    return result;
  }

  async #write(data: Uint8Array) {
    let offset = 0;
    while (offset < data.byteLength) {
      if (this.#closed) throw new Error("vsock connection is closed");
      const used = (this.#bytes_written - this.#peer_fwd_cnt) >>> 0;
      const available = Math.max(0, this.#peer_buf_alloc - used);
      if (available === 0) {
        await new Promise<void>((resolve) =>
          this.#credit_waiters.push(resolve)
        );
        continue;
      }
      const n = Math.min(
        MAX_VSOCK_PAYLOAD,
        available,
        data.byteLength - offset,
      );
      this.#device.send_packet(
        this,
        VsockOp.RW,
        0,
        data.subarray(offset, offset + n),
      );
      offset += n;
      this.#bytes_written = (this.#bytes_written + n) >>> 0;
    }
  }

  #wake_credit_waiters() {
    while (this.#credit_waiters.length > 0) this.#credit_waiters.shift()!();
  }

  close() {
    if (this.#closed) return;
    this.#device.close_connection(this);
    this.close_from_peer();
  }
}

export class VsockDevice extends VirtioDevice<VsockConfig> {
  ID = 19;
  config_bytes = new Uint8Array(VsockConfig.size);
  config = new VsockConfig(this.config_bytes);

  #guest_cid: bigint;
  #rx_buffers: Chain[] = [];
  #pending_packets: Uint8Array[] = [];
  #connections = new Map<
    number,
    {
      connection: VsockConnection;
      connected: boolean;
      resolve: (connection: VsockConnection) => void;
      reject: (error: Error) => void;
    }
  >();
  #next_port = 49152;
  #closed = false;

  constructor({ guestCid = 3n }: { guestCid?: bigint } = {}) {
    super();
    this.#guest_cid = guestCid;
    this.config.guest_cid = guestCid;
  }

  connect(port: number, { timeoutMs = 5000 } = {}): Promise<VsockConnection> {
    if (this.#closed) {
      return Promise.reject(new Error("vsock device is closed"));
    }
    const local_port = this.#allocate_port();
    const connection = new VsockConnection(this, local_port, port);

    const promise = new Promise<VsockConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.send_packet(connection, VsockOp.RST, 0, new Uint8Array());
        this.#connections.delete(local_port);
        connection.close_from_peer();
        reject(new Error(`timed out connecting to guest vsock port ${port}`));
      }, timeoutMs);

      this.#connections.set(local_port, {
        connection,
        connected: false,
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });

    this.send_packet(connection, VsockOp.REQUEST, 0, new Uint8Array());
    return promise;
  }

  #allocate_port() {
    for (let attempts = 0; attempts < 65536 - 49152; attempts++) {
      const port = this.#next_port;
      this.#next_port = port === 65535 ? 49152 : port + 1;
      if (!this.#connections.has(port)) return port;
    }
    throw new Error("no local vsock ports available");
  }

  send_credit_update(connection: VsockConnection) {
    if (!this.#closed) {
      this.send_packet(connection, VsockOp.CREDIT_UPDATE, 0, new Uint8Array());
    }
  }

  close_connection(connection: VsockConnection) {
    if (!this.#connections.has(connection.local_port)) return;
    this.send_packet(
      connection,
      VsockOp.SHUTDOWN,
      VsockShutdown.RCV | VsockShutdown.SEND,
      new Uint8Array(),
    );
  }

  send_packet(
    connection: VsockConnection,
    op: number,
    flags: number,
    payload: Uint8Array,
  ) {
    const packet = new Uint8Array(VsockHeader.size + payload.byteLength);
    const hdr = new VsockHeader(packet);
    hdr.src_cid = HOST_CID;
    hdr.dst_cid = this.#guest_cid;
    hdr.src_port = connection.local_port;
    hdr.dst_port = connection.peer_port;
    hdr.len = payload.byteLength;
    hdr.type = VsockType.STREAM;
    hdr.op = op;
    hdr.flags = flags;
    hdr.buf_alloc = DEFAULT_VSOCK_BUF_ALLOC;
    hdr.fwd_cnt = connection.bytes_read;
    packet.set(payload, VsockHeader.size);

    this.#pending_packets.push(packet);
    this.#flush_rx();
  }

  #flush_rx() {
    let sent = false;
    while (this.#pending_packets.length > 0 && this.#rx_buffers.length > 0) {
      const packet = this.#pending_packets.shift()!;
      const chain = this.#rx_buffers.shift()!;
      const [desc, next_desc] = chain;
      assert(desc && desc.writable, "vsock rx buffer must be writable");
      assert(!next_desc, "vsock rx buffer should be a single descriptor");
      assert(
        desc.array.byteLength >= packet.byteLength,
        "vsock rx buffer too small",
      );

      desc.array.set(packet);
      chain.release(packet.byteLength);
      sent = true;
    }

    if (sent) this.trigger_interrupt("vring");
  }

  #read_tx_packet(chain: Chain) {
    const readable = Array.from(chain, (desc) => {
      assert(!desc.writable, "vsock tx descriptor must be readable");
      return desc.array;
    });
    const header_bytes = concat_bytes(readable);
    assert(header_bytes.byteLength >= VsockHeader.size, "short vsock header");
    const header = new VsockHeader(header_bytes);
    const payload = header_bytes.subarray(
      VsockHeader.size,
      VsockHeader.size + header.len,
    );
    return { header, payload };
  }

  #handle_tx_packet(header: VsockHeader, payload: Uint8Array) {
    const local_port = header.dst_port;
    const state = this.#connections.get(local_port);
    if (!state) return;

    state.connection.update_credit(header.buf_alloc, header.fwd_cnt);

    switch (header.op) {
      case VsockOp.RESPONSE:
        state.connected = true;
        state.resolve(state.connection);
        break;
      case VsockOp.RW:
        state.connection.enqueue(payload);
        break;
      case VsockOp.CREDIT_UPDATE:
        break;
      case VsockOp.CREDIT_REQUEST:
        this.send_credit_update(state.connection);
        break;
      case VsockOp.SHUTDOWN:
        this.send_packet(state.connection, VsockOp.RST, 0, new Uint8Array());
        if (!state.connected) {
          state.reject(new Error("guest shut down vsock connection"));
        }
        state.connection.close_from_peer();
        this.#connections.delete(local_port);
        break;
      case VsockOp.RST:
        if (!state.connected) {
          state.reject(new Error("guest reset vsock connection"));
        }
        state.connection.close_from_peer();
        this.#connections.delete(local_port);
        break;
      default:
        console.warn("unknown vsock op", header.op);
    }
  }

  override close() {
    if (this.#closed) return;
    for (const state of this.#connections.values()) {
      this.send_packet(state.connection, VsockOp.RST, 0, new Uint8Array());
      if (!state.connected) {
        state.reject(new Error("vsock device closed while connecting"));
      }
      state.connection.close_from_peer();
    }
    this.#connections.clear();
    this.#closed = true;
  }

  override notify(vq: number) {
    const queue = this.vqs[vq]?.queue;
    assert(queue);

    switch (vq) {
      case 0:
        for (const chain of queue) this.#rx_buffers.push(chain);
        this.#flush_rx();
        break;
      case 1:
        for (const chain of queue) {
          const { header, payload } = this.#read_tx_packet(chain);
          this.#handle_tx_packet(header, payload);
          chain.release(0);
        }
        this.trigger_interrupt("vring");
        break;
      case 2:
        // TODO: event buffers are needed for host transport reset
        // notifications. We do not emit those until the host side supports
        // device-wide reset and reconnect semantics.
        break;
      default:
        console.error("VsockDevice: unknown vq", vq);
    }
  }
}

const BlockDeviceFeatures = {
  RO: 1n << 5n,
  FLUSH: 1n << 9n,
} as const;

class BlockDeviceConfig extends Struct({
  capacity: U64LE,
}) {}

class BlockDeviceRequest extends Struct({
  type: U32LE,
  reserved: U32LE,
  sector: U64LE,
}) {}

const BlockDeviceRequestType = {
  IN: 0,
  OUT: 1,
  FLUSH: 4,
  GET_ID: 8,
} as const;

const BlockDeviceStatus = {
  OK: 0,
  IOERR: 1,
  UNSUPP: 2,
} as const;

type MaybePromise<T> = T | Promise<T>;
export interface BlockDeviceStorage {
  read(offset: number, length: number): MaybePromise<Uint8Array>;
  write?(offset: number, data: Uint8Array): MaybePromise<number>;
  flush?(): MaybePromise<void>;
  capacity: number;
}

export class BlockDevice extends VirtioDevice<BlockDeviceConfig> {
  ID = 2;
  config_bytes = new Uint8Array(BlockDeviceConfig.size);
  config = new BlockDeviceConfig(this.config_bytes);

  #storage: BlockDeviceStorage;

  constructor(storage: BlockDeviceStorage) {
    super();
    this.#storage = storage;

    if (storage.flush) this.features |= BlockDeviceFeatures.FLUSH;
    if (!storage.write) this.features |= BlockDeviceFeatures.RO;

    this.config.capacity = BigInt(storage.capacity / 512);
  }

  override async notify(vq: number) {
    assert(vq === 0);

    const queue = this.vqs[vq]?.queue;
    assert(queue);

    for (const chain of queue) {
      const descs = [...chain];
      const header = descs[0];
      const status = descs[descs.length - 1];
      const data = descs.slice(1, -1);

      assert(header && !header.writable, "header must be readonly");
      assert(
        header.array.byteLength === BlockDeviceRequest.size,
        `header size is ${header.array.byteLength}`,
      );
      assert(status && status.writable, "status must be writable");
      assert(
        status.array.byteLength === 1,
        `status size is ${status.array.byteLength}`,
      );
      const status_desc = status;

      const request = new BlockDeviceRequest(header.array);

      function set_status(value: number) {
        status_desc.array[0] = value;
      }

      let n = 0;
      let offset = Number(request.sector) * 512;
      switch (request.type) {
        case BlockDeviceRequestType.IN: {
          for (const desc of data) {
            assert(desc.writable, "data must be writable when IN");
            const arr = await this.#storage.read(offset, desc.array.byteLength);
            desc.array.set(arr);
            n += arr.byteLength;
            offset += arr.byteLength;
          }
          set_status(BlockDeviceStatus.OK);
          break;
        }
        case BlockDeviceRequestType.OUT: {
          if (!this.#storage.write) {
            set_status(BlockDeviceStatus.UNSUPP);
            break;
          }
          let ok = true;
          for (const desc of data) {
            assert(!desc.writable, "data must be readonly when OUT");
            const written = await this.#storage.write(offset, desc.array);
            if (written !== desc.array.byteLength) {
              ok = false;
              break;
            }
            n += written;
            offset += written;
          }
          set_status(ok ? BlockDeviceStatus.OK : BlockDeviceStatus.IOERR);
          break;
        }
        case BlockDeviceRequestType.FLUSH: {
          if (!this.#storage.flush) {
            set_status(BlockDeviceStatus.UNSUPP);
            break;
          }
          await this.#storage.flush();
          set_status(BlockDeviceStatus.OK);
          break;
        }
        case BlockDeviceRequestType.GET_ID: {
          console.log("GET_ID");
          set_status(BlockDeviceStatus.OK);
          break;
        }
        default:
          console.error("unknown request type", request.type);
          set_status(BlockDeviceStatus.UNSUPP);
      }

      chain.release(n);
    }
    this.trigger_interrupt("vring");
  }
}

export class ConsoleDevice extends VirtioDevice<EmptyStruct> {
  ID = 3;
  config_bytes = new Uint8Array(0);
  config = new EmptyStruct(this.config_bytes);

  #input: ReadableStream<Uint8Array>;
  #output: WritableStreamDefaultWriter<Uint8Array>;
  constructor(
    input: ReadableStream<Uint8Array>,
    output: WritableStream<Uint8Array>,
  ) {
    super();
    this.#input = input;
    this.#output = output.getWriter();
  }

  #writing: Promise<void> | null = null;
  async #writer(queue: Virtqueue) {
    const queue_iter = queue[Symbol.iterator]();
    const reader = this.#input.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let chunk = value;

      while (chunk.length > 0) {
        const chain = queue_iter.next().value;
        if (!chain) {
          console.warn("no more descriptors, dropping console input");
          break;
        }

        const [desc, trailing] = chain;
        assert(desc && desc.writable, "receiver must be writable");
        assert(!trailing, "too many descriptors");

        const n = Math.min(chunk.length, desc.array.byteLength);
        desc.array.set(chunk.subarray(0, n));
        chunk = chunk.subarray(n);
        chain.release(n);
      }
      this.trigger_interrupt("vring");
    }
  }

  override async notify(vq: number) {
    const queue = this.vqs[vq]?.queue;
    assert(queue);

    switch (vq) {
      case 0:
        this.#writing ??= this.#writer(queue);
        break;
      case 1:
        for (const chain of queue) {
          let n = 0;
          for (const { array, writable } of chain) {
            assert(!writable, "transmitter must be readable");
            await this.#output.write(array);
            n += array.byteLength;
          }
          chain.release(n);
        }
        break;
      default:
        console.error("ConsoleDevice: unknown vq", vq);
    }
  }
}

export class EntropyDevice extends VirtioDevice<EmptyStruct> {
  ID = 4;
  config_bytes = new Uint8Array(0);
  config = new EmptyStruct(this.config_bytes);

  override notify(vq: number) {
    assert(vq === 0);

    const queue = this.vqs[vq]?.queue;
    assert(queue);

    for (const chain of queue) {
      let n = 0;
      for (const { array, writable } of chain) {
        assert(writable);

        // can't use crypto.getRandomValues on a SharedArrayBuffer
        const arr = new Uint8Array(array.length);
        crypto.getRandomValues(arr);
        array.set(arr);

        n += array.byteLength;
      }
      chain.release(n);
    }

    this.trigger_interrupt("vring");
  }
}

export function virtio_imports({
  memory,
  devices,
  trigger_irq_for_cpu,
  on_error,
}: {
  memory: WebAssembly.Memory;
  devices: readonly VirtioDevice[];
  trigger_irq_for_cpu: (cpu: number, irq: number) => void;
  on_error: (error: unknown) => void;
}): Imports["virtio"] {
  const dv = new DataView(memory.buffer);

  const drain_notifications = async (device: VirtioDevice, vq: number) => {
    const state = device.vq(vq);
    if (state.notifying || !state.queue) return;

    state.notifying = true;
    try {
      do {
        state.pending = false;
        await device.notify(vq);
      } while (state.pending && state.queue);
    } catch (error) {
      on_error(error);
    } finally {
      state.notifying = false;
    }
  };

  return {
    set_features(dev, features) {
      const device = devices[dev];
      assert(device);
      assert(
        device.features === features,
        "the kernel should accept every feature we offer, and no more",
      );
    },

    enable_vring(dev, vq, size, desc_addr) {
      const device = devices[dev];
      assert(device);
      device.enable(vq, new Virtqueue(dv, size, desc_addr));
      if (device.vq(vq).pending) void drain_notifications(device, vq);
    },
    disable_vring(dev, vq) {
      const device = devices[dev];
      assert(device);
      device.disable(vq);
    },

    setup(dev, irq, is_config_addr, is_vring_addr, config_addr, config_len) {
      const device = devices[dev];
      assert(device);

      const config_type = device.config.constructor as unknown as Type<object>;
      assert(config_len >= config_type.size, "config space too small");

      const new_config_bytes = new Uint8Array(
        dv.buffer,
        config_addr,
        config_len,
      );
      new_config_bytes.set(device.config_bytes);
      device.config_bytes = new_config_bytes;
      device.config = config_type.get(dv, config_addr);

      device.trigger_interrupt = (kind) => {
        U8.set(dv, is_config_addr, kind === "config" ? 1 : 0);
        U8.set(dv, is_vring_addr, kind === "vring" ? 1 : 0);
        trigger_irq_for_cpu(0, irq); // TODO: balance?
      };

      device.setup_complete();
    },

    notify(dev, vq) {
      const device = devices[dev];
      assert(device);
      device.vq(vq).pending = true;
      void drain_notifications(device, vq);
    },
  };
}
