"""Rooms survive a server update (UC-046, DEC-031): signed tokens, restore after a restart,
and the "restarting" close on shutdown."""

import asyncio
import base64
import json
import os
import signal
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from types import FrameType
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect as ws_connect

from app import config, main
from app import rooms as rooms_module
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


# Security audit (UC-046): expiry, ceilings, spent places, one spelling, token out of the URL


def signed(claims: dict[str, Any]) -> str:
    """A token this service would accept the signature of, with any claims."""
    payload = json.dumps(claims, separators=(",", ":")).encode()
    return f"{rooms_module._b64(payload)}.{rooms_module._b64(rooms_module._mac(payload))}"


def claims_for(t: dict[str, str], name: str, issued: object) -> dict[str, Any]:
    return {"c": t["code"], "p": t["participantId"], "n": name, "i": issued, "r": "00"}


def test_old_and_future_tokens_are_expired() -> None:
    now = int(time.time())
    t = {"code": "ABCDEF", "participantId": "p1"}
    fresh = read_token(signed(claims_for(t, "Asha", now - 3600)))
    assert fresh is not None and not fresh.expired
    old = read_token(signed(claims_for(t, "Asha", now - 90 * 86400)))
    assert old is not None and old.expired
    future = read_token(signed(claims_for(t, "Asha", now + 3600)))
    assert future is not None and future.expired
    for issued in (str(now), float(now), True, None):
        assert read_token(signed(claims_for(t, "Asha", issued))) is None


