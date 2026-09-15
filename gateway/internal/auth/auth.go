package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Route    string `json:"route,omitempty"`
	Database string `json:"database,omitempty"`
	jwt.RegisteredClaims
}
type Validator struct {
	Enabled          bool
	Secret           []byte
	Issuer, Audience string
	MaxTokenBytes    int
	Now              func() time.Time
}

func (v Validator) Validate(token string) (Claims, error) {
	if !v.Enabled {
		return Claims{}, nil
	}
	if len(token) == 0 {
		return Claims{}, errors.New("token is required")
	}
	if len(token) > v.MaxTokenBytes {
		return Claims{}, errors.New("token exceeds configured limit")
	}
	now := v.Now
	if now == nil {
		now = time.Now
	}
	claims := Claims{}
	p, err := jwt.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected signing algorithm %q", t.Method.Alg())
		}
		return v.Secret, nil
	}, jwt.WithIssuer(v.Issuer), jwt.WithAudience(v.Audience), jwt.WithExpirationRequired(), jwt.WithTimeFunc(now), jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !p.Valid {
		if err == nil {
			err = errors.New("invalid token")
		}
		return Claims{}, fmt.Errorf("validate token: %w", err)
	}
	return claims, nil
}
