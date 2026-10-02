# Chrome Web Store listing

Everything the store's forms ask for, in the order the developer dashboard asks it. Images are in `images/` (rebuild with `node store/compose.mjs` after `STORE_SHOTS=1 pnpm exec playwright test e2e/store-shots.spec.ts`). Visibility for v0.1: **Unlisted** (DEC-020); public at v0.8.

## Package

`watchsync-extension.zip` from the latest GitHub release (production room service, never a mock build).

## Store listing

**Name:** WatchSync

**Summary** (132 characters max):
Watch Netflix, Prime Video and JioHotstar together with friends in other cities, in sync. Each of you uses your own account.

**Category:** Entertainment

**Language:** English

**Description:**

Movie night with friends who live somewhere else. Press play in your tab and it plays in theirs.

WatchSync keeps your streaming tab in step with your friends' tabs. Each of you watches on your own Netflix, Prime Video or JioHotstar account, in your own browser. WatchSync only passes play, pause and the position between you.

How it works
1. Click WatchSync, pick a name and create a room.
2. Send the link to your friends. They join with one click, or with the six-letter code.
3. Open the same title. If someone is on another episode, WatchSync offers to open the right one.
4. Press play. Play, pause and skips reach everyone.

Nobody gets left behind
When someone's video stops for an ad or a slow connection, the room waits for them and says why ("Maya is on an ad, about 0:20 left"), then everyone starts again together.

Also
- Start together with a ready check and a 3-2-1 countdown.
- Small drift is corrected quietly; a big gap offers a Sync button.
- Watch on your own at any time without leaving the room.
- Reconnects by itself after a network drop.

Privacy
WatchSync shares your name, the room, and whether you are playing or paused and where. It never reads the picture, records anything, or touches your streaming account. There is no sign-up and no tracking. Privacy notice: https://watchsync.space/privacy/

WatchSync is not affiliated with Netflix, Amazon or JioStar. You need your own subscription to each service.

**Screenshots** (1280x800): `images/1-watch-together.png`, `images/2-send-the-link.png`, `images/3-welcome.png`

**Small promo tile** (440x280): `images/promo-tile-440x280.png`

**Icon** (128x128): from the package (`icons/128.png`)

**Website:** https://watchsync.space
**Support:** https://watchsync.space/faq/ and suhaasnvs@gmail.com

## Privacy practices

**Single purpose:**
Keep the user's video playback in sync with friends watching the same title on supported streaming sites (Netflix, Prime Video, JioHotstar).

**Permission justifications:**
- `scripting`: when WatchSync is installed or updated, adds its player sync to Netflix, Prime Video and JioHotstar tabs that are already open, so people don't have to reload them. It runs only WatchSync's own packaged scripts, only on those sites.
- `storage`: remembers the user's chosen display name and the room they are in, so the popup and a restarted browser can rejoin the room.
- Host permission for the WatchSync room service (`https://join.watchsync.space/*`): connects to the room so play, pause and position reach the other people in it, and lets invite links (`/j/CODE`) open the room in the extension.
- Content scripts on `https://www.netflix.com/*`, `https://www.primevideo.com/*`, `https://www.amazon.*/gp/video/*`, `https://www.jiohotstar.com/*` and `https://www.hotstar.com/*`: read whether the video is playing, its position and the title being watched, apply play, pause and seek from the room, and show the small in-page notices. Nothing else on these pages is read.

**Remote code:** No. All code ships in the package.

**Data usage** (what is collected and sent):
- Personally identifiable information: the display name the user types (not a real-name requirement). Used only to show who is in the room.
- Website content: the title name and position of the video being watched, sent to the room the user joined so friends see the same title. Not stored after the room ends.
- Not collected: health, financial, authentication, personal communications, location, web history, user activity beyond playback state.

Certify: data is not sold to third parties, not used or transferred for purposes unrelated to the single purpose, not used for creditworthiness or lending.

**Privacy policy URL:** https://watchsync.space/privacy/

## Distribution

Visibility: Unlisted. Regions: all. Price: free.
