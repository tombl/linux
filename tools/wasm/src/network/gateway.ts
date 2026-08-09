import {
  ethernetDevice,
  ethernetNetwork,
  type EthernetDevice,
  type EthernetPort,
  type MacAddress,
} from "../virtio/net.ts";
import { Bytes, FixedArray, Struct, U16BE, U32BE, U8 } from "../bytes.ts";

const GATEWAY_ADDRESS = "192.0.2.1";
const GATEWAY_IP = ipv4_number(GATEWAY_ADDRESS);
const GATEWAY_MAC: MacAddress = [0x02, 0, 0, 0, 0, 1];
const TCP_MSS = 1200;
const TCP_RECEIVE_WINDOW = 0xffff;
const TCP_TIMEOUT_MS = 30_000;
/** Host-facing UDP streams retain at most this many datagrams, then tail-drop. */
const UDP_READABLE_QUEUE_CAP = 64;
const ETHERNET_MTU = 1500;
const IP_REASSEMBLY_TIMEOUT_MS = 60_000;
const MAX_IP_REASSEMBLIES = 64;
const MAX_IP_FRAGMENTS = 64;

const EthernetType = { IPv4: 0x0800, ARP: 0x0806 } as const;
const IpProtocol = { ICMP: 1, TCP: 6, UDP: 17 } as const;
const TcpFlag = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10 } as const;

const Mac = FixedArray(U8, 6);

class EthernetHeader extends Struct({
  destination: Mac,
  source: Mac,
  type: U16BE,
}) {}

class ArpPacket extends Struct({
  hardware_type: U16BE,
  protocol_type: U16BE,
  hardware_length: U8,
  protocol_length: U8,
  operation: U16BE,
  sender_mac: Mac,
  sender_ip: U32BE,
  target_mac: Mac,
  target_ip: U32BE,
}) {}

class Ipv4Header extends Struct({
  version_and_header_length: U8,
  type_of_service: U8,
  total_length: U16BE,
  identification: U16BE,
  flags_and_fragment_offset: U16BE,
  time_to_live: U8,
  protocol: U8,
  header_checksum: U16BE,
  source: U32BE,
  destination: U32BE,
}) {}

const MAX_IP_PAYLOAD = 0xffff - Ipv4Header.size;
const IP_FRAGMENT_PAYLOAD = Math.floor((ETHERNET_MTU - Ipv4Header.size) / 8) * 8;

class TcpHeader extends Struct({
  source_port: U16BE,
  destination_port: U16BE,
  sequence: U32BE,
  acknowledgement: U32BE,
  data_offset: U8,
  flags: U8,
  window: U16BE,
  header_checksum: U16BE,
  urgent_pointer: U16BE,
}) {}

class TcpPseudoHeader extends Struct({
  source: U32BE,
  destination: U32BE,
  zero: U8,
  protocol: U8,
  length: U16BE,
}) {}

class UdpHeader extends Struct({
  source_port: U16BE,
  destination_port: U16BE,
  length: U16BE,
  header_checksum: U16BE,
}) {}

class DnsHeader extends Struct({
  id: U16BE,
  flags: U16BE,
  question_count: U16BE,
  answer_count: U16BE,
  authority_count: U16BE,
  additional_count: U16BE,
}) {}

class DnsQuestionFooter extends Struct({ type: U16BE, klass: U16BE }) {}

class DnsIpv4Answer extends Struct({
  name: U16BE,
  type: U16BE,
  klass: U16BE,
  ttl: U32BE,
  length: U16BE,
  address: U32BE,
}) {}

/** One end of a connection: transport, host, and port. */
export interface NetworkAddress {
  readonly transport: "tcp" | "udp";
  readonly hostname: string;
  readonly port: number;
}

/**
 * A TCP connection between the host and a guest. Data moves as web streams:
 * write to `writable`, read from `readable`.
 */
export interface TcpConnection {
  /** Bytes from the guest. */
  readonly readable: ReadableStream<Uint8Array>;
  /** Bytes to the guest. */
  readonly writable: WritableStream<Uint8Array>;
  /** The host side of the connection. */
  readonly localAddr: NetworkAddress;
  /** The guest side of the connection. */
  readonly remoteAddr: NetworkAddress;
  /** Resets and closes the connection. */
  close(): void;
}

/**
 * A UDP channel between the host and a guest. Each write to `writable` is
 * one datagram.
 */
export interface UdpConnection {
  /**
   * Datagrams from the guest. The queue retains at most 64 datagrams and
   * drops new arrivals while full.
   */
  readonly readable: ReadableStream<Uint8Array>;
  /** One write per datagram to the guest. */
  readonly writable: WritableStream<Uint8Array>;
  /** The host side of the channel. */
  readonly localAddr: NetworkAddress;
  /** The guest side of the channel. */
  readonly remoteAddr: NetworkAddress;
  /** Closes the channel. */
  close(): void;
}

export interface TcpConnectOptions {
  /** The guest's address on the network, e.g. `guest.network.address`. */
  hostname: string;
  port: number;
  transport?: "tcp";
  /** Aborts the pending connection and any connection it establishes. */
  signal?: AbortSignal;
}

export interface UdpConnectOptions {
  /** The guest's address on the network, e.g. `guest.network.address`. */
  hostname: string;
  port: number;
  transport: "udp";
}

/** One lazily established, supervised outbound guest TCP session. */
export interface TcpSession {
  /** The address selected by the guest connection. */
  readonly target: { readonly hostname: string; readonly port: number };
  /** Bytes received from the guest. The first read starts the TCP handshake. */
  readonly readable: ReadableStream<Uint8Array>;
  /** Bytes sent to the guest. The first write or close starts the TCP handshake. */
  readonly writable: WritableStream<Uint8Array>;
  /** Aborted when the guest or network tears down the flow. */
  readonly signal: AbortSignal;
}

/**
 * The outward-facing half of a `Network`: how to reach the world beyond the
 * virtual subnet on a guest's behalf.
 */
