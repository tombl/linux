import { generateDevicetree } from "./devicetree.ts";
import {
  type FromWorkerMessage,
  FromWorkerMessageType,
  type ToWorkerMessage,
  ToWorkerMessageType,
} from "./worker/messages.ts";
import { assert, getScriptPath, u32, u64, unreachable } from "./util.ts";
import { Entropy } from "./worker/virtio.ts";

const VIRTIO_CONFIG_S_ACKNOWLEDGE = 1 as u32;
const VIRTIO_CONFIG_S_DRIVER = 2 as u32;
const VIRTIO_CONFIG_S_DRIVER_OK = 4 as u32;
const VIRTIO_CONFIG_S_FEATURES_OK = 8 as u32;
const VIRTIO_CONFIG_S_NEEDS_RESET = 0x40 as u32;
const VIRTIO_CONFIG_S_FAILED = 0x80 as u32;
const VIRTIO_TRANSPORT_F_START = 28 as u32;
const VIRTIO_TRANSPORT_F_END = 41 as u32;
const VIRTIO_F_NOTIFY_ON_EMPTY = 24 as u32;
const VIRTIO_F_ANY_LAYOUT = 27 as u32;
const VIRTIO_F_VERSION_1 = 32 as u32;
const VIRTIO_F_ACCESS_PLATFORM = 33 as u32;
const VIRTIO_F_RING_PACKED = 34 as u32;
const VIRTIO_F_IN_ORDER = 35 as u32;
const VIRTIO_F_ORDER_PLATFORM = 36 as u32;
const VIRTIO_F_SR_IOV = 37 as u32;
const VIRTIO_F_RING_RESET = 40 as u32;
const VIRTIO_MMIO_MAGIC_VALUE = 0x000;
const VIRTIO_MMIO_VERSION = 0x004;
const VIRTIO_MMIO_DEVICE_ID = 0x008;
const VIRTIO_MMIO_VENDOR_ID = 0x00c;
const VIRTIO_MMIO_DEVICE_FEATURES = 0x010;
const VIRTIO_MMIO_DEVICE_FEATURES_SEL = 0x014;
const VIRTIO_MMIO_DRIVER_FEATURES = 0x020;
const VIRTIO_MMIO_DRIVER_FEATURES_SEL = 0x024;
const VIRTIO_MMIO_GUEST_PAGE_SIZE = 0x028;
const VIRTIO_MMIO_QUEUE_SEL = 0x030;
const VIRTIO_MMIO_QUEUE_NUM_MAX = 0x034;
const VIRTIO_MMIO_QUEUE_NUM = 0x038;
const VIRTIO_MMIO_QUEUE_ALIGN = 0x03c;
const VIRTIO_MMIO_QUEUE_PFN = 0x040;
const VIRTIO_MMIO_QUEUE_READY = 0x044;
const VIRTIO_MMIO_QUEUE_NOTIFY = 0x050;
const VIRTIO_MMIO_INTERRUPT_STATUS = 0x060;
const VIRTIO_MMIO_INTERRUPT_ACK = 0x064;
const VIRTIO_MMIO_STATUS = 0x070;
const VIRTIO_MMIO_QUEUE_DESC_LOW = 0x080;
const VIRTIO_MMIO_QUEUE_DESC_HIGH = 0x084;
const VIRTIO_MMIO_QUEUE_AVAIL_LOW = 0x090;
const VIRTIO_MMIO_QUEUE_AVAIL_HIGH = 0x094;
const VIRTIO_MMIO_QUEUE_USED_LOW = 0x0a0;
const VIRTIO_MMIO_QUEUE_USED_HIGH = 0x0a4;
const VIRTIO_MMIO_SHM_SEL = 0x0ac;
const VIRTIO_MMIO_SHM_LEN_LOW = 0x0b0;
const VIRTIO_MMIO_SHM_LEN_HIGH = 0x0b4;
const VIRTIO_MMIO_SHM_BASE_LOW = 0x0b8;
const VIRTIO_MMIO_SHM_BASE_HIGH = 0x0bc;
const VIRTIO_MMIO_CONFIG_GENERATION = 0x0fc;
const VIRTIO_MMIO_CONFIG = 0x100;
const VIRTIO_MMIO_INT_VRING = 1 << 0;
const VIRTIO_MMIO_INT_CONFIG = 1 << 1;

class VirtioRegisters {
  dv: DataView;
  arr: Uint8Array;

  constructor(arr: Uint8Array) {
    this.dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    this.arr = arr;
  }

