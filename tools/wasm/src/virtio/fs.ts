// SPDX-License-Identifier: MIT
//
// The host side of a virtio-fs device. Requests and responses are the FUSE
// ABI as wired into the virtio-fs transport; the wire structs below mirror
// `include/uapi/linux/fuse.h` from the kernel this ships with. Fields are
// little-endian and every fixed-layout struct is padded to a 64-bit boundary.

import {
  Bytes,
  FixedArray,
  Reader,
  Struct,
  U16LE,
  U32LE,
  U64LE,
  I32LE,
} from "../bytes.ts";
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

export type FSErrorCode = keyof typeof Errno;

/** An expected filesystem failure which should be returned to the guest. */
export class FSError extends Error {
  readonly errno: number;

  constructor(code: FSErrorCode, message: string = code) {
    super(message);
    this.name = "FSError";
    this.errno = Errno[code];
  }
}

export interface FSTimestamp {
  seconds: bigint;
  nanoseconds?: number;
}

/**
 * Unix metadata presented to the guest. `mode` includes both the file type
 * bits and permissions (for example `0o100644` for a regular file).
 */
export interface FSAttributes {
  mode: number;
  size: bigint;
  atime?: FSTimestamp;
  mtime?: FSTimestamp;
  ctime?: FSTimestamp;
  blocks?: bigint;
  nlink?: number;
  uid?: number;
  gid?: number;
  rdev?: number;
  blockSize?: number;
}

export interface FSSetAttributes {
  mode?: number;
  size?: bigint;
  uid?: number;
  gid?: number;
  atime?: FSTimestamp | "now";
  mtime?: FSTimestamp | "now";
  ctime?: FSTimestamp;
}

export interface FSDirectoryEntry<TNode> {
  name: string;
  node: TNode;
}

export interface FSStat {
  blocks?: bigint;
  blocksFree?: bigint;
  blocksAvailable?: bigint;
  files?: bigint;
  filesFree?: bigint;
  blockSize?: number;
  fragmentSize?: number;
  nameLength?: number;
}

export interface FSCreateContext {
  mode: number;
  uid: number;
  gid: number;
}

/**
 * The host-side filesystem contract used by virtio-fs.
 *
 * Names are single, valid UTF-8 path components. Methods which are absent are
 * reported to the guest as unsupported; sync methods may return promises.
 *
 * `TNode` and `THandle` are the backend's node and open-file types; the device
 * never inspects them. A writable backend (one providing `write` or `create`)
 * must also provide `flush` and `fsync` — no-ops are the explicit way to
 * declare an already-durable or ephemeral store.
 */
export interface FS<TNode, THandle> {
  readonly root: TNode;
  lookup(
    parent: TNode,
    name: string,
  ): MaybePromise<TNode | undefined>;
  getattr(
    node: TNode,
    handle?: THandle,
  ): MaybePromise<FSAttributes>;
  setattr?(
    node: TNode,
    attributes: FSSetAttributes,
    handle?: THandle,
  ): MaybePromise<FSAttributes>;
  readlink?(node: TNode): MaybePromise<string>;
  symlink?(
    parent: TNode,
    name: string,
    target: string,
    context: FSCreateContext,
  ): MaybePromise<TNode>;
  mkdir?(
    parent: TNode,
    name: string,
    context: FSCreateContext,
  ): MaybePromise<TNode>;
  unlink?(parent: TNode, name: string): MaybePromise<void>;
  rmdir?(parent: TNode, name: string): MaybePromise<void>;
  rename?(
    oldParent: TNode,
    oldName: string,
    newParent: TNode,
    newName: string,
  ): MaybePromise<void>;
  open?(
    node: TNode,
    flags: number,
  ): MaybePromise<THandle>;
  create?(
    parent: TNode,
    name: string,
    flags: number,
    context: FSCreateContext,
  ): MaybePromise<{
    node: TNode;
    handle: THandle;
  }>;
  read?(
    node: TNode,
    handle: THandle,
    offset: bigint,
    length: number,
  ): MaybePromise<Uint8Array>;
  write?(
    node: TNode,
    handle: THandle,
    offset: bigint,
    data: Uint8Array,
  ): MaybePromise<number>;
  flush?(
    node: TNode,
    handle: THandle,
  ): MaybePromise<void>;
  fsync?(
    node: TNode,
    handle: THandle,
    dataOnly: boolean,
  ): MaybePromise<void>;
  release?(
    node: TNode,
    handle: THandle,
  ): MaybePromise<void>;
  opendir?(
    node: TNode,
    flags: number,
  ): MaybePromise<THandle>;
  readdir?(
    node: TNode,
    handle: THandle,
  ): MaybePromise<Iterable<FSDirectoryEntry<TNode>> | AsyncIterable<FSDirectoryEntry<TNode>>>;
  releasedir?(
    node: TNode,
    handle: THandle,
  ): MaybePromise<void>;
  access?(node: TNode, mask: number): MaybePromise<void>;
  statfs?(node: TNode): MaybePromise<FSStat>;
  destroy?(): MaybePromise<void>;
}

