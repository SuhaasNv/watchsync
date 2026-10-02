# Changelog

## [0.1.0] - Unreleased (release candidate, 2 October 2026)

Streaming Sync: a Chrome extension that keeps friends' Netflix, Prime Video and JioHotstar tabs in sync, each on their own account, through a small room service.

### Added
- Rooms: create a room, share a code or an invite link, join from the popup or the link, see who is in the room and what they have open.
- Sync: play, pause and jumps reach everyone (everyone can control, DEC-017); jumps follow with a notice such as "Suhaas skipped ahead to 42:10" (DEC-016).
- Same title: someone on another title is asked "Suhaas is watching Dark, S1:E3. Open it?"; the room moves to the next episode together.
- Staying together: small drift is corrected silently; large drift offers Sync; Watch on my own; an on-page pill shows who is here and in sync.
- Flagship, Nobody gets left behind (DEC-023): the room waits while someone buffers or watches an ad, says why ("Asha is on an ad · about 0:20 left"), and resumes everyone together; after 90 s the others can go on without them.
- Start together: a ready check, then 3-2-1, then every player starts at the same moment.
- Recovery: reconnect with backoff after network drops, rejoin after a browser restart, clear message when a room has ended, Leave room.
- Service adapters for Netflix (player API through a page bridge), Prime Video (episodes and ads read from its player) and JioHotstar (live streams are not synced and say so).
- Room service on Railway with rate limits, room expiry, input validation and security headers; privacy notice and terms at /privacy and /terms.
- Accessibility: WCAG 2.2 AA gate (axe) in the test suite, keyboard paths, reduced motion (DEC-022).
- Update notice: once a day the extension checks GitHub for a newer release, and the popup says "WatchSync 0.1.1 is out · Download" when there is one.
- Downloads from the website: every release tag publishes a GitHub Release with the extension zip, and the website links to the latest one.
- Website at watchsync.space: what WatchSync does, a step-by-step install guide for Chrome and Brave, release notes, FAQ, privacy and terms. The demo players on the home page can be paused, played and skipped, and every screen follows.
- Welcome page: the first time you install WatchSync, a short tour shows how to pin it, make or join a room, and watch together.
- The popup, welcome page and website share one look, and the popup links to the website.
- Invite links now use WatchSync's own address, for example https://join.watchsync.space/j/ABC234.
- A separate WatchSync Dev build for testers, with a DEV badge and its own room service, so new work can be tried without touching the real one.

### Fixed
- BUG-002 to BUG-013, including: autoplay on arrival pulling the room back (BUG-004), a first jump pausing everyone (BUG-005), the sender's own room clock going stale (BUG-006), NaN breaking a room (BUG-008), endless Reconnecting after a room ended (BUG-009), a dropped friend disconnecting the sender (BUG-010), and idle rooms and limiter keys not being cleaned up (BUG-011).
- BUG-014: friends are told when someone opens another title ("Suhaas opened Vaarasudu.") and choose Continue with Suhaas or Watch on my own; going back to the browse page between titles no longer stops the room following.
- BUG-015: Prime Video detection rebuilt from its live player, after Prime moved to generated class names and WatchSync no longer found the title.
- BUG-016: the popup leads with the people in the room once anyone else has joined; the invite code moves to a small line below.
- BUG-017: a tidy two-line popup footer instead of one line that wrapped mid-sentence.
- BUG-018: after a Wi-Fi drop, the extension reconnects within seconds instead of waiting up to a minute.
- BUG-019: when a different show starts after the credits, friends are asked whether to follow instead of being moved silently.
- BUG-021 and BUG-022: the "Keep waiting" card no longer stays on screen after everyone is back, and nobody gets a notice about their own action.
- BUG-023 and BUG-024: the website's Features page is now tested, and the website builds correctly on the server.

### Known issues
- Netflix has been tested by two people on real accounts. Prime Video still needs that two-person test, and JioHotstar can only be checked from India (it redirects elsewhere), including how it tells ads apart.
- Ads are detected on Prime Video. JioHotstar ad detection (BUG-020) is built but not yet confirmed from India, where the service plays; on Netflix the buffering wait still applies but WatchSync never claims an ad.
- On Prime Video, when the room moves to another episode of the same show, friends pick it in the player themselves.
- Installed as an unpacked zip (Developer mode); a Chrome Web Store listing waits for the legal review (DEC-024).
- A redeploy of the room service ends every open room.
