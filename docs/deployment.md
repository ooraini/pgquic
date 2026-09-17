# Deployment

## Certificates

For local development, `make cert` creates a 10-day ECDSA certificate and writes its SHA-256 hash to `deploy/.env`. The demo passes that hash to WebTransport through `serverCertificateHashes`.

## Networking

Expose the gateway over UDP, normally UDP/443. Firewalls, NAT, Kubernetes Services, and load balancers must support HTTP/3 and preserve session affinity. `pgquic` has no fallback when a network blocks UDP.

Use the browser network log, gateway logs, `/healthz`, and `/metrics` when diagnosing connections. A certificate that works for HTTPS may still fail WebTransport because of trust, SAN, or HTTP/3 configuration.

## Portable demos

Build self-contained HTML files with:

```sh
make cert
npm run build -w packages/client
npm run build -w examples/browser
```

Open a file from `examples/browser/dist/` directly. Each demo contains its JavaScript and CSS and needs no HTTP server.

Portable files have an opaque origin. The gateway accepts `null` and Chromium's `file://` serialization only when `PGQUIC_ALLOW_NULL_ORIGIN=true`. The supplied Compose stack enables this setting; the gateway default is `false`. This setting does not authenticate the client or bypass JWT validation.

The browser must treat the file as a secure context and may request permission to reach localhost. WebTransport certificate failures do not provide a click-through warning; regenerate or enter the current certificate hash instead.
