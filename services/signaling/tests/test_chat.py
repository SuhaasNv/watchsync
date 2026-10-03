"""Chat (UC-014): relay, history, limits, membership and privacy (US-042, US-043, US-110).

Every socket's handler runs on one event loop (conftest.py), and the helpers still wait for
the sender's handler to finish (a ping answered) before reading another socket.
"""

import contextlib
import json
import logging
import socket
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
import uvicorn
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from uvicorn.logging import AccessFormatter
from websockets.sync.client import connect as ws_connect

from app import config, main
from app.protocol import is_chat_text, is_client_message, is_server_message
from app.rooms import Room, Rooms, chat_size

client = TestClient(main.app)
SEES_CHAT_HISTORY = True  # conftest.py: these tests read it
# Shared with packages/protocol/src/protocol.test.ts, so both validators agree.
CASES = json.loads((config.ROOT / "packages/protocol/src/chat-text-cases.json").read_text())


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


def chat_send(
    text: str, movie_time: float | None = 2530, title_id: str | None = "1", client_id: str = ""
) -> dict[str, Any]:
    client_id = client_id or uuid.uuid4().hex
    return {"text": text, "movieTime": movie_time, "titleId": title_id, "clientId": client_id}


def say(
    ws: Any,
    text: str,
    movie_time: float | None = 2530,
    title_id: str | None = "1",
    client_id: str = "",
) -> list[dict[str, Any]]:
    return send(ws, "CHAT.SEND", chat_send(text, movie_time, title_id, client_id))


def chats(got: list[dict[str, Any]]) -> list[str]:
    return [m["payload"]["text"] for m in got if m["type"] == "CHAT.MESSAGE"]


def refusal(got: list[dict[str, Any]]) -> dict[str, Any]:
    """The one CHAT.REJECTED in got, without its clientId (which it always carries here)."""
    (refused,) = [m["payload"] for m in got if m["type"] == "CHAT.REJECTED"]
    assert refused.pop("clientId")
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
    monkeypatch.setattr(main, "room_chat_limiter", main.Limiter(10_000, 10))
    monkeypatch.setattr(main, "message_limiter", main.Limiter(10_000, 10))
    host = create()
    with connected(host) as (ws, _):
        for i in range(205):
            ws.send_json(msg("CHAT.SEND", chat_send(f"m{i}")))
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
    assert list(room.chat) == [] and room.chat_bytes == 0
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
    total, mine = main.rooms.chat_bytes, room.chat_bytes
    assert mine > 0
    main.rooms.sweep(now=later)  # ends other tests' idle rooms too
    assert host["code"] not in main.rooms.rooms
    assert list(room.chat) == [] and room.chat_bytes == 0
    assert main.rooms.chat_bytes <= total - mine  # the budget is given back


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
        # The echo is the first 500 characters.
        assert refusal(say(hws, "😀" * 501)) == {"reason": "too_long", "text": "😀" * 500}
        assert refusal(say(hws, "x" * 501))["reason"] == "too_long"
        # Neither long one reached anyone or the history.
        assert chats(until_pong(gws)) == ["😀" * 500]
        assert len(main.rooms.rooms[host["code"]].chat) == 1


def test_a_lower_length_limit_comes_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CHAT_MAX_CHARS", 10)
    with connected(create()) as (ws, _):
        assert chats(say(ws, "x" * 10)) == ["x" * 10]
        assert refusal(say(ws, "x" * 11)) == {"reason": "too_long", "text": "x" * 11}


def test_text_with_nothing_visible_is_refused() -> None:
    host = create()
    nbsp, ideographic, acute, ring = chr(0xA0), chr(0x3000), chr(0x301), chr(0x20DD)
    hangul_filler, braille_blank, half_filler = chr(0x3164), chr(0x2800), chr(0xFFA0)
    with connected(host) as (ws, _):
        nothing = [
            " ",
            "   ",
            "\n\n",
            nbsp + ideographic,
            acute * 2,  # combining marks on their own
            f" {ring} ",
            hangul_filler,
            braille_blank * 3,
            f"{half_filler} {chr(0x115F)}{chr(0x1160)}",
        ]
        for text in nothing:
            assert refusal(say(ws, text)) == {"reason": "invalid", "text": text}, ascii(text)
        assert list(main.rooms.rooms[host["code"]].chat) == []


