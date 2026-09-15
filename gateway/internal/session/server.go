package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pgquic/pgquic/gateway/internal/auth"
	"github.com/pgquic/pgquic/gateway/internal/config"
	"github.com/pgquic/pgquic/gateway/internal/observability"
	"github.com/pgquic/pgquic/gateway/internal/proxy"
	"github.com/quic-go/webtransport-go"
)

type Server struct {
	cfg     config.Config
	wt      *webtransport.Server
	auth    auth.Validator
	metrics *observability.Metrics
	log     *slog.Logger
	slots   chan struct{}
	limiter *IPLimiter
	wg      sync.WaitGroup
	closing atomic.Bool
}

// OriginAllowed treats the opaque file:// origin as a transport eligibility
// signal only. Authentication is configured independently.
func OriginAllowed(cfg config.Config, origin string) bool {
	// Chromium currently serializes a file document's WebTransport Origin as
	// file://, while other opaque-origin paths use the standard null spelling.
	if origin == "null" || origin == "file://" {
		return cfg.AllowNullOrigin
	}
	_, ok := cfg.AllowedOrigins[origin]
	return ok
}

func NewServer(cfg config.Config, wt *webtransport.Server, v auth.Validator, m *observability.Metrics, log *slog.Logger) *Server {
	return &Server{cfg: cfg, wt: wt, auth: v, metrics: m, log: log, slots: make(chan struct{}, cfg.MaxSessions), limiter: NewIPLimiter(cfg.RatePerMinute, cfg.RateBurst)}
}
func (s *Server) Handler(w http.ResponseWriter, r *http.Request) {
	if s.closing.Load() {
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	}
	if r.URL.Path != s.cfg.Path {
		http.NotFound(w, r)
		return
	}
	origin := r.Header.Get("Origin")
	if !OriginAllowed(s.cfg, origin) {
		s.metrics.Rejected.Inc()
		s.log.Warn("origin rejected", "origin", origin, "remote_addr", r.RemoteAddr)
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if !s.limiter.Allow(origin + "\x00" + host) {
		s.metrics.Rejected.Inc()
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	select {
	case s.slots <- struct{}{}:
	default:
		s.metrics.Rejected.Inc()
		http.Error(w, "session limit reached", http.StatusServiceUnavailable)
		return
	}
	sess, err := s.wt.Upgrade(w, r)
	if err != nil {
		<-s.slots
		s.metrics.Rejected.Inc()
		s.log.Warn("webtransport upgrade rejected", "remote_ip", host, "error", err)
		return
	}
	s.wg.Add(1)
	s.metrics.Sessions.Inc()
	s.metrics.SessionsTotal.Inc()
	go func() {
		defer s.wg.Done()
		defer func() { <-s.slots; s.metrics.Sessions.Dec() }()
		s.serveSession(sess, origin, host)
	}()
}
func (s *Server) serveSession(sess *webtransport.Session, origin, remoteIP string) {
	id := randomID()
	ctx, cancel := context.WithTimeout(sess.Context(), s.cfg.SessionLifetime)
	defer cancel()
	defer sess.CloseWithError(0, "session closed")
	controlCtx, stop := context.WithTimeout(ctx, s.cfg.ControlTimeout)
	control, err := sess.AcceptStream(controlCtx)
	stop()
	if err != nil {
		s.log.Info("control stream failed", "session_id", id, "error", err)
		return
	}
	_ = control.SetDeadline(time.Now().Add(s.cfg.ControlTimeout))
	hello, err := ReadFrame(control, s.cfg.MaxControlBytes)
	if err != nil {
		_ = WriteFrame(control, Welcome{OK: false, Version: ProtocolVersion, Error: "invalid control message"}, s.cfg.MaxControlBytes)
		_ = control.Close()
		return
	}
	claims, err := s.auth.Validate(hello.Token)
	if err != nil {
		_ = WriteFrame(control, Welcome{OK: false, Version: ProtocolVersion, Error: "authentication failed"}, s.cfg.MaxControlBytes)
		_ = control.Close()
		s.metrics.Rejected.Inc()
		return
	}
	routeName := claims.Route
	if routeName == "" {
		routeName = s.cfg.DefaultRoute
	}
	route, ok := s.cfg.Routes[routeName]
	if !ok {
		_ = WriteFrame(control, Welcome{OK: false, Version: ProtocolVersion, Error: "route not permitted"}, s.cfg.MaxControlBytes)
		_ = control.Close()
		s.metrics.Rejected.Inc()
		return
	}
	_ = control.SetDeadline(time.Time{})
	if err := WriteFrame(control, Welcome{OK: true, Version: ProtocolVersion, SessionID: id, MaxStreams: s.cfg.MaxStreams}, s.cfg.MaxControlBytes); err != nil {
		_ = control.Close()
		return
	}
	s.log.Info("session authenticated", "session_id", id, "origin", origin, "remote_ip", remoteIP, "route", routeName)
	sem := make(chan struct{}, s.cfg.MaxStreams)
	var streams sync.WaitGroup
	defer func() { _ = control.Close(); streams.Wait(); s.log.Info("session closed", "session_id", id) }()
	for {
		stream, err := sess.AcceptStream(ctx)
		if err != nil {
			return
		}
		select {
		case sem <- struct{}{}:
			streams.Add(1)
			s.metrics.Streams.Inc()
			go func(st io.ReadWriteCloser) {
				defer streams.Done()
				defer func() { <-sem; s.metrics.Streams.Dec() }()
				err := proxy.Run(ctx, st, proxy.Config{Network: route.Network, Address: route.Address, ConnectTimeout: s.cfg.ConnectTimeout, IdleTimeout: s.cfg.IdleTimeout, BufferBytes: s.cfg.MaxBufferedBytes})
				if err != nil && !errors.Is(err, context.Canceled) {
					s.metrics.UpstreamErrors.Inc()
					s.log.Warn("database stream closed", "session_id", id, "error", err)
				}
			}(stream)
		default:
			s.metrics.Rejected.Inc()
			_ = stream.Close()
		}
	}
}
func (s *Server) Shutdown(ctx context.Context) error {
	s.closing.Store(true)
	_ = s.wt.Close()
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "unavailable"
	}
	return hex.EncodeToString(b[:])
}
