import type { Device, DeviceController } from "../../device.ts";
import { getModuleURL, PAGE_SIZE, type ptr, type u32 } from "../../util.ts";

export interface Config {
  size: u32;
  onAddr(addr: ptr): void;
}

// this is a slightly arbitrary choice, but as long as this is
// less than the number of pages the module requests, there will be
// no overlap
const BASE_ADDR = 32 * PAGE_SIZE;

const controller: DeviceController<Config> = {
  name: "mmio",
  setup(machine, devices) {
    let nextAddr = BASE_ADDR;
    for (const device of devices) {
      const addr = nextAddr;
      nextAddr += device.size;
      device.onAddr(addr as ptr);
    }

    const totalSize = devices.reduce((acc, device) => acc + device.size, 0);

    machine.updateDevicetree({
      "reserved-memory": {
        mmio: { reg: [BASE_ADDR, totalSize] },
      },
    });
  },
  workerURL: getModuleURL(() => import("./worker.ts"), import.meta),
};

export function mmio(
  name: string,
  size: u32,
  onAddr: (addr: ptr) => void,
): Device<Config> {
  return {
    name,
    controller,
    config: { size, onAddr },
  };
}
