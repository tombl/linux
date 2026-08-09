// Cloudflare Worker: TCP + DNS proxy for wasm Linux guests.
//
// Protocol
// --------
// WebSocket  /tcp?host=<ip-or-name>&port=<n>
//   binary frames ↔ raw TCP bytes (via cloudflare:sockets)
//
// HTTP GET   /dns?name=<hostname>
//   → { "addresses": ["1.2.3.4", ...] }

import { connect } from "cloudflare:sockets";

interface Env {
  /** Optional allowlist, comma-separated host suffixes. Empty = allow all. */
  ALLOW_HOSTS?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function allowed(host: string, env: Env): boolean {
  const raw = (env.ALLOW_HOSTS ?? "").trim();
  if (!raw) return true;
  const host_l = host.toLowerCase();
  return raw.split(",").some((entry) => {
    const suffix = entry.trim().toLowerCase();
    if (!suffix) return false;
    return host_l === suffix || host_l.endsWith(`.${suffix}`);
  });
}

async function handle_dns(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") ?? "").trim();
  if (!name || /[\s/\\]/.test(name)) return json({ error: "invalid name" }, 400);
  if (!allowed(name, env)) return json({ error: "host not allowed" }, 403);

  // Prefer DoH so the Worker does not need a custom DNS binding.
  const doh = new URL("https://cloudflare-dns.com/dns-query");
  doh.searchParams.set("name", name);
  doh.searchParams.set("type", "A");
  const response = await fetch(doh, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) return json({ error: `upstream dns ${response.status}` }, 502);
  const body = (await response.json()) as {
    Answer?: Array<{ type: number; data: string }>;
  };
  const addresses = (body.Answer ?? [])
    .filter((answer) => answer.type === 1)
    .map((answer) => answer.data)
    .filter((addr) => /^\d+\.\d+\.\d+\.\d+$/.test(addr));
  if (addresses.length === 0) return json({ error: "nxdomain", addresses: [] }, 404);
  return json({ addresses });
}

async function handle_tcp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const host = (url.searchParams.get("host") ?? "").trim();
  const port = Number(url.searchParams.get("port") ?? "");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return new Response("invalid host/port", { status: 400 });
  }
  if (!allowed(host, env)) return new Response("host not allowed", { status: 403 });

  const upgrade = request.headers.get("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  let remote: { readable: ReadableStream; writable: WritableStream; close(): void } | undefined;
  const close_both = (code = 1000, reason = "") => {
    try {
      server.close(code, reason);
    } catch {
      /* ignore */
    }
    try {
      remote?.close();
    } catch {
      /* ignore */
    }
  };

  (async () => {
    try {
      remote = connect({ hostname: host, port });
      const reader = remote.readable.getReader();
      const writer = remote.writable.getWriter();

      server.addEventListener("message", (event) => {
        const data =
          typeof event.data === "string"
            ? new TextEncoder().encode(event.data)
            : new Uint8Array(event.data as ArrayBuffer);
        void writer.write(data).catch(() => close_both(1011, "write failed"));
      });
      server.addEventListener("close", () => close_both());
      server.addEventListener("error", () => close_both(1011, "ws error"));

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) server.send(value);
      }
      close_both();
    } catch (error) {
      const message = error instanceof Error ? error.message : "connect failed";
      try {
        server.send(JSON.stringify({ error: message }));
      } catch {
        /* ignore */
      }
      close_both(1011, message.slice(0, 120));
    }
  })();

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
    }
    if (url.pathname === "/dns") return handle_dns(request, env);
    if (url.pathname === "/tcp") return handle_tcp(request, env);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "linuxwasm-tcp-proxy" });
    }
    return new Response("not found", { status: 404 });
  },
};
