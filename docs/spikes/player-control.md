# Spike UC-002 — Reading and controlling each player

**Status:** desk research, 2 October 2026. **Not yet confirmed on real accounts.** Each method below is what the v0.1 adapters use; the "Confirm" list is the manual check to run in a logged-in Chrome profile before DEC-019 is accepted. If a check fails, log a bug (Provider field) and fix only that adapter.

The boundary for every service: read playing/paused, position, duration, rate and title identity; command play, pause and seek. Never read frames, keys, licence traffic or stream data (TRD §37).

## Shared approach

- Find the player's `<video>`: the largest `<video>` on the page with `readyState > 0`. Re-check every second because players are created and destroyed during navigation, trailers and ads.
- Read state from that element (`paused`, `currentTime`, `duration`, `playbackRate`). Reading never disturbs playback.
- Detect user actions with the element's `play`, `pause` and `seeking` events. Events caused by WatchSync's own commands are suppressed for 1.5 s after each command (echo control).
- Title identity comes from the URL where possible, otherwise from on-page title text.

## Netflix

| | Method |
|---|---|
| Title ID | `/watch/<id>` in the URL. Every episode has its own ID, so next episode = URL change |
| Title name | On-page title element (`[data-uia="video-title"]`) when the controls are visible; otherwise "Netflix" |
| Read | `<video>` element |
| Play / pause | Netflix player API from page context (below); `<video>.play()/pause()` as fallback |
| Seek | **Must use the player API.** Setting `video.currentTime` causes Netflix error M7375 and stops playback |

Player API (runs in the page's main world, `src/page/netflix-bridge.ts`):

```js
const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
const player = vp.getVideoPlayerBySessionId(vp.getAllPlayerSessionIds()[0]);
player.seek(ms); player.play(); player.pause();
```

The content script and the bridge talk through `CustomEvent`s on `document` (`watchsync:netflix-command`, `watchsync:netflix-result`), with payloads validated on both sides.

Risk: this API is not public. It has been stable for years and is what other watch-party extensions use, but a Netflix release can break it. The adapter reports "Can't control Netflix right now" if the API is missing instead of seeking the video element.

Confirm:
- [ ] Bridge finds the player within 5 s of the video starting.
- [ ] 20 seeks in a row, forward and back, with no M7375 error.
- [ ] Play and pause through the API reflect in the `<video>` element's events.
- [ ] Next episode (autoplay and the Next button) changes the URL ID.
- [ ] Ad-supported plan: note what the `<video>` element reports during an ad break.

Ads (UC-048, US-126). Not yet seen first-hand: the evidence is from others' live recordings. Netflix stitches ads into the film's own `<video>`: the film is not paused and no second video plays, so the "short video next to a paused film" guess does not apply. Two signals, in order:
1. Player API, read by the bridge (`src/page/netflix-ad.ts`): `player.getAdManager().adPresenting._value` (boolean). Recorded live on web UI `shakti-v877494c4`, 7 Sep 2026, by `benjismith/multicap` (`docs/phase0-findings.md`).
2. Page badge: `[data-uia="ads-info-container"]` exists exactly while an ad plays, holding `ads-info-text` ("Ad") and `ads-info-time` (the countdown). Same source; the container alone also in `aritropaul/adblocky` ("live DOM inspection", 28 Mar 2026). `pause-ad-*` markers are the pause-screen ad, not an ad break, and are ignored.
The two selectors are in the rules data (`netflix.ad`). Confident = the flag says so, or (no flag) a shown badge with a parseable countdown. Anything weaker (badge with no countdown, flag and badge disagree) is "unsure": the room waits as for buffering and never says "ad". Netflix's logged-out pages carry no player or ad code (inspected with REA, no login). A real capture is still to be taken: during an ad, copy the outer HTML of `.watch-video` (DevTools, Elements) and, in the console, `netflix.appContext.state.playerApp.getAPI().videoPlayer` then `getVideoPlayerBySessionId(<the watch- id>).getAdManager().adPresenting._value`.

## Prime Video

| | Method |
|---|---|
| Title ID | `/detail/<id>` in the URL, or the `gti` query parameter |
| Title and episode | `.atvwebplayersdk-title-text` and `.atvwebplayersdk-subtitle-text` |
| Read / play / pause / seek | `<video>` element inside the web player |
| Ads | `.atvwebplayersdk-ad-timer` (or similar ad indicator) is present during ads |

Risks: the player can keep several `<video>` elements during trailers; the largest-playing rule handles this. Some reports say the element's `currentTime` can be offset from the visible timeline after ads; if so, sync still works between two Prime viewers as long as both read the same element, but the notice times may differ from the on-screen clock.

Confirm:
- [ ] `currentTime` matches the on-screen time (note any offset).
- [ ] Setting `currentTime` seeks without an error on primevideo.com and amazon.in.
- [ ] Title and episode text are found; episode changes update them.
- [ ] Ad indicator selector during an ad.

## JioHotstar

| | Method |
|---|---|
| Title ID | Last numeric path segment before `/watch` (for example `/in/shows/.../1260123456/watch`) |
| Title name | `document.title` without the site suffix |
| Read / play / pause / seek | `<video>` element |
| Live | `video.duration === Infinity`: sync is turned off and the overlay says so |

Risks: India-only; live and on-demand players differ; heavy ads on free content.

Confirm:
- [ ] Seeking `currentTime` works on an on-demand title with no player error.
- [ ] Title ID changes on next episode.
- [ ] Live streams report `duration === Infinity`.

## Recommendation for DEC-019

Adopt the methods above for v0.1, with the Netflix player API as the only page-context code. Keep DEC-019 **Open** until the Confirm lists are ticked on real accounts during the v0.1 acceptance test.