export interface NetworkOptions {
  /**
   * Handles one TCP session whenever a guest connects outside the virtual
   * subnet. The callback starts at SYN receipt and lives for the whole
   * connection. Its first stream read, write, or writable close starts the
   * handshake; merely acquiring a reader or writer does not. Throwing before
   * first I/O rejects the pending connection, while throwing afterwards resets
   * it.
   *
   * In Node, implement it with `net.connect`. A browser has no raw TCP, so
   * there it bridges to whatever transport you control — a WebSocket proxy,
   * say.
   */
  connectTcp: (session: TcpSession) => void | PromiseLike<void>;
  /** Answers guest DNS A queries with the IPv4 addresses for `hostname`. */
  resolveDns: (hostname: string) => Promise<string[]>;
}

/**
 * A private IPv4 network, created by `createNetwork`. Guests spawned with
 * the same network can reach each other, and the host can connect to any of
 * them.
 */
export interface Network extends Disposable {
  /**
   * The gateway address, `192.0.2.1`. From inside a guest this is the host
   * endpoint: TCP connections to it reach the host's loopback through the
   * `connectTcp` adapter.
   */
  readonly gateway: string;
  /**
   * Connects from the host to a port on an attached guest. Resolves once
   * the guest accepts the connection; rejects if nothing is listening there
   * or no guest has the address. If the guest may not be listening yet,
   * retry.
   *
   * @example Reach a server running in the guest
   * ```ts
   * const server = await guest.exec(["nc", "-l", "-p", "8080"]);
   * let connection;
   * for (;;) {
   *   try {
   *     connection = await guest.network.connect({ port: 8080 });
   *     break;
   *   } catch {
   *     await new Promise((resolve) => setTimeout(resolve, 50));
   *   }
   * }
   * const writer = connection.writable.getWriter();
   * await writer.write(new TextEncoder().encode("hello from the host\n"));
   * await writer.close();
   * const reader = server.stdout.getReader();
   * console.log(new TextDecoder().decode((await reader.read()).value));
   * await server.kill();
   * ```
   */
  connect(options: TcpConnectOptions): Promise<TcpConnection>;
  connect(options: UdpConnectOptions): Promise<UdpConnection>;
  /** Closes every connection and detaches every guest. */
  close(): void;
}

/**
 * A guest's side of a `Network`, present as `guest.network` when the guest
 * was spawned with one.
 */
export interface GuestNetwork {
  /** The guest's address on the network, e.g. `"192.0.2.2"`. */
  readonly address: string;
  /** Connects to a port on this guest — `network.connect` with the address filled in. */
  connect(options: Omit<TcpConnectOptions, "hostname">): Promise<TcpConnection>;
  connect(options: Omit<UdpConnectOptions, "hostname">): Promise<UdpConnection>;
}

interface Attachment {
  readonly address: string;
  readonly ip: number;
  readonly macAddress: MacAddress;
  readonly device: EthernetDevice;
  close(): void;
}

const do_attach_guest = Symbol("attach guest to network");

interface InternalNetwork extends Network {
  [do_attach_guest](): Attachment;
}

function ipv4_number(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) throw new TypeError(`invalid IPv4 address: ${address}`);
  let result = 0;
  for (const part of parts) {
    const byte = Number(part);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== part) {
      throw new TypeError(`invalid IPv4 address: ${address}`);
    }
    result = (result << 8) | byte;
  }
  return result >>> 0;
}

function ipv4_string(address: number) {
  return [address >>> 24, (address >>> 16) & 255, (address >>> 8) & 255, address & 255].join(".");
}

