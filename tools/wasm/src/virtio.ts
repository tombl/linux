import type { u32, u64 } from "./util.ts";

export const DEVICE_ID_ENTROPY = 4 as u32;

export const CONFIG_S_ACKNOWLEDGE = 1 as u32;
export const CONFIG_S_DRIVER = 2 as u32;
export const CONFIG_S_DRIVER_OK = 4 as u32;
export const CONFIG_S_FEATURES_OK = 8 as u32;
export const CONFIG_S_NEEDS_RESET = 0x40 as u32;
export const CONFIG_S_FAILED = 0x80 as u32;
export const TRANSPORT_F_START = 28 as u32;
export const TRANSPORT_F_END = 41 as u32;
export const F_NOTIFY_ON_EMPTY = 24 as u32;
export const F_ANY_LAYOUT = 27 as u32;
export const F_VERSION_1 = 32 as u32;
export const F_ACCESS_PLATFORM = 33 as u32;
export const F_RING_PACKED = 34 as u32;
export const F_IN_ORDER = 35 as u32;
export const F_ORDER_PLATFORM = 36 as u32;
export const F_SR_IOV = 37 as u32;
export const F_RING_RESET = 40 as u32;
export const MMIO_MAGIC_VALUE = 0x000;
export const MMIO_VERSION = 0x004;
export const MMIO_DEVICE_ID = 0x008;
export const MMIO_VENDOR_ID = 0x00c;
export const MMIO_DEVICE_FEATURES = 0x010;
export const MMIO_DEVICE_FEATURES_SEL = 0x014;
export const MMIO_DRIVER_FEATURES = 0x020;
export const MMIO_DRIVER_FEATURES_SEL = 0x024;
export const MMIO_GUEST_PAGE_SIZE = 0x028;
export const MMIO_QUEUE_SEL = 0x030;
export const MMIO_QUEUE_NUM_MAX = 0x034;
export const MMIO_QUEUE_NUM = 0x038;
export const MMIO_QUEUE_ALIGN = 0x03c;
export const MMIO_QUEUE_PFN = 0x040;
export const MMIO_QUEUE_READY = 0x044;
export const MMIO_QUEUE_NOTIFY = 0x050;
export const MMIO_INTERRUPT_STATUS = 0x060;
export const MMIO_INTERRUPT_ACK = 0x064;
export const MMIO_STATUS = 0x070;
export const MMIO_QUEUE_DESC_LOW = 0x080;
export const MMIO_QUEUE_DESC_HIGH = 0x084;
export const MMIO_QUEUE_AVAIL_LOW = 0x090;
export const MMIO_QUEUE_AVAIL_HIGH = 0x094;
export const MMIO_QUEUE_USED_LOW = 0x0a0;
export const MMIO_QUEUE_USED_HIGH = 0x0a4;
export const MMIO_SHM_SEL = 0x0ac;
export const MMIO_SHM_LEN_LOW = 0x0b0;
export const MMIO_SHM_LEN_HIGH = 0x0b4;
export const MMIO_SHM_BASE_LOW = 0x0b8;
export const MMIO_SHM_BASE_HIGH = 0x0bc;
export const MMIO_CONFIG_GENERATION = 0x0fc;
export const MMIO_CONFIG = 0x100;
export const MMIO_INT_VRING = 1 << 0;
export const MMIO_INT_CONFIG = 1 << 1;

export class Registers {
  dv: DataView;
  arr: Uint8Array;

  constructor(arr: Uint8Array) {
    this.dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    this.arr = arr;
  }

  set magic(value: u32) {
    this.dv.setUint32(MMIO_MAGIC_VALUE, value, true);
  }

  set version(value: u32) {
    this.dv.setUint32(MMIO_VERSION, value, true);
  }

  set deviceId(value: u32) {
    this.dv.setUint32(MMIO_DEVICE_ID, value, true);
  }

  set vendorId(value: u32) {
    this.dv.setUint32(MMIO_VENDOR_ID, value, true);
  }

  get deviceFeatures() {
    return this.dv.getUint32(MMIO_DEVICE_FEATURES, true) as u32;
  }

  get deviceFeaturesSel() {
    return this.dv.getUint32(MMIO_DEVICE_FEATURES_SEL, true) as u32;
  }

  set driverFeatures(value: u32) {
    this.dv.setUint32(MMIO_DRIVER_FEATURES, value, true);
  }

