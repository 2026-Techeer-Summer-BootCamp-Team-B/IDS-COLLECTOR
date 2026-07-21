#!/usr/bin/env bash
# otlp-grpc mTLS용 사설 CA + 클라이언트 인증서 발급 스크립트.
#
# Central SIEM(Traefik)의 otlp-grpc 엔트리포인트(servers/otel/docker-compose.yml의
# tls.options.otlp-mtls.clientauth.caFiles)가 이 CA로 클라이언트 인증서를 검증하고,
# Techeer 쪽 otel-collector(Techeer-12th-b/otel-collector-config.yaml의
# exporters.otlp.tls)가 여기서 나온 client.crt/client.key를 제시한다.
#
# 실행 후:
#   1) ca.crt를 이 디렉터리(servers/proxy/traefik/certs/otlp-client-ca.crt)에 두고
#      Central 서버에서 `docker compose up -d --force-recreate traefik` (proxy/)
#   2) client.crt/client.key를 Techeer 쪽 k3d 클러스터로 옮겨서:
#      kubectl create secret generic otel-client-cert \
#        --from-file=client.crt=client.crt --from-file=client.key=client.key
#   3) ca.key/client.key는 git에 절대 커밋하지 않는다 (.gitignore로 이미 디렉터리 전체 무시)
set -euo pipefail
cd "$(dirname "$0")"

# Git Bash(MSYS)에서 /CN=... 를 윈도우 경로로 오인해 깨뜨리는 것 방지 (Linux에서는 무해)
export MSYS_NO_PATHCONV=1

CA_DAYS=3650
CLIENT_DAYS=825   # 공개 CA(Let's Encrypt 등) 관행에 맞춰 커도 825일 이하로 제한

# 1) 루트 CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days "$CA_DAYS" \
  -subj "/CN=IDS-COLLECTOR otlp-grpc client CA" \
  -out ca.crt

# 2) 클라이언트 키 + CSR + CA 서명
openssl genrsa -out client.key 4096
openssl req -new -key client.key \
  -subj "/CN=techeer-otel-collector" \
  -out client.csr
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days "$CLIENT_DAYS" -sha256 \
  -out client.crt
rm -f client.csr ca.srl

echo
echo "생성 완료: ca.key, ca.crt, client.key, client.crt (이 디렉터리, git-ignored)"
echo
echo "다음 단계:"
echo "  1) Central 서버: 이 디렉터리의 ca.crt를 otlp-client-ca.crt로 배치 후"
echo "     'docker compose up -d --force-recreate traefik' (servers/proxy/)"
echo "  2) Techeer k3d 클러스터:"
echo "     kubectl create secret generic otel-client-cert \\"
echo "       --from-file=client.crt=client.crt --from-file=client.key=client.key"
