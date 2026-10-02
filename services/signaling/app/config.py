"""Settings from environment variables. Defaults are for local development."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
VERSION = "0.1.0"
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:8000")
PROTOCOL_SCHEMA = Path(
    os.environ.get("PROTOCOL_SCHEMA", ROOT / "packages/protocol/schema/protocol.schema.json")
)
ROOM_IDLE_EXPIRY_SECONDS = int(os.environ.get("ROOM_IDLE_EXPIRY_SECONDS", "900"))
# A room nobody ever connected to is a code nobody uses; it ends sooner (BUG-040).
UNUSED_ROOM_EXPIRY_SECONDS = int(os.environ.get("UNUSED_ROOM_EXPIRY_SECONDS", "120"))
# Live rooms one client address (IPv6: its /64) may hold that nobody else has joined (BUG-040).
ROOMS_PER_IP = int(os.environ.get("ROOMS_PER_IP", "3"))
# Someone whose connection closed and who hasn't come back within this long has left (their
# browser closed); shorter drops, like a Wi-Fi change, stay silent (BUG-018).
AWAY_GRACE_SECONDS = float(os.environ.get("AWAY_GRACE_SECONDS", "60"))
MAX_PARTICIPANTS = int(os.environ.get("MAX_PARTICIPANTS", "8"))
# Per client IP, per minute.
CREATE_PER_MINUTE = int(os.environ.get("CREATE_PER_MINUTE", "10"))
JOIN_PER_MINUTE = int(os.environ.get("JOIN_PER_MINUTE", "30"))
# Wrong codes per minute from everyone together: past it, every join waits (BUG-042), so
# guessing codes from many addresses stays slow.
FAILED_JOINS_PER_MINUTE = int(os.environ.get("FAILED_JOINS_PER_MINUTE", "100"))
# Per connection, per 10 seconds.
MESSAGES_PER_10S = int(os.environ.get("MESSAGES_PER_10S", "60"))
# Behind Railway's edge, the client address arrives in X-Real-IP (set by the edge).
TRUST_PROXY = os.environ.get("TRUST_PROXY") == "1"
# Request bodies are tiny ({"name": ...}); anything bigger is refused.
MAX_BODY_BYTES = 2048
# Ceilings that keep one host's memory bounded (resilience audit, 2 October 2026).
MAX_ROOMS = int(os.environ.get("MAX_ROOMS", "2000"))
CONNECTS_PER_MINUTE = int(os.environ.get("CONNECTS_PER_MINUTE", "60"))