export interface FSDeviceOptions {
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

// The FUSE request and response structs, mirroring include/uapi/linux/fuse.h.
const FuseInHeader = Struct({
  len: U32LE,
  opcode: U32LE,
  unique: U64LE,
  nodeid: U64LE,
  uid: U32LE,
  gid: U32LE,
  pid: U32LE,
  total_extlen: U16LE,
  padding: U16LE,
});
type FuseInHeaderValue = InstanceType<typeof FuseInHeader>;

const FuseOutHeader = Struct({
  len: U32LE,
  error: I32LE,
  unique: U64LE,
});

const FuseAttr = Struct({
  ino: U64LE,
  size: U64LE,
  blocks: U64LE,
  atime: U64LE,
  mtime: U64LE,
  ctime: U64LE,
  atimensec: U32LE,
  mtimensec: U32LE,
  ctimensec: U32LE,
  mode: U32LE,
  nlink: U32LE,
  uid: U32LE,
  gid: U32LE,
  rdev: U32LE,
  blksize: U32LE,
  flags: U32LE,
});

const FuseEntryOut = Struct({
  nodeid: U64LE,
  generation: U64LE,
  entry_valid: U64LE,
  attr_valid: U64LE,
  entry_valid_nsec: U32LE,
  attr_valid_nsec: U32LE,
  attr: FuseAttr,
});

const FuseAttrOut = Struct({
  attr_valid: U64LE,
  attr_valid_nsec: U32LE,
  dummy: U32LE,
  attr: FuseAttr,
});

const FuseOpenOut = Struct({
  fh: U64LE,
  open_flags: U32LE,
  backing_id: I32LE,
});

const FuseInitOut = Struct({
  major: U32LE,
  minor: U32LE,
  max_readahead: U32LE,
  flags: U32LE,
  max_background: U16LE,
  congestion_threshold: U16LE,
  max_write: U32LE,
  time_gran: U32LE,
  max_pages: U16LE,
  map_alignment: U16LE,
  flags2: U32LE,
  max_stack_depth: U32LE,
  request_timeout: U16LE,
  unused: FixedArray(U16LE, 11),
});

const FuseWriteOut = Struct({
  size: U32LE,
  padding: U32LE,
});

const FuseStatfsOut = Struct({
  blocks: U64LE,
  bfree: U64LE,
  bavail: U64LE,
  files: U64LE,
  ffree: U64LE,
  bsize: U32LE,
  namelen: U32LE,
  frsize: U32LE,
  padding: U32LE,
  spare: FixedArray(U32LE, 6),
});

const FuseInitIn = Struct({
  major: U32LE,
  minor: U32LE,
  max_readahead: U32LE,
  flags: U32LE,
});

const FuseForgetIn = Struct({
  nlookup: U64LE,
});

const FuseForgetOne = Struct({
  nodeid: U64LE,
  nlookup: U64LE,
});

const FuseBatchForgetIn = Struct({
  count: U32LE,
  dummy: U32LE,
});

const FuseGetattrIn = Struct({
  getattr_flags: U32LE,
  dummy: U32LE,
  fh: U64LE,
});

const FuseMkdirIn = Struct({
  mode: U32LE,
  umask: U32LE,
});

const FuseRenameIn = Struct({
  newdir: U64LE,
});

const FuseSetattrIn = Struct({
  valid: U32LE,
  padding: U32LE,
  fh: U64LE,
  size: U64LE,
  lock_owner: U64LE,
  atime: U64LE,
  mtime: U64LE,
  ctime: U64LE,
  atimensec: U32LE,
  mtimensec: U32LE,
  ctimensec: U32LE,
  mode: U32LE,
  unused4: U32LE,
  uid: U32LE,
  gid: U32LE,
  unused5: U32LE,
});

const FuseOpenIn = Struct({
  flags: U32LE,
  open_flags: U32LE,
});

const FuseCreateIn = Struct({
  flags: U32LE,
  mode: U32LE,
  umask: U32LE,
  open_flags: U32LE,
});

const FuseReadIn = Struct({
  fh: U64LE,
  offset: U64LE,
  size: U32LE,
  read_flags: U32LE,
  lock_owner: U64LE,
  flags: U32LE,
  padding: U32LE,
});

const FuseWriteIn = Struct({
  fh: U64LE,
  offset: U64LE,
  size: U32LE,
  write_flags: U32LE,
  lock_owner: U64LE,
  flags: U32LE,
  padding: U32LE,
});

const FuseFlushIn = Struct({
  fh: U64LE,
  unused: U32LE,
  padding: U32LE,
  lock_owner: U64LE,
});

const FuseFsyncIn = Struct({
  fh: U64LE,
  fsync_flags: U32LE,
  padding: U32LE,
});

const FuseReleaseIn = Struct({
  fh: U64LE,
  flags: U32LE,
  release_flags: U32LE,
  lock_owner: U64LE,
});

const FuseAccessIn = Struct({
  mask: U32LE,
  padding: U32LE,
});

const FuseDirent = Struct({
  ino: U64LE,
  off: U64LE,
  namelen: U32LE,
  type: U32LE,
});

type AnyFn = (...args: never[]) => unknown;

/**
 * Writable filesystems must declare how they persist writes: a backend
 * providing `write` or `create` also has to implement `flush` and `fsync`,
 * even as no-ops. Omission is a compile error here and a construction error
 * at runtime.
 */
type RequiresDurability<T> = T extends { write: AnyFn } | { create: AnyFn }
  ? { flush: AnyFn; fsync: AnyFn }
  : unknown;

class UnsupportedOperation extends FSError {
  constructor() {
    super("ENOSYS");
  }
}

interface NodeRecord<TNode> {
  id: bigint;
  node: TNode;
  parent: NodeRecord<TNode>;
  lookups: bigint;
  handles: number;
  children: number;
}

interface HandleRecord<TNode, THandle> {
  node: NodeRecord<TNode>;
  handle: THandle;
  directory: boolean;
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
      throw new FSError("EIO", "filesystem returned an invalid mode");
  }
}

