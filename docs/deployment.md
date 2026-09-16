# Deployment and certificates

For local development, run `make cert`. The script creates a 10-day ECDSA certificate for the WebTransport gateway and writes its public hash to `deploy/.env`; Compose passes that hash to Vite. The demo origin uses `http://localhost`, which browsers treat as a secure context, so no local CA installation or certificate trust step is required. Private keys and the generated `deploy/.env` are ignored and must never be committed.

Chromium implementations that expose `serverCertificateHashes` may use a short-lived self-signed ECDSA certificate (valid no more than 14 days) and a SHA-256 hash of its DER certificate bytes supplied to `PgWebTransport`. Support varies; production must use normal browser-trusted certificate validation and must never disable verification.

## Portable file dashboard

Run `make cert`, build the client and browser workspaces, then open `examples/browser/dist/dashboard.html` directly with a `file://` URL. The artifact contains the same complete demonstration as the hosted page, with all JavaScript and CSS inline. It makes no HTTP request for application assets.

`file://` is potentially trustworthy under the Secure Contexts specification, but user agents may impose stricter rules; the dashboard checks `window.isSecureContext` and `WebTransport` before connecting. Chromium may also require a local-network permission before a file can reach `localhost`. Grant that permission in browser settings if prompted. WebTransport intentionally exposes an opaque opening-handshake failure, so the dashboard presents separate actions for local-network permission, certificate verification, and opaque-origin rejection.

Set `PGQUIC_ALLOW_NULL_ORIGIN=true` to opt the gateway into portable-file requests. It is false by default. The gateway recognizes only the opaque `null` spelling and Chromium's current `file://` WebTransport spelling through this switch; putting either value in `PGQUIC_ALLOWED_ORIGINS` has no effect. The switch does not authenticate the file and is orthogonal to `PGQUIC_JWT_ENABLED`. If JWT is enabled, paste a valid token into the dashboard; if it is disabled, the token is optional.

WebTransport certificate errors are fatal and do not offer a click-through interstitial. For ephemeral development certificates, `serverCertificateHashes` contains the SHA-256 hash of the certificate DER bytes—not a private key—and the certificate must be valid for no more than 14 days. `make cert` writes the current base64 hash to `deploy/.env`; builds use it to prefill the dashboard, and it can also be pasted manually after certificate rotation. Certificate hashes authenticate only the server, never the client.

Expose UDP/443 (or UDP/4433 for development), not merely TCP. Confirm firewalls, Kubernetes Services, NAT, and load balancers support HTTP/3/QUIC and preserve affinity for a session. If corporate networks block UDP, WebTransport cannot connect; pgquic deliberately has no insecure fallback. Inspect the browser network log, gateway JSON logs, `/healthz`, and `/metrics`. A certificate that works for ordinary HTTPS can still fail WebTransport if SANs, trust, or HTTP/3 advertisement are wrong.
