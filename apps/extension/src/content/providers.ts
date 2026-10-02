// Streaming providers: read the player and send it play, pause and seek (DEC-019,
// docs/spikes/player-control.md). They read the <video> element's state only, never
// frames, keys or stream data.
import type { Media, Service } from "@watchsync/protocol";

export interface PlayerState {
  playing: boolean;
  /** seconds */
  position: number;
  /** seconds; Infinity for live */
  duration: number;
  rate: number;
}

export interface StreamingProvider {
  service: Service;
  /** The title open in this tab (episode included in the name), or null off a title page. */
  media(): Media | null;
  /** The main <video>, or null while none is playing. */
  video(): HTMLVideoElement | null;
  getState(): PlayerState | null;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** Playing but starved of data right now (the player shows a spinner). */
  stalled(): boolean;
  /** An ad is showing; `left` is the seconds remaining when the page shows it. */
  ad(): { left: number | null } | null;
}

/** "Ad 0:20", "Ad · 1:05 left" → seconds; null when there's no time on the page. */
export function adSeconds(text: string | null | undefined): number | null {
  const m = text?.match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** HAVE_FUTURE_DATA: below it, a playing video can't advance. */
const isStalled = (v: HTMLVideoElement | null) => Boolean(v && !v.paused && v.readyState < 3);

/** The largest <video> with data: players keep extra elements for trailers and previews. */
export function mainVideo(doc: Document = document): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of doc.querySelectorAll("video")) {
    const area = v.clientWidth * v.clientHeight;
    if (v.readyState > 0 && area >= bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

function stateOf(v: HTMLVideoElement | null): PlayerState | null {
  if (!v) return null;
  return {
    playing: !v.paused,
    position: v.currentTime,
    duration: v.duration,
    rate: v.playbackRate,
  };
}

const text = (doc: Document, selector: string) =>
  doc.querySelector(selector)?.textContent?.trim() || null;

/** Netflix: one ID per episode in /watch/<id>; the title text shows only with the controls. */
export function netflixMedia(url: URL, doc: Document, lastName: string | null): Media | null {
  const id = url.pathname.match(/^\/watch\/(\d+)/)?.[1];
  if (!id) return null;
  const title = doc.querySelector('[data-uia="video-title"]');
  const parts = title
    ? [...title.children].map((c) => c.textContent?.trim()).filter((t): t is string => Boolean(t))
    : [];
  const name = parts.length ? parts.join(", ") : (title?.textContent?.trim() ?? lastName);
  return {
    service: "netflix",
    titleId: id,
    titleName: name || null,
    titleUrl: `https://www.netflix.com/watch/${id}`,
  };
}

const PRIME_HOSTS = /^www\.(primevideo\.com|amazon\.(com|in|co\.uk|de))$/;

/**
 * Prime Video, as seen on a live player (BUG-015, 2 October 2026): the player uses generated
 * class names, so the title comes from the page title ("Prime Video: Vaarasudu") and the ID
 * from /detail/<id> (or gti). Detail pages also run a short trailer, so a title only counts
 * as watching while the long video is loaded. Episodes change inside the player; the old
 * subtitle line is still read if present.
 */
export function primeMedia(url: URL, doc: Document, playerOpen: boolean): Media | null {
  const id = url.pathname.match(/\/detail\/([\w.-]+)/)?.[1] ?? url.searchParams.get("gti");
  const title = doc.title
    .replace(/^(prime video|amazon\.[\w.]+)\s*:\s*/i, "")
    .replace(/^watch\s+/i, "")
    .replace(/\s*\|.*$/, "")
    .trim();
  if (!id || !title || !playerOpen) return null; // browsing, not watching
  const episode = text(doc, ".atvwebplayersdk-subtitle-text");
  const base = url.pathname.includes("/gp/video") ? "/gp/video/detail" : "/detail";
  return {
    service: "prime",
    titleId: episode ? `${id}:${episode}` : id,
    titleName: episode ? `${title}, ${episode}` : title,
    titleUrl: `${url.origin}${base}/${id}`,
  };
}

/** Prime's film or episode: the longest loaded video (trailers and previews are short). */
export function primeVideo(doc: Document = document): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  for (const v of doc.querySelectorAll("video"))
    if (v.readyState > 0 && Number.isFinite(v.duration) && v.duration > (best?.duration ?? 300))
      best = v;
  return best;
}

/** Prime shows an ad countdown in the player while an ad plays. */
export function primeAd(doc: Document): { left: number | null } | null {
  const el = doc.querySelector<HTMLElement>(".atvwebplayersdk-ad-timer");
  if (!el || el.checkVisibility?.() === false) return null; // absent or hidden: no ad
  return { left: adSeconds(el.textContent) };
}

/**
 * JioHotstar: the numeric content ID before /watch, e.g. /in/shows/name/1260123456/watch.
 * Every episode has its own ID, so the next episode is a URL change.
 */
export function hotstarMedia(url: URL, doc: Document): Media | null {
  const id = url.pathname.match(/\/(\d{6,})\/watch/)?.[1];
  if (!id) return null;
  // "Panchayat S3 E2 - Watch on JioHotstar" → "Panchayat S3 E2"
  const name = doc.title
    .replace(/\s*[|-]\s*(watch\s+(online\s+)?on\s+)?(jio)?hotstar.*$/i, "")
    .trim();
  return {
    service: "jiohotstar",
    titleId: id,
    titleName: name || null,
    titleUrl: `${url.origin}${url.pathname}`,
  };
}

/** The local test player used by the end-to-end tests: /watch/<id> with <h1 data-title>. */
export function mockMedia(url: URL, doc: Document): Media | null {
  const id = url.pathname.match(/^\/watch\/([\w-]+)/)?.[1];
  if (!id) return null;
  // [data-episode] mimics Prime: the episode changes inside the player, not in the URL.
  const episode = doc.querySelector<HTMLElement>("[data-episode]")?.dataset.episode;
  const title = text(doc, "[data-title]");
  return {
    service: "mock",
    titleId: episode ? `${id}:${episode}` : id,
    titleName: episode ? `${title}, ${episode}` : title,
    titleUrl: `${url.origin}/watch/${id}`,
  };
}

function videoProvider(service: Service, media: () => Media | null): StreamingProvider {
  return {
    service,
    media,
    video: () => mainVideo(),
    getState: () => stateOf(mainVideo()),
    play: async () => {
      await mainVideo()?.play();
    },
    pause: async () => mainVideo()?.pause(),
    seek: async (s) => {
      const v = mainVideo();
      if (v) v.currentTime = s;
    },
    stalled: () => isStalled(mainVideo()),
    // ponytail: no ad marker known for this service yet; each adapter adds its own.
    ad: () => null,
  };
}

type NetflixAction = "play" | "pause" | "seek";

/** Sends a command to src/page/netflix-bridge.ts (page context) and waits for its answer. */
function netflixCommand(action: NetflixAction, ms = 0): Promise<boolean> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      if (typeof d !== "string") return;
      let r: unknown;
      try {
        r = JSON.parse(d);
      } catch {
        return; // the page can dispatch anything on document
      }
      if (typeof r !== "object" || r === null || (r as { id?: unknown }).id !== id) return;
      done((r as { ok?: unknown }).ok === true);
    };
    const done = (ok: boolean) => {
      clearTimeout(timer);
      document.removeEventListener("watchsync:netflix-result", onResult);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 1000);
    document.addEventListener("watchsync:netflix-result", onResult);
    document.dispatchEvent(
      new CustomEvent("watchsync:netflix-command", { detail: JSON.stringify({ id, action, ms }) }),
    );
  });
}

