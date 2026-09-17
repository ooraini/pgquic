# Protocol v1

The endpoint accepts an HTTP/3 WebTransport extended CONNECT. The first client-created bidirectional stream is the control stream. Each later bidirectional stream carries one PostgreSQL connection.

Control messages are a four-byte, big-endian length followed by UTF-8 JSON:

```json
{ "version": 1, "token": "<JWT>" }
```

A successful response is:

```json
{ "ok": true, "version": 1, "sessionId": "...", "maxStreams": 10 }
```

Failures set `ok` to `false` and include a non-sensitive `error`. Receivers reject empty, oversized, malformed, and unsupported-version messages.

Data streams have no `pgquic` framing. PostgreSQL startup, authentication, queries, COPY, notifications, and cancellation pass unchanged. WebTransport stream boundaries have no PostgreSQL meaning.

Closing a data stream closes its upstream socket. Closing the session closes every stream. Neither endpoint retries PostgreSQL bytes; a replacement session serves only new connections.
