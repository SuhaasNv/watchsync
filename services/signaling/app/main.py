"""HTTP and WebSocket entry points. Room logic lives in rooms.py."""

from fastapi import FastAPI, WebSocket, status

from . import config

app = FastAPI(title="WatchSync room service", version=config.VERSION)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": config.VERSION}


@app.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str) -> None:
    # Rooms arrive in UC-003; until then every connection is unauthorised.
    await ws.close(code=status.WS_1008_POLICY_VIOLATION)
