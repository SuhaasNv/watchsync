# Service rules: threat model and key runbook

UC-047 (US-124, US-125), DEC-038. Written 15 October 2026.

The adapters in `apps/extension/src/content/providers.ts` depend on a few values that change when
a service redesigns its player: CSS selectors, a length threshold, drift tolerances. Those values
can now arrive as a **signed data file** from watchsync.space, so a fix reaches people the same
day without a new zip. Code fixes still need a new zip. This page says what that file may hold,
how the extension decides to trust it, what an attacker can and cannot do, and how the owner
handles the signing key.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Bundled rules | `apps/extension/src/rules/bundled.ts` | The values the adapters always had. Used with no network, a bad file or an expired one. |
| Schema | `apps/extension/src/rules/schema.ts` | The only shape accepted. Unknown, missing or out-of-range values fail the whole file. |
| Public keys | `apps/extension/src/rules/public-key.ts` | The Ed25519 public key(s) a build trusts. The one file to change when a key is replaced. |
| Verify | `apps/extension/src/rules/verify.ts` | Size cap, signature (WebCrypto), then schema. |
| Decide | `apps/extension/src/rules/update.ts` | Daily schedule, sequence and expiry rules, what is stored. |
| Fetch | `apps/extension/src/background/rules.ts` | 10 s timeout, byte caps, no redirects, no cookies. |
| Read | `apps/extension/src/rules/active.ts` | Content scripts read the stored rules at start; the adapters read them on every poll. |
| Sign | `scripts/sign-rules.mjs` | Run by the owner, offline. Writes `apps/website/public/rules/v1.json` and `v1.json.sig`. |
| Host | `apps/website/Caddyfile` | Serves `/rules/*` with `Access-Control-Allow-Origin: *`. No new host permission is needed. |

- **Two files.** `v1.json` is the exact bytes that are signed; `v1.json.sig` is the base64
  Ed25519 signature over those bytes. Nothing is re-serialised before checking, so there is no
  canonical-JSON problem. `v1` is the schema version, not a key version.
- **Verification.** Chrome's WebCrypto (`crypto.subtle`, Ed25519). Ed25519 shipped in Chrome 137;
  the extension targets Chrome 120 and sets no `minimum_chrome_version`. On a Chrome without
  Ed25519 the key cannot be imported, every file is refused, and the bundled rules stay in use.
  No library was added. (Setting `minimum_chrome_version` to 137 would stop older Chromes from
  loading WatchSync at all; that is the owner's call and was not made.)
- **Freshness.** Each file has `seq` (integer, counts up) and `expires` (UTC, `...Z`). The
  extension takes a file only if `seq` is higher than both the stored file's and the bundled
  `BUNDLED_SEQ`, it has not expired, and it does not claim to last more than **90 days**. The
  stored sequence is kept even after that file expires, so an old file cannot come back.
- **Limits.** The rules file may be at most 64 KB and the signature 256 bytes (checked on the
  `Content-Length` header and again while reading). Each request times out after 10 s and refuses
  redirects.
- **Schedule.** Checked when the background worker starts and when the popup opens, at most once
  a day (`nextCheckAt` in `chrome.storage.local`). A failed check tries again after one hour. No
  `alarms` permission. If several things ask at once, one request runs.
- **Keys per build.** A dev build (`WATCHSYNC_CHANNEL=dev`) trusts `DEV_RULES_KEY`, a production
  build trusts `PROD_RULES_KEY`. While `PROD_RULES_KEY` is `null` (today), production builds fetch
  nothing and use the bundled rules only.
- **Privacy.** The check shows watchsync.space the user's IP address once a day, nothing else (no
  cookies, no identifiers). The privacy page and README should say so (v0.3.0 plan, section 5).
  The extension logs only the outcome word (`updated`, `kept`, `failed`, `skipped`), never the
  fetched content.

## What a rules file can hold

Selectors, numbers, nothing else. This is the full list:

| Key | Type | Used for |
|---|---|---|
| `filmMinSec` | number, 30 to 3600 | Videos longer than this are the film, shorter ones trailers or ads |
| `netflix.titleSelector` | selector | Where the title overlay is |
| `netflix.driftToleranceSec` | number, 0.05 to 5 | Drift the sync check ignores |
| `netflix.ad.containerSelector` | selector, optional group | The ad badge Netflix draws only while an ad plays |
| `netflix.ad.timeSelector` | selector, optional group | The countdown inside that badge |
| `prime.titleSelectors` | 1 to 8 selectors | Where the show's name is |
| `prime.episodeSelector` | selector | Where the episode name is |
| `prime.adTimerSelector` | selector | The ad countdown |
| `prime.driftToleranceSec` | number, 0.05 to 5 | As above |
| `jiohotstar.driftToleranceSec` | number, 0.05 to 5 | As above |

`netflix.ad` (UC-048) may be left out of a file, so files signed before it existed stay valid; the bundled selectors then apply. Present, it must hold both selectors and nothing else.

