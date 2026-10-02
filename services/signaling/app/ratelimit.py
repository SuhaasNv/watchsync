"""Sliding-window rate limits kept in memory."""

import time
from collections import defaultdict, deque


class Limiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self.hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window_s:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def prune(self) -> None:
        """Forget keys with no hits inside the window, so memory doesn't grow (BUG-011)."""
        now = time.monotonic()
        for key, q in list(self.hits.items()):
            if not q or now - q[-1] > self.window_s:
                del self.hits[key]

    def forget(self, key: str) -> None:
        self.hits.pop(key, None)
