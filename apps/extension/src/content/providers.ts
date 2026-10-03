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

/** "Ad 0:20", "Ad · 1:05 left", "1:05:00" → seconds; null when there's no time on the page. */
export function adSeconds(text: string | null | undefined): number | null {
  const m = text?.match(/(?:(\d+):)?(\d+):(\d{2})/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
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
  if (!id || !playerOpen) return null; // browsing, not watching
  const title = primeName(doc);
  const episode = text(doc, ".atvwebplayersdk-subtitle-text");
  const base = url.pathname.includes("/gp/video") ? "/gp/video/detail" : "/detail";
  return {
    service: "prime",
    titleId: episode ? `${id}:${episode}` : id,
    titleName: title && episode ? `${title}, ${episode}` : title,
    titleUrl: `${url.origin}${base}/${id}`,
  };
}

/** Prime's storefront line ("Watch movies, TV shows, sports, and live TV"), never a title. */
const PRIME_STOREFRONT = /movies,? (and )?tv shows|^(amazon(\.[\w.]+)?|prime video)$/i;

/**
 * The show's name. Prime is a single-page app that keeps its storefront page title while a
 * show plays (BUG-054), so the page title comes last, after the player's and the detail
 * page's own title, and a storefront line is never taken for a name.
 */
function primeName(doc: Document): string | null {
  const candidates = [
    text(doc, ".atvwebplayersdk-title-text"),
    text(doc, '[data-automation-id="title"]'),
    doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content,
    doc.title,
  ];
  for (const raw of candidates) {
    const name = raw
      ?.replace(/^(prime video|amazon\.[\w.]+)\s*:\s*/i, "")
      .replace(/^watch\s+/i, "")
      .replace(/\s*\|.*$/, "")
      .trim();
    if (name && !PRIME_STOREFRONT.test(name)) return name;
  }
  return null;
}

/**
 * The film or episode on pages that also play short videos (trailers, previews, ads): the
 * longest loaded video over 5 minutes. Used for Prime Video and JioHotstar.
 */
export function longestVideo(doc: Document = document): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  for (const v of doc.querySelectorAll("video"))
    if (v.readyState > 0 && Number.isFinite(v.duration) && v.duration > (best?.duration ?? 300))
      best = v;
  return best;
}

/**
 * An ad shown in its own short video while the film's video waits (BUG-020). The page
 * shows no stable marker for it, so this is a heuristic: a short video playing on screen
 * while the long one is paused. Never true without a film loaded (trailers on detail pages).
 */
export function separateAd(doc: Document = document): { left: number | null } | null {
  const film = longestVideo(doc);
  if (!film?.paused) return null;
  for (const v of doc.querySelectorAll("video")) {
    const short = Number.isFinite(v.duration) && v.duration < 300;
    if (v !== film && short && !v.paused && v.clientWidth > 0)
      return { left: Math.max(0, Math.round(v.duration - v.currentTime)) };
  }
  return null;
}

/** A video playing with sound: a player in use, not a muted autoplaying trailer. */
export function playingWithSound(doc: Document = document): boolean {
  return [...doc.querySelectorAll("video")].some((v) => !v.paused && !v.muted && v.volume > 0);
}

/** Prime shows an ad countdown in the player while an ad plays. */
export function primeAd(doc: Document): { left: number | null } | null {
  const el = doc.querySelector<HTMLElement>(".atvwebplayersdk-ad-timer");
  if (!el) return null;
  // The player can keep an empty or see-through timer in the page between ads: only a
  // shown timer that says "Ad" or counts down is one (BUG-055).
  const shown = el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true });
  const label = el.textContent?.trim() ?? "";
  if (shown === false || !/\bad\b|\d:\d{2}/i.test(label)) return null;
  return { left: adSeconds(label) };
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

type NetflixAction = "play" | "pause" | "seek" | "title";

/**
 * Sends a command to src/page/netflix-bridge.ts (page context) and waits for its answer:
 * whether it worked, and for "title" the name it read.
 */
function netflixCall(
  action: NetflixAction,
  extra: { ms?: number; videoId?: string } = {},
): Promise<{ ok: boolean; name: string | null }> {
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
      const { ok, name } = r as { ok?: unknown; name?: unknown };
      done({
        ok: ok === true,
        name: typeof name === "string" && name.length <= 200 ? name : null,
      });
    };
    const done = (result: { ok: boolean; name: string | null }) => {
      clearTimeout(timer);
      document.removeEventListener("watchsync:netflix-result", onResult);
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, name: null }), 1000);
    document.addEventListener("watchsync:netflix-result", onResult);
    document.dispatchEvent(
      new CustomEvent("watchsync:netflix-command", {
        detail: JSON.stringify({ id, action, ...extra }),
      }),
    );
  });
}

const netflixCommand = async (action: NetflixAction, ms = 0) =>
  (await netflixCall(action, { ms })).ok;

