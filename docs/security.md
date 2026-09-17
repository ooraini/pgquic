# Security

The gateway is a transport boundary, not a database authorization layer. Treat browser input, JWTs, origins, stream timing, and PostgreSQL payloads as untrusted. A browser must never control the upstream address.

## Gateway controls

- TLS 1.3 over HTTP/3
- Exact origin allowlisting
- Optional HS256 JWT validation with issuer, audience, expiry, algorithm, type, and size checks
- Server-defined upstream routes
- Connection, stream, buffer, rate, and timeout limits
- Metadata-only structured logs
- Graceful stream and socket cleanup

`PGQUIC_ALLOW_NULL_ORIGIN` permits portable local files and is disabled by default. An opaque origin is not an identity. Enabling it does not enable or bypass JWT authentication.

## PostgreSQL access

Browser connections should use dedicated PostgreSQL roles with only the required grants and row-level security policies. `pgquic` does not add an authorization layer.

Use SCRAM-SHA-256 for PostgreSQL authentication. SCRAM-SHA-256-PLUS is unavailable because the PostgreSQL TLS channel does not extend through the gateway.
