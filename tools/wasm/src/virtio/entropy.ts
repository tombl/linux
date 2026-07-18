import { assert } from "../util.ts";
import {
  VirtioController,
  type VirtioDevice,
  type Virtqueue,
} from "./core.ts";

export function entropyDevice(): VirtioDevice {
  function notify(queue: Virtqueue) {
    for (const chain of queue) {
      let n = 0;
      for (const { array, writable } of chain) {
        assert(writable);

        // can't use crypto.getRandomValues on a SharedArrayBuffer
        const arr = new Uint8Array(array.length);
        crypto.getRandomValues(arr);
        array.set(arr);

        n += array.byteLength;
      }
      chain.release(n);
    }
  }

  return new VirtioController(
    { deviceId: 4 },
    { queues: [notify] },
  ).device;
}
