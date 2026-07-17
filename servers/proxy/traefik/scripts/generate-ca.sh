#!/usr/bin/env bash
# 외부 OTLP 수신(4317/4318) mTLS용 클라이언트 인증서 발급 전용 CA를 만든다.
#
# 이 CA는 "클라이언트가 유효한 인증서를 제시하는가"만 검증하는 용도다 - 서버
# 인증서(Traefik이 클라이언트에게 제시하는 쪽)는 이 CA와 무관하게 Let's
# Encrypt에서 그대로 발급받는다(퍼블릭 CA라 클라이언트가 별도로 이 CA를
# 신뢰 목록에 넣을 필요가 없음). 이 스크립트는 딱 한 번만 실행하면 된다 -
# CA 키가 곧 신뢰 루트이므로, 이미 있으면 실수로 덮어쓰지 않도록 거부한다.
#
# 산출물(../certs/ca.key, ../certs/ca.crt)은 커밋 대상이 아니다 - 개인키가
# 그대로 담기는 파일이라 반드시 .gitignore로 제외해야 한다(레포에 이미 있는
# .gitignore가 현재 병합 충돌 상태라 이 스크립트에서 자동으로 건드리지 않음 -
# 직접 아래 두 줄을 추가할 것):
#   servers/proxy/traefik/certs/*.key
#   servers/proxy/traefik/certs/*.crt
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/ca.key" ]; then
  echo "이미 CA가 있습니다: $CERT_DIR/ca.key" >&2
  echo "다시 만들면 지금까지 발급한 모든 클라이언트 인증서가 전부 무효화됩니다." >&2
  echo "정말로 새로 만들려면 먼저 $CERT_DIR/ca.key, ca.crt를 직접 지우고 다시 실행하세요." >&2
  exit 1
fi

openssl genrsa -out "$CERT_DIR/ca.key" 4096
chmod 600 "$CERT_DIR/ca.key"

openssl req -x509 -new -nodes \
  -key "$CERT_DIR/ca.key" \
  -sha256 -days 3650 \
  -subj "//CN=SIEM OTLP mTLS Client CA" \
  -out "$CERT_DIR/ca.crt"
# -subj의 "//"는 오타가 아니다 - Windows Git Bash(MSYS)가 "/CN=..."처럼 슬래시로
# 시작하는 인자를 Windows 경로로 오인해서 자동 변환해버리는 문제가 있다(실측
# 확인: "/CN=SIEM..."이 "C:/Program Files/Git/CN=SIEM..."로 깨짐). "//"로 시작하면
# MSYS가 이 변환을 건너뛴다 - 정작 파일 경로 인자(-out 등)는 정상적으로 변환돼야
# 하므로 MSYS_NO_PATHCONV 같은 전역 스위치 대신 이 인자 하나만 이스케이프한다.
# 리눅스(배포 서버)에서는 MSYS 자체가 없어 "//"가 그냥 "/"와 동일하게 해석된다.

echo "CA 생성 완료:"
echo "  개인키: $CERT_DIR/ca.key (600 권한, 절대 배포/공유 금지 - 이걸로 클라이언트 인증서를 무한정 위조 가능)"
echo "  인증서: $CERT_DIR/ca.crt (Traefik에 마운트해서 클라이언트 인증서 검증에 씀 - 유효기간 3650일)"
echo ""
echo "다음 단계: issue-client-cert.sh <클라이언트 식별자> 로 클라이언트 인증서를 발급하세요."
