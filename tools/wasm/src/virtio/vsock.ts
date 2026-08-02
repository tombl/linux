// SPDX-License-Identifier: MIT

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
/**
 * Local ports for host-initiated connections come from [2**30, 2**31), so
 * they can never collide with listeners, which must bind below the range.
 * The fixed 01 prefix also marks these ports as host-allocated in traces.
 */
const EPHEMERAL_PORT_BASE = 1 << 30;

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

/** A stream connection between this process and a guest, over vsock. */
export interface VsockConnection {
  /** Reads the next chunk; an empty chunk means the peer closed. */
  read(): Promise<Uint8Array>;
  /** Reads `length` bytes, or fewer if the peer closes first. */
  readExactly(length: number): Promise<Uint8Array>;
  /** Writes data, waiting for credit when the peer's buffer is full. */
  write(data: Uint8Array): Promise<void>;
  /** Closes the connection. */
  close(): void;
}

interface VsockConnectionController {
  readonly connection: VsockConnection;
  readonly local_port: number;
  readonly peer_port: number;
  readonly bytes_read: number;
  update_credit(buf_alloc: number, fwd_cnt: number): void;
  enqueue(data: Uint8Array): void;
  end_from_peer(): void;
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
  let read_ended = false;
  let bytes_read = 0;
  let bytes_written = 0;
  let last_credit_update = 0;
  let peer_buf_alloc = DEFAULT_VSOCK_BUF_ALLOC;
  let peer_fwd_cnt = 0;
  let write_tail = Promise.resolve();

  function wake_credit_waiters() {
    while (credit_waiters.length > 0) credit_waiters.shift()!();
  }

  function end_from_peer() {
    if (closed || read_ended) return;
    read_ended = true;
    while (read_waiters.length > 0) {
      read_waiters.shift()!(new Uint8Array());
    }
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
    if (closed || read_ended) return new Uint8Array();
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
      if (closed || read_ended || data.byteLength === 0) return;
      const waiter = read_waiters.shift();
      if (waiter) waiter(data);
      else read_buffer.push(data.slice());
    },
    end_from_peer,
    close_from_peer,
  };
}

interface VsockConnectionState {
  controller: VsockConnectionController;
  connected: boolean;
  peer_shutdown: number;
  resolve?(connection: VsockConnection): void;
  reject?(error: Error): void;
}

interface VsockListenerState {
  dispatch(key: string, connection: VsockConnection): void;
  close(): void;
}

/** A listener for guest-initiated vsock connections on one port. */
export interface VsockListener {
  /** The port this listener is bound to. */
  readonly port: number;
  /** Unbinds the port; new connection attempts are reset. */
  close(): void;
  /** Resolves once the listener is closed and every handler has settled. */
  readonly finished: Promise<void>;
}

/**
 * A virtio-vsock device: stream sockets between the guest and this process,
 * addressed by port.
 */
export interface VsockDevice extends VirtioDevice {
  /** Connects to a vsock listener on `port` in the guest. */
  connect(
    port: number,
    options?: {
      /** Connection timeout in milliseconds. Defaults to 5000. */
      timeoutMs?: number;
    },
  ): Promise<VsockConnection>;
  /**
   * Listens for guest connections to `port`, invoking `handler` once per
   * connection. The connection lives exactly as long as the handler: when
   * the returned promise resolves the connection is closed, and when it
   * rejects the connection is reset. Throws if `port` is already bound.
   */
  listen(
    port: number,
    handler: (connection: VsockConnection) => void | PromiseLike<void>,
  ): VsockListener;
  /** Closes the device and every connection and listener on it. */
  close(): void;
}

/**
 * A virtio-vsock device. `guestCid` is the context ID assigned to the
 * guest, defaulting to 3.
 */
