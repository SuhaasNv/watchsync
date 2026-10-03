"""HTTP and WebSocket entry points. Room logic lives in rooms.py."""

import asyncio
import contextlib
import ipaddress
import json
import logging
import os
import re
import secrets
import signal
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from types import FrameType
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, join_page
from .protocol import is_client_message, is_create_request, is_join_request, message, now_ms
from .ratelimit import Limiter
from .rooms import Participant, Room, RoomError, rooms, safe_media


class NoFrameLogs(logging.Filter):
    """The WebSocket library logs every frame at DEBUG through uvicorn's logger, and a frame
    carries chat text, which is never logged at any level (DEC-032). Its debug lines never
    pass, whatever level the server runs at; its connection lines (INFO and up) still do."""

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno > logging.DEBUG or f"{os.sep}websockets{os.sep}" not in (
            record.pathname
        )


logging.getLogger("uvicorn.error").addFilter(NoFrameLogs())
logging.getLogger("websockets").setLevel(logging.INFO)  # the library's own loggers too


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Every minute: end rooms empty past the expiry and forget idle rate-limit keys, so
    names and titles leave memory on time even with no other traffic (BUG-011)."""

    async def sweeper() -> None:
        while True:
            await asyncio.sleep(60)
            rooms.sweep()
            limiters = (create_limiter, join_limiter, message_limiter, connect_limiter)
            for limiter in (*limiters, failed_join_limiter, chat_limiter):
                limiter.prune()

    task = asyncio.create_task(sweeper())
    put_back = close_first_on_sigterm()
    yield
    put_back()
    task.cancel()
    await close_for_restart()  # anything still open as the app stops (US-121)


def close_first_on_sigterm() -> Callable[[], None]:
    """A deploy stops the service with SIGTERM. Uvicorn answers it by closing every WebSocket
    with 1012 before the app's own shutdown runs, so close them with RESTARTING first, then
    hand the signal on. Returns what puts the previous handler back."""
    if threading.current_thread() is not threading.main_thread():
        return lambda: None  # signals reach only the main thread (tests run the app elsewhere)
    loop = asyncio.get_running_loop()
    previous = signal.getsignal(signal.SIGTERM)
    tasks: set[asyncio.Task[None]] = set()

    async def close_then_exit(sig: int, frame: FrameType | None) -> None:
        await close_for_restart()
        if callable(previous):
            previous(sig, frame)
        else:  # no handler before ours: the default, end the process
            put_back()
            signal.raise_signal(signal.SIGTERM)

    def start() -> None:
        tasks.add(loop.create_task(close_then_exit(signal.SIGTERM, None)))

    def on_sigterm(_sig: int, _frame: FrameType | None) -> None:
        loop.call_soon_threadsafe(start)

    def put_back() -> None:
        signal.signal(signal.SIGTERM, previous if previous is not None else signal.SIG_DFL)

    signal.signal(signal.SIGTERM, on_sigterm)
    return put_back


async def close_for_restart() -> None:
    """Tell every open connection the service is restarting, so the extension says so and
    comes straight back instead of backing off (US-121)."""

    async def close(ws: WebSocket) -> None:
        with contextlib.suppress(Exception):
            await ws.close(code=RESTARTING)

    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(asyncio.gather(*(close(ws) for ws in list(sockets.values()))), 2)


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
failed_join_limiter = Limiter(config.FAILED_JOINS_PER_MINUTE, 60)
# Per participant, not per connection: reconnecting doesn't buy a fresh budget (US-043).
chat_limiter = Limiter(config.CHAT_PER_5S, 5)
EVERYONE = "*"  # the failed-join limit is one budget for all clients
TRY_LATER = {"Retry-After": "60"}
# Close codes the extension acts on: 1008 = room or token gone (stop), 4000 = replaced by a
# newer connection of the same person (stop), 4002 = restarting (reconnect fast), anything
# else = network trouble (reconnect).
REPLACED = 4000
FLOODED = 4001  # too many messages for too long; the extension reconnects with backoff
RESTARTING = 4002  # the service is restarting (a deploy); the extension retries within seconds
# After a room comes back, how long its people's ROOM.RESTOREs are weighed (newest wins).
RESTORE_SETTLE_MS = 10_000
FLOOD_LIMIT = 100
ERROR_STATUS = {
    "not_found": 404,
    "room_ended": 410,
    "room_full": 409,
    "busy": 503,
    "too_many_rooms": 429,
}
# A player that shows its ad in a separate video pauses the film first, and the ad is seen
# up to a poll later; a pause this recent from the same person was the ad's.
AD_PAUSE_MS = 2000
sockets: dict[str, WebSocket] = {}
# Open WebSockets per client address (WS_PER_IP).
open_sockets: dict[str, int] = {}
# Per participant id: the pending "left" for someone whose connection closed.
away: dict[str, asyncio.Task[None]] = {}


def client_ip(request: Request | WebSocket) -> str:
    """The key per-client limits use: the client's address, or its /64 for IPv6, since one
    home or phone line gets a whole /64 to pick addresses from (BUG-040)."""
    real = request.headers.get("x-real-ip")
    host = real if config.TRUST_PROXY and real else None
    if host is None:
        host = request.client.host if request.client else "unknown"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network((ip, 64), strict=False))
    return str(ip)


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


async def read_body(request: Request, valid: Callable[[Any], bool]) -> dict[str, Any]:
    """A create or join body; 413, 415 or 422 on anything else."""
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
    if not valid(data):
        raise HTTPException(422, "A name of 1 to 30 characters is required.")
    body_: dict[str, Any] = data
    return body_


def name_in(body: dict[str, Any]) -> str:
    name: str = body["name"].strip()
    return name or "Guest"


def reject_constant(name: str) -> None:
    """JSON allows no NaN or Infinity, but Python's parser does; refuse them (BUG-008)."""
    raise ValueError(f"{name} is not allowed")


