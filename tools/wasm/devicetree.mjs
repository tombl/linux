const FDT_MAGIC = 0xd00dfeed;
const FDT_BEGIN_NODE = 0x00000001;
const FDT_END_NODE = 0x00000002;
const FDT_PROP = 0x00000003;
const FDT_END = 0x00000009;
const NODE_NAME_MAX_LEN = 31;
const PROPERTY_NAME_MAX_LEN = 31;

function byteswap32(n) {
	return (
		((n & 0xff) << 24) |
		((n & 0xff00) << 8) |
		((n >> 8) & 0xff00) |
		((n >> 24) & 0xff)
	);
}

export function devicetree(
	tree,
	reservations = [],
	bootCpuId = 0,
	maxSize = 1024,
) {
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
	function u64(n = 0x7878787878787878n) {
		const j = i;
		dv.setBigUint64(j, BigInt(n));
		i += 8;
		return j;
	}
	function bytes(buf) {
		const j = i;
		if (!(buf instanceof ArrayBuffer)) {
			throw new TypeError(
				`Expected ArrayBuffer, got ${buf[Symbol.toStringTag]}`,
			);
		}
		arr.set(new Uint8Array(buf), i);
		i += buf.byteLength;
		return j;
	}
	function stringz(s) {
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

	try {
		const strings = {};

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
		for (const { address, size } of reservations) {
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

		function walkTree(node, name) {
			const startOffset = i;
			pad();
			u32(FDT_BEGIN_NODE);

			if (new TextEncoder().encode(name).byteLength > NODE_NAME_MAX_LEN) {
				throw new Error("name too long");
			}
			stringz(name);
			pad();

			const properties = Object.entries(node).filter(
				([, value]) =>
					typeof value !== "object" || value.constructor !== Object,
			);
			const children = Object.entries(node).filter(
				([, value]) =>
					typeof value === "object" && value.constructor === Object,
			);
			for (const [name, prop] of properties) {
				pad();
				u32(FDT_PROP);
				const len = u32();

				if (new TextEncoder().encode(name).byteLength > PROPERTY_NAME_MAX_LEN) {
					throw new Error("name too long");
				}
				strings[name] ??= [];
				strings[name].push(u32());

				let value;
				switch (typeof prop) {
					case "number":
						value = new Uint32Array([byteswap32(prop)]).buffer;
						break;
					case "bigint":
						value = new BigUint64Array([prop]).buffer;
						break;
					case "string":
						value = new TextEncoder().encode(`${prop}\0`).buffer;
						break;
					case "object":
						switch (prop.constructor) {
							case Array:
								value = new Uint32Array(prop.map(byteswap32)).buffer;
								break;
							case Uint8Array:
							case Uint16Array:
							case Uint32Array:
							case BigUint64Array:
								value = prop.buffer;
								break;
							default:
								throw new Error(
									`unsupported prop type: ${prop.constructor.name}`,
								);
						}
						break;
					case "undefined":
						value = new Uint8Array().buffer;
						break;
					default:
						throw new Error(`unsupported prop type: ${typeof prop}`);
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
		if (err instanceof RangeError)
			return devicetree(tree, reservations, bootCpuId, maxSize * 2);
		throw err;
	}
}
