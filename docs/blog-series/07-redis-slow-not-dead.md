# [SENTINEL-OPS 장애 대응 시리즈 ①] Redis가 죽지 않고 느려졌다

> 2026-09-15, 실제 GCP 서버에서 toxiproxy로 Redis 지연/무응답을 주입해 재현한 기록이다. 처음부터 정답을 알고 시작한 게 아니라, 가설을 세우고 하나씩 틀리면서 좁혀간 순서 그대로 적었다 — 중간에 틀린 판단도 그대로 남겨뒀다.

---

## 배경 — 왜 이 실험을 했나

SENTINEL-OPS는 Redis 컨테이너 하나(`redis:7-alpine`, 클러스터 아님)를 세 서비스가 나눠 쓴다.

- **normalizer** (`servers/normalizer/app/dedupe.py`) — 이벤트 중복 억제 키(SETNX, TTL 1시간)
- **correlation-engine** (`servers/correlation-engine/app/rules.py`) — 시나리오 임계값 카운터, 시퀀스 상태, 쿨다운
- **platform-api** (`servers/platform-api/app/auth.py`) — 로그인 세션(`session:{token}`, TTL)

코드를 읽어보면 이 셋 중 둘(normalizer, correlation-engine)은 이미 Redis 호출에 타임아웃을 걸어뒀고, platform-api는 아무 방어도 없었다. "이게 진짜 위험한가?"를 코드 읽기만으로 판단하지 않고, 실제로 Redis를 죽이지 않고 **무응답 상태로 만들어서** 셋이 각자 어떻게 반응하는지 직접 보기로 했다.

