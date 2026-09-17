# Benchmarks

Start the Compose stack, then run:

```sh
make benchmark
```

Chromium measures connection setup, 100 sequential queries, 100 concurrent queries, and a 10,000-row transfer with pool sizes 1, 5, and 20. The JSON output records the user agent, timestamp, session count, and stream count.

Measure gateway proxy throughput and allocations with:

```sh
cd gateway
go test -bench=. -benchmem ./internal/proxy
```

The gateway exposes `pgquic_active_sessions` and `pgquic_active_streams` for load-test correlation.