  set driverFeaturesSel(value: u32) {
    this.dv.setUint32(MMIO_DRIVER_FEATURES_SEL, value, true);
  }

  set guestPageSize(value: u32) {
    this.dv.setUint32(MMIO_GUEST_PAGE_SIZE, value, true);
  }

  set queueSel(value: u32) {
    this.dv.setUint32(MMIO_QUEUE_SEL, value, true);
  }

  get queueNumMax() {
    return this.dv.getUint32(MMIO_QUEUE_NUM_MAX, true) as u32;
  }

  set queueNum(value: u32) {
    this.dv.setUint32(MMIO_QUEUE_NUM, value, true);
  }

  set queueAlign(value: u32) {
    this.dv.setUint32(MMIO_QUEUE_ALIGN, value, true);
  }

  get queuePfn() {
    return this.dv.getUint32(MMIO_QUEUE_PFN, true) as u32;
  }

  set queuePfn(value: u32) {
    this.dv.setUint32(MMIO_QUEUE_PFN, value, true);
  }

  get queueReady() {
    return this.dv.getUint32(MMIO_QUEUE_READY, true) as u32;
  }

  set queueReady(value: u32) {
    this.dv.setUint32(MMIO_QUEUE_READY, value, true);
  }

  set queueNotify(value: u32) {
    this.dv.setUint32(MMIO_QUEUE_NOTIFY, value, true);
  }

  get interruptStatus() {
    return this.dv.getUint32(MMIO_INTERRUPT_STATUS, true) as u32;
  }

  set interruptAck(value: u32) {
    this.dv.setUint32(MMIO_INTERRUPT_ACK, value, true);
  }

  get status() {
    return this.dv.getUint32(MMIO_STATUS, true) as u32;
  }

  set status(value: u32) {
    this.dv.setUint32(MMIO_STATUS, value, true);
  }

  get queueDesc() {
    const low = this.dv.getUint32(MMIO_QUEUE_DESC_LOW, true);
    const high = this.dv.getUint32(MMIO_QUEUE_DESC_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set queueDesc(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(MMIO_QUEUE_DESC_LOW, low, true);
    this.dv.setUint32(MMIO_QUEUE_DESC_HIGH, high, true);
  }

  get queueAvail() {
    const low = this.dv.getUint32(MMIO_QUEUE_AVAIL_LOW, true);
    const high = this.dv.getUint32(MMIO_QUEUE_AVAIL_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set queueAvail(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(MMIO_QUEUE_AVAIL_LOW, low, true);
    this.dv.setUint32(MMIO_QUEUE_AVAIL_HIGH, high, true);
  }

  get queueUsed() {
    const low = this.dv.getUint32(MMIO_QUEUE_USED_LOW, true);
    const high = this.dv.getUint32(MMIO_QUEUE_USED_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set queueUsed(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(MMIO_QUEUE_USED_LOW, low, true);
    this.dv.setUint32(MMIO_QUEUE_USED_HIGH, high, true);
  }

  set shmSel(value: u32) {
    this.dv.setUint32(MMIO_SHM_SEL, value, true);
  }

  get shmLen() {
    const low = this.dv.getUint32(MMIO_SHM_LEN_LOW, true);
    const high = this.dv.getUint32(MMIO_SHM_LEN_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set shmLen(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(MMIO_SHM_LEN_LOW, low, true);
    this.dv.setUint32(MMIO_SHM_LEN_HIGH, high, true);
  }

  get shmBase() {
    const low = this.dv.getUint32(MMIO_SHM_BASE_LOW, true);
    const high = this.dv.getUint32(MMIO_SHM_BASE_HIGH, true);
    return ((BigInt(high) << 32n) | BigInt(low)) as u64;
  }

  set shmBase(value: u64) {
    const low = Number(value & 0xFFFFFFFFn);
    const high = Number(value >> 32n);
    this.dv.setUint32(MMIO_SHM_BASE_LOW, low, true);
    this.dv.setUint32(MMIO_SHM_BASE_HIGH, high, true);
  }

  get configGeneration() {
    return this.dv.getUint32(MMIO_CONFIG_GENERATION, true) as u32;
  }

  getConfig(size: number) {
    return this.arr.subarray(MMIO_CONFIG, MMIO_CONFIG + size);
  }
}