def test_long_runs_of_combining_marks_are_refused() -> None:
    acute = chr(0x301)
    with connected(create()) as (ws, _):
        assert chats(say(ws, "e" + acute * 8)) == ["e" + acute * 8]
        assert refusal(say(ws, "e" + acute * 9))["reason"] == "invalid"
        assert chats(say(ws, ("e" + acute * 8) * 3)) == [("e" + acute * 8) * 3]


def test_line_breaks_are_kept_up_to_ten() -> None:
    host = create()
    with connected(host) as (ws, _):
        ten = "a" + "\nb" * 10
        assert chats(say(ws, "line one\nline two")) == ["line one\nline two"]
        assert chats(say(ws, ten)) == [ten]
        assert chats(say(ws, "hi\n")) == ["hi\n"]
        # Eleven, the last one final: Python's `$` matches before a final newline, so the
        # schema search alone would let this through while the extension refuses it, and one
        # such message kept would make every later joiner's CHAT.HISTORY invalid.
        trap = "a" + "\na" * 10 + "\n"
        assert is_client_message(msg("CHAT.SEND", chat_send(trap)))  # the search's blind spot
        assert refusal(say(ws, trap)) == {"reason": "invalid", "text": trap}
    with connected(join(host["code"])) as (_, history):
        assert [m["text"] for m in history] == ["line one\nline two", ten, "hi\n"]


@pytest.mark.parametrize(
    "text, accepted",
    [(t, True) for t in CASES["accepted"]]
    + [(t, False) for t in CASES["refused"]]
    + [(t, False) for t in CASES["serverRefused"]]
    + [("x" * 500, True), ("x" * 501, False), (chr(0x1F600) * 500, True)]
    + [(chr(0x1F600) * 501, False)],
)
def test_the_service_and_the_extension_agree_on_chat_text(text: str, accepted: bool) -> None:
    sendable = is_client_message(msg("CHAT.SEND", chat_send(text))) and is_chat_text(text)
    assert sendable == accepted, ascii(text)
    if text in CASES["serverRefused"]:  # the schema lets it through; the service's check doesn't
        assert is_client_message(msg("CHAT.SEND", chat_send(text))), ascii(text)


def test_emoji_sequences_and_joined_scripts_are_relayed_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Joiners and variation selectors between visible characters stay in the text: emoji
    sequences (rainbow flag, families with skin tones) and Indic or Persian joins."""
    monkeypatch.setattr(main, "chat_limiter", main.Limiter(100, 5))
    host = create()
    guest = join(host["code"])
    joined = [t for t in CASES["accepted"] if chr(0x200C) in t or chr(0x200D) in t]
    assert len(joined) >= 5
    with connected(host) as (hws, _), connected(guest) as (gws, _):
        for text in joined:
            assert chats(say(hws, text)) == [text], ascii(text)
        assert chats(until_pong(gws)) == joined
        for text in CASES["serverRefused"]:
            assert refusal(say(hws, text))["reason"] == "invalid", ascii(text)


def test_nothing_clients_would_refuse_is_kept_or_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Defence in depth: each message is checked as clients will check it before it is kept."""
    monkeypatch.setattr(main, "is_server_message", lambda _: False)
    host = create()
    with connected(host) as (ws, _):
        got = say(ws, "hi")
        assert chats(got) == [] and refusal(got) == {"reason": "invalid", "text": "hi"}
        assert list(main.rooms.rooms[host["code"]].chat) == []


def test_a_room_keeps_at_most_its_byte_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    with connected(host) as (ws, _):
        first = [m["payload"] for m in say(ws, "x" * 100) if m["type"] == "CHAT.MESSAGE"]
        one = chat_size(first[0])
        monkeypatch.setattr(config, "CHAT_ROOM_BYTES", one * 3 + 10)  # serverTime's length varies
        for text in ("a" * 100, "b" * 100, "c" * 100):
            say(ws, text)
    room = main.rooms.rooms[host["code"]]
    assert [m["text"][0] for m in room.chat] == ["a", "b", "c"]  # the oldest went first
    assert room.chat_bytes == sum(chat_size(m) for m in room.chat) <= one * 3 + 10
    with connected(host) as (_, history):
        assert [m["text"][0] for m in history] == ["a", "b", "c"]


def restart(monkeypatch: pytest.MonkeyPatch) -> Rooms:
    """What a new process holds (as in test_restore.py): no rooms, no live tokens."""
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", b"s" * 32)
    fresh = Rooms()
    monkeypatch.setattr(main, "rooms", fresh)
    monkeypatch.setattr(main, "sockets", {})
    monkeypatch.setattr(main, "away", {})
    return fresh


