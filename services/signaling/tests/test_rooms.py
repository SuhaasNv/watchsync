import re

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.protocol import is_server_message

client = TestClient(main.app)


def create(name: str = "Suhaas") -> dict[str, str]:
    r = client.post("/api/v1/rooms", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def test_create_returns_code_and_token() -> None:
    t = create()
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{6}", t["code"])
    assert len(t["token"]) >= 32


def test_create_rejects_bad_names() -> None:
    assert client.post("/api/v1/rooms", json={"name": ""}).status_code == 422
    assert client.post("/api/v1/rooms", json={"name": "x" * 31}).status_code == 422
    assert client.post("/api/v1/rooms", json={"name": "a", "extra": 1}).status_code == 422


def test_create_is_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "create_limiter", main.Limiter(2, 60))
    assert client.post("/api/v1/rooms", json={"name": "a"}).status_code == 201
    assert client.post("/api/v1/rooms", json={"name": "a"}).status_code == 201
    assert client.post("/api/v1/rooms", json={"name": "a"}).status_code == 429


def test_socket_sends_room_state_and_pong() -> None:
    t = create()
    with client.websocket_connect(f"/ws/rooms/{t['code']}?token={t['token']}") as ws:
        state = ws.receive_json()
        assert is_server_message(state)
        assert state["type"] == "ROOM.STATE"
        assert state["payload"]["you"] == t["participantId"]
        assert state["payload"]["participants"][0]["connected"] is True
        ws.send_json({"id": "1", "type": "SYS.PING", "timestamp": 1, "payload": {"t1": 123}})
        pong = ws.receive_json()
        assert pong["type"] == "SYS.PONG" and pong["payload"]["t1"] == 123


def test_socket_rejects_wrong_room_or_token() -> None:
    t = create()
    other = create("Alex")
    for url in (
        f"/ws/rooms/{t['code']}?token=nope",
        f"/ws/rooms/{other['code']}?token={t['token']}",
    ):
        with pytest.raises(WebSocketDisconnect), client.websocket_connect(url) as ws:
            ws.receive_json()


def test_invalid_message_gets_error_not_disconnect() -> None:
    t = create()
    with client.websocket_connect(f"/ws/rooms/{t['code']}?token={t['token']}") as ws:
        ws.receive_json()
        ws.send_json({"type": "HACK", "payload": {}})
        err = ws.receive_json()
        assert err["type"] == "SYS.ERROR" and err["payload"]["code"] == "invalid_message"
