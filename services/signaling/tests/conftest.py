import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from app import config, main


@pytest.fixture(autouse=True, scope="module")
def one_loop(request: pytest.FixtureRequest) -> Iterator[None]:
    """Every socket's handler on one event loop. Otherwise each socket gets its own, and a
    message one handler sends to another person's socket crosses loops: its wake-up can be
    lost and the test hangs, more often the longer validation takes. Uses the test module's
    own `client`."""
    client = getattr(request.module, "client", None)
    if not isinstance(client, TestClient):
        yield
        return
    with client:
        yield


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
    monkeypatch.setattr(main, "chat_limiter", main.Limiter(config.CHAT_PER_5S, 5))
    monkeypatch.setattr(main, "room_chat_limiter", main.Limiter(config.CHAT_ROOM_PER_10S, 10))
    monkeypatch.setattr(main, "reaction_limiter", main.Limiter(config.REACTIONS_PER_5S, 5))


@pytest.fixture(autouse=True)
def without_chat_history(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests written before chat read each socket's messages in order: skip the CHAT.HISTORY
    every connect now gets right after ROOM.STATE. A module that tests it sets
    SEES_CHAT_HISTORY = True (test_chat.py)."""
    if getattr(request.module, "SEES_CHAT_HISTORY", False):
        return
    receive = WebSocketTestSession.receive

    def skipping(self: WebSocketTestSession) -> Any:
        while True:
            m = receive(self)
            text = m.get("text")
            if not isinstance(text, str) or json.loads(text)["type"] != "CHAT.HISTORY":
                return m

    monkeypatch.setattr(WebSocketTestSession, "receive", skipping)
