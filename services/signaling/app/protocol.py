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
BLANKS = frozenset(chr(c) for c in (0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800))
# Zero-width non-joiner and joiner: emoji sequences and some scripts need them, but only
# between two visible characters (the lead's decision, 3 October 2026).
JOINERS = frozenset((chr(0x200C), chr(0x200D)))
# Text and emoji presentation selectors: only right after a visible character.
SELECTORS = frozenset((chr(0xFE0E), chr(0xFE0F)))
MAX_MARKS = 8  # combining marks in a row; more pile up over the lines around them


def _bare(c: str | None) -> bool:
    """Nothing a joiner or selector can attach to: the start or end, a space or line break,
    a control character, a blank, or another joiner."""
    return c is None or c.isspace() or unicodedata.category(c) == "Cc" or c in BLANKS | JOINERS


def is_chat_text(text: str) -> bool:
    """Chat text the room keeps and relays: the ChatText pattern over the whole text, no
    control character but a line break, at least one visible character (a letter, number,
    punctuation or symbol that draws something; emoji are symbols), no more than MAX_MARKS
    combining marks in a row, each joiner between two characters it can join (not first,
    last or doubled), and each variation selector right after one. The extension runs the
    same check before sending (apps/extension/src/shared/chat.ts isChatText)."""
    if _chat_text.fullmatch(text) is None:
        return False
    marks = 0
    visible = False
    for i, c in enumerate(text):
        category = unicodedata.category(c)
        if category == "Cc" and c != "\n":
            return False
        before = text[i - 1] if i > 0 else None
        after = text[i + 1] if i + 1 < len(text) else None
        if c in JOINERS and (_bare(before) or _bare(after)):
            return False
        if c in SELECTORS and (_bare(before) or before in SELECTORS):
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
