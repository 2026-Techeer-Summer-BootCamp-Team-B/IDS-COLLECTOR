"""리포트 알림 연동(app/report_notifications_api.py)의 access_token 암복호화.

Fernet(대칭키, AES128-CBC + HMAC)을 쓴다 - report_notification_connections.
access_token_encrypted에 평문이 그대로 들어가는 일이 없게 저장 직전/조회 직후
반드시 이 모듈을 거친다. 지금은 목업 문자열("mock-slack-token-xxxx" 등)이 들어가지만
암복호화 경로 자체는 실제 OAuth 토큰이 들어와도 그대로 동작한다."""
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

_fernet = Fernet(settings.report_token_encryption_key.encode())


def encrypt_token(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    try:
        return _fernet.decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise ValueError("access_token 복호화 실패 - REPORT_TOKEN_ENCRYPTION_KEY가 바뀌었거나 손상된 값") from e
