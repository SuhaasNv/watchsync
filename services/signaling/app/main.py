"""HTTP and WebSocket entry points. Room logic lives in rooms.py."""

import asyncio
import contextlib
import json
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, PlainTextResponse, Response

from . import config, join_page
from .protocol import is_client_message, is_create_request, message, now_ms
from .ratelimit import Limiter
from .rooms import Participant, Room, RoomError, rooms


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Every minute: end rooms empty past the expiry and forget idle rate-limit keys, so
    names and titles leave memory on time even with no other traffic (BUG-011)."""

    async def sweeper() -> None:
        while True:
            await asyncio.sleep(60)
            rooms.sweep()
            for limiter in (create_limiter, join_limiter, message_limiter, connect_limiter):
                limiter.prune()

    task = asyncio.create_task(sweeper())
    yield
    task.cancel()


# No public API docs in production (security audit F2).
PROD = config.ENVIRONMENT == "production"
app = FastAPI(
    title="WatchSync room service",
    version=config.VERSION,
    lifespan=lifespan,
    docs_url=None if PROD else "/docs",
    redoc_url=None if PROD else "/redoc",
    openapi_url=None if PROD else "/openapi.json",
)
create_limiter = Limiter(config.CREATE_PER_MINUTE, 60)
join_limiter = Limiter(config.JOIN_PER_MINUTE, 60)
message_limiter = Limiter(config.MESSAGES_PER_10S, 10)
connect_limiter = Limiter(config.CONNECTS_PER_MINUTE, 60)
TRY_LATER = {"Retry-After": "60"}
# Close codes the extension acts on: 1008 = room or token gone (stop), 4000 = replaced by a
# newer connection of the same person (stop), anything else = network trouble (reconnect).
REPLACED = 4000
FLOODED = 4001  # too many messages for too long; the extension reconnects with backoff
FLOOD_LIMIT = 100
ERROR_STATUS = {"not_found": 404, "room_ended": 410, "room_full": 409, "busy": 503}
# A player that shows its ad in a separate video pauses the film first, and the ad is seen
# up to a poll later; a pause this recent from the same person was the ad's.
AD_PAUSE_MS = 2000
sockets: dict[str, WebSocket] = {}


def client_ip(request: Request | WebSocket) -> str:
    real = request.headers.get("x-real-ip")
    if config.TRUST_PROXY and real:
        return real
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers.setdefault("Content-Security-Policy", join_page.CSP)
    if PROD:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


async def read_name(request: Request) -> str:
    """The display name from a create or join body; 413, 415 or 422 on anything else."""
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        # Also forces a CORS preflight, so other sites can't post here (no CORS allowed).
        raise HTTPException(415, "Send JSON.")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > config.MAX_BODY_BYTES:
        raise HTTPException(413, "Request too large.")
    body = b""
    async for chunk in request.stream():  # never hold more than the cap (BUG-012)
        body += chunk
        if len(body) > config.MAX_BODY_BYTES:
            raise HTTPException(413, "Request too large.")
    try:
        data = json.loads(body, parse_constant=reject_constant)
    except ValueError:
        data = None
    if not is_create_request(data):
        raise HTTPException(422, "A name of 1 to 30 characters is required.")
    name: str = data["name"].strip()
    return name or "Guest"


def reject_constant(name: str) -> None:
    """JSON allows no NaN or Infinity, but Python's parser does; refuse them (BUG-008)."""
    raise ValueError(f"{name} is not allowed")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": config.VERSION}


@app.post("/api/v1/rooms", status_code=201)
async def create_room(request: Request) -> dict[str, str]:
    if not create_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many rooms created. Try again in a minute.", TRY_LATER)
    try:
        return rooms.create(await read_name(request))
    except RoomError as e:
        raise HTTPException(ERROR_STATUS[e.code], e.message, TRY_LATER) from e


@app.get("/j/{code}", response_class=HTMLResponse)
def invite(code: str) -> HTMLResponse:
    page = join_page.render(code)
    if page is None:
        return HTMLResponse(join_page.not_found(), status_code=404)
    return HTMLResponse(page)


