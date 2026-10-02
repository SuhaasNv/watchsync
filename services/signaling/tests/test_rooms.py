import json
import re
import time
from collections.abc import Iterator
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


def rejoin(code: str, name: str, token: str | None) -> httpx.Response:
    body = {"name": name} | ({"token": token} if token else {})
    return client.post(f"/api/v1/rooms/{code}/join", json=body)


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


def test_wrong_codes_from_everyone_together_are_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    """BUG-042: guessing codes from many addresses, each under its own limit, stays slow."""
    monkeypatch.setattr(main.config, "TRUST_PROXY", True)
    monkeypatch.setattr(main, "failed_join_limiter", main.Limiter(3, 60))
    room = create()

    def attempt(code: str, ip: str) -> int:
        r = client.post(f"/api/v1/rooms/{code}/join", json={"name": "a"}, headers={"x-real-ip": ip})
        return r.status_code

    assert attempt(room["code"], "192.0.2.1") == 201  # right codes never count
    for i in range(3):
        assert attempt("ZZZZZZ", f"192.0.2.{10 + i}") == 404
    # Past the shared budget every join waits, right code or not: a 201 would tell a
    # guesser which code is real.
    assert attempt("ZZZZZZ", "192.0.2.50") == 429
    assert attempt(room["code"], "192.0.2.51") == 429


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


def test_title_links_off_a_title_page_never_reach_the_room() -> None:
    """BUG-039: friends' browsers open the room's titleUrl, so only a title page counts."""
    host = create()
    bad = [
        ("netflix", "https://www.netflix.com/YourAccount"),
        ("netflix", "https://www.netflix.com/watch/1/../../signout"),
        ("netflix", "https://user@www.netflix.com/watch/1"),
        ("netflix", "https://www.netflix.com/watch/1?x=1"),
        ("netflix", "https://www.primevideo.com/detail/B0X"),  # another service's page
        ("prime", "https://www.amazon.in/gp/video/settings"),
        ("prime", "https://www.amazon.in/gp/video/detail/.."),
        ("prime", "https://www.amazon.fr/gp/video/detail/B0X"),
        ("jiohotstar", "https://www.jiohotstar.com/in/subscribe"),
        ("jiohotstar", "https://www.jiohotstar.com/in/%2e%2e/1260123456/watch"),
        ("mock", "http://localhost:4173/settings"),
    ]
    good = [
        ("netflix", "https://www.netflix.com/watch/80057281"),
        ("prime", "https://www.primevideo.com/detail/0TQV0X9RJF64O24RIRD1BHH37H"),
        ("prime", "https://www.amazon.in/gp/video/detail/B0ABC12345"),
        ("jiohotstar", "https://www.jiohotstar.com/in/shows/panchayat/1260123456/watch"),
        ("mock", "http://localhost:4173/watch/demo"),
    ]
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        for i, (service, title_url) in enumerate(bad + good):
            media = {
                "service": service,
                "titleId": f"t{i}",
                "titleName": "X",
                "titleUrl": title_url,
            }
            payload = {"service": service, "following": True, "media": media}
            ws.send_json(msg("PRESENCE.UPDATE", payload))
            moved = next_of(ws, "ROOM.MEDIA")["payload"]["media"]
            expected = title_url if (service, title_url) in good else None
            assert moved["titleUrl"] == expected, title_url
            assert moved["titleId"] == f"t{i}"  # the title still counts; only the link goes
            assert main.rooms.rooms[host["code"]].media == moved


def test_a_title_name_that_arrives_late_reaches_the_room() -> None:
    """BUG-025: Netflix shows its title text only with the controls, so the first report
    can come without a name. A later report of the same title fills it in."""
    host = create()
    media = {
        "service": "netflix",
        "titleId": "80057281",
        "titleName": None,
        "titleUrl": "https://www.netflix.com/watch/80057281",
    }

    def report(ws: Any, name: str | None) -> None:
        ws.send_json(
            {
                "id": "n",
                "type": "PRESENCE.UPDATE",
                "timestamp": 1,
                "payload": {
                    "service": "netflix",
                    "following": True,
                    "media": {**media, "titleName": name},
                },
            }
        )

    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        report(ws, None)
        ws.receive_json()  # participant update
        assert ws.receive_json()["payload"]["media"]["titleName"] is None  # ROOM.MEDIA
        report(ws, "Stranger Things")
        ws.receive_json()  # participant update, no second ROOM.MEDIA: the room didn't move
        friend = join(host["code"]).json()
        with client.websocket_connect(f"/ws/rooms/{host['code']}?token={friend['token']}") as fws:
            state = fws.receive_json()
            assert state["type"] == "ROOM.STATE"
            assert state["payload"]["media"]["titleName"] == "Stranger Things"


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
            "titleName": f"Dark, E{title_id}",
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


