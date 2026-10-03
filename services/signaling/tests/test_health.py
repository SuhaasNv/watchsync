import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app

client = TestClient(app)


def test_health_reports_version() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": "0.3.0"}


def test_socket_rejects_without_token() -> None:
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws/rooms/ABCDEF") as ws:
        ws.receive_json()
