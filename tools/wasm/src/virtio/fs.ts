// SPDX-License-Identifier: MIT

import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
  type VirtqueueBuffer,
} from "./core.ts";

type MaybePromise<T> = T | PromiseLike<T>;

const utf8 = new TextDecoder("utf-8", { fatal: true });
const utf8_encoder = new TextEncoder();

const FuseOpcode = {
  LOOKUP: 1,
  FORGET: 2,
  GETATTR: 3,
  SETATTR: 4,
  READLINK: 5,
  SYMLINK: 6,
  MKDIR: 9,
  UNLINK: 10,
  RMDIR: 11,
  RENAME: 12,
  OPEN: 14,
  READ: 15,
  WRITE: 16,
  STATFS: 17,
  RELEASE: 18,
  FSYNC: 20,
  FLUSH: 25,
  INIT: 26,
  OPENDIR: 27,
  READDIR: 28,
  RELEASEDIR: 29,
  FSYNCDIR: 30,
  ACCESS: 34,
  CREATE: 35,
  INTERRUPT: 36,
  DESTROY: 38,
  BATCH_FORGET: 42,
} as const;

const FuseInitFlags = {
  ASYNC_READ: 1 << 0,
  BIG_WRITES: 1 << 5,
  AUTO_INVAL_DATA: 1 << 12,
  MAX_PAGES: 1 << 22,
  INIT_EXT: 1 << 30,
} as const;

const FuseGetattrFlags = {
  FH: 1 << 0,
} as const;

const FuseSetattrFlags = {
  MODE: 1 << 0,
  UID: 1 << 1,
  GID: 1 << 2,
  SIZE: 1 << 3,
  ATIME: 1 << 4,
  MTIME: 1 << 5,
  FH: 1 << 6,
  ATIME_NOW: 1 << 7,
  MTIME_NOW: 1 << 8,
  CTIME: 1 << 10,
} as const;

const FileType = {
  fifo: 0o010000,
  character: 0o020000,
  directory: 0o040000,
  block: 0o060000,
  file: 0o100000,
  symlink: 0o120000,
  socket: 0o140000,
} as const;

const DirentType = {
  fifo: 1,
  character: 2,
  directory: 4,
  block: 6,
  file: 8,
  symlink: 10,
  socket: 12,
} as const;

const Errno = {
  EPERM: 1,
  ENOENT: 2,
  EIO: 5,
  EBADF: 9,
  EACCES: 13,
  EEXIST: 17,
  ENOTDIR: 20,
  EISDIR: 21,
  EINVAL: 22,
  ENOSPC: 28,
  EROFS: 30,
  EPROTO: 71,
  ENAMETOOLONG: 36,
  ENOSYS: 38,
  ENOTEMPTY: 39,
  ELOOP: 40,
  EOPNOTSUPP: 95,
} as const;

export type VirtioFileSystemErrorCode = keyof typeof Errno;

/** An expected filesystem failure which should be returned to the guest. */
export class VirtioFileSystemError extends Error {
  readonly errno: number;

  constructor(code: VirtioFileSystemErrorCode, message: string = code) {
    super(message);
    this.name = "VirtioFileSystemError";
    this.errno = Errno[code];
  }
}

/** An opaque filesystem node. Backends may attach any private state to it. */
export type VirtioFileSystemNode = object;

/** An opaque open file or directory handle. */
export type VirtioFileSystemHandle = object;

export interface VirtioFileSystemTimestamp {
  seconds: bigint;
  nanoseconds?: number;
}

/**
 * Unix metadata presented to the guest. `mode` includes both the file type
 * bits and permissions (for example `0o100644` for a regular file).
 */
export interface VirtioFileSystemAttributes {
  mode: number;
  size: bigint;
  atime?: VirtioFileSystemTimestamp;
  mtime?: VirtioFileSystemTimestamp;
  ctime?: VirtioFileSystemTimestamp;
  blocks?: bigint;
  nlink?: number;
  uid?: number;
  gid?: number;
  rdev?: number;
  blockSize?: number;
}

export interface VirtioFileSystemSetAttributes {
  mode?: number;
  size?: bigint;
  uid?: number;
  gid?: number;
  atime?: VirtioFileSystemTimestamp | "now";
  mtime?: VirtioFileSystemTimestamp | "now";
  ctime?: VirtioFileSystemTimestamp;
}

