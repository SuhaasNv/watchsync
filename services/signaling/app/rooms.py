"""Rooms held in memory (DEC-003). One process owns every room."""

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from collections.abc import Collection
from dataclasses import dataclass, field
from typing import Any

from . import config
from .protocol import now_ms

# 32 symbols, no 0/O/1/I, matches the protocol's RoomCode pattern.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# The title page each service's provider reports (apps/extension/src/content/providers.ts),
# whole URL: friends' browsers open it, so nothing else on the service site (BUG-039). The
# extension checks the same shapes (shared/messages.ts safeTitleUrl).
TITLE_PAGES = {
    "netflix": re.compile(r"https://www\.netflix\.com/watch/[0-9]{1,20}"),
    "prime": re.compile(
        r"https://www\.(?:primevideo\.com|amazon\.(?:com|in|co\.uk|de))(?:/gp/video)?"
        r"/detail/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}"
    ),
    "jiohotstar": re.compile(
        r"https://www\.(?:jio)?hotstar\.com(?:/[A-Za-z0-9_-]{1,200}){0,10}/[0-9]{6,20}/watch"
    ),
    "mock": re.compile(r"http://localhost:4173/watch/[A-Za-z0-9_-]{1,200}"),
}


def safe_media(media: dict[str, Any] | None) -> dict[str, Any] | None:
    """The media with its titleUrl dropped unless it is a title page of its own service. The
    title itself still counts (sync works); only the link others would open is refused."""
    if media is None or media["titleUrl"] is None:
        return media
    page = TITLE_PAGES.get(media["service"])
    if page is not None and page.fullmatch(media["titleUrl"]):
        return media
    return {**media, "titleUrl": None}


# A signed token: base64url(JSON claims) "." base64url(HMAC-SHA256 of the claims), unpadded.
TOKEN_SHAPE = re.compile(r"[A-Za-z0-9_-]{1,1024}\.[A-Za-z0-9_-]{43}")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)


def _mac(payload: bytes) -> bytes:
    return hmac.new(config.ROOM_SIGNING_SECRET, payload, hashlib.sha256).digest()


def sign_token(code: str, participant_id: str, name: str) -> str:
    """A token that says who it is for, so the room can come back after a restart (DEC-031).
    The random part keeps every ticket's token distinct, so revoking one never revokes the
    next one issued to the same person in the same second."""
    claims = {
        "c": code,
        "p": participant_id,
        "n": name,
        "i": int(time.time()),
        "r": secrets.token_hex(4),
    }
    payload = json.dumps(claims, separators=(",", ":")).encode()
    return f"{_b64(payload)}.{_b64(_mac(payload))}"


# Clocks of the old and the new process may differ a little (a deploy can move hosts).
CLOCK_TOLERANCE_SECONDS = 300


@dataclass(frozen=True)
class Claims:
    code: str
    participant_id: str
    name: str
    issued_at: int
    # Older than TOKEN_MAX_AGE_SECONDS, or issued in the future: genuine, but not to be used
    # to bring a room back or take back a place.
    expired: bool


