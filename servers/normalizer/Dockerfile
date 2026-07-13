FROM python:3.11-slim

WORKDIR /app

# 빌드 컨텍스트가 servers/ 루트다(docker-compose.yml 참고) - normalizer/correlation-engine이
# 공유하는 NormalizedEvent 스키마(shared/ids_shared)를 같은 이미지에 설치해야 해서다.
COPY shared ./shared
COPY normalizer/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY normalizer/app ./app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200"]
