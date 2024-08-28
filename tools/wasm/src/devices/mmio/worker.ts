import type { WorkerDefault } from "../../device.ts";
import type { ptr } from "../../util.ts";
import type { Config } from "./index.ts";

export default (() => {
  return {
    imports: {
      pre_read: (addr: ptr) => {},
      post_write: (addr: ptr) => {},
    }
  };
}) satisfies WorkerDefault<Config>;
