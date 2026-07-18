import { Struct, U32LE, U64LE } from "../bytes.ts";
import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
} from "./core.ts";

const BlockDeviceFeatures = {
  RO: 1n << 5n,
  FLUSH: 1n << 9n,
} as const;

class BlockDeviceConfig extends Struct({ capacity: U64LE }) {}

class BlockDeviceRequest extends Struct({
  type: U32LE,
  reserved: U32LE,
  sector: U64LE,
}) {}

const BlockDeviceRequestType = {
  IN: 0,
  OUT: 1,
  FLUSH: 4,
  GET_ID: 8,
} as const;

const BlockDeviceStatus = {
  OK: 0,
  IOERR: 1,
  UNSUPP: 2,
} as const;

type MaybePromise<T> = T | Promise<T>;

export interface BlockDeviceStorage {
  read(offset: number, length: number): MaybePromise<Uint8Array>;
  write?(offset: number, data: Uint8Array): MaybePromise<number>;
  flush?(): MaybePromise<void>;
  capacity: number;
}

export function blockDevice(storage: BlockDeviceStorage): VirtioDevice {
  const config = new Uint8Array(BlockDeviceConfig.size);
  new BlockDeviceConfig(config).capacity = BigInt(storage.capacity / 512);
  let features = 0n;
  if (storage.flush) features |= BlockDeviceFeatures.FLUSH;
  if (!storage.write) features |= BlockDeviceFeatures.RO;

  async function notify(queue: Virtqueue, controller: VirtioController) {
    for (const chain of queue) {
      const descs = [...chain];
      const header = descs[0];
      const status = descs[descs.length - 1];
      const data = descs.slice(1, -1);

      assert(header && !header.writable, "header must be readonly");
      assert(
        header.array.byteLength === BlockDeviceRequest.size,
        `header size is ${header.array.byteLength}`,
      );
      assert(status && status.writable, "status must be writable");
      assert(
        status.array.byteLength === 1,
        `status size is ${status.array.byteLength}`,
      );
      const status_desc = status;

      const request = new BlockDeviceRequest(header.array);

      function set_status(value: number) {
        status_desc.array[0] = value;
      }

      let n = 0;
      let offset = Number(request.sector) * 512;
      switch (request.type) {
        case BlockDeviceRequestType.IN: {
          for (const desc of data) {
            assert(desc.writable, "data must be writable when IN");
            const arr = await storage.read(offset, desc.array.byteLength);
            desc.array.set(arr);
            n += arr.byteLength;
            offset += arr.byteLength;
          }
          set_status(BlockDeviceStatus.OK);
          break;
        }
        case BlockDeviceRequestType.OUT: {
          if (!storage.write) {
            set_status(BlockDeviceStatus.UNSUPP);
            break;
          }
          let ok = true;
          for (const desc of data) {
            assert(!desc.writable, "data must be readonly when OUT");
            const written = await storage.write(offset, desc.array);
            if (written !== desc.array.byteLength) {
              ok = false;
              break;
            }
            n += written;
            offset += written;
          }
          set_status(ok ? BlockDeviceStatus.OK : BlockDeviceStatus.IOERR);
          break;
        }
        case BlockDeviceRequestType.FLUSH: {
          if (!storage.flush) {
            set_status(BlockDeviceStatus.UNSUPP);
            break;
          }
          await storage.flush();
          set_status(BlockDeviceStatus.OK);
          break;
        }
        case BlockDeviceRequestType.GET_ID: {
          console.log("GET_ID");
          set_status(BlockDeviceStatus.OK);
          break;
        }
        default:
          console.error("unknown request type", request.type);
          set_status(BlockDeviceStatus.UNSUPP);
      }

      chain.release(n);
    }
    controller.raiseInterrupt("vring");
  }

  return new VirtioController(
    { deviceId: 2, features, config },
    { queues: [notify] },
  ).device;
}