  set magic(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_MAGIC_VALUE, value, true);
  }

  set version(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_VERSION, value, true);
  }

  set deviceId(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_DEVICE_ID, value, true);
  }

  set vendorId(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_VENDOR_ID, value, true);
  }

  get deviceFeatures() {
    return this.dv.getUint32(VIRTIO_MMIO_DEVICE_FEATURES, true) as u32;
  }

  get deviceFeaturesSel() {
    return this.dv.getUint32(VIRTIO_MMIO_DEVICE_FEATURES_SEL, true) as u32;
  }

  set driverFeatures(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_DRIVER_FEATURES, value, true);
  }

  set driverFeaturesSel(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_DRIVER_FEATURES_SEL, value, true);
  }

  set guestPageSize(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_GUEST_PAGE_SIZE, value, true);
  }

  set queueSel(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_SEL, value, true);
  }

  get queueNumMax() {
    return this.dv.getUint32(VIRTIO_MMIO_QUEUE_NUM_MAX, true) as u32;
  }

  set queueNum(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_NUM, value, true);
  }

  set queueAlign(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_ALIGN, value, true);
  }

  get queuePfn() {
    return this.dv.getUint32(VIRTIO_MMIO_QUEUE_PFN, true) as u32;
  }

  set queuePfn(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_PFN, value, true);
  }

  get queueReady() {
    return this.dv.getUint32(VIRTIO_MMIO_QUEUE_READY, true) as u32;
  }

  set queueReady(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_READY, value, true);
  }

  set queueNotify(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_NOTIFY, value, true);
  }

  get interruptStatus() {
    return this.dv.getUint32(VIRTIO_MMIO_INTERRUPT_STATUS, true) as u32;
  }

  set interruptAck(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_INTERRUPT_ACK, value, true);
  }

  get status() {
    return this.dv.getUint32(VIRTIO_MMIO_STATUS, true) as u32;
  }

  set status(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_STATUS, value, true);
  }

  get queueDesc() {
    const low = this.dv.getUint32(VIRTIO_MMIO_QUEUE_DESC_LOW, true);
    const high = this.dv.getUint32(VIRTIO_MMIO_QUEUE_DESC_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set queueDesc(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_DESC_LOW, low, true);
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_DESC_HIGH, high, true);
  }

  get queueAvail() {
    const low = this.dv.getUint32(VIRTIO_MMIO_QUEUE_AVAIL_LOW, true);
    const high = this.dv.getUint32(VIRTIO_MMIO_QUEUE_AVAIL_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set queueAvail(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_AVAIL_LOW, low, true);
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_AVAIL_HIGH, high, true);
  }

  get queueUsed() {
    const low = this.dv.getUint32(VIRTIO_MMIO_QUEUE_USED_LOW, true);
    const high = this.dv.getUint32(VIRTIO_MMIO_QUEUE_USED_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set queueUsed(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_USED_LOW, low, true);
    this.dv.setUint32(VIRTIO_MMIO_QUEUE_USED_HIGH, high, true);
  }

  set shmSel(value: u32) {
    this.dv.setUint32(VIRTIO_MMIO_SHM_SEL, value, true);
  }

  get shmLen() {
    const low = this.dv.getUint32(VIRTIO_MMIO_SHM_LEN_LOW, true);
    const high = this.dv.getUint32(VIRTIO_MMIO_SHM_LEN_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set shmLen(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(VIRTIO_MMIO_SHM_LEN_LOW, low, true);
    this.dv.setUint32(VIRTIO_MMIO_SHM_LEN_HIGH, high, true);
  }

  get shmBase() {
    const low = this.dv.getUint32(VIRTIO_MMIO_SHM_BASE_LOW, true);
    const high = this.dv.getUint32(VIRTIO_MMIO_SHM_BASE_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set shmBase(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(VIRTIO_MMIO_SHM_BASE_LOW, low, true);
    this.dv.setUint32(VIRTIO_MMIO_SHM_BASE_HIGH, high, true);
  }

  get configGeneration() {
    return this.dv.getUint32(VIRTIO_MMIO_CONFIG_GENERATION, true) as u32;
  }

  getConfig(size: number) {
    return this.arr.subarray(VIRTIO_MMIO_CONFIG, VIRTIO_MMIO_CONFIG + size);
  }
}

interface MachineEventMap {
  halt: CustomEvent<void>;
  restart: CustomEvent<void>;
  error: CustomEvent<{ error: Error; threadName: string }>;
}

interface Machine {
  bootConsole: ReadableStream<Uint8Array>;

  addEventListener<K extends keyof MachineEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: MachineEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MachineEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: MachineEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export function start({
  cmdline,
  vmlinux,
  sections,
  memoryMib = 128,
  cpus = navigator.hardwareConcurrency,
}: {
  cmdline: string;
  vmlinux: WebAssembly.Module;
  sections: Record<string, number[]>;
  memoryMib?: number;
  cpus?: number;
}) {
  const bootConsole = new TransformStream<Uint8Array, Uint8Array>();
  const bootConsoleWriter = bootConsole.writable.getWriter();

  const eventTarget = new EventTarget();
  function emit<K extends keyof MachineEventMap>(
    type: K,
    detail: MachineEventMap[K]["detail"],
  ) {
    eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
  }

  const workers: Worker[] = [];

  function newWorker(
    name: string,
    initMessage: ToWorkerMessage,
    initTransfer: Transferable[],
  ) {
    const worker = new Worker(
      getScriptPath(() => import("./worker/worker.ts"), import.meta),
      { type: "module", name },
    );
    workers.push(worker);

    worker.onmessage = async ({ data }: MessageEvent<FromWorkerMessage>) => {
      switch (data.type) {
        case FromWorkerMessageType.BOOT_CONSOLE_WRITE:
          bootConsoleWriter.write(data.message);
          break;
        case FromWorkerMessageType.BOOT_CONSOLE_CLOSE:
          await bootConsoleWriter.close();
          await bootConsole.writable.close();
          break;
        case FromWorkerMessageType.RESTART:
          emit("restart", undefined);
          break;
        case FromWorkerMessageType.SPAWN:
          newWorker(data.name, {
            type: ToWorkerMessageType.TASK,
            task: data.task,
            vmlinux,
            memory,
          }, []);
          break;
        case FromWorkerMessageType.ERROR:
          emit("error", { error: data.error, threadName: name });
          for (const worker of workers) {
            worker.terminate();
          }
          break;
        case FromWorkerMessageType.BRINGUP_SECONDARY:
          newWorker(`entry${data.cpu}`, {
            type: ToWorkerMessageType.SECONDARY,
            cpu: data.cpu,
            idle: data.idle,
            vmlinux,
            memory,
          }, []);
          break;
        default:
          unreachable(
            data,
            `invalid main->worker message type: ${
              (data as { type: unknown }).type
            }`,
          );
      }
    };

    worker.postMessage(initMessage, initTransfer);
  }

  const PAGE_SIZE = 0x10000;
  const BYTES_PER_MIB = 0x100000;
  const memoryBytes = memoryMib * BYTES_PER_MIB;
  const memoryPages = memoryBytes / PAGE_SIZE;
  const memory = new WebAssembly.Memory({
    initial: memoryPages,
    maximum: memoryPages,
    shared: true,
  });
  assert(memory.buffer.byteLength === memoryBytes);
  const memoryArray = new Uint8Array(memory.buffer);

  // this is a slightly arbitrary choice, but as long as this is
  // less than the number of pages the module requests, there will be
  // no overlap
  let mmioBase = PAGE_SIZE * 32;
  const mmioAlloc = (size: number) => {
    const ptr = mmioBase;
    mmioBase += size;
    return [ptr, size];
  };

  const RNG_REG = mmioAlloc(0x100);
  const rng = new VirtioRegisters(
    memoryArray.subarray(RNG_REG[0], RNG_REG[0] + RNG_REG[1]),
  );

  rng.magic = 0x74726976 as u32; // "virt" in ascii
  rng.version = 2 as u32;
  rng.deviceId = Entropy.DEVICE_ID;
  rng.vendorId = 0x7761736d as u32; // "wasm" in ascii
  rng.driverFeatures = VIRTIO_F_VERSION_1;

  const devicetree = generateDevicetree({
    "#address-cells": 1,
    "#size-cells": 1,
    chosen: {
      "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
      bootargs: cmdline,
      ncpus: cpus,
      sections,
    },
    aliases: {},
    memory: {
      device_type: "memory",
      reg: [0, memoryBytes],
    },
    "reserved-memory": {
      "#address-cells": 1,
      "#size-cells": 1,
      ranges: undefined,
      rng: {
        reg: RNG_REG,
      },
    },
    // disk: {
    //   compatible: "virtio,wasm",
    //   "host-id": 0x7777,
    //   "virtio-id": 2, // blk
    //   interrupts: 31,
    // },
    // rng: {
    //   compatible: "virtio,wasm",
    //   "host-id": 0x4321,
    //   "virtio-id": Entropy.DEVICE_ID,
    //   interrupts: 32,
    // },
    rng: {
      compatible: "virtio,mmio",
      reg: RNG_REG,
      interrupts: [42],
    },
  });

  newWorker(
    "entry",
    { type: ToWorkerMessageType.BOOT, devicetree, vmlinux, memory },
    [devicetree.buffer],
  );

  const machine = eventTarget as Partial<Machine>;
  machine.bootConsole = bootConsole.readable;
  return machine as Machine;
}
