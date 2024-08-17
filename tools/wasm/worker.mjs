// originally from https://raw.githubusercontent.com/developit/web-worker/main/node.js
/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { fileURLToPath } from "node:url";
import * as threads from "node:worker_threads";

// this module is used self-referentially on both sides of the
// thread boundary, but behaves differently in each context.
export default threads.isMainThread ? mainThread() : workerThread();

function mainThread() {
  class Worker extends EventTarget {
    #worker;
    constructor(url, { name } = {}) {
      super();
      const mod = fileURLToPath(url);
      const worker = new threads.Worker(
        import.meta.filename,
        { workerData: { mod, name }, name },
      );
      this.#worker = worker;
      worker.on("message", (data) => {
        const event = new Event("message");
        event.data = data;
        this.dispatchEvent(event);
      });
      worker.on("error", (error) => {
        const event = new Event("error");
        event.error = error;
        this.dispatchEvent(event);
      });
      worker.on("exit", () => {
        this.dispatchEvent(new Event("close"));
      });
    }
    postMessage(data, transferList) {
      this.#worker.postMessage(data, transferList);
    }
    terminate() {
      this.#worker.terminate();
    }
  }
  Worker.prototype.onmessage = null;
  Worker.prototype.onerror = null;
  Worker.prototype.onclose = null;
  return Worker;
}

function workerThread() {
  const { mod, name } = threads.workerData;
  if (!mod) return mainThread();

  // turn global into a mock WorkerGlobalScope
  const self = global.self = global;

  threads.parentPort.on("message", (data) => {
    const event = new Event("message");
    event.data = data;
    self.dispatchEvent(event);
  });
  threads.parentPort.on("error", (err) => {
    err.type = "Error";
    self.dispatchEvent(err);
  });

  class WorkerGlobalScope extends EventTarget {
    postMessage(data, transferList) {
      threads.parentPort.postMessage(data, transferList);
    }
    // Emulates https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/close
    close() {
      process.exit();
    }
  }
  let proto = Object.getPrototypeOf(global);
  delete proto.constructor;
  Object.defineProperties(WorkerGlobalScope.prototype, proto);
  proto = Object.setPrototypeOf(global, new WorkerGlobalScope());
  ["postMessage", "addEventListener", "removeEventListener", "dispatchEvent"]
    .forEach((fn) => {
      proto[fn] = proto[fn].bind(global);
    });
  global.name = name;

  import(mod);
}
