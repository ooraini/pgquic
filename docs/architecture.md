# Architecture

`PgWebTransport` owns one lazy WebTransport session, the control handshake, reconnection state, and the client-side connection limit. Each node-postgres `Client` gets a `PgWebTransportSocket`; each physical PostgreSQL connection therefore uses one bidirectional QUIC stream within the shared session.

The socket exposes the events expected by node-postgres: `connect`, `data`, `drain`, `error`, and `close`. The package bundles node-postgres with browser shims for the required Node APIs. Browser code cannot reach the Node networking, filesystem, pgpass, or pg-native paths.

The gateway validates the request origin and applies per-origin, per-IP, global-session, and per-session stream limits. When JWT authentication is enabled, a route claim may select only a destination in the server-side route map. The browser never supplies an upstream address.

Each data stream is copied to and from its PostgreSQL socket with fixed buffers, deadlines, and half-close support. The gateway neither parses nor logs PostgreSQL payloads. Closing a stream closes its socket; closing the WebTransport session closes every member connection.

The gateway does not enforce a JWT `database` claim because that would require parsing the PostgreSQL startup packet. Use a separate named route for each database when routing must be database-specific. PostgreSQL roles, grants, and row-level security enforce data access.

In the development stack, QUIC encrypts browser-to-gateway traffic. The gateway-to-PostgreSQL connection runs over the private Compose network without TLS. A lost WebTransport session fails all member connections; the pool may create new connections on a later session generation.