@app.exception_handler(StarletteHTTPException)
async def page_not_found(request: Request, exc: StarletteHTTPException) -> Response:
    """A person who opens a wrong address sees our page, not JSON; the API keeps JSON errors."""
    if exc.status_code == 404 and not request.url.path.startswith("/api/"):
        return HTMLResponse(join_page.not_found(), status_code=404)
    return await http_exception_handler(request, exc)


@app.get("/", include_in_schema=False)
def home() -> RedirectResponse:
    # join.watchsync.space on its own is someone looking for WatchSync (BUG-046).
    return RedirectResponse(config.SITE_URL, status_code=302)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": config.VERSION}


@app.post("/api/v1/rooms", status_code=201)
async def create_room(request: Request) -> dict[str, str]:
    if not create_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many rooms created. Try again in a minute.", TRY_LATER)
    try:
        return rooms.create(
            name_in(await read_body(request, is_create_request)), client_ip(request)
        )
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
    # Too many wrong codes from everyone at once: someone is guessing from many addresses.
    if failed_join_limiter.full(EVERYONE):
        raise HTTPException(429, "Too many join attempts. Try again in a minute.", TRY_LATER)
    body = await read_body(request, is_join_request)
    try:
        ticket = rooms.join(code.upper(), name_in(body), body.get("token"))
    except RoomError as e:
        if e.code == "not_found":
            failed_join_limiter.allow(EVERYONE)
        raise HTTPException(ERROR_STATUS[e.code], e.message) from e
    await end_away_namesake(rooms.rooms[ticket["code"]], ticket["participantId"])
    return ticket


async def end_away_namesake(room: Room, new_id: str) -> None:
    """A plain join under the name of someone who is away is them back after a browser
    restart, which clears the rejoin token (BUG-044): end the away row now instead of after
    its grace, and announce a rejoin (BUG-048). They still get a new place, never the old one
    (BUG-041), so at worst someone with the code ends an away friend's wait early."""
    p = room.participants[new_id]
    for x in list(room.participants.values()):
        task = away.get(x.id)
        if x is p or x.name != p.name or task is None:
            continue
        del away[x.id]
        task.cancel()
        rooms.leave(room, x, end_if_empty=False)
        room.gone.discard(x.name)
        p.rejoined = True
        await broadcast(room, "ROOM.PARTICIPANT", {"participant": x.public(), "event": "left"})
        await recheck_waits(room, x)


