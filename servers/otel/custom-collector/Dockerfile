# Custom otelcol build - see builder-config.yaml for why: Traefik's
# passTLSClientCert middleware does not survive the h2c/gRPC backend hop
# (confirmed empirically 2026-07-15), and otelcol-contrib ships no
# authenticator extension that exposes a verified mTLS client certificate's
# CN to the pipeline. mtlsclientauth/ fills that one gap; everything else
# below is the same component set otel-config.yaml already used from the
# stock otel/opentelemetry-collector-contrib:0.156.0 image.
FROM golang:1.25-bookworm AS builder

RUN go install go.opentelemetry.io/collector/cmd/builder@v0.156.0

WORKDIR /src
COPY mtlsclientauth/ /src/mtlsclientauth/
COPY builder-config.yaml /src/builder-config.yaml

RUN mkdir -p /out && builder --config=/src/builder-config.yaml

# root(nonroot 아님) - server.key가 호스트에서 600(대상 소유자 전용)으로 지켜지고
# 있어서(1-7 개인키 보관 규칙) bind-mount로 들어오면 nonroot distroless 유저는 못 읽음.
# Traefik도 이 파일을 root로 읽었던 것과 동일한 이유.
FROM gcr.io/distroless/base-debian12:latest
COPY --from=builder /out/otelcol-teamb-siem /otelcol
ENTRYPOINT ["/otelcol"]
