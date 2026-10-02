# Changelog

## [0.1.0] - 2026-10-03

Streaming Sync: a Chrome and Brave extension that keeps friends' Netflix, Prime Video and JioHotstar tabs in step, each on their own account, through a small room service.

### Added
- Rooms: make a room, share an invite link (https://join.watchsync.space/j/ABC234) or a code, and see who is in the room and what they have open.
- Everyone controls: play, pause and skips on the service's own player reach everyone, with a note such as "Suhaas skipped ahead to 42:10".
- Nobody gets left behind: the room waits while someone's video loads or shows an ad, says why ("Asha is on an ad · about 0:20 left"), and starts everyone again together. After 90 seconds the others can go on without them.
- Start together (a ready check, then 3-2-1), Pause together, and Sync everyone, which brings everyone to your exact moment without pausing.
- Titles: the popup, notices and prompts name what is playing ("Solo Leveling, S1:E1"). Friends on another title are asked whether to open the room's; the room moves to the next episode together; when someone picks a new title, friends choose whether to follow.
- Staying together: small drift is fixed quietly, a large gap offers Sync, and you can watch on your own for a while.
- An on-page pill shows who is here and in sync, also in full screen, and folds down to their faces.
- Notices when someone closes the show, leaves, rejoins, or moves to the next episode. Closing your last browser window leaves the room; you can rejoin later.
- Recovery: reconnects after network drops, rejoins after a browser restart, and says clearly when a room has ended.
- Tabs already open on Netflix, Prime Video or JioHotstar join in when WatchSync is installed or updated, without a reload.
- Welcome page on first install, and a goodbye page after uninstalling that collects nothing.
- Update notice: once a day WatchSync checks GitHub for a newer version, and the popup tells you.
- Website at watchsync.space: what WatchSync does, an install guide for Chrome and Brave, release notes, FAQ, privacy and terms, with demo players you can play, pause and skip.
- Every release zip comes with SHA-256 checksums and a build attestation, and the install page explains how to check them.
- Accessibility: keyboard paths, reduced motion, and WCAG 2.2 AA checks in the test suite.

### Fixed
- Switching titles: the room no longer sticks on a title nobody is watching, follows the last title anyone picks, and tells friends within seconds.
- Rejoining after closing the browser no longer shows you twice.
- Friends see you on a service's home page, and closing one of two title tabs keeps the other.
- The room stops waiting for someone who left during an ad or a countdown, and Start together waits for a friend whose player is still loading.
- Prime Video: real show names instead of Prime's storefront line, no false "on an ad", and opening a show's page no longer counts as watching it.
- Ads end cleanly: the room resumes after an ad, the person on the ad is told the room is waiting, and long ad times read correctly.
- Names with invisible characters, pasted invite links, speeds above 4x, very long title names and joining a second room no longer break rooms.
- Security: title links only open real title pages, nobody can take an away friend's place by using their name, rooms and wrong room codes are rate-limited, the room token stays inside the extension, and the build pipeline is pinned.
- Reconnecting after a Wi-Fi drop takes seconds instead of up to a minute, and an ended room no longer shows "Reconnecting" forever.

### Known issues
- Tested by two people on real accounts on Netflix, Prime Video and JioHotstar (from India, with ads). Prime Video's ad countdown hasn't been seen live yet.
- On Netflix the room waits while someone is loading, but WatchSync never says they're on an ad.
- On Prime Video, when the room moves to another episode of the same show, friends pick it in the player themselves.
- The invite page can stay on "Joining…" if the extension reloads while it's open; reload the page.
- Leaving a room while reconnecting tells the others only after a minute.
- WatchSync is installed from a zip with Developer mode until its Chrome Web Store listing is live.
- Updating the room service ends every open room.
