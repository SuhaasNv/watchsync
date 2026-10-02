"""Rooms held in memory (DEC-003). One process owns every room."""

import secrets
from dataclasses import dataclass, field
from typing import Any

from . import config
from .protocol import now_ms

# 32 symbols, no 0/O/1/I, matches the protocol's RoomCode pattern.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class RoomError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Participant:
    id: str
    name: str
    token: str
    service: str = "none"
    title_id: str | None = None
    # The last title this person had open, kept while they browse between titles (BUG-014).
    last_title_id: str | None = None
    title_name: str | None = None
    following: bool = True
    connected: bool = False
    hold: str | None = None  # "buffering" or "ad": the room waits for this person
    ad_left: float | None = None
    # Came back after leaving or closing the browser: the room hears "rejoined" once.
    rejoined: bool = False

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "service": self.service,
            "titleId": self.title_id,
            "titleName": self.title_name,
            "following": self.following,
            "connected": self.connected,
            "hold": self.hold,
            "adLeft": self.ad_left,
        }


@dataclass
class Room:
    code: str
    participants: dict[str, Participant] = field(default_factory=dict)
    media: dict[str, Any] | None = None
    playback: dict[str, Any] | None = None
    empty_since: float | None = None
    # Nobody gets left behind (UC-042): paused for someone's buffering or ad.
    held: bool = False
    # People the others chose to watch without; their hold no longer pauses the room.
    skip_hold: set[str] = field(default_factory=set)
    # Who last paused the room and when (server ms), so a pause made by an ad can hold it.
    paused_by: tuple[str, float] | None = None
    # Start together in progress: who asked, where, and who is ready.
    start: dict[str, Any] | None = None
    # Names of people who left, so the same name joining again counts as a rejoin.
    gone: set[str] = field(default_factory=set)
    # Who last sent a playback change, and when (ms), to spot two changes crossing.
    last_change: tuple[str, float] | None = None

    def holding(self) -> list[Participant]:
        return [
            x
            for x in self.participants.values()
            if x.hold and x.connected and x.following and x.id not in self.skip_hold
        ]

    def eligible(self, title_id: str | None) -> list[Participant]:
        """Who a Start together waits for: connected, following, on the title."""
        return [
            x
            for x in self.participants.values()
            if x.connected and x.following and x.title_id == title_id
        ]

    def snapshot(self, you: str) -> dict[str, Any]:
        return {
            "code": self.code,
            "you": you,
            "participants": [p.public() for p in self.participants.values()],
            "media": self.media,
            "playback": self.playback,
            "serverTime": now_ms(),
        }


class Rooms:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.tokens: dict[str, tuple[str, str]] = {}
        # Codes of rooms that ended, so a late joiner hears "ended" rather than "not found".
        self.ended: dict[str, float] = {}

    def sweep(self, now: float | None = None) -> None:
        """Drop rooms that have had nobody connected for ROOM_IDLE_EXPIRY_SECONDS."""
        now = now_ms() if now is None else now
        limit = config.ROOM_IDLE_EXPIRY_SECONDS * 1000
        for code, room in list(self.rooms.items()):
            if room.empty_since is not None and now - room.empty_since > limit:
                for p in room.participants.values():
                    self.tokens.pop(p.token, None)
                del self.rooms[code]
                self.ended[code] = now
        for code, at in list(self.ended.items()):
            if now - at > 24 * 3600 * 1000:
                del self.ended[code]

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(6))
            if code not in self.rooms and code not in self.ended:
                return code

    def _add(self, room: Room, name: str) -> dict[str, str]:
        # Someone of this name whose browser closed is coming back: take their place (and
        # their id, so everyone's list swaps the row instead of showing them twice).
        stale = next(
            (x for x in room.participants.values() if x.name == name and not x.connected), None
        )
        if len(room.participants) - (stale is not None) >= config.MAX_PARTICIPANTS:
            raise RoomError("room_full", "This room is full.")
        if stale is not None:
            room.participants.pop(stale.id)
            self.tokens.pop(stale.token, None)
            room.skip_hold.discard(stale.id)
        p = Participant(
            id=stale.id if stale else secrets.token_hex(8),
            name=name,
            token=secrets.token_urlsafe(32),
            rejoined=stale is not None or name in room.gone,
        )
        room.gone.discard(name)
        room.participants[p.id] = p
        self.tokens[p.token] = (room.code, p.id)
        return {"code": room.code, "token": p.token, "participantId": p.id}

    def create(self, name: str) -> dict[str, str]:
        self.sweep()
        if len(self.rooms) >= config.MAX_ROOMS:
            raise RoomError("busy", "WatchSync is busy. Try again in a few minutes.")
        room = Room(code=self._new_code(), empty_since=now_ms())
        self.rooms[room.code] = room
        return self._add(room, name)

    def join(self, code: str, name: str) -> dict[str, str]:
        self.sweep()
        room = self.rooms.get(code)
        if room is None:
            if code in self.ended:
                raise RoomError("room_ended", "This room has ended.")
            raise RoomError("not_found", "No room has that code.")
        return self._add(room, name)

    def leave(self, room: Room, p: Participant, end_if_empty: bool = True) -> None:
        """Remove someone for good: their token stops working. The last one out ends the room,
        unless end_if_empty is off: then the room waits, empty, for a rejoin until it expires."""
        room.participants.pop(p.id, None)
        self.tokens.pop(p.token, None)
        room.skip_hold.discard(p.id)
        room.gone.add(p.name)
        if not room.participants and end_if_empty:
            del self.rooms[room.code]
            self.ended[room.code] = now_ms()

    def authenticate(self, code: str, token: str) -> tuple[Room, Participant] | None:
        self.sweep()
        found = self.tokens.get(token)
        if found is None or found[0] != code or code not in self.rooms:
            return None
        room = self.rooms[code]
        return room, room.participants[found[1]]


rooms = Rooms()