def read_token(token: str) -> Claims | None:
    """The token's claims if this service signed it with its current secret, else None."""
    if not TOKEN_SHAPE.fullmatch(token):
        return None
    body, sig = token.split(".")
    try:
        payload, mac = _unb64(body), _unb64(sig)
    except ValueError:
        return None
    # One spelling per token: base64 that decodes the same with other spare bits is refused.
    if _b64(payload) != body or _b64(mac) != sig:
        return None
    if not hmac.compare_digest(mac, _mac(payload)):
        return None
    try:
        claims = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(claims, dict):
        return None
    code, pid, name, issued = claims.get("c"), claims.get("p"), claims.get("n"), claims.get("i")
    if not (isinstance(code, str) and isinstance(pid, str) and isinstance(name, str)):
        return None
    if not isinstance(issued, int) or isinstance(issued, bool):
        return None
    age = time.time() - issued
    expired = age > config.TOKEN_MAX_AGE_SECONDS + CLOCK_TOLERANCE_SECONDS
    expired |= age < -CLOCK_TOLERANCE_SECONDS
    return Claims(code, pid, name, issued, expired)


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
    title_name: str | None = None
    # What this person has open now, as the room would take it (BUG-047).
    media: dict[str, Any] | None = None
    # Has had a title open in this room. The first one is where they arrived, not a pick
    # that moves everyone (DEC-030).
    watched: bool = False
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
    # Who made it (client address key), whether anyone joined it, whether anyone ever
    # connected: unjoined rooms count against their maker, unused ones end early (BUG-040).
    creator: str | None = None
    joined: bool = False
    used: bool = False
    # Brought back after a restart by its people's signed tokens (US-120): by which client
    # address, everyone who has been in it since (each person once: after leaving, their
    # token is spent), and whether it still waits for the first ROOM.RESTORE to say what it
    # was watching.
    restored: bool = False
    restored_by: str | None = None
    restored_ids: set[str] = field(default_factory=set)
    awaiting_restore: bool = False

    def holding(self) -> list[Participant]:
        return [
            x
            for x in self.participants.values()
            if x.hold and x.connected and x.following and x.id not in self.skip_hold
        ]

    def eligible(self, title_id: str | None, left: Collection[str] = ()) -> list[Participant]:
        """Who a Start together waits for: connected, following, and on the title, or on its
        service with no title yet: their player is still loading it (BUG-057). Someone in
        `left` had the title during this start and closed it: no wait (BUG-050)."""
        service = self.media["service"] if self.media else None
        return [
            x
            for x in self.participants.values()
            if x.connected
            and x.following
            and (
                x.title_id == title_id
                or (x.title_id is None and x.service == service and x.id not in left)
            )
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
        # When this process started taking rooms: restores are allowed only soon after.
        self.started = now_ms()

    def sweep(self, now: float | None = None) -> None:
        """Drop rooms that have had nobody connected for ROOM_IDLE_EXPIRY_SECONDS, or that
        nobody ever connected to for UNUSED_ROOM_EXPIRY_SECONDS."""
        now = now_ms() if now is None else now
        idle = config.ROOM_IDLE_EXPIRY_SECONDS * 1000
        unused = config.UNUSED_ROOM_EXPIRY_SECONDS * 1000
        for code, room in list(self.rooms.items()):
            limit = idle if room.used else unused
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

    def _add(self, room: Room, name: str, token: str | None = None) -> dict[str, str]:
        # Someone whose browser closed is coming back with the token of their last ticket:
        # take their place (and their id, so everyone's list swaps the row instead of showing
        # them twice). A name alone proves nothing: anyone with the code could take over a
        # dropped friend's place, so without the token it's someone new (BUG-041); the away
        # row goes when its grace period ends.
        found = self.tokens.get(token) if token else None
        claims = read_token(token) if found and token else None
        if claims is None or claims.expired:
            found = None  # too old to take back a place: someone new
        stale = room.participants.get(found[1]) if found and found[0] == room.code else None
        if stale is not None and stale.connected:
            stale = None
        if len(room.participants) - (stale is not None) >= config.MAX_PARTICIPANTS:
            raise RoomError("room_full", "This room is full.")
        if stale is not None:
            room.participants.pop(stale.id)
            self.tokens.pop(stale.token, None)
            room.skip_hold.discard(stale.id)
        p = Participant(
            id=stale.id if stale else secrets.token_hex(8),
            name=name,
            token="",
            rejoined=stale is not None or name in room.gone,
        )
        p.token = sign_token(room.code, p.id, name)
        if room.restored:
            room.restored_ids.add(p.id)
        room.gone.discard(name)
        room.participants[p.id] = p
        self.tokens[p.token] = (room.code, p.id)
        return {"code": room.code, "token": p.token, "participantId": p.id}

    def create(self, name: str, creator: str) -> dict[str, str]:
        self.sweep()
        if len(self.rooms) >= config.MAX_ROOMS:
            raise RoomError("busy", "WatchSync is busy. Try again in a few minutes.")
        mine = sum(1 for r in self.rooms.values() if r.creator == creator and not r.joined)
        if mine >= config.ROOMS_PER_IP:
            raise RoomError("too_many_rooms", "Too many open rooms. Try again in a few minutes.")
        room = Room(code=self._new_code(), empty_since=now_ms(), creator=creator)
        self.rooms[room.code] = room
        return self._add(room, name)

    def join(self, code: str, name: str, token: str | None = None) -> dict[str, str]:
        self.sweep()
        room = self.rooms.get(code)
        if room is None:
            if code in self.ended:
                raise RoomError("room_ended", "This room has ended.")
            raise RoomError("not_found", "No room has that code.")
        ticket = self._add(room, name, token)
        room.joined = True
        return ticket

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

    def authenticate(
        self, code: str, token: str, client: str = "unknown"
    ) -> tuple[Room, Participant] | None:
        self.sweep()
        found = self.tokens.get(token)
        if found is not None:
            if found[0] != code or code not in self.rooms:
                return None
            room = self.rooms[code]
            return room, room.participants[found[1]]
        return self.restore(code, token, client)

    def restore(self, code: str, token: str, client: str) -> tuple[Room, Participant] | None:
        """After a restart, someone connecting with a token the last process signed brings
        the room back, or takes their place in a room already brought back (US-120). Never
        for a room that is live here (its tokens are in the registry) or ended here, never
        with a token older than TOKEN_MAX_AGE_SECONDS, only within RESTORE_WINDOW_SECONDS of
        this process starting, and within the same room ceilings as creating one."""
        claims = read_token(token)
        if claims is None or claims.expired or claims.code != code or code in self.ended:
            return None
        if now_ms() - self.started > config.RESTORE_WINDOW_SECONDS * 1000:
            return None
        room = self.rooms.get(code)
        if room is None:
            if len(self.rooms) >= config.MAX_ROOMS:
                return None
            mine = sum(1 for r in self.rooms.values() if r.restored_by == client)
            if mine >= config.RESTORES_PER_IP:
                return None
            room = Room(code=code, empty_since=now_ms(), joined=True, used=True)
            room.restored = room.awaiting_restore = True
            room.restored_by = client
            self.rooms[code] = room
        pid = claims.participant_id
        if not room.restored or pid in room.restored_ids or pid in room.participants:
            return None
        if len(room.participants) >= config.MAX_PARTICIPANTS:
            return None
        p = Participant(id=pid, name=claims.name, token=token)
        room.restored_ids.add(p.id)
        room.participants[p.id] = p
        self.tokens[token] = (code, p.id)
        return room, p


rooms = Rooms()