function checksum(...parts: readonly Uint8Array[]) {
  let sum = 0;
  let high: number | undefined;
  for (const part of parts) {
    for (const byte of part) {
      if (high === undefined) high = byte;
      else {
        sum += (high << 8) | byte;
        high = undefined;
      }
    }
  }
  if (high !== undefined) sum += high << 8;
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

function sequence_add(sequence: number, amount: number) {
  return (sequence + amount) >>> 0;
}

function random_sequence() {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

function valid_port(port: number) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

interface ParsedIpPacket {
  source: number;
  destination: number;
  protocol: number;
  payload: Uint8Array;
}

interface ParsedIpFragment extends ParsedIpPacket {
  identification: number;
  header_length: number;
  offset: number;
  more_fragments: boolean;
}

interface IpFragment {
  offset: number;
  payload: Uint8Array;
}

interface IpReassembly {
  readonly source: number;
  readonly destination: number;
  readonly protocol: number;
  readonly fragments: IpFragment[];
  readonly timeout: ReturnType<typeof setTimeout>;
  total_length?: number;
}

interface ParsedTcpSegment {
  source_port: number;
  destination_port: number;
  sequence: number;
  acknowledgement: number;
  flags: number;
  window: number;
  payload: Uint8Array;
}

interface ParsedUdpDatagram {
  source_port: number;
  destination_port: number;
  payload: Uint8Array;
}

interface AckWaiter {
  acknowledgement: number;
  resolve(): void;
  reject(error: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WindowWaiter {
  resolve(): void;
  reject(error: unknown): void;
}

interface TcpFlow {
  readonly key: string;
  readonly guest: Attachment;
  readonly guest_port: number;
  readonly peer_ip: number;
  readonly peer_port: number;
  send_sequence: number;
  receive_sequence: number;
  established: boolean;
  local_ended: boolean;
  remote_ended: boolean;
  closed: boolean;
  ack_waiters: AckWaiter[];
  window_waiters: WindowWaiter[];
  receive_tail: Promise<void>;
  advertised_window: number;
  peer_window: number;
  handshake?: PromiseWithResolvers<TcpConnection>;
  handshake_timeout?: ReturnType<typeof setTimeout>;
  readable?: ReadableStreamDefaultController<Uint8Array>;
  activation?: Promise<void>;
  activation_waiter?: PromiseWithResolvers<void>;
  abort?: AbortController;
  receive_demand?: boolean;
  remove_external_abort?: () => void;
}

interface UdpFlow {
  readonly key: string;
  readonly guest: Attachment;
  readonly guest_port: number;
  readonly host_port: number;
  readonly readable: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
}

function tcp_key(guest_ip: number, guest_port: number, peer_ip: number, peer_port: number) {
  return `${guest_ip}:${guest_port}:${peer_ip}:${peer_port}`;
}

function udp_key(guest_ip: number, guest_port: number, host_port: number) {
  return `${guest_ip}:${guest_port}:${host_port}`;
}

function parse_ip(frame: Uint8Array): ParsedIpFragment | undefined {
  if (frame.byteLength < EthernetHeader.size + Ipv4Header.size) return;
  if (new EthernetHeader(frame).type !== EthernetType.IPv4) return;
  const bytes = frame.subarray(EthernetHeader.size);
  const header = new Ipv4Header(bytes);
  const header_length = (header.version_and_header_length & 0x0f) * 4;
  if (
    header.version_and_header_length >>> 4 !== 4 ||
    header_length < Ipv4Header.size ||
    header_length > bytes.byteLength
  )
    return;
  if (header.total_length < header_length || header.total_length > bytes.byteLength) return;
  const payload = bytes.subarray(header_length, header.total_length);
  const offset = (header.flags_and_fragment_offset & 0x1fff) * 8;
  const more_fragments = (header.flags_and_fragment_offset & 0x2000) !== 0;
  if ((offset !== 0 || more_fragments) && payload.byteLength === 0) return;
  if (more_fragments && payload.byteLength % 8 !== 0) return;
  if (offset + payload.byteLength > MAX_IP_PAYLOAD) return;
  return {
    source: header.source,
    destination: header.destination,
    protocol: header.protocol,
    payload,
    identification: header.identification,
    header_length,
    offset,
    more_fragments,
  };
}

function parse_tcp(payload: Uint8Array): ParsedTcpSegment | undefined {
  if (payload.byteLength < TcpHeader.size) return;
  const header = new TcpHeader(payload);
  const header_length = (header.data_offset >>> 4) * 4;
  if (header_length < TcpHeader.size || header_length > payload.byteLength) return;
  return {
    source_port: header.source_port,
    destination_port: header.destination_port,
    sequence: header.sequence,
    acknowledgement: header.acknowledgement,
    flags: header.flags,
    window: header.window,
    payload: payload.subarray(header_length),
  };
}

function parse_udp(payload: Uint8Array): ParsedUdpDatagram | undefined {
  if (payload.byteLength < UdpHeader.size) return;
  const header = new UdpHeader(payload);
  if (header.length < UdpHeader.size || header.length > payload.byteLength) return;
  return {
    source_port: header.source_port,
    destination_port: header.destination_port,
    payload: payload.subarray(UdpHeader.size, header.length),
  };
}

function decode_dns_name(packet: Uint8Array, offset: number) {
  const labels: string[] = [];
  for (;;) {
    const length = packet[offset++];
    if (length === undefined) throw new Error("truncated DNS name");
    if (length === 0) break;
    if ((length & 0xc0) !== 0 || offset + length > packet.byteLength) {
      throw new Error("unsupported DNS name");
    }
    labels.push(new TextDecoder().decode(packet.subarray(offset, offset + length)));
    offset += length;
  }
  return { hostname: labels.join("."), end: offset };
}

function dns_response(query: Uint8Array, addresses: readonly string[]) {
  if (query.byteLength < DnsHeader.size) throw new Error("short DNS query");
  const input = new DnsHeader(query);
  if (input.question_count !== 1) throw new Error("DNS query must have one question");
  const name = decode_dns_name(query, DnsHeader.size);
  if (name.end + DnsQuestionFooter.size > query.byteLength) {
    throw new Error("truncated DNS question");
  }
  const question_end = name.end + DnsQuestionFooter.size;
  const question = new DnsQuestionFooter(query.subarray(name.end));
  const answer_addresses = question.type === 1 && question.klass === 1 ? addresses : [];
  const result = new Bytes(question_end + answer_addresses.length * DnsIpv4Answer.size);
  const header = result.alloc(DnsHeader);
  result.append(query.subarray(DnsHeader.size, question_end));
  header.value = {
    id: input.id,
    flags: 0x8180,
    question_count: 1,
    answer_count: answer_addresses.length,
    authority_count: 0,
    additional_count: 0,
  };
  for (const address of answer_addresses) {
    result.alloc(DnsIpv4Answer).value = {
      name: 0xc00c,
      type: 1,
      klass: 1,
      ttl: 60,
      length: 4,
      address: ipv4_number(address),
    };
  }
  return result.array;
}

/**
 * Creates a private IPv4 network: an Ethernet switch in this process plus a
 * userspace TCP/IP endpoint at `192.0.2.1`. Pass the result to every
 * `spawnGuest` that should be on the network; guests on the same network
 * reach each other over real TCP and UDP.
 *
 * Guest traffic beyond the subnet goes through the adapters: outbound TCP
 * is proxied with `connectTcp`, DNS is answered with `resolveDns`, and UDP
 * is delivered to the gateway only. The network is disposable — closing it
 * (or ending an `await using` scope) tears down every connection.
 *
 * @example Give guests internet access from Node
 * ```ts
 * import { createConnection } from "node:net";
 * import { resolve4 } from "node:dns/promises";
 * import { once } from "node:events";
 * import { Duplex } from "node:stream";
 *
 * const network = createNetwork({
 *   async connectTcp(session) {
 *     const socket = createConnection({ host: session.target.hostname,
 *       port: session.target.port, signal: session.signal });
 *     await once(socket, "connect");
 *     const streams = Duplex.toWeb(socket);
 *     await Promise.all([
 *       session.readable.pipeTo(streams.writable as WritableStream<Uint8Array>),
 *       (streams.readable as ReadableStream<Uint8Array>).pipeTo(session.writable),
 *     ]);
 *   },
 *   resolveDns: resolve4,
 * });
 *
 * const guest = await spawnGuest({ network });
 * // Guests can now reach whatever the host process can:
 * const process = await guest.exec(["wget", "-qO-", "http://example.com"]);
 * ```
 */
export function createNetwork({ connectTcp, resolveDns }: NetworkOptions): Network {
  const ethernet = ethernetNetwork();
  const attachments = new Map<number, Attachment>();
  const tcp_flows = new Map<string, TcpFlow>();
  const udp_flows = new Map<string, UdpFlow>();
  const ip_reassemblies = new Map<string, IpReassembly>();
  let next_address = 2;
  let next_port = 49152;
  let ip_identifier = 0;
  let closed = false;

  function allocate_port(in_use: (port: number) => boolean) {
    for (let attempts = 0; attempts < 65535 - 49152; attempts++) {
      const port = next_port;
      next_port = port === 65535 ? 49152 : port + 1;
      if (!in_use(port)) return port;
    }
    throw new Error("no network ports available");
  }

  function ip_packet(
    destination_mac: MacAddress,
    source_ip: number,
    destination_ip: number,
    protocol: number,
    payload: Uint8Array,
    identification: number,
    flags_and_fragment_offset: number,
  ) {
    const frame = new Bytes(EthernetHeader.size + Ipv4Header.size + payload.byteLength);
    frame.alloc(EthernetHeader).value = {
      destination: [...destination_mac],
      source: [...GATEWAY_MAC],
      type: EthernetType.IPv4,
    };
    const allocated = frame.alloc(Ipv4Header);
    allocated.value = {
      version_and_header_length: 0x45,
      type_of_service: 0,
      total_length: Ipv4Header.size + payload.byteLength,
      identification,
      flags_and_fragment_offset,
      time_to_live: 64,
      protocol,
      header_checksum: 0,
      source: source_ip,
      destination: destination_ip,
    };
    allocated.value.header_checksum = checksum(
      frame.array.subarray(EthernetHeader.size, EthernetHeader.size + Ipv4Header.size),
    );
    frame.append(payload);
    return frame.array;
  }

  async function send_ip(
    destination_mac: MacAddress,
    source_ip: number,
    destination_ip: number,
    protocol: number,
    payload: Uint8Array,
  ) {
    if (payload.byteLength > MAX_IP_PAYLOAD) throw new RangeError("IPv4 payload is too large");
    const identification = ip_identifier++ & 0xffff;
    if (payload.byteLength <= IP_FRAGMENT_PAYLOAD) {
      await gateway.send(
        ip_packet(
          destination_mac,
          source_ip,
          destination_ip,
          protocol,
          payload,
          identification,
          0x4000,
        ),
      );
      return;
    }
    for (let offset = 0; offset < payload.byteLength; offset += IP_FRAGMENT_PAYLOAD) {
      const end = Math.min(offset + IP_FRAGMENT_PAYLOAD, payload.byteLength);
      await gateway.send(
        ip_packet(
          destination_mac,
          source_ip,
          destination_ip,
          protocol,
          payload.subarray(offset, end),
          identification,
          (end < payload.byteLength ? 0x2000 : 0) | (offset / 8),
        ),
      );
    }
  }

  function tcp_segment(
    source_ip: number,
    destination_ip: number,
    source_port: number,
    destination_port: number,
    sequence: number,
    acknowledgement: number,
    flags: number,
    payload = new Uint8Array(),
    window = TCP_RECEIVE_WINDOW,
  ) {
    const pseudo = new Bytes(TcpPseudoHeader.size);
    pseudo.alloc(TcpPseudoHeader).value = {
      source: source_ip,
      destination: destination_ip,
      zero: 0,
      protocol: IpProtocol.TCP,
      length: TcpHeader.size + payload.byteLength,
    };
    const segment = new Bytes(TcpHeader.size + payload.byteLength);
    const header = segment.alloc(TcpHeader);
    header.value = {
      source_port,
      destination_port,
      sequence,
      acknowledgement,
      data_offset: 5 << 4,
      flags,
      window,
      header_checksum: 0,
      urgent_pointer: 0,
    };
    segment.append(payload);
    header.value.header_checksum = checksum(pseudo.array, segment.array);
    return segment.array;
  }

  function udp_datagram(source_port: number, destination_port: number, payload: Uint8Array) {
    const datagram = new Bytes(UdpHeader.size + payload.byteLength);
    datagram.alloc(UdpHeader).value = {
      source_port,
      destination_port,
      length: UdpHeader.size + payload.byteLength,
      header_checksum: 0,
    };
    datagram.append(payload);
    return datagram.array;
  }

  async function send_tcp(flow: TcpFlow, flags: number, payload = new Uint8Array()) {
    const window = tcp_receive_window(flow);
    const segment = tcp_segment(
      flow.peer_ip,
      flow.guest.ip,
      flow.peer_port,
      flow.guest_port,
      flow.send_sequence,
      flow.receive_sequence,
      flags,
      payload,
      window,
    );
    flow.advertised_window = window;
    await send_ip(flow.guest.macAddress, flow.peer_ip, flow.guest.ip, IpProtocol.TCP, segment);
  }

  function tcp_receive_window(flow: TcpFlow) {
    if (!flow.readable) return TCP_RECEIVE_WINDOW;
    if (flow.activation) return flow.receive_demand ? TCP_RECEIVE_WINDOW : 0;
    return Math.max(0, Math.min(TCP_RECEIVE_WINDOW, Math.floor(flow.readable.desiredSize ?? 0)));
  }

  function update_tcp_window(flow: TcpFlow) {
    flow.receive_tail = flow.receive_tail
      .then(async () => {
        if (!flow.closed && flow.established && tcp_receive_window(flow) > flow.advertised_window) {
          await send_tcp(flow, TcpFlag.ACK);
        }
      })
      .catch((error) => {
        abort_tcp_flow(flow, error);
      });
  }

  function wait_for_ack(flow: TcpFlow, acknowledgement: number) {
    return new Promise<void>((resolve, reject) => {
      const waiter: AckWaiter = {
        acknowledgement,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = flow.ack_waiters.indexOf(waiter);
          if (index !== -1) flow.ack_waiters.splice(index, 1);
          reject(new Error("timed out waiting for guest TCP acknowledgement"));
        }, TCP_TIMEOUT_MS),
      };
      flow.ack_waiters.push(waiter);
    });
  }

  function acknowledge_waiters(flow: TcpFlow, acknowledgement: number) {
    for (let index = flow.ack_waiters.length - 1; index >= 0; index--) {
      const waiter = flow.ack_waiters[index]!;
      if (waiter.acknowledgement !== acknowledgement) continue;
      clearTimeout(waiter.timeout);
      flow.ack_waiters.splice(index, 1);
      waiter.resolve();
    }
  }

  function update_peer_window(flow: TcpFlow, window: number) {
    flow.peer_window = window;
    if (window === 0) return;
    for (const waiter of flow.window_waiters.splice(0)) waiter.resolve();
  }

  async function wait_for_peer_window(flow: TcpFlow) {
    while (!flow.closed && flow.peer_window === 0) {
      const waiter = Promise.withResolvers<void>();
      flow.window_waiters.push(waiter);
      await waiter.promise;
    }
    if (flow.closed || flow.local_ended) throw new Error("TCP connection is closed");
    return flow.peer_window;
  }

  async function send_tcp_data(flow: TcpFlow, data: Uint8Array) {
    for (let offset = 0; offset < data.byteLength;) {
      if (flow.closed || flow.local_ended) throw new Error("TCP connection is closed");
      const peer_window = await wait_for_peer_window(flow);
      const length = Math.min(TCP_MSS, peer_window, data.byteLength - offset);
      const payload = data.slice(offset, offset + length);
      const acknowledgement = sequence_add(flow.send_sequence, payload.byteLength);
      const acked = wait_for_ack(flow, acknowledgement);
      await send_tcp(flow, TcpFlag.ACK | TcpFlag.PSH, payload);
      flow.send_sequence = acknowledgement;
      await acked;
      offset += length;
    }
  }

  async function send_tcp_fin(flow: TcpFlow) {
    if (flow.closed || flow.local_ended) return;
    await wait_for_peer_window(flow);
    flow.local_ended = true;
    const acknowledgement = sequence_add(flow.send_sequence, 1);
    const acked = wait_for_ack(flow, acknowledgement);
    await send_tcp(flow, TcpFlag.ACK | TcpFlag.FIN);
    flow.send_sequence = acknowledgement;
    await acked;
    if (flow.remote_ended) close_tcp_flow(flow);
  }

  function close_tcp_flow(flow: TcpFlow, error?: unknown) {
    if (flow.closed) return;
    flow.closed = true;
    tcp_flows.delete(flow.key);
    if (flow.handshake_timeout !== undefined) clearTimeout(flow.handshake_timeout);
    for (const waiter of flow.ack_waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error ?? new Error("TCP connection closed"));
    }
    flow.ack_waiters.length = 0;
    for (const waiter of flow.window_waiters) {
      waiter.reject(error ?? new Error("TCP connection closed"));
    }
    flow.window_waiters.length = 0;
    flow.remove_external_abort?.();
    flow.activation_waiter?.reject(error ?? new Error("TCP connection closed"));
    flow.activation_waiter = undefined;
    flow.abort?.abort(error ?? new Error("TCP connection closed"));
    if (error !== undefined) {
      try {
        flow.readable?.error(error);
      } catch {
        // The stream may already have been closed by the peer.
      }
      flow.handshake?.reject(error);
    } else {
      try {
        flow.readable?.close();
      } catch {
        // The peer may already have closed the stream.
      }
    }
  }

  function abort_tcp_flow(flow: TcpFlow, error?: unknown) {
    if (flow.closed) return;
    void send_tcp(flow, TcpFlag.RST | TcpFlag.ACK).catch(() => {});
    close_tcp_flow(flow, error);
  }

  function expire_tcp_handshake(flow: TcpFlow, message: string) {
    flow.handshake_timeout = setTimeout(() => {
      abort_tcp_flow(flow, new Error(message));
    }, TCP_TIMEOUT_MS);
  }

  function establish_tcp_flow(flow: TcpFlow) {
    flow.established = true;
    flow.activation_waiter?.resolve();
    flow.activation_waiter = undefined;
    if (flow.handshake_timeout !== undefined) {
      clearTimeout(flow.handshake_timeout);
      flow.handshake_timeout = undefined;
    }
  }

  function host_tcp_connection(flow: TcpFlow, activate?: () => Promise<void>): TcpConnection {
    const readable = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          flow.readable = controller;
        },
        async pull() {
          flow.receive_demand = true;
          await activate?.();
          update_tcp_window(flow);
        },
        cancel(reason) {
          abort_tcp_flow(flow, reason);
        },
      },
      {
        highWaterMark: activate ? 0 : TCP_RECEIVE_WINDOW,
        size(chunk) {
          return chunk.byteLength;
        },
      },
    );
    const writable = new WritableStream<Uint8Array>({
      async write(chunk) {
        await activate?.();
        return send_tcp_data(flow, chunk);
      },
      async close() {
        await activate?.();
        return send_tcp_fin(flow);
      },
      abort(reason) {
        abort_tcp_flow(flow, reason);
      },
    });
    return {
      readable,
      writable,
      localAddr: { transport: "tcp", hostname: GATEWAY_ADDRESS, port: flow.peer_port },
      remoteAddr: { transport: "tcp", hostname: flow.guest.address, port: flow.guest_port },
      close() {
        abort_tcp_flow(flow);
      },
    };
  }

  function reject_outbound_tcp(flow: TcpFlow, error: unknown) {
    const rst = tcp_segment(
      flow.peer_ip,
      flow.guest.ip,
      flow.peer_port,
      flow.guest_port,
      0,
      flow.receive_sequence,
      TcpFlag.RST | TcpFlag.ACK,
    );
    void send_ip(flow.guest.macAddress, flow.peer_ip, flow.guest.ip, IpProtocol.TCP, rst);
    close_tcp_flow(flow, error);
  }

  function start_outbound_tcp(guest: Attachment, ip: ParsedIpPacket, segment: ParsedTcpSegment) {
    const key = tcp_key(ip.source, segment.source_port, ip.destination, segment.destination_port);
    if (tcp_flows.has(key)) return;
    const initial = random_sequence();
    const flow: TcpFlow = {
      key,
      guest,
      guest_port: segment.source_port,
      peer_ip: ip.destination,
      peer_port: segment.destination_port,
      send_sequence: initial,
      receive_sequence: sequence_add(segment.sequence, 1),
      established: false,
      local_ended: false,
      remote_ended: false,
      closed: false,
      ack_waiters: [],
      window_waiters: [],
      receive_tail: Promise.resolve(),
      advertised_window: TCP_RECEIVE_WINDOW,
      peer_window: segment.window,
    };
    tcp_flows.set(key, flow);
    const abort = new AbortController();
    flow.abort = abort;
    expire_tcp_handshake(
      flow,
      `timed out connecting from ${guest.address}:${segment.source_port} to ${ipv4_string(ip.destination)}:${segment.destination_port}`,
    );
    const activate = () => {
      if (flow.activation) return flow.activation;
      flow.activation = (async () => {
        const waiter = Promise.withResolvers<void>();
        // Teardown can win while SYN-ACK is still being emitted. Mark the
        // waiter observed before that race; this task still awaits and reports
        // its rejection below when emission succeeds.
        void waiter.promise.catch(() => {});
        flow.activation_waiter = waiter;
        await send_tcp(flow, TcpFlag.SYN | TcpFlag.ACK);
        flow.send_sequence = sequence_add(flow.send_sequence, 1);
        await waiter.promise;
      })();
      return flow.activation;
    };
    const streams = host_tcp_connection(flow, activate);
    const session: TcpSession = {
      target: {
        hostname: ip.destination === GATEWAY_IP ? "127.0.0.1" : ipv4_string(ip.destination),
        port: segment.destination_port,
      },
      readable: streams.readable,
      writable: streams.writable,
      signal: abort.signal,
    };
    Promise.resolve()
      .then(() => connectTcp(session))
      .then(
        () => {
          if (flow.closed) return;
          if (!flow.activation) {
            reject_outbound_tcp(flow, new Error("TCP handler completed without using the session"));
            return;
          }
          void send_tcp_fin(flow).catch((error) => abort_tcp_flow(flow, error));
        },
        (error) => {
          if (flow.closed) return;
          if (flow.activation) abort_tcp_flow(flow, error);
          else reject_outbound_tcp(flow, error);
        },
      );
  }

  async function process_tcp(flow: TcpFlow, segment: ParsedTcpSegment) {
    if (flow.closed) return;
    if (segment.flags & TcpFlag.RST) {
      close_tcp_flow(flow, new Error("guest reset TCP connection"));
      return;
    }
    if (segment.flags & TcpFlag.ACK) {
      update_peer_window(flow, segment.window);
      acknowledge_waiters(flow, segment.acknowledgement);
    }

    if (!flow.established) {
      if (flow.handshake) {
        if (
          (segment.flags & (TcpFlag.SYN | TcpFlag.ACK)) !== (TcpFlag.SYN | TcpFlag.ACK) ||
          segment.acknowledgement !== flow.send_sequence
        )
          return;
        flow.receive_sequence = sequence_add(segment.sequence, 1);
        establish_tcp_flow(flow);
        await send_tcp(flow, TcpFlag.ACK);
        flow.handshake.resolve(host_tcp_connection(flow));
        flow.handshake = undefined;
        return;
      }
      if (segment.flags & TcpFlag.ACK && segment.acknowledgement === flow.send_sequence) {
        establish_tcp_flow(flow);
      }
      return;
    }

    const consumes = segment.payload.byteLength + (segment.flags & TcpFlag.FIN ? 1 : 0);
    if (consumes === 0) return;
    if (segment.sequence !== flow.receive_sequence) {
      await send_tcp(flow, TcpFlag.ACK);
      return;
    }

    if (segment.payload.byteLength > 0 && segment.payload.byteLength > tcp_receive_window(flow)) {
      await send_tcp(flow, TcpFlag.ACK);
      return;
    }

    if (segment.payload.byteLength > 0) {
      flow.readable?.enqueue(segment.payload.slice());
      flow.receive_demand = false;
      flow.receive_sequence = sequence_add(flow.receive_sequence, segment.payload.byteLength);
    }
    if (segment.flags & TcpFlag.FIN) {
      flow.receive_sequence = sequence_add(flow.receive_sequence, 1);
      flow.remote_ended = true;
      flow.readable?.close();
    }
    await send_tcp(flow, TcpFlag.ACK);
    if (flow.local_ended && flow.remote_ended && flow.ack_waiters.length === 0) {
      close_tcp_flow(flow);
    }
  }

  function receive_tcp(ip: ParsedIpPacket, source_mac: MacAddress) {
    const segment = parse_tcp(ip.payload);
    if (!segment) return;
    const guest = attachments.get(ip.source);
    if (!guest) return;
    // The latest frame is authoritative if a guest's NIC address changed.
    if (source_mac.some((byte, index) => byte !== guest.macAddress[index])) return;
    const key = tcp_key(ip.source, segment.source_port, ip.destination, segment.destination_port);
    const flow = tcp_flows.get(key);
    if (!flow) {
      if (segment.flags & TcpFlag.SYN && !(segment.flags & TcpFlag.ACK)) {
        start_outbound_tcp(guest, ip, segment);
      }
      return;
    }
    flow.receive_tail = flow.receive_tail
      .then(() => process_tcp(flow, segment))
      .catch((error) => {
        abort_tcp_flow(flow, error);
      });
  }

  async function receive_dns(guest: Attachment, datagram: ParsedUdpDatagram) {
    try {
      const { hostname } = decode_dns_name(datagram.payload, 12);
      const response = dns_response(datagram.payload, await resolveDns(hostname));
      const udp = udp_datagram(53, datagram.source_port, response);
      await send_ip(guest.macAddress, GATEWAY_IP, guest.ip, IpProtocol.UDP, udp);
    } catch {
      // A malformed or failed DNS query behaves like an unreachable resolver.
    }
  }

  function receive_udp(ip: ParsedIpPacket) {
    const datagram = parse_udp(ip.payload);
    if (!datagram) return;
    const guest = attachments.get(ip.source);
    if (!guest) return;
    if (ip.destination === GATEWAY_IP && datagram.destination_port === 53) {
      void receive_dns(guest, datagram);
      return;
    }
    if (ip.destination !== GATEWAY_IP) return;
    const flow = udp_flows.get(udp_key(ip.source, datagram.source_port, datagram.destination_port));
    if (flow && (flow.controller.desiredSize ?? 0) > 0) {
      flow.controller.enqueue(datagram.payload.slice());
    }
  }

  function receive_arp(frame: Uint8Array) {
    if (frame.byteLength < EthernetHeader.size + ArpPacket.size) return;
    const ethernet_header = new EthernetHeader(frame);
    const request = new ArpPacket(frame.subarray(EthernetHeader.size));
    if (
      ethernet_header.type !== EthernetType.ARP ||
      request.hardware_type !== 1 ||
      request.protocol_type !== EthernetType.IPv4 ||
      request.hardware_length !== Mac.size ||
      request.protocol_length !== 4 ||
      request.operation !== 1 ||
      request.target_ip !== GATEWAY_IP
    )
      return;
    const reply = new Bytes(EthernetHeader.size + ArpPacket.size);
    reply.alloc(EthernetHeader).value = {
      destination: request.sender_mac,
      source: [...GATEWAY_MAC],
      type: EthernetType.ARP,
    };
    reply.alloc(ArpPacket).value = {
      hardware_type: 1,
      protocol_type: EthernetType.IPv4,
      hardware_length: Mac.size,
      protocol_length: 4,
      operation: 2,
      sender_mac: [...GATEWAY_MAC],
      sender_ip: GATEWAY_IP,
      target_mac: request.sender_mac,
      target_ip: request.sender_ip,
    };
    void gateway.send(reply.array);
  }

  function ip_reassembly_key(fragment: ParsedIpFragment) {
    return `${fragment.source}:${fragment.destination}:${fragment.protocol}:${fragment.identification}`;
  }

  function discard_ip_reassembly(key: string) {
    const reassembly = ip_reassemblies.get(key);
    if (!reassembly) return;
    clearTimeout(reassembly.timeout);
    ip_reassemblies.delete(key);
  }

  function reassemble_ip(fragment: ParsedIpFragment): ParsedIpPacket | undefined {
    const key = ip_reassembly_key(fragment);
    if (fragment.offset === 0 && !fragment.more_fragments) {
      discard_ip_reassembly(key);
      return fragment;
    }
    let reassembly = ip_reassemblies.get(key);
    if (!reassembly) {
      if (ip_reassemblies.size === MAX_IP_REASSEMBLIES) {
        discard_ip_reassembly(ip_reassemblies.keys().next().value!);
      }
      reassembly = {
        source: fragment.source,
        destination: fragment.destination,
        protocol: fragment.protocol,
        fragments: [],
        timeout: setTimeout(() => discard_ip_reassembly(key), IP_REASSEMBLY_TIMEOUT_MS),
      };
      ip_reassemblies.set(key, reassembly);
    }

    const end = fragment.offset + fragment.payload.byteLength;
    if (
      (fragment.offset === 0 && end + fragment.header_length > 0xffff) ||
      (reassembly.total_length !== undefined && end > reassembly.total_length)
    ) {
      discard_ip_reassembly(key);
      return;
    }
    const insertion = reassembly.fragments.findIndex(
      (candidate) => fragment.offset < candidate.offset + candidate.payload.byteLength,
    );
    const next = insertion === -1 ? undefined : reassembly.fragments[insertion];
    const previous =
      insertion === -1
        ? reassembly.fragments.at(-1)
        : insertion === 0
          ? undefined
          : reassembly.fragments[insertion - 1];
    if (
      (previous && fragment.offset < previous.offset + previous.payload.byteLength) ||
      (next && end > next.offset)
    ) {
      const duplicate = reassembly.fragments.find(
        (candidate) =>
          candidate.offset === fragment.offset &&
          candidate.payload.byteLength === fragment.payload.byteLength,
      );
      if (duplicate && duplicate.payload.every((byte, index) => byte === fragment.payload[index])) {
        return;
      }
      discard_ip_reassembly(key);
      return;
    }
    if (reassembly.fragments.length === MAX_IP_FRAGMENTS) {
      discard_ip_reassembly(key);
      return;
    }
    reassembly.fragments.splice(insertion === -1 ? reassembly.fragments.length : insertion, 0, {
      offset: fragment.offset,
      payload: fragment.payload.slice(),
    });

    if (!fragment.more_fragments) {
      if (reassembly.total_length !== undefined && reassembly.total_length !== end) {
        discard_ip_reassembly(key);
        return;
      }
      if (reassembly.fragments.some((candidate) => candidate.offset >= end)) {
        discard_ip_reassembly(key);
        return;
      }
      reassembly.total_length = end;
    }
    if (reassembly.total_length === undefined || reassembly.fragments[0]?.offset !== 0) return;
    let length = 0;
    for (const candidate of reassembly.fragments) {
      if (candidate.offset !== length) return;
      length += candidate.payload.byteLength;
    }
    if (length !== reassembly.total_length) return;

    const payload = new Uint8Array(length);
    for (const candidate of reassembly.fragments) payload.set(candidate.payload, candidate.offset);
    discard_ip_reassembly(key);
    return {
      source: reassembly.source,
      destination: reassembly.destination,
      protocol: reassembly.protocol,
      payload,
    };
  }

  function receive_frame(frame: Uint8Array) {
    receive_arp(frame);
    const fragment = parse_ip(frame);
    if (!fragment) return;
    const ip = reassemble_ip(fragment);
    if (!ip) return;
    const source_mac = new EthernetHeader(frame).source as unknown as MacAddress;
    if (ip.protocol === IpProtocol.TCP) receive_tcp(ip, source_mac);
    else if (ip.protocol === IpProtocol.UDP) receive_udp(ip);
  }

  const gateway: EthernetPort = ethernet.addPort(receive_frame);

  function connect_tcp(options: TcpConnectOptions): Promise<TcpConnection> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    if (closed) return Promise.reject(new Error("network is closed"));
    if (!valid_port(options.port)) return Promise.reject(new TypeError("invalid TCP port"));
    let address: number;
    try {
      address = ipv4_number(options.hostname);
    } catch (error) {
      return Promise.reject(error);
    }
    const guest = attachments.get(address);
    if (!guest)
      return Promise.reject(new Error(`${options.hostname} is not attached to this network`));
    const port = allocate_port((candidate) =>
      tcp_flows.has(tcp_key(guest.ip, options.port, GATEWAY_IP, candidate)),
    );
    const initial = random_sequence();
    const handshake = Promise.withResolvers<TcpConnection>();
    const key = tcp_key(guest.ip, options.port, GATEWAY_IP, port);
    const flow: TcpFlow = {
      key,
      guest,
      guest_port: options.port,
      peer_ip: GATEWAY_IP,
      peer_port: port,
      send_sequence: sequence_add(initial, 1),
      receive_sequence: 0,
      established: false,
      local_ended: false,
      remote_ended: false,
      closed: false,
      ack_waiters: [],
      window_waiters: [],
      receive_tail: Promise.resolve(),
      advertised_window: TCP_RECEIVE_WINDOW,
      peer_window: 0,
      handshake,
    };
    tcp_flows.set(key, flow);
    expire_tcp_handshake(flow, `timed out connecting to ${options.hostname}:${options.port}`);
    const syn = tcp_segment(GATEWAY_IP, guest.ip, port, options.port, initial, 0, TcpFlag.SYN);
    void send_ip(guest.macAddress, GATEWAY_IP, guest.ip, IpProtocol.TCP, syn).catch((error) => {
      close_tcp_flow(flow, error);
    });
    if (options.signal) {
      const abort = () => abort_tcp_flow(flow, options.signal!.reason);
      options.signal.addEventListener("abort", abort, { once: true });
      flow.remove_external_abort = () => options.signal!.removeEventListener("abort", abort);
      if (options.signal.aborted) abort();
    }
    return handshake.promise;
  }

  function connect_udp(options: UdpConnectOptions): Promise<UdpConnection> {
    if (closed) return Promise.reject(new Error("network is closed"));
    if (!valid_port(options.port)) return Promise.reject(new TypeError("invalid UDP port"));
    let address: number;
    try {
      address = ipv4_number(options.hostname);
    } catch (error) {
      return Promise.reject(error);
    }
    const guest = attachments.get(address);
    if (!guest)
      return Promise.reject(new Error(`${options.hostname} is not attached to this network`));
    const host_port = allocate_port((candidate) =>
      udp_flows.has(udp_key(guest.ip, options.port, candidate)),
    );
    const key = udp_key(guest.ip, options.port, host_port);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        cancel() {
          close();
        },
      },
      {
        highWaterMark: UDP_READABLE_QUEUE_CAP,
        size() {
          return 1;
        },
      },
    );
    const flow: UdpFlow = {
      key,
      guest,
      guest_port: options.port,
      host_port,
      readable,
      controller,
      closed: false,
    };
    udp_flows.set(key, flow);
    const close = () => {
      if (flow.closed) return;
      flow.closed = true;
      udp_flows.delete(key);
      try {
        controller.close();
      } catch {
        // The stream was already cancelled.
      }
    };
    const writable = new WritableStream<Uint8Array>({
      async write(payload) {
        if (flow.closed) throw new Error("UDP connection is closed");
        const datagram = udp_datagram(host_port, options.port, payload);
        await send_ip(guest.macAddress, GATEWAY_IP, guest.ip, IpProtocol.UDP, datagram);
      },
      close,
      abort: close,
    });
    return Promise.resolve({
      readable,
      writable,
      localAddr: { transport: "udp", hostname: GATEWAY_ADDRESS, port: host_port },
      remoteAddr: { transport: "udp", hostname: guest.address, port: options.port },
      close,
    });
  }

  const network: InternalNetwork = {
    gateway: GATEWAY_ADDRESS,
    connect(options: TcpConnectOptions | UdpConnectOptions) {
      return options.transport === "udp" ? connect_udp(options) : connect_tcp(options);
    },
    [do_attach_guest]() {
      if (closed) throw new Error("network is closed");
      if (next_address > 254) throw new Error("network has no guest addresses left");
      const suffix = next_address++;
      const address = `192.0.2.${suffix}`;
      const ip = ipv4_number(address);
      const macAddress: MacAddress = [0x02, 0, 0, 0, 0, suffix];
      const device = ethernetDevice(ethernet, { macAddress });
      let attached = true;
      const attachment: Attachment = {
        address,
        ip,
        macAddress,
        device,
        close() {
          if (!attached) return;
          attached = false;
          attachments.delete(ip);
          for (const flow of tcp_flows.values()) {
            if (flow.guest === attachment)
              abort_tcp_flow(flow, new Error("guest detached from network"));
          }
          for (const flow of udp_flows.values()) {
            if (flow.guest === attachment) {
              flow.closed = true;
              udp_flows.delete(flow.key);
              flow.controller.close();
            }
          }
          for (const [key, reassembly] of ip_reassemblies) {
            if (reassembly.source === ip) discard_ip_reassembly(key);
          }
        },
      };
      attachments.set(ip, attachment);
      return attachment;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const flow of tcp_flows.values()) abort_tcp_flow(flow, new Error("network closed"));
      for (const flow of udp_flows.values()) {
        flow.closed = true;
        flow.controller.close();
      }
      tcp_flows.clear();
      udp_flows.clear();
      for (const key of ip_reassemblies.keys()) discard_ip_reassembly(key);
      attachments.clear();
      gateway.close();
      ethernet.close();
    },
    [Symbol.dispose]() {
      network.close();
    },
  };
  return network;
}

export function attach_guest(network: Network) {
  const attachment = (network as InternalNetwork)[do_attach_guest]();
  const guest_network: GuestNetwork = {
    address: attachment.address,
    connect(options: Omit<TcpConnectOptions, "hostname"> | Omit<UdpConnectOptions, "hostname">) {
      return network.connect({ ...options, hostname: attachment.address } as UdpConnectOptions);
    },
  };
  return { attachment, guest_network };
}
