import {
  type Allocated,
  Bytes,
  Struct,
  U32BE,
  U64BE,
  U8,
  type Unwrap,
} from "./bytes.ts";
import { assert, unreachable } from "./util.ts";

const FDT_MAGIC = 0xd00dfeed;
const FDT_BEGIN_NODE = 0x00000001;
const FDT_END_NODE = 0x00000002;
const FDT_PROP = 0x00000003;
const FDT_END = 0x00000009;
const NODE_NAME_MAX_LEN = 31;
const PROPERTY_NAME_MAX_LEN = 31;

export interface DeviceTreeNode {
  [key: string]: DeviceTreeNode | DeviceTreeProperty;
}
type DeviceTreeProperty =
  | string
  | number
  | bigint
  | readonly number[]
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | ArrayBuffer
  | undefined;

// https://devicetree-specification.readthedocs.io/en/latest/chapter5-flattened-format.html
const FdtHeader = Struct({
  magic: U32BE,
  totalsize: U32BE,
  off_dt_struct: U32BE,
  off_dt_strings: U32BE,
  off_mem_rsvmap: U32BE,
  version: U32BE,
  last_comp_version: U32BE,
  boot_cpuid_phys: U32BE,
  size_dt_strings: U32BE,
  size_dt_struct: U32BE,
});

const FdtReserveEntry = Struct({
  address: U64BE,
  size: U64BE,
});

const Property = Struct({
  len: U32BE,
  nameoff: U32BE,
});
type Property = Unwrap<typeof Property>;

function align(bytes: Bytes, alignment: number) {
  const offset = bytes.length % alignment;
  if (offset !== 0) {
    for (let j = 0; j < alignment - offset; j++) bytes.alloc(U8);
  }
}

export function generate_devicetree(tree: DeviceTreeNode, {
  memory_reservations = [],
  boot_cpu_id = 0,
}: {
  memory_reservations?: Array<
    { address: number; size: number }
  >;
  boot_cpu_id?: number;
} = {}) {
  const bytes = new Bytes(1024);
  const strings: Record<string, Allocated<Property>[]> = {};
  const header = bytes.alloc(FdtHeader);

  function walk_tree(node: DeviceTreeNode, name: string) {
    align(bytes, 4);
    bytes.alloc(U32BE).value = FDT_BEGIN_NODE;

    const encodedName = new TextEncoder().encode(name);
    assert(
      encodedName.byteLength <= NODE_NAME_MAX_LEN,
      `property name too long: ${name}`,
    );
    bytes.append(encodedName);
    bytes.alloc(U8).value = 0;
    align(bytes, 4);

    const children = Object.entries(node).filter(
      ([, value]) => typeof value === "object" && value?.constructor === Object,
    ) as [string, DeviceTreeNode][];

    const properties = Object.entries(node).filter(
      ([, value]) =>
        !(typeof value === "object" && value?.constructor === Object),
    ) as [string, DeviceTreeProperty][];

    for (const [name, prop] of properties) {
      align(bytes, 4);
      bytes.alloc(U32BE).value = FDT_PROP;
      const property = bytes.alloc(Property);

      assert(
        new TextEncoder().encode(name).byteLength <= PROPERTY_NAME_MAX_LEN,
        `property name too long: ${name}`,
      );
      (strings[name] ??= []).push(property);

      let value: ArrayBuffer;
      switch (typeof prop) {
        case "number":
          value = new Uint32Array(1).buffer;
          new DataView(value).setUint32(0, prop);
          break;
        case "bigint":
          value = new BigUint64Array(1).buffer;
          new DataView(value).setBigUint64(0, prop);
          break;
        case "string":
          value = new TextEncoder().encode(`${prop}\0`).buffer;
          break;
        case "object":
          if (
            prop instanceof Uint8Array ||
            prop instanceof Uint16Array ||
            prop instanceof Uint32Array ||
            prop instanceof BigUint64Array
          ) {
            value = prop.buffer;
          } else if (prop instanceof ArrayBuffer) {
            value = prop;
          } else {
            value = new Uint32Array(prop.length).buffer;
            const dv = new DataView(value);
            for (const [i, n] of prop.entries()) {
              dv.setUint32(i * 4, n);
            }
          }
          break;
        case "undefined":
          value = new Uint8Array().buffer;
          break;
        default:
          unreachable(prop, `unsupported prop type: ${typeof prop}`);
      }
      property.value.len = value.byteLength;
      bytes.append(new Uint8Array(value));
      align(bytes, 4);
    }
    for (const [name, child] of children) walk_tree(child, name);

    align(bytes, 4);
    bytes.alloc(U32BE).value = FDT_END_NODE;
  }

  Object.assign(header.value, {
    magic: FDT_MAGIC,
    version: 17,
    last_comp_version: 16,
    boot_cpuid_phys: boot_cpu_id,
  });

  align(bytes, 8);

  header.value.off_mem_rsvmap = bytes.length;
  for (const { address, size } of memory_reservations) {
    bytes.alloc(FdtReserveEntry).value = {
      address: BigInt(address),
      size: BigInt(size),
    };
  }
  bytes.alloc(FdtReserveEntry).value = { address: 0n, size: 0n };

  const begin_dt_struct = bytes.length;
  header.value.off_dt_struct = begin_dt_struct;
  walk_tree(tree, "");
  bytes.alloc(U32BE).value = FDT_END;
  header.value.size_dt_struct = bytes.length - begin_dt_struct;

  const begin_dt_strings = bytes.length;
  header.value.off_dt_strings = begin_dt_strings;
  for (const [str, refs] of Object.entries(strings)) {
    const offset = bytes.length;
    bytes.append(new TextEncoder().encode(str));
    bytes.alloc(U8).value = 0;
    for (const ref of refs) ref.value.nameoff = offset - begin_dt_strings;
  }
  header.value.size_dt_strings = bytes.length - begin_dt_strings;

  header.value.totalsize = bytes.length;
  return bytes.array;
}
