package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/pgquic/pgquic/gateway/internal/auth"
	"github.com/pgquic/pgquic/gateway/internal/config"
	"github.com/pgquic/pgquic/gateway/internal/observability"
	"github.com/pgquic/pgquic/gateway/internal/session"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "error", err)
		os.Exit(2)
	}
	cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil {
		log.Error("load TLS certificate", "error", err)
		os.Exit(2)
	}
	reg := prometheus.NewRegistry()
	metrics := observability.New(reg)
	h3 := &http3.Server{Addr: cfg.ListenAddress, TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13, NextProtos: []string{http3.NextProtoH3}}, QUICConfig: &quic.Config{EnableDatagrams: true, MaxIncomingStreams: int64(cfg.MaxStreams + cfg.MaxPendingStreams + 1)}}
	wt := &webtransport.Server{H3: h3, CheckOrigin: func(r *http.Request) bool {
		return session.OriginAllowed(cfg, r.Header.Get("Origin"))
	}}
	webtransport.ConfigureHTTP3Server(h3)
	validator := auth.Validator{Enabled: cfg.JWTEnabled, Secret: cfg.JWTSecret, Issuer: cfg.JWTIssuer, Audience: cfg.JWTAudience, MaxTokenBytes: cfg.MaxTokenBytes}
	srv := session.NewServer(cfg, wt, validator, metrics, log)
	mux := http.NewServeMux()
	mux.HandleFunc(cfg.Path, srv.Handler)
	h3.Handler = mux
	healthMux := http.NewServeMux()
	healthMux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	healthMux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	health := &http.Server{Addr: cfg.MetricsAddress, Handler: healthMux, ReadHeaderTimeout: cfg.ControlTimeout}
	errch := make(chan error, 2)
	go func() {
		log.Info("metrics listener started", "address", cfg.MetricsAddress)
		errch <- health.ListenAndServe()
	}()
	go func() {
		log.Info("webtransport listener started", "address", cfg.ListenAddress, "path", cfg.Path, "config_fingerprint", cfg.ConfigFingerprint())
		errch <- wt.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
	}()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
	case err := <-errch:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("listener failed", "error", err)
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	_ = health.Shutdown(shutdown)
	if err := srv.Shutdown(shutdown); err != nil {
		log.Error("shutdown incomplete", "error", err)
	}
}
