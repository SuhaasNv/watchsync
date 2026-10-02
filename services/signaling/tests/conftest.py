import pytest

from app import config, main


@pytest.fixture(autouse=True)
def fresh_limiters(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test gets its own rate-limit budget; tests that need tighter limits patch again."""
    monkeypatch.setattr(main, "create_limiter", main.Limiter(config.CREATE_PER_MINUTE, 60))
    monkeypatch.setattr(main, "join_limiter", main.Limiter(config.JOIN_PER_MINUTE, 60))
    monkeypatch.setattr(main, "message_limiter", main.Limiter(config.MESSAGES_PER_10S, 10))
