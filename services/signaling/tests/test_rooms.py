import re

import httpx
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


def join(code: str, name: str = "Asha") -> httpx.Response:
    return client.post(f"/api/v1/rooms/{code}/join", json={"name": name})


def test_join_returns_a_ticket_and_host_sees_arrival() -> None:
    host = create()
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as hws:
        hws.receive_json()
        r = join(host["code"].lower())
        assert r.status_code == 201
        guest = r.json()
        with client.websocket_connect(f"/ws/rooms/{host['code']}?token={guest['token']}") as gws:
            state = gws.receive_json()
            assert [p["name"] for p in state["payload"]["participants"]] == ["Suhaas", "Asha"]
            arrived = hws.receive_json()
            assert arrived["type"] == "ROOM.PARTICIPANT"
            assert arrived["payload"]["event"] == "joined"
            assert arrived["payload"]["participant"]["name"] == "Asha"


def test_join_errors_are_distinct(monkeypatch: pytest.MonkeyPatch) -> None:
    assert join("ZZZZZZ").status_code == 404
    full = create()
    monkeypatch.setattr(main.config, "MAX_PARTICIPANTS", 1)
    assert join(full["code"]).status_code == 409
    ended = create()
    main.rooms.sweep(now=main.now_ms() + (main.config.ROOM_IDLE_EXPIRY_SECONDS + 1) * 1000)
    assert join(ended["code"]).status_code == 410


def test_join_is_rate_limited_even_for_wrong_codes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "join_limiter", main.Limiter(2, 60))
    assert join("ZZZZZZ").status_code == 404
    assert join("ZZZZZZ").status_code == 404
    assert join("ZZZZZZ").status_code == 429


def test_presence_update_reaches_everyone_and_sets_room_media() -> None:
    host = create()
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        media = {
            "service": "netflix",
            "titleId": "80057281",
            "titleName": "Stranger Things",
            "titleUrl": "https://www.netflix.com/watch/80057281",
        }
        ws.send_json(
            {
                "id": "1",
                "type": "PRESENCE.UPDATE",
                "timestamp": 1,
                "payload": {"service": "netflix", "following": True, "media": media},
            }
        )
        update = ws.receive_json()
        assert update["payload"]["participant"]["titleName"] == "Stranger Things"
        room_media = ws.receive_json()
        assert room_media["type"] == "ROOM.MEDIA" and room_media["payload"]["media"] == media


def test_invite_page_shows_the_code_without_scripts() -> None:
    r = client.get("/j/abc234")
    assert r.status_code == 200
    assert "ABC234" in r.text and "<script" not in r.text
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert client.get("/j/<b>hi").status_code == 404
