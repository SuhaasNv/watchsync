"""TURN credentials for voice (US-123): Cloudflare issues them, this module asks.

Cloudflare cannot scope a credential to one room, so "for that room only" is enforced here:
the route gives them only to a member of the room, one request at a time, and they expire
(config.TURN_TTL_SECONDS, 2 hours). The key id and API token come from the environment and are
never logged, returned or put in an error; nothing Cloudflare sends back is logged either.
"""

import asyncio
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any

from . import config
from .protocol import is_turn_credentials

log = logging.getLogger("watchsync.turn")
ENDPOINT = "https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
# The key id goes into a URL path: nothing but what a key id is made of.
KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
URL = re.compile(r"(?:stun|turn|turns):[A-Za-z0-9._:?=&-]{1,200}")
# Cloudflare lists port 53 too; browsers time out on it (Cloudflare docs), so it is left out.
PORT_53 = re.compile(r"^[a-z]+:[^:?]+:53(?:\?|$)")
MAX_RESPONSE_BYTES = 16 * 1024


class TurnError(Exception):
    """Why no credentials: `status` is the HTTP status the route answers with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect would carry the token to wherever it points; treat one as a failure."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> urllib.request.Request | None:
        return None


def configured() -> bool:
    return bool(
        KEY_ID.fullmatch(config.CLOUDFLARE_TURN_KEY_ID) and config.CLOUDFLARE_TURN_API_TOKEN
    )


def _post() -> bytes:
    """One blocking request to Cloudflare; run in a thread."""
    req = urllib.request.Request(  # noqa: S310 (a fixed https URL)
        ENDPOINT.format(key_id=config.CLOUDFLARE_TURN_KEY_ID),
        data=json.dumps({"ttl": config.TURN_TTL_SECONDS}).encode(),
        headers={
            "Authorization": f"Bearer {config.CLOUDFLARE_TURN_API_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(_NoRedirect)
    with opener.open(req, timeout=config.TURN_TIMEOUT_SECONDS) as res:
        body: bytes = res.read(MAX_RESPONSE_BYTES + 1)
    return body


def _clean(data: object) -> dict[str, Any] | None:
    """Only what the protocol's TurnCredentials allows, built from Cloudflare's reply field by
    field (never passed through), or None when it isn't the shape we know."""
    servers = data.get("iceServers") if isinstance(data, dict) else None
    if not isinstance(servers, list):
        return None
    clean: list[dict[str, Any]] = []
    for entry in servers:
        urls = entry.get("urls") if isinstance(entry, dict) else None
        if isinstance(urls, str):
            urls = [urls]
        if not isinstance(urls, list):
            return None
        kept = [u for u in urls if isinstance(u, str) and URL.fullmatch(u) and not PORT_53.match(u)]
        if not kept:
            continue
        item: dict[str, Any] = {"urls": kept}
        for key in ("username", "credential"):
            if isinstance(entry.get(key), str):
                item[key] = entry[key]
        clean.append(item)
    result = {"iceServers": clean, "ttl": config.TURN_TTL_SECONDS}
    return result if is_turn_credentials(result) else None


async def issue() -> dict[str, Any]:
    """Fresh credentials from Cloudflare, valid for TURN_TTL_SECONDS. Raises TurnError (503 when
    TURN isn't set up here, 504 on a timeout, 502 on anything else); the client then goes direct."""
    if not configured():
        raise TurnError(503, "TURN is unavailable.")
    try:
        raw = await asyncio.to_thread(_post)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("response too large")
        result = _clean(json.loads(raw))
        if result is None:
            raise ValueError("unexpected response")
    except (TimeoutError, urllib.error.URLError, ValueError, OSError) as e:
        if isinstance(e, TimeoutError) or (
            isinstance(e, urllib.error.URLError) and isinstance(e.reason, TimeoutError)
        ):
            log.warning("event=turn_failed reason=timeout")
            raise TurnError(504, "TURN did not answer in time.") from e
        # The class only: its text can hold the URL, and Cloudflare's reply is never logged.
        status = e.code if isinstance(e, urllib.error.HTTPError) else 0
        log.warning("event=turn_failed reason=%s status=%d", type(e).__name__, status)
        raise TurnError(502, "TURN is not working right now.") from e
    return result
