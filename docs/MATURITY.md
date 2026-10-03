# Maturity matrix

How far each part of WatchSync really is, with the evidence. Update it at every release gate (Ship use case) and whenever a level changes. A level only counts when its evidence exists; "built" is not "works".

| Level | Meaning | Evidence that counts |
|---|---|---|
| 0 | Not started | |
| 1 | Built | Code merged to `dev` |
| 2 | Tested in code | Unit or end-to-end tests (mock player) that fail without it |
| 3 | Verified for real | Two people, real accounts, real service, following the acceptance test |
| 4 | Watched in production | A check or signal tells us when it breaks, without a user reporting it |

Last assessed: 3 October 2026, for v0.1.0.

## Streaming services

| Capability | Netflix | Prime Video | JioHotstar |
|---|---|---|---|
| Detect the title and its name | 3: name read from Netflix's player data, checked live ("Solo Leveling, S1:E1") | 3: two people, real accounts, 3 Oct; name from the detail page heading (BUG-054) | 3: two people, real accounts in India, 3 Oct |
| Play and pause in sync | 3: two people, real accounts | 3: two people, real accounts, 3 Oct | 3 |
| Jumps (seek) in sync | 3 | 3 | 3 |
| Next episode together | 2: end-to-end on the mock player | 2: in-player episode change, friends pick it in the player | 3 |
| Waits while someone buffers | 2 | 2 | 2 |
| Waits through ads, with time left | 0: Netflix ads (on its plan with ads) aren't detected yet; the buffering wait still applies | 2: ad countdown read from the player; not seen live | 3: seen live with two people, 3 Oct: wait with countdown, then together |
| Start together (3-2-1) | 2 | 2 | 2 |
| Sync everyone | 2: needs the production room service on the new version | 2 | 2 |

All three services passed the two-person acceptance test on real accounts on 3 October 2026: Netflix, JioHotstar (India, dev build 4e1ab4b) and Prime Video (dev build 97cea13). Prime Video's ad countdown has not been seen live.

## Engineering

| Area | Level | Evidence | Gap to the next level |
|---|---|---|---|
| Chat | 2 | Room-service tests for relay, history, limits, membership and no chat in logs; extension unit and end-to-end tests on the mock player for sending, Not sent and Retry, unread counts, reactions, room activity, popup Open chat and the shortcut | Two people on the real services (Netflix, Prime Video, JioHotstar); VoiceOver pass |
| Room and sync logic | 3 | Server and extension tests; real Netflix sessions | Rate-based fine sync to about 0.1 s is v0.6 (UC-027); today's tolerance is 1 s |
| Automated tests | 2 | `pnpm check`: lint, types, unit, about 45 extension end-to-end, about 45 room-service, 50 website; regression tests fail without their fixes | Tests can't run real streaming services (DRM); covered by the manual acceptance test |
| CI and releases | 4 | CI on every push and PR (incl. website, Docker images, secret scan); release workflow on tags from `main`; Dev build after green CI; production smoke check every 6 hours | |
| Accessibility | 2 | axe WCAG 2.2 AA in tests for popup, overlay, invite, welcome and every website page; keyboard paths | Manual screen-reader pass (VoiceOver, NVDA) |
| Security | 2 | Input validation at every boundary, rate limits, CSP and security headers, no tokens in logs, secret scan in CI, closed shadow DOM | Independent review before the public listing (v0.8) |
| Privacy | 3 | Only names, rooms and playback state; nothing stored after a room ends; privacy notice live; uninstall page sends nothing | Legal review (DEC-024) before the public listing |
| Reliability | 2 | Reconnects after drops; rejoin after a browser restart; room waits for buffering and ads | One in-memory instance: a deploy or crash ends every room |
| Scalability | 1 | One instance handles small groups; usage is tiny (about $0.00003 per movie night) | Shared room state (Redis) when one instance isn't enough |
| Observability | 2 | Health endpoint, 6-hourly production smoke check, Railway metrics | Error reporting from the extension and server (v0.8) |
| Distribution | 2 | Zip from watchsync.space via GitHub Releases; popup announces new versions | Chrome Web Store listing (prepared in `apps/extension/store/`; Unlisted after v0.1.0, public at v0.8) |
| Website and search | 3 | watchsync.space live, indexed by Google, canonical links, structured data, sitemap | Search ranking for the name (three other "WatchSync" extensions, DEC-027) |
| Cost control | 4 | Dev services sleep when idle; CPU and memory caps; Hobby plan covers usage | |
| Documentation | 3 | README, install guide, deploy runbook, changelog, PRD, TRD, Notion plan | |

## Targets

| Release | Must reach |
|---|---|
| v0.1.0 | Every service capability at 2 or more; Netflix play, pause and seek at 3; CI at 4 |
| v0.2.0 | Prime Video next episode at 3; chat at 3 |
| v0.6.0 | Fine sync (about 0.1 s) at 3 |
| v0.8.0 | Security, accessibility and observability at 3 or more; Chrome Web Store public |
