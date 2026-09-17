package session

import (
	"testing"
	"time"
)

func TestIPLimiter(t *testing.T) {
	now := time.Unix(0, 0)
	l := NewIPLimiter(60, 2)
	l.now = func() time.Time { return now }
	if !l.Allow("x") {
		t.Fatal("first request rejected")
	}
	if !l.Allow("x") {
		t.Fatal("second request rejected")
	}
	if l.Allow("x") {
		t.Fatal("request beyond burst allowed")
	}
	now = now.Add(time.Second)
	if !l.Allow("x") {
		t.Fatal("refill failed")
	}
}
