#!/usr/bin/env bash
# 외부 OTLP 수신(4317/4318) mTLS에 쓸 클라이언트 인증서를 발급한다.
# generate-ca.sh를 먼저 한 번 실행해서 CA가 있어야 한다. 여러 클라이언트를
# 발급해야 하면(예: Target plane 서버마다 하나씩) 식별자만 바꿔서 여러 번
# 실행하면 된다 - 기존 CA/다른 클라이언트 인증서에는 영향 없음.
#
# Traefik은 인증서가 이 CA로 서명됐다는 것만 확인한다 - CN/SAN 값 자체를
# 파이프라인으로 넘기는 기능은 없으므로(설계상 제외), CN은 사람이 나중에
# "이게 누구 인증서였는지" 구분하는 용도로만 쓰인다.
#
# 산출물(../certs/<식별자>-client.key/.crt)은 커밋 대상이 아니다 - 발급 후
# 안전한 채널로 클라이언트에게 전달하고 로컬에는 남겨두지 말 것을 권장.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "사용법: $0 <클라이언트 식별자> [유효기간(일), 기본 825]" >&2
  echo "예: $0 target-plane-prod" >&2
  exit 1
fi

CLIENT_ID="$1"
DAYS="${2:-825}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/certs"

if [ ! -f "$CERT_DIR/ca.key" ] || [ ! -f "$CERT_DIR/ca.crt" ]; then
  echo "CA가 없습니다 - 먼저 generate-ca.sh를 실행하세요 ($CERT_DIR 아래에 ca.key/ca.crt가 있어야 함)." >&2
  exit 1
fi

KEY="$CERT_DIR/${CLIENT_ID}-client.key"
CSR="$CERT_DIR/${CLIENT_ID}-client.csr"
CRT="$CERT_DIR/${CLIENT_ID}-client.crt"
EXT="$CERT_DIR/${CLIENT_ID}-client.ext"

if [ -f "$CRT" ]; then
  echo "이미 '$CLIENT_ID' 이름으로 발급된 인증서가 있습니다: $CRT" >&2
  echo "재발급하려면 그 파일을 먼저 지우고 다시 실행하세요(기존 파일을 덮어쓰지 않음)." >&2
  exit 1
fi

openssl genrsa -out "$KEY" 2048
chmod 600 "$KEY"

openssl req -new -key "$KEY" -subj "//CN=${CLIENT_ID}" -out "$CSR"
# -subj의 "//"는 오타가 아니다 - generate-ca.sh와 동일한 이유(Windows Git
# Bash/MSYS가 "/CN=..."을 Windows 경로로 오인해서 자동 변환하는 문제 우회,
# 리눅스에서는 영향 없음).

cat > "$EXT" <<EOF
subjectAltName = DNS:${CLIENT_ID}
extendedKeyUsage = clientAuth
EOF

openssl x509 -req \
  -in "$CSR" \
  -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
  -out "$CRT" \
  -days "$DAYS" -sha256 \
  -extfile "$EXT"

rm -f "$CSR" "$EXT"

echo "클라이언트 인증서 발급 완료 (CN=${CLIENT_ID}, ${DAYS}일 유효):"
echo "  개인키: $KEY"
echo "  인증서: $CRT"
echo ""
echo "이 두 파일만 클라이언트(OTLP exporter)에 전달하면 된다 - 서버 인증서는"
echo "Let's Encrypt(퍼블릭 CA)가 발급하므로 클라이언트가 이 CA(ca.crt)를 별도로"
echo "신뢰할 필요는 없다."
