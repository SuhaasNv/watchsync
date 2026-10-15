"""Voice signalling (US-055): who is in voice, set-up messages passed between two people in it,
and the rules around them. The room service only passes SDPs and ICE candidates on; no audio
ever reaches it. An older client (v0.2.x, v0.1.x) is never sent a new message type or field."""

import contextlib
import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from app import config, main
from app.protocol import LEVEL_V02, LEVEL_V03, is_server_message, sendable
from app.rooms import rooms

client = TestClient(main.app)
SCHEMAS = Path(__file__).parent / "schemas"
_old = json.loads((SCHEMAS / "protocol-v0.2.1.json").read_text())
V021 = Draft202012Validator({"$ref": "#/$defs/ServerMessage", "$defs": _old["$defs"]})

SDP = "v=0\r\no=- 1 2 IN IP4 192.168.1.20\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
OFFER = {"kind": "description", "type": "offer", "sdp": SDP}
CANDIDATES = {
    "kind": "candidates",
    "candidates": [
        {
            "candidate": "candidate:1 1 udp 1 192.168.1.20 5000 typ host",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
        }
    ],
}


def create(name: str = "Host") -> dict[str, str]:
    r = client.post("/api/v1/rooms", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def join(code: str, name: str) -> dict[str, str]:
    r = client.post(f"/api/v1/rooms/{code}/join", json={"name": name})
    assert r.status_code == 201, r.text
    ticket: dict[str, str] = r.json()
    return ticket


class Socket:
    def __init__(self, ws: Any, ticket: dict[str, str]) -> None:
        self.ws = ws
        self.id = ticket["participantId"]
        self.n = 0
        self.got: list[dict[str, Any]] = []

    def drain(self) -> list[dict[str, Any]]:
        self.n += 1
        t1 = 1000 + self.n
        self.ws.send_json({"id": "p", "type": "SYS.PING", "timestamp": 1, "payload": {"t1": t1}})
        new: list[dict[str, Any]] = []
        while True:
            m = self.ws.receive_json()
            new.append(m)
            if m["type"] == "SYS.PONG" and m["payload"]["t1"] == t1:
                self.got += new
                return new

    def of(self, type_: str) -> list[dict[str, Any]]:
        return [m for m in self.got if m["type"] == type_]

    def send(self, type_: str, payload: dict[str, Any]) -> None:
        self.ws.send_json({"id": "m", "type": type_, "timestamp": 1, "payload": payload})

    def state(self, state: str) -> None:
        self.send("VOICE.STATE", {"state": state})

    def signal(self, to: str, signal: dict[str, Any]) -> None:
        self.send("VOICE.SIGNAL", {"to": to, "signal": signal})


@contextlib.contextmanager
def connect(ticket: dict[str, str], new: bool = True) -> Iterator[Socket]:
    code, token = ticket["code"], ticket["token"]
    url = f"/ws/rooms/{code}" + ("?v=0.3.0" if new else "")
    with client.websocket_connect(url, subprotocols=["watchsync.v1", token]) as ws:
        sock = Socket(ws, ticket)
        sock.drain()
        yield sock


def voices(sock: Socket) -> dict[str, str]:
    """The last voice state this client was told for each person."""
    seen: dict[str, str] = {}
    for m in sock.got:
        if m["type"] == "ROOM.STATE":
            for x in m["payload"]["participants"]:
                seen[x["id"]] = x["voice"]
        elif m["type"] == "ROOM.PARTICIPANT":
            x = m["payload"]["participant"]
            seen[x["id"]] = x["voice"]
    return seen


def test_voice_state_reaches_everyone_and_only_new_clients_see_the_field() -> None:
    host = create("Old")  # v0.2.x
    asha_t = join(host["code"], "Asha")
    with connect(host, new=False) as old, connect(asha_t) as asha:
        asha.state("muted")
        old.drain()
        asha.drain()
        assert voices(asha)[asha.id] == "muted"  # the sender hears it too
        assert voices(asha)[old.id] == "off"
        # The older client's strict schema takes every message, and never sees the field.
        for m in old.got:
            assert V021.is_valid(m), (m["type"], [e.message for e in V021.iter_errors(m)])
        assert '"voice"' not in json.dumps(old.got)
        asha.state("live")
        asha.drain()
        assert voices(asha)[asha.id] == "live"
        asha.state("off")
        asha.drain()
        assert voices(asha)[asha.id] == "off"


def test_signals_pass_between_two_people_in_voice_and_say_who_from() -> None:
    a_t = create("Ana")
    b_t = join(a_t["code"], "Ben")
    with connect(a_t) as a, connect(b_t) as b:
        a.state("muted")
        b.state("muted")
        a.signal(b.id, OFFER)
        a.signal(b.id, CANDIDATES)
        b.signal(a.id, {"kind": "restart"})
        a.drain()
        b.drain()
        got = b.of("VOICE.SIGNAL")
        assert [m["payload"] for m in got] == [
            {"from": a.id, "signal": OFFER},
            {"from": a.id, "signal": CANDIDATES},
        ]
        assert all(is_server_message(m) for m in got)
        assert [m["payload"]["signal"] for m in a.of("VOICE.SIGNAL")] == [{"kind": "restart"}]


def test_signals_go_only_between_members_in_voice() -> None:
    a_t = create("Ana")
    b_t = join(a_t["code"], "Ben")
    c_t = join(a_t["code"], "Cy")
    other = create("Zed")  # another room
    with connect(a_t) as a, connect(b_t) as b, connect(c_t) as c, connect(other) as z:
        a.state("muted")
        b.state("muted")
        z.state("muted")
        a.signal(c.id, OFFER)  # Cy is not in voice
        a.signal(z.id, OFFER)  # not in this room
        a.signal("nobody", OFFER)
        a.signal(a.id, OFFER)  # not to yourself
        c.signal(a.id, OFFER)  # Cy is not in voice, so cannot send either
        for s in (a, b, c, z):
            s.drain()
        assert not any(s.of("VOICE.SIGNAL") for s in (a, b, c, z))
        c.state("muted")
        c.signal(a.id, OFFER)
        a.drain()
        assert [m["payload"]["from"] for m in a.of("VOICE.SIGNAL")] == [c.id]


def test_an_older_client_is_never_sent_voice_and_cannot_use_it() -> None:
    assert sendable("VOICE.SIGNAL", LEVEL_V03)
    assert not sendable("VOICE.SIGNAL", LEVEL_V02)
    assert sendable("PLAYBACK.STATE", LEVEL_V02)
    t = create("Old")
    new = join(t["code"], "New")
    with connect(t, new=False) as old, connect(new) as n:
        room = rooms.rooms[t["code"]]
        portal = client.portal
        assert portal is not None
        # Even if something asks for it, the one place every message passes drops it.
        portal.call(
            main.send, room.participants[old.id], "VOICE.SIGNAL", {"from": n.id, "signal": OFFER}
        )
        # An older client that sends voice messages anyway changes nothing and gets nothing.
        old.state("live")
        old.signal(n.id, OFFER)
        n.state("muted")
        n.signal(old.id, OFFER)
        old.drain()
        n.drain()
        assert not old.of("VOICE.SIGNAL") and not n.of("VOICE.SIGNAL")
        assert room.participants[old.id].voice == "off"
        for m in old.got:
            assert V021.is_valid(m)


def test_set_up_messages_are_size_capped_and_validated() -> None:
    a_t = create("Ana")
    b_t = join(a_t["code"], "Ben")
    with connect(a_t) as a, connect(b_t) as b:
        a.state("muted")
        b.state("muted")
        too_long = {"kind": "description", "type": "offer", "sdp": "x" * 16385}
        many = {"kind": "candidates", "candidates": CANDIDATES["candidates"] * 33}
        extra = {"kind": "restart", "note": "hi"}
        for bad in (too_long, many, extra, {"kind": "description", "type": "pranswer", "sdp": "x"}):
            a.signal(b.id, bad)
        a.send("VOICE.STATE", {"state": "loud"})
        a.drain()
        b.drain()
        assert [m["payload"]["code"] for m in a.of("SYS.ERROR")] == ["invalid_message"] * 5
        assert not b.of("VOICE.SIGNAL")


def test_voice_messages_are_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(main, "voice_limiter", main.Limiter(4, 10))
    a_t = create("Ana")
    b_t = join(a_t["code"], "Ben")
    with connect(a_t) as a, connect(b_t) as b:
        a.state("muted")
        b.state("muted")
        for _ in range(10):
            a.signal(b.id, {"kind": "restart"})
        a.drain()
        b.drain()
        assert len(b.of("VOICE.SIGNAL")) == 3  # 4 allowed in all, one went on the state


def test_the_room_holds_a_few_people_in_voice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "VOICE_MAX", 2)
    a_t = create("Ana")
    tickets = [a_t, join(a_t["code"], "Ben"), join(a_t["code"], "Cy")]
    with connect(tickets[0]) as a, connect(tickets[1]) as b, connect(tickets[2]) as c:
        for who in (a, b, c):  # one after the other: the third is refused
            who.state("muted")
            who.drain()
        a.drain()
        assert voices(a)[c.id] == "off" and voices(a)[b.id] == "muted"
        b.state("off")
        b.drain()
        c.state("muted")  # a place came free
        c.drain()
        a.drain()
        assert voices(a)[c.id] == "muted"


def test_wanting_voice_tells_older_clients_once_and_joining_a_voice_room_does_too() -> None:
    t = create("Old")
    new = join(t["code"], "New")
    with connect(t, new=False) as old, connect(new) as n:
        n.send("VOICE.WANT", {})
        n.send("VOICE.WANT", {})
        old.drain()
        n.drain()
        (notice,) = old.of("CHAT.MESSAGE")
        assert notice["payload"]["name"] == "WatchSync"
        assert V021.is_valid(notice) and not n.of("CHAT.MESSAGE")
    # Someone in voice, then an older client joins: it is told when it connects.
    t2 = create("Ana")
    ben = join(t2["code"], "Ben")
    with connect(t2) as a:
        a.state("muted")
        with connect(ben, new=False) as b:
            b.drain()
            assert [m["payload"]["clientId"] for m in b.of("CHAT.MESSAGE")] == ["update-to-talk"]


def test_set_up_messages_are_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    a_t = create("Ana")
    b_t = join(a_t["code"], "Ben")
    with connect(a_t) as a, connect(b_t) as b:
        a.state("muted")
        b.state("muted")
        a.signal(b.id, OFFER)
        b.drain()
    assert "192.168.1.20" not in caplog.text and "candidate:1" not in caplog.text
