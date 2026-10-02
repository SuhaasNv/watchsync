import re
from typing import Any

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


def presence(ws: Any, title_id: str | None) -> None:
    media = (
        {
            "service": "netflix",
            "titleId": title_id,
            "titleName": f"Dark {title_id}",
            "titleUrl": f"https://www.netflix.com/watch/{title_id}",
        }
        if title_id
        else None
    )
    ws.send_json(
        {
            "id": "p",
            "type": "PRESENCE.UPDATE",
            "timestamp": 1,
            "payload": {"service": "netflix", "following": True, "media": media},
        }
    )


def next_of(ws: Any, type_: str) -> dict[str, Any]:
    while True:
        m: dict[str, Any] = ws.receive_json()
        if m["type"] == type_:
            return m


def test_room_moves_only_with_someone_who_was_on_its_title() -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    with (
        client.websocket_connect(url + host["token"]) as hws,
        client.websocket_connect(url + guest["token"]) as gws,
    ):
        hws.receive_json()
        gws.receive_json()
        # TestClient runs a socket's handler only while the test reads that socket,
        # so each sender's own echo is read before checking the other side.
        presence(hws, "1")  # first title sets the room
        next_of(hws, "ROOM.MEDIA")
        assert next_of(gws, "ROOM.MEDIA")["payload"]["media"]["titleId"] == "1"
        assert main.rooms.rooms[host["code"]].playback is None  # opener may be resuming
        presence(gws, "9")  # guest opens something else: the room stays
        next_of(gws, "ROOM.PARTICIPANT")
        presence(gws, "1")  # guest joins the room's title
        next_of(gws, "ROOM.PARTICIPANT")
        assert main.rooms.rooms[host["code"]].media["titleId"] == "1"  # type: ignore[index]
        presence(hws, "2")  # host was on the room's title and moves on: next episode
        next_of(hws, "ROOM.MEDIA")
        moved = next_of(gws, "ROOM.MEDIA")
        assert moved["payload"]["media"]["titleId"] == "2"
        assert moved["payload"]["byName"] == "Suhaas"
        snapshot = main.rooms.rooms[host["code"]].snapshot("x")
        assert snapshot["media"]["titleId"] == "2"
        # The new episode gets a fresh clock from 0:00 for followers to catch up to.
        assert snapshot["playback"]["titleId"] == "2"
        assert snapshot["playback"]["position"] == 0


def test_playback_update_is_stamped_kept_and_sent_to_others_only() -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    with (
        client.websocket_connect(url + host["token"]) as hws,
        client.websocket_connect(url + guest["token"]) as gws,
    ):
        hws.receive_json()
        gws.receive_json()
        next_of(hws, "ROOM.PARTICIPANT")  # the guest's arrival
        before = main.now_ms()
        hws.send_json(
            {
                "id": "u",
                "type": "PLAYBACK.UPDATE",
                "timestamp": 1,
                "payload": {
                    "action": "pause",
                    "status": "paused",
                    "position": 61.5,
                    "rate": 1,
                    "titleId": "1",
                },
            }
        )
        hws.send_json({"id": "p", "type": "SYS.PING", "timestamp": 1, "payload": {"t1": 1}})
        # The sender's next message is its pong: no PLAYBACK.STATE echo.
        assert hws.receive_json()["type"] == "SYS.PONG"
        got = next_of(gws, "PLAYBACK.STATE")["payload"]
        assert got["action"] == "pause" and got["byName"] == "Suhaas"
        assert got["playback"]["status"] == "paused"
        assert got["playback"]["position"] == 61.5
        assert got["playback"]["updatedAt"] >= before
        assert main.rooms.rooms[host["code"]].playback == got["playback"]


