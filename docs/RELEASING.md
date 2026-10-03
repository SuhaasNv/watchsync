# Releasing WatchSync

WatchSync follows Apple's way of shipping iOS: a build reaches more people at each stage, the
last candidate ships unchanged, and a bad build is stopped, not patched in flight.

```
Apple                       WatchSync                          Who gets it
--------------------------  ---------------------------------  ----------------------
Internal build (TestFlight) dev branch, "WatchSync Dev" zip    you, a friend
Beta 1, 2, 3                vX.Y.Z-beta.N (pre-release)        testers with its link
Release candidate           vX.Y.Z-rc.N                        friends from the website
Phased release, pausable    room service first, then the       everyone, in steps
                            extension; store staged rollout
Point release x.y.1         vX.Y.1 from main                   everyone
```

## The rules

1. **Dev first.** Everything merges into `dev` and is tested there. Every push to `dev` that
   passes CI refreshes the `dev-latest` pre-release and the dev site. Production does not move.
2. **A release candidate ships as is.** `vX.Y.Z-rc.N` means: if nothing blocking turns up, this
   exact build is the release. A bug means a new candidate (`rc.N+1`), never an edit between the
   last candidate and the final.
3. **The final is the last candidate, label removed.** The only change allowed between the last
   `rc` and `vX.Y.Z` is deleting `"prerelease"` from `apps/extension/package.json` (plus
   `CHANGELOG.md`, docs and the website). `scripts/release-guard.mjs` enforces this in the
   release workflow: it fails if shipped files (`apps/extension`, `packages`, `services`) differ.
4. **The server goes first, and stays compatible.** A new room service must keep working with the
   extension people already have. Deploy it, watch it, then release the extension.
5. **Every push, merge to `main`, tag and deploy needs the owner's yes in that moment.**
   Approval for one does not carry to the next.
6. **`CLAUDE.md` and `docs/PRD.md` stay local** (untracked, in `.gitignore`).

## Naming

Chrome versions are plain numbers, so the extension is `0.2.0` in every stage. The stage lives in
`"prerelease"` in `apps/extension/package.json` (`"rc.1"`, `"beta.2"`, or no line for a final)
and in the tag. The build shows it: the manifest's `version_name` and the popup read
`0.2.0-rc.1`, a dev build reads `0.2.0-rc.1 dev <commit>`.

The tag, the version and the label must agree. The release workflow stops with a clear error if
they do not.

## Steps

```
dev    merge, CI green, push dev (owner's yes)         → dev-latest + dev site
       test on real Netflix / Prime / JioHotstar
beta   set "prerelease": "beta.1", commit, tag v0.2.0-beta.1 (owner's yes)
       → pre-release, not offered by the site's download link or the update check
rc     set "prerelease": "rc.1", merge dev into main (owner's yes), tag v0.2.0-rc.1
       → normal release, the site's download now serves it
final  delete the "prerelease" line, tag v0.2.0 (owner's yes)
       → the guard checks it equals the last rc; the release is published
```

Before any tag: CHANGELOG `## [X.Y.Z]` section written in plain words, versions equal in
`apps/extension/package.json`, `services/signaling/pyproject.toml` and
`services/signaling/app/config.py`. The mechanics of the workflow are in `docs/DEPLOY.md`.

## Rollout and rollback

- **Room service:** deploy from `main` on Railway. If it misbehaves, redeploy the previous
  deployment from the Railway dashboard (rooms end on any restart; say so in the notes).
  New variables go in with deploys skipped, then deploy once.
- **Extension from the website:** the zip is the release. A fix is a higher version
  (`vX.Y.1`), never a replaced file.
- **Chrome Web Store (when the listing is live):** use staged rollout (a small percentage first,
  then more) and pause it if reports come in; stores do not allow going back, so a rollback is a
  new, higher version.
- **Hotfix:** branch from `main`, fix, tag `vX.Y.1-rc.1`, then `vX.Y.1`. If it is urgent and
  there is no time for a candidate, set the repository variable `RELEASE_GUARD_SKIP_RC=1` for
  that one tag, and say so in the release notes.
