import { Struct, U16LE, U32LE, U64LE } from "../bytes.ts";
import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
  type VirtqueueChain,
} from "./core.ts";

class VsockConfig extends Struct({ guest_cid: U64LE }) {}

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

const VsockType = { STREAM: 1 } as const;

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

export interface VsockConnection {
  read(): Promise<Uint8Array>;
  readExactly(length: number): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  close(): void;
}

interface VsockConnectionController {
  readonly connection: VsockConnection;
  readonly local_port: number;
  readonly peer_port: number;
  readonly bytes_read: number;
  update_credit(buf_alloc: number, fwd_cnt: number): void;
  enqueue(data: Uint8Array): void;
  close_from_peer(): void;
}

interface VsockConnectionOps {
  send(op: number, flags: number, payload: Uint8Array, fwd_cnt: number): void;
  close(): void;
}

function create_vsock_connection(
  ops: VsockConnectionOps,
  local_port: number,
  peer_port: number,
): VsockConnectionController {
  const read_buffer: Uint8Array[] = [];
  const read_waiters: ((value: Uint8Array) => void)[] = [];
  const credit_waiters: (() => void)[] = [];
  let closed = false;
  let bytes_read = 0;
  let bytes_written = 0;
  let last_credit_update = 0;
  let peer_buf_alloc = DEFAULT_VSOCK_BUF_ALLOC;
  let peer_fwd_cnt = 0;
  let write_tail = Promise.resolve();

  function wake_credit_waiters() {
    while (credit_waiters.length > 0) credit_waiters.shift()!();
  }

  function close_from_peer() {
    if (closed) return;
    closed = true;
    while (read_waiters.length > 0) {
      read_waiters.shift()!(new Uint8Array());
    }
    wake_credit_waiters();
  }

  async function read_chunk(): Promise<Uint8Array> {
    const chunk = read_buffer.shift();
    if (chunk) return chunk;
    if (closed) return new Uint8Array();
    return new Promise((resolve) => read_waiters.push(resolve));
  }

  function consume(length: number) {
    bytes_read = (bytes_read + length) >>> 0;
    const consumed = (bytes_read - last_credit_update) >>> 0;
    if (consumed >= DEFAULT_VSOCK_BUF_ALLOC / 4) {
      last_credit_update = bytes_read;
      ops.send(VsockOp.CREDIT_UPDATE, 0, new Uint8Array(), bytes_read);
    }
  }

  async function read(): Promise<Uint8Array> {
    const chunk = await read_chunk();
    consume(chunk.byteLength);
    return chunk;
  }

  async function readExactly(length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const chunk = await read_chunk();
      if (chunk.byteLength === 0) break;
      const n = Math.min(chunk.byteLength, length - offset);
      out.set(chunk.subarray(0, n), offset);
      offset += n;
      consume(n);
      if (n < chunk.byteLength) {
        read_buffer.unshift(chunk.subarray(n).slice());
      }
    }
    return out.subarray(0, offset);
  }

  async function write_serialized(data: Uint8Array) {
    let offset = 0;
    while (offset < data.byteLength) {
      if (closed) throw new Error("vsock connection is closed");
      const used = (bytes_written - peer_fwd_cnt) >>> 0;
      const available = Math.max(0, peer_buf_alloc - used);
      if (available === 0) {
        await new Promise<void>((resolve) => credit_waiters.push(resolve));
        continue;
      }
      const n = Math.min(
        MAX_VSOCK_PAYLOAD,
        available,
        data.byteLength - offset,
      );
      ops.send(VsockOp.RW, 0, data.subarray(offset, offset + n), bytes_read);
      offset += n;
      bytes_written = (bytes_written + n) >>> 0;
    }
  }

  function write(data: Uint8Array): Promise<void> {
    const bytes = data.slice();
    const result = write_tail.then(() => write_serialized(bytes));
    write_tail = result.catch(() => {});
    return result;
  }

  const connection: VsockConnection = {
    read,
    readExactly,
    write,
    close() {
      if (closed) return;
      ops.close();
      close_from_peer();
    },
  };

  return {
    connection,
    local_port,
    peer_port,
    get bytes_read() {
      return bytes_read;
    },
    update_credit(buf_alloc, fwd_cnt) {
      peer_buf_alloc = buf_alloc;
      peer_fwd_cnt = fwd_cnt;
      wake_credit_waiters();
    },
    enqueue(data) {
      if (closed || data.byteLength === 0) return;
      const waiter = read_waiters.shift();
      if (waiter) waiter(data);
      else read_buffer.push(data.slice());
    },
    close_from_peer,
  };
}

interface VsockConnectionState {
  controller: VsockConnectionController;
  connected: boolean;
  resolve(connection: VsockConnection): void;
  reject(error: Error): void;
}

export interface VsockDevice extends VirtioDevice {
  connect(
    port: number,
    options?: { timeoutMs?: number },
  ): Promise<VsockConnection>;
  close(): void;
}

