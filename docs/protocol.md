# pgquic protocol v1

The endpoint is an HTTP/3 WebTransport extended CONNECT. The browser opens one session. The first client-created bidirectional stream is permanently the control stream; every later bidirectional stream is an independent, byte-transparent PostgreSQL connection.

The control stream carries `uint32` big-endian length followed by UTF-8 JSON. The client sends `{"version":1,"token":"<JWT>"}`. Success is `{"ok":true,"version":1,"sessionId":"...","maxStreams":10}`. Failure uses `ok:false` and a non-sensitive `error`. Receivers reject zero-length, oversized, malformed, and unsupported-version frames.

No database stream has pgquic framing. Startup, SCRAM, extended-query, COPY, notification, and CancelRequest bytes pass unchanged. WebTransport stream boundaries have no PostgreSQL meaning. Opening before control success is impossible because the gateway consumes the first stream as control and the client manager gates later opens.

Closing one stream closes its server-selected upstream socket. Closing a session closes every stream. Neither endpoint retries PostgreSQL bytes. A new session has a new generation and can serve only newly created physical connections.
