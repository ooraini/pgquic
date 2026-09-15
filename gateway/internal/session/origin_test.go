package session

import (
	"github.com/pgquic/pgquic/gateway/internal/config"
	"testing"
)

func TestConfiguredOriginsAreExact(t *testing.T) {
	c := config.Config{AllowedOrigins: map[string]struct{}{"https://app.example": {}}}
	if OriginAllowed(c, "https://evil.example") {
		t.Fatal("unexpected origin")
	}
	if !OriginAllowed(c, "https://app.example") {
		t.Fatal("configured origin missing")
	}
}

func TestNullOriginRequiresExplicitOptIn(t *testing.T) {
	c := config.Config{AllowedOrigins: map[string]struct{}{"null": {}}}
	for _, origin := range []string{"null", "file://"} {
		if OriginAllowed(c, origin) {
			t.Fatalf("opaque origin %q must not be enabled through the trusted origin allowlist", origin)
		}
	}
	c.AllowNullOrigin = true
	for _, origin := range []string{"null", "file://"} {
		if !OriginAllowed(c, origin) {
			t.Fatalf("explicit null-origin opt-in was ignored for %q", origin)
		}
	}
}