A selector is 1 to 200 characters of letters, digits, spaces and `. # [ ] = " ' - : > , * ( ) ~ + ^ $ | _`. It
cannot contain `/`, `{`, `}`, `;` or `\`, so it cannot be a URL, a CSS block or an escape
sequence. A page that cannot parse a selector throws the whole stored file away. There are **no URL fields** at all, so
nothing in a file can point the extension at another host. Nothing is evaluated: values go to
`querySelector` and into comparisons. Regular expressions stay in the code on purpose (compiling
a pattern from data is evaluation and a ReDoS risk), so a title-pattern change needs a new zip.

The schema lives in the extension, not in `packages/protocol`: only the extension reads it.

## Threat model

Assets: what people see and do while watching (titles shown to the room, whether a room pauses
for an ad), and the integrity of the extension. The room service, accounts and tokens are not
involved. The worst a correctly signed but malicious file can do is below the table.

| Threat | What an attacker does | What stops or limits it |
|---|---|---|
| **Tampering** (a network attacker, a compromised CDN or host edits the file) | Changes selectors or numbers in transit or at rest | The signature covers the exact bytes. Any change fails verification and the last good rules stay. HTTPS and HSTS are on watchsync.space, but the signature is the trust, not the transport. |
| **Replay of old files** (a stale mirror or a broken host serves yesterday's file; an attacker replays an old signed file to undo a fix) | Serves an old, validly signed file | The extension never accepts a `seq` at or below the one it has, and keeps that floor after the file expires. Every file also expires (at most 90 days). |
| **Freeze** (the host or network blocks updates) | Keeps people on stale rules | Not preventable from the client. The last good file works until it expires, then the bundled rules apply, which are the same as today's behaviour. |
| **Stolen signing key** | Signs files the extension accepts | Bounded by the schema (below), the 90-day lifetime cap, and the numeric ranges. Cannot run code or reach another host. Recovery: rotate the key (new zip, see runbook). People on the old zip trust the old key until they update, so the exposure lasts as long as old zips are in use and as long as the attacker's file lifetime (at most 90 days each time it is accepted). A leaked key can also set a very high `seq`, which makes old zips refuse real files until they update; they then run on the bundled rules. |
| **Lost signing key** | Nothing; the owner can no longer publish | Existing zips keep the last file until it expires, then use the bundled rules. A new key needs a new zip that everyone downloads again. |
| **Broken or hijacked host** (Railway account, DNS, a bad deploy) | Serves anything at `/rules/v1.json`, or nothing | Without the key it can only serve files that fail verification, old files (replay, above) or nothing (freeze). It cannot sign. A bad deploy that deletes the files only means the next check fails and the bundled or last good rules stay. |
| **Oversize or slow response** | Exhausts memory or hangs the worker | 64 KB and 256 byte caps, 10 s timeout, one request at a time, no redirects. |
| **Old Chrome without Ed25519** | N/A | Key import fails, the file is refused, the bundled rules apply. Nothing is trusted unsigned. |
| **A page or another extension reading or writing the stored rules** | Changes what adapters use | `chrome.storage.local` is private to the extension; pages cannot reach it. Content scripts check the stored value again (schema and selector syntax, expiry) before using it. |

**Worst case from a validly signed malicious file.** It could point the title selector at other
text on the page (a wrong title name goes to the room; names are cut to 200 characters and
stripped of control characters before they are sent), make the ad marker match something always
present (the room would pause for an "ad" that never ends; people can choose "Watch without ..."),
or set drift tolerances at the edge of their range (looser or tighter syncing). It is a nuisance
and a loss of sync, not a code-execution or data-exfiltration path: no field is evaluated, no field
is a URL, and the extension sends nothing new. A very slow selector is limited by the 200-character
and 8-selector caps.

## The signing key

- **Algorithm.** Ed25519. The private key is a PKCS8 PEM; the public key is the raw 32 bytes, base64
  (44 characters), pasted into `apps/extension/src/rules/public-key.ts`.
- **Offline.** The private key lives only on the owner's machine, outside this repository, in a
  folder with mode 700 and a key file with mode 600. It is **never** in the repository, in CI,
  in a Railway variable or in a log. CI does not sign anything. `scripts/sign-rules.mjs` refuses a
  key whose real path is inside the repository and never prints or copies one. Before every commit
  search the tree for the PEM private-key header (the words PRIVATE and KEY side by side); it must
  find nothing.
- **Backup.** A secure note in the owner's password manager holding the PEM and the public key.
  After the first backup, restore it to a temp folder and sign a throwaway file with it to prove
  the backup works.
- **Dev key.** A separate Ed25519 pair signs the dev site's file and is trusted only by dev
  builds. Its private half is at `~/.watchsync/rules-dev-ed25519.pem` (outside the repository).
  The production key is a different key generated by the owner.

## Runbook

All commands run on the owner's machine from the repository root. Nothing here pushes or deploys;
those steps need the owner's yes as always.

### 1. Generate the production key (once)

```bash
mkdir -p ~/.watchsync && chmod 700 ~/.watchsync
node -e '
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
fs.writeFileSync(process.env.HOME + "/.watchsync/rules-prod-ed25519.pem",
  privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
console.log(publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"));
'
```

The printed 44-character line is the public key. Save the PEM file's text and that line in the
password manager now (see Backup above).

### 2. Put the public key in the extension

Edit `apps/extension/src/rules/public-key.ts`: set `PROD_RULES_KEY` to the printed line. That is
the only file that holds a key. Also set `BUNDLED_SEQ` in `bundled.ts` to the highest sequence
published so far (0 before the first production file). Build the zip as usual; it now trusts the
new key.

### 3. Write and sign a rules file

Copy the published file, change it, bump `seq`, set `expires` to about 30 days from now (the
extension refuses more than 90), and sign:

```bash
cp apps/website/public/rules/v1.json /tmp/rules-next.json   # edit seq, expires and the values
node scripts/sign-rules.mjs /tmp/rules-next.json ~/.watchsync/rules-prod-ed25519.pem
```

The tool checks the schema, refuses a `seq` that does not go up, refuses an expiry past 90 days,
verifies its own signature and warns if the key is not the one bundled in `public-key.ts`. It
rewrites `apps/website/public/rules/v1.json` and `v1.json.sig`. Review the diff, commit both, and
deploy the website (dev first). For the dev site use `rules-dev-ed25519.pem` instead.

### 4. Check it is live

```bash
curl -si https://watchsync.space/rules/v1.json | head -20     # 200, Access-Control-Allow-Origin: *
curl -s https://watchsync.space/rules/v1.json.sig
```

In a build that trusts the key, open the popup (this starts a check if a day has passed), then open
the service worker's console from `chrome://extensions` and run
`(await chrome.storage.local.get("rules")).rules`: `file.seq` should be the new one. To force a
check, first run `await chrome.storage.local.remove("rules")` (this also forgets the sequence floor,
so use it on a test profile only).

### 5. Cadence

Re-sign with a new `seq` about every two weeks, with a 30-day expiry, even when no value changed.
If the owner is away and a file expires, people fall back to the bundled rules, which are the same
values as the last zip, so nothing breaks.

### 6. Revoke a bad file

A signed file cannot be recalled, but a higher `seq` replaces it everywhere on the next check
(within a day for open workers). Publish a file whose values equal the bundled ones, with the next
`seq` and a short expiry (for example 7 days). If the key itself is in doubt, rotate (below).

### 7. Rotate or replace the key (leak, suspicion or loss)

1. Generate a new key (step 1) and back it up.
2. Set the new public key in `public-key.ts` and `BUNDLED_SEQ` to the last published `seq`.
3. Build and publish a **new zip**. Old zips trust only the old key, so they keep their last good
   rules until those expire and then use the bundled ones. Tell people to download the new zip.
4. Sign every new file with the new key. The same path serves one file, so from this moment old
   zips refuse it. That is the accepted cost: remote rules reach only people on the new zip.
5. Stop using the old key. If it leaked, delete every copy and note the date here.

After a leak, an attacker holding the old key can still feed old zips, at most 90 days per file,
until they update. This is why the zip is the only real revocation.

### 8. Lost key

Same as rotation, minus step 5. Nothing can be published until the new zip is out.

## Rehearsal

**Local rehearsal (done 15 October 2026).** Two throwaway keys A and B, made in a temp folder
outside the repository, with the real `scripts/sign-rules.mjs` and a model client that holds one
public key and a sequence floor (the extension's own logic is covered by unit and end-to-end tests):

1. Sign seq 1 and seq 2 with A: a client holding A takes both.
2. Rotate: a "new zip" carrying B with floor 2 refuses the A-signed seq 2 still on the site (bad
   signature, keeps seq 2).
3. Sign seq 3 with B: the new zip takes it; the old zip (A) refuses it and keeps seq 2.
4. An attacker with leaked key A signs seq 99: the old zip takes it (the exposure above); the new
   zip refuses it and keeps seq 3.
5. Publishing seq 2 over the published seq 3 is refused by the tool.
6. The unit tests cover a key inside the repository (refused) and the end-to-end test covers old
   sequence, wrong key, tampered bytes, expired file, no network and a good newer file.

**Dev rehearsal (owner-pending, needs a dev deploy).** Before the first production file:

1. Deploy the dev website with the dev file (`seq 1`, already committed) and install the dev zip.
   Confirm the worker stores `seq 1` (step 4 above).
2. Generate a second dev key. Put its public half in `DEV_RULES_KEY`, build a new dev zip, sign
   `seq 2` with the second key, deploy the dev website.
3. Confirm the new dev zip stores `seq 2` and the old dev zip stays on `seq 1`.
4. Record the date and the result here.

Rehearsal on dev: **not done yet**.

## Acceptance criteria (US-125)

1. A written threat model covers tampering, replay, a stolen key and a broken host: this page.
2. The schema allows data only, no code and no URLs: `schema.ts`, tested in `rules.test.ts`.
3. The signing key is kept offline and never in the repository or CI logs: the tool refuses a key
   inside the repository, CI never signs, nothing prints a key. The production key does not exist
   yet; the owner generates it (step 1).
4. Key rotation rehearsed on dev before the first production file, runbook in `docs/`: runbook and
   a local rehearsal are done; the dev-deploy rehearsal is owner-pending.