function checked_number(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new FSError("EINVAL", "offset exceeds JavaScript's integer range");
  }
  return number;
}

function validate_name(name: string) {
  if (
    name.length === 0 || name === "." || name === ".." || name.includes("/") ||
    name.includes("\0")
  ) {
    throw new FSError("EINVAL", "invalid path component");
  }
  if (utf8_encoder.encode(name).byteLength > 255) {
    throw new FSError("ENAMETOOLONG");
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

/**
 * The smallest writable response buffer the guest must provide for an opcode,
 * derived from the response struct the device writes. `FuseOutHeader.size` is
 * the base for every op with a response; ops without one (FORGET, INTERRUPT)
 * need no buffer at all.
 */
function minimum_response_capacity(opcode: number) {
  switch (opcode) {
    case FuseOpcode.FORGET:
    case FuseOpcode.BATCH_FORGET:
    case FuseOpcode.INTERRUPT:
      return 0;
    case FuseOpcode.INIT:
      return FuseOutHeader.size + FuseInitOut.size;
    case FuseOpcode.LOOKUP:
    case FuseOpcode.SYMLINK:
    case FuseOpcode.MKDIR:
      return FuseOutHeader.size + FuseEntryOut.size;
    case FuseOpcode.GETATTR:
    case FuseOpcode.SETATTR:
      return FuseOutHeader.size + FuseAttrOut.size;
    case FuseOpcode.OPEN:
    case FuseOpcode.OPENDIR:
      return FuseOutHeader.size + FuseOpenOut.size;
    case FuseOpcode.CREATE:
      return FuseOutHeader.size + FuseEntryOut.size + FuseOpenOut.size;
    case FuseOpcode.WRITE:
      return FuseOutHeader.size + FuseWriteOut.size;
    case FuseOpcode.STATFS:
      return FuseOutHeader.size + FuseStatfsOut.size;
    default:
      return FuseOutHeader.size;
  }
}

function timestamp(
  value: FSTimestamp | undefined,
): [bigint, number] {
  return [value?.seconds ?? 0n, value?.nanoseconds ?? 0];
}

/** The `struct fuse_attr` value for a node, derived from `FSAttributes`. */
function attr_fields(nodeid: bigint, attributes: FSAttributes) {
  const [atime, atimensec] = timestamp(attributes.atime);
  const [mtime, mtimensec] = timestamp(attributes.mtime);
  const [ctime, ctimensec] = timestamp(attributes.ctime);
  return {
    ino: nodeid,
    size: attributes.size,
    blocks: attributes.blocks ?? (attributes.size + 511n) / 512n,
    atime,
    mtime,
    ctime,
    atimensec,
    mtimensec,
    ctimensec,
    mode: attributes.mode,
    nlink: attributes.nlink ?? (mode_type(attributes.mode) === "directory" ? 2 : 1),
    uid: attributes.uid ?? 0,
    gid: attributes.gid ?? 0,
    rdev: attributes.rdev ?? 0,
    blksize: attributes.blockSize ?? 4096,
    flags: 0,
  };
}

function write_entry<TNode>(
  payload: Bytes,
  record: NodeRecord<TNode>,
  attributes: FSAttributes,
  validity: bigint,
) {
  payload.alloc(FuseEntryOut).value = {
    nodeid: record.id,
    generation: 1n,
    entry_valid: validity,
    attr_valid: validity,
    entry_valid_nsec: 0,
    attr_valid_nsec: 0,
    attr: attr_fields(record.id, attributes),
  };
}

function write_attr_out(
  payload: Bytes,
  validity: bigint,
  nodeid: bigint,
  attributes: FSAttributes,
) {
  payload.alloc(FuseAttrOut).value = {
    attr_valid: validity,
    attr_valid_nsec: 0,
    dummy: 0,
    attr: attr_fields(nodeid, attributes),
  };
}

function create_context(
  header: FuseInHeaderValue,
  mode: number,
  umask: number,
): FSCreateContext {
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
export function fileSystemDevice<TNode extends object, THandle, T extends FS<TNode, THandle>>(
  filesystem: T & RequiresDurability<T>,
  options: FSDeviceOptions,
): VirtioDevice {
  const { tag, cache = true } = options;
  const validity = cache ? 1n : 0n;
  const encoded_tag = utf8_encoder.encode(tag);
  if (encoded_tag.byteLength === 0 || encoded_tag.byteLength > 36) {
    throw new RangeError("virtio-fs tag must be between 1 and 36 UTF-8 bytes");
  }

  if (filesystem.write ?? filesystem.create) {
    if (!filesystem.flush || !filesystem.fsync) {
      throw new Error(
        "a writable filesystem must implement flush() and fsync(); " +
          "no-op implementations are the explicit way to declare an " +
          "already-durable or ephemeral backend",
      );
    }
  }

  const config = new Uint8Array(40);
  config.set(encoded_tag);
  new DataView(config.buffer).setUint32(36, 1, true);

  const records = new Map<bigint, NodeRecord<TNode>>();
  const by_node = new WeakMap<TNode, NodeRecord<TNode>>();
  let next_nodeid = 2n;
  const root: NodeRecord<TNode> = {
    id: 1n,
    node: filesystem.root,
    parent: undefined as unknown as NodeRecord<TNode>,
    lookups: 1n,
    handles: 0,
    children: 0,
  };
  root.parent = root;
  records.set(root.id, root);
  by_node.set(filesystem.root, root);

  const handles = new Map<bigint, HandleRecord<TNode, THandle>>();
  let next_handle = 1n;
  let finalize_promise: Promise<void> | undefined;

  function record_for_node(node: TNode, parent: NodeRecord<TNode>) {
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

  function collect_record(record: NodeRecord<TNode>) {
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

  function forget(record: NodeRecord<TNode>, count: bigint) {
    record.lookups = count >= record.lookups ? 0n : record.lookups - count;
    collect_record(record);
  }

  function node_record(nodeid: bigint) {
    const record = records.get(nodeid);
    if (!record) throw new FSError("ENOENT");
    return record;
  }

  function handle_record(
    fh: bigint,
    directory?: boolean,
    node?: NodeRecord<TNode>,
  ) {
    const record = handles.get(fh);
    if (
      !record ||
      (directory !== undefined && record.directory !== directory) ||
      (node !== undefined && record.node !== node)
    ) {
      throw new FSError("EBADF");
    }
    return record;
  }

  function add_handle(
    node: NodeRecord<TNode>,
    handle: THandle,
    directory: boolean,
  ) {
    const fh = next_handle++;
    handles.set(fh, { node, handle, directory });
    node.handles += 1;
    return fh;
  }

  function remove_handle(fh: bigint, handle: HandleRecord<TNode, THandle>) {
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

  async function lookup(parent: NodeRecord<TNode>, name: string) {
    const node = await filesystem.lookup(parent.node, validate_name(name));
    if (!node) throw new FSError("ENOENT");
    const record = record_for_node(node, parent);
    record.lookups += 1n;
    return record;
  }

  async function process(header: FuseInHeaderValue, body: Reader, capacity: number) {
    const payload = new Bytes(Math.max(0, capacity - FuseOutHeader.size));
    const node = header.nodeid === 0n ? undefined : node_record(header.nodeid);

    switch (header.opcode) {
      case FuseOpcode.INIT: {
        const init = body.struct(FuseInitIn);
        if (init.major !== 7) {
          if (init.major < 7) throw new FSError("EPROTO");
          // A newer kernel retries with our major; only major and minor reply.
          payload.alloc(U32LE).value = 7;
          payload.alloc(U32LE).value = 45;
          break;
        }
        const supported_flags = FuseInitFlags.ASYNC_READ |
          FuseInitFlags.BIG_WRITES |
          FuseInitFlags.AUTO_INVAL_DATA |
          FuseInitFlags.MAX_PAGES |
          FuseInitFlags.INIT_EXT;
        const flags = init.flags & supported_flags;
        payload.alloc(FuseInitOut).value = {
          major: 7,
          minor: Math.min(init.minor, 45),
          max_readahead: Math.min(init.max_readahead, 1024 * 1024),
          flags,
          max_background: 12,
          congestion_threshold: 9,
          max_write: 1024 * 1024,
          time_gran: 1,
          max_pages: (flags & FuseInitFlags.MAX_PAGES) === 0 ? 0 : 16,
          map_alignment: 0,
          flags2: 0,
          max_stack_depth: 0,
          request_timeout: 0,
          unused: Array(11).fill(0),
        };
        break;
      }
      case FuseOpcode.LOOKUP: {
        const record = await lookup(node!, body.cstring());
        write_entry(payload, record, await filesystem.getattr(record.node), validity);
        break;
      }
      case FuseOpcode.FORGET: {
        const request = body.struct(FuseForgetIn);
        forget(node!, request.nlookup);
        return undefined;
      }
      case FuseOpcode.BATCH_FORGET: {
        const request = body.struct(FuseBatchForgetIn);
        const forgotten: { record: NodeRecord<TNode>; count: bigint }[] = [];
        for (let index = 0; index < request.count; index++) {
          const one = body.struct(FuseForgetOne);
          const record = records.get(one.nodeid);
          if (record) forgotten.push({ record, count: one.nlookup });
        }
        for (const entry of forgotten) forget(entry.record, entry.count);
        return undefined;
      }
      case FuseOpcode.GETATTR: {
        const request = body.struct(FuseGetattrIn);
        const handle = request.getattr_flags & FuseGetattrFlags.FH
          ? handle_record(request.fh, undefined, node!).handle
          : undefined;
        write_attr_out(
          payload,
          validity,
          node!.id,
          await filesystem.getattr(node!.node, handle),
        );
        break;
      }
      case FuseOpcode.SETATTR: {
        if (!filesystem.setattr) throw new UnsupportedOperation();
        const request = body.struct(FuseSetattrIn);
        const changes: FSSetAttributes = {};
        if (request.valid & FuseSetattrFlags.MODE) changes.mode = request.mode;
        if (request.valid & FuseSetattrFlags.UID) changes.uid = request.uid;
        if (request.valid & FuseSetattrFlags.GID) changes.gid = request.gid;
        if (request.valid & FuseSetattrFlags.SIZE) changes.size = request.size;
        if (request.valid & FuseSetattrFlags.ATIME) {
          changes.atime = request.valid & FuseSetattrFlags.ATIME_NOW
            ? "now"
            : { seconds: request.atime, nanoseconds: request.atimensec };
        }
        if (request.valid & FuseSetattrFlags.MTIME) {
          changes.mtime = request.valid & FuseSetattrFlags.MTIME_NOW
            ? "now"
            : { seconds: request.mtime, nanoseconds: request.mtimensec };
        }
        if (request.valid & FuseSetattrFlags.CTIME) {
          changes.ctime = { seconds: request.ctime, nanoseconds: request.ctimensec };
        }
        const open = request.valid & FuseSetattrFlags.FH
          ? handle_record(request.fh, undefined, node!).handle
          : undefined;
        const attributes = await filesystem.setattr(node!.node, changes, open);
        write_attr_out(payload, validity, node!.id, attributes);
        break;
      }
      case FuseOpcode.READLINK: {
        if (!filesystem.readlink) throw new UnsupportedOperation();
        payload.append(utf8_encoder.encode(await filesystem.readlink(node!.node)));
        break;
      }
      case FuseOpcode.SYMLINK: {
        if (!filesystem.symlink) throw new UnsupportedOperation();
        const name = validate_name(body.cstring());
        const target = body.cstring();
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
        const request = body.struct(FuseMkdirIn);
        const made = await filesystem.mkdir(
          node!.node,
          validate_name(body.cstring()),
          create_context(header, FileType.directory | request.mode, request.umask),
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
        await method.call(filesystem, node!.node, validate_name(body.cstring()));
        break;
      }
      case FuseOpcode.RENAME: {
        if (!filesystem.rename) throw new UnsupportedOperation();
        const request = body.struct(FuseRenameIn);
        const new_parent = node_record(request.newdir);
        const old_name = validate_name(body.cstring());
        const new_name = validate_name(body.cstring());
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
        const request = body.struct(FuseOpenIn);
        const handle = await method.call(filesystem, node!.node, request.flags);
        payload.alloc(FuseOpenOut).value = {
          fh: add_handle(node!, handle, directory),
          // Keep open flags zero even when cache is false. Cache controls only
          // entry/attribute validity; FOPEN_DIRECT_IO would route private
          // owner-worker user buffers through unsupported page extraction.
          open_flags: 0,
          backing_id: -1,
        };
        break;
      }
      case FuseOpcode.CREATE: {
        if (!filesystem.create) throw new UnsupportedOperation();
        const request = body.struct(FuseCreateIn);
        const created = await filesystem.create(
          node!.node,
          validate_name(body.cstring()),
          request.flags,
          create_context(header, FileType.file | request.mode, request.umask),
        );
        const record = record_for_node(created.node, node!);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(created.node), validity);
        payload.alloc(FuseOpenOut).value = {
          fh: add_handle(record, created.handle, false),
          // CREATE returns the same open flags as OPEN; direct I/O is
          // unsupported by this wasm transport even when metadata/name
          // validity is zero.
          open_flags: 0,
          backing_id: -1,
        };
        break;
      }
      case FuseOpcode.READ: {
        if (!filesystem.read) throw new UnsupportedOperation();
        const request = body.struct(FuseReadIn);
        const handle = handle_record(request.fh, false, node!);
        const data = await filesystem.read(
          handle.node.node,
          handle.handle,
          request.offset,
          Math.min(request.size, capacity - FuseOutHeader.size),
        );
        if (data.byteLength > request.size || data.byteLength > capacity - FuseOutHeader.size) {
          throw new FSError("EIO", "filesystem returned too much data");
        }
        payload.append(data);
        break;
      }
      case FuseOpcode.WRITE: {
        if (!filesystem.write) throw new UnsupportedOperation();
        const request = body.struct(FuseWriteIn);
        const data = body.bytes(request.size);
        const handle = handle_record(request.fh, false, node!);
        const written = await filesystem.write(
          handle.node.node,
          handle.handle,
          request.offset,
          data,
        );
        if (!Number.isInteger(written) || written < 0 || written > request.size) {
          throw new FSError("EIO", "filesystem returned an invalid write size");
        }
        payload.alloc(FuseWriteOut).value = { size: written, padding: 0 };
        break;
      }
      case FuseOpcode.FLUSH: {
        const request = body.struct(FuseFlushIn);
        const handle = handle_record(request.fh, false, node!);
        if (filesystem.flush) {
          await filesystem.flush(handle.node.node, handle.handle);
        }
        break;
      }
      case FuseOpcode.FSYNC:
      case FuseOpcode.FSYNCDIR: {
        const request = body.struct(FuseFsyncIn);
        const handle = handle_record(
          request.fh,
          header.opcode === FuseOpcode.FSYNCDIR,
          node!,
        );
        if (filesystem.fsync) {
          await filesystem.fsync(
            handle.node.node,
            handle.handle,
            (request.fsync_flags & 1) !== 0,
          );
        }
        break;
      }
      case FuseOpcode.RELEASE:
      case FuseOpcode.RELEASEDIR: {
        const directory = header.opcode === FuseOpcode.RELEASEDIR;
        const request = body.struct(FuseReleaseIn);
        const handle = handle_record(request.fh, directory, node!);
        if (directory) {
          await filesystem.releasedir?.(handle.node.node, handle.handle);
        } else {
          await filesystem.release?.(handle.node.node, handle.handle);
        }
        remove_handle(request.fh, handle);
        break;
      }
      case FuseOpcode.READDIR: {
        if (!filesystem.readdir) throw new UnsupportedOperation();
        const request = body.struct(FuseReadIn);
        const offset = checked_number(request.offset);
        const handle = handle_record(request.fh, true, node!);
        // The guest resumes readdir by `off`, which is an index into the
        // entry array we rebuild here: the caller's directory plus the "." and
        // ".." entries this device injects. Each request re-reads the whole
        // directory and skips `off` entries, so no directory position state is
        // kept between requests.
        const entries = [
          { name: ".", record: handle.node },
          { name: "..", record: handle.node.parent },
        ];
        const directory_entries = await filesystem.readdir(
          handle.node.node,
          handle.handle,
        );
        const transient: NodeRecord<TNode>[] = [];
        const limit = Math.min(request.size, capacity - FuseOutHeader.size);
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
            // FUSE dirents are padded to 8 bytes: 24-byte header + name.
            const record_length = (24 + name.byteLength + 7) & ~7;
            if (payload.length + record_length > limit) break;
            const attributes = await filesystem.getattr(entry.record.node);
            payload.alloc(FuseDirent).value = {
              ino: entry.record.id,
              off: BigInt(index + 1),
              namelen: name.byteLength,
              type: DirentType[mode_type(attributes.mode)],
            };
            payload.append(name);
            payload.bump((-payload.length) & 7);
          }
        } finally {
          for (const record of transient) collect_record(record);
        }
        break;
      }
      case FuseOpcode.STATFS: {
        const stat = await filesystem.statfs?.(node!.node) ?? {};
        payload.alloc(FuseStatfsOut).value = {
          blocks: stat.blocks ?? 0n,
          bfree: stat.blocksFree ?? 0n,
          bavail: stat.blocksAvailable ?? 0n,
          files: stat.files ?? 0n,
          ffree: stat.filesFree ?? 0n,
          bsize: stat.blockSize ?? 4096,
          namelen: stat.nameLength ?? 255,
          frsize: stat.fragmentSize ?? stat.blockSize ?? 4096,
          padding: 0,
          spare: Array(6).fill(0),
        };
        break;
      }
      case FuseOpcode.ACCESS: {
        const request = body.struct(FuseAccessIn);
        if (filesystem.access) await filesystem.access(node!.node, request.mask);
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
    if (payload.length > capacity - FuseOutHeader.size) {
      throw new FSError("EIO", "response exceeds the guest's response buffer");
    }
    return payload;
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
            throw new FSError("EINVAL", "readable descriptor follows response");
          }
          saw_writable ||= buffer.writable;
        }
        const body = new Reader(request);
        const header = body.struct(FuseInHeader);
        unique = header.unique;
        if (header.len !== request.byteLength || header.len < FuseInHeader.size) {
          throw new FSError("EINVAL", "invalid FUSE request length");
        }
        if (capacity < minimum_response_capacity(header.opcode)) {
          throw new FSError("EINVAL", "FUSE response buffer is too small");
        }
        const payload = await process(header, body, capacity);
        if (payload === undefined) {
          chain.release(0);
          continue;
        }
        const response = new Bytes(FuseOutHeader.size + payload.length);
        response.alloc(FuseOutHeader).value = {
          len: FuseOutHeader.size + payload.length,
          error: 0,
          unique,
        };
        response.append(payload.array);
        scatter(buffers, response.array);
        chain.release(response.array.byteLength);
      } catch (error) {
        if (capacity < FuseOutHeader.size) {
          chain.release(0);
          continue;
        }
        const response = new Bytes(FuseOutHeader.size);
        // Malformed requests are EINVAL; RangeError comes from the Reader
        // bounds checks and is the same class of protocol error.
        const errno = error instanceof FSError
          ? error.errno
          : error instanceof RangeError
            ? Errno.EINVAL
            : Errno.EIO;
        response.alloc(FuseOutHeader).value = {
          len: FuseOutHeader.size,
          error: -errno,
          unique,
        };
        scatter(buffers, response.array);
        chain.release(FuseOutHeader.size);
      }
    }
  }

  return new VirtioController(
    // 26 is the virtio-fs device ID.
    { deviceId: 26, config },
    { queues: [notify, notify], close: finalize },
  ).device;
}