async def send(p: Participant, type_: str, payload: dict[str, Any]) -> None:
    ws = sockets.get(p.id)
    if ws is not None:
        # A peer that just dropped must never break the sender's handler (BUG-010); the
        # peer's own handler cleans up after it. ASCII-only JSON: a lone surrogate from a
        # name or title can't be sent as UTF-8 and would silently drop the message.
        with contextlib.suppress(Exception):
            await ws.send_text(json.dumps(message(type_, payload)))


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
        media = safe_media(payload["media"])
        room_title = room.media["titleId"] if room.media else None
        # Straight from the room's title to another one of the same show: the next episode.
        # A different show (say, a film the service autoplays after the credits) is a new
        # title, so friends are asked (BUG-019). Unknown names count as the same show.
        shows = (show(media), show(room.media)) if media and room.media else (None, None)
        same_show = None in shows or shows[0] == shows[1]
        straight = room_title is not None and p.title_id == room_title and same_show
        # Picked another title after watching here: last opened wins (DEC-030).
        picked = p.watched and media is not None and media["titleId"] != p.title_id
        p.service = payload["service"]
        p.following = payload["following"]
        p.title_id = media["titleId"] if media else None
        p.title_name = media["titleName"] if media else None
        p.media = media
        p.watched |= media is not None
        # Off the room's title or watching on their own: the room can't be waiting for this
        # person's ad or loading any more, and their tab can't say so once closed (BUG-050).
        if p.hold and (p.title_id != room_title or not p.following):
            p.hold = None
            p.ad_left = None
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
        # The room goes to the last title anyone following it picks (DEC-030); friends are
        # offered it. People watching on their own never move it, and a friend arriving on
        # another title is offered the room's instead.
        moves = media is not None and p.following and media["titleId"] != room_title
        # Once nobody here has the room's title open, it goes to whoever follows the room on
        # another title, so the order of leaving and opening doesn't matter (BUG-047).
        abandoned = room_title is not None and not any(
            x.connected and x.title_id == room_title for x in room.participants.values()
        )
        mover = p if moves and (room_title is None or picked or abandoned) else None
        if mover is None and abandoned:
            mover = next(
                (x for x in room.participants.values() if x.connected and x.following and x.media),
                None,
            )
        if mover is not None and mover.media is not None:
            media = mover.media
            straight = straight and mover is p
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
            # The old title's wait doesn't carry over to the new one (BUG-050).
            room.held = False
            room.skip_hold.clear()
            change = {"media": media, "byId": mover.id, "byName": mover.name, "how": how}
            await broadcast(room, "ROOM.MEDIA", change)
            # A Start together for the old title must not start the new one at its position.
            if room.start is not None:
                await cancel_start(room)
        await recheck_waits(room, p)
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
        # Two people acting at once cross on the wire: each applies the other's change after
        # their own, and they end up apart. When someone else changed the room just now, the
        # sender gets the result too, so everyone ends on the room's last word.
        last = room.last_change
        crossed = last is not None and last[0] != p.id and now - last[1] < 1500
        room.last_change = (p.id, now)
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
        await broadcast(room, "PLAYBACK.STATE", state, skip=None if crossed else p.id)
    elif msg["type"] == "HOLD.UPDATE":
        await hold_update(room, p, payload["reason"], payload["position"], payload["adLeft"])
    elif msg["type"] == "START.REQUEST":
        await start_request(room, p, payload["position"], payload["titleId"])
    elif msg["type"] == "START.READY" and room.start is not None:
        room.start["ready"].add(p.id)
        await start_progress(room)
    elif msg["type"] == "START.FORCE" and room.start is not None:
        await start_go(room)
    elif msg["type"] == "ROOM.RESTORE":
        await restore_room(room, payload["media"], payload["playback"], payload["knownAt"])
    elif msg["type"] == "CHAT.SEND":
        await chat_send(room, p, payload)


