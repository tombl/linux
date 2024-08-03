import { assert, unreachable } from "./util.ts";

const FDT_MAGIC = 0xd00dfeed;
const FDT_BEGIN_NODE = 0x00000001;
const FDT_END_NODE = 0x00000002;
const FDT_PROP = 0x00000003;
const FDT_END = 0x00000009;
const NODE_NAME_MAX_LEN = 31;
const PROPERTY_NAME_MAX_LEN = 31;

interface DeviceTreeNode {
  [key: string]: DeviceTreeNode | DeviceTreeProperty;
}
type DeviceTreeProperty =
  | string
  | number
  | bigint
  | number[]
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | ArrayBuffer;

function inner(
  tree: DeviceTreeNode,
  memoryReservations: Array<
    { address: number | bigint; size: number | bigint }
  >,
  bootCpuId: number,
  maxSize: number,
): Uint8Array {
  const arr = new Uint8Array(maxSize);
  const dv = new DataView(arr.buffer);
  let i = 0;

  function u8(n = 0x78) {
    const j = i;
    dv.setUint8(j, n);
    i += 1;
    return j;
  }
  function u32(n = 0x78787878) {
    const j = i;
    dv.setUint32(j, n);
    i += 4;
    return j;
  }
  function u64(n: number | bigint = 0x7878787878787878n) {
    const j = i;
    dv.setBigUint64(j, BigInt(n));
    i += 8;
    return j;
  }
  function bytes(buf: ArrayBuffer) {
    const j = i;
    arr.set(new Uint8Array(buf), i);
    i += buf.byteLength;
    return j;
  }
  function stringz(s: string) {
    const j = bytes(new TextEncoder().encode(s).buffer);
    u8(0);
    return j;
  }
  function pad(align = 4) {
    const offset = i % align;
    if (offset !== 0) {
      for (let j = 0; j < align - offset; j++) u8(0);
    }
  }

  function walkTree(node: DeviceTreeNode, name: string) {
    const startOffset = i;
    pad();
    u32(FDT_BEGIN_NODE);

    assert(
      new TextEncoder().encode(name).byteLength <= NODE_NAME_MAX_LEN,
      `property name too long: ${name}`,
    );
    stringz(name);
    pad();

    const children = Object.entries(node).filter(
      ([, value]) => typeof value === "object" && value?.constructor === Object,
    ) as [string, DeviceTreeNode][];

    const properties = Object.entries(node).filter(
      ([, value]) =>
        !(typeof value === "object" && value?.constructor === Object),
    ) as [string, DeviceTreeProperty][];

    for (const [name, prop] of properties) {
      pad();
      u32(FDT_PROP);
      const len = u32();

      assert(
        new TextEncoder().encode(name).byteLength <= PROPERTY_NAME_MAX_LEN,
        `property name too long: ${name}`,
      );
      (strings[name] ??= []).push(u32());

      let value: ArrayBuffer;
      switch (typeof prop) {
        case "number":
          value = new Uint32Array(1).buffer;
          new DataView(value).setUint32(0, prop)
          break;
        case "bigint":
          value = new BigUint64Array([prop]).buffer;
          break;
        case "string":
          value = new TextEncoder().encode(`${prop}\0`).buffer;
          break;
        case "object":
          if (Array.isArray(prop)) {
            value = new Uint32Array(prop.length).buffer;
            const dv = new DataView(value);
            for (let i = 0; i < prop.length; i++) {
              dv.setUint32(i * 4, prop[i]);
            }
          } else if (
            prop instanceof Uint8Array ||
            prop instanceof Uint16Array ||
            prop instanceof Uint32Array ||
            prop instanceof BigUint64Array
          ) {
            value = prop.buffer;
          } else if (prop instanceof ArrayBuffer) {
            value = prop;
          } else {
            unreachable(
              prop,
              `unsupported prop type: ${(prop as object)?.constructor.name}`,
            );
          }
          break;
        case "undefined":
          value = new Uint8Array().buffer;
          break;
        default:
          unreachable(prop, `unsupported prop type: ${typeof prop}`);
      }
      dv.setUint32(len, value.byteLength);
      bytes(value);
      pad();
    }
    for (const [name, child] of children) walkTree(child, name);

    pad();
    u32(FDT_END_NODE);
    return i - startOffset;
  }

  const strings: Record<string, number[]> = {};
  try {
    u32(FDT_MAGIC); // magic
    const totalsize = u32();
    const off_dt_struct = u32();
    const off_dt_strings = u32();
    const off_mem_rsvmap = u32();
    u32(17); // version
    u32(16); // last compatible version
    u32(bootCpuId); // boot cpuid phys
    const size_dt_strings = u32();
    const size_dt_struct = u32();

    pad(8);
    dv.setUint32(off_mem_rsvmap, i);
    for (const { address, size } of memoryReservations) {
      u64(address);
      u64(size);
    }
    u64(0);
    u64(0);

    const begin_dt_struct = i;
    dv.setUint32(off_dt_struct, begin_dt_struct);
    walkTree(tree, "");
    u32(FDT_END);
    dv.setUint32(size_dt_struct, i - begin_dt_struct);

    const begin_dt_strings = i;
    dv.setUint32(off_dt_strings, begin_dt_strings);
    for (const [str, refs] of Object.entries(strings)) {
      const offset = stringz(str);
      for (const ref of refs) dv.setUint32(ref, offset - begin_dt_strings);
    }
    dv.setUint32(size_dt_strings, i - begin_dt_strings);

    dv.setUint32(totalsize, i);
    return arr.slice(0, i);
  } catch (err) {
    if (err instanceof RangeError) {
      return inner(tree, memoryReservations, bootCpuId, maxSize * 2);
    }
    throw err;
  }
}

export function generateDevicetree(tree: DeviceTreeNode, {
  memoryReservations = [],
  bootCpuId = 0,
}: {
  memoryReservations?: Array<
    { address: number | bigint; size: number | bigint }
  >;
  bootCpuId?: number;
} = {}) {
  return inner(tree, memoryReservations, bootCpuId, 1024);
}