export interface VirtioFileSystemDirectoryEntry {
  name: string;
  node: VirtioFileSystemNode;
}

export interface VirtioFileSystemStat {
  blocks?: bigint;
  blocksFree?: bigint;
  blocksAvailable?: bigint;
  files?: bigint;
  filesFree?: bigint;
  blockSize?: number;
  fragmentSize?: number;
  nameLength?: number;
}

/**
 * The host-side filesystem contract used by virtio-fs.
 *
 * Names are single, valid UTF-8 path components. Methods which are absent are
 * reported to the guest as unsupported; sync methods may return promises.
 */
export interface VirtioFileSystem {
  readonly root: VirtioFileSystemNode;
  lookup(
    parent: VirtioFileSystemNode,
    name: string,
  ): MaybePromise<VirtioFileSystemNode | undefined>;
  getattr(
    node: VirtioFileSystemNode,
    handle?: VirtioFileSystemHandle,
  ): MaybePromise<VirtioFileSystemAttributes>;
  setattr?(
    node: VirtioFileSystemNode,
    attributes: VirtioFileSystemSetAttributes,
    handle?: VirtioFileSystemHandle,
  ): MaybePromise<VirtioFileSystemAttributes>;
  readlink?(node: VirtioFileSystemNode): MaybePromise<string>;
  symlink?(
    parent: VirtioFileSystemNode,
    name: string,
    target: string,
    context: VirtioFileSystemCreateContext,
  ): MaybePromise<VirtioFileSystemNode>;
  mkdir?(
    parent: VirtioFileSystemNode,
    name: string,
    context: VirtioFileSystemCreateContext,
  ): MaybePromise<VirtioFileSystemNode>;
  unlink?(parent: VirtioFileSystemNode, name: string): MaybePromise<void>;
  rmdir?(parent: VirtioFileSystemNode, name: string): MaybePromise<void>;
  rename?(
    oldParent: VirtioFileSystemNode,
    oldName: string,
    newParent: VirtioFileSystemNode,
    newName: string,
  ): MaybePromise<void>;
  open?(
    node: VirtioFileSystemNode,
    flags: number,
  ): MaybePromise<VirtioFileSystemHandle>;
  create?(
    parent: VirtioFileSystemNode,
    name: string,
    flags: number,
    context: VirtioFileSystemCreateContext,
  ): MaybePromise<{
    node: VirtioFileSystemNode;
    handle: VirtioFileSystemHandle;
  }>;
  read?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
    offset: bigint,
    length: number,
  ): MaybePromise<Uint8Array>;
  write?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
    offset: bigint,
    data: Uint8Array,
  ): MaybePromise<number>;
  flush?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
  ): MaybePromise<void>;
  fsync?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
    dataOnly: boolean,
  ): MaybePromise<void>;
  release?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
  ): MaybePromise<void>;
  opendir?(
    node: VirtioFileSystemNode,
    flags: number,
  ): MaybePromise<VirtioFileSystemHandle>;
  readdir?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
  ): MaybePromise<Iterable<VirtioFileSystemDirectoryEntry> | AsyncIterable<VirtioFileSystemDirectoryEntry>>;
  releasedir?(
    node: VirtioFileSystemNode,
    handle: VirtioFileSystemHandle,
  ): MaybePromise<void>;
  access?(node: VirtioFileSystemNode, mask: number): MaybePromise<void>;
  statfs?(node: VirtioFileSystemNode): MaybePromise<VirtioFileSystemStat>;
  destroy?(): MaybePromise<void>;
}

export interface VirtioFileSystemCreateContext {
  mode: number;
  uid: number;
  gid: number;
}

interface NodeRecord {
  id: bigint;
  node: VirtioFileSystemNode;
  parent: NodeRecord;
  lookups: bigint;
  handles: number;
  children: number;
}

interface HandleRecord {
  node: NodeRecord;
  handle: VirtioFileSystemHandle;
  directory: boolean;
}

interface RequestHeader {
  len: number;
  opcode: number;
  unique: bigint;
  nodeid: bigint;
  uid: number;
  gid: number;
}

class Input {
  readonly array: Uint8Array;
  readonly view: DataView;
  offset = 0;

  constructor(array: Uint8Array) {
    this.array = array;
    this.view = new DataView(array.buffer, array.byteOffset, array.byteLength);
  }