export function vsockDevice(
  { guestCid = 3n }: { guestCid?: bigint } = {},
): VsockDevice {
  const config = new Uint8Array(VsockConfig.size);
  new VsockConfig(config).guest_cid = guestCid;

  const rx_buffers: VirtqueueChain[] = [];
  const pending_packets: Uint8Array[] = [];
  const connections = new Map<string, VsockConnectionState>();
  const listeners = new Map<number, VsockListenerState>();
  const local_ports = new Set<number>();
  let local_port_last = 0;
  let closed = false;

  function allocate_port() {
    do {
      local_port_last = ((local_port_last + 1) & ~(1 << 31)) |
        EPHEMERAL_PORT_BASE;
    } while (local_ports.has(local_port_last));
    local_ports.add(local_port_last);
    return local_port_last;
  }

  function connection_key(local_port: number, peer_port: number) {
    return `${local_port}:${peer_port}`;
  }

  function remove_connection(key: string, state: VsockConnectionState) {
    connections.delete(key);
    local_ports.delete(state.controller.local_port);
  }

  function flush_rx() {
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
    local_port: number,
    peer_port: number,
    op: number,
    flags: number,
    payload: Uint8Array,
    fwd_cnt: number,
    type: number = VsockType.STREAM,
  ) {
    const packet = new Uint8Array(VsockHeader.size + payload.byteLength);
    const hdr = new VsockHeader(packet);
    hdr.src_cid = HOST_CID;
    hdr.dst_cid = guestCid;
    hdr.src_port = local_port;
    hdr.dst_port = peer_port;
    hdr.len = payload.byteLength;
    hdr.type = type;
    hdr.op = op;
    hdr.flags = flags;
    hdr.buf_alloc = DEFAULT_VSOCK_BUF_ALLOC;
    hdr.fwd_cnt = fwd_cnt;
    packet.set(payload, VsockHeader.size);

    pending_packets.push(packet);
    flush_rx();
  }

  /** Refuses a packet with no matching connection, like the kernel's
   * `virtio_transport_reset_no_sock`: reply RST unless resetting a reset. */
  function reset_no_sock(header: VsockHeader) {
    if (header.op === VsockOp.RST) return;
    send_packet(
      header.dst_port,
      header.src_port,
      VsockOp.RST,
      0,
      new Uint8Array(),
      0,
      header.type,
    );
  }

  function connection_ops(
    local_port: number,
    peer_port: number,
  ): VsockConnectionOps {
    const key = connection_key(local_port, peer_port);
    return {
      send(op, flags, payload, fwd_cnt) {
        if (closed || !connections.has(key)) return;
        send_packet(local_port, peer_port, op, flags, payload, fwd_cnt);
      },
      close() {
        const state = connections.get(key);
        if (closed || !state) return;
        send_packet(
          local_port,
          peer_port,
          VsockOp.SHUTDOWN,
          VsockShutdown.RCV | VsockShutdown.SEND,
          new Uint8Array(),
          state.controller.bytes_read,
        );
      },
    };
  }

  function abort_connection(key: string) {
    const state = connections.get(key);
    if (!state) return;
    if (!closed) {
      send_packet(
        state.controller.local_port,
        state.controller.peer_port,
        VsockOp.RST,
        0,
        new Uint8Array(),
        state.controller.bytes_read,
      );
    }
    state.controller.close_from_peer();
    remove_connection(key, state);
  }

  function handle_request(header: VsockHeader) {
    const listener = listeners.get(header.dst_port);
    if (!listener) return reset_no_sock(header);

    const local_port = header.dst_port;
    const peer_port = header.src_port;
    const key = connection_key(local_port, peer_port);
    const connection = create_vsock_connection(
      connection_ops(local_port, peer_port),
      local_port,
      peer_port,
    );
    connection.update_credit(header.buf_alloc, header.fwd_cnt);
    connections.set(key, {
      controller: connection,
      connected: true,
      peer_shutdown: 0,
    });
    send_packet(local_port, peer_port, VsockOp.RESPONSE, 0, new Uint8Array(), 0);
    listener.dispatch(key, connection.connection);
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

  function handle_tx_packet(header: VsockHeader, payload: Uint8Array) {
    if (header.type !== VsockType.STREAM) return reset_no_sock(header);

    const key = connection_key(header.dst_port, header.src_port);
    const state = connections.get(key);
    if (!state) {
      if (header.op === VsockOp.REQUEST) handle_request(header);
      else reset_no_sock(header);
      return;
    }

    const connection = state.controller;
    connection.update_credit(header.buf_alloc, header.fwd_cnt);

    switch (header.op) {
      case VsockOp.RESPONSE:
        state.connected = true;
        state.resolve?.(connection.connection);
        break;
      case VsockOp.RW:
        connection.enqueue(payload);
        break;
      case VsockOp.CREDIT_UPDATE:
        break;
      case VsockOp.CREDIT_REQUEST:
        send_packet(
          connection.local_port,
          connection.peer_port,
          VsockOp.CREDIT_UPDATE,
          0,
          new Uint8Array(),
          connection.bytes_read,
        );
        break;
      case VsockOp.SHUTDOWN:
        state.peer_shutdown |= header.flags &
          (VsockShutdown.RCV | VsockShutdown.SEND);
        if (state.peer_shutdown & VsockShutdown.SEND) {
          connection.end_from_peer();
        }
        if (state.peer_shutdown === (VsockShutdown.RCV | VsockShutdown.SEND)) {
          send_packet(
            connection.local_port,
            connection.peer_port,
            VsockOp.RST,
            0,
            new Uint8Array(),
            connection.bytes_read,
          );
          if (!state.connected) {
            state.reject?.(new Error("guest shut down vsock connection"));
          }
          connection.close_from_peer();
          remove_connection(key, state);
        }
        break;
      case VsockOp.RST:
        if (!state.connected) {
          state.reject?.(new Error("guest reset vsock connection"));
        }
        connection.close_from_peer();
        remove_connection(key, state);
        break;
      default:
        console.warn("unknown vsock op", header.op);
    }
  }

  function notify_rx(queue: Virtqueue) {
    for (const chain of queue) rx_buffers.push(chain);
    flush_rx();
  }

  function notify_tx(queue: Virtqueue) {
    for (const chain of queue) {
      const { header, payload } = read_tx_packet(chain);
      handle_tx_packet(header, payload);
      chain.release(0);
    }
  }

  function close_device() {
    if (closed) return;
    for (const [key, state] of connections) {
      send_packet(
        state.controller.local_port,
        state.controller.peer_port,
        VsockOp.RST,
        0,
        new Uint8Array(),
        state.controller.bytes_read,
      );
      if (!state.connected) {
        state.reject?.(new Error("vsock device closed while connecting"));
      }
      state.controller.close_from_peer();
    }
    connections.clear();
    local_ports.clear();
    for (const listener of [...listeners.values()]) listener.close();
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
    const key = connection_key(local_port, port);
    const connection = create_vsock_connection(
      connection_ops(local_port, port),
      local_port,
      port,
    );

    const promise = new Promise<VsockConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        send_packet(local_port, port, VsockOp.RST, 0, new Uint8Array(), 0);
        const state = connections.get(key);
        if (state) remove_connection(key, state);
        connection.close_from_peer();
        reject(new Error(`timed out connecting to guest vsock port ${port}`));
      }, timeoutMs);

      connections.set(key, {
        controller: connection,
        connected: false,
        peer_shutdown: 0,
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

    send_packet(local_port, port, VsockOp.REQUEST, 0, new Uint8Array(), 0);
    return promise;
  }

  function listen(
    port: number,
    handler: (connection: VsockConnection) => void | PromiseLike<void>,
  ): VsockListener {
    assert(!closed, "vsock device is closed");
    assert(
      Number.isInteger(port) && port > 0 && port < EPHEMERAL_PORT_BASE,
      "vsock listen ports must be integers in 1-1073741823",
    );
    assert(!listeners.has(port), `vsock port ${port} is already bound`);

    let active = 0;
    let listening = true;
    const { promise: finished, resolve: resolve_finished } =
      Promise.withResolvers<void>();

    function settle() {
      if (!listening && active === 0) resolve_finished();
    }

    function close() {
      if (!listening) return;
      listening = false;
      listeners.delete(port);
      settle();
    }

    listeners.set(port, {
      close,
      dispatch(key, connection) {
        active += 1;
        queueMicrotask(async () => {
          try {
            await handler(connection);
            connection.close();
          } catch (error) {
            console.error(`vsock handler on port ${port} failed`, error);
            abort_connection(key);
          } finally {
            active -= 1;
            settle();
          }
        });
      },
    });

    return { port, close, finished };
  }

  return controller.expose({ connect, listen, close: controller.close });
}
