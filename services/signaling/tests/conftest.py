import pytest

from app import config, main


@pytest.fixture(autouse=True)
def fresh_limiters(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test gets its own rate-limit budget; tests that need tighter limits patch again."""
    # Every test client shares one address and rooms outlive tests: no per-address room cap.
    monkeypatch.setattr(config, "ROOMS_PER_IP", 10_000)
    monkeypatch.setattr(main, "create_limiter", main.Limiter(config.CREATE_PER_MINUTE, 60))
    monkeypatch.setattr(main, "join_limiter", main.Limiter(config.JOIN_PER_MINUTE, 60))
    limit = config.FAILED_JOINS_PER_MINUTE
    monkeypatch.setattr(main, "failed_join_limiter", main.Limiter(limit, 60))
    monkeypatch.setattr(main, "connect_limiter", main.Limiter(10_000, 60))
    monkeypatch.setattr(main, "message_limiter", main.Limiter(config.MESSAGES_PER_10S, 10))