def test_a_room_brought_back_after_a_restart_has_no_earlier_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """US-120: chat lives in the old process's memory only; nothing carries it over (not the
    tokens, not ROOM.RESTORE, not the snapshot), so a restored room starts with none."""
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", b"s" * 32)
    host = create()
    guest = join(host["code"])
    with connected(host) as (ws, _):
        say(ws, "before the restart")
    restart(monkeypatch)
    with connected(host) as (hws, history), connected(guest) as (_, guest_history):
        assert history == [] and guest_history == []
        room = main.rooms.rooms[host["code"]]
        assert room.restored and list(room.chat) == [] and room.chat_bytes == 0
        hws.send_json(msg("ROOM.RESTORE", {"media": None, "playback": None, "knownAt": 1}))
        restored = next_of(hws, "ROOM.STATE")
        assert "chat" not in json.dumps(restored["payload"]).lower()
        assert chats(say(hws, "after")) == ["after"]


def test_a_restored_room_keeps_every_chat_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", b"s" * 32)
    host = create()
    restart(monkeypatch)
    with connected(host) as (ws, _):
        assert refusal(say(ws, "x" * 501))["reason"] == "too_long"
        assert refusal(say(ws, chr(0x3164)))["reason"] == "invalid"
        for i in range(5):
            assert chats(say(ws, f"ok {i}")) == [f"ok {i}"]
        assert refusal(say(ws, "one too many"))["reason"] == "rate_limited"
        again = [m["payload"] for m in say(ws, "ok 0", client_id="dup")]
        assert again and again[0]["reason"] == "rate_limited"  # no budget, no new message
    assert len(main.rooms.rooms[host["code"]].chat) == 5


