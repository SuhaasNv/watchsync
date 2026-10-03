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


# Patterns are matched over the whole text, as ECMAScript (the extension's validator) reads
# them: jsonschema searches with Python's `$`, which also matches before a final newline, so
# "Maya\n", or chat text ending in an 11th line break, would pass here and fail there.
_chat_text = re.compile(_schema["$defs"]["ChatText"]["pattern"])
_name = re.compile(_schema["$defs"]["Name"]["pattern"])
# Letters and symbols that draw nothing: Hangul fillers and the blank braille pattern.
BLANKS = frozenset("\u115f\u1160\u3164\uffa0\u2800")
MAX_MARKS = 8  # combining marks in a row; more pile up over the lines around them


def is_chat_text(text: str) -> bool:
    """Chat text the room keeps and relays: the ChatText pattern over the whole text, no
    control character but a line break, at least one visible character (a letter, number,
    punctuation or symbol that draws something; emoji are symbols), and no more than
    MAX_MARKS combining marks in a row."""
    if _chat_text.fullmatch(text) is None:
        return False
    marks = 0
    visible = False
    for c in text:
        category = unicodedata.category(c)
        if category == "Cc" and c != "\n":
            return False
        marks = marks + 1 if category in ("Mn", "Me") else 0
        if marks > MAX_MARKS:
            return False
        visible |= category[0] in "LNPS" and c not in BLANKS
    return visible


def is_name(name: str) -> bool:
    """A display name the room accepts: the Name pattern over the whole name, no control
    character, and not the product's own name, so nobody can pose as WatchSync."""
    return (
        _name.fullmatch(name) is not None
        and not any(unicodedata.category(c) == "Cc" for c in name)
        and not is_reserved_name(name)
    )


def is_reserved_name(name: str) -> bool:
    """WatchSync, in any case, width or spacing (compared after NFKC)."""
    folded = "".join(unicodedata.normalize("NFKC", name).casefold().split())
    return folded == "watchsync"


def now_ms() -> float:
    return time.time() * 1000


def message(type_: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": uuid.uuid4().hex, "type": type_, "timestamp": now_ms(), "payload": payload}