def test_an_old_token_never_brings_a_room_back(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    now = int(time.time())
    fresh = restart(monkeypatch)
    for issued in (now - 90 * 86400, now + 3600):
        old = signed(claims_for(host, "Suhaas", issued))
        assert refused(f"/ws/rooms/{host['code']}?token={old}") == 1008
    assert fresh.rooms == {}


def test_a_long_night_keeps_its_live_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """Expiry is for restores and retakes; a live token is checked against the room."""
    host = create()
    with client.websocket_connect(url(host)) as ws:
        ws.receive_json()
    monkeypatch.setattr(config, "TOKEN_MAX_AGE_SECONDS", -1000)  # every token is now too old
    with client.websocket_connect(url(host)) as ws:
        assert ws.receive_json()["payload"]["you"] == host["participantId"]
    body = {"name": "Suhaas", "token": host["token"]}
    again = client.post(f"/api/v1/rooms/{host['code']}/join", json=body)
    assert again.status_code == 201
    assert again.json()["participantId"] != host["participantId"]  # no retake: someone new


def test_restores_respect_the_room_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    a, b = create("Suhaas"), create("Alex")
    friend = join(a["code"], "Asha")
    fresh = restart(monkeypatch)
    monkeypatch.setattr(config, "MAX_ROOMS", 1)
    with client.websocket_connect(url(a)) as ws:
        ws.receive_json()
    assert refused(url(b)) == 1008  # full: no second room comes back
    with client.websocket_connect(url(friend)) as ws:  # into the restored room still works
        assert ws.receive_json()["payload"]["code"] == a["code"]
    assert list(fresh.rooms) == [a["code"]]


def test_restores_per_client_address_are_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    a, b = create("Suhaas"), create("Alex")
    friend = join(a["code"], "Asha")
    fresh = restart(monkeypatch)
    monkeypatch.setattr(config, "RESTORES_PER_IP", 1)
    with client.websocket_connect(url(a)) as ws:
        ws.receive_json()
    assert refused(url(b)) == 1008
    with client.websocket_connect(url(friend)) as ws:
        assert ws.receive_json()["payload"]["code"] == a["code"]
    assert list(fresh.rooms) == [a["code"]]


def test_someone_who_joined_a_restored_room_and_left_stays_gone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    host = create()
    restart(monkeypatch)
    with client.websocket_connect(url(host)) as a:
        a.receive_json()
        newcomer = join(host["code"], "Ravi")  # joins after the restart
        with client.websocket_connect(url(newcomer)) as b:
            b.receive_json()
            b.send_json(msg("ROOM.LEAVE", {}))
        assert refused(url(newcomer)) == 1008


def test_a_token_has_one_spelling() -> None:
    token = sign_token("ABCDEF", "p1", "Asha")
    body, sig = token.split(".")
    # 32 bytes in 43 characters leave 2 spare bits in the last one: flip the lowest.
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    other = sig[:-1] + alphabet[alphabet.index(sig[-1]) ^ 1]
    assert rooms_module._unb64(other) == rooms_module._unb64(sig)
    assert read_token(f"{body}.{other}") is None


def test_the_token_can_come_in_the_subprotocol_header(monkeypatch: pytest.MonkeyPatch) -> None:
    host = create()
    path = f"/ws/rooms/{host['code']}"
    with client.websocket_connect(path, subprotocols=["watchsync.v1", host["token"]]) as ws:
        assert ws.accepted_subprotocol == "watchsync.v1"  # never the token
        assert ws.receive_json()["payload"]["you"] == host["participantId"]
    for offered in (["watchsync.v1", "nope"], ["watchsync.v1"]):
        with (
            pytest.raises(WebSocketDisconnect) as e,
            client.websocket_connect(path, subprotocols=offered) as ws,
        ):
            assert ws.accepted_subprotocol == "watchsync.v1"
            ws.receive_json()
        assert e.value.code == 1008
    restart(monkeypatch)  # restores work the same way
    with client.websocket_connect(path, subprotocols=["watchsync.v1", host["token"]]) as ws:
        assert ws.receive_json()["payload"]["code"] == host["code"]


# Startup and shutdown


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


class FakeSocket:
    def __init__(self) -> None:
        self.code: int | None = None

    async def close(self, code: int = 1000) -> None:
        self.code = code


def test_shutdown_closes_sockets_with_restarting(monkeypatch: pytest.MonkeyPatch) -> None:
    ws = FakeSocket()
    monkeypatch.setattr(main, "sockets", {"p1": ws})
    before = signal.getsignal(signal.SIGTERM)

    async def run() -> None:
        async with main.lifespan(main.app):
            pass

    asyncio.run(run())
    assert ws.code == main.RESTARTING == 4002
    assert signal.getsignal(signal.SIGTERM) == before  # our SIGTERM hook was taken down


def test_sigterm_closes_sockets_before_the_server_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    """Uvicorn's own SIGTERM handler closes WebSockets with 1012: ours must run first."""
    ws = FakeSocket()
    monkeypatch.setattr(main, "sockets", {"p1": ws})
    seen: list[int | None] = []

    def server_handler(_sig: int, _frame: FrameType | None) -> None:
        seen.append(ws.code)

    old = signal.signal(signal.SIGTERM, server_handler)
    try:

        async def run() -> None:
            async with main.lifespan(main.app):
                os.kill(os.getpid(), signal.SIGTERM)
                for _ in range(100):
                    if seen:
                        break
                    await asyncio.sleep(0.01)

        asyncio.run(run())
    finally:
        signal.signal(signal.SIGTERM, old)
    assert seen == [4002]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


def test_a_real_server_closes_with_restarting_on_sigterm() -> None:
    port = free_port()
    env = os.environ | {"ROOM_SIGNING_SECRET": "r" * 32, "ENVIRONMENT": "development"}
    server = subprocess.Popen(  # noqa: S603 (fixed arguments)
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
        cwd=SERVICE,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                if httpx.get(f"{base}/health").status_code == 200:
                    break
            except httpx.TransportError:
                time.sleep(0.1)
        t = httpx.post(f"{base}/api/v1/rooms", json={"name": "Suhaas"}).json()
        offer: Any = ["watchsync.v1", t["token"]]  # the token as the extension sends it
        with ws_connect(f"ws://127.0.0.1:{port}/ws/rooms/{t['code']}", subprotocols=offer) as ws:
            assert ws.subprotocol == "watchsync.v1"
            assert json.loads(ws.recv(timeout=5))["type"] == "ROOM.STATE"
            server.send_signal(signal.SIGTERM)
            with pytest.raises(ConnectionClosed) as closed:
                ws.recv(timeout=5)
            assert closed.value.rcvd is not None and closed.value.rcvd.code == 4002
        # Uvicorn shuts down, then re-raises the signal it caught: a normal SIGTERM exit.
        assert server.wait(timeout=10) in (0, -signal.SIGTERM)
    finally:
        server.kill()
        server.wait()
