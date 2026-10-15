"""TURN credentials for room members (US-123). Cloudflare is faked: no test reaches the network,
and every key and token here is made up."""

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable
from email.message import Message
from io import BytesIO
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import config, main, turn
from app.protocol import is_turn_credentials
from app.ratelimit import Limiter

client = TestClient(main.app)
KEY_ID = "fake-key-id-1234"
API_TOKEN = "fake-api-token-SECRET-9876"  # noqa: S105 (a test value)
CLOUDFLARE = {
    "iceServers": [
        {"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
        {
            "urls": [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            "username": "fake-user",
            "credential": "fake-credential",
        },
    ]
}


@pytest.fixture(autouse=True)
def cloudflare(monkeypatch: pytest.MonkeyPatch) -> list[urllib.request.Request]:
    """TURN set up with fake keys, and Cloudflare answering with CLOUDFLARE; the requests made
    are collected."""
    monkeypatch.setattr(config, "CLOUDFLARE_TURN_KEY_ID", KEY_ID)
    monkeypatch.setattr(config, "CLOUDFLARE_TURN_API_TOKEN", API_TOKEN)
    monkeypatch.setattr(main, "turn_limiter", Limiter(config.TURN_PER_MINUTE, 60))
    monkeypatch.setattr(main, "turn_ip_limiter", Limiter(config.TURN_IP_PER_MINUTE, 60))
    seen: list[urllib.request.Request] = []

    class Opener:
        def open(self, req: urllib.request.Request, timeout: float) -> BytesIO:
            seen.append(req)
            return BytesIO(json.dumps(CLOUDFLARE).encode())

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: Opener())
    return seen


def fails_with(monkeypatch: pytest.MonkeyPatch, error: Callable[[], BaseException]) -> None:
    class Opener:
        def open(self, req: urllib.request.Request, timeout: float) -> BytesIO:
            raise error()

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: Opener())


def create(name: str = "Host") -> dict[str, str]:
    r = client.post("/api/v1/rooms", json={"name": name})
    assert r.status_code == 201, r.text
    body: dict[str, str] = r.json()
    return body


def ask(code: str, token: str | None) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token is not None else {}
    return client.post(f"/api/v1/rooms/{code}/turn", headers=headers)


