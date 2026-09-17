package proxy

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

type Config struct {
	Network, Address            string
	ConnectTimeout, IdleTimeout time.Duration
	BufferBytes                 int
	Dial                        func(context.Context, string, string) (net.Conn, error)
}

func Run(ctx context.Context, stream io.ReadWriteCloser, cfg Config) error {
	d := net.Dialer{Timeout: cfg.ConnectTimeout}
	dial := cfg.Dial
	if dial == nil {
		dial = d.DialContext
	}
	upstream, err := dial(ctx, cfg.Network, cfg.Address)
	if err != nil {
		return err
	}
	defer func() {
		_ = stream.Close()
		_ = upstream.Close()
	}()
	if cfg.BufferBytes < 4096 {
		cfg.BufferBytes = 4096
	}
	var once sync.Once
	touch := func() {
		if cfg.IdleTimeout > 0 {
			_ = upstream.SetDeadline(time.Now().Add(cfg.IdleTimeout))
		}
	}
	touch()
	errch := make(chan error, 2)
	copyOne := func(dst io.Writer, src io.Reader, halfClose func() error) {
		buf := make([]byte, cfg.BufferBytes)
		_, e := io.CopyBuffer(writerFunc(func(p []byte) (int, error) { touch(); return dst.Write(p) }), src, buf)
		if halfClose != nil {
			_ = halfClose()
		}
		errch <- e
	}
	go copyOne(upstream, stream, func() error {
		if c, ok := upstream.(*net.UnixConn); ok {
			return c.CloseWrite()
		}
		if c, ok := upstream.(*net.TCPConn); ok {
			return c.CloseWrite()
		}
		return nil
	})
	go copyOne(stream, upstream, stream.Close)
	var result error
	select {
	case <-ctx.Done():
		result = ctx.Err()
		once.Do(func() { _ = upstream.Close(); _ = stream.Close() })
	case result = <-errch:
		if result != nil && !errors.Is(result, io.EOF) && !errors.Is(result, net.ErrClosed) {
			once.Do(func() { _ = upstream.Close(); _ = stream.Close() })
		}
		select {
		case second := <-errch:
			if result == nil || errors.Is(result, io.EOF) {
				result = second
			}
		case <-ctx.Done():
			result = ctx.Err()
			once.Do(func() { _ = upstream.Close(); _ = stream.Close() })
		}
	}
	if errors.Is(result, io.EOF) || errors.Is(result, net.ErrClosed) {
		return nil
	}
	return result
}

type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }
