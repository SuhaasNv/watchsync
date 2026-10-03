"""Reactions (US-045, US-046): members only, limited per person, never stored."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import config, main
from app.protocol import is_server_message

client = TestClient(main.app)
LAUGH = "\U0001f602"


@pytest.fixture(autouse=True, scope="module")
def one_loop() -> Iterator[None]:
    with client:
        yield


def ticket(path: str, name: str) -> dict[str, str]:
    r = client.post(path, json={"name": name})
    assert r.status_code in (200, 201), r.text
    body: dict[str, str] = r.json()
    return body


def react(ws: Any, emoji: str = LAUGH, count: int = 1) -> None:
    payload = {"emoji": emoji, "count": count}
    ws.send_json({"id": "r", "type": "REACTION.SEND", "timestamp": 1, "payload": payload})


def ping(ws: Any) -> None:
    ws.send_json({"id": "p", "type": "SYS.PING", "timestamp": 1, "payload": {"t1": 1}})


def until(ws: Any, type_: str) -> list[dict[str, Any]]:
    """Messages up to and including the first of type_."""
    seen: list[dict[str, Any]] = []
    while True:
        m: dict[str, Any] = ws.receive_json()
        seen.append(m)
        if m["type"] == type_:
            return seen


def test_reaction_reaches_everyone_including_the_sender_and_is_not_kept() -> None:
    host = ticket("/api/v1/rooms", "Suhaas")
    guest = ticket(f"/api/v1/rooms/{host['code']}/join", "Asha")
    url = f"/ws/rooms/{host['code']}?token="
    with (
        client.websocket_connect(url + host["token"]) as hws,
        client.websocket_connect(url + guest["token"]) as gws,
    ):
        until(hws, "ROOM.STATE")
        until(gws, "ROOM.STATE")
        react(gws, count=3)
        for ws in (hws, gws):
            shown = until(ws, "REACTION.SHOW")[-1]
            assert is_server_message(shown)
            assert shown["payload"] == {
                "fromId": guest["participantId"],
                "name": "Asha",
                "emoji": LAUGH,
                "count": 3,
            }
        room = main.rooms.rooms[host["code"]]
        assert LAUGH not in repr(vars(room)) + repr(room.snapshot(host["participantId"]))


def test_extra_reactions_past_the_limit_are_dropped_silently() -> None:
    host = ticket("/api/v1/rooms", "Suhaas")
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        until(ws, "ROOM.STATE")
        for _ in range(config.REACTIONS_PER_5S + 3):
            react(ws)
        ping(ws)
        seen = [m["type"] for m in until(ws, "SYS.PONG")]
        assert seen.count("REACTION.SHOW") == config.REACTIONS_PER_5S == 8
        assert "SYS.ERROR" not in seen


def test_unknown_emoji_or_count_is_refused() -> None:
    host = ticket("/api/v1/rooms", "Suhaas")
    with client.websocket_connect(f"/ws/rooms/{host['code']}?token={host['token']}") as ws:
        until(ws, "ROOM.STATE")
        react(ws, emoji="\U0001f4a9")
        assert until(ws, "SYS.ERROR")[-1]["payload"]["code"] == "invalid_message"
        react(ws, count=6)
        assert until(ws, "SYS.ERROR")[-1]["payload"]["code"] == "invalid_message"


def test_a_connection_no_longer_in_the_room_cannot_react() -> None:
    host = ticket("/api/v1/rooms", "Suhaas")
    guest = ticket(f"/api/v1/rooms/{host['code']}/join", "Asha")
    url = f"/ws/rooms/{host['code']}?token="
    with (
        client.websocket_connect(url + host["token"]) as hws,
        client.websocket_connect(url + guest["token"]) as gws,
    ):
        until(hws, "ROOM.STATE")
        until(gws, "ROOM.STATE")
        room = main.rooms.rooms[host["code"]]
        del room.participants[guest["participantId"]]  # removed while the socket is open
        react(gws)
        ping(gws)
        assert "REACTION.SHOW" not in [m["type"] for m in until(gws, "SYS.PONG")]
        ping(hws)
        assert "REACTION.SHOW" not in [m["type"] for m in until(hws, "SYS.PONG")]
