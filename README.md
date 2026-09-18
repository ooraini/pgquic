# pgquic

`pgquic` lets browser applications use familiar PostgreSQL `Client` and `Pool` APIs over WebTransport. One encrypted HTTP/3 session carries multiple independent PostgreSQL connections to a Go gateway.

```text
browser Pool ─ one WebTransport session ─┬─ stream → PostgreSQL socket
                                        ├─ stream → PostgreSQL socket
                                        └─ stream → CancelRequest socket
```

The gateway forwards PostgreSQL bytes without parsing them. Browsers cannot choose an upstream address; the gateway connects only to configured PostgreSQL endpoints. PostgreSQL roles, grants, and row-level security remain the authorization boundary.

Every browser client connects through a `pgquic` gateway. Choose one of these three ways to run it.

## Development

Requirements: Docker with Compose and OpenSSL. Package development also requires Node.js 24+ and Go 1.25+.

```sh
npm install
make cert
docker compose -f deploy/docker-compose.yml up --build
```

Open [http://localhost:5173](http://localhost:5173) and run the demonstration.

Additional demos:

| URL                                                  | Demonstrates                                             |
| ---------------------------------------------------- | -------------------------------------------------------- |
| [pg-cron.html](http://localhost:5173/pg-cron.html)   | pg_cron scheduling and run history                       |
| [pgmq.html](http://localhost:5173/pgmq.html)         | PGMQ queues, messages, and archives                      |
| [commerce.html](http://localhost:5173/commerce.html) | React updates driven by `LISTEN`/`NOTIFY`                |
| [security.html](http://localhost:5173/security.html) | PostgreSQL authentication, roles, and row-level security |
| [cursors.html](http://localhost:5173/cursors.html)   | Shared cursors using `LISTEN`/`NOTIFY`                   |

Run the checks with `make test`, `make race`, `make build`, and `make lint`. Run `make benchmark` with the Compose stack running.

## npm build + gateway container

Install the client in an application built with Vite, Rollup, esbuild, or another browser bundler:

```sh
npm install @ooraini/pgquic
```

```ts
import { Pool, PgWebTransport } from "@ooraini/pgquic";

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

const result = await pool.query("select id, title from posts where id = $1", [
  123,
]);

await pool.end();
await transport.close();
```

Build the application normally, then run the [gateway container](docs/deployment.md#gateway-container):

```sh
docker pull ghcr.io/ooraini/pgquic-gateway:0.1.0
```

## HTML + gateway container

The package is a self-contained ES module, so it can be imported directly from a module script without npm or a build step:

```html
<script type="module">
  import {
    Pool,
    PgWebTransport,
  } from "https://cdn.jsdelivr.net/npm/@ooraini/pgquic@0.1.0/dist/index.js";

  const transport = new PgWebTransport({
    url: "https://db.example.com/v1/session",
    token: () => obtainShortLivedToken(),
  });

  const pool = new Pool({
    transport,
    user: "browser_user",
    password: "password",
    database: "app",
    ssl: false,
    enableChannelBinding: false,
  });

  const result = await pool.query("select now()");
</script>
```

Use `<script type="module">`; the package does not expose a global for classic scripts. Pin the package version in deployed HTML. Serve the page over HTTPS, or see [portable `file://` demos](docs/deployment.md#portable-demos).

`PgWebTransport.state` reports the connection status, session generation and ID, active connections, and session count. Session failure closes all member clients. The pool may open a new session for later connections, but `pgquic` never replays PostgreSQL traffic.

## Gateway configuration

The gateway reads environment variables. Common settings are:

| Variable                    | Default                 |
| --------------------------- | ----------------------- |
| `PGQUIC_LISTEN`             | `:4433`                 |
| `PGQUIC_PATH`               | `/v1/session`           |
| `PGQUIC_METRICS_LISTEN`     | `:9090`                 |
| `PGQUIC_ALLOWED_ORIGINS`    | `http://localhost:5173` |
| `PGQUIC_ALLOW_NULL_ORIGIN`  | `false`                 |
| `PGQUIC_UPSTREAM`           | `tcp://127.0.0.1:5432`  |
| `PGQUIC_JWT_ENABLED`        | `false`                 |
| `PGQUIC_MAX_SESSIONS`       | `1000`                  |
| `PGQUIC_MAX_STREAMS`        | `10`                    |
| `PGQUIC_MAX_BUFFERED_BYTES` | `262144`                |

JWT mode supports HS256 secrets of at least 32 bytes and validates the signature, algorithm, expiry, issuer, audience, and claim types. `PGQUIC_ROUTES` defines named server-side destinations; a token's `route` claim can select one of them. Tokens and database credentials must not appear in URLs or logs.

Health and Prometheus metrics are served from the metrics listener at `/healthz` and `/metrics`. Logs are structured JSON and exclude PostgreSQL payloads.

See [deployment](docs/deployment.md) for certificates, networking, and portable `file://` demos.

Further reading: [architecture](docs/architecture.md), [protocol](docs/protocol.md), [security](docs/security.md), and [benchmarks](docs/benchmarks.md).

Licensed under MIT. Bundled dependency notices are in `packages/client/LICENSES`.