@app.get("/privacy", response_class=HTMLResponse)
def privacy() -> HTMLResponse:
    return HTMLResponse(join_page.privacy())


@app.get("/terms", response_class=HTMLResponse)
def terms() -> HTMLResponse:
    return HTMLResponse(join_page.terms())


@app.get("/robots.txt", response_class=PlainTextResponse)
def robots() -> str:
    # Invite links are private; nothing here belongs in search results.
    return "User-agent: *\nDisallow: /\n"


@app.post("/api/v1/rooms/{code}/join", status_code=201)
async def join_room(code: str, request: Request) -> dict[str, str]:
    # Every attempt counts, including wrong codes, so codes cannot be guessed.
    if not join_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many join attempts. Try again in a minute.", TRY_LATER)
    name = await read_name(request)
    try:
        return rooms.join(code.upper(), name)
    except RoomError as e:
        raise HTTPException(ERROR_STATUS[e.code], e.message) from e


async def send(p: Participant, type_: str, payload: dict[str, Any]) -> None:
    ws = sockets.get(p.id)
    if ws is not None:
        # A peer that just dropped must never break the sender's handler (BUG-010); the
        # peer's own handler cleans up after it.
        with contextlib.suppress(Exception):
            await ws.send_json(message(type_, payload))


async def broadcast(
    room: Room, type_: str, payload: dict[str, Any], skip: str | None = None
) -> None:
    for p in list(room.participants.values()):
        if p.id != skip and p.connected:
            await send(p, type_, payload)


async def handle(room: Room, p: Participant, msg: dict[str, Any]) -> None:
    payload = msg["payload"]
    if msg["type"] == "SYS.PING":
        await send(p, "SYS.PONG", {"t1": payload["t1"], "serverTime": now_ms()})
    elif msg["type"] == "PRESENCE.UPDATE":
        media = payload["media"]
        room_title = room.media["titleId"] if room.media else None
        # Straight from the room's title to another one of the same show: the next episode.
        # A different show (say, a film the service autoplays after the credits) is a new
        # title, so friends are asked (BUG-019). Unknown names count as the same show.
        shows = (show(media), show(room.media)) if media and room.media else (None, None)
        same_show = None in shows or shows[0] == shows[1]
        straight = room_title is not None and p.title_id == room_title and same_show
        # Came from the room's title, maybe through the service's browse page (BUG-014).
        was_with_room = room_title is not None and p.last_title_id == room_title
        p.service = payload["service"]
        p.following = payload["following"]
        p.title_id = media["titleId"] if media else None
        p.title_name = media["titleName"] if media else None
        if media is not None:
            p.last_title_id = media["titleId"]
        await broadcast(room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "updated"})
        # Netflix shows the title text only with its controls, so the first report can come
        # without a name; fill it in from a later report of the same title (BUG-025).
        if (
            media is not None
            and room.media is not None
            and media["titleId"] == room.media["titleId"]
            and media["titleName"]
            and not room.media.get("titleName")
        ):
            room.media = {**room.media, "titleName": media["titleName"]}
        # The room takes the first title anyone opens, then moves with whoever was watching
        # with it and opened another title. People watching on their own never move it.
        moves = media is not None and p.following and media["titleId"] != room_title
        if moves and (room_title is None or was_with_room):
            room.media = media
            # The next episode starts from the top for everyone; arriving followers catch up
            # to this clock (US-020). A newly picked title keeps no clock: its opener may be
            # resuming mid-film and publishes their position instead.
            room.playback = (
                {
                    "status": "playing",
                    "position": 0,
                    "rate": 1,
                    "updatedAt": now_ms(),
                    "titleId": media["titleId"],
                }
                if straight
                else None
            )
            how = "next" if straight else "new"
            change = {"media": media, "byId": p.id, "byName": p.name, "how": how}
            await broadcast(room, "ROOM.MEDIA", change)
    elif msg["type"] == "PLAYBACK.UPDATE":
        action = payload["action"]
        if room.held and action == "play":
            # Someone chose to go on: watch without whoever the room was waiting for.
            room.held = False
            room.skip_hold |= {x.id for x in room.holding()}
        if room.start is not None:
            await cancel_start(room)
        now = now_ms()
        if action == "pause":
            room.paused_by = (p.id, now)
        elif payload["status"] == "playing":
            room.paused_by = None
        room.playback = {
            "status": payload["status"],  # the sender's real state (BUG-005)
            "position": payload["position"],
            "rate": payload["rate"],
            "updatedAt": now,
            "titleId": payload["titleId"],
        }
        state = {
            "playback": room.playback,
            "action": action,
            "byId": p.id,
            "byName": p.name,
            "serverTime": now,
        }
        await broadcast(room, "PLAYBACK.STATE", state, skip=p.id)
    elif msg["type"] == "HOLD.UPDATE":
        await hold_update(room, p, payload["reason"], payload["position"], payload["adLeft"])
    elif msg["type"] == "START.REQUEST":
        await start_request(room, p, payload["position"], payload["titleId"])
    elif msg["type"] == "START.READY" and room.start is not None:
        room.start["ready"].add(p.id)
        await start_progress(room)
    elif msg["type"] == "START.FORCE" and room.start is not None:
        await start_go(room)