async def restore_room(
    room: Room, media: dict[str, Any] | None, playback: dict[str, Any] | None, known_at: float
) -> None:
    """People back in a room brought back after a restart say what it was watching and
    where (US-120). For the first RESTORE_SETTLE_MS, the most recent knowledge wins (the old
    server's time of the clock each knew), so a friend who was offline and comes back first
    can't rewind everyone; never over a change someone made here since. Everyone gets the
    room afresh and their drift check brings them together."""
    if room.restored_at is None or now_ms() - room.restored_at > RESTORE_SETTLE_MS:
        return
    if room.playback is not None and room.playback is not room.restored_playback:
        return  # someone played, paused or jumped here already: that is the room's clock now
    if room.restore_known_at is not None and known_at <= room.restore_known_at:
        return
    room.restore_known_at = known_at
    if media is not None:
        room.media = safe_media(media)
    if playback is not None:
        room.playback = {**playback, "updatedAt": now_ms()}
        room.restored_playback = room.playback
    for x in list(room.participants.values()):
        if x.connected:
            await send(x, "ROOM.STATE", room.snapshot(x.id))


async def chat_send(room: Room, p: Participant, payload: dict[str, Any]) -> None:
    """Relay a chat message to everyone, the sender too (their copy confirms delivery), and
    keep it for people who join later. Never log the text (DEC-032). A refusal echoes the
    text to the sender only, so their box can keep it."""
    text: str = payload["text"]
    if not text.strip():
        await send(p, "CHAT.REJECTED", {"reason": "invalid", "text": text})
        return
    if len(text) > config.CHAT_MAX_CHARS:  # code points, as the protocol counts
        await send(p, "CHAT.REJECTED", {"reason": "too_long", "text": text})
        return
    if not chat_limiter.allow(p.id):
        await send(p, "CHAT.REJECTED", {"reason": "rate_limited", "text": text})
        return
    chat = {
        "id": secrets.token_hex(8),
        "fromId": p.id,
        "name": p.name,
        "text": text,
        "movieTime": payload["movieTime"],
        "titleId": payload["titleId"],
        "serverTime": now_ms(),
    }
    room.chat.append(chat)
    await broadcast(room, "CHAT.MESSAGE", chat)


def overlong_chat(msg: Any) -> str | None:
    """The text of a chat message refused only for being too long, so the sender hears why
    and keeps it; anything else malformed is just an invalid message."""
    if not isinstance(msg, dict) or msg.get("type") != "CHAT.SEND":
        return None
    payload = msg.get("payload")
    text = payload.get("text") if isinstance(payload, dict) else None
    return text if isinstance(text, str) and len(text) > config.CHAT_MAX_CHARS else None


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


async def recheck_waits(room: Room, by: Participant) -> None:
    """Someone changed title, stopped following, left or dropped: stop waiting for them, in an
    ad or loading wait and in a Start together (BUG-050)."""
    await release_if_clear(room, by)
    await start_progress(room)


async def release_if_clear(room: Room, by: Participant) -> None:
    """Resume everyone together once nobody is being waited for."""
    if room.held and not room.holding() and room.playback is not None:
        room.held = False
        set_playback(room, "playing", room.playback["position"], now_ms())
        await room_says(room, "play", by)


async def start_request(room: Room, p: Participant, position: float, title_id: str | None) -> None:
    # "had": who was on the title during this start; one of them with no title closed it.
    room.start = {
        "by": p.name,
        "position": position,
        "titleId": title_id,
        "ready": set(),
        "had": set(),
    }
    set_playback(room, "paused", position, now_ms())
    if room.playback is not None:
        room.playback["titleId"] = title_id
    await start_progress(room)


async def start_progress(room: Room) -> None:
    start = room.start
    if start is None:
        return
    start["had"] |= {x.id for x in room.participants.values() if x.title_id == start["titleId"]}
    waiting = [
        x for x in room.eligible(start["titleId"], start["had"]) if x.id not in start["ready"]
    ]
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


async def leave_after_grace(room: Room, p: Participant) -> None:
    """Their browser closed (no ROOM.LEAVE arrived): after the grace period, they've left.
    The room stays, even empty, until the idle expiry, so they can rejoin."""
    await asyncio.sleep(config.AWAY_GRACE_SECONDS)
    if away.get(p.id) is asyncio.current_task():
        del away[p.id]
    # Still away, and not replaced by a rejoin under the same name (same id, new object).
    if (
        p.connected
        or rooms.rooms.get(room.code) is not room
        or room.participants.get(p.id) is not p
    ):
        return
    rooms.leave(room, p, end_if_empty=False)
    await broadcast(room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "left"})
    await recheck_waits(room, p)


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


