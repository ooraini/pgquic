# Benchmarks

Start the complete stack, then run `make benchmark`. Chromium executes connection establishment, 100 sequential small queries, 100 concurrent small queries, and a 10,000-row transfer for pools of 1, 5, and 20 connections. The JSON includes actual session and stream counters plus user agent and timestamp. Keep the raw output when making comparisons.

Run `cd gateway && go test -bench=. -benchmem ./internal/proxy` for proxy throughput and allocations. Monitor `pgquic_active_sessions`, `pgquic_active_streams`, process RSS, and container memory while applying backpressure. No performance claims are made without recorded environment and results.