def show(media: dict[str, Any]) -> str | None:
    """The show a title belongs to, from its name: "Dark, S1:E3, …" or "Panchayat S3 E2"
    give "dark" and "panchayat". Prime episodes share a detail ID before the colon."""
    if media["service"] == "prime":
        return str(media["titleId"]).split(":")[0]
    name = media.get("titleName")
    if not name:
        return None
    base = re.split(r",|\s+S(?:eason)?\s*\d+", name, maxsplit=1, flags=re.IGNORECASE)[0]
    return base.strip().lower() or None


def set_playback(room: Room, status_: str, position: float, at: float) -> dict[str, Any]:
    title = room.playback["titleId"] if room.playback else None
    room.playback = {
        "status": status_,
        "position": position,
        "rate": 1,
        "updatedAt": at,
        "titleId": title,
    }
    return room.playback


async def room_says(room: Room, action: str, by: Participant, skip: str | None = None) -> None:
    now = now_ms()
    state = {
        "playback": room.playback,
        "action": action,
        "byId": by.id,
        "byName": by.name,
        "serverTime": now,
    }
    await broadcast(room, "PLAYBACK.STATE", state, skip=skip)


async def hold_update(
    room: Room, p: Participant, reason: str | None, position: float, ad_left: float | None
) -> None:
    """Nobody gets left behind (UC-042): wait while someone buffers or watches an ad."""
    p.hold = reason
    p.ad_left = ad_left if reason == "ad" else None
    if reason is None:
        room.skip_hold.discard(p.id)
    await broadcast(room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "updated"})
    playing = room.playback is not None and room.playback["status"] == "playing"
    on_title = room.playback is not None and room.playback["titleId"] == p.title_id
    paused_for_ad = (
        reason == "ad"
        and room.paused_by is not None
        and room.paused_by[0] == p.id
        and now_ms() - room.paused_by[1] < AD_PAUSE_MS
    )
    if reason and not room.held and (playing or paused_for_ad) and on_title and p in room.holding():
        room.held = True
        room.paused_by = None
        set_playback(room, "paused", position, now_ms())
        # Everyone hears it, the holder too: their copy of the room's clock must say paused,
        # or they play on alone if the room is still waiting for someone else when they're back.
        await room_says(room, "pause", p)
    else:
        await release_if_clear(room, p)


async def release_if_clear(room: Room, by: Participant) -> None:
    """Resume everyone together once nobody is being waited for."""
    if room.held and not room.holding() and room.playback is not None:
        room.held = False
        set_playback(room, "playing", room.playback["position"], now_ms())
        await room_says(room, "play", by)


async def start_request(room: Room, p: Participant, position: float, title_id: str | None) -> None:
    room.start = {"by": p.name, "position": position, "titleId": title_id, "ready": set()}
    set_playback(room, "paused", position, now_ms())
    if room.playback is not None:
        room.playback["titleId"] = title_id
    await start_progress(room)


