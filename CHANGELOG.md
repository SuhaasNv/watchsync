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

### Fixed
- BUG-002 to BUG-013, including: autoplay on arrival pulling the room back (BUG-004), a first jump pausing everyone (BUG-005), the sender's own room clock going stale (BUG-006), NaN breaking a room (BUG-008), endless Reconnecting after a room ended (BUG-009), a dropped friend disconnecting the sender (BUG-010), and idle rooms and limiter keys not being cleaned up (BUG-011).

### Known issues
- Not yet confirmed on real accounts: the Netflix player API, Prime Video's selectors and ad timer, JioHotstar's page structure (DEC-019). The release acceptance test with two people covers these.
- Ads are detected on Prime Video only; on Netflix and JioHotstar the buffering wait still applies but WatchSync never claims an ad.
- On Prime Video, when the room moves to another episode of the same show, friends pick it in the player themselves.
- Installed as an unpacked zip (Developer mode); a Chrome Web Store listing waits for the legal review (DEC-024).
- A redeploy of the room service ends every open room.
