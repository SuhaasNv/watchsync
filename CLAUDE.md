# WatchSync — CLAUDE.md

Engineering operating manual for Claude Code. It says how to work in this repository. It does not restate the product or the architecture; those live in the documents listed in §2. Read the relevant sections of those documents instead of guessing, and do not read them end to end unless the task needs it.

**Current release: v0.1.0, Streaming Sync (Netflix, Prime Video, JioHotstar). Release candidate on `dev`, room service live on Railway. Current sprint: S04. Next: UC-012 release acceptance test with two people on real accounts, then `dev` → `main` and tag (owner approves each push).**
Update this line when a release is tagged or a sprint changes. Work on the current release only.

**Notion plan:** [WatchSync — Product Plan](https://app.notion.com/p/3ed339c78c3381bf9668f9a82c565d61) (Plan v2, extension-first; databases: Releases, Epics, Use Cases, Stories, Decisions, Bugs). The older desktop-first plan is kept as "Product Plan v1 (superseded)" for the v1.1 desktop app.

---

## 1. What WatchSync is

A browser extension (Chrome first) that keeps friends' streaming tabs in sync. Each person plays the title in their own logged-in tab on Netflix, Prime Video or JioHotstar; WatchSync passes play, pause, jumps and position between them through a small room service. Chat, reactions, voice and camera, more services and groups follow. A desktop app for local files comes in v1.1 (DEC-015, DEC-018).

Product principle: make watching something together remotely feel almost like sitting next to someone.

Releases (each independently usable): v0.1 Streaming Sync → v0.2 Chat & Reactions → v0.3 More Services → v0.4 Voice & Camera → v0.5 Groups → v0.6 Smart Sync → v0.7 Accounts & Social → v0.8 Hardening & Public Launch → v1.0 Complete → v1.1 Desktop App.

---

## 2. Documents and precedence

| Document | Owns |
|---|---|
| `docs/PRD.md` | Why the product exists, who it is for, requirements. **Read the "Scope revision v2" section at the top first**; it overrides the original release plan below it |
| `docs/TRD.md` | Architecture, protocols, APIs. Its "Scope revision v2" section at the top says which parts apply now and which move to the v1.1 desktop app |
| `docs/TECH-STACK.md` | Concrete tools, packages, environments, CI/CD, hosting and deployment per component |
| [Design canvas](https://claude.ai/artifact/XmU6n1KqZTYcagEbzKVgEN) | Visual source of truth: tokens, components, motion, and screens. The "Extension" page covers v0.1–v0.4; desktop pages apply to v1.1 |
| `docs/PLANNING.md` | Specification of the Notion planning system. Not the plan itself |
| Notion plan | Releases, epics, use cases, stories, acceptance criteria, sprints, bugs, decisions |
| `CLAUDE.md` | How Claude Code behaves |

Precedence: `CLAUDE.md` > PRD > TRD > Notion plan > sprint > story > task. The PRD owns what and why; the TRD owns how.

If two documents disagree, or the code disagrees with a document: stop, name the conflict, and ask. Do not silently pick a side. Record the outcome as a Decision (§13).

---

## 3. Release discipline

- Work on the current release only. Do not build later-release functionality because the architecture could support it.
- If asked for work that belongs to a later release, say so and stop:
  `This belongs to v0.X. The current release is v0.Y. I will not implement it unless explicitly requested.`
- Do not start release N+1 until release N passes its acceptance test. Before moving on, verify the previous release still works.
- Do not introduce databases, accounts, voice, SFUs, Redis, queues or extra services before a release needs them.
- No fake completion: no "coming soon" stubs presented as finished features.
- Prefer vertical slices (a complete user workflow on one service) over horizontal layers.

### Scope control

Implement exactly the story at hand. If you are on `US-023` (jumps), do not also add chat, reactions, voice, accounts or new services. If you spot a useful improvement, record it as a backlog suggestion or a Decision. Do not implement it.

---

## 4. Session start protocol

1. Read this file.
2. Check repository state: `git status`, current branch, recent commits.
3. Read the PRD/TRD sections relevant to the task (revision sections first).
4. Identify the current release, sprint, use case and story in Notion.
5. Inspect the related code.
6. Continue from what the repository actually contains. Do not assume a previous session finished anything; verify.

Find the work in Notion: the Use Cases board shows what is In progress; the Stories "Current sprint" view shows the sprint. Work the lowest-numbered Not started use case in the current sprint unless the user says otherwise. If Notion is not reachable, do not invent IDs; ask which use case to work on.

---

## 5. Working a use case and its stories

One use case = one branch. Stories are the commits on that branch.

```text
1. Pick the use case (UC-xxx). Check its open Decisions are Accepted.
   Ask the product-manager persona to confirm scope and acceptance criteria.
2. git switch dev && git pull (if a remote exists) && git switch -c feature/UC-xxx-short-name
3. Notion: set the use case and its first story to In progress.
4. For each story (US-xxx), in order:
   read story → read acceptance criteria → check dependencies → inspect code
   → plan the minimal change → implement → test → verify each criterion
   → commit feat(US-xxx): … → tick its criteria and DoD in Notion → set story Done
5. When every story is Done: rebase on dev, review the diff, run the full checks,
   ask the project-manager persona for the merge gate, and only on Go:
   merge into dev (--no-ff), tick "Merged to dev" and the merge checklist, set the use case Done.
6. Report with the summary format in §18.
```

The branch name is in the use case's Branch field. Never work two use cases on one branch. Never commit straight to `dev` or `main`.

- A story describes user value ("As a participant, I want…, so that…"). Technical work is a task, not a story.
- Acceptance criteria use Given / When / Then. Verify each one; do not assume.
- If requirements are ambiguous and the ambiguity affects architecture or user experience, ask one concise question. If it is minor, pick the simplest reasonable behavior and state the assumption.
- Push back when a requested approach adds significant unneeded complexity, a security or privacy problem, major cost, an unnecessary dependency, or architectural inconsistency. Say so plainly and propose a simpler option.
- Do not re-litigate recorded decisions without new evidence.
- Do not optimize on assumptions. Measure, find the bottleneck, then optimize.

### Changing a requirement

Never change a requirement by changing the code. Identify the change → assess impact → update the PRD if needed → update Notion → record a Decision → update the TRD if architecture changes → then implement.

---

## 6. Hard boundaries

**Protected content (DRM).** The extension reads and commands playback only: playing or paused, position, duration, rate, title and episode identity. It never reads video frames, captures the screen of a protected player, touches decryption keys or license traffic, downloads, records, proxies or stores any stream (TRD §37). If a task would cross this line, refuse and flag it.

**Service terms and branding.** Never use a service's name or logo as WatchSync's name or icon. Describe support as "works with Netflix, Prime Video and JioHotstar", never as an official integration. No scraping of catalogues or accounts.

**Privacy.** The service stores rooms, names and playback state only. No viewing history before accounts (v0.7), and after that only metadata the user can turn off and clear. Add telemetry only when you can name the product question it answers.

**Extension permissions.** Host permissions only for supported service domains; no `<all_urls>`. Each permission is justified in the store listing. Content scripts send nothing from the page except playback state.

**Secrets.** Never commit secrets, API keys, tokens or TURN credentials. The extension bundle holds only public URLs. Keep `.env.example` current; never commit `.env`.

**Input and authorization.** Validate everything that crosses a boundary: room codes, room tokens, WebSocket messages, playback commands, chat messages, and every message between page, content script, background worker and popup. The server verifies room membership on every operation; never trust the client. Room codes and tokens come from a cryptographically secure generator.

**Logging.** Logs carry timestamp, component, event, severity and room session ID. Never log tokens, titles a user is watching, chat text, page URLs with personal data, or anything from the player beyond playback state.

---

## 7. Stack

Changing any of this requires a Decision. Details are in `docs/TECH-STACK.md`.

- **Extension (v0.1+):** Chrome Manifest V3, TypeScript (strict), Vite build, React for popup and sidebar UI, shadow DOM for anything injected into a service page, `chrome.storage` for local state
- **Room service (v0.1+):** Python 3.12+, FastAPI, Pydantic, WebSockets, Uvicorn (one worker while rooms are in memory)
- **Voice and camera (v0.4+):** WebRTC peer to peer from an extension-origin frame; managed TURN (DEC-012); SFU for groups in v0.5 (DEC-007)
- **Data:** none until v0.7 (rooms in memory). Redis only if more than one instance is needed. PostgreSQL from v0.7
- **Desktop app (v1.1):** Tauri 2, React, Rust (Plan v1 design)
- **Infra:** Railway for the room service; GitHub Actions for CI; Chrome Web Store for distribution

---

## 8. Architecture guardrails

**Extension parts and who talks to whom.**

```text
service page ──(page-context bridge, only if DEC-019 needs it)──► content script
content script (adapter + overlay UI in shadow DOM) ◄──messages──► background service worker
background service worker ◄──WebSocket──► room service
popup ◄──messages──► background service worker
```

- The background worker owns the room connection. MV3 workers sleep; reconnect on wake and never assume the socket is still open (US-035).
- Messages between contexts use typed envelopes validated on receipt, like the WebSocket protocol.
- Overlay UI (presence pill, notices, Sync button, later the sidebar) lives in a shadow root so the service's CSS can't break it and ours can't break the player. It must work in full screen.

**Provider adapters.** One `StreamingProvider` adapter per service in its own folder, implementing detect, getState and commands (play, pause, seek). Sync logic never contains service-specific code. Adding a service touches only its adapter and the supported-sites list. Each adapter follows the method recorded in DEC-019.

**Echo control.** A change applied by WatchSync must never be re-broadcast as a user action. Adapters tag or suppress self-caused events.

**Playback state.** The server holds the room's playback state (status, position, rate, updatedAt, by whom) and stamps changes with server time. Clients compute the expected position and correct drift with configurable thresholds (never hardcoded in UI). Everyone can control (DEC-017); jumps auto-follow with a notice (DEC-016).

**WebSocket protocol.** Every message uses the typed envelope `{ id, type, timestamp, payload }`. Types live in `packages/protocol`; do not send ad-hoc messages. Validate on receipt.

**Protocol types.** One source of truth (`packages/protocol`, DEC-006). Do not hand-copy types between TypeScript and Python.

**Backend layering.** Thin route → service → domain logic → infrastructure. Validate with Pydantic. Predictable error responses.

**Voice and camera (v0.4).** Media goes through a `MediaTransport` interface so P2P can be swapped for an SFU in v0.5 without touching UI. The room service never carries media.

**Cross-platform.** The extension runs on any OS with Chrome. Keep it standard: no OS-specific code in the extension. The desktop app (v1.1) keeps its macOS code in one platform module so a Windows port stays cheap.

**Infrastructure.** Extension + room service only until a release needs more. No Kubernetes, microservices, queues or caches without a concrete requirement.

---

## 9. Repository layout

```text
apps/extension/      Chrome MV3 extension (src/background, src/content, src/popup, src/adapters/<service>, src/overlay)
services/signaling/  FastAPI room service
packages/            protocol, sync-engine, shared-types, validation
apps/website/        Marketing site and docs (v1.0)
apps/desktop/        Tauri app (v1.1)
docs/                PRD.md, TRD.md, TECH-STACK.md, PLANNING.md, spikes/, releases/
.github/workflows/
```

Folders appear when their release needs them, not before. Organize by feature. Split a file by responsibility when it becomes hard to understand.

---

## 10. Code standards

**TypeScript.** Strict mode. No `any`; use `unknown` with narrowing, and justify any unavoidable exception at the site. Type all parameters, props, state and messages. No unchecked casts.

**React (popup, sidebar).** Function components and hooks. Small components, explicit state ownership, logic out of JSX. Every effect that adds a listener, timer, port, MediaStream or RTCPeerConnection cleans up after itself.

**Content scripts.** Do as little as possible on the page: observe the player, apply commands, render the overlay. No global CSS, no changes to the service's DOM beyond the shadow host. Remove everything on leave.

**Python.** Type hints throughout. Do not block the event loop in async handlers.

**Errors.** Never swallow errors. Log appropriately, show user-facing feedback when relevant, preserve state, support recovery. When an adapter can't read or control the player, say so in plain words instead of failing silently.

**Loading states.** Every asynchronous user-facing operation has a visible state (creating room, joining, connecting, reconnecting).

**Accessibility.** Semantic HTML, keyboard navigation, accessible labels on icon-only controls, visible focus, adequate contrast, reduced motion respected.

**UX.** Minimal and calm. The service's picture is the focus. WatchSync's overlay stays small and fades with the service's own controls.

**Dependencies.** Before adding one: check existing dependencies, maturity, maintenance, size and necessity. Extensions ship every byte to every user; prefer fewer.

---

## 11. Testing and verification

- Write tests alongside the implementation, not after.
- **Unit:** sync and drift math (including negative drift), room state, message validation, adapters against recorded player-state fixtures.
- **Integration:** room service create/join, WebSocket flows, reconnection, rate limits.
- **Extension E2E:** Playwright loads the unpacked extension in Chromium against a local mock player page to test popup, messaging, overlay and sync logic. Real services can't run in automated Chromium (no DRM support), so:
- **Real-service acceptance:** two people, two machines, two Chrome profiles with their own accounts, on Netflix, Prime Video and JioHotstar, following the release acceptance test in Notion. JioHotstar needs Indian access.
- Before claiming work is done, run the tests, type check, lint and build, and read the output.
- Use only commands that exist in the repository's scripts. Do not invent commands.
- Report status with these words and no others: **Implemented**, **Tested**, **Partially tested**, **Untested**, **Blocked**. Never say "done" or "production ready" without verification. If something fails, say so and quote the output.

---

## 12. Debugging

Reproduce → observe → locate the failure boundary → read logs → form a hypothesis → make the smallest fix → test → verify. Do not rewrite a system as a first response to a failure.

**Sync failures:** check which context dropped the message (page, content script, background, service), echo suppression, expected vs actual position, server timestamps, ad or buffering state, and whether the adapter's method still works on the current version of the service.

**Adapter breaks after a service update:** log a bug, confirm with the DEC-019 method, fix only the adapter, add a fixture for the new behaviour.

---

## 13. Git, Notion, and decisions

**IDs.** Releases `v0.1.0`…, epics `E01`…, use cases `UC-001`…, stories `US-001`…, decisions `DEC-001`…, bugs `BUG-001`…. These are the IDs in the Plan v2 Notion databases; use them in branches, commits, PRs and test names.

**Branches (DEC-009).**

```text
main  ← released code only; changes only by merging dev at release, tagged vX.Y.Z
 └─ dev  ← integration branch; every use case merges here
     ├─ feature/UC-001-scaffolding
     ├─ feature/UC-002-player-control-spike
     └─ fix/BUG-001-netflix-seek-error
```

- One branch per use case, created from `dev`, named exactly as the use case's Branch field.
- Bug fixes branch from `dev` as `fix/BUG-xxx-short-name`.
- A use case merges into `dev` only when its stories are Done and the project-manager gate says Go.
- At release: the Ship use case (UC-012, UC-016, …) runs the acceptance test, then `dev` merges into `main` and gets the tag.

**Commits.** `<type>(<ID>): <short description>`, under 50 characters, with the reason in the body. `feat(US-021): sync play and pause`, `fix(BUG-001): use player API for Netflix seek`. Types: `feat`, `fix`, `test`, `docs`, `chore`, `perf`, `refactor` (refactor only on explicit request). No vague messages.

**No AI attribution.** No `Co-Authored-By` trailers and no "Generated with" footers in commits or PR descriptions.

**Pushing.** Never `git push` without asking first, every time. Approval for an earlier push does not carry over.

**Before committing.** Review `git diff` for accidental changes, debug statements, secrets, unused imports, dead code and unrelated edits. Remove them.

**PRs.** Use the template in `docs/PLANNING.md` §47.

**Notion.** Notion is the planning source of truth; Git is the implementation source of truth. Statuses: **Not started** → **In progress** (branch exists) → **Done** (every criterion and DoD item ticked, tests pass; for a use case, also merged into `dev`). Update Notion as you go. When Notion and code disagree: stop → identify the conflict → determine the intended requirement → record a Decision → sync both → continue. If Notion is unavailable, append to `docs/DECISIONS.md` and sync later.

**Bugs go to Notion, every time.** When you find a defect in code that is already committed (on `dev`, `main`, or an earlier story on the current branch), from a failing regression test, an acceptance test, a review, a service update, or a user report: create a row in the Notion **Bugs** database before fixing it.
- Title `BUG-xxx — short symptom` (next free number). Severity, Found in, Found during, Provider, Use Case, Status Not started, Fix branch `fix/BUG-xxx-short-name`.
- Body: steps to reproduce, expected, actual, and fix notes once known.
- Fix on `fix/BUG-xxx-short-name` from `dev` with commits `fix(BUG-xxx): …`; add a regression test; set the bug Done and fill Fixed in when merged into `dev`.
- If the bug blocks the current use case, say so and ask whether to fix it first.
- A test that fails while you are still writing the current, uncommitted story is ordinary work, not a bug.
- If Notion is unreachable, append the bug to `docs/BUGS.md` and sync it later.

**Merging.** Local merges into `dev` follow the checklist above. Merging into `main` and creating tags happen only in a Ship use case. Pushing any branch or tag still needs the user's approval each time.

**Decisions.** Record anything that changes architecture or product behavior, with context, options, choice, reason and impact. Do not reopen a recorded decision without new evidence.

---

## 14. Definition of done

**A story is done when:** the code exists; each acceptance criterion is verified in a real Chrome profile; tests pass; error and loading states exist; type check, lint and formatting pass; nothing regressed; docs are updated where behavior changed materially.

**A release is done when:** all committed use cases are Done; tests and regression checks pass; critical bugs are resolved; the extension is packaged and installed in clean Chrome profiles on two machines; the release acceptance test passes with two people on every supported service; the room service is deployed; `CHANGELOG.md` and release notes are written; the version is bumped (semver); and the tag exists.

---

## 15. Editing rules

- Read the relevant part of a file before modifying it.
- Before large changes, inspect the repository. Never overwrite existing features, tests, configuration or documentation blindly.
- Before changing a message type or API, search for every consumer (extension contexts, service, tests) and change them together.
- Make the smallest safe change. Do not refactor unless explicitly asked.

---

## 16. Documentation

Update documentation when behavior changes materially: `README.md`, `docs/`, the supported-services list. Every release gets a `CHANGELOG.md` entry (Added / Fixed / Known Issues) and release notes.

---

## 17. Open decisions

Tracked in the Notion Decisions database with status Open. Resolve each before the work that depends on it; ask the user, then mark it Accepted.

1. **DEC-005 Package manager** (during UC-001). Proposal: pnpm workspaces; uv for Python.
2. **DEC-006 Protocol type source** (during UC-001). Proposal: JSON Schema with generated TS, Zod and Pydantic, plus a CI drift check.
3. **DEC-019 How each player is read and controlled** (end of UC-002). Decided by the spike.
4. **DEC-020 How friends install v0.1** (before UC-012). Proposal: unlisted Chrome Web Store listing.
5. **DEC-021 Services after the first three** (before UC-018).
6. **DEC-012 TURN provider** (before UC-021, v0.4).
7. **DEC-007 SFU** (before UC-024), **DEC-013 Email** (before UC-029), **DEC-014 Website** (before UC-038).

Full tool-by-tool proposals are in `docs/TECH-STACK.md`.

---

## 17a. Personas: product manager and project manager

Two project subagents live in `.claude/agents/`. Consult them through the Agent tool; they never write product code.

| Persona | Owns | Consult it |
|---|---|---|
| `product-manager` | User value, scope, PRD fit, priorities, acceptance criteria quality | Before starting a use case; when a requirement is unclear; when a new idea or feature request appears; when the user asks "what does the product manager say" |
| `project-manager` | Sequence, branches, Definition of Done gates, Notion status, bug logging, release gates | At sprint start; before every merge into `dev`; at every release gate; when a bug is found; when the user asks "where are we" or "what's next" |

Their verdicts are advice to you and the user, not orders. If a persona says No go, stop and report why; the user decides whether to override.

## 18. Communication

Be direct, technical, honest and concise. A short implementation summary beats a long explanation. Explain meaningful tradeoffs. Say plainly when something is broken or uncertain.

At the end of meaningful work, report:

```text
WatchSync Development Summary
Current Release:   v0.X
User Story:        US-XXX
Implemented:       - ...
Tests:             - ...
Acceptance Criteria: ✓ / ✗ each
Files Changed:     - ...
Known Issues:      - ...
Notion Status:     ...
Next Step:         ...
```

---

## 19. Relationship to the global CLAUDE.md

`~/.claude/CLAUDE.md` still applies where it is not specific to the Next.js portfolio. Its Next.js, Framer Motion and `npm run build` rules do not apply here. Its general rules do: never push without asking, no AI attribution in commits or PRs, propose before multi-file or large changes, and no `any`.

---

The goal is not the most code. It is the best working product through controlled, incremental releases, one validated vertical slice at a time: understand → plan → implement → test → verify → ship → learn.