async def start_progress(room: Room) -> None:
    start = room.start
    if start is None:
        return
    waiting = [x for x in room.eligible(start["titleId"]) if x.id not in start["ready"]]
    if not waiting:
        await start_go(room)
        return
    await broadcast(room, "START.STATE", start_state(room, "preparing", [x.name for x in waiting]))


async def start_go(room: Room) -> None:
    """Everyone plays at one server moment, 3 s from now, after a 3-2-1."""
    start = room.start
    if start is None:
        return
    room.start = None
    start_at = now_ms() + 3000
    set_playback(room, "playing", start["position"], start_at)
    state = {
        "phase": "go",
        "byName": start["by"],
        "position": start["position"],
        "titleId": start["titleId"],
        "notReady": [],
        "startAt": start_at,
    }
    await broadcast(room, "START.STATE", state)


async def cancel_start(room: Room) -> None:
    state = start_state(room, "cancelled", [])
    room.start = None
    await broadcast(room, "START.STATE", state)


def start_state(room: Room, phase: str, not_ready: list[str]) -> dict[str, Any]:
    start = room.start or {}
    return {
        "phase": phase,
        "byName": start.get("by", "Someone"),
        "position": start.get("position", 0),
        "titleId": start.get("titleId"),
        "notReady": not_ready,
        "startAt": None,
    }


@app.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    if not connect_limiter.allow(client_ip(ws)):
        await ws.accept()
        await ws.close(code=status.WS_1013_TRY_AGAIN_LATER)  # the extension backs off
        return
    found = rooms.authenticate(code, ws.query_params.get("token", ""))
    if found is None:
        # Accept first: a close before accept reaches browsers as 1006, which looks like a
        # network drop and makes the extension retry forever (BUG-009).
        await ws.accept()
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    room, p = found
    await ws.accept()
    old = sockets.get(p.id)
    sockets[p.id] = ws
    if old is not None:  # the same person reconnected (network change, restart): newest wins
        await old.close(code=REPLACED)
    p.connected = True
    room.empty_since = None
    await send(p, "ROOM.STATE", room.snapshot(p.id))
    await broadcast(
        room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "joined"}, skip=p.id
    )
    left = False
    dropped = 0
    try:
        while True:
            raw = await ws.receive()
            if raw["type"] == "websocket.disconnect":
                break
            try:
                msg = json.loads(raw.get("text") or "", parse_constant=reject_constant)
            except ValueError:  # not JSON, NaN/Infinity (BUG-008), or a binary frame
                msg = None
            if not message_limiter.allow(p.id):
                dropped += 1
                if dropped > FLOOD_LIMIT:  # sustained flooding: cut the connection
                    await ws.close(code=FLOODED)
                    break
                await send(
                    p, "SYS.ERROR", {"code": "rate_limited", "message": "Slow down a little."}
                )
                continue
            if not is_client_message(msg):
                await send(
                    p, "SYS.ERROR", {"code": "invalid_message", "message": "Unknown message."}
                )
                continue
            if msg["type"] == "ROOM.LEAVE":
                left = True
                rooms.leave(room, p)
                event = {"participant": p.public() | {"connected": False}, "event": "left"}
                await broadcast(room, "ROOM.PARTICIPANT", event, skip=p.id)
                await release_if_clear(room, p)
                await ws.close(code=status.WS_1000_NORMAL_CLOSURE)
                break
            await handle(room, p, msg)
    except WebSocketDisconnect:
        pass
    finally:
        if sockets.get(p.id) is ws:  # not replaced by a newer connection
            del sockets[p.id]
            message_limiter.forget(p.id)
            p.connected = False
            p.hold = None  # don't keep the room waiting for someone who's gone
            if not left:
                away = {"participant": p.public(), "event": "updated"}
                await broadcast(room, "ROOM.PARTICIPANT", away)
                await release_if_clear(room, p)
            if not any(x.connected for x in room.participants.values()):
                room.empty_since = now_ms()
