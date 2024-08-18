// corrosponds to arch/wasm/drivers/virtio_wasm.c

import { assert, type ptr, type u32, type u64, type u8 } from "../util.ts";
import { F_VERSION_1 } from "../virtio.ts";

export abstract class Device {
  config = new Uint8Array();
  configGeneration = 0 as u32;
  status = 0 as u8;
  features = BigInt(F_VERSION_1) as u64;

  abstract readonly DEVICE_ID: u32;

  init(): void {}
  reset(): void {}
}

export class Entropy extends Device {
  static readonly DEVICE_ID = 4 as u32;
  DEVICE_ID = Entropy.DEVICE_ID;

  init(): void {
    console.log("Entropy initialized");
  }
}

export class Imports {
  #memory: Uint8Array;
  #devices: Map<u32, Device>;
  constructor(memory: Uint8Array, devices: Map<u32, Device>) {
    this.#memory = memory;
    this.#devices = devices;
  }

  init = (deviceId: u32, kind: u32): u32 => {
    const device = this.#devices.get(deviceId);
    try {
      if (!device) throw new Error(`no such device: ${deviceId}`);
      assert(
        device.DEVICE_ID === kind,
        `device kind mismatch, expected ${device.DEVICE_ID}, got ${kind}`,
      );
      device.init();
    } catch (err) {
      console.error(err);
      return -1 as u32;
    }
    return 0 as u32;
  };

  remove = (deviceId: u32): void => {
    console.log("removing device", deviceId);
    this.#devices.delete(deviceId);
  };

  get_config = (deviceId: u32, offset: u32, buf: ptr, len: u32): void => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    this.#memory.set(device.config.slice(offset, offset + len), buf);
  };

  set_config = (deviceId: u32, offset: u32, buf: ptr, len: u32): void => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    device.config.set(this.#memory.slice(buf, buf + len), offset);
    device.configGeneration++;
  };

  config_generation = (deviceId: u32): u32 => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    return device.configGeneration;
  };

  get_status = (deviceId: u32): u8 => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    return device.status;
  };

  set_status = (deviceId: u32, status: u8): void => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    device.status = status;
  };

  reset = (deviceId: u32): void => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    device.reset();
  };

  vring_init = (
    deviceId: u32,
    index: u32,
    num: u32,
    desc: ptr,
    avail: ptr,
    used: ptr,
  ): void => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");

    console.log("vring_init", deviceId, index, num, desc, avail, used);
  };

  del_vqs = (deviceId: u32): void => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    throw new Error("not implemented");
  };

  get_features = (deviceId: u32): u64 => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    return device.features;
  };

  finalize_features = (deviceId: u32): u32 => {
    const device = this.#devices.get(deviceId);
    assert(device, "no such device");
    console.log("finalize_features", device.features);
    return 0 as u32;
  };
}
