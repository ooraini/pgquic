# pgquic

`pgquic` lets browser applications use the familiar node-postgres `Client` and `Pool` APIs over multiplexed WebTransport. One encrypted HTTP/3 session carries many independent, byte-transparent PostgreSQL connections to a Go gateway; the gateway connects only to server-configured PostgreSQL sockets.

```text
browser Pool ─ one WebTransport session ─┬─ stream → PostgreSQL socket
                                        ├─ stream → PostgreSQL socket
                                        └─ stream → CancelRequest socket
```

The gateway is not an SQL API, PostgreSQL authentication implementation, or authorization boundary. It never parses queries/startup packets and cannot route to an address supplied by a browser.

## Quick start

Requirements: Docker with Compose, Node 24+ for local package work, Go 1.25+, and [mkcert](https://github.com/FiloSottile/mkcert).

```sh
make cert
docker compose -f deploy/docker-compose.yml up --build
```

Open [https://localhost:5173](https://localhost:5173), click **Run complete demonstration**, and watch three physical Pool clients share one session. The page also exercises parameterized and prepared queries, independent transactions, LISTEN/NOTIFY, a real PostgreSQL CancelRequest on a temporary stream, a large result workload, and Pool recreation.

For a portable version of the same demo, build after generating certificates and open the self-contained file directly:

```sh
make cert
npm run build -w packages/client
npm run build -w examples/browser
open examples/browser/dist/dashboard.html
```

The dashboard needs no HTTP server. It verifies secure-context and WebTransport support at startup and provides fields for the gateway URL, optional JWT, and `serverCertificateHashes` value. The gateway must opt in with `PGQUIC_ALLOW_NULL_ORIGIN=true` because a local file has an opaque origin; Chromium currently sends `Origin: file://` for this WebTransport request, while other implementations may serialize it as `null`. This setting is disabled by default and is independent of `PGQUIC_JWT_ENABLED`. Neither opaque spelling is treated as a trusted identity or accepted through `PGQUIC_ALLOWED_ORIGINS`.

The checked-in demo credentials (`browser_user` / `development-only-password`) are local-only. The stock PostgreSQL 18 image configuration uses SCRAM-SHA-256 for TCP host connections. Port 5432 is published for convenient local inspection; do not copy that exposure into an Internet-facing deployment. Certificates and private keys are ignored by Git.

## Browser API

```ts
import { Pool, PgWebTransport } from "@pgquic/client";

const transport = new PgWebTransport({
  url: "https://localhost:4433/v1/session",
  token: async () => obtainShortLivedToken(),
  maxConnections: 10,
});

const pool = new Pool({
  transport,
  max: 10,
  user: "browser_user",
  password: "development-only-password",
  database: "app",
  ssl: false,
  enableChannelBinding: false,
});

const result = await pool.query("select id, title from posts where id=$1", [
  123,
]);
await pool.end();
await transport.close();
```

`PgWebTransport.state` exposes status, generation, session ID, active physical connections, and total sessions. A dead session fails all of its Clients. A later Pool connection may establish a new generation with exponential backoff and jitter; pgquic never replays a query, transaction, or queued write.

## Gateway configuration

The executable reads environment variables. Important defaults are:

| Variable                                     | Default                   |
| -------------------------------------------- | ------------------------- |
| `PGQUIC_LISTEN` / `PGQUIC_PATH`              | `:4433` / `/v1/session`   |
| `PGQUIC_METRICS_LISTEN`                      | `:9090`                   |
| `PGQUIC_ALLOWED_ORIGINS`                     | `https://localhost:5173`  |
| `PGQUIC_ALLOW_NULL_ORIGIN`                   | `false`                   |
| `PGQUIC_UPSTREAM`                            | `tcp://127.0.0.1:5432`    |
| `PGQUIC_JWT_ENABLED`                         | `true`                    |
| `PGQUIC_MAX_SESSIONS` / `PGQUIC_MAX_STREAMS` | `1000` / `10`             |
| `PGQUIC_MAX_BUFFERED_BYTES`                  | `262144`                  |
| control / connect / idle / lifetime timeouts | `5s` / `5s` / `5m` / `1h` |

JWT mode currently accepts HS256 with a secret of at least 32 bytes and validates algorithm, signature, expiry, issuer, audience, and typed route/database claims. Configure `PGQUIC_ROUTES` as a JSON map such as `{"tenant-a":{"network":"tcp","address":"postgres.internal:5432"}}`; a token's `route` can select only one of those entries. Tokens and credentials never belong in URLs or logs. JWT authentication is independent of origin policy and remains optional when `PGQUIC_JWT_ENABLED=false`, as in the isolated Compose demo. The client protocol never accepts a PostgreSQL URI; upstream destinations always come from gateway configuration.

Health is at `http://localhost:9090/healthz`; Prometheus metrics are at `/metrics`. Logs are structured JSON and contain connection metadata only.

## Development and verification

```sh
npm install
make test
make race
make build
make lint
cd gateway && go test -bench=. -benchmem ./internal/proxy
```

The TypeScript build is strict, browser-first ESM with declarations and source maps. It bundles the pure-JavaScript node-postgres client, pool, `pg-protocol`, and type/result machinery. Browser shims provide Buffer, EventEmitter, next-tick behavior, string handling, and Web Crypto SCRAM; `net`, `tls`, filesystem, pgpass, and pg-native paths are inaccessible. Socket writes use copied buffers, ordered asynchronous writes, high/low watermarks, and a hard queue limit.

Playwright reports an explicit skip reason when a browser runtime lacks WebTransport. Set `PGQUIC_E2E=1` while the Compose stack is running for the real database scenario. See [benchmarking](docs/benchmarks.md), [architecture](docs/architecture.md), [protocol](docs/protocol.md), [security](docs/security.md), and [deployment/certificates](docs/deployment.md).

## Operational caveats

WebTransport requires working UDP/HTTP/3 end to end. Session loss terminates every PostgreSQL connection inside it. PostgreSQL TLS is disabled on the private Docker-network hop in this demo, so SCRAM-SHA-256-PLUS/channel binding is unavailable; ordinary SCRAM-SHA-256 works. Production deployments using TCP must keep that hop on a trusted private network or add an appropriate protected transport design. Direct browser database access demands narrow roles and RLS—never expose owner, superuser, `BYPASSRLS`, migration, or administrative credentials.

Licensed under MIT. Bundled upstream notices are in `packages/client/LICENSES`.
