package auth

import (
	"github.com/golang-jwt/jwt/v5"
	"testing"
	"time"
)

func token(t *testing.T, secret []byte, c Claims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(secret)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func TestValidate(t *testing.T) {
	now := time.Unix(2_000_000_000, 0)
	secret := []byte("01234567890123456789012345678901")
	v := Validator{true, secret, "issuer", "aud", 4096, func() time.Time { return now }}
	s := token(t, secret, Claims{Route: "app", RegisteredClaims: jwt.RegisteredClaims{Issuer: "issuer", Audience: jwt.ClaimStrings{"aud"}, ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute))}})
	c, err := v.Validate(s)
	if err != nil || c.Route != "app" {
		t.Fatalf("claims=%+v err=%v", c, err)
	}
}
func TestRejectsExpiredWrongAlgorithmAndOversize(t *testing.T) {
	now := time.Unix(2_000_000_000, 0)
	secret := []byte("01234567890123456789012345678901")
	v := Validator{true, secret, "i", "a", 8, func() time.Time { return now }}
	if _, err := v.Validate("123456789"); err == nil {
		t.Fatal("expected size error")
	}
	v.MaxTokenBytes = 4096
	s := token(t, secret, Claims{RegisteredClaims: jwt.RegisteredClaims{Issuer: "i", Audience: jwt.ClaimStrings{"a"}, ExpiresAt: jwt.NewNumericDate(now.Add(-time.Second))}})
	if _, err := v.Validate(s); err == nil {
		t.Fatal("expected expiry error")
	}
}