방법은 실제 Redis나 코드를 건드리지 않고, `redis:6379` 앞에 [toxiproxy](https://github.com/Shopify/toxiproxy)를 끼워 넣는 것이었다. normalizer/correlation-engine/platform-api의 `REDIS_URL`만 잠깐 프록시 쪽을 보게 바꾸고, 그 프록시에 장난질(toxic)을 걸었다.

![](https://velog.velcdn.com/images/yongwook0001/post/82eb88f5-a622-4dbb-8d6c-71c63b0f80cd/image.png)

```bash
docker run -d --name redis-toxiproxy --network siem-net -p 127.0.0.1:8474:8474 ghcr.io/shopify/toxiproxy
docker exec redis-toxiproxy /toxiproxy-cli create -l 0.0.0.0:16379 -u redis:6379 redis
docker compose -f docker-compose.yml -f ~/toxiproxy-drill-override.yml \
  up -d --no-deps normalizer correlation-engine platform-api
```

![](https://velog.velcdn.com/images/yongwook0001/post/dfb691e7-214d-4799-b98d-83440cf06c7b/image.png)

![](https://velog.velcdn.com/images/yongwook0001/post/b6a5cd29-a923-4682-897d-89d05c605923/image.png)

---

## 1차 시도 — "그냥 느려지는 것"만으로 충분할까

먼저 k6 위에서 redis를 활용한 순서 기반과 상관 분석에 대한 지연을 테스트 해보았다.

![](https://velog.velcdn.com/images/yongwook0001/post/fc951838-1bad-4a13-a421-af104b0b4b09/image.png)

가장 먼저 걸어본 건 가벼운 지연이었다.

```bash
docker exec redis-toxiproxy /toxiproxy-cli toxic add -t latency -a latency=300 -a jitter=50 redis
```

![](https://velog.velcdn.com/images/yongwook0001/post/6d708b92-5e92-47ea-a184-2676f06cf347/image.png)

이 상태로 `servers/loadtest/platform-api.js`를 20 VU, 3분간 돌렸다. 예상은 이랬다 — "platform-api는 타임아웃이 없으니까, 이 정도 지연만 걸어도 일부 요청이 확 막힐 거다."

```
http_req_duration..: avg=601.38ms min=264.21ms med=539.32ms max=3.05s p(90)=923.97ms p(95)=1.09s
http_req_failed....: 0.00%  0 out of 10101
✗ 'p(95)<800' p(95)=1.09s
✓ 'rate<0.01' rate=0.00%
```

![](https://velog.velcdn.com/images/yongwook0001/post/9f8f47bd-e8d6-4592-ae7a-5856cb9ffd1f/image.png)

threshold(`p95<800ms`)는 확실히 깨졌다 — 체감 저하는 있었다. **근데 실패율이 0%였다.** 예상이 빗나갔다. 300ms±50ms는 결국 유한한 지연이라, 아무리 오래 걸려도 Redis가 결국은 응답을 줬기 때문이다. "타임아웃이 없어서 위험하다"는 가설을 증명하려면, Redis가 **아예 응답을 안 주는** 상황을 만들어야 한다는 걸 이 실패에서 배웠다.

---

## 2차 시도 — 완전 무응답으로 올림

```bash
docker exec redis-toxiproxy /toxiproxy-cli toxic remove -n latency_downstream redis
docker exec redis-toxiproxy /toxiproxy-cli toxic add -t timeout -a timeout=0 redis
```

toxiproxy 문서대로면 `timeout=0`은 "연결을 끊지도 않고 데이터도 안 보낸다." Redis가 죽은 게 아니라 **영원히 대답을 안 하는** 상태다.

![](https://velog.velcdn.com/images/yongwook0001/post/9e7b5a73-750f-48ab-bf8a-215c049f1366/image.png)

correlation-engine 로그에 반복되는 드롭이 찍히기 시작했다.

```
[correlation] WARN: 상관분석/인시던트 upsert 실패 (1/3회, event.id=...), 1초 후 재시도:
[correlation] WARN: 상관분석/인시던트 upsert 실패 (2/3회, event.id=...), 2초 후 재시도:
[correlation] ERROR: 상관분석/인시던트 upsert 실패, 3회 재시도 소진 - 이벤트는 건너뜀:
```

![](https://velog.velcdn.com/images/yongwook0001/post/6ba22b02-05c0-4b5b-a00a-f6d3a220c456/image.png)

처음엔 콜론 뒤 예외 메시지가 비어 보여서, 뭐가 원인인지 바로 안 보였다. `grep -i "circuit\|서킷"`으로 다시 훑어보고서야 실제 원인이 드러났다.

```
[correlation] ERROR: ... 이벤트는 건너뜀 (연속 드롭 40건째): Redis 서킷 open 상태 (state=OPEN)
```

[스크린샷 자리: `docker logs correlation-engine --since 5m | grep -i "circuit\|서킷"` 결과 — "연속 드롭 N건째"가 쭉 이어지는 터미널]

`RedisCircuitBreaker`가 설계대로 OPEN됐다. 여기까진 예상대로였다.

## 용의자 — "왜 서킷이 안 닫히지?"

문제는 그다음이었다. 서킷은 `reset_timeout_seconds=30.0` 뒤에 half-open으로 넘어가서 다시 시도해야 하고, 개별 호출 타임아웃은 0.5초인데 우리가 건 지연은 300ms대였으니 — 이론적으로는 30초 지나면 금방 CLOSED로 돌아와야 했다. 근데 5분 넘게 지켜봐도 계속 OPEN이었고, 드롭 카운터는 40을 넘어갔다.

이 시점에 세운 가설은 이거였다: **"half-open 상태에서 동시에 여러 이벤트가 시도하면, 하나라도 실패하면 다시 OPEN으로 되돌아가는 구조라 영영 안 닫히는 거 아닐까?"** `RedisCircuitBreaker`에 half-open 시도 횟수를 제한하는 락이 없다는 걸 코드에서 이미 확인했던 터라, 꽤 그럴듯해 보였다.

그런데 이 가설은 틀렸다. 확인하려고 `toxiproxy-cli inspect redis`를 다시 찍어봤더니:

```
timeout_downstream      type=timeout    stream=downstream       toxicity=1.00   attributes=[  timeout=0       ]
```

![](https://velog.velcdn.com/images/yongwook0001/post/bedfc1cf-96d9-4785-aac0-1f0c81187638/image.png)

걸려있던 toxic이 애초에 latency(300ms)가 아니라 **timeout=0(완전 무응답)** 이었다. 어느 시점에 latency에서 timeout으로 바뀌어 있었던 것이다. 이러면 half-open이 매번 실패하는 게 당연하다 — Redis가 진짜로 응답을 하나도 안 주고 있으니, 시험 삼아 보내는 half-open 호출도 예외 없이 실패한다. **구조적 버그가 아니라, 그냥 toxic 자체가 그만큼 독했던 것이었다.**

---

## 확정 — platform-api를 직접 찔러봄

가설이 정정되고 나니, 오히려 이건 완벽한 조건이었다. Redis가 진짜로 무응답인 상태를 만들어뒀으니, platform-api가 정말 무한 대기하는지 직접 확인할 수 있었다.

```bash
time curl -sk --max-time 15 -X POST https://.../api/auth/login -d '{"username":"...","password":"..."}'
```
```
real    0m15.027s
```

![](https://velog.velcdn.com/images/yongwook0001/post/b3b6bf08-8db9-467f-b847-bd293a8c08e2/image.png)

`--max-time 15`가 강제로 끊을 때까지 15초 내내 응답이 하나도 안 왔다. 이 제한이 없었다면 정말 끝없이 기다렸을 것이다. 코드로만 예측했던 `socket_timeout=None`의 위험이 실측으로 확인된 순간이었다.

**남은 의심 하나 — 혹시 호스트 자원 부족이 진짜 원인 아닐까?** 단일 GCP VM(4vCPU/16GB)이라 다른 컨테이너와 자원 경쟁이 원인일 가능성도 배제해야 했다. Node Exporter Full을 확인했다.

![](https://velog.velcdn.com/images/yongwook0001/post/1061efcd-9fe3-4184-9139-4d5facbf1237/image.png)

CPU Busy 64~65%, Sys Load 90%→131.5%로 오르긴 했지만, 이건 이번 세션 전체(여러 차례 k6 실행 + 컨테이너 재시작 누적)에 걸쳐 서서히 오른 수치였지, 드릴 구간에만 튀는 급격한 스파이크가 아니었다. Swap은 이 VM에 파티션 자체가 없어서 항상 N/A. **호스트 자원은 평소와 크게 다르지 않았다 — 이 가설도 배제.**

![](https://velog.velcdn.com/images/yongwook0001/post/8c0299f7-b850-4303-8b40-174aa8cf2ac9/image.png)

마지막으로 Kafka Exporter의 "Message consume per minute" 패널에서 전체 그림을 확인했다.

![](https://velog.velcdn.com/images/yongwook0001/post/3509b255-1226-4fda-976f-c5b04d9fde27/image.png)

correlation-engine의 `events.normalized` 소비량이 200~250/분에서 완전히 0으로 뚝 떨어졌다가(약 16:36~16:44, 8분간), 컨테이너를 강제 재시작한 시점부터 다시 올라왔다. 이 그래프 하나가 지금까지 추적한 이야기의 시작과 끝을 그대로 보여준다.

![](https://velog.velcdn.com/images/yongwook0001/post/9a12c46c-478e-4f0c-a802-5ef5bdf1e32d/image.png)

**복구는 자동으로 안 됐다.** Redis가 계속 무응답이던 동안은 서킷이 스스로 못 닫히니, toxic을 제거한 뒤에도 실제 이벤트 드롭이 이어졌다. 결국 `docker restart correlation-engine`으로 강제 초기화하고서야 정상 처리(`인시던트 발화` 로그)가 재개됐다. 재시작 전까지 스킵되고 오프셋이 이미 커밋된 이벤트들(연속 드롭 40건 이상, 실제 WAS/Falco/audit 이벤트 포함)은 그대로 유실됐다 — 이건 이 드릴이 남긴 실제 비용이다.

![](https://velog.velcdn.com/images/yongwook0001/post/0ecf3259-dd52-4264-be8f-5d932d84d7bb/image.png)

[스크린샷 자리: `docker restart correlation-engine` 실행 직후 `docker logs -f correlation-engine` — "인시던트 발화" 로그가 다시 찍히기 시작하는 복구 순간]

재시작 후 복구되는 동안 옆에서 보던 두 패널도 흥미로웠다. PostgreSQL 트랜잭션(committed)이 평소 ~8/s에서 재시작 직후부터 ~17.5/s로 거의 두 배 뛰어서 10여 분 유지되다 다시 평소치로 돌아왔다 — 멈춰있던 동안 쌓인 인시던트 upsert 백로그를 몰아서 처리한 흔적으로 보인다. rollback은 시종일관 0이라 실패한 트랜잭션은 없었다. ClickHouse 쪽은 같은 구간에 짧고 뾰족한 쿼리 스파이크(0→24→0)가 찍혔는데, 이건 Postgres만큼 확실하게 원인을 특정하지 못했다 — 같은 복구 과정의 부산물인지 별개의 조회 트래픽인지는 추가 확인이 필요하다.

![](https://velog.velcdn.com/images/yongwook0001/post/6230ff3f-ca67-47d1-a568-5bb7edee5915/image.png)

![](https://velog.velcdn.com/images/yongwook0001/post/4242ee23-7fc2-4fa8-8a3a-d8151e714151/image.png)

### 못 채운 자리 — cAdvisor

컨테이너별 CPU/메모리로 한 번 더 교차 확인하려 했지만 포기했다. 이 프로젝트의 cAdvisor(`v0.47.2`)는 `container_memory_usage_bytes` 같은 메트릭에 `name`/`image` 같은 사람이 읽을 수 있는 라벨을 전혀 안 붙인다 — `id`(cgroup 경로, `/system.slice/docker-<64자리 해시>.scope`), `instance`, `job`만 있다. 컨테이너를 구분하려면 `docker inspect`로 전체 ID 해시를 뽑아 정규식으로 매칭해야 하는데, 오늘 밤엔 거기까지 안 갔다. 별도 개선 과제로 남긴다.

---

## 결정적 증거

normalizer와 correlation-engine은 느려지거나 응답 없는 Redis에도 정해진 시간 안에 "포기"한다. platform-api는 포기할 줄을 몰랐다 — 그리고 이번 드릴로 그게 실측으로 확인됐다.

```python
# servers/normalizer/app/dedupe.py — 2026-07-21에 이미 고친 버전
_redis = redis.from_url(
    settings.redis_url,
    socket_connect_timeout=settings.redis_socket_connect_timeout_seconds,  # 3.0
    socket_timeout=settings.redis_socket_timeout_seconds,                  # 3.0
)
```

```python
# servers/correlation-engine/app/redis_circuit_breaker.py — 이번 세션에 추가, 이번 드릴로 OPEN 전환 실측
result = await asyncio.wait_for(
    bound_method(*args, **kwargs), timeout=self._call_timeout  # 기본 0.5초
)
```

```python
# servers/platform-api/app/auth.py 28번째 줄 — 지금 이 상태 그대로, 15.027초 무응답 실측
_redis = redis.from_url(settings.redis_url, decode_responses=True)
```

세 번째 코드에는 `socket_timeout`도 `socket_connect_timeout`도 없다. `redis-py`(버전 5.2.1, pip로 직접 설치해 시그니처 확인) 소스를 보면:

```python
# redis-py 5.2.1 · redis/asyncio/connection.py · AbstractConnection.__init__
socket_timeout: Optional[float] = None,
socket_connect_timeout: Optional[float] = None,
```

기본값이 `None`이다. Lettuce의 "설정 안 하면 60초"처럼 유한한 기본값도 아니다.

### 왜 "톰캣 스레드 포화"를 그대로 못 쓰는가

원본 문서의 핵심 장면은 "스레드 풀(기본 200개)이 꽉 차서 대기 큐가 쌓인다"였다. 이건 Tomcat처럼 요청 하나당 OS 스레드 하나를 물리적으로 점유하는 동기 모델에서만 성립한다.

FastAPI + uvicorn(우리는 `--workers` 옵션 없이 단일 워커로 띄운다, `servers/platform-api/Dockerfile` 21번째 줄)은 `await redis.get(...)`이 걸려도 스레드를 붙잡지 않고 이벤트 루프에 등록만 해둔 채 비켜준다. 그래서 "스레드 200개가 순식간에 꽉 찬다"는 급격한 벽 대신, **응답 없는 요청이 계속 쌓이면서 커넥션/메모리가 서서히 누적되는 완만한 악화**로 나타난다. Node Exporter에서 급격한 스파이크가 안 보였던 것도 이 때문으로 보인다.

---

## 🛠️ 해결

### 응급 조치라면 (실제 장애 시)

| 순서 | 무엇을 | 대가 |
| --- | --- | --- |
| 1 | platform-api 컨테이너를 재시작해서 pending 요청을 강제로 끊는다 | 이미 로그인된 사용자 전원 로그아웃 위험. Redis의 세션 데이터 자체는 남아있어서 재로그인은 필요 없을 수도 있음(미실측) |
| 2 | correlation-engine처럼 서킷이 스스로 안 닫히는 서비스는 재시작으로 강제 초기화 | 이번 드릴에서 실제로 이 방법으로 복구했다 — 재시작 전 스킵된 이벤트는 유실 |
| ❌ 검토는 하되 하지 않을 것 | uvicorn `--workers` 수를 늘린다 | 워커를 늘려도 각 워커가 여전히 타임아웃 없는 Redis 호출에 걸리는 건 똑같다. pending이 워커 수만큼 나눠질 뿐, 근본 문제는 그대로 남는다 |

### 근본 조치

| # | 무엇을 바꾸는가 | 무엇을 막는가 |
| --- | --- | --- |
| 1 | `auth.py` 28번째 줄에 `socket_connect_timeout=3.0, socket_timeout=3.0` 추가 (normalizer와 동일한 값) | 이번 드릴에서 실측한 "무한 대기"를 없앤다. 제일 싸고 제일 급함 |
| 2 | platform-api에도 `RedisCircuitBreaker`를 붙인다 | 반복 타임아웃 상황에서 Redis를 안 건드리고 바로 401/503 응답 |
| 3 | 서킷브레이커가 Redis 완전 무응답 상태에서도 스스로 복구할 방법 마련 | 이번 드릴에서 확인된 "half-open도 항상 실패하면 영원히 OPEN" 문제 — 예: 관리자용 강제 리셋 엔드포인트, half-open 최대 재시도 횟수 상한 |
| 4 | Redis 전용 exporter를 Prometheus 스크래핑 대상에 추가 | "살아있지만 느리다"를 지표로 볼 수 있게 됨(현재는 전혀 안 보임) |
| 5 | platform-api에 `prometheus_client` 기반 `/metrics` 추가 | API 응답시간이라는 개념 자체가 처음 생김 |
| 6 | `alertmanager` job 활성화 + 알람 규칙 작성 | 지표가 있어도 사람이 안 보면 소용없다 |

---

## 🛡️ 재발 방지

### 알람 (지금은 하나도 없다)

```
# 지금 당장 걸 수 있는 유일한 것 — normalizer-workers/correlation-engine 컨슈머 랙
kafka_consumergroup_lag{consumergroup=~"normalizer-workers|correlation-engine"} > 1000

# 아래는 exporter/metrics를 먼저 붙여야 걸 수 있는 것들
rate(redis_commands_duration_seconds_sum[1m]) / rate(redis_commands_duration_seconds_count[1m]) > 0.05
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="platform-api"}[1m])) > 1
```

### 설계 변경

| 무엇을 | 어떻게 |
| --- | --- |
| Redis를 쓰는 모든 곳에 타임아웃 명시 | normalizer는 이미 됨. correlation-engine은 소켓 레벨(3.0s)+서킷브레이커(0.5s) 이중으로 됨. **platform-api만 빠짐 — 최우선** |
| 서킷브레이커의 half-open 복구 로직 보강 | 완전 무응답 상황에서 영원히 OPEN에 갇히지 않도록 |
| "살아있지만 느리다"를 구분하는 지표 확보 | Redis exporter, platform-api `/metrics` 둘 다 지금 없음 |
| cAdvisor에 사람이 읽을 수 있는 컨테이너 라벨 노출 | 지금은 cgroup ID로만 구분 가능해서 장애 대응 중 특정이 어려움 |
| Redis 자체 이중화 | 지금은 단일 컨테이너. 세 서비스가 동시에 영향받는 단일 장애점(SPOF) |

### 체크리스트

- [x] platform-api의 Redis 클라이언트에 `socket_timeout`/`socket_connect_timeout`이 걸려 있는가 — **완료(3.0초로 추가)**
- [x] platform-api에도 서킷브레이커가 붙어 있는가 — **완료(correlation-engine의 것을 shared 패키지로 옮겨 재사용, `/verify`·`/session`은 fail closed, `/login`은 503으로 응답)**
- [ ] 서킷브레이커가 "완전 무응답" 상황에서도 결국 복구되는가(강제 재시작 없이) — 코드를 다시 읽다가 진짜 버그를 하나 찾았다: 실패를 잡는 `except` 절이 파이썬 내장 `ConnectionError`를 잡고 있었는데, redis-py가 실제로 던지는 `redis.exceptions.ConnectionError`는 그 서브클래스가 아니라서(`issubclass` 확인함) 하나도 안 걸리고 있었다. 이 경우 HALF_OPEN 상태가 CLOSED/OPEN 어느 쪽으로도 못 넘어가고 멈출 수 있어서 원인으로 유력해 보인다. 예외 타입을 고쳤고 단위 테스트로는 정상 동작을 확인했지만, 실제 서버에서 드릴을 다시 돌려 자동 복구까지 확인하지는 못했다 — 다음 재현 때 검증할 것
- [ ] Redis 전용 Prometheus exporter가 있는가
- [ ] platform-api에 `/metrics`(요청 지연 히스토그램)가 있는가
- [ ] alertmanager가 켜져 있고 규칙이 있는가
- [x] "살아있지만 느린"/"완전 무응답" Redis를 재현해서 각 서비스 반응을 실측했는가 — **이번 드릴로 완료**
- [x] toxiproxy로 지연·무응답 주입 훈련을 실제로 해봤는가 — **완료**
- [ ] cAdvisor 컨테이너 라벨 문제 해결

---

## 후기 — 체크리스트 1, 2번은 실제로 고쳤다

이 글을 처음 쓸 때만 해도 근본조치 표의 1번(`auth.py` 타임아웃)과 2번(서킷브레이커 이식)은 "적어만 두고 아직 안 한 일"이었다. 다시 코드를 열어본 김에 실제로 손을 댔다.

1번은 예상대로였다. `auth.py`의 `redis.from_url()`에 normalizer/correlation-engine과 똑같이 `socket_connect_timeout=3.0, socket_timeout=3.0`만 추가하면 끝이었다.

2번을 하다가 예상 못 한 걸 하나 발견했다. correlation-engine에 있던 `RedisCircuitBreaker`를 platform-api에도 그대로 갖다 쓰려고 코드를 다시 읽는데, 실패를 잡는 부분이 이렇게 되어 있었다.

```python
except (asyncio.TimeoutError, ConnectionError, OSError):
    self._record(failed=True)
    raise
```

여기 `ConnectionError`는 그냥 파이썬 내장 예외다. 그런데 redis-py가 실제로 던지는 건 `redis.exceptions.ConnectionError`다. 이름이 같아서 당연히 서브클래스겠거니 했는데, 확인해보니 아니었다.

```python
>>> import redis.exceptions as e
>>> issubclass(e.ConnectionError, ConnectionError)
False
```

즉 Redis 연결이 리셋되거나 끊기는 식의 실패는 이 `except`에 하나도 안 걸리고 그대로 새 나가고 있었다. 이게 그냥 "로그 하나 놓친다" 수준이 아닌 게, `_should_attempt()`는 OPEN 상태가 일정 시간(`reset_timeout_seconds`) 지나면 먼저 HALF_OPEN으로 상태를 바꿔놓고, 그 다음 실제 호출 결과를 보고 CLOSED든 OPEN이든 다시 정하는 구조다. 그 "결과를 보고 정하는" 부분이 `_record()`인데, 이 except가 못 잡는 타입으로 실패하면 `_record()` 자체가 안 불린다. 상태는 HALF_OPEN에 그대로 멈추고, `_should_attempt()`는 `state == "OPEN"`일 때만 게이트를 거니까 HALF_OPEN에서는 사실상 아무 보호 없이 매번 그냥 통과된다.

이번 드릴에서 toxic을 지운 뒤에도 correlation-engine이 스스로 안 돌아오고 강제 재시작이 필요했던 것도 이 버그 하나로 설명이 될 것 같다 — 다만 이건 "유력한 설명"이지 재드릴로 확인한 사실은 아니라서 체크리스트에는 아직 미해결로 남겨뒀다.

고친 건 간단하다. `redis.exceptions`에서 진짜 예외 타입을 직접 import해서 잡는다.

```python
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

except (asyncio.TimeoutError, RedisConnectionError, RedisTimeoutError, OSError):
```

그리고 이 서킷브레이커를 correlation-engine 전용 파일에서 두 서비스가 같이 쓰는 공유 패키지(`servers/shared/`)로 옮겼다. 어차피 똑같은 코드를 쓸 거면, 각자 복붙해서 관리하다가 한쪽만 고치고 한쪽은 안 고치는 사고가 이번에 실제로 났으니까.

platform-api에 서킷브레이커를 붙이면서 "서킷이 열려 있으면 로그인/세션 검증을 어떻게 처리할지"도 정해야 했다. `/verify`(모든 API 요청 앞단의 인증 게이트)와 `/session`은 세션이 없는 것과 똑같이 취급해서 401을 준다 — Redis가 죽었다고 아무나 통과시키는 것보다는, 아무도 못 들어오는 쪽이 안전하다고 판단했다. `/login`은 비밀번호는 맞았는데 세션을 저장할 곳이 없는 상황이니, 조용히 넘어가지 않고 503으로 바로 알린다.

---

## 🧩 남기는 원칙

**첫 가설이 맞을 거라고 가정하지 마라.** "가벼운 지연만 걸어도 무한 대기가 재현될 것"이라는 첫 예상은 틀렸다. 유한한 지연은 결국 응답이 오기 때문에, 진짜 위험(무한 대기)을 보려면 더 독한 조건이 필요했다.

**이상한 결과가 나오면, 먼저 "내가 뭘 걸어놨는지"부터 다시 확인해라.** 서킷이 안 닫히는 걸 보고 코드 버그부터 의심했는데, 진짜 원인은 toxic 종류가 바뀌어 있었다는 훨씬 단순한 사실이었다. 복잡한 가설로 건너뛰기 전에 현재 상태부터 다시 찍어봤어야 했다.

**헬스체크는 "살아있는가"만 묻는다. "얼마나 걸리는가"는 별도로 재야 한다.** `redis-cli ping`이 성공한다고 안전한 게 아니다.

**타임아웃이 없는 게 아니라, 타임아웃이 `None`인 기본값이 위험하다.** platform-api는 아무것도 정하지 않아서 프레임워크의 `None` 기본값을 그대로 물려받았고, 이번 드릴에서 실제로 15초 넘게 응답 없이 매달리는 걸 확인했다.

**서킷브레이커를 달았다고 끝이 아니다.** correlation-engine의 서킷은 설계대로 OPEN됐지만, Redis가 진짜로 응답을 안 주는 동안은 half-open 시도도 매번 실패해서 스스로 못 돌아왔다. 결국 컨테이너 재시작으로 강제 복구했다 — 직접 재현해보지 않았으면 몰랐을 사실이다.

**async라고 원본 장애의 교훈이 무효화되는 건 아니다. 증상의 모양만 바뀐다.** Tomcat은 급격하게 무너지고, uvicorn은 완만하게 무너진다. 완만한 쪽이 알람이 없는 환경에서는 오히려 더 늦게 발견된다.

---

## 🔗 관련 문서

| 문서 | 관계 |
| --- | --- |
| [SENTINEL-OPS 아키텍처 시리즈 ④] Kafka 브로커 | normalizer-workers 컨슈머 그룹 랙 개념이 여기서 나온다 |
| [SENTINEL-OPS 아키텍처 시리즈 ⑤] 저장 계층 | ClickHouse/OpenSearch/PostgreSQL — 이번 장애 시나리오에서 platform-api 뒤에 있는 조회 대상들 |
| (작성 예정) Kafka 오프셋 버그 트러블슈팅 글 | 컨슈머 랙과 관련된 별도의 실제 발생 이슈 — 이번 글의 랙 지표 판독과 비교하면 좋음 |

---

## 부록 — 실제 실행한 명령어와 결과값

재현하고 싶은 사람을 위해, 이 드릴에서 순서대로 친 명령어와 실제로 나온 결과값을 정리한다.

### 0. toxiproxy 준비

```bash
$ docker run -d --name redis-toxiproxy --network siem-net -p 127.0.0.1:8474:8474 ghcr.io/shopify/toxiproxy
a1b2c3d4e5f6...                                    # 컨테이너 정상 생성

$ docker exec redis-toxiproxy /toxiproxy-cli create -l 0.0.0.0:16379 -u redis:6379 redis
Created new proxy redis

$ docker exec redis-toxiproxy /toxiproxy-cli list
redis     [::]:16379      redis:6379      enabled 0
```

### 1. REDIS_URL을 toxiproxy 경유로 변경

```yaml
# ~/toxiproxy-drill-override.yml (git엔 안 올림)
services:
  normalizer:
    environment:
      REDIS_URL: redis://:CHANGE_ME_dev@redis-toxiproxy:16379/0
  correlation-engine:
    environment:
      REDIS_URL: redis://:CHANGE_ME_dev@redis-toxiproxy:16379/0
  platform-api:
    environment:
      REDIS_URL: redis://:CHANGE_ME_dev@redis-toxiproxy:16379/0
```

```bash
$ docker compose -f docker-compose.yml -f ~/toxiproxy-drill-override.yml up -d --no-deps normalizer correlation-engine platform-api
✔ Container normalizer          Started
✔ Container correlation-engine  Started
✔ Container platform-api        Started

$ docker inspect normalizer --format '{{.Config.Env}}' | tr ',' '\n' | grep REDIS_URL
REDIS_URL=redis://:CHANGE_ME_dev@redis-toxiproxy:16379/0            # 배선 확인
```

### 2. 배선 정상 동작 확인 (toxic 걸기 전)

```bash
$ curl -sk https://35-216-79-173.sslip.io/api/health
{"status":"ok"}

$ curl -sk -X POST https://.../api/auth/login -d '{"username":"...","password":"..."}'
{"token":"..."}                                    # 로그인 성공, Redis 세션 쓰기까지 정상
```

### 3. 1차 시도 — 300ms 지연

```bash
$ docker exec redis-toxiproxy /toxiproxy-cli toxic add -t latency -a latency=300 -a jitter=50 redis
Added downstream latency toxic 'latency_downstream' on proxy 'redis'

$ k6 run servers/loadtest/platform-api.js     # 20 VU, 3분
     p(95)............: 1.09s   (threshold p(95)<800ms 초과)
     http_req_failed..: 0.00%
```

### 4. 2차 시도 — 완전 무응답

```bash
$ docker exec redis-toxiproxy /toxiproxy-cli toxic remove -n latency_downstream redis
# 제거됨

$ docker exec redis-toxiproxy /toxiproxy-cli toxic add -t timeout -a timeout=0 redis
Added downstream timeout toxic 'timeout_downstream' on proxy 'redis'

$ k6 run servers/loadtest/otlp-ingest.js       # 이벤트 생성용 - Kafka -> normalizer -> correlation-engine으로 흘러들어감

$ docker logs correlation-engine --since 5m | grep -i "circuit\|서킷"
[correlation] ERROR: ... 이벤트는 건너뜀 (연속 드롭 67건째): Redis 서킷 open 상태 (state=OPEN)
[correlation] ERROR: ... 이벤트는 건너뜀 (연속 드롭 68건째): Redis 서킷 open 상태 (state=OPEN)
[correlation] ERROR: ... 이벤트는 건너뜀 (연속 드롭 69건째): Redis 서킷 open 상태 (state=OPEN)
...(반복)

$ docker exec redis-toxiproxy /toxiproxy-cli inspect redis
Name: redis    Listen: [::]:16379    Upstream: redis:6379
======================================================================
Type       Stream       Enabled   Toxicity   Name                  Attributes
timeout    downstream   true      1.00       timeout_downstream    [timeout=0]

$ time curl -sk --max-time 15 -X POST https://.../api/auth/login -d '{...}'
(15초간 아무 응답 없음)

real    0m15.027s
```

### 5. 호스트/파이프라인 배제 확인 (Grafana)

- Node Exporter Full(CPU/Sys Load): CPU Busy 64~65%, Sys Load 90%→131.5% — 드릴 구간에만 튀는 스파이크는 아니었다
- Kafka Exporter "Message consume per minute": correlation-engine 소비량 200~250/분 → 0(약 8분) → 재시작 후 회복
- Blackbox "Global Probe Duration": `platform-api:8400/health`가 ~290ms로 순간 스파이크

### 6. 복구

```bash
$ docker exec redis-toxiproxy /toxiproxy-cli toxic remove -n timeout_downstream redis
# 제거됨

$ docker restart correlation-engine
correlation-engine

$ docker logs -f correlation-engine
...
Application startup complete.
[correlation] 인시던트 발화 - ...                   # 정상 처리 재개
```

### 7. 원복 (REDIS_URL을 진짜 redis로)

```bash
$ docker compose -f docker-compose.yml up -d --no-deps normalizer correlation-engine platform-api
✔ Container normalizer          Started
✔ Container correlation-engine  Started
✔ Container platform-api        Started

$ docker inspect platform-api --format '{{.Config.Env}}' | tr ',' '\n' | grep REDIS_URL
REDIS_URL=redis://:CHANGE_ME_dev@redis:6379/0                       # 원복 확인
```

### 부록 — 중간에 만난 방화벽 이슈

`otlp-ingest.js`가 `Post "http://<IP>:4318/v1/logs": dial: i/o timeout`으로 전부 실패한 적이 있었다. `curl localhost:4318`은 VM 안에서는 정상(200)이라 방화벽 문제로 좁혔고, `gcloud compute firewall-rules list`로 확인해보니 4318 포트가 아예 안 열려있었다(80/443/3000/8900은 있는데 4318만 빠짐). 아래로 해결:

```bash
gcloud compute firewall-rules create sism-otel-external \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:4318 --source-ranges=0.0.0.0/0 --target-tags=sism-monitoring
```

---

## 1차 출처

- `servers/normalizer/app/dedupe.py`, `servers/normalizer/app/config.py` (25~41번째 줄) — Redis 소켓 타임아웃 3.0초/3.0초, 2026-07-21 수정 코멘트
- `servers/correlation-engine/app/redis_circuit_breaker.py` — `RedisCircuitBreaker` 클래스, 기본값 `call_timeout_seconds=0.5`, `failure_rate_threshold=0.5`, `minimum_number_of_calls=10`, `window_seconds=60.0`, `reset_timeout_seconds=30.0` — 이번 드릴에서 실제 OPEN 전환 로그로 검증
- `servers/correlation-engine/app/main.py` (190번째 줄 부근) — `redis.from_url(..., socket_connect_timeout=3.0, socket_timeout=3.0)` + `RedisCircuitBreaker` 이중 적용
- `servers/platform-api/app/auth.py` (28번째 줄) — 타임아웃 미설정 `redis.from_url(settings.redis_url, decode_responses=True)` — 15.027초 무응답 실측으로 검증
- `servers/platform-api/Dockerfile` (21번째 줄) — `uvicorn app.main:app --host 0.0.0.0 --port 8400` (`--workers` 옵션 없음, 단일 워커)
- `servers/datastore/redis/docker-compose.yml` — `redis:7-alpine` 단일 컨테이너, AOF/RDB 비영속 설계 코멘트
- `servers/monitoring/prometheus/prometheus.yml` — 스크래핑 대상 목록, alertmanager job 주석 처리 확인, cadvisor 타겟 `health:"up"` 확인(`curl http://10.178.0.2:9090/api/v1/targets`)
- `servers/platform-api/requirements.txt` — `prometheus_client` 미포함 확인
- `servers/loadtest/platform-api.js` — k6 threshold `p(95)<800ms`, 실측 결과 p95=1.09s / 실패율 0%
- `redis-py 5.2.1` · `redis/asyncio/connection.py` · `AbstractConnection.__init__` — `socket_timeout: Optional[float] = None`, `socket_connect_timeout: Optional[float] = None` (pip로 직접 설치해 시그니처 확인)
- [Shopify/toxiproxy](https://github.com/Shopify/toxiproxy) — `ghcr.io/shopify/toxiproxy` Docker 이미지, `latency`/`timeout` toxic으로 이번 드릴 전체를 재현
