# Security and threat model

Assets include database credentials, row data, service availability, and route configuration. Attackers may control browser input, tokens, origins, stream timing, fragmentation, and PostgreSQL payload bytes. They must not control the upstream address.

Controls: TLS 1.3/HTTP/3; exact Origin allowlisting; short-lived HS256 JWT validation with issuer, audience, expiry, algorithm and size limits; server-only route maps; global and per-session limits; QUIC incoming-stream limits; fixed copy buffers; write-queue hard limits; timeouts; rate limiting; structured metadata-only logs; graceful socket cleanup. Prefer an asymmetric JWT verifier or isolated secret manager in a production extension; the current release implements HS256.

Direct browser database access is safe only with narrow PostgreSQL roles and row-level security. Never expose owner, superuser, `BYPASSRLS`, migration, replication, or administrative credentials. Revoke default schema privileges, grant specific tables/functions, set statement and transaction timeouts, and test RLS as the browser role. The gateway is transport and authentication glue—not an authorization substitute.

SCRAM-SHA-256-PLUS is unavailable because there is no end-to-end PostgreSQL TLS channel; use ordinary SCRAM-SHA-256. Password and protocol payloads must never be logged. Tokens must never appear in URLs. Rotate signing keys and database passwords, use short token expiry, bind routes narrowly, monitor rejection/error metrics, and firewall UDP plus the metrics listener.

Production checklist: trusted publicly valid certificate; JWT enabled; exact origins; non-default limits; private and appropriately protected gateway-to-PostgreSQL network; PostgreSQL port not publicly exposed; gateway not exposed as arbitrary TCP proxy; health listener private; least-privilege role/RLS; container resource limits; dependency scanning; log redaction verification; QUIC load-balancer validation; shutdown drill; session-loss behavior tested.

`PGQUIC_ALLOW_NULL_ORIGIN` is disabled by default. Enable it only when portable local files are an intended client surface. An opaque `null` or `file://` origin is never a trusted identity, and adding those strings to `PGQUIC_ALLOWED_ORIGINS` cannot enable them. Null-origin policy and JWT authentication are independent controls: enabling file access does not enable or bypass JWT. The control protocol carries no database URI; every upstream address remains server configuration.