  #take(length: number) {
    if (length < 0 || this.offset + length > this.array.byteLength) {
      throw new VirtioFileSystemError("EINVAL", "truncated FUSE request");
    }
    const offset = this.offset;
    this.offset += length;
    return offset;
  }

  u32() {
    return this.view.getUint32(this.#take(4), true);
  }

  u64() {
    return this.view.getBigUint64(this.#take(8), true);
  }

  skip(length: number) {
    this.#take(length);
  }

  bytes(length: number) {
    const offset = this.#take(length);
    return this.array.subarray(offset, offset + length);
  }

  string() {
    const end = this.array.indexOf(0, this.offset);
    if (end < 0) {
      throw new VirtioFileSystemError("EINVAL", "unterminated FUSE string");
    }
    const bytes = this.bytes(end - this.offset);
    this.skip(1);
    try {
      return utf8.decode(bytes);
    } catch {
      throw new VirtioFileSystemError("EINVAL", "filename is not valid UTF-8");
    }
  }
}

class Output {
  #array: Uint8Array;
  #view: DataView;
  offset = 0;

  constructor(length: number) {
    this.#array = new Uint8Array(length);
    this.#view = new DataView(this.#array.buffer);
  }

  get array() {
    return this.#array.subarray(0, this.offset);
  }

  u16(value: number) {
    this.#view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  i32(value: number) {
    this.#view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  u32(value: number) {
    this.#view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  u64(value: bigint) {
    this.#view.setBigUint64(this.offset, value, true);
    this.offset += 8;
  }

  bytes(value: Uint8Array) {
    this.#array.set(value, this.offset);
    this.offset += value.byteLength;
  }

  zero(length: number) {
    this.offset += length;
  }

  align(alignment: number) {
    this.zero((-this.offset) & (alignment - 1));
  }
}

class UnsupportedOperation extends VirtioFileSystemError {
  constructor() {
    super("ENOSYS");
  }
}

function mode_type(mode: number): keyof typeof DirentType {
  switch (mode & 0o170000) {
    case FileType.fifo:
      return "fifo";
    case FileType.character:
      return "character";
    case FileType.directory:
      return "directory";
    case FileType.block:
      return "block";
    case FileType.file:
      return "file";
    case FileType.symlink:
      return "symlink";
    case FileType.socket:
      return "socket";
    default:
      throw new VirtioFileSystemError("EIO", "filesystem returned an invalid mode");
  }
}

function checked_number(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new VirtioFileSystemError("EINVAL", "offset exceeds JavaScript's integer range");
  }
  return number;
}

function validate_name(name: string) {
  if (
    name.length === 0 || name === "." || name === ".." || name.includes("/") ||
    name.includes("\0")
  ) {
    throw new VirtioFileSystemError("EINVAL", "invalid path component");
  }
  if (utf8_encoder.encode(name).byteLength > 255) {
    throw new VirtioFileSystemError("ENAMETOOLONG");
  }
  return name;
}

function concatenate(buffers: readonly VirtqueueBuffer[], writable: boolean) {
  const selected = buffers.filter((buffer) => buffer.writable === writable);
  const length = selected.reduce((total, buffer) => total + buffer.array.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const buffer of selected) {
    result.set(buffer.array, offset);
    offset += buffer.array.byteLength;
  }
  return result;
}

