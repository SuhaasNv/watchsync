"""Draws the WatchSync mark (filled dot + ring) as PNG icons using only the stdlib."""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
# A dark rounded square behind the mark keeps it visible on light and dark toolbars.
GOLD, INK, BACK = (255, 210, 90), (236, 242, 241), (12, 18, 21)


def inside_tile(px: float, py: float, size: int) -> bool:
    """A square with corners rounded to a quarter of its size."""
    k = size * 0.25
    dx = max(k - px, 0, px - (size - k))
    dy = max(k - py, 0, py - (size - k))
    return dx * dx + dy * dy <= k * k


def png(size: int) -> bytes:
    r = size * 0.24
    cy, c1, c2 = size / 2, size * 0.34, size * 0.66
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            d1 = ((px - c1) ** 2 + (py - cy) ** 2) ** 0.5
            d2 = ((px - c2) ** 2 + (py - cy) ** 2) ** 0.5
            ring = abs(d2 - r * 0.86) < max(1.0, size * 0.06)
            if d1 <= r:
                row += bytes(GOLD) + b"\xff"
            elif ring:
                row += bytes(INK) + b"\xff"
            elif inside_tile(px, py, size):
                row += bytes(BACK) + b"\xff"
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data))
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b"".join(rows)))
        + chunk(b"IEND", b"")
    )


for s in (16, 32, 48, 128):
    (OUT / f"{s}.png").write_bytes(png(s))
print("icons written")