def test_all_rooms_together_keep_at_most_the_total_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Past the service-wide budget the oldest messages anywhere go first."""
    rooms = Rooms()
    a, b = Room(code="AAAAAA"), Room(code="BBBBBB")
    rooms.rooms = {"AAAAAA": a, "BBBBBB": b}

    def chat(text: str, at: float) -> dict[str, Any]:
        return {"id": text, "fromId": "p", "name": "M", "text": text, "serverTime": at}

    size = chat_size(chat("a1", 1))
    monkeypatch.setattr(config, "CHAT_TOTAL_BYTES", size * 3)
    rooms.keep_chat(a, chat("a1", 1))
    rooms.keep_chat(b, chat("b1", 2))
    rooms.keep_chat(a, chat("a2", 3))
    rooms.keep_chat(b, chat("b2", 4))  # over budget: a1, the oldest anywhere, goes
    assert [m["text"] for m in a.chat] == ["a2"] and [m["text"] for m in b.chat] == ["b1", "b2"]
    rooms.keep_chat(b, chat("b3", 5))  # b1 is now the oldest
    assert [m["text"] for m in a.chat] == ["a2"] and [m["text"] for m in b.chat] == ["b2", "b3"]
    assert rooms.chat_bytes == a.chat_bytes + b.chat_bytes == size * 3
    # A room that ends gives its share back, and nothing more is kept for it.
    rooms.leave(a, main.Participant(id="p", name="M", token="t"))  # noqa: S106 (a test value)
    assert "AAAAAA" not in rooms.rooms and rooms.chat_bytes == b.chat_bytes
    rooms.keep_chat(a, chat("late", 6))
    assert list(a.chat) == [] and rooms.chat_bytes == b.chat_bytes


def test_malformed_chat_gets_invalid_message_and_the_socket_stays_open() -> None:
    host = create()
    with connected(host) as (ws, _):
        ok = chat_send("hi", 1)
        bad = [
            ok | {"text": "a\tb"},  # control character (the background turns tabs to spaces)
            ok | {"text": "a\x00b"},
            ok | {"text": ""},
            ok | {"text": 5},
            ok | {"movieTime": -1},
            ok | {"movieTime": "42:10"},
            {k: v for k, v in ok.items() if k != "movieTime"},
            {k: v for k, v in ok.items() if k != "clientId"},
            ok | {"clientId": "a b"},
            ok | {"clientId": "x" * 65},
            ok | {"fromId": "someone-else"},
        ]
        for payload in bad:
            got = send(ws, "CHAT.SEND", payload)
            assert [(m["type"], m["payload"]["code"]) for m in got] == [
                ("SYS.ERROR", "invalid_message")
            ], payload
        assert chats(say(ws, "still here")) == ["still here"]
        assert [m["text"] for m in main.rooms.rooms[host["code"]].chat] == ["still here"]


def test_a_retry_is_never_kept_twice() -> None:
    """The same clientId from the same person: the room answers the sender with the message
    it already has, and nobody else hears it again."""
    host = create()
    guest = join(host["code"])
    with connected(host) as (hws, _), connected(guest) as (gws, _):
        until_pong(hws)  # the guest's arrival
        first = [m["payload"] for m in say(hws, "hi", client_id="c-1")]
        again = [m["payload"] for m in say(hws, "hi", client_id="c-1")]
        assert again == first and first[0]["clientId"] == "c-1"
        assert chats(until_pong(gws)) == ["hi"]  # once
        # A retry doesn't spend the rate limit; another person's same clientId is theirs.
        for _ in range(5):
            say(hws, "hi", client_id="c-1")
        assert chats(say(hws, "next")) == ["next"]
        assert chats(say(gws, "mine", client_id="c-1")) == ["next", "mine"]
    texts = [m["text"] for m in main.rooms.rooms[host["code"]].chat]
    assert texts == ["hi", "next", "mine"]


def test_a_room_has_a_chat_budget_on_top_of_each_person(monkeypatch: pytest.MonkeyPatch) -> None:
    """Several people (or one person's many tickets) can't flush the history in seconds."""
    assert config.CHAT_ROOM_PER_10S == 20
    monkeypatch.setattr(main, "room_chat_limiter", main.Limiter(6, 10))
    host = create()
    tickets = [host] + [join(host["code"], f"P{i}") for i in range(3)]
    with contextlib.ExitStack() as stack:
        sockets = [stack.enter_context(connected(t))[0] for t in tickets]
        for ws in sockets:
            for _ in range(2):
                say(ws, "spam")  # 8 sends, 2 each: within everyone's own limit
        assert len(main.rooms.rooms[host["code"]].chat) == 6
        assert refusal(say(sockets[0], "more"))["reason"] == "rate_limited"


def test_a_refusal_echoes_at_most_500_characters_to_the_sender_only() -> None:
    host = create()
    guest = join(host["code"])
    with connected(host) as (hws, _), connected(guest) as (gws, _):
        huge = "x" * 5000
        until_pong(hws)  # the guest's arrival
        got = say(hws, huge, client_id="big")
        assert [m["payload"] for m in got] == [
            {"reason": "too_long", "text": "x" * 500, "clientId": "big"}
        ]
        assert until_pong(gws) == []
        # A malformed clientId can't be echoed; the refusal still comes.
        hws.send_json(msg("CHAT.SEND", chat_send(huge) | {"clientId": "not ok"}))
        (refused,) = [m["payload"] for m in until_pong(hws)]
        assert refused == {"reason": "too_long", "text": "x" * 500}


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
                ws.send_json(msg("CHAT.SEND", chat_send("let me in")))
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
    names = ("uvicorn.error", "uvicorn.access", "uvicorn.asgi")
    levels = {name: logging.getLogger(name).level for name in names}  # uvicorn sets them
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
            # The text last in each frame, where a shortened frame line would show it.
            for text, answer in (
                ("hi-secret", "CHAT.MESSAGE"),
                ("no-secret" + "e" + chr(0x301) * 9, "CHAT.REJECTED"),
            ):
                payload = {k: v for k, v in chat_send(text).items() if k != "text"}
                ws.send(json.dumps(msg("CHAT.SEND", payload | {"text": text})))
                assert json.loads(ws.recv(timeout=5))["type"] == answer
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        for name, level in levels.items():
            logging.getLogger(name).setLevel(level)
    # Everything but this test's own client library.
    server_logs = [r for r in caplog.records if r.name != "websockets.client"]
    # Captured: the socket's own lines are there, only the frames are not.
    assert any("[accepted]" in r.getMessage() for r in server_logs)
    logged = "\n".join(r.getMessage() for r in server_logs)
    assert "secret" not in logged
    # Nor the room token from the socket's URL (CLAUDE.md §6).
    assert host["token"] not in logged and "token=[redacted]" in logged


def test_the_access_log_never_shows_a_token() -> None:
    """uvicorn's access formatter unpacks the record's arguments, so they keep their shape."""
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:1", "GET", "/ws/rooms/ABCDEF?token=s3cr3t-T0k_en&x=1", "1.1", 101),
        None,
    )
    for f in logging.getLogger("uvicorn.access").filters:
        f.filter(record)
    line = AccessFormatter("%(message)s", use_colors=False).format(record)
    assert "s3cr3t" not in line and "token=[redacted]&x=1" in line
