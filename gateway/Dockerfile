FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /pgquic-gateway ./cmd/pgquic-gateway

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /pgquic-gateway /usr/local/bin/pgquic-gateway
COPY LICENSE /licenses/pgquic.txt
EXPOSE 4433/udp 9090/tcp
ENTRYPOINT ["/usr/local/bin/pgquic-gateway"]
