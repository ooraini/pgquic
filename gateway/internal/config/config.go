package config

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Route struct {
	Network string `json:"network"`
	Address string `json:"address"`
}

type Config struct {
	ListenAddress     string
	MetricsAddress    string
	Path              string
	TLSCertFile       string
	TLSKeyFile        string
	AllowedOrigins    map[string]struct{}
	AllowNullOrigin   bool
	Routes            map[string]Route
	DefaultRoute      string
	JWTEnabled        bool
	JWTSecret         []byte
	JWTIssuer         string
	JWTAudience       string
	MaxSessions       int
	MaxStreams        int
	MaxPendingStreams int
	MaxBufferedBytes  int
	MaxTokenBytes     int
	MaxControlBytes   int
	ControlTimeout    time.Duration
	ConnectTimeout    time.Duration
	IdleTimeout       time.Duration
	SessionLifetime   time.Duration
	ShutdownTimeout   time.Duration
	RatePerMinute     int
	RateBurst         int
}

func Load() (Config, error) {
	c := Config{
		ListenAddress: env("PGQUIC_LISTEN", ":4433"), MetricsAddress: env("PGQUIC_METRICS_LISTEN", ":9090"),
		Path: env("PGQUIC_PATH", "/v1/session"), TLSCertFile: env("PGQUIC_TLS_CERT", "certs/webtransport.pem"),
		TLSKeyFile: env("PGQUIC_TLS_KEY", "certs/webtransport-key.pem"), JWTEnabled: envBool("PGQUIC_JWT_ENABLED", false),
		JWTSecret: []byte(os.Getenv("PGQUIC_JWT_SECRET")), JWTIssuer: env("PGQUIC_JWT_ISSUER", "pgquic-dev"),
		JWTAudience: env("PGQUIC_JWT_AUDIENCE", "pgquic"), MaxSessions: envInt("PGQUIC_MAX_SESSIONS", 1000),
		MaxStreams: envInt("PGQUIC_MAX_STREAMS", 10), MaxPendingStreams: envInt("PGQUIC_MAX_PENDING_STREAMS", 32),
		MaxBufferedBytes: envInt("PGQUIC_MAX_BUFFERED_BYTES", 256<<10), MaxTokenBytes: envInt("PGQUIC_MAX_TOKEN_BYTES", 16<<10),
		MaxControlBytes: envInt("PGQUIC_MAX_CONTROL_BYTES", 32<<10), ControlTimeout: envDuration("PGQUIC_CONTROL_TIMEOUT", 5*time.Second),
		ConnectTimeout: envDuration("PGQUIC_CONNECT_TIMEOUT", 5*time.Second), IdleTimeout: envDuration("PGQUIC_IDLE_TIMEOUT", 5*time.Minute),
		SessionLifetime: envDuration("PGQUIC_SESSION_LIFETIME", time.Hour), ShutdownTimeout: envDuration("PGQUIC_SHUTDOWN_TIMEOUT", 15*time.Second),
		RatePerMinute: envInt("PGQUIC_RATE_PER_MINUTE", 120), RateBurst: envInt("PGQUIC_RATE_BURST", 20),
		DefaultRoute: env("PGQUIC_DEFAULT_ROUTE", "default"), AllowedOrigins: parseSet(env("PGQUIC_ALLOWED_ORIGINS", "http://localhost:5173")),
		AllowNullOrigin: envBool("PGQUIC_ALLOW_NULL_ORIGIN", false),
	}
	c.Routes = map[string]Route{"default": parseUpstream(env("PGQUIC_UPSTREAM", "tcp://127.0.0.1:5432"))}
	if raw := os.Getenv("PGQUIC_ROUTES"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &c.Routes); err != nil {
			return Config{}, fmt.Errorf("PGQUIC_ROUTES: %w", err)
		}
	}
	if _, ok := c.Routes[c.DefaultRoute]; !ok {
		return Config{}, fmt.Errorf("default route %q is not configured", c.DefaultRoute)
	}
	for name, route := range c.Routes {
		if route.Network != "unix" && route.Network != "tcp" {
			return Config{}, fmt.Errorf("route %q has unsupported network", name)
		}
		if strings.TrimSpace(route.Address) == "" {
			return Config{}, fmt.Errorf("route %q has empty address", name)
		}
	}
	if c.JWTEnabled && len(c.JWTSecret) < 32 {
		return Config{}, errors.New("PGQUIC_JWT_SECRET must contain at least 32 bytes when JWT is enabled")
	}
	if c.MaxStreams < 1 || c.MaxPendingStreams < 1 || c.MaxSessions < 1 {
		return Config{}, errors.New("session and stream limits must be positive")
	}
	return c, nil
}

func (c Config) ConfigFingerprint() string {
	b, _ := json.Marshal(c.Routes)
	sum := sha256.Sum256(b)
	return fmt.Sprintf("%x", sum[:8])
}

func parseUpstream(v string) Route {
	switch {
	case strings.HasPrefix(v, "unix://"):
		return Route{"unix", strings.TrimPrefix(v, "unix://")}
	case strings.HasPrefix(v, "tcp://"):
		return Route{"tcp", strings.TrimPrefix(v, "tcp://")}
	default:
		return Route{"unix", v}
	}
}
func parseSet(v string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out[s] = struct{}{}
		}
	}
	return out
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, e := strconv.Atoi(v); e == nil {
			return n
		}
	}
	return d
}
func envBool(k string, d bool) bool {
	if v := os.Getenv(k); v != "" {
		if b, e := strconv.ParseBool(v); e == nil {
			return b
		}
	}
	return d
}
func envDuration(k string, d time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if n, e := time.ParseDuration(v); e == nil {
			return n
		}
	}
	return d
}
