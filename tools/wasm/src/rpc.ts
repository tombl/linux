import { assert } from "./util.ts";

type Request = [id: number, fn: string, ...args: unknown[]];
type Response = [id: number, success: boolean, value: unknown];

const TRANSFER = Symbol("transfer");

export function transfer<T extends Transferable>(value: T): T {
  Object.defineProperty(value, TRANSFER, {
    value: true,
    writable: false,
  });
  return value;
}

const shouldTransfer = (value: object): value is Transferable =>
  TRANSFER in value;

function* getTransfers<T>(
  value: T,
  seen: Set<unknown>,
): Generator<Transferable> {
  if (typeof value !== "object" || value === null) return;

  if (seen.has(value)) return;
  seen.add(value);

  if (shouldTransfer(value)) yield value;

  if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const key in value) {
      yield* getTransfers(value[key], seen);
    }
  }
}

export function expose<T>(port: MessagePort, handlers: T): void {
  port.onmessage = async (event) => {
    const [id, fn, ...args] = event.data as Request;
    const handler = handlers[fn as keyof T];
    try {
      assert(typeof handler === "function", "no such function");
      const value = await handler.call(handlers, ...args);
      port.postMessage(
        [id, true, value] satisfies Response,
        { transfer: [...getTransfers(value, new Set())] },
      );
    } catch (error) {
      port.postMessage(
        [id, false, error] satisfies Response,
        { transfer: [...getTransfers(error, new Set())] },
      );
    }
  };
}

export type RemoteOf<T> = {
  // deno-lint-ignore no-explicit-any
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]:
    T[K] extends (...args: infer Args) => infer Return
      ? (...args: Args) => Promise<Awaited<Return>>
      : never;
};

export function wrap<T>(port: MessagePort) {
  const resolvers = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  let nextId = 0;

  port.onmessage = (event) => {
    const [id, success, value] = event.data as Response;
    const { resolve, reject } = resolvers.get(id) ?? {};
    resolvers.delete(id);
    (success ? resolve : reject)?.(value);
  };

  return new Proxy({} as RemoteOf<T>, {
    get: <K extends string & keyof RemoteOf<T>>(
      _: never,
      prop: K,
    ) => {
      if (prop === "then") return undefined;
      return (...args: unknown[]) => {
        const id = nextId++;
        const promise = new Promise((resolve, reject) => {
          resolvers.set(id, { resolve, reject });
        });
        const seen = new Set();
        port.postMessage(
          [id, prop, ...args] satisfies Request,
          { transfer: args.flatMap((arg) => [...getTransfers(arg, seen)]) },
        );
        return promise;
      };
    },
  });
}

export interface BootstrapMessage {
  mainToWorker: MessagePort;
  workerToMain: MessagePort;
}

export async function sendBootstrap<
  Exposed,
  Remote,
>(worker: Worker, exposed: Exposed) {
  const mainToWorker = new MessageChannel();
  const workerToMain = new MessageChannel();

  const msg = await new Promise(
    (resolve) =>
      worker.addEventListener(
        "message",
        (event: MessageEvent) => resolve(event.data),
        { once: true },
      ),
  );
  assert(msg === "ready");

  worker.postMessage(
    {
      mainToWorker: mainToWorker.port1,
      workerToMain: workerToMain.port1,
    } satisfies BootstrapMessage,
    [mainToWorker.port1, workerToMain.port1],
  );
  expose(mainToWorker.port2, exposed);
  return wrap<Remote>(workerToMain.port2);
}

export async function bootstrapWorker<
  Exposed,
  Remote,
>(exposed: Exposed) {
  self.postMessage("ready");

  const { mainToWorker, workerToMain } = await new Promise<BootstrapMessage>(
    (resolve) =>
      self.addEventListener(
        "message",
        (event: MessageEvent) => resolve(event.data),
        { once: true },
      ),
  );

  // this is a hack to make sure we're ready before we receive messages
  queueMicrotask(() => expose(workerToMain, exposed));

  return wrap<Remote>(mainToWorker);
}