# The extension sends its room token as a WebSocket subprotocol next to this one, so the
# token stays out of URLs and the logs that print them (security audit, UC-046).
SUBPROTOCOL = "watchsync.v1"


def socket_token(ws: WebSocket) -> tuple[str, str | None]:
    """The room token and the subprotocol to accept: from Sec-WebSocket-Protocol
    ("watchsync.v1, <token>"), else from ?token= as v0.1.x extensions send it."""
    offered = [x.strip() for x in ws.headers.get("sec-websocket-protocol", "").split(",")]
    if SUBPROTOCOL in offered:
        others = [x for x in offered if x and x != SUBPROTOCOL]
        return (others[0] if len(others) == 1 else ""), SUBPROTOCOL
    # TODO(v0.8): drop ?token= once no v0.1.x extension is left.
    return ws.query_params.get("token", ""), None


@app.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    token, subprotocol = socket_token(ws)
    # Accept first, always with the subprotocol the browser asked for (else Chrome fails the
    # handshake): a close before accept reaches browsers as 1006, which looks like a network
    # drop and makes the extension retry forever (BUG-009).
    ip = client_ip(ws)
    if open_sockets.get(ip, 0) >= config.WS_PER_IP or not connect_limiter.allow(ip):
        await ws.accept(subprotocol)
        await ws.close(code=status.WS_1013_TRY_AGAIN_LATER)  # the extension backs off
        return
    open_sockets[ip] = open_sockets.get(ip, 0) + 1
    try:
        await serve(ws, code, token, subprotocol, ip)
    finally:
        open_sockets[ip] -= 1
        if not open_sockets[ip]:
            del open_sockets[ip]


async def serve(ws: WebSocket, code: str, token: str, subprotocol: str | None, ip: str) -> None:
    found = rooms.authenticate(code, token, ip)
    if found is None:
        await ws.accept(subprotocol)
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    room, p = found
    await ws.accept(subprotocol)
    old = sockets.get(p.id)
    sockets[p.id] = ws
    if old is not None:  # the same person reconnected (network change, restart): newest wins
        await old.close(code=REPLACED)
    pending = away.pop(p.id, None)
    if pending is not None:  # back within the grace period: nobody hears they were gone
        pending.cancel()
    p.connected = True
    room.used = True
    room.empty_since = None
    await send(p, "ROOM.STATE", room.snapshot(p.id))
    await send(p, "CHAT.HISTORY", {"messages": list(room.chat)})
    arrived = "rejoined" if p.rejoined else "joined"
    p.rejoined = False
    await broadcast(
        room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": arrived}, skip=p.id
    )
    left = False
    dropped = 0
    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive(), config.WS_IDLE_SECONDS)
            except TimeoutError:  # silent too long: not a live extension (it pings)
                await ws.close(code=status.WS_1001_GOING_AWAY)
                break
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
                if (text := overlong_chat(msg)) is not None:
                    await send(p, "CHAT.REJECTED", {"reason": "too_long", "text": text})
                    continue
                await send(
                    p, "SYS.ERROR", {"code": "invalid_message", "message": "Unknown message."}
                )
                continue
            if msg["type"] == "ROOM.LEAVE":
                left = True
                rooms.leave(room, p, end_if_empty=not msg["payload"].get("keepRoom", False))
                event = {"participant": p.public() | {"connected": False}, "event": "left"}
                await broadcast(room, "ROOM.PARTICIPANT", event, skip=p.id)
                await recheck_waits(room, p)
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
                gone = {"participant": p.public(), "event": "updated"}
                await broadcast(room, "ROOM.PARTICIPANT", gone)
                await recheck_waits(room, p)
                away[p.id] = asyncio.create_task(leave_after_grace(room, p))
            if not any(x.connected for x in room.participants.values()):
                room.empty_since = now_ms()
