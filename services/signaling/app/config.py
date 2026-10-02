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
MAX_PARTICIPANTS = int(os.environ.get("MAX_PARTICIPANTS", "8"))
# Per client IP, per minute.
CREATE_PER_MINUTE = int(os.environ.get("CREATE_PER_MINUTE", "10"))
JOIN_PER_MINUTE = int(os.environ.get("JOIN_PER_MINUTE", "30"))
# Per connection, per 10 seconds.
MESSAGES_PER_10S = int(os.environ.get("MESSAGES_PER_10S", "60"))
# Behind Railway's edge, the client address arrives in X-Real-IP (set by the edge).
TRUST_PROXY = os.environ.get("TRUST_PROXY") == "1"
# Request bodies are tiny ({"name": ...}); anything bigger is refused.
MAX_BODY_BYTES = 2048
