package proxy

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func BenchmarkProxy64KiB(b *testing.B) {
	payload := make([]byte, 64<<10)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		upstream, server := net.Pipe()
		client, stream := net.Pipe()
		ctx, cancel := context.WithCancel(context.Background())
		go func() { _, _ = io.Copy(server, server) }()
		go func() {
			_ = Run(ctx, stream, Config{Network: "unix", Address: "benchmark", ConnectTimeout: time.Second, IdleTimeout: time.Second, BufferBytes: 32 << 10, Dial: func(context.Context, string, string) (net.Conn, error) { return upstream, nil }})
		}()
		_, _ = client.Write(payload)
		_, _ = io.ReadFull(client, payload)
		cancel()
		_ = client.Close()
		_ = server.Close()
	}
}
