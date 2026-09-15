package session

import (
	"testing"
	"time"
)

func TestIPLimiter(t *testing.T) {
	now := time.Unix(0, 0)
	l := NewIPLimiter(60, 2)
	l.now = func() time.Time { return now }
	if !l.Allow("x") || !l.Allow("x") || l.Allow("x") {
		t.Fatal("burst failed")
	}
	now = now.Add(time.Second)
	if !l.Allow("x") {
		t.Fatal("refill failed")
	}
}
