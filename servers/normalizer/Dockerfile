FROM python:3.11-slim

WORKDIR /app

# 빌드 컨텍스트가 servers/ 루트다(docker-compose.yml 참고) - normalizer/correlation-engine이
# 공유하는 NormalizedEvent 스키마(shared/ids_shared)를 같은 이미지에 설치해야 해서다.
COPY shared ./shared
COPY normalizer/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY normalizer/app ./app

# non-root 실행 - uid 고정(appuser:1000) 후 /app 소유권을 넘긴다. 이 서비스는 런타임에
# severity.yaml만 읽고(app/severity.py) 로컬 파일에 쓰는 경로가 없어서 read 권한만
# 있으면 되지만, COPY 소유자(root)와 실행 유저를 맞춰 두는 게 원칙이라 chown한다.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200"]