def test_a_member_gets_credentials_for_two_hours_at_most(
    cloudflare: list[urllib.request.Request],
) -> None:
    t = create()
    r = ask(t["code"], t["token"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert is_turn_credentials(body)
    assert body["ttl"] == 7200
    assert r.headers["cache-control"] == "no-store"
    # Port 53 is left out; the rest is passed on.
    urls = [u for s in body["iceServers"] for u in s["urls"]]
    assert urls == [
        "stun:stun.cloudflare.com:3478",
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
    ]
    assert body["iceServers"][1]["username"] == "fake-user"
    # Cloudflare was asked for a 2 hour credential, with the key from the environment.
    (req,) = cloudflare
    assert req.full_url.endswith(f"/turn/keys/{KEY_ID}/credentials/generate-ice-servers")
    assert isinstance(req.data, bytes) and json.loads(req.data) == {"ttl": 7200}
    assert req.get_header("Authorization") == f"Bearer {API_TOKEN}"


def test_every_request_gets_fresh_credentials(cloudflare: list[urllib.request.Request]) -> None:
    """Nothing is cached or shared server-side: renewing asks Cloudflare again."""
    t = create()
    assert ask(t["code"], t["token"]).status_code == 200
    assert ask(t["code"], t["token"]).status_code == 200
    assert len(cloudflare) == 2


def test_a_member_of_another_room_or_no_member_is_refused(
    cloudflare: list[urllib.request.Request],
) -> None:
    mine, other = create(), create("Other")
    stranger = "x" * 40 + "." + "y" * 43
    cases = [
        ask(mine["code"], other["token"]),  # a member, but of another room
        ask(other["code"], mine["token"]),
        ask(mine["code"], stranger),  # a token this service never issued
        ask("ZZZZZZ", mine["token"]),  # a room that doesn't exist
        ask(mine["code"], "not a token"),
        ask(mine["code"], None),  # no token at all
        client.post(f"/api/v1/rooms/{mine['code']}/turn", headers={"Authorization": "Basic abc"}),
    ]
    assert [r.status_code for r in cases] == [403, 403, 403, 403, 403, 401, 401]
    assert not cloudflare  # Cloudflare is never asked for a refused request


def test_a_token_after_leaving_is_refused(cloudflare: list[urllib.request.Request]) -> None:
    host = create()
    guest = client.post(f"/api/v1/rooms/{host['code']}/join", json={"name": "Asha"}).json()
    assert ask(host["code"], guest["token"]).status_code == 200
    with client.websocket_connect(
        f"/ws/rooms/{host['code']}", subprotocols=["watchsync.v1", guest["token"]]
    ) as ws:
        ws.receive_json()
        ws.send_json({"id": "l", "type": "ROOM.LEAVE", "timestamp": 1, "payload": {}})
    assert ask(host["code"], guest["token"]).status_code == 403


def test_the_code_is_read_in_any_case() -> None:
    t = create()
    assert ask(t["code"].lower(), t["token"]).status_code == 200


def test_requests_are_rate_limited_per_person_and_per_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(main, "turn_limiter", Limiter(2, 60))
    t, other = create(), create("Other")
    assert ask(t["code"], t["token"]).status_code == 200
    assert ask(t["code"], t["token"]).status_code == 200
    r = ask(t["code"], t["token"])
    assert r.status_code == 429 and r.headers["retry-after"] == "60"
    assert ask(other["code"], other["token"]).status_code == 200  # someone else's budget
    monkeypatch.setattr(main, "turn_ip_limiter", Limiter(1, 60))
    assert ask(other["code"], other["token"]).status_code == 200
    assert ask(other["code"], "nope").status_code == 429  # strangers count against the address


def test_without_cloudflare_keys_turn_is_unavailable(
    monkeypatch: pytest.MonkeyPatch, cloudflare: list[urllib.request.Request]
) -> None:
    t = create()
    for key, value in (("CLOUDFLARE_TURN_KEY_ID", ""), ("CLOUDFLARE_TURN_API_TOKEN", "")):
        monkeypatch.setattr(config, "CLOUDFLARE_TURN_KEY_ID", KEY_ID)
        monkeypatch.setattr(config, "CLOUDFLARE_TURN_API_TOKEN", API_TOKEN)
        monkeypatch.setattr(config, key, value)
        r = ask(t["code"], t["token"])
        assert r.status_code == 503 and r.json()["detail"] == "TURN is unavailable."
    monkeypatch.setattr(config, "CLOUDFLARE_TURN_KEY_ID", "../evil?")  # not a key id
    monkeypatch.setattr(config, "CLOUDFLARE_TURN_API_TOKEN", API_TOKEN)
    assert ask(t["code"], t["token"]).status_code == 503
    assert not cloudflare


def test_a_non_member_is_refused_even_without_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "CLOUDFLARE_TURN_KEY_ID", "")
    t = create()
    assert ask(t["code"], "nope").status_code == 403
    assert ask("ZZZZZZ", t["token"]).status_code == 403


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (lambda: TimeoutError("slow"), 504),
        (lambda: urllib.error.URLError(TimeoutError("slow")), 504),
        (lambda: urllib.error.URLError("refused"), 502),
        (lambda: urllib.error.HTTPError("u", 401, "denied", Message(), None), 502),
        (lambda: OSError("reset"), 502),
    ],
)
def test_cloudflare_trouble_is_a_clear_error_and_leaks_nothing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    error: Callable[[], BaseException],
    status: int,
) -> None:
    fails_with(monkeypatch, error)
    t = create()
    with caplog.at_level(logging.DEBUG):
        r = ask(t["code"], t["token"])
    assert r.status_code == status
    assert API_TOKEN not in r.text and KEY_ID not in r.text
    assert "event=turn_failed" in caplog.text  # it is logged, without the secrets
    assert API_TOKEN not in caplog.text and KEY_ID not in caplog.text
    assert t["token"] not in caplog.text


@pytest.mark.parametrize(
    "reply",
    [
        b"not json",
        b"[]",
        b'{"iceServers": "x"}',
        b'{"iceServers": []}',
        b'{"iceServers": [{"urls": ["http://evil.example/"]}]}',
        b'{"iceServers": [{"urls": 5}]}',
        b'{"iceServers": [{"urls": ["stun:stun.cloudflare.com:53"]}]}',  # only port 53
        b" " * (turn.MAX_RESPONSE_BYTES + 1),
    ],
)
def test_an_unexpected_reply_is_an_error_and_never_passed_on(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, reply: bytes
) -> None:
    class Opener:
        def open(self, req: urllib.request.Request, timeout: float) -> BytesIO:
            return BytesIO(reply)

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: Opener())
    t = create()
    with caplog.at_level(logging.DEBUG):
        r = ask(t["code"], t["token"])
    assert r.status_code == 502
    assert "iceServers" not in caplog.text and "evil" not in caplog.text


def test_extra_fields_from_cloudflare_are_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = {"iceServers": [{"urls": ["stun:stun.cloudflare.com:3478"], "extra": "x"}], "more": 1}

    class Opener:
        def open(self, req: urllib.request.Request, timeout: float) -> BytesIO:
            return BytesIO(json.dumps(reply).encode())

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: Opener())
    t = create()
    body = ask(t["code"], t["token"]).json()
    assert body == {"iceServers": [{"urls": ["stun:stun.cloudflare.com:3478"]}], "ttl": 7200}


def test_no_redirect_is_followed() -> None:
    """A redirect would carry the token to wherever it points."""
    handler = turn._NoRedirect()
    req = urllib.request.Request("https://rtc.live.cloudflare.com/x")  # noqa: S310
    assert handler.redirect_request(req, None, 302, "Found", {}, "https://evil.example/") is None
