"""Rooms survive a server update (UC-046, DEC-031): signed tokens, restore after a restart."""

import base64
import json
import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import config, main
from app.rooms import Rooms, read_token, sign_token

client = TestClient(main.app)
SECRET = b"s" * 32
SERVICE = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True, scope="module")
def one_loop() -> Iterator[None]:
    """Every socket's handler on one event loop, as in test_rooms.py."""
    with client:
        yield


@pytest.fixture(autouse=True)
def fixed_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """The secret a deploy keeps across restarts."""
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", SECRET)


def create(name: str = "Suhaas") -> dict[str, str]:
    r = client.post("/api/v1/rooms", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def join(code: str, name: str = "Asha") -> dict[str, str]:
    r = client.post(f"/api/v1/rooms/{code}/join", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def restart(monkeypatch: pytest.MonkeyPatch, started_ago_s: float = 0) -> Rooms:
    """What a new process holds: no rooms, no live tokens, no sockets."""
    fresh = Rooms()
    fresh.started -= started_ago_s * 1000
    monkeypatch.setattr(main, "rooms", fresh)
    monkeypatch.setattr(main, "sockets", {})
    monkeypatch.setattr(main, "away", {})
    return fresh


def url(t: dict[str, str]) -> str:
    return f"/ws/rooms/{t['code']}?token={t['token']}"


def refused(path: str) -> int:
    with pytest.raises(WebSocketDisconnect) as e, client.websocket_connect(path) as ws:
        ws.receive_json()
    return e.value.code


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def msg(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": "1", "type": type_, "timestamp": 1, "payload": payload}


MEDIA = {"service": "mock", "titleId": "ep1", "titleName": "Demo", "titleUrl": None}


def playback(position: float, status: str = "playing") -> dict[str, Any]:
    return {"status": status, "position": position, "rate": 1, "updatedAt": 5, "titleId": "ep1"}


# Tokens


def test_token_round_trip() -> None:
    claims = read_token(sign_token("ABCDEF", "p1", "Asha ✨"))
    assert claims is not None
    assert (claims.code, claims.participant_id, claims.name) == ("ABCDEF", "p1", "Asha ✨")


def test_tokens_are_distinct_for_the_same_person() -> None:
    assert sign_token("ABCDEF", "p1", "Asha") != sign_token("ABCDEF", "p1", "Asha")


def test_tampered_tokens_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    token = sign_token("ABCDEF", "p1", "Asha")
    body, sig = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    edited = b64(json.dumps({**claims, "c": "GHJKLM"}, separators=(",", ":")).encode())
    assert read_token(f"{edited}.{sig}") is None  # payload edited, signature kept
    assert read_token(token[:-1]) is None  # truncated signature
    assert read_token(token[: len(body)]) is None  # signature missing
    assert read_token(f"{body[:-2]}.{sig}") is None  # truncated payload
    assert read_token(f"{token}.x") is None
    assert read_token("nope") is None
    assert read_token("") is None
    assert read_token(f"{b64(b'not json')}.{sig}") is None
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", b"t" * 32)
    assert read_token(token) is None  # signed with another secret


def test_join_accepts_a_signed_token_to_retake_a_place() -> None:
    host = create()
    with client.websocket_connect(url(host)) as ws:
        ws.receive_json()
    again = client.post(f"/api/v1/rooms/{host['code']}/join", json={"name": "Suhaas", **host})
    assert again.status_code == 422  # extra fields still refused
    body = {"name": "Suhaas", "token": host["token"]}
    again = client.post(f"/api/v1/rooms/{host['code']}/join", json=body)
    assert again.status_code == 201
    assert again.json()["participantId"] == host["participantId"]
    assert again.json()["token"] != host["token"]


# Restore after a restart


def test_both_come_back_to_the_same_room_after_a_restart(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create("Suhaas")
    friend = join(host["code"], "Asha")
    restart(monkeypatch)
    with client.websocket_connect(url(host)) as a:
        state = a.receive_json()
        assert state["type"] == "ROOM.STATE"
        assert state["payload"]["code"] == host["code"]
        assert state["payload"]["you"] == host["participantId"]
        assert state["payload"]["media"] is None and state["payload"]["playback"] is None
        with client.websocket_connect(url(friend)) as b:
            got = b.receive_json()["payload"]
            assert got["code"] == host["code"] and got["you"] == friend["participantId"]
            names = {p["name"]: p["connected"] for p in got["participants"]}
            assert names == {"Suhaas": True, "Asha": True}
            assert a.receive_json()["payload"]["participant"]["name"] == "Asha"
        room = main.rooms.rooms[host["code"]]
        assert room.restored and room.used


def test_restored_tokens_keep_working_like_any_other(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    restart(monkeypatch)
    with client.websocket_connect(url(host)) as ws:
        ws.receive_json()
    with client.websocket_connect(url(host)) as ws:  # reconnect: the live registry knows it
        assert ws.receive_json()["payload"]["you"] == host["participantId"]


def test_restore_refuses_forged_and_other_room_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    other = create("Alex")
    fresh = restart(monkeypatch)
    body, _ = sign_token(host["code"], "intruder", "Mallory").split(".")
    assert refused(f"/ws/rooms/{host['code']}?token={body}.{'A' * 43}") == 1008  # made-up MAC
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", b"m" * 32)
    other_key = sign_token(host["code"], "intruder", "Mallory")
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", SECRET)
    assert refused(f"/ws/rooms/{host['code']}?token={other_key}") == 1008
    assert refused(f"/ws/rooms/{host['code']}?token={other['token']}") == 1008
    assert refused(f"/ws/rooms/{host['code']}?token=") == 1008
    assert fresh.rooms == {}  # nothing created


def test_a_new_secret_ends_the_rooms(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    fresh = restart(monkeypatch)
    monkeypatch.setattr(config, "ROOM_SIGNING_SECRET", b"n" * 32)
    assert refused(url(host)) == 1008
    assert fresh.rooms == {}


def test_restore_only_soon_after_the_restart(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    fresh = restart(monkeypatch, started_ago_s=config.RESTORE_WINDOW_SECONDS + 1)
    assert refused(url(host)) == 1008
    assert fresh.rooms == {}


def test_an_ended_room_never_comes_back(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    fresh = restart(monkeypatch)
    fresh.ended[host["code"]] = main.now_ms()
    assert refused(url(host)) == 1008
    assert host["code"] not in fresh.rooms


def test_restored_then_left_cannot_restore_again(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    friend = join(host["code"], "Asha")
    fresh = restart(monkeypatch)
    with client.websocket_connect(url(host)) as a:
        a.receive_json()
        with client.websocket_connect(url(friend)) as b:
            b.receive_json()
            b.send_json(msg("ROOM.LEAVE", {}))
        assert refused(url(friend)) == 1008  # their token was revoked here
    with client.websocket_connect(url(host)) as a:
        a.receive_json()
        a.send_json(msg("ROOM.LEAVE", {}))
    assert host["code"] in fresh.ended
    assert refused(url(host)) == 1008  # the last one out ended it


def test_restore_live_room_still_needs_a_live_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """In a room that never went away, a signed but revoked token is refused as before."""
    host = create()
    friend = join(host["code"], "Asha")
    with client.websocket_connect(url(friend)) as b:
        b.receive_json()
        b.send_json(msg("ROOM.LEAVE", {"keepRoom": True}))
    assert refused(url(friend)) == 1008


# ROOM.RESTORE


def test_first_restore_sets_the_room_and_everyone_hears(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create("Suhaas")
    friend = join(host["code"], "Asha")
    restart(monkeypatch)
    with client.websocket_connect(url(host)) as a, client.websocket_connect(url(friend)) as b:
        a.receive_json()  # ROOM.STATE
        a.receive_json()  # Asha joined
        b.receive_json()  # ROOM.STATE
        before = main.now_ms()
        a.send_json(msg("ROOM.RESTORE", {"media": MEDIA, "playback": playback(2530)}))
        for ws in (a, b):
            got = ws.receive_json()
            assert got["type"] == "ROOM.STATE"
            assert got["payload"]["media"] == MEDIA
            assert got["payload"]["playback"]["position"] == 2530
            assert got["payload"]["playback"]["updatedAt"] >= before  # server time, not 5
        # The second one is too late: the room keeps the first.
        b.send_json(msg("ROOM.RESTORE", {"media": MEDIA, "playback": playback(10, "paused")}))
        b.send_json(msg("SYS.PING", {"t1": 1}))
        assert b.receive_json()["type"] == "SYS.PONG"
        room = main.rooms.rooms[host["code"]]
        assert room.playback is not None and room.playback["position"] == 2530


def test_restore_is_ignored_once_the_room_has_a_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    restart(monkeypatch)
    with client.websocket_connect(url(host)) as a:
        a.receive_json()
        update = {
            "action": "play",
            "status": "playing",
            "position": 7,
            "rate": 1,
            "titleId": "ep1",
        }
        a.send_json(msg("PLAYBACK.UPDATE", update))
        a.send_json(msg("ROOM.RESTORE", {"media": MEDIA, "playback": playback(2530)}))
        a.send_json(msg("SYS.PING", {"t1": 1}))
        assert a.receive_json()["type"] == "SYS.PONG"
        room = main.rooms.rooms[host["code"]]
        assert room.playback is not None and room.playback["position"] == 7


def test_restore_is_ignored_in_a_room_that_never_restarted() -> None:
    host = create()
    with client.websocket_connect(url(host)) as a:
        a.receive_json()
        a.send_json(msg("ROOM.RESTORE", {"media": MEDIA, "playback": playback(2530)}))
        a.send_json(msg("SYS.PING", {"t1": 1}))
        assert a.receive_json()["type"] == "SYS.PONG"
        room = main.rooms.rooms[host["code"]]
        assert room.media is None and room.playback is None


# Startup


def run_config(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    base = {k: v for k, v in os.environ.items() if k not in ("ROOM_SIGNING_SECRET", "ENVIRONMENT")}
    return subprocess.run(  # noqa: S603 (fixed arguments)
        [sys.executable, "-c", "import app.config"],
        cwd=SERVICE,
        env=base | env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )


def test_production_needs_a_signing_secret() -> None:
    missing = run_config({"ENVIRONMENT": "production"})
    assert missing.returncode != 0 and "ROOM_SIGNING_SECRET" in missing.stderr
    short = run_config({"ENVIRONMENT": "production", "ROOM_SIGNING_SECRET": "x" * 31})
    assert short.returncode != 0
    ok = run_config({"ENVIRONMENT": "production", "ROOM_SIGNING_SECRET": "x" * 32})
    assert ok.returncode == 0, ok.stderr
    assert run_config({}).returncode == 0  # development makes its own