function scatter(buffers: readonly VirtqueueBuffer[], data: Uint8Array) {
  let offset = 0;
  for (const buffer of buffers) {
    if (!buffer.writable) continue;
    const length = Math.min(buffer.array.byteLength, data.byteLength - offset);
    if (length <= 0) break;
    buffer.array.set(data.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== data.byteLength) {
    throw new Error("guest response buffers are too small");
  }
}

function minimum_response_capacity(opcode: number) {
  switch (opcode) {
    case FuseOpcode.FORGET:
    case FuseOpcode.BATCH_FORGET:
    case FuseOpcode.INTERRUPT:
      return 0;
    case FuseOpcode.INIT:
      return 80;
    case FuseOpcode.LOOKUP:
    case FuseOpcode.SYMLINK:
    case FuseOpcode.MKDIR:
      return 144;
    case FuseOpcode.GETATTR:
    case FuseOpcode.SETATTR:
      return 120;
    case FuseOpcode.OPEN:
    case FuseOpcode.OPENDIR:
      return 32;
    case FuseOpcode.CREATE:
      return 160;
    case FuseOpcode.WRITE:
      return 24;
    case FuseOpcode.STATFS:
      return 96;
    default:
      return 16;
  }
}

function request_header(input: Input): RequestHeader {
  const result = {
    len: input.u32(),
    opcode: input.u32(),
    unique: input.u64(),
    nodeid: input.u64(),
    uid: input.u32(),
    gid: input.u32(),
  };
  // pid, total_extlen, padding
  input.skip(8);
  return result;
}

function response_header(output: Output, unique: bigint, error: number, length: number) {
  output.u32(length);
  output.i32(error);
  output.u64(unique);
}

function timestamp(
  value: VirtioFileSystemTimestamp | undefined,
): [bigint, number] {
  return [value?.seconds ?? 0n, value?.nanoseconds ?? 0];
}

function write_attr(
  output: Output,
  nodeid: bigint,
  attributes: VirtioFileSystemAttributes,
) {
  const [atime, atimensec] = timestamp(attributes.atime);
  const [mtime, mtimensec] = timestamp(attributes.mtime);
  const [ctime, ctimensec] = timestamp(attributes.ctime);
  output.u64(nodeid);
  output.u64(attributes.size);
  output.u64(attributes.blocks ?? (attributes.size + 511n) / 512n);
  output.u64(atime);
  output.u64(mtime);
  output.u64(ctime);
  output.u32(atimensec);
  output.u32(mtimensec);
  output.u32(ctimensec);
  output.u32(attributes.mode);
  output.u32(attributes.nlink ?? (mode_type(attributes.mode) === "directory" ? 2 : 1));
  output.u32(attributes.uid ?? 0);
  output.u32(attributes.gid ?? 0);
  output.u32(attributes.rdev ?? 0);
  output.u32(attributes.blockSize ?? 4096);
  output.u32(0);
}

function write_entry(
  output: Output,
  record: NodeRecord,
  attributes: VirtioFileSystemAttributes,
  validity: bigint,
) {
  output.u64(record.id);
  output.u64(1n);
  output.u64(validity);
  output.u64(validity);
  output.u32(0);
  output.u32(0);
  write_attr(output, record.id, attributes);
}

function create_context(
  header: RequestHeader,
  mode: number,
  umask: number,
): VirtioFileSystemCreateContext {
  return {
    mode: mode & ~umask,
    uid: header.uid,
    gid: header.gid,
  };
}

async function async_iterable<T>(
  source: Iterable<T> | AsyncIterable<T>,
): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}

export interface VirtioFileSystemDeviceOptions {
  /** Mount tag advertised to the guest. */
  tag: string;
  /**
   * Cache metadata and names in the guest for one second. Defaults to true.
   *
   * When false, FUSE entry and attribute validity are zero. This does not
   * disable the guest data page cache and does not provide direct I/O.
   */
  cache?: boolean;
}

/**
 * Creates a virtio-fs device backed by a JavaScript filesystem object.
 *
 * Cached devices use one-second metadata/name validity; `cache: false` uses
 * zero validity. Both retain the guest data page cache. This transport does not
 * advertise direct I/O: upstream virtio-fs extracts the caller's user pages,
 * while wasm process memory is private to its owner worker and cannot be placed
 * directly on the shared virtqueue. Supporting it would require a separate
 * kernel bounce-buffer implementation.
 *
 * Neither policy enables DAX or a writeback cache.
 */
