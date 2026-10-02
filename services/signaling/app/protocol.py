"""Validates messages against the shared JSON Schema (DEC-006). Same file the extension uses."""

import json
import time
import uuid
from typing import Any

from jsonschema import Draft202012Validator

from . import config

_schema: dict[str, Any] = json.loads(config.PROTOCOL_SCHEMA.read_text())


def _validator(definition: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": f"#/$defs/{definition}", "$defs": _schema["$defs"]})


_client = _validator("ClientMessage")
_server = _validator("ServerMessage")
_create = _validator("CreateRoomRequest")
_join = _validator("JoinRoomRequest")


def is_client_message(data: Any) -> bool:
    return bool(_client.is_valid(data))


def is_server_message(data: Any) -> bool:
    return bool(_server.is_valid(data))


def is_create_request(data: Any) -> bool:
    return bool(_create.is_valid(data))


def is_join_request(data: Any) -> bool:
    return bool(_join.is_valid(data))


def now_ms() -> float:
    return time.time() * 1000


def message(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": uuid.uuid4().hex, "type": type_, "timestamp": now_ms(), "payload": payload}
