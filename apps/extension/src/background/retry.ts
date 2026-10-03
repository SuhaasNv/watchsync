// When to try the room connection again (docs: v0.2 retry policy). 1008 and 4000 never
// reach here: the room ended, or a newer connection of ours owns it.

/** The room service is restarting (a deploy, US-121): it closes with 4002, uvicorn with 1012. */
export const RESTARTING = new Set([4002, 1012]);
/** How long a restart may look like a short blip before the normal messages return. */
export const UPDATE_GRACE_MS = 60_000;

/** 1, 2, 4, 8, then every 10 s, x1.0 to 1.3 so a room's clients don't all retry at once. */
export const backoff = (n: number, random = Math.random) =>
  Math.min(10_000, 1000 * 2 ** n) * (1 + random() * 0.3);

export interface RetryStatus {
  /** The service said it was restarting, less than a minute ago. */
  updating: boolean;
  /** Down for longOutageMs or more: say so plainly and offer Try now. */
  unreachable: boolean;
}

/**
 * Schedules reconnects. `run` connects; `changed` hears when the status changes without a
 * close (the long-outage switch while a connect attempt hangs).
 */
export class Retry {
  private attempt = 0;
  private downSince: number | null = null;
  private updatingSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private longTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly run: () => void,
    private readonly changed: () => void,
    private readonly longOutageMs: number,
    private readonly random = Math.random,
  ) {}

  /** The connection closed with `code`: plan the next try. */
  closed(code: number): RetryStatus {
    const now = Date.now();
    if (this.downSince === null) {
      this.downSince = now;
      this.longTimer = setTimeout(this.changed, this.longOutageMs);
    }
    if (RESTARTING.has(code)) this.updatingSince ??= now;
    const { updating } = this.status();
    clearTimeout(this.timer);
    const delay = updating ? 1000 + this.random() * 2000 : backoff(this.attempt++, this.random);
    this.timer = setTimeout(this.run, delay);
    return this.status();
  }

  status(): RetryStatus {
    const now = Date.now();
    const updating = this.updatingSince !== null && now - this.updatingSince < UPDATE_GRACE_MS;
    const unreachable =
      !updating && this.downSince !== null && now - this.downSince >= this.longOutageMs;
    return { updating, unreachable };
  }

  /** Try right away (network back, a tab or the popup opened, Try now). */
  now() {
    clearTimeout(this.timer);
    this.run();
  }

  /** Connected, or no longer in a room: forget the outage. */
  reset() {
    clearTimeout(this.timer);
    clearTimeout(this.longTimer);
    this.attempt = 0;
    this.downSince = null;
    this.updatingSince = null;
  }
}