export function virtioFileSystemDevice(
  filesystem: VirtioFileSystem,
  options: VirtioFileSystemDeviceOptions,
): VirtioDevice {
  const { tag, cache = true } = options;
  const validity = cache ? 1n : 0n;
  const encoded_tag = utf8_encoder.encode(tag);
  if (encoded_tag.byteLength === 0 || encoded_tag.byteLength > 36) {
    throw new RangeError("virtio-fs tag must be between 1 and 36 UTF-8 bytes");
  }

  const config = new Uint8Array(40);
  config.set(encoded_tag);
  new DataView(config.buffer).setUint32(36, 1, true);

  const records = new Map<bigint, NodeRecord>();
  const by_node = new WeakMap<object, NodeRecord>();
  let next_nodeid = 2n;
  const root: NodeRecord = {
    id: 1n,
    node: filesystem.root,
    parent: undefined as unknown as NodeRecord,
    lookups: 1n,
    handles: 0,
    children: 0,
  };
  root.parent = root;
  records.set(root.id, root);
  by_node.set(filesystem.root, root);

  const handles = new Map<bigint, HandleRecord>();
  let next_handle = 1n;
  let finalize_promise: Promise<void> | undefined;

  function record_for_node(node: VirtioFileSystemNode, parent: NodeRecord) {
    let record = by_node.get(node);
    if (!record) {
      record = {
        id: next_nodeid++,
        node,
        parent,
        lookups: 0n,
        handles: 0,
        children: 0,
      };
      records.set(record.id, record);
      by_node.set(node, record);
      parent.children += 1;
    }
    return record;
  }

  function collect_record(record: NodeRecord) {
    if (records.get(record.id) !== record) return;
    if (
      record !== root &&
      record.lookups === 0n &&
      record.handles === 0 &&
      record.children === 0
    ) {
      records.delete(record.id);
      by_node.delete(record.node);
      record.parent.children -= 1;
      collect_record(record.parent);
    }
  }

  function forget(record: NodeRecord, count: bigint) {
    record.lookups = count >= record.lookups ? 0n : record.lookups - count;
    collect_record(record);
  }

  function node_record(nodeid: bigint) {
    const record = records.get(nodeid);
    if (!record) throw new VirtioFileSystemError("ENOENT");
    return record;
  }

  function handle_record(fh: bigint, directory?: boolean, node?: NodeRecord) {
    const record = handles.get(fh);
    if (
      !record ||
      (directory !== undefined && record.directory !== directory) ||
      (node !== undefined && record.node !== node)
    ) {
      throw new VirtioFileSystemError("EBADF");
    }
    return record;
  }

  function add_handle(
    node: NodeRecord,
    handle: VirtioFileSystemHandle,
    directory: boolean,
  ) {
    const fh = next_handle++;
    handles.set(fh, { node, handle, directory });
    node.handles += 1;
    return fh;
  }

  function remove_handle(fh: bigint, handle: HandleRecord) {
    handles.delete(fh);
    handle.node.handles -= 1;
    collect_record(handle.node);
  }

  function finalize() {
    if (finalize_promise) return finalize_promise;
    finalize_promise = (async () => {
      let failed = false;
      let first_error: unknown;
      for (const [fh, handle] of handles) {
        try {
          if (handle.directory) {
            await filesystem.releasedir?.(handle.node.node, handle.handle);
          } else {
            await filesystem.release?.(handle.node.node, handle.handle);
          }
        } catch (error) {
          if (!failed) {
            failed = true;
            first_error = error;
          }
        } finally {
          remove_handle(fh, handle);
        }
      }
      try {
        await filesystem.destroy?.();
      } catch (error) {
        if (!failed) {
          failed = true;
          first_error = error;
        }
      }
      if (failed) throw first_error;
    })();
    return finalize_promise;
  }

  async function lookup(parent: NodeRecord, name: string) {
    const node = await filesystem.lookup(parent.node, validate_name(name));
    if (!node) throw new VirtioFileSystemError("ENOENT");
    const record = record_for_node(node, parent);
    record.lookups += 1n;
    return record;
  }

  async function process(header: RequestHeader, body: Input, capacity: number) {
    const payload = new Output(Math.max(0, capacity - 16));
    const node = header.nodeid === 0n ? undefined : node_record(header.nodeid);

    switch (header.opcode) {
      case FuseOpcode.INIT: {
        const major = body.u32();
        const minor = body.u32();
        const max_readahead = body.u32();
        const offered_flags = body.u32();
        if (major !== 7) {
          if (major < 7) throw new VirtioFileSystemError("EPROTO");
          payload.u32(7);
          payload.u32(45);
          break;
        }
        const supported_flags = FuseInitFlags.ASYNC_READ |
          FuseInitFlags.BIG_WRITES |
          FuseInitFlags.AUTO_INVAL_DATA |
          FuseInitFlags.MAX_PAGES |
          FuseInitFlags.INIT_EXT;
        const flags = offered_flags & supported_flags;
        payload.u32(7);
        payload.u32(Math.min(minor, 45));
        payload.u32(Math.min(max_readahead, 1024 * 1024));
        payload.u32(flags);
        payload.u16(12);
        payload.u16(9);
        payload.u32(1024 * 1024);
        payload.u32(1);
        payload.u16((flags & FuseInitFlags.MAX_PAGES) === 0 ? 0 : 16);
        payload.u16(0);
        payload.u32(0);
        payload.u32(0);
        payload.u16(0);
        payload.zero(22);
        break;
      }
      case FuseOpcode.LOOKUP: {
        const record = await lookup(node!, body.string());
        write_entry(payload, record, await filesystem.getattr(record.node), validity);
        break;
      }
      case FuseOpcode.FORGET: {
        forget(node!, body.u64());
        return undefined;
      }
      case FuseOpcode.BATCH_FORGET: {
        const count = body.u32();
        body.skip(4);
        const forgotten: { record: NodeRecord; count: bigint }[] = [];
        for (let index = 0; index < count; index++) {
          const record = records.get(body.u64());
          const count = body.u64();
          if (record) forgotten.push({ record, count });
        }
        for (const entry of forgotten) forget(entry.record, entry.count);
        return undefined;
      }
      case FuseOpcode.GETATTR: {
        const flags = body.u32();
        body.skip(4);
        const fh = body.u64();
        const handle = flags & FuseGetattrFlags.FH
          ? handle_record(fh, undefined, node!).handle
          : undefined;
        payload.u64(validity);
        payload.u32(0);
        payload.u32(0);
        write_attr(payload, node!.id, await filesystem.getattr(node!.node, handle));
        break;
      }
      case FuseOpcode.SETATTR: {
        if (!filesystem.setattr) throw new UnsupportedOperation();
        const valid = body.u32();
        body.skip(4);
        const fh = body.u64();
        const size = body.u64();
        body.skip(8);
        const atime = body.u64();
        const mtime = body.u64();
        const ctime = body.u64();
        const atimensec = body.u32();
        const mtimensec = body.u32();
        const ctimensec = body.u32();
        const mode = body.u32();
        body.skip(4);
        const uid = body.u32();
        const gid = body.u32();
        body.skip(4);
        const changes: VirtioFileSystemSetAttributes = {};
        if (valid & FuseSetattrFlags.MODE) changes.mode = mode;
        if (valid & FuseSetattrFlags.UID) changes.uid = uid;
        if (valid & FuseSetattrFlags.GID) changes.gid = gid;
        if (valid & FuseSetattrFlags.SIZE) changes.size = size;
        if (valid & FuseSetattrFlags.ATIME) {
          changes.atime = valid & FuseSetattrFlags.ATIME_NOW
            ? "now"
            : { seconds: atime, nanoseconds: atimensec };
        }
        if (valid & FuseSetattrFlags.MTIME) {
          changes.mtime = valid & FuseSetattrFlags.MTIME_NOW
            ? "now"
            : { seconds: mtime, nanoseconds: mtimensec };
        }
        if (valid & FuseSetattrFlags.CTIME) {
          changes.ctime = { seconds: ctime, nanoseconds: ctimensec };
        }
        const open = valid & FuseSetattrFlags.FH
          ? handle_record(fh, undefined, node!).handle
          : undefined;
        const attributes = await filesystem.setattr(node!.node, changes, open);
        payload.u64(validity);
        payload.u32(0);
        payload.u32(0);
        write_attr(payload, node!.id, attributes);
        break;
      }
      case FuseOpcode.READLINK: {
        if (!filesystem.readlink) throw new UnsupportedOperation();
        payload.bytes(utf8_encoder.encode(await filesystem.readlink(node!.node)));
        break;
      }
      case FuseOpcode.SYMLINK: {
        if (!filesystem.symlink) throw new UnsupportedOperation();
        const name = validate_name(body.string());
        const target = body.string();
        const linked = await filesystem.symlink(
          node!.node,
          name,
          target,
          create_context(header, FileType.symlink | 0o777, 0),
        );
        const record = record_for_node(linked, node!);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(linked), validity);
        break;
      }
      case FuseOpcode.MKDIR: {
        if (!filesystem.mkdir) throw new UnsupportedOperation();
        const mode = body.u32();
        const umask = body.u32();
        const made = await filesystem.mkdir(
          node!.node,
          validate_name(body.string()),
          create_context(header, FileType.directory | mode, umask),
        );
        const record = record_for_node(made, node!);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(made), validity);
        break;
      }
      case FuseOpcode.UNLINK:
      case FuseOpcode.RMDIR: {
        const method = header.opcode === FuseOpcode.UNLINK
          ? filesystem.unlink
          : filesystem.rmdir;
        if (!method) throw new UnsupportedOperation();
        await method.call(filesystem, node!.node, validate_name(body.string()));
        break;
      }
      case FuseOpcode.RENAME: {
        if (!filesystem.rename) throw new UnsupportedOperation();
        const new_parent = node_record(body.u64());
        const old_name = validate_name(body.string());
        const new_name = validate_name(body.string());
        const moved = node === new_parent
          ? undefined
          : await filesystem.lookup(node!.node, old_name);
        const moved_record = moved && by_node.get(moved);
        await filesystem.rename(
          node!.node,
          old_name,
          new_parent.node,
          new_name,
        );
        if (
          moved_record &&
          records.get(moved_record.id) === moved_record &&
          moved_record.parent !== new_parent
        ) {
          const old_parent = moved_record.parent;
          old_parent.children -= 1;
          moved_record.parent = new_parent;
          new_parent.children += 1;
          collect_record(old_parent);
        }
        break;
      }
      case FuseOpcode.OPEN:
      case FuseOpcode.OPENDIR: {
        const directory = header.opcode === FuseOpcode.OPENDIR;
        const method = directory ? filesystem.opendir : filesystem.open;
        if (!method) throw new UnsupportedOperation();
        const flags = body.u32();
        body.skip(4);
        const handle = await method.call(filesystem, node!.node, flags);
        payload.u64(add_handle(node!, handle, directory));
        // Keep open flags zero even when cache is false. Cache controls only
        // entry/attribute validity; FOPEN_DIRECT_IO would route private
        // owner-worker user buffers through unsupported page extraction.
        payload.u32(0);
        payload.i32(-1);
        break;
      }
      case FuseOpcode.CREATE: {
        if (!filesystem.create) throw new UnsupportedOperation();
        const flags = body.u32();
        const mode = body.u32();
        const umask = body.u32();
        body.skip(4);
        const created = await filesystem.create(
          node!.node,
          validate_name(body.string()),
          flags,
          create_context(header, FileType.file | mode, umask),
        );
        const record = record_for_node(created.node, node!);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(created.node), validity);
        payload.u64(add_handle(record, created.handle, false));
        // CREATE returns the same open flags as OPEN; direct I/O is unsupported
        // by this wasm transport even when metadata/name validity is zero.
        payload.u32(0);
        payload.i32(-1);
        break;
      }
      case FuseOpcode.READ: {
        if (!filesystem.read) throw new UnsupportedOperation();
        const fh = body.u64();
        const offset = body.u64();
        const size = body.u32();
        const handle = handle_record(fh, false, node!);
        const data = await filesystem.read(
          handle.node.node,
          handle.handle,
          offset,
          Math.min(size, capacity - 16),
        );
        if (data.byteLength > size || data.byteLength > capacity - 16) {
          throw new VirtioFileSystemError("EIO", "filesystem returned too much data");
        }
        payload.bytes(data);
        break;
      }
      case FuseOpcode.WRITE: {
        if (!filesystem.write) throw new UnsupportedOperation();
        const fh = body.u64();
        const offset = body.u64();
        const size = body.u32();
        body.skip(20);
        const data = body.bytes(size);
        const handle = handle_record(fh, false, node!);
        const written = await filesystem.write(
          handle.node.node,
          handle.handle,
          offset,
          data,
        );
        if (!Number.isInteger(written) || written < 0 || written > size) {
          throw new VirtioFileSystemError("EIO", "filesystem returned an invalid write size");
        }
        payload.u32(written);
        payload.u32(0);
        break;
      }
      case FuseOpcode.FLUSH: {
        const handle = handle_record(body.u64(), false, node!);
        if (filesystem.flush) {
          await filesystem.flush(handle.node.node, handle.handle);
        }
        break;
      }
      case FuseOpcode.FSYNC:
      case FuseOpcode.FSYNCDIR: {
        const handle = handle_record(
          body.u64(),
          header.opcode === FuseOpcode.FSYNCDIR,
          node!,
        );
        const flags = (body.skip(0), body.u32());
        if (filesystem.fsync) {
          await filesystem.fsync(handle.node.node, handle.handle, (flags & 1) !== 0);
        }
        break;
      }
      case FuseOpcode.RELEASE:
      case FuseOpcode.RELEASEDIR: {
        const directory = header.opcode === FuseOpcode.RELEASEDIR;
        const fh = body.u64();
        const handle = handle_record(fh, directory, node!);
        if (directory) {
          await filesystem.releasedir?.(handle.node.node, handle.handle);
        } else {
          await filesystem.release?.(handle.node.node, handle.handle);
        }
        remove_handle(fh, handle);
        break;
      }
      case FuseOpcode.READDIR: {
        if (!filesystem.readdir) throw new UnsupportedOperation();
        const fh = body.u64();
        const offset = checked_number(body.u64());
        const size = body.u32();
        const handle = handle_record(fh, true, node!);
        const entries = [
          { name: ".", record: handle.node },
          { name: "..", record: handle.node.parent },
        ];
        const directory_entries = await filesystem.readdir(
          handle.node.node,
          handle.handle,
        );
        const transient: NodeRecord[] = [];
        const limit = Math.min(size, capacity - 16);
        try {
          for (const entry of await async_iterable(directory_entries)) {
            const record = record_for_node(entry.node, handle.node);
            transient.push(record);
            entries.push({
              name: validate_name(entry.name),
              record,
            });
          }
          for (let index = offset; index < entries.length; index++) {
            const entry = entries[index]!;
            const name = utf8_encoder.encode(entry.name);
            const record_length = (24 + name.byteLength + 7) & ~7;
            if (payload.offset + record_length > limit) break;
            const attributes = await filesystem.getattr(entry.record.node);
            payload.u64(entry.record.id);
            payload.u64(BigInt(index + 1));
            payload.u32(name.byteLength);
            payload.u32(DirentType[mode_type(attributes.mode)]);
            payload.bytes(name);
            payload.align(8);
          }
        } finally {
          for (const record of transient) collect_record(record);
        }
        break;
      }
      case FuseOpcode.STATFS: {
        const stat = await filesystem.statfs?.(node!.node) ?? {};
        payload.u64(stat.blocks ?? 0n);
        payload.u64(stat.blocksFree ?? 0n);
        payload.u64(stat.blocksAvailable ?? 0n);
        payload.u64(stat.files ?? 0n);
        payload.u64(stat.filesFree ?? 0n);
        payload.u32(stat.blockSize ?? 4096);
        payload.u32(stat.nameLength ?? 255);
        payload.u32(stat.fragmentSize ?? stat.blockSize ?? 4096);
        payload.u32(0);
        payload.zero(24);
        break;
      }
      case FuseOpcode.ACCESS: {
        const mask = body.u32();
        if (filesystem.access) await filesystem.access(node!.node, mask);
        break;
      }
      case FuseOpcode.INTERRUPT:
        return undefined;
      case FuseOpcode.DESTROY:
        await finalize();
        break;
      default:
        throw new UnsupportedOperation();
    }
    return payload.array;
  }

  async function notify(queue: Virtqueue) {
    for (const chain of queue) {
      const buffers = [...chain];
      const request = concatenate(buffers, false);
      const capacity = buffers
        .filter((buffer) => buffer.writable)
        .reduce((total, buffer) => total + buffer.array.byteLength, 0);
      let unique = 0n;
      try {
        let saw_writable = false;
        for (const buffer of buffers) {
          if (!buffer.writable && saw_writable) {
            throw new VirtioFileSystemError("EINVAL", "readable descriptor follows response");
          }
          saw_writable ||= buffer.writable;
        }
        const input = new Input(request);
        const header = request_header(input);
        unique = header.unique;
        if (header.len !== request.byteLength || header.len < 40) {
          throw new VirtioFileSystemError("EINVAL", "invalid FUSE request length");
        }
        if (capacity < minimum_response_capacity(header.opcode)) {
          throw new VirtioFileSystemError("EINVAL", "FUSE response buffer is too small");
        }
        const payload = await process(header, input, capacity);
        if (payload === undefined) {
          chain.release(0);
          continue;
        }
        const response = new Output(16 + payload.byteLength);
        response_header(response, unique, 0, 16 + payload.byteLength);
        response.bytes(payload);
        scatter(buffers, response.array);
        chain.release(response.array.byteLength);
      } catch (error) {
        if (capacity < 16) {
          chain.release(0);
          continue;
        }
        const response = new Output(16);
        const errno = error instanceof VirtioFileSystemError ? error.errno : Errno.EIO;
        response_header(response, unique, -errno, 16);
        scatter(buffers, response.array);
        chain.release(16);
      }
    }
  }

  return new VirtioController(
    { deviceId: 26, config },
    { queues: [notify, notify], close: finalize },
  ).device;
}
