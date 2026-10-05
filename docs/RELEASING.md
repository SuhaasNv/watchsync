# Releasing WatchSync

WatchSync ships the way Apple ships iOS: builds go to more people at each stage, the release is
the candidate that was tested, and a bad build is stopped, not patched in flight. All testing
happens on `dev`. `main` carries finished releases only.

```
Apple                       WatchSync                                Who gets it
--------------------------  ---------------------------------------  ---------------------
Internal build / betas      dev branch: "WatchSync Dev" zip          you, friends, testers
Release candidate           a dev build labelled 0.2.0-rc.1          testers, then you
Release (phased)            merge into main, tag v0.2.0, server      everyone
                            first, then the extension
Point release x.y.1         v0.2.1 from main                         everyone
```

## The rules

1. **Dev is for testing, main is for releases.** Every build, beta and release candidate lives on
   `dev`. Nothing on `main` is labelled rc or beta, and the only tags are `vX.Y.Z`.
2. **The label marks a candidate on dev.** `"prerelease": "rc.1"` (or `"beta.2"`) in
   `apps/extension/package.json` names the stage. The dev build shows it: the card at
   `chrome://extensions` and the popup read `0.2.0-rc.1 dev <commit>`, and the `dev-latest`
   release is titled `WatchSync Dev 0.2.0-rc.1 (<commit>)`. Chrome versions are numbers, so the
   manifest version is plain `0.2.0` in every stage.
3. **A release is the tested dev build with the label removed.** The merge commit into `main`
   deletes the `"prerelease"` line (and dates the CHANGELOG section); nothing else that ships
   may differ. A bug found in a candidate is fixed on dev and gets a new candidate (`rc.2`); it
   is never edited on `main`. `scripts/release-guard.mjs` enforces this in the release workflow.
4. **The server goes first and stays compatible.** `main` deploys the room service on Railway
   (and the website) as soon as it is pushed. A new room service must keep working with the
   extension people already have. Watch it, then tag the extension release.
5. **Every push, merge to `main`, tag and deploy needs the owner's yes in that moment.**
   Approval for one does not carry to the next.
6. **`CLAUDE.md` and `docs/PRD.md` stay local** (untracked, in `.gitignore`).

## Steps

```
dev     merge work, CI green, push dev (owner's yes)
        label the build "prerelease": "rc.1"        → dev-latest "WatchSync Dev 0.2.0-rc.1"
        a protocol change: the dev room service deploys before any build that uses it
        test on real Netflix / Prime / JioHotstar with a friend; fix on dev, new rc if needed
main    owner says dev is stable; CI green on the exact dev commit being released:
        merge dev into main (owner's yes). In the merge commit: delete the "prerelease" line,
        date the CHANGELOG [X.Y.Z] section.
        dry run: git tag vX.Y.Z && node scripts/release-guard.mjs vX.Y.Z; git tag -d vX.Y.Z
        push main                                  → Railway deploys the room service + website
        verify live: both deployments succeeded, /health shows X.Y.Z, and a check only the
        new server passes (a room created and joined; a new message field accepted)
tag     tag vX.Y.Z on that merge commit right away (owner's yes): until then the public site
        describes features its download doesn't have
        → the release workflow runs the guard, builds the zip, publishes the release
store   upload that same release zip to the Chrome Web Store (developer dashboard, item
        odlngcfniaebaekgiaaghfehnchgkihc), choose "publish after I approve", submit for review;
        when it passes, publish it (owner's yes) as close to the tag as possible — store users
        update through Chrome, zip users get the GitHub notice
next    when the next version's work starts: merge main back into dev, bump the version and
        label it ("prerelease": "beta.1" or "rc.1")
```

The dev site's release notes list the dev build among the releases by date, newest first, so a
release sits above the candidate it came from until dev moves on.

Before a release: CHANGELOG `## [X.Y.Z]` section in plain words (no planning IDs), the version equal
in `apps/extension/package.json`, `services/signaling/pyproject.toml` and
`services/signaling/app/config.py`. The mechanics of the workflow are in `docs/DEPLOY.md`.

## Rollout and rollback

- **Room service:** deployed from `main` on Railway. If it misbehaves, redeploy the previous
  deployment from the Railway dashboard (rooms end on any restart; say so in the notes). New
  variables go in with deploys skipped, then deploy once.
- **Extension from the website:** the zip is the release. A fix is a higher version
  (`vX.Y.1`), never a replaced file.
- **Chrome Web Store** ([listing](https://chromewebstore.google.com/detail/watchsync/odlngcfniaebaekgiaaghfehnchgkihc),
  listed since v0.1.1, 4 Oct 2026): every release (`vX.Y.Z` only — dev builds and candidates never go to the
  store) is uploaded and reviewed; review usually takes hours to a few days, longer when
  permissions change. The store accepts only a higher version than it has. Once the listing is
  eligible, use staged rollout (a small percentage first) and pause it if reports come in; the
  store cannot go back, so a rollback is a new, higher version.
- **Hotfix:** branch from `main`, fix, merge the fix into `dev` as well, label a dev build, test it,
  then release `vX.Y.1` through the same steps.
