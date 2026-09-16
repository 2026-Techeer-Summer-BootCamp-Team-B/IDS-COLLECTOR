"""이 모듈은 2026-09-16부터 servers/shared/ids_shared/redis_circuit_breaker.py로
옮겨졌다 - platform-api도 같은 서킷브레이커가 필요해지면서, 서비스마다 복붙해두면
한쪽만 고치고 다른 쪽은 안 고치는 드리프트가 생기기 쉬워서(실제로 예외 타입 버그가
이렇게 한쪽에만 남아있었다) 공유 패키지로 합쳤다. 기존 `from app.redis_circuit_breaker
import RedisCircuitBreaker` 코드가 깨지지 않도록 여기서 그대로 재수출만 한다 - 새
코드는 `from ids_shared.redis_circuit_breaker import ...`를 직접 쓸 것."""
from ids_shared.redis_circuit_breaker import CircuitOpenError, RedisCircuitBreaker

__all__ = ["CircuitOpenError", "RedisCircuitBreaker"]
