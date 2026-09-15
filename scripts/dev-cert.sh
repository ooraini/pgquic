#!/bin/sh
set -eu
mkdir -p certs
if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1
  echo "Created a locally trusted localhost certificate."
else
  echo "mkcert is required. Install it from https://github.com/FiloSottile/mkcert" >&2
  exit 1
fi

# Certificate-hash mode requires a self-signed certificate valid for no more
# than 14 days. It is intentionally separate from the HTTPS origin certificate.
openssl ecparam -name prime256v1 -genkey -noout -out certs/webtransport-key.pem
openssl req -new -x509 -key certs/webtransport-key.pem -out certs/webtransport.pem \
  -days 10 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
hash=$(openssl x509 -in certs/webtransport.pem -outform DER | openssl dgst -sha256 -binary | openssl base64 -A)
printf 'PGQUIC_CERT_HASH=%s\n' "$hash" > deploy/.env
echo "Created a 10-day WebTransport certificate and wrote its public SHA-256 hash to deploy/.env."
