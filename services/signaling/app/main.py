"""HTTP and WebSocket entry points. Room logic lives in rooms.py."""

from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status

from . import config
from .protocol import is_client_message, is_create_request, message, now_ms
from .ratelimit import Limiter
from .rooms import Participant, Room, rooms

app = FastAPI(title="WatchSync room service", version=config.VERSION)
create_limiter = Limiter(config.CREATE_PER_MINUTE, 60)
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
    if msg["type"] == "SYS.PING":
        await send(p, "SYS.PONG", {"t1": msg["payload"]["t1"], "serverTime": now_ms()})


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
            if not any(x.connected for x in room.participants.values()):
                room.empty_since = now_ms()
