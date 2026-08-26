FROM python:3.11-slim

WORKDIR /app

# normalizer/correlation-engine과 달리 ids_shared(공유 스키마)를 쓰지 않는 순수
# 포워더라(forwarder.py 모듈 docstring 참고 - GCP LogEntry를 파싱하지 않고 그대로
# 옮기기만 함) 빌드 컨텍스트를 servers/ 루트로 넓힐 필요가 없다.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# non-root 실행 - 다른 서비스들과 동일하게 uid 고정.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8500"]
