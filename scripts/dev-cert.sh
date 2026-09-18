#!/bin/sh
set -eu
mkdir -p certs
# Certificate-hash mode avoids installing a local CA. Browsers require pinned
# WebTransport certificates to be valid for no more than 14 days.
openssl ecparam -name prime256v1 -genkey -noout -out certs/webtransport-key.pem
openssl req -new -x509 -key certs/webtransport-key.pem -out certs/webtransport.pem \
  -days 10 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
# The gateway runs as a non-root user and reads this short-lived development key
# through a bind mount.
chmod 0644 certs/webtransport-key.pem
hash=$(openssl x509 -in certs/webtransport.pem -outform DER | openssl dgst -sha256 -binary | openssl base64 -A)
printf 'PGQUIC_CERT_HASH=%s\n' "$hash" > deploy/.env
echo "Created a 10-day WebTransport certificate and wrote its public SHA-256 hash to deploy/.env."
