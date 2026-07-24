from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings


async def test_env_example_requires_a_deployment_specific_encryption_key():
    env_example = Path(__file__).parents[2] / ".env.example"
    values = {}
    for raw_line in env_example.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value

    assert values["REPORT_TOKEN_ENCRYPTION_KEY"] == ""

    with pytest.raises(ValidationError, match="REPORT_TOKEN_ENCRYPTION_KEY is required"):
        Settings(report_token_encryption_key="")
