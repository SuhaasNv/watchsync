"""HTTP and WebSocket entry points. Room logic lives in rooms.py."""

import json
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse, Response

from . import config, join_page
from .protocol import is_client_message, is_create_request, message, now_ms
from .ratelimit import Limiter
from .rooms import Participant, Room, RoomError, rooms

app = FastAPI(title="WatchSync room service", version=config.VERSION)
create_limiter = Limiter(config.CREATE_PER_MINUTE, 60)
join_limiter = Limiter(config.JOIN_PER_MINUTE, 60)
message_limiter = Limiter(config.MESSAGES_PER_10S, 10)
# Close codes the extension acts on: 1008 = room or token gone (stop), 4000 = replaced by a
# newer connection of the same person (stop), anything else = network trouble (reconnect).
REPLACED = 4000
ERROR_STATUS = {"not_found": 404, "room_ended": 410, "room_full": 409}
sockets: dict[str, WebSocket] = {}


def client_ip(request: Request) -> str:
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
    return response


async def read_name(request: Request) -> str:
    """The display name from a create or join body; 413 or 422 on anything else."""
    body = await request.body()
    if len(body) > config.MAX_BODY_BYTES:
        raise HTTPException(413, "Request too large.")
    try:
        data = json.loads(body)
    except ValueError:
        data = None
    if not is_create_request(data):
        raise HTTPException(422, "A name of 1 to 30 characters is required.")
    name: str = data["name"].strip()
    return name or "Guest"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": config.VERSION}


@app.post("/api/v1/rooms", status_code=201)
async def create_room(request: Request) -> dict[str, str]:
    if not create_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many rooms created. Try again in a minute.")
    return rooms.create(await read_name(request))


@app.get("/j/{code}", response_class=HTMLResponse)
def invite(code: str) -> HTMLResponse:
    page = join_page.render(code)
    if page is None:
        raise HTTPException(404, "That isn't a WatchSync room code.")
    return HTMLResponse(page, headers={"Content-Security-Policy": join_page.CSP})


@app.post("/api/v1/rooms/{code}/join", status_code=201)
async def join_room(code: str, request: Request) -> dict[str, str]:
    # Every attempt counts, including wrong codes, so codes cannot be guessed.
    if not join_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many join attempts. Try again in a minute.")
    name = await read_name(request)
    try:
        return rooms.join(code.upper(), name)
    except RoomError as e:
        raise HTTPException(ERROR_STATUS[e.code], e.message) from e


async def send(p: Participant, type_: str, payload: dict[str, Any]) -> None:
    ws = sockets.get(p.id)
    if ws is not None:
        try:
            await ws.send_json(message(type_, payload))
        except RuntimeError:
            pass  # socket already closing; its own handler cleans up


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
        was_with_room = room.media is not None and p.title_id == room.media["titleId"]
        p.service = payload["service"]
        p.following = payload["following"]
        p.title_id = media["titleId"] if media else None
        p.title_name = media["titleName"] if media else None
        await broadcast(room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "updated"})
        # The room takes the first title anyone opens, then moves with whoever was on the
        # room's title and opened another one (next episode). Others are asked, not moved.
        moved_on = was_with_room and room.media is not None and media is not None
        if media is not None and (
            room.media is None or (moved_on and media["titleId"] != room.media["titleId"])
        ):
            first = room.media is None
            room.media = media
            # The next episode starts from the top for everyone; arriving followers catch up
            # to this clock, not to the previous title's position (US-020). The room's first
            # title keeps no clock: its opener may be resuming mid-film.
            room.playback = (
                None
                if first
                else {
                    "status": "playing",
                    "position": 0,
                    "rate": 1,
                    "updatedAt": now_ms(),
                    "titleId": media["titleId"],
                }
            )
            await broadcast(room, "ROOM.MEDIA", {"media": media, "byId": p.id, "byName": p.name})
    elif msg["type"] == "PLAYBACK.UPDATE":
        action = payload["action"]
        now = now_ms()
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


@app.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    found = rooms.authenticate(code, ws.query_params.get("token", ""))
    if found is None:
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
    try:
        while True:
            msg = await ws.receive_json()
            if not message_limiter.allow(p.id):
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
                await ws.close(code=status.WS_1000_NORMAL_CLOSURE)
                break
            await handle(room, p, msg)
    except (WebSocketDisconnect, ValueError):  # ValueError: client sent non-JSON
        pass
    finally:
        if sockets.get(p.id) is ws:  # not replaced by a newer connection
            del sockets[p.id]
            p.connected = False
            if not left:
                away = {"participant": p.public(), "event": "updated"}
                await broadcast(room, "ROOM.PARTICIPANT", away)
            if not any(x.connected for x in room.participants.values()):
                room.empty_since = now_ms()