export function vsockDevice(
  { guestCid = 3n }: { guestCid?: bigint } = {},
): VsockDevice {
  const config = new Uint8Array(VsockConfig.size);
  new VsockConfig(config).guest_cid = guestCid;

  const rx_buffers: VirtqueueChain[] = [];
  const pending_packets: Uint8Array[] = [];
  const connections = new Map<number, VsockConnectionState>();
  let next_port = 49152;
  let closed = false;

  function allocate_port() {
    for (let attempts = 0; attempts < 65536 - 49152; attempts++) {
      const port = next_port;
      next_port = port === 65535 ? 49152 : port + 1;
      if (!connections.has(port)) return port;
    }
    throw new Error("no local vsock ports available");
  }

  function flush_rx(controller: VirtioController) {
    while (pending_packets.length > 0 && rx_buffers.length > 0) {
      const packet = pending_packets.shift()!;
      const chain = rx_buffers.shift()!;
      const [desc, next_desc] = chain;
      assert(desc && desc.writable, "vsock rx buffer must be writable");
      assert(!next_desc, "vsock rx buffer should be a single descriptor");
      assert(
        desc.array.byteLength >= packet.byteLength,
        "vsock rx buffer too small",
      );

      desc.array.set(packet);
      chain.release(packet.byteLength);
    }
  }

  function send_packet(
    controller: VirtioController,
    connection: VsockConnectionController,
    op: number,
    flags: number,
    payload: Uint8Array,
    fwd_cnt = connection.bytes_read,
  ) {
    const packet = new Uint8Array(VsockHeader.size + payload.byteLength);
    const hdr = new VsockHeader(packet);
    hdr.src_cid = HOST_CID;
    hdr.dst_cid = guestCid;
    hdr.src_port = connection.local_port;
    hdr.dst_port = connection.peer_port;
    hdr.len = payload.byteLength;
    hdr.type = VsockType.STREAM;
    hdr.op = op;
    hdr.flags = flags;
    hdr.buf_alloc = DEFAULT_VSOCK_BUF_ALLOC;
    hdr.fwd_cnt = fwd_cnt;
    packet.set(payload, VsockHeader.size);

    pending_packets.push(packet);
    flush_rx(controller);
  }

  function read_tx_packet(chain: VirtqueueChain) {
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

  function handle_tx_packet(
    controller: VirtioController,
    header: VsockHeader,
    payload: Uint8Array,
  ) {
    const local_port = header.dst_port;
    const state = connections.get(local_port);
    if (!state) return;

    const connection = state.controller;
    connection.update_credit(header.buf_alloc, header.fwd_cnt);

    switch (header.op) {
      case VsockOp.RESPONSE:
        state.connected = true;
        state.resolve(connection.connection);
        break;
      case VsockOp.RW:
        connection.enqueue(payload);
        break;
      case VsockOp.CREDIT_UPDATE:
        break;
      case VsockOp.CREDIT_REQUEST:
        send_packet(
          controller,
          connection,
          VsockOp.CREDIT_UPDATE,
          0,
          new Uint8Array(),
        );
        break;
      case VsockOp.SHUTDOWN:
        send_packet(controller, connection, VsockOp.RST, 0, new Uint8Array());
        if (!state.connected) {
          state.reject(new Error("guest shut down vsock connection"));
        }
        connection.close_from_peer();
        connections.delete(local_port);
        break;
      case VsockOp.RST:
        if (!state.connected) {
          state.reject(new Error("guest reset vsock connection"));
        }
        connection.close_from_peer();
        connections.delete(local_port);
        break;
      default:
        console.warn("unknown vsock op", header.op);
    }
  }

  function notify_rx(queue: Virtqueue, controller: VirtioController) {
    for (const chain of queue) rx_buffers.push(chain);
    flush_rx(controller);
  }

  function notify_tx(queue: Virtqueue, controller: VirtioController) {
    for (const chain of queue) {
      const { header, payload } = read_tx_packet(chain);
      handle_tx_packet(controller, header, payload);
      chain.release(0);
    }
  }

  function close_device(controller: VirtioController) {
    if (closed) return;
    for (const state of connections.values()) {
      send_packet(
        controller,
        state.controller,
        VsockOp.RST,
        0,
        new Uint8Array(),
      );
      if (!state.connected) {
        state.reject(new Error("vsock device closed while connecting"));
      }
      state.controller.close_from_peer();
    }
    connections.clear();
    closed = true;
  }

  const controller = new VirtioController(
    { deviceId: 19, config },
    {
      queues: [
        notify_rx,
        notify_tx,
        () => {
          // Event buffers are only needed for host transport reset, which is
          // not supported yet.
        },
      ],
      close: close_device,
    },
  );

  function connect(
    port: number,
    { timeoutMs = 5000 }: { timeoutMs?: number } = {},
  ): Promise<VsockConnection> {
    if (closed) {
      return Promise.reject(new Error("vsock device is closed"));
    }
    const local_port = allocate_port();
    const connection = create_vsock_connection(
      {
        send(op, flags, payload, fwd_cnt) {
          if (closed) return;
          const connection = connections.get(local_port)?.controller;
          if (!connection) return;
          send_packet(controller, connection, op, flags, payload, fwd_cnt);
        },
        close() {
          const connection = connections.get(local_port)?.controller;
          if (!connection) return;
          send_packet(
            controller,
            connection,
            VsockOp.SHUTDOWN,
            VsockShutdown.RCV | VsockShutdown.SEND,
            new Uint8Array(),
          );
        },
      },
      local_port,
      port,
    );

    const promise = new Promise<VsockConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        send_packet(controller, connection, VsockOp.RST, 0, new Uint8Array());
        connections.delete(local_port);
        connection.close_from_peer();
        reject(new Error(`timed out connecting to guest vsock port ${port}`));
      }, timeoutMs);

      connections.set(local_port, {
        controller: connection,
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

    send_packet(controller, connection, VsockOp.REQUEST, 0, new Uint8Array());
    return promise;
  }

  return controller.expose({ connect, close: controller.close });
}
