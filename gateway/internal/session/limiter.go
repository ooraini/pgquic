package session

import (
	"sync"
	"time"
)

type bucket struct {
	tokens  float64
	updated time.Time
}
type IPLimiter struct {
	mu      sync.Mutex
	buckets map[string]bucket
	rate    float64
	burst   float64
	now     func() time.Time
}

func NewIPLimiter(perMinute, burst int) *IPLimiter {
	return &IPLimiter{buckets: map[string]bucket{}, rate: float64(perMinute) / 60, burst: float64(burst), now: time.Now}
}
func (l *IPLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		b = bucket{l.burst, now}
	}
	b.tokens += (now.Sub(b.updated).Seconds() * l.rate)
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.updated = now
	if b.tokens < 1 {
		l.buckets[key] = b
		return false
	}
	b.tokens--
	l.buckets[key] = b
	return true
}