def test_one_address_holds_few_rooms_nobody_joined(monkeypatch: pytest.MonkeyPatch) -> None:
    """BUG-040: one client can't fill every room slot with rooms nobody uses."""
    monkeypatch.setattr(main.config, "TRUST_PROXY", True)
    monkeypatch.setattr(main.config, "ROOMS_PER_IP", 2)
    a = {"x-real-ip": "198.51.100.7"}

    def make(headers: dict[str, str]) -> httpx.Response:
        return client.post("/api/v1/rooms", json={"name": "a"}, headers=headers)

    first = make(a).json()
    assert make(a).status_code == 201
    third = make(a)
    assert third.status_code == 429 and third.headers["retry-after"] == "60"
    assert make({"x-real-ip": "198.51.100.8"}).status_code == 201  # someone else
    assert join(first["code"]).status_code == 201  # a friend joined: it's a real room now
    assert make(a).status_code == 201
    # IPv6: one line gets a whole /64, so the /64 is the client.
    six = {"x-real-ip": "2001:db8:aa:bb::1"}
    assert make(six).status_code == 201
    assert make({"x-real-ip": "2001:db8:aa:bb:ffff::2"}).status_code == 201
    assert make({"x-real-ip": "2001:db8:aa:bb:1234::3"}).status_code == 429
    assert make({"x-real-ip": "2001:db8:aa:cc::1"}).status_code == 201


def test_limits_key_ipv6_on_its_64_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    """BUG-040: per-address limits would be no limit for a client with a /64 to rotate in."""
    monkeypatch.setattr(main.config, "TRUST_PROXY", True)
    monkeypatch.setattr(main, "join_limiter", main.Limiter(2, 60))
    for i in range(2):
        r = client.post(
            "/api/v1/rooms/ZZZZZZ/join", json={"name": "a"}, headers={"x-real-ip": f"2001:db8::{i}"}
        )
        assert r.status_code == 404
    r = client.post(
        "/api/v1/rooms/ZZZZZZ/join", json={"name": "a"}, headers={"x-real-ip": "2001:db8::99"}
    )
    assert r.status_code == 429
    r = client.post(
        "/api/v1/rooms/ZZZZZZ/join", json={"name": "a"}, headers={"x-real-ip": "2001:db9::1"}
    )
    assert r.status_code == 404
    # An IPv4 client seen over IPv6 counts as its IPv4 address.
    r = client.post(
        "/api/v1/rooms/ZZZZZZ/join", json={"name": "a"}, headers={"x-real-ip": "::ffff:192.0.2.1"}
    )
    assert r.status_code == 404
    assert "192.0.2.1" in main.join_limiter.hits


def test_a_room_nobody_ever_connected_to_ends_after_two_minutes() -> None:
    """BUG-040: unused codes free their slot soon; rooms people used keep the idle expiry."""
    unused = create()
    used = create()
    with client.websocket_connect(f"/ws/rooms/{used['code']}?token={used['token']}") as ws:
        ws.receive_json()
        ws.send_json(msg("ROOM.LEAVE", {"keepRoom": True}))  # the browser closed
    main.rooms.sweep(now=main.now_ms() + (main.config.UNUSED_ROOM_EXPIRY_SECONDS + 1) * 1000)
    assert join(unused["code"]).status_code == 410
    assert join(used["code"], "Suhaas").status_code == 201  # still waiting for a rejoin
    main.rooms.sweep(now=main.now_ms() + (main.config.ROOM_IDLE_EXPIRY_SECONDS + 1) * 1000)
    assert join(used["code"]).status_code == 410


def test_a_client_sent_real_ip_is_ignored_unless_behind_the_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Only Railway's edge may name the client's address (TRUST_PROXY=1, docs/DEPLOY.md);
    run directly, a spoofed X-Real-IP must not buy a fresh rate-limit budget."""
    monkeypatch.setattr(main.config, "TRUST_PROXY", False)
    monkeypatch.setattr(main, "create_limiter", main.Limiter(1, 60))
    assert client.post("/api/v1/rooms", json={"name": "a"}).status_code == 201
    spoofed = {"x-real-ip": "203.0.113.77"}
    assert client.post("/api/v1/rooms", json={"name": "a"}, headers=spoofed).status_code == 429


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


def msg(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": type_, "type": type_, "timestamp": 1, "payload": payload}


def play(ws: Any, position: float = 10) -> None:
    ws.send_json(
        msg(
            "PLAYBACK.UPDATE",
            {
                "action": "play",
                "status": "playing",
                "position": position,
                "rate": 1,
                "titleId": "1",
            },
        )
    )


def hold(ws: Any, reason: str | None, position: float = 42) -> None:
    ws.send_json(msg("HOLD.UPDATE", {"reason": reason, "position": position, "adLeft": None}))


def two_on_title(host: dict[str, str], guest: dict[str, str]) -> tuple[Any, Any, Any, Any]:
    """Opens both sockets with both people on title "1"; returns the two context managers."""
    url = f"/ws/rooms/{host['code']}?token="
    hcm = client.websocket_connect(url + host["token"])
    hws = hcm.__enter__()
    hws.receive_json()
    gcm = client.websocket_connect(url + guest["token"])
    gws = gcm.__enter__()
    gws.receive_json()
    presence(hws, "1")
    next_of(hws, "ROOM.MEDIA")
    presence(gws, "1")
    next_of(gws, "ROOM.PARTICIPANT")
    return hcm, hws, gcm, gws


def test_room_waits_for_someone_buffering_then_resumes_together() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        play(hws)
        next_of(gws, "PLAYBACK.STATE")
        hold(gws, "buffering", 42)
        next_of(gws, "ROOM.PARTICIPANT")
        paused = next_of(hws, "PLAYBACK.STATE")["payload"]
        assert paused["action"] == "pause" and paused["byName"] == "Asha"
        assert paused["playback"]["position"] == 42
        # Asha hears it too, so her copy of the room's clock says paused.
        assert next_of(gws, "PLAYBACK.STATE")["payload"]["action"] == "pause"
        room = main.rooms.rooms[host["code"]]
        assert room.held and room.participants[guest["participantId"]].hold == "buffering"

        hold(gws, None)
        resumed = next_of(gws, "PLAYBACK.STATE")["payload"]
        assert resumed["action"] == "play" and resumed["playback"]["status"] == "playing"
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["action"] == "play"
        assert not room.held
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def pause(ws: Any, position: float = 30) -> None:
    ws.send_json(
        msg(
            "PLAYBACK.UPDATE",
            {
                "action": "pause",
                "status": "paused",
                "position": position,
                "rate": 1,
                "titleId": "1",
            },
        )
    )


def sync_point(ws: Any, n: int) -> None:
    """Waits until the server has handled everything this socket sent before."""
    ws.send_json(msg("SYS.PING", {"t1": n}))
    while next_of(ws, "SYS.PONG")["payload"]["t1"] != n:
        pass


def test_room_waits_for_two_people_on_ads_and_tells_both() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        play(hws)
        next_of(gws, "PLAYBACK.STATE")
        hold(gws, "ad", 42)
        assert next_of(gws, "PLAYBACK.STATE")["payload"]["action"] == "pause"
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["action"] == "pause"
        hold(hws, "ad", 42)
        sync_point(hws, 1)
        room = main.rooms.rooms[host["code"]]
        assert room.held

        hold(gws, None)  # Asha's ad ends first: the room keeps waiting for Suhaas's
        sync_point(gws, 2)
        assert room.held
        assert room.playback is not None and room.playback["status"] == "paused"

        hold(hws, None)
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["action"] == "play"
        assert next_of(gws, "PLAYBACK.STATE")["payload"]["action"] == "play"
        assert not room.held
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_an_ad_that_pauses_the_player_first_still_holds_the_room() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        play(hws)
        next_of(gws, "PLAYBACK.STATE")
        # A separate ad video: Asha's film pauses, then the ad is seen.
        pause(gws, 30)
        hold(gws, "ad", 30)
        sync_point(gws, 1)
        room = main.rooms.rooms[host["code"]]
        assert room.held
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["action"] == "pause"
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["action"] == "pause"

        hold(gws, None)  # the ad ends: everyone resumes together
        sync_point(gws, 2)
        resumed = next_of(hws, "PLAYBACK.STATE")["payload"]
        assert resumed["action"] == "play" and resumed["playback"]["position"] == 30
        assert not room.held
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_an_ad_long_after_a_pause_or_after_someone_elses_pause_holds_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        play(hws)
        next_of(gws, "PLAYBACK.STATE")
        pause(hws, 30)  # Suhaas paused; Asha then sees an ad (a pause ad, say)
        sync_point(hws, 1)
        next_of(gws, "PLAYBACK.STATE")
        hold(gws, "ad", 30)
        sync_point(gws, 1)
        room = main.rooms.rooms[host["code"]]
        assert not room.held  # it stays Suhaas's pause, not a wait for Asha

        hold(gws, None)
        play(hws)
        sync_point(hws, 2)
        next_of(gws, "PLAYBACK.STATE")
        monkeypatch.setattr(main, "AD_PAUSE_MS", 0)
        pause(gws, 30)  # Asha paused herself; an ad that shows later isn't why
        hold(gws, "ad", 30)
        sync_point(gws, 2)
        assert not room.held
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_play_while_waiting_goes_on_without_them() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        play(hws)
        next_of(gws, "PLAYBACK.STATE")
        hold(gws, "ad", 42)
        next_of(gws, "ROOM.PARTICIPANT")
        next_of(hws, "PLAYBACK.STATE")
        play(hws, 42)  # "Watch without Asha"
        hws.send_json(msg("SYS.PING", {"t1": 1}))
        next_of(hws, "SYS.PONG")
        room = main.rooms.rooms[host["code"]]
        assert not room.held and guest["participantId"] in room.skip_hold
        hold(gws, "ad", 50)  # still on the ad: no new pause for the others
        hws.send_json(msg("SYS.PING", {"t1": 2}))
        assert next_of(hws, "SYS.PONG")["payload"]["t1"] == 2
        assert not room.held
        hold(gws, None)
        # Wait for this update itself, not the earlier "ad" one still queued (BUG-013).
        while next_of(gws, "ROOM.PARTICIPANT")["payload"]["participant"]["hold"] is not None:
            pass
        assert guest["participantId"] not in room.skip_hold
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_someone_leaving_mid_wait_releases_the_room() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        play(hws)
        next_of(gws, "PLAYBACK.STATE")
        hold(gws, "buffering")
        next_of(gws, "ROOM.PARTICIPANT")
        next_of(hws, "PLAYBACK.STATE")
        gws.send_json(msg("ROOM.LEAVE", {}))
        # Let the guest's handler finish (TestClient runs it while we read its socket).
        with pytest.raises(WebSocketDisconnect):
            while True:
                gws.receive_json()
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["action"] == "play"
        assert not main.rooms.rooms[host["code"]].held
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_start_together_waits_for_ready_then_sets_one_start_moment() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        hws.send_json(msg("START.REQUEST", {"position": 0, "titleId": "1"}))
        prep = next_of(gws, "START.STATE")["payload"]
        assert prep["phase"] == "preparing" and sorted(prep["notReady"]) == ["Asha", "Suhaas"]
        next_of(hws, "START.STATE")
        hws.send_json(msg("START.READY", {}))
        assert next_of(hws, "START.STATE")["payload"]["notReady"] == ["Asha"]
        next_of(gws, "START.STATE")
        before = main.now_ms()
        gws.send_json(msg("START.READY", {}))
        go = next_of(gws, "START.STATE")["payload"]
        assert go["phase"] == "go" and go["startAt"] >= before + 2900
        playback = main.rooms.rooms[host["code"]].playback
        assert playback is not None and playback["status"] == "playing"
        assert playback["updatedAt"] == go["startAt"]
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_start_anyway_skips_who_isnt_ready() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        hws.send_json(msg("START.REQUEST", {"position": 0, "titleId": "1"}))
        next_of(hws, "START.STATE")
        hws.send_json(msg("START.FORCE", {}))
        assert next_of(hws, "START.STATE")["payload"]["phase"] == "go"
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_nan_is_refused_and_never_reaches_the_room() -> None:
    host = create()
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
        ws.send_text(
            '{"id":"n","type":"PLAYBACK.UPDATE","timestamp":1,"payload":{"action":"play",'
            '"status":"playing","position":NaN,"rate":1,"titleId":"1"}}'
        )
        err = ws.receive_json()
        assert err["type"] == "SYS.ERROR" and err["payload"]["code"] == "invalid_message"
        ws.send_bytes(b"\x00binary")
        assert ws.receive_json()["payload"]["code"] == "invalid_message"
    assert main.rooms.rooms[host["code"]].playback is None


def test_sending_to_a_peer_that_dropped_never_raises() -> None:
    class Dead:
        async def send_text(self, _: Any) -> None:
            raise WebSocketDisconnect(1006)

    host = create()
    p = main.rooms.rooms[host["code"]].participants[host["participantId"]]
    main.sockets[p.id] = Dead()  # type: ignore[assignment]
    try:
        import asyncio

        asyncio.run(main.send(p, "SYS.PONG", {"t1": 1, "serverTime": 1}))
    finally:
        del main.sockets[p.id]


def test_limiter_forgets_idle_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import ratelimit

    clock = [1000.0]
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: clock[0])
    limiter = ratelimit.Limiter(2, 10)
    limiter.allow("1.2.3.4")
    limiter.allow("5.6.7.8")
    clock[0] += 11
    limiter.allow("5.6.7.8")
    limiter.prune()
    assert list(limiter.hits) == ["5.6.7.8"]
    limiter.forget("5.6.7.8")
    assert not limiter.hits


def test_bodies_must_be_small_json() -> None:
    assert client.post("/api/v1/rooms", content=b'{"name":"a"}').status_code == 415
    plain = {"content-type": "text/plain"}
    assert client.post("/api/v1/rooms", content=b'{"name":"a"}', headers=plain).status_code == 415

    def big() -> Any:
        for _ in range(100):
            yield b"x" * 1024

    headers = {"content-type": "application/json"}
    assert client.post("/api/v1/rooms", content=big(), headers=headers).status_code == 413


def test_names_reject_invisible_and_direction_characters() -> None:
    for bad in ["Asha\u202e", "\u200bAsha", "A\u2066sha", "As\nha", "As\x07ha"]:
        assert client.post("/api/v1/rooms", json={"name": bad}).status_code == 422
    assert client.post("/api/v1/rooms", json={"name": "Asha Rāo 😀"}).status_code == 201


def test_legal_pages_robots_and_html_not_found() -> None:
    for path in ("/privacy", "/terms"):
        r = client.get(path)
        assert r.status_code == 200 and "suhaasnvs@gmail.com" in r.text
        assert "not affiliated" in r.text
    assert client.get("/robots.txt").text == "User-agent: *\nDisallow: /\n"
    bad = client.get("/j/nope")
    assert bad.status_code == 404 and "That link doesn't work" in bad.text
    invite = client.get("/j/ABC234")
    assert 'property="og:title"' in invite.text and 'name="robots"' in invite.text
    assert invite.headers["x-robots-tag"] == "noindex, nofollow"


def test_home_goes_to_the_website_and_unknown_pages_are_ours() -> None:
    # BUG-046: the bare address and unknown pages showed {"detail": "Not Found"}.
    home = client.get("/", follow_redirects=False)
    assert home.status_code == 302 and home.headers["location"] == "https://watchsync.space"
    for path in ("/nope", "/j/", "/j/ABC234/extra"):
        r = client.get(path)
        assert r.status_code == 404 and "That link doesn't work" in r.text, path
        assert r.headers["content-security-policy"] == main.join_page.CSP
    api = client.get("/api/v1/nope")
    assert api.status_code == 404 and api.json() == {"detail": "Not Found"}


def test_room_cap_and_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main.config, "MAX_ROOMS", 0)
    r = client.post("/api/v1/rooms", json={"name": "a"})
    assert r.status_code == 503 and r.headers["retry-after"] == "60"
    monkeypatch.setattr(main, "create_limiter", main.Limiter(0, 60))
    assert client.post("/api/v1/rooms", json={"name": "a"}).headers["retry-after"] == "60"


def test_too_many_socket_connects_are_told_to_try_later(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    monkeypatch.setattr(main, "connect_limiter", main.Limiter(0, 60))
    url = f"/ws/rooms/{host['code']}?token={host['token']}"
    with pytest.raises(WebSocketDisconnect) as closed, client.websocket_connect(url) as ws:
        ws.receive_json()
    assert closed.value.code == 1013


def test_a_title_nobody_has_open_gives_way_in_either_order() -> None:
    # BUG-047: the guest opened a title, closed it, and the host's new title never moved
    # the room, because the host had never been on the room's title.
    for host_first in (False, True):
        host = create()
        guest = join(host["code"]).json()
        url = f"/ws/rooms/{host['code']}?token="
        with (
            client.websocket_connect(url + host["token"]) as hws,
            client.websocket_connect(url + guest["token"]) as gws,
        ):
            hws.receive_json()
            gws.receive_json()
            presence(gws, "1")  # the guest's title becomes the room's
            next_of(gws, "ROOM.MEDIA")
            next_of(hws, "ROOM.MEDIA")
            if host_first:
                presence(hws, "7")  # the guest is still on 1: the room stays
                next_of(hws, "ROOM.PARTICIPANT")
                presence(gws, None)  # the guest closes it: the room goes to the host's
                moved = next_of(gws, "ROOM.MEDIA")["payload"]
            else:
                presence(gws, None)  # the guest closes it first
                next_of(gws, "ROOM.PARTICIPANT")
                presence(hws, "7")  # the host's new title takes the room
                next_of(hws, "ROOM.MEDIA")
                moved = next_of(gws, "ROOM.MEDIA")["payload"]
            assert moved["media"]["titleId"] == "7", host_first
            assert moved["byName"] == "Suhaas" and moved["how"] == "new"
            assert main.rooms.rooms[host["code"]].playback is None


def test_opening_another_title_via_browse_moves_the_room_as_new() -> None:
    """BUG-014: a gap with no title (the service's browse page) must not lose the room."""
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        presence(hws, None)  # back to browse
        next_of(hws, "ROOM.PARTICIPANT")
        presence(hws, "7")  # opens another movie
        moved = next_of(hws, "ROOM.MEDIA")["payload"]
        assert moved["how"] == "new" and moved["media"]["titleId"] == "7"
        assert next_of(gws, "ROOM.MEDIA")["payload"]["byName"] == "Suhaas"
        # A newly picked title keeps no clock; its opener publishes their position.
        assert main.rooms.rooms[host["code"]].playback is None
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_next_episode_is_marked_next_and_own_watchers_never_move_the_room() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        presence(hws, "2")  # straight on: next episode
        assert next_of(hws, "ROOM.MEDIA")["payload"]["how"] == "next"
        # The guest, watching on their own, opens something else: the room stays.
        gws.send_json(
            {
                "id": "o",
                "type": "PRESENCE.UPDATE",
                "timestamp": 1,
                "payload": {"service": "netflix", "following": False, "media": None},
            }
        )
        next_of(gws, "ROOM.PARTICIPANT")
        gws.send_json(
            {
                "id": "o2",
                "type": "PRESENCE.UPDATE",
                "timestamp": 1,
                "payload": {
                    "service": "netflix",
                    "following": False,
                    "media": {
                        "service": "netflix",
                        "titleId": "9",
                        "titleName": "Other",
                        "titleUrl": "https://www.netflix.com/watch/9",
                    },
                },
            }
        )
        next_of(gws, "ROOM.PARTICIPANT")
        media = main.rooms.rooms[host["code"]].media
        assert media is not None and media["titleId"] == "2"
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_show_names_tell_next_episode_from_another_title() -> None:
    def m(service: str, title_id: str, name: str | None) -> dict[str, Any]:
        return {"service": service, "titleId": title_id, "titleName": name, "titleUrl": None}

    assert main.show(m("netflix", "1", "Dark, S1:E3, Past and Present")) == "dark"
    assert main.show(m("jiohotstar", "2", "Panchayat S3 E2")) == "panchayat"
    assert main.show(m("prime", "ABC:Season 1, Ep. 3", "The Boys")) == "ABC"
    assert main.show(m("netflix", "3", None)) is None


def test_autoplay_into_another_film_asks_instead_of_moving_everyone() -> None:
    """BUG-019: a straight move to a different show is a new title, not the next episode."""
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)  # both on "1", named "Dark, E1"
    try:
        presence(hws, "2")  # "Dark, E2": same show, straight on
        assert next_of(hws, "ROOM.MEDIA")["payload"]["how"] == "next"
        hws.send_json(
            msg(
                "PRESENCE.UPDATE",
                {
                    "service": "netflix",
                    "following": True,
                    "media": {
                        "service": "netflix",
                        "titleId": "77",
                        "titleName": "Another Film",
                        "titleUrl": "https://www.netflix.com/watch/77",
                    },
                },
            )
        )
        assert next_of(hws, "ROOM.MEDIA")["payload"]["how"] == "new"
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


# ---- Closing the browser leaves the room; coming back says "rejoined" ----


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """One event loop for every socket, so the grace timer outlives the socket that started it."""
    monkeypatch.setattr(main.config, "AWAY_GRACE_SECONDS", 0.3)
    with TestClient(main.app) as c:
        yield c


def refused(c: TestClient, url: str) -> bool:
    try:
        with c.websocket_connect(url) as ws:
            ws.receive_json()
    except WebSocketDisconnect as e:
        return e.code == 1008
    return False


def closed(ws: Any) -> None:
    """Reads until the server closes the socket, so its handler has finished."""
    with pytest.raises(WebSocketDisconnect):
        while True:
            ws.receive_json()


def test_a_closed_browser_leaves_after_the_grace_period(live: TestClient) -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    with live.websocket_connect(url + host["token"]) as hws:
        hws.receive_json()
        with live.websocket_connect(url + guest["token"]) as gws:
            gws.receive_json()
            next_of(hws, "ROOM.PARTICIPANT")  # joined
        # The browser closed without a ROOM.LEAVE: away at once, gone after the grace period.
        away = next_of(hws, "ROOM.PARTICIPANT")["payload"]
        assert away["event"] == "updated" and away["participant"]["connected"] is False
        left = next_of(hws, "ROOM.PARTICIPANT")["payload"]
        assert left["event"] == "left" and left["participant"]["name"] == "Asha"
        assert [p.name for p in main.rooms.rooms[host["code"]].participants.values()] == ["Suhaas"]
    assert refused(live, url + guest["token"])


def test_a_short_drop_within_the_grace_period_stays_silent(live: TestClient) -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    with live.websocket_connect(url + host["token"]) as hws:
        hws.receive_json()
        with live.websocket_connect(url + guest["token"]) as gws:
            gws.receive_json()
        with live.websocket_connect(url + guest["token"]) as gws:  # back on Wi-Fi
            gws.receive_json()
            time.sleep(0.6)  # twice the grace period
            hws.send_json(msg("SYS.PING", {"t1": 1}))
            events = []
            while (m := hws.receive_json())["type"] != "SYS.PONG":
                if m["type"] == "ROOM.PARTICIPANT":
                    events.append(m["payload"]["event"])
            assert "left" not in events and events[-1] == "joined"
            assert len(main.rooms.rooms[host["code"]].participants) == 2


def test_the_last_one_out_by_closing_keeps_the_room_until_it_expires(live: TestClient) -> None:
    host = create()
    with live.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        ws.receive_json()
    time.sleep(0.6)
    room = main.rooms.rooms[host["code"]]
    assert room.participants == {}  # left after the grace period, but the room waits
    again = join(host["code"], "Suhaas")
    assert again.status_code == 201
    assert room.participants[again.json()["participantId"]].rejoined
    main.rooms.sweep(now=main.now_ms() + (main.config.ROOM_IDLE_EXPIRY_SECONDS + 1) * 1000)
    assert join(host["code"]).status_code == 410