function netflixProvider(): StreamingProvider {
  // The last name read, for its own title only: never carried over to the next one.
  let last: { id: string; name: string | null } | null = null;
  // The name from Netflix's player data, per video: it doesn't need the controls (BUG-025).
  const apiNames = new Map<string, string>();
  const asked = new Set<string>();
  // ponytail: ~10 tries per title, then the page text alone; enough while the player loads.
  const tries = new Map<string, number>();
  const base = videoProvider("netflix", () => {
    const url = new URL(location.href);
    const urlId = url.pathname.match(/^\/watch\/(\d+)/)?.[1];
    const m = netflixMedia(url, document, last && last.id === urlId ? last.name : null);
    const id = m?.titleId;
    if (!m || typeof id !== "string") return m;
    const tried = tries.get(id) ?? 0;
    if (!apiNames.has(id) && !asked.has(id) && tried < 10) {
      asked.add(id);
      tries.set(id, tried + 1);
      void netflixCall("title", { videoId: id }).then(({ name }) => {
        if (name) apiNames.set(id, name);
        else asked.delete(id); // the player wasn't ready: ask again on the next poll
      });
    }
    // Hold back a new title for a couple of polls until its name is known, so the room
    // (and the "opened a title" notice) gets the name with the title, not after it.
    if (!apiNames.has(id) && !m.titleName && tried < 3) return null;
    const named = { ...m, titleName: apiNames.get(id) ?? m.titleName };
    last = { id, name: named.titleName };
    return named;
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

/**
 * The room accepts title names up to 200 characters, without control or direction-changing
 * characters (the service strips them too); a longer one would get the whole report refused.
 */
export function capName(m: Media | null): Media | null {
  if (!m?.titleName) return m;
  const clean = m.titleName
    .replace(/[\p{Cc}\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, "")
    .trim();
  const name = clean.length <= 200 ? clean : `${[...clean].slice(0, 199).join("")}…`;
  return name === m.titleName ? m : { ...m, titleName: name || null };
}

export function providerFor(host: string): StreamingProvider | null {
  const p = serviceProvider(host);
  return p && { ...p, media: () => capName(p.media()) };
}

function serviceProvider(host: string): StreamingProvider | null {
  if (host === "www.netflix.com") return netflixProvider();
  if (PRIME_HOSTS.test(host)) {
    // Watching once the film is on screen, or already while Prime's ads play before it: they
    // play with sound, a detail page's trailer plays muted (BUG-056). A detail page also
    // preloads the film paused and 0 px wide; that is browsing, not watching (BUG-058).
    const open = () => (longestVideo()?.clientWidth ?? 0) > 0 || playingWithSound();
    const media = () => primeMedia(new URL(location.href), document, open());
    return {
      ...videoProvider("prime", media),
      video: () => longestVideo(),
      getState: () => stateOf(longestVideo()),
      // Prime's player cancels video.play() (AbortError); its own space shortcut, sent to
      // the video's parent, resumes reliably. Pause and seek work on the element.
      play: async () => {
        const v = longestVideo();
        if (!v?.paused) return;
        for (const type of ["keydown", "keyup"])
          v.parentElement?.dispatchEvent(
            new KeyboardEvent(type, { key: " ", code: "Space", keyCode: 32, bubbles: true }),
          );
      },
      pause: async () => longestVideo()?.pause(),
      seek: async (s) => {
        const v = longestVideo();
        if (v) v.currentTime = s;
      },
      stalled: () => isStalled(longestVideo()),
      // Prime shows its own ad timer. The separate-video guess (built for JioHotstar,
      // BUG-020) took Prime's previews and trailers for ads while paused (BUG-055).
      ad: () => primeAd(document),
    };
  }
  if (host === "www.jiohotstar.com" || host === "www.hotstar.com") {
    // Follow the film, not a trailer or a separate ad video (BUG-020; not yet confirmed on
    // a live player from India).
    const base = videoProvider("jiohotstar", () => hotstarMedia(new URL(location.href), document));
    return {
      ...base,
      video: () => longestVideo(),
      getState: () => stateOf(longestVideo()),
      play: async () => {
        await longestVideo()?.play();
      },
      pause: async () => longestVideo()?.pause(),
      seek: async (s) => {
        const v = longestVideo();
        if (v) v.currentTime = s;
      },
      stalled: () => isStalled(longestVideo()),
      ad: () => separateAd(),
    };
  }
  if (__MOCK__ && host === "localhost:4173") {
    // The mock player stands in for a service in tests: [data-ad] is its ad marker (or an
    // ad in its own short video, as JioHotstar's may be), and data-buffering on <body>
    // stands in for a starved player.
    const base = videoProvider("mock", () => mockMedia(new URL(location.href), document));
    return {
      ...base,
      // data-loading on <body> stands in for a player whose title can't be read yet
      // (Netflix before its controls show, Prime between episodes).
      media: () => (document.body.dataset.loading ? null : base.media()),
      stalled: () => document.body.dataset.buffering === "1" || base.stalled(),
      // data-live on <body> stands in for a live stream (no end to its timeline).
      getState: () => {
        const st = base.getState();
        return st && document.body.dataset.live ? { ...st, duration: Infinity } : st;
      },
      ad: () => {
        const el = document.querySelector("[data-ad]");
        return el ? { left: adSeconds(el.textContent) } : separateAd();
      },
    };
  }
  return null;
}