function netflixProvider(): StreamingProvider {
  let lastName: string | null = null;
  const base = videoProvider("netflix", () => {
    const m = netflixMedia(new URL(location.href), document, lastName);
    lastName = m?.titleName ?? null;
    return m;
  });
  return {
    ...base,
    play: async () => {
      if (!(await netflixCommand("play"))) await base.play();
    },
    pause: async () => {
      if (!(await netflixCommand("pause"))) await base.pause();
    },
    // Setting currentTime on Netflix stops playback with error M7375, so seeking needs the API.
    seek: async (s) => {
      if (!(await netflixCommand("seek", Math.round(s * 1000))))
        throw new Error("Can't control Netflix right now");
    },
  };
}

export function providerFor(host: string): StreamingProvider | null {
  if (host === "www.netflix.com") return netflixProvider();
  if (PRIME_HOSTS.test(host)) {
    const media = () => primeMedia(new URL(location.href), document, primeVideo() !== null);
    return {
      ...videoProvider("prime", media),
      video: () => primeVideo(),
      getState: () => stateOf(primeVideo()),
      // Prime's player cancels video.play() (AbortError); its own space shortcut, sent to
      // the video's parent, resumes reliably. Pause and seek work on the element.
      play: async () => {
        const v = primeVideo();
        if (!v?.paused) return;
        for (const type of ["keydown", "keyup"])
          v.parentElement?.dispatchEvent(
            new KeyboardEvent(type, { key: " ", code: "Space", keyCode: 32, bubbles: true }),
          );
      },
      pause: async () => primeVideo()?.pause(),
      seek: async (s) => {
        const v = primeVideo();
        if (v) v.currentTime = s;
      },
      stalled: () => isStalled(primeVideo()),
      ad: () => primeAd(document),
    };
  }
  if (host === "www.jiohotstar.com" || host === "www.hotstar.com")
    return videoProvider("jiohotstar", () => hotstarMedia(new URL(location.href), document));
  if (__MOCK__ && host === "localhost:4173") {
    // The mock player stands in for a service in tests: [data-ad] is its ad marker, and
    // data-buffering on <body> stands in for a starved player.
    const base = videoProvider("mock", () => mockMedia(new URL(location.href), document));
    return {
      ...base,
      stalled: () => document.body.dataset.buffering === "1" || base.stalled(),
      // data-live on <body> stands in for a live stream (no end to its timeline).
      getState: () => {
        const st = base.getState();
        return st && document.body.dataset.live ? { ...st, duration: Infinity } : st;
      },
      ad: () => {
        const el = document.querySelector("[data-ad]");
        return el ? { left: adSeconds(el.textContent) } : null;
      },
    };
  }
  return null;
}
