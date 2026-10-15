"""Rooms that mix WatchSync versions (US-132). Installs are zip only and nobody updates by
themselves: a v0.1.x or v0.2.x client must keep getting messages its own strict schema accepts.
The old schemas are frozen copies from the release tags (tests/schemas), so these tests do not
move when the live protocol does."""

import contextlib
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from app import config, main
from app.protocol import (
    LEVEL_V01,
    LEVEL_V02,
    LEVEL_V03,
    client_level,
    for_level,
    is_server_message,
)
from app.rooms import Room, rooms

client = TestClient(main.app)
SCHEMAS = Path(__file__).parent / "schemas"


def old_server_message(version: str) -> Draft202012Validator:
    schema = json.loads((SCHEMAS / f"protocol-v{version}.json").read_text())
    return Draft202012Validator({"$ref": "#/$defs/ServerMessage", "$defs": schema["$defs"]})


V011 = old_server_message("0.1.1")
V021 = old_server_message("0.2.1")


def create(name: str = "Host") -> dict[str, str]:
    r = client.post("/api/v1/rooms", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def join(code: str, name: str = "Asha", token: str | None = None) -> dict[str, str]:
    body = {"name": name, **({"token": token} if token else {})}
    r = client.post(f"/api/v1/rooms/{code}/join", json=body)
    assert r.status_code == 201, r.text
    ticket: dict[str, str] = r.json()
    return ticket


class Socket:
    """A connected client that keeps what it has been sent."""

    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self.n = 0
        self.got: list[dict[str, Any]] = []

    def drain(self) -> list[dict[str, Any]]:
        """Everything sent so far, up to the reply to a ping sent now."""
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


@contextlib.contextmanager
def connect(ticket: dict[str, str], how: str) -> Iterator[Socket]:
    """how: "v0.1" (?token=), "v0.2" or "silent" (watchsync.v1, no version), "v0.3" (with ?v=)."""
    code, token = ticket["code"], ticket["token"]
    if how == "v0.1":
        ws_cm = client.websocket_connect(f"/ws/rooms/{code}?token={token}")
    elif how == "v0.3":
        url = f"/ws/rooms/{code}?v=0.3.0"
        ws_cm = client.websocket_connect(url, subprotocols=["watchsync.v1", token])
    else:
        ws_cm = client.websocket_connect(f"/ws/rooms/{code}", subprotocols=["watchsync.v1", token])
    with ws_cm as ws:
        sock = Socket(ws)
        sock.drain()
        yield sock


def tell(room: Room) -> None:
    portal = client.portal
    assert portal is not None  # the module's client is open (conftest one_loop)
    portal.call(main.tell_to_update, room)


def play(sock: Socket) -> None:
    payload = {"action": "play", "status": "playing", "position": 12, "rate": 1, "titleId": "1"}
    sock.ws.send_json({"id": "u", "type": "PLAYBACK.UPDATE", "timestamp": 1, "payload": payload})


def everything_valid(
    sock: Socket, schema: Draft202012Validator, skip: tuple[str, ...] = ()
) -> None:
    for m in sock.got:
        if m["type"] not in skip:
            errors = [e.message for e in schema.iter_errors(m)]
            assert not errors, (m["type"], errors)


def test_client_levels() -> None:
    assert client_level(None, subprotocol=False) == LEVEL_V01  # v0.1.x: ?token=, no version
    assert client_level(None, subprotocol=True) == LEVEL_V02  # no version: v0.2.x
    for old in ("0.2.1", "0.2.0", "0.1.1", "0.0.9"):
        assert client_level(old, subprotocol=True) == LEVEL_V02, old
    for new in ("0.3.0", "0.3.0-beta.1", "0.4.2", "1.0.0", "12.0.0"):
        assert client_level(new, subprotocol=True) == LEVEL_V03, new
    # Anything that isn't a version says nothing.
    for junk in ("", "banana", "0.3", "0.3.0.0", "-1.0.0", "0.3.0 ", "0.3.0\n", "9" * 40):
        assert client_level(junk, subprotocol=True) == LEVEL_V02, junk
        assert client_level(junk, subprotocol=False) == LEVEL_V01, junk


def test_old_clients_get_the_old_participant_shape() -> None:
    """for_level cuts only what a level doesn't know and leaves the rest alone."""
    p = {"id": "a", "name": "A", "canTalk": True}
    state = {"you": "a", "participants": [p]}
    assert for_level("ROOM.STATE", state, LEVEL_V02)["participants"] == [{"id": "a", "name": "A"}]
    assert for_level("ROOM.STATE", state, LEVEL_V01)["participants"] == [{"id": "a", "name": "A"}]
    assert for_level("ROOM.STATE", state, LEVEL_V03) is state
    event = {"participant": p, "event": "joined"}
    assert for_level("ROOM.PARTICIPANT", event, LEVEL_V02)["participant"] == {
        "id": "a",
        "name": "A",
    }
    assert for_level("PLAYBACK.STATE", {"x": 1}, LEVEL_V02) == {"x": 1}
    assert p["canTalk"] is True  # the shared payload is not changed for the next recipient


def test_a_mixed_room_sends_each_client_the_shape_it_accepts() -> None:
    host = create("Old")  # v0.2.1
    new = join(host["code"], "New")  # v0.3
    ancient = join(host["code"], "Ancient")  # v0.1.1
    silent = join(host["code"], "Silent")  # says nothing, watchsync.v1: v0.2.x
    with (
        connect(host, "v0.2") as h,
        connect(new, "v0.3") as n,
        connect(ancient, "v0.1") as a,
        connect(silent, "silent") as s,
    ):
        for sock in (h, n, a, s):
            sock.drain()
        # The v0.3 client is told who can talk; everyone else gets no new field.
        (state,) = n.of("ROOM.STATE")
        assert is_server_message(state)
        can = {x["name"]: x["canTalk"] for x in state["payload"]["participants"]}
        assert can == {"Old": False, "New": True, "Ancient": False, "Silent": False}
        joined = [m for m in n.of("ROOM.PARTICIPANT") if m["payload"]["event"] == "joined"]
        assert {
            m["payload"]["participant"]["name"]: m["payload"]["participant"]["canTalk"]
            for m in joined
        } == {"Ancient": False, "Silent": False}
        # The v0.2.x clients' own schema (additionalProperties: false) takes every message.
        for sock in (h, s):
            everything_valid(sock, V021)
            assert sock.of("ROOM.STATE")
        assert h.of("ROOM.PARTICIPANT")  # the others joining
        # So does v0.1.1's, for the messages it knows (it drops chat and reactions).
        everything_valid(a, V011, skip=("CHAT.HISTORY", "CHAT.MESSAGE"))
        for sock in (h, a, s):
            assert "canTalk" not in json.dumps(sock.got)
        # It all keeps working: a play from the v0.3 client reaches the old ones.
        play(n)
        for sock in (h, a, s):
            sock.drain()
            (playing,) = sock.of("PLAYBACK.STATE")
            assert playing["payload"]["playback"]["position"] == 12
        everything_valid(h, V021)
        everything_valid(a, V011, skip=("CHAT.HISTORY", "CHAT.MESSAGE"))


def test_a_presence_update_reaches_old_and_new_clients_in_their_own_shape() -> None:
    host = create("Old")
    new = join(host["code"], "New")
    with connect(host, "v0.2") as h, connect(new, "v0.3") as n:
        presence = {"service": "netflix", "media": None, "following": True}
        n.ws.send_json({"id": "x", "type": "PRESENCE.UPDATE", "timestamp": 1, "payload": presence})
        h.drain()
        n.drain()
        (old,) = [m for m in h.of("ROOM.PARTICIPANT") if m["payload"]["event"] == "updated"]
        assert V021.is_valid(old) and "canTalk" not in old["payload"]["participant"]
        (newer,) = [m for m in n.of("ROOM.PARTICIPANT") if m["payload"]["event"] == "updated"]
        assert newer["payload"]["participant"]["canTalk"] is True and is_server_message(newer)


def test_a_cant_play_flag_reaches_only_v0_3_clients() -> None:
    """US-128: `unavailable` is new in v0.3. The v0.1.x and v0.2.x strict schemas would throw
    away the whole message, so they never get it; v0.3 clients do, and only while it is true."""
    p = {"id": "a", "name": "A", "canTalk": True, "unavailable": True}
    state = {"you": "a", "participants": [p]}
    for old in (LEVEL_V02, LEVEL_V01):
        assert for_level("ROOM.STATE", state, old)["participants"] == [{"id": "a", "name": "A"}]
    assert for_level("ROOM.PARTICIPANT", {"participant": p}, LEVEL_V02)["participant"] == {
        "id": "a",
        "name": "A",
    }
    assert for_level("ROOM.STATE", state, LEVEL_V03) is state

    host = create("Old")  # v0.2.1
    new = join(host["code"], "New")  # v0.3
    ancient = join(host["code"], "Ancient")  # v0.1.1
    with connect(host, "v0.2") as h, connect(new, "v0.3") as n, connect(ancient, "v0.1") as a:
        for sock in (h, n, a):
            sock.drain()
        media = {"service": "netflix", "titleId": "1", "titleName": None, "titleUrl": None}
        presence = {"service": "netflix", "media": media, "following": True, "unavailable": True}
        n.ws.send_json({"id": "x", "type": "PRESENCE.UPDATE", "timestamp": 1, "payload": presence})
        for sock in (h, n, a):
            sock.drain()
        (flagged,) = [m for m in n.of("ROOM.PARTICIPANT") if m["payload"]["event"] == "updated"]
        assert flagged["payload"]["participant"]["unavailable"] is True
        assert is_server_message(flagged)
        for sock in (h, a):
            assert "unavailable" not in json.dumps(sock.got)
        everything_valid(h, V021)
        everything_valid(a, V011, skip=("CHAT.HISTORY", "CHAT.MESSAGE"))
        # The next report without the flag clears it, and the field is gone again.
        clear = {"service": "netflix", "media": media, "following": True}
        n.ws.send_json({"id": "y", "type": "PRESENCE.UPDATE", "timestamp": 1, "payload": clear})
        n.drain()
        later = [m for m in n.of("ROOM.PARTICIPANT") if m["payload"]["event"] == "updated"]
        assert "unavailable" not in later[-1]["payload"]["participant"]


def test_old_clients_keep_chatting_with_new_ones() -> None:
    host = create("Old")
    new = join(host["code"], "New")
    with connect(host, "v0.2") as h, connect(new, "v0.3") as n:
        text = {"text": "hi", "movieTime": None, "titleId": None, "clientId": "c1"}
        h.ws.send_json({"id": "c", "type": "CHAT.SEND", "timestamp": 1, "payload": text})
        h.drain()
        n.drain()
        for sock in (h, n):
            assert [m["payload"]["text"] for m in sock.of("CHAT.MESSAGE")] == ["hi"]
        everything_valid(h, V021)
        n.ws.send_json(
            {
                "id": "d",
                "type": "CHAT.SEND",
                "timestamp": 1,
                "payload": text | {"clientId": "c2", "text": "yo"},
            }
        )
        h.drain()
        assert [m["payload"]["text"] for m in h.of("CHAT.MESSAGE")] == ["hi", "yo"]


def test_a_client_that_sends_no_version_is_v0_2() -> None:
    t = create()
    with connect(t, "silent") as s:
        (state,) = s.of("ROOM.STATE")
        assert V021.is_valid(state) and "canTalk" not in state["payload"]["participants"][0]
    # A version it says that is not one is no version.
    other = create()
    path = f"/ws/rooms/{other['code']}?v=banana"
    with client.websocket_connect(path, subprotocols=["watchsync.v1", other["token"]]) as ws:
        assert "canTalk" not in ws.receive_json()["payload"]["participants"][0]


def test_v0_1_joins_with_token_in_the_url_and_keeps_working() -> None:
    """v0.1.x sends ?token= and no subprotocol; its rejoin posts the old token to the join
    route. Both still work, with the shape its schema takes."""
    host = create("Host")
    with connect(host, "v0.1") as h:
        h.drain()
        everything_valid(h, V011, skip=("CHAT.HISTORY",))
        assert h.of("ROOM.STATE")[0]["payload"]["participants"][0]["connected"] is True
    again = join(host["code"], "Host", token=host["token"])  # a rejoin, as v0.1.1 posts it
    assert again["participantId"] == host["participantId"]
    with connect(again, "v0.1") as h:
        (state,) = h.of("ROOM.STATE")
        assert V011.is_valid(state) and "canTalk" not in json.dumps(state)


def test_the_room_can_tell_an_old_client_to_update_to_talk() -> None:
    """The plumbing US-055 calls: main.tell_to_update(room) when someone starts voice."""
    host = create("Old")
    new = join(host["code"], "New")
    ancient = join(host["code"], "Ancient")
    with connect(host, "v0.2") as h, connect(new, "v0.3") as n, connect(ancient, "v0.1") as a:
        room = rooms.rooms[host["code"]]
        tell(room)
        tell(room)  # once per connection
        for sock in (h, n, a):
            sock.drain()
        (notice,) = h.of("CHAT.MESSAGE")
        assert V021.is_valid(notice)
        assert notice["payload"]["name"] == "WatchSync"
        assert notice["payload"]["text"] == f"Update WatchSync to talk: {config.SITE_URL}"
        assert not n.of("CHAT.MESSAGE") and not a.of("CHAT.MESSAGE")
        assert not room.chat  # not kept: later joiners are not told
    with connect(host, "v0.2") as h:  # a new connection is told again
        tell(room)
        h.drain()
        assert len(h.of("CHAT.MESSAGE")) == 1