def test_rejoining_with_the_last_token_replaces_the_away_row(
    live: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    monkeypatch.setattr(main.config, "AWAY_GRACE_SECONDS", 30)  # away, not gone, at the rejoin
    with live.websocket_connect(url + host["token"]) as hws:
        hws.receive_json()
        with live.websocket_connect(url + guest["token"]) as gws:
            gws.receive_json()
        next_of(hws, "ROOM.PARTICIPANT")  # joined
        next_of(hws, "ROOM.PARTICIPANT")  # away
        back = rejoin(host["code"], "Asha", guest["token"]).json()
        assert back["participantId"] == guest["participantId"]  # same row, new token
        assert refused(live, url + guest["token"])
        with live.websocket_connect(url + back["token"]) as gws:
            gws.receive_json()
            came = next_of(hws, "ROOM.PARTICIPANT")["payload"]
            assert came["event"] == "rejoined" and came["participant"]["connected"]
            names = [p.name for p in main.rooms.rooms[host["code"]].participants.values()]
            assert sorted(names) == ["Asha", "Suhaas"]
        # Someone connected is never replaced, even with their token: it's someone new.
        other = rejoin(host["code"], "Suhaas", host["token"]).json()
        assert other["participantId"] != host["participantId"]
        assert not main.rooms.rooms[host["code"]].participants[other["participantId"]].rejoined


def test_a_name_alone_cannot_take_over_someone_away(
    live: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """BUG-041: anyone with the code could kick a dropped friend by joining under their name."""
    host = create()
    guest = join(host["code"]).json()
    elsewhere = create("Asha")
    url = f"/ws/rooms/{host['code']}?token="
    monkeypatch.setattr(main.config, "AWAY_GRACE_SECONDS", 0.5)
    with live.websocket_connect(url + host["token"]) as hws:
        hws.receive_json()
        with live.websocket_connect(url + guest["token"]) as gws:
            gws.receive_json()
        next_of(hws, "ROOM.PARTICIPANT")  # joined
        next_of(hws, "ROOM.PARTICIPANT")  # away
        # Same name, no token (or a token from another room): a separate participant.
        for token in (None, elsewhere["token"], "x" * 43):
            r = rejoin(host["code"], "Asha", token).json()
            assert r["participantId"] != guest["participantId"]
            assert not main.rooms.rooms[host["code"]].participants[r["participantId"]].rejoined
        assert main.rooms.rooms[host["code"]].participants[guest["participantId"]].name == "Asha"
        with live.websocket_connect(url + r["token"]) as nws:
            nws.receive_json()
            came = next_of(hws, "ROOM.PARTICIPANT")["payload"]
            assert came["event"] == "joined" and came["participant"]["id"] == r["participantId"]
            # The real Asha's row stays until her own grace period ends.
            left = next_of(hws, "ROOM.PARTICIPANT")["payload"]
            assert left["event"] == "left" and left["participant"]["id"] == guest["participantId"]
    assert (
        client.post(
            f"/api/v1/rooms/{host['code']}/join", json={"name": "Asha", "token": "bad token!"}
        ).status_code
        == 422
    )


def test_leaving_then_joining_again_is_a_rejoin_and_keep_room_keeps_it(live: TestClient) -> None:
    host = create()
    guest = join(host["code"]).json()
    url = f"/ws/rooms/{host['code']}?token="
    with live.websocket_connect(url + host["token"]) as hws:
        hws.receive_json()
        with live.websocket_connect(url + guest["token"]) as gws:
            gws.receive_json()
            gws.send_json(msg("ROOM.LEAVE", {}))
            closed(gws)
        assert next_of(hws, "ROOM.PARTICIPANT")["payload"]["event"] == "joined"
        assert next_of(hws, "ROOM.PARTICIPANT")["payload"]["event"] == "left"
        back = join(host["code"], "Asha").json()
        with live.websocket_connect(url + back["token"]) as gws:
            gws.receive_json()
            assert next_of(hws, "ROOM.PARTICIPANT")["payload"]["event"] == "rejoined"
            gws.send_json(msg("ROOM.LEAVE", {}))
            closed(gws)
        hws.send_json(msg("ROOM.LEAVE", {"keepRoom": True}))  # the last window closed
        closed(hws)
    # The last one out kept the room: they can come back until it expires.
    assert join(host["code"], "Suhaas").status_code == 201


def test_a_lone_surrogate_in_a_name_cannot_break_the_room() -> None:
    # JSON may carry "\ud83d" alone; a raw lone surrogate can't be sent as UTF-8, so every
    # snapshot naming this person would fail to send and the room would hang on Connecting.
    host = create()
    r = client.post(
        f"/api/v1/rooms/{host['code']}/join",
        content=b'{"name":"Asha \\ud83d"}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 201
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        text = ws.receive_text()
        text.encode("utf-8")  # what the server's WebSocket does before sending
        assert json.loads(text)["type"] == "ROOM.STATE"


def until_pong(ws: Any) -> list[dict[str, Any]]:
    """Everything this socket gets up to the answer to a ping sent now."""
    ws.send_json(msg("SYS.PING", {"t1": 0}))
    got: list[dict[str, Any]] = []
    while (m := ws.receive_json())["type"] != "SYS.PONG":
        got.append(m)
    return got


def update(ws: Any, action: str, status_: str, position: float) -> None:
    payload = {"action": action, "status": status_, "position": position, "rate": 1}
    ws.send_json(msg("PLAYBACK.UPDATE", payload | {"titleId": "1"}))


def test_two_changes_at_once_end_everyone_on_the_last_one() -> None:
    """Crossing changes: the second sender also gets the room's result, or they stay apart."""
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        update(hws, "pause", "paused", 30)
        hws.send_json(msg("SYS.PING", {"t1": 1}))
        next_of(hws, "SYS.PONG")
        update(gws, "seek", "playing", 60)  # sent before the guest saw the pause
        got = [m["payload"] for m in until_pong(gws) if m["type"] == "PLAYBACK.STATE"]
        assert [x["byName"] for x in got] == ["Suhaas", "Asha"]
        assert got[1]["playback"]["position"] == 60
        assert next_of(hws, "PLAYBACK.STATE")["payload"]["playback"]["status"] == "playing"
        # One person's own run of changes is never echoed back to them.
        update(gws, "seek", "playing", 70)
        assert until_pong(gws) == []
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)


def test_moving_to_another_title_cancels_a_start_together() -> None:
    host = create()
    guest = join(host["code"]).json()
    hcm, hws, gcm, gws = two_on_title(host, guest)
    try:
        hws.send_json(msg("START.REQUEST", {"position": 1200, "titleId": "1"}))
        next_of(hws, "START.STATE")
        presence(hws, "2")  # the host moves on to the next episode while the guest gets ready
        phases = [m["payload"]["phase"] for m in until_pong(hws) if m["type"] == "START.STATE"]
        assert phases == ["cancelled"]
        gws.send_json(msg("START.READY", {}))  # late: must not start episode 2 at 20:00
        until_pong(gws)
        room = main.rooms.rooms[host["code"]]
        assert room.start is None
        assert room.playback is not None and room.playback["titleId"] == "2"
        assert room.playback["position"] == 0
    finally:
        gcm.__exit__(None, None, None)
        hcm.__exit__(None, None, None)