def test_leave_revokes_the_token_and_tells_the_room() -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    with client.websocket_connect(url + host["token"]) as hws:
        hws.receive_json()
        with client.websocket_connect(url + guest["token"]) as gws:
            gws.receive_json()
            next_of(hws, "ROOM.PARTICIPANT")  # joined
            gws.send_json({"id": "l", "type": "ROOM.LEAVE", "timestamp": 1, "payload": {}})
            left = next_of(hws, "ROOM.PARTICIPANT")["payload"]
            assert left["event"] == "left" and left["participant"]["name"] == "Asha"
        with (
            pytest.raises(WebSocketDisconnect),
            client.websocket_connect(url + guest["token"]) as ws,
        ):
            ws.receive_json()
        assert [p.name for p in main.rooms.rooms[host["code"]].participants.values()] == ["Suhaas"]


def test_last_one_out_ends_the_room() -> None:
    host = create()
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        ws.send_json({"id": "l", "type": "ROOM.LEAVE", "timestamp": 1, "payload": {}})
    assert join(host["code"]).status_code == 410


def test_a_newer_connection_replaces_the_old_one_with_code_4000() -> None:
    host = create()
    url = f"/ws/rooms/{host['code']}?token={host['token']}"
    with client.websocket_connect(url) as old:
        old.receive_json()
        with client.websocket_connect(url) as new:
            new.receive_json()
            with pytest.raises(WebSocketDisconnect) as closed:
                old.receive_json()
            assert closed.value.code == 4000


def test_message_flood_is_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "message_limiter", main.Limiter(2, 10))
    host = create()
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        for i in range(3):
            ws.send_json({"id": str(i), "type": "SYS.PING", "timestamp": 1, "payload": {"t1": i}})
        assert ws.receive_json()["type"] == "SYS.PONG"
        assert ws.receive_json()["type"] == "SYS.PONG"
        err = ws.receive_json()
        assert err["type"] == "SYS.ERROR" and err["payload"]["code"] == "rate_limited"


def test_expired_room_refuses_reconnect() -> None:
    host = create()
    main.rooms.sweep(now=main.now_ms() + (main.config.ROOM_IDLE_EXPIRY_SECONDS + 1) * 1000)
    url = f"/ws/rooms/{host['code']}?token={host['token']}"
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect(url) as ws:
        ws.receive_json()
    assert closed.value.code == 1008


def test_bad_bodies_get_clear_errors_not_500() -> None:
    headers = {"content-type": "application/json"}
    assert client.post("/api/v1/rooms", content=b"{not json", headers=headers).status_code == 422
    big = b'{"name": "' + b"x" * 5000 + b'"}'
    assert client.post("/api/v1/rooms", content=big, headers=headers).status_code == 413
    assert (
        client.post("/api/v1/rooms/ABC234/join", content=b"[]", headers=headers).status_code == 422
    )


def test_rate_limits_use_the_edge_client_ip_when_behind_a_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main.config, "TRUST_PROXY", True)
    monkeypatch.setattr(main, "create_limiter", main.Limiter(1, 60))
    a = {"x-real-ip": "203.0.113.1"}
    b = {"x-real-ip": "203.0.113.2"}
    assert client.post("/api/v1/rooms", json={"name": "a"}, headers=a).status_code == 201
    assert client.post("/api/v1/rooms", json={"name": "a"}, headers=a).status_code == 429
    assert client.post("/api/v1/rooms", json={"name": "b"}, headers=b).status_code == 201


def test_security_headers() -> None:
    r = client.get("/j/ABC234")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_a_first_jump_keeps_the_senders_play_state() -> None:
    host = create()
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        ws.send_json(
            {
                "id": "s",
                "type": "PLAYBACK.UPDATE",
                "timestamp": 1,
                "payload": {
                    "action": "seek",
                    "status": "playing",
                    "position": 10,
                    "rate": 1,
                    "titleId": "1",
                },
            }
        )
        ws.send_json({"id": "p", "type": "SYS.PING", "timestamp": 1, "payload": {"t1": 1}})
        next_of(ws, "SYS.PONG")
    playback = main.rooms.rooms[host["code"]].playback
    assert playback is not None and playback["status"] == "playing"
