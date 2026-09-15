# Architecture

`PgWebTransport` owns one lazy WebTransport session, its control handshake, generation counter, reconnect backoff, and local connection limit. Every node-postgres `Client` receives a `PgWebTransportSocket`; a `Pool` therefore creates one QUIC bidirectional stream per physical PostgreSQL connection without creating another session. The socket facade converts browser streams to EventEmitter-style `connect`, `data`, `drain`, `error`, and `close` events.

The Go HTTP/3 handler validates the exact Origin and a per-origin/per-IP token bucket before upgrade. A global session semaphore bounds sessions. After authentication, route claims select only entries from the server configuration. Per-session semaphores bound live PostgreSQL streams. The proxy performs two fixed-buffer `io.CopyBuffer` loops with deadlines and half-close where the upstream socket supports it. Payloads are neither parsed nor logged.

Portable `file://` clients use a separate, disabled-by-default `allowNullOrigin` gate. It accepts only opaque file-origin serialization (`null`, or Chromium's `file://`) and never promotes it into the trusted origin set. JWT validation remains an independent setting. Regardless of origin or authentication mode, clients cannot supply an upstream address; the gateway dials only its configured PostgreSQL URI or named server-side route.

The development deployment connects the gateway to PostgreSQL over TCP on the private Compose network. QUIC supplies browser-to-gateway encryption; `ssl:false` means the internal gateway-to-PostgreSQL hop is not separately encrypted. SCRAM-SHA-256 still authenticates the database role. Session loss is intentionally a correlated failure domain: all member database connections fail, while the Pool may create fresh clients on a later generation.

## ADR 001: database JWT claims

Route claims are enforced as a lookup into immutable server-side upstreams. A `database` claim is signature/type/expiry validated but not enforced against the startup packet: doing so would violate the gateway's promise never to parse PostgreSQL credentials or payloads. Deployments needing database-specific routing should make each database a separate named route and issue only that route claim. PostgreSQL roles, grants, and RLS remain authoritative.

## ADR 002: maintainable node-postgres fork

The package pins and bundles node-postgres rather than cloning its parser. A narrow constructor adapter supplies the socket and browser shims replace only Node facilities that cannot run in browsers. Web Crypto, already used by current node-postgres SCRAM, remains the cryptographic implementation. `net`, `tls`, `fs`, `pgpass`, and `pg-native` cannot be reached by the public browser configuration.
