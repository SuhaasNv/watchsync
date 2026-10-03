"""Chat (UC-014): relay, history, limits, membership and privacy (US-042, US-043, US-110).

Each TestClient socket runs the app on its own event loop, and one socket's handler writing to
another's queue doesn't wake a reader already waiting there. So every helper here waits for
its own sender's handler to finish (a ping answered) before anyone reads another socket.
"""

import contextlib
import json
import logging
import socket
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
import uvicorn
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from websockets.sync.client import connect as ws_connect

from app import config, main
from app.protocol import is_server_message

client = TestClient(main.app)
SEES_CHAT_HISTORY = True  # conftest.py: these tests read it


def create(name: str = "Maya") -> dict[str, str]:
    r = client.post("/api/v1/rooms", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def join(code: str, name: str = "Asha") -> dict[str, str]:
    r = client.post(f"/api/v1/rooms/{code}/join", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def msg(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": "1", "type": type_, "timestamp": 1, "payload": payload}


def receive(ws: Any) -> dict[str, Any]:
    m: dict[str, Any] = ws.receive_json()
    assert is_server_message(m), m  # everything the room sends is valid protocol
    return m


def next_of(ws: Any, type_: str) -> dict[str, Any]:
    while (m := receive(ws))["type"] != type_:
        pass
    return m


def until_pong(ws: Any) -> list[dict[str, Any]]:
    """Everything this socket gets up to the answer to a ping sent now."""
    ws.send_json(msg("SYS.PING", {"t1": 0}))
    got: list[dict[str, Any]] = []
    while (m := receive(ws))["type"] != "SYS.PONG":
        got.append(m)
    return got


def send(ws: Any, type_: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Send, and return what the sender got back once the room has handled it."""
    ws.send_json(msg(type_, payload))
    return until_pong(ws)


def say(
    ws: Any, text: str, movie_time: float | None = 2530, title_id: str | None = "1"
) -> list[dict[str, Any]]:
    return send(ws, "CHAT.SEND", {"text": text, "movieTime": movie_time, "titleId": title_id})


def chats(got: list[dict[str, Any]]) -> list[str]:
    return [m["payload"]["text"] for m in got if m["type"] == "CHAT.MESSAGE"]


def refusal(got: list[dict[str, Any]]) -> dict[str, Any]:
    (refused,) = [m["payload"] for m in got if m["type"] == "CHAT.REJECTED"]
    return refused


@contextlib.contextmanager
def connected(ticket: dict[str, str]) -> Iterator[tuple[Any, list[dict[str, Any]]]]:
    """A socket in the room whose arrival everyone has heard; yields it and its history."""
    url = f"/ws/rooms/{ticket['code']}?token={ticket['token']}"
    with client.websocket_connect(url) as ws:
        assert receive(ws)["type"] == "ROOM.STATE"
        history = receive(ws)
        assert history["type"] == "CHAT.HISTORY"  # right after ROOM.STATE, every time
        until_pong(ws)
        yield ws, history["payload"]["messages"]


def closed(ws: Any) -> None:
    with pytest.raises(WebSocketDisconnect):
        while True:
            ws.receive_json()


def test_a_message_reaches_everyone_in_the_room_including_the_sender() -> None:
    host = create()
    guest = join(host["code"])
    other = create("Ravi")  # someone in another room hears nothing
    with connected(host) as (hws, _), connected(guest) as (gws, _), connected(other) as (ows, _):
        mine = [m for m in say(hws, "hi") if m["type"] == "CHAT.MESSAGE"]
        for m in (mine[0]["payload"], next_of(gws, "CHAT.MESSAGE")["payload"]):
            assert m["text"] == "hi" and m["name"] == "Maya"
            assert m["fromId"] == host["participantId"]
            assert m["movieTime"] == 2530 and m["titleId"] == "1"
            assert len(m["id"]) == 16 and m["serverTime"] > 0
        assert until_pong(ows) == []
        # No title open: no movie time, the name only.
        say(gws, "<b>bold</b> https://x.y", movie_time=None, title_id=None)
        m = next_of(hws, "CHAT.MESSAGE")["payload"]
        assert m["movieTime"] is None and m["titleId"] is None
        assert m["text"] == "<b>bold</b> https://x.y"  # data, passed on unchanged


def test_someone_on_their_own_can_chat() -> None:
    with connected(create()) as (ws, history):
        assert history == []
        (m,) = [m["payload"] for m in say(ws, "just me", movie_time=61.5)]
        assert m["text"] == "just me" and m["movieTime"] == 61.5


def test_people_who_join_later_or_reconnect_get_earlier_messages_in_order() -> None:
    host = create()
    with connected(host) as (ws, _):
        for text in ("one", "two", "three"):
            assert chats(say(ws, text)) == [text]
    guest = join(host["code"])
    with connected(guest) as (_, history):
        assert [m["text"] for m in history] == ["one", "two", "three"]
        assert [m["name"] for m in history] == ["Maya"] * 3
    with connected(host) as (_, history):  # the host's reconnect, same token
        assert [m["text"] for m in history] == ["one", "two", "three"]


def test_history_keeps_only_the_most_recent_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    assert config.CHAT_HISTORY == 200
    monkeypatch.setattr(main, "chat_limiter", main.Limiter(10_000, 5))
    monkeypatch.setattr(main, "message_limiter", main.Limiter(10_000, 10))
    host = create()
    with connected(host) as (ws, _):
        for i in range(205):
            ws.send_json(msg("CHAT.SEND", {"text": f"m{i}", "movieTime": None, "titleId": None}))
        assert len(chats(until_pong(ws))) == 205
    with connected(host) as (_, history):
        assert len(history) == 200
        assert history[0]["text"] == "m5" and history[-1]["text"] == "m204"


def test_history_cap_comes_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CHAT_HISTORY", 2)
    host = create()
    with connected(host) as (ws, _):
        for text in ("a", "b", "c"):
            say(ws, text)
    with connected(host) as (_, history):
        assert [m["text"] for m in history] == ["b", "c"]


def test_chat_is_deleted_when_the_last_person_leaves() -> None:
    host = create()
    with connected(host) as (ws, _):
        say(ws, "secret")
        room = main.rooms.rooms[host["code"]]
        ws.send_json(msg("ROOM.LEAVE", {}))
        closed(ws)
    assert list(room.chat) == []
    assert host["code"] not in main.rooms.rooms
    # A new room starts with no earlier messages.
    with connected(create()) as (_, history):
        assert history == []


def test_chat_is_deleted_when_an_empty_room_expires() -> None:
    host = create()
    with connected(host) as (ws, _):
        say(ws, "secret")
    room = main.rooms.rooms[host["code"]]
    assert [m["text"] for m in room.chat] == ["secret"]  # kept while the room waits
    later = main.now_ms() + (config.ROOM_IDLE_EXPIRY_SECONDS + 1) * 1000
    main.rooms.sweep(now=later)
    assert host["code"] not in main.rooms.rooms
    assert list(room.chat) == []


def test_more_than_the_rate_limit_is_refused_with_the_text_echoed() -> None:
    assert config.CHAT_PER_5S == 5
    host = create()
    guest = join(host["code"])
    with connected(host) as (hws, _), connected(guest) as (gws, _):
        for i in range(5):
            assert chats(say(hws, f"ok {i}")) == [f"ok {i}"]
        got = say(hws, "one too many")
        assert chats(got) == []
        assert refusal(got) == {"reason": "rate_limited", "text": "one too many"}
        assert chats(until_pong(gws)) == [f"ok {i}" for i in range(5)]  # the sixth reached nobody
        # Others keep their own budget.
        assert chats(say(gws, "my turn")) == ["my turn"]
        assert chats(until_pong(hws)) == ["my turn"]


def test_the_rate_limit_survives_a_reconnect() -> None:
    host = create()
    with connected(host) as (ws, _):
        for i in range(5):
            say(ws, f"ok {i}")
    with connected(host) as (ws, _):
        assert refusal(say(ws, "again"))["reason"] == "rate_limited"


def test_rate_limited_messages_go_through_once_the_window_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main, "chat_limiter", main.Limiter(1, 0.2))
    with connected(create()) as (ws, _):
        assert chats(say(ws, "first")) == ["first"]
        assert refusal(say(ws, "second"))["reason"] == "rate_limited"
        time.sleep(0.25)
        assert chats(say(ws, "second")) == ["second"]


def test_length_is_counted_in_code_points() -> None:
    host = create()
    guest = join(host["code"])
    with connected(host) as (hws, _), connected(guest) as (gws, _):
        assert chats(say(hws, "😀" * 500)) == ["😀" * 500]  # 1000 UTF-16 units: fits
        assert refusal(say(hws, "😀" * 501)) == {"reason": "too_long", "text": "😀" * 501}
        assert refusal(say(hws, "x" * 501))["reason"] == "too_long"
        # Neither long one reached anyone or the history.
        assert chats(until_pong(gws)) == ["😀" * 500]
        assert len(main.rooms.rooms[host["code"]].chat) == 1


def test_a_lower_length_limit_comes_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CHAT_MAX_CHARS", 10)
    with connected(create()) as (ws, _):
        assert chats(say(ws, "x" * 10)) == ["x" * 10]
        assert refusal(say(ws, "x" * 11)) == {"reason": "too_long", "text": "x" * 11}


def test_whitespace_only_is_refused() -> None:
    host = create()
    with connected(host) as (ws, _):
        for text in (" ", "   ", " 　"):
            assert refusal(say(ws, text)) == {"reason": "invalid", "text": text}
        assert list(main.rooms.rooms[host["code"]].chat) == []


def test_malformed_chat_gets_invalid_message_and_the_socket_stays_open() -> None:
    host = create()
    with connected(host) as (ws, _):
        bad = [
            {"text": "a\nb", "movieTime": 1, "titleId": "1"},  # control character
            {"text": "a\u0000b", "movieTime": 1, "titleId": "1"},
            {"text": "", "movieTime": 1, "titleId": "1"},
            {"text": 5, "movieTime": 1, "titleId": "1"},
            {"text": "hi", "movieTime": -1, "titleId": "1"},
            {"text": "hi", "movieTime": "42:10", "titleId": "1"},
            {"text": "hi", "titleId": "1"},
            {"text": "hi", "movieTime": 1, "titleId": "1", "fromId": "someone-else"},
        ]
        for payload in bad:
            got = send(ws, "CHAT.SEND", payload)
            assert [(m["type"], m["payload"]["code"]) for m in got] == [
                ("SYS.ERROR", "invalid_message")
            ], payload
        assert chats(say(ws, "still here")) == ["still here"]
        assert [m["text"] for m in main.rooms.rooms[host["code"]].chat] == ["still here"]


def test_only_members_can_chat() -> None:
    """A forged token, another room's token, or a token revoked by leaving gets no socket,
    so nothing it sends reaches the room."""
    host = create()
    other = create("Ravi")
    guest = join(host["code"])
    with connected(guest) as (gws, _):
        gws.send_json(msg("ROOM.LEAVE", {}))
        closed(gws)
    with connected(host) as (hws, _):
        for token in ("forged", other["token"], guest["token"]):
            url = f"/ws/rooms/{host['code']}?token={token}"
            with client.websocket_connect(url) as ws:
                ws.send_json(
                    msg("CHAT.SEND", {"text": "let me in", "movieTime": None, "titleId": None})
                )
                closed(ws)
        assert chats(until_pong(hws)) == []
    assert list(main.rooms.rooms[host["code"]].chat) == []


def test_older_message_types_are_unaffected() -> None:
    host = create()
    guest = join(host["code"])
    url = f"/ws/rooms/{host['code']}?token={host['token']}"
    with client.websocket_connect(url) as ws:
        state = receive(ws)
        assert state["type"] == "ROOM.STATE"
        assert set(state["payload"]) == {
            "code",
            "you",
            "participants",
            "media",
            "playback",
            "serverTime",
        }
        assert receive(ws)["type"] == "CHAT.HISTORY"
        with connected(guest) as (gws, _):
            # A friend arriving gets the history; the host gets only the arrival.
            got = until_pong(ws)
            assert [(m["type"], m["payload"]["event"]) for m in got] == [
                ("ROOM.PARTICIPANT", "joined")
            ]
            say(gws, "hi")
            assert [m["type"] for m in until_pong(ws)] == ["CHAT.MESSAGE"]
            payload = {"action": "pause", "status": "paused", "position": 10, "rate": 1}
            send(gws, "PLAYBACK.UPDATE", payload | {"titleId": "1"})
            assert next_of(ws, "PLAYBACK.STATE")["payload"]["byName"] == "Asha"


def test_chat_text_is_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    """Every outcome (sent, refused for space, length and rate, replayed) at every level."""
    caplog.set_level(logging.DEBUG)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "websockets", "app"):
        caplog.set_level(logging.DEBUG, logger=name)
    texts = [f"private-words-{i}" for i in range(8)]
    host = create()
    guest = join(host["code"])
    with connected(host) as (hws, _), connected(guest) as (gws, _):
        say(hws, texts[0])
        say(gws, "   ")
        say(gws, texts[1] + "x" * 600)
        for text in texts[2:]:
            say(gws, text)  # the sixth in 5 s is refused
    with connected(guest) as (_, history):
        assert len(history) == 6
    logged = "\n".join(r.getMessage() for r in caplog.records) + caplog.text
    for text in texts:
        assert text not in logged


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


@pytest.mark.parametrize("ws_impl", ["auto", "websockets"])
def test_chat_text_is_never_logged_by_the_real_server_at_debug(
    caplog: pytest.LogCaptureFixture, ws_impl: str
) -> None:
    """The WebSocket library logs every frame at DEBUG through uvicorn's logger, shortened to
    its first and last few dozen characters: a short message, or a refusal echoing the text at
    the end, shows the text. Run the real server at debug and read everything it logs."""
    caplog.set_level(logging.DEBUG)
    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(main.app, port=port, log_level="debug", log_config=None, ws=ws_impl)
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started:
            assert time.monotonic() < deadline, "server did not start"
            time.sleep(0.05)
        assert logging.getLogger("uvicorn.error").isEnabledFor(logging.DEBUG)
        host = create()
        url = f"ws://127.0.0.1:{port}/ws/rooms/{host['code']}?token={host['token']}"
        with ws_connect(url) as ws:
            assert json.loads(ws.recv(timeout=5))["type"] == "ROOM.STATE"
            assert json.loads(ws.recv(timeout=5))["type"] == "CHAT.HISTORY"
            for text, answer in (
                ("hi-secret", "CHAT.MESSAGE"),
                ("x" * 500 + "-tail-secret", "CHAT.REJECTED"),
            ):
                chat = {"text": text, "movieTime": 1, "titleId": "1"}
                ws.send(json.dumps(msg("CHAT.SEND", chat)))
                assert json.loads(ws.recv(timeout=5))["type"] == answer
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    # Everything but this test's own client library.
    server_logs = [r for r in caplog.records if r.name != "websockets.client"]
    # Captured: the socket's own lines are there, only the frames are not.
    assert any("[accepted]" in r.getMessage() for r in server_logs)
    logged = "\n".join(r.getMessage() for r in server_logs)
    assert "secret" not in logged
