#!/usr/bin/env node
// Static server with COOP/COEP for SharedArrayBuffer, plus a local
// WebSocket TCP/DNS proxy that matches tools/wasm/network/cf-tcp-proxy.
import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".ext4": "application/octet-stream",
  ".cpio": "application/octet-stream",
  ".json": "application/json",
  ".map": "application/json",
};

function isolation_headers() {
  return {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}

function accept_key(key) {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

function encode_ws_frame(payload, opcode = 0x2) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, data]);
}

function attach_ws_parser(socket, { onMessage, onClose }) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    onClose();
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const b0 = buffer[0];
      const b1 = buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;
      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        if (buffer.readUInt32BE(2) !== 0) {
          socket.destroy();
          return;
        }
        payloadLen = buffer.readUInt32BE(6);
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      const total = offset + maskLen + payloadLen;
      if (buffer.length < total) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      let payload = buffer.subarray(offset + maskLen, total);
      buffer = buffer.subarray(total);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      if (opcode === 0x8) {
        finish();
        return;
      }
      if (opcode === 0x9) {
        socket.write(encode_ws_frame(payload, 0xa));
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) onMessage(payload);
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
}

function upgrade_websocket(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return null;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept_key(key)}\r\n` +
      "\r\n",
  );
  if (head?.length) socket.unshift(head);
  return socket;
}

function handle_tcp_ws(req, socket, head) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const host = (url.searchParams.get("host") || "").trim();
  const portN = Number(url.searchParams.get("port") || "");
  const ws = upgrade_websocket(req, socket, head);
  if (!ws) return;
  if (!host || !Number.isInteger(portN) || portN < 1 || portN > 65535) {
    ws.write(encode_ws_frame(Buffer.from("invalid host/port"), 0x1));
    ws.end();
    return;
  }

  const remote = net.connect({ host, port: portN });
  let closed = false;
  const closeBoth = () => {
    if (closed) return;
    closed = true;
    try {
      remote.destroy();
    } catch {
      /* ignore */
    }
    try {
      ws.end();
    } catch {
      /* ignore */
    }
  };

  remote.on("connect", () => {
    attach_ws_parser(ws, {
      onMessage: (payload) => {
        if (!remote.destroyed) remote.write(payload);
      },
      onClose: closeBoth,
    });
  });
  remote.on("data", (chunk) => {
    if (!ws.destroyed) ws.write(encode_ws_frame(chunk, 0x2));
  });
  remote.on("error", closeBoth);
  remote.on("close", closeBoth);
  ws.on("error", closeBoth);
}

async function handle_dns(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const name = (url.searchParams.get("name") || "").trim();
  if (!name || /[\s/\\]/.test(name)) {
    res.writeHead(400, { "Content-Type": "application/json", ...isolation_headers() });
    res.end(JSON.stringify({ error: "invalid name" }));
    return;
  }
  try {
    const addresses = await dns.resolve4(name);
    res.writeHead(200, { "Content-Type": "application/json", ...isolation_headers() });
    res.end(JSON.stringify({ addresses }));
  } catch (error) {
    res.writeHead(404, { "Content-Type": "application/json", ...isolation_headers() });
    res.end(JSON.stringify({ error: String(error), addresses: [] }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/dns") {
    void handle_dns(req, res);
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...isolation_headers() });
    res.end(JSON.stringify({ ok: true, service: "linuxwasm-demo+tcp-proxy" }));
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/demo/index.html";
  const file = path.normalize(path.join(root, rel)).replace(/\\/g, "/");
  if (!file.startsWith(root.replace(/\\/g, "/"))) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      ...isolation_headers(),
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/tcp") {
    handle_tcp_ws(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`demo http://127.0.0.1:${port}/`);
  console.log(`tcp  ws://127.0.0.1:${port}/tcp?host=&port=`);
  console.log(`dns  http://127.0.0.1:${port}/dns?name=`);
});
