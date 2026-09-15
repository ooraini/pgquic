package proxy

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func TestBidirectionalProxy(t *testing.T) {
	upstream, server := net.Pipe()
	defer server.Close()
	go func() { _, _ = io.Copy(server, server) }()
	a, b := net.Pipe()
	defer b.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- Run(ctx, a, Config{Network: "unix", Address: "server-owned", ConnectTimeout: time.Second, IdleTimeout: time.Second, BufferBytes: 4096, Dial: func(context.Context, string, string) (net.Conn, error) { return upstream, nil }})
	}()
	_, _ = b.Write([]byte("hello"))
	got := make([]byte, 5)
	if _, e := io.ReadFull(b, got); e != nil || string(got) != "hello" {
		t.Fatalf("got %q %v", got, e)
	}
	cancel()
	<-done
}

func TestUnixSocketFailureIsReturned(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	if err := Run(context.Background(), a, Config{Network: "unix", Address: "/tmp/pgquic-definitely-missing/socket", ConnectTimeout: time.Millisecond, IdleTimeout: time.Second, BufferBytes: 4096}); err == nil {
		t.Fatal("expected Unix socket connection failure")
	}
}
