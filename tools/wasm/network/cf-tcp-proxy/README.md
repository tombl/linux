# linuxwasm TCP proxy (Cloudflare Workers)

WebSocket TCP + DNS proxy used by the wasm Linux demo so guest `wget` / `curl`
traffic can reach the public Internet from the browser.

## Protocol

| Endpoint | Transport | Purpose |
| --- | --- | --- |
| `/tcp?host=&port=` | WebSocket, binary frames | Bidirectional raw TCP |
| `/dns?name=` | HTTP JSON | A-record lookup via DoH |

## Deploy

```bash
cd tools/wasm/network/cf-tcp-proxy
npm install
npx wrangler login
npx wrangler deploy
```

Point the demo at the worker with:

```
https://example.com/demo/?proxy=wss://linuxwasm-tcp-proxy.<account>.workers.dev
```

## Local development

The demo static server (`tools/wasm/demo/server.mjs`) speaks the same protocol
on the page origin (`/tcp`, `/dns`) using Node `net.connect`, so `wget` works
without deploying a Worker.
