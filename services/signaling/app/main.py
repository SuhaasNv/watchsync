"""HTTP and WebSocket entry points. Room logic lives in rooms.py."""

from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.responses import HTMLResponse

from . import config, join_page
from .protocol import is_client_message, is_create_request, message, now_ms
from .ratelimit import Limiter
from .rooms import Participant, Room, RoomError, rooms

app = FastAPI(title="WatchSync room service", version=config.VERSION)
create_limiter = Limiter(config.CREATE_PER_MINUTE, 60)
join_limiter = Limiter(config.JOIN_PER_MINUTE, 60)
ERROR_STATUS = {"not_found": 404, "room_ended": 410, "room_full": 409}
sockets: dict[str, WebSocket] = {}


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": config.VERSION}


@app.post("/api/v1/rooms", status_code=201)
async def create_room(request: Request) -> dict[str, str]:
    if not create_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many rooms created. Try again in a minute.")
    body = await request.json()
    if not is_create_request(body):
        raise HTTPException(422, "A name of 1 to 30 characters is required.")
    return rooms.create(body["name"].strip() or "Guest")


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
    body = await request.json()
    if not is_create_request(body):
        raise HTTPException(422, "A name of 1 to 30 characters is required.")
    try:
        return rooms.join(code.upper(), body["name"].strip() or "Guest")
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
            room.media = media
            await broadcast(room, "ROOM.MEDIA", {"media": media, "byId": p.id, "byName": p.name})


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
    if old is not None:  # the same person reconnected (new tab or network change): newest wins
        await old.close(code=status.WS_1000_NORMAL_CLOSURE)
    p.connected = True
    room.empty_since = None
    await send(p, "ROOM.STATE", room.snapshot(p.id))
    await broadcast(
        room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "joined"}, skip=p.id
    )
    try:
        while True:
            msg = await ws.receive_json()
            if not is_client_message(msg):
                await send(
                    p, "SYS.ERROR", {"code": "invalid_message", "message": "Unknown message."}
                )
                continue
            await handle(room, p, msg)
    except (WebSocketDisconnect, ValueError):  # ValueError: client sent non-JSON
        pass
    finally:
        if sockets.get(p.id) is ws:
            del sockets[p.id]
            p.connected = False
            await broadcast(
                room, "ROOM.PARTICIPANT", {"participant": p.public(), "event": "updated"}
            )
            if not any(x.connected for x in room.participants.values()):
                room.empty_since = now_ms()
