"""Validates messages against the shared JSON Schema (DEC-006). Same file the extension uses."""

import json
import re
import time
import unicodedata
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


_chat_text = re.compile(_schema["$defs"]["ChatText"]["pattern"])


def is_chat_text(text: str) -> bool:
    """Chat text as the extension's validator reads the ChatText pattern: over the whole text.
    jsonschema searches with Python's `$`, which also matches before a final newline, so
    "hi\\n" passes it but would make every client refuse the room's history. No control
    character (Cc) either way, and at least one visible character: a letter, number,
    punctuation or symbol (emoji are symbols)."""
    return (
        _chat_text.fullmatch(text) is not None
        and not any(unicodedata.category(c) == "Cc" for c in text)
        and any(unicodedata.category(c)[0] in "LNPS" for c in text)
    )


def now_ms() -> float:
    return time.time() * 1000


def message(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": uuid.uuid4().hex, "type": type_, "timestamp": now_ms(), "payload": payload}
