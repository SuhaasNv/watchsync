# WatchSync

## Product Requirements Document (PRD)

---

> ## Scope revision v2 — extension-first (2 October 2026, DEC-015)
>
> This section overrides the release plan, V0.1 definition, MVP definition and V0.1 development sequence below (§7–16, §32, §37–38). Everything else in the original PRD still applies unless it contradicts this section. The original text is kept unchanged below for history and for the v1.1 desktop app.
>
> **Why.** The problem WatchSync was started for is two friends watching their own streaming accounts in sync. A browser extension solves that directly: one install, no camera or mic permissions, no app signing, and it works on Mac and Windows from day one.
>
> **v0.1.0 — Streaming Sync.** A Chrome extension and a small room service.
> 1. Create a room from the extension popup; get a code and a link.
> 2. A friend installs the extension, opens the link or types the code, and joins with just a name.
> 3. Both open the same title on **Netflix, Prime Video or JioHotstar**. If titles differ, WatchSync offers to open the right one.
> 4. Play, pause and jumps sync both ways. **Everyone can control** (DEC-017).
> 5. When someone jumps, everyone follows automatically and sees "Suhaas skipped ahead to 42:10" (DEC-016).
> 6. A small pill shows who's in the room and whether they're in sync. Anyone who drifts gets a **Sync** button. "Watch on my own" lets a person step out and rejoin later.
> 7. Next episode, tab reloads and network drops keep the room together.
>
> **Release plan.**
>
> | Release | Name | Adds |
> |---|---|---|
> | v0.1.0 | Streaming Sync | Rooms, sync on Netflix, Prime Video, JioHotstar |
> | v0.2.0 | Chat & Reactions | Sidebar on the service page with chat and reactions |
> | v0.3.0 | More Services | YouTube, Disney+, then services chosen by demand |
> | v0.4.0 | Voice & Camera | Talk and see each other while watching |
> | v0.5.0 | Groups | Up to 8 people, optional host-only control |
> | v0.6.0 | Smart Sync | Ads, buffering, bad networks |
> | v0.7.0 | Accounts & Social | Optional accounts, friends, history, watchlist |
> | v0.8.0 | Hardening & Public Launch | Security, error reporting, public Chrome Web Store listing |
> | v1.0.0 | Complete WatchSync | Onboarding, settings, accessibility, Edge and Firefox, website |
> | v1.1.0 | Desktop App | Local video files, using the original desktop design below (DEC-018) |
>
> **MVP.** v0.1.0. If two people can reliably watch the same Netflix, Prime Video or JioHotstar title in sync, the core concept is proven.
>
> **v0.1.0 acceptance test.** Two people on two machines, each with their own account, for each of the three services: create room, join by link and by code, same-title check, play, pause, jump forward and back, next episode, drift then Sync, watch on my own then rejoin, close tab and come back.
>
> **Boundary.** The extension reads and commands playback only (state, position, duration, rate, title identity). It never reads frames, touches DRM keys or license traffic, records, downloads or proxies any stream (TRD §37). It is not affiliated with any streaming service and never uses their names or logos as its own.
>
> **Known constraints.** Each person needs their own subscription and access to the same title in their region; JioHotstar is available in India only. Streaming sites change their players; each service has its own adapter so one breaking doesn't break the others.
>
> The detailed plan (use cases, stories, acceptance criteria, sprints) lives in the Notion "WatchSync — Product Plan" (Plan v2).

---

**Product:** WatchSync
**Document Version:** 1.0
**Status:** Product Specification
**Platform:** macOS Desktop Application
**Distribution:** Downloadable `.dmg`
**Product Model:** Social watch-party application
**Development Method:** Agile / Incremental Releases

---

# 1. Executive Summary

WatchSync is a desktop application that lets people watch content together remotely while communicating through video and voice.

The product solves a simple problem:

> People can already watch videos remotely, but existing tools often create a poor experience when users need synchronized playback, private streaming sessions, video calls, and screen sharing in the same experience.

WatchSync combines:

* Watch-party rooms
* Synchronized playback
* Camera
* Microphone
* Screen sharing
* Text chat
* Reactions
* Streaming playback synchronization
* Multiplayer rooms

The product is designed as a **desktop-first application** because desktop applications provide better control over media devices, screen sharing, browser integration, and future native functionality.

The first target platform is **macOS**.

---

# 2. Product Vision

## Vision

> Make watching something together remotely feel almost like sitting next to someone.

WatchSync should make the experience feel:

* Simple
* Fast
* Social
* Reliable
* Private
* Native
* Minimal

A user should be able to:

```text
Open WatchSync
      ↓
Create a room
      ↓
Invite a friend
      ↓
Connect camera + microphone
      ↓
Start watching
      ↓
Stay synchronized
      ↓
Talk and react naturally
```

---

# 3. Problem Statement

Remote watching is fragmented across multiple tools.

A user may currently need:

```text
Streaming service
+
Discord / Google Meet
+
Screen sharing
+
Manual synchronization
+
Messages
```

This creates several problems.

### Problem 1 — Playback synchronization

Two people may not remain at the same playback position.

Example:

```text
Person A: 42:13
Person B: 42:19
```

Even a few seconds of drift makes shared watching frustrating.

---

### Problem 2 — Screen sharing limitations

Some streaming services use protected playback mechanisms that prevent normal screen-sharing workflows from displaying the video correctly.

WatchSync should not attempt to bypass those protections.

Instead, for supported streaming services:

```text
User A's browser
       ↓
Authorized playback
       ↓
WatchSync synchronizes playback state
       ↓
User B's browser
       ↓
User B's authorized playback
```

Each user watches through their own authorized session.

---

### Problem 3 — Social experience

Watching together isn't only about synchronization.

People want to:

* See each other's faces
* Talk
* React
* Chat
* Pause together
* Discuss what is happening

---

### Problem 4 — Existing tools are not optimized for watch parties

General-purpose communication applications prioritize meetings, work calls, or screen sharing.

WatchSync should prioritize:

> **Watching together.**

---

# 4. Target Users

## 4.1 Primary User

People who want to watch videos remotely with friends, partners, or family.

Typical scenario:

```text
User A — Singapore
User B — Dubai

Both want to watch the same movie together.
```

---

## 4.2 Secondary Users

### Long-distance couples

Want:

* Video
* Voice
* Shared watching
* Reactions
* Simple private rooms

### Friends

Want:

* Watch parties
* Group rooms
* Chat
* Reactions

### Students

Want:

* Study videos
* Lectures
* Educational content
* Discussion

### Online communities

Potential future use:

* Group events
* Community watch sessions
* Creator sessions

---

# 5. Product Principles

## Principle 1 — Watching comes first

The product should prioritize the viewing experience over unnecessary social features.

---

## Principle 2 — Simple onboarding

Users should not need technical knowledge.

---

## Principle 3 — Media should stay local whenever possible

WatchSync should avoid unnecessarily routing video through its servers.

---

## Principle 4 — Every release must be useful

Each Agile version must be independently usable and shippable.

---

## Principle 5 — Don't build future complexity early

Do not introduce:

* Databases
* SFUs
* Accounts
* Complex infrastructure

until they are actually required.

---

## Principle 6 — Respect protected streaming

WatchSync should synchronize authorized playback sessions rather than bypassing DRM or protected playback mechanisms.

---

# 6. Product Scope

The complete product will eventually contain:

```text
Room System
     ↓
Video + Audio
     ↓
Playback Synchronization
     ↓
Streaming Synchronization
     ↓
Screen Sharing
     ↓
Chat + Reactions
     ↓
Multiplayer
     ↓
Accounts
     ↓
Social Features
```

---

# 7. Release Strategy

WatchSync will be developed through independent releases.

```text
V0.1
Private Video Room

      ↓

V0.2
Watch Local/Owned Media

      ↓

V0.3
Streaming Watch Party

      ↓

V0.4
Social Room

      ↓

V0.5
Multiplayer

      ↓

V0.6
Smart Synchronization

      ↓

V0.7
Accounts + Social

      ↓

V0.8
Production Hardening

      ↓

V1.0
Complete WatchSync
```

---

# 8. V0.1 — Private Video Room

## Objective

Create the smallest useful version of WatchSync.

Two people should be able to install the application and communicate through camera and microphone.

---

## Features

### Create Room

User clicks:

```text
Create Room
```

Application generates a room.

Example:

```text
Room Code

K7X9Q2
```

---

### Join Room

User enters:

```text
K7X9Q2
```

and joins.

---

### Camera

Users can:

* Enable camera
* Disable camera
* See their own preview
* See the other participant

---

### Microphone

Users can:

* Enable microphone
* Disable microphone

---

### Participant View

For two users:

```text
+-----------------------------+
|                             |
|         Friend              |
|                             |
|                             |
|                  +---------+|
|                  |   You   ||
|                  +---------+|
+-----------------------------+

       🎤    📹    🚪
```

---

### Connection State

Display:

```text
Connecting...
Connected
Reconnecting...
Disconnected
```

---

### Leave Room

User can leave.

---

### Rejoin

User can rejoin using the same room code while the room is active.

---

## V0.1 Acceptance Criteria

A user must be able to:

1. Download `.dmg`
2. Install WatchSync
3. Open the application
4. Create a room
5. Receive a room code
6. Share the room code
7. Friend installs WatchSync
8. Friend enters room code
9. Both connect
10. Both see each other
11. Both hear each other
12. Toggle microphone
13. Toggle camera
14. Leave
15. Rejoin

---

# 9. V0.2 — Watch Your Own Media Together

## Objective

Introduce the actual watch-party experience.

Users can select a video they are authorized to watch and synchronize playback.

---

## Features

### Video Selection

User can select:

```text
Choose Video
```

from their local machine.

---

### Playback Controls

Support:

* Play
* Pause
* Seek
* Playback rate

---

### Synchronization

When Host presses:

```text
PLAY
```

the other participant receives the command.

When Host presses:

```text
PAUSE
```

the other participant pauses.

When Host seeks:

```text
01:24:31
```

the other participant moves to the same position.

---

## Example

User A:

```text
01:23:10
```

User B:

```text
01:23:10
```

Both should remain close to each other during playback.

---

## Sync-on-Join

If User B joins while User A is watching:

```text
User A
01:24:31
PLAYING
```

User B should automatically:

```text
Load video
↓
Seek to approximately 01:24:31
↓
Start playback
```

---

# 10. V0.3 — Streaming Watch Party

## Objective

Allow users to synchronize playback on supported streaming websites.

The streaming content itself remains within each user's authorized browser session.

---

## User Experience

User A:

```text
Open streaming website
        ↓
Open WatchSync
        ↓
Join room
        ↓
Start playback
```

User B:

```text
Open same streaming website
        ↓
Join WatchSync room
        ↓
WatchSync synchronizes playback
```

---

## Supported Events

WatchSync should synchronize:

```text
PLAY
PAUSE
SEEK
PLAYBACK RATE
CURRENT POSITION
MEDIA CHANGE
```

---

## Example

User A presses:

```text
PLAY
```

WatchSync sends:

```text
PLAY
position: 128.42
timestamp: ...
```

User B's authorized browser session receives the command.

---

## Important Product Boundary

WatchSync must NOT:

* Decrypt protected video
* Extract DRM keys
* Capture protected frames
* Circumvent DRM
* Bypass HDCP
* Download protected streams
* Proxy protected streams
* Store protected streaming content

The product only synchronizes playback state.

---

# 11. V0.4 — Social Room

## Objective

Make the watch room feel social.

---

## Features

### Screen Sharing

Users can share:

* Entire screen
* Application window
* Selected display

---

### Camera Overlay

Camera can appear as:

```text
              +------------------+
              |                  |
              |     VIDEO        |
              |                  |
              |           +----+ |
              |           | YOU| |
              |           +----+ |
              +------------------+
```

---

### Chat

Users can send:

```text
"Bro this scene 😭"
```

Messages should appear in the room.

---

### Reactions

Examples:

```text
❤️
😂
😭
🔥
😱
👏
```

Reactions should be lightweight and ephemeral.

---

# 12. V0.5 — Multiplayer

## Objective

Expand WatchSync from two people to small groups.

Target:

```text
2–8 participants
```

---

## Participant Grid

Example:

```text
+----------+----------+
| Person A | Person B |
+----------+----------+
| Person C | Person D |
+----------+----------+
```

---

## Features

* Participant grid
* Active speaker
* Host
* Co-host
* Mute participant
* Remove participant
* Room lock
* Participant list

---

# 13. V0.6 — Smart Synchronization

## Objective

Make synchronization resilient to real-world network conditions.

---

## Features

### Clock Synchronization

Clients synchronize their understanding of server time.

---

### Drift Detection

Example:

```text
User A: 01:23:10.000
User B: 01:23:10.240

Drift: 240ms
```

---

### Small Drift

Use temporary playback-rate adjustment.

Example:

```text
1.00x
↓
1.02x
↓
1.00x
```

---

### Large Drift

Perform a hard seek.

---

### Buffer Awareness

Do not continuously fight the browser's buffering behavior.

---

### Reconnection Recovery

After reconnect:

```text
Reconnect
↓
Authenticate
↓
Rejoin room
↓
Retrieve room state
↓
Retrieve playback state
↓
Synchronize
```

---

# 14. V0.7 — Accounts & Social

## Objective

Turn WatchSync from a temporary room application into a persistent product.

---

## Features

### Accounts

Users can create accounts.

Potential authentication:

* Email
* OAuth

---

### Profile

Profile includes:

* Display name
* Avatar
* Username

---

### Friends

Users can:

* Add friends
* Remove friends
* See online status

---

### Recent Rooms

Show:

```text
Recent Rooms

Friday Movie
Yesterday

Gaming Night
2 days ago
```

---

### Saved Rooms

Users can save frequently used rooms.

---

### Watchlist

Potential future functionality:

```text
Watch Later
```

---

# 15. V0.8 — Production Hardening

Focus entirely on reliability and production quality.

Features:

* Crash reporting
* Error tracking
* Performance monitoring
* Security review
* Reconnection improvements
* Auto updates
* macOS code signing
* macOS notarization
* Better TURN infrastructure
* Production monitoring
* Backup/recovery
* Rate limiting

---

# 16. V1.0 — Complete Product

V1.0 combines the previous releases into a polished WatchSync experience.

The user should be able to:

```text
Open WatchSync
       ↓
Create room
       ↓
Invite friends
       ↓
Connect camera/mic
       ↓
Choose content
       ↓
Watch together
       ↓
Stay synchronized
       ↓
Talk
       ↓
Chat
       ↓
React
       ↓
Screen share
```

---

# 17. Core User Journey

## New User

```text
Download
   ↓
Install
   ↓
Launch
   ↓
Create Room
   ↓
Camera/Mic Permission
   ↓
Room Created
   ↓
Copy Invite
   ↓
Friend Joins
   ↓
Connected
   ↓
Start Watching
```

The user should reach a usable room with minimal setup.

---

# 18. Room Creation UX

Home screen:

```text
WATCHSYNC

Watch together.
Be together.

[ Create Room ]

[ Join Room ]

Settings
```

---

# 19. Join Room UX

```text
Join a room

Enter room code

[ K7X9Q2 ]

[ Join Room ]
```

---

# 20. Watch Room UX

Primary layout:

```text
+--------------------------------------------------+
| WatchSync                              K7X9Q2    |
+--------------------------------------------------+
|                                                  |
|                                                  |
|                  VIDEO AREA                      |
|                                                  |
|                                                  |
|                         +----------------------+ |
|                         |      FRIEND          | |
|                         +----------------------+ |
|                                                  |
+--------------------------------------------------+
| ▶  ━━━━━━━━━━━━━━━  01:24:31 / 02:10:32        |
+--------------------------------------------------+
| 🎤  📹  🖥  💬  ❤️                    Leave 🚪   |
+--------------------------------------------------+
```

The viewing area should remain the primary visual focus.

---

# 21. UX Principles

## Minimal

Avoid unnecessary controls.

---

## Familiar

Use recognizable controls:

```text
Play
Pause
Mute
Camera
Screen Share
Chat
Leave
```

---

## Responsive

Room state changes should feel immediate.

---

## Clear Connection Status

Users should always understand whether they are:

```text
Connected
Connecting
Reconnecting
Disconnected
```

---

# 22. Permissions

WatchSync will require permissions for:

### Camera

Required for video calls.

### Microphone

Required for voice.

### Screen Recording

Required for screen sharing on macOS.

The application must clearly explain why permissions are needed.

---

# 23. Privacy

WatchSync should follow a privacy-first approach.

The application should not unnecessarily store:

* Camera recordings
* Microphone recordings
* Screen recordings
* Local videos
* Protected streaming content

Media should generally be transmitted peer-to-peer where practical.

---

# 24. Room Privacy

Rooms should be private by default.

Room IDs should be difficult to guess.

Users should enter through:

```text
Room Code
```

or invitation.

Future versions may support:

* Password-protected rooms
* Room lock
* Invite-only rooms

---

# 25. Error Handling

The product must clearly handle:

### Camera permission denied

Display:

```text
Camera access is disabled.

Enable Camera access in macOS Settings
to turn on your camera.
```

---

### Microphone permission denied

Display:

```text
Microphone access is disabled.

Enable Microphone access in macOS Settings.
```

---

### Connection failure

Display:

```text
Connection lost.

Reconnecting...
```

---

### Room expired

Display:

```text
This room is no longer available.
```

---

# 26. Success Metrics

The first releases should focus on product reliability rather than growth.

## V0.1

Track:

* Room creation success
* Room join success
* WebRTC connection success
* Camera permission success
* Microphone permission success
* Reconnection success
* Crash rate

---

## V0.2

Track:

* Playback synchronization success
* Median playback drift
* Sync recovery success
* Video loading failures

---

## V0.3

Track:

* Extension connection success
* Playback event synchronization
* Browser connection failures
* Unsupported provider detection

---

## V0.4+

Track:

* Room duration
* Participants per room
* Chat usage
* Screen-share usage
* Reconnection rate
* Session completion

---

# 27. Product Quality Targets

Initial targets:

### Startup

Target:

```text
< 3 seconds
```

on a modern Mac.

---

### Playback Drift

Under stable network conditions:

```text
Target median drift < 200ms
```

---

### Signaling

Normal signaling latency:

```text
< 200ms
```

---

### Reliability

The application should gracefully recover from:

* Temporary network loss
* Wi-Fi changes
* WebSocket disconnects
* WebRTC ICE failures
* Browser extension disconnects

---

# 28. Analytics Principles

Analytics should be minimal and privacy-conscious.

Do not collect:

* Video content
* Microphone recordings
* Camera recordings
* Screen recordings
* DRM information
* Streaming credentials
* Passwords
* Private chat content unless explicitly required and disclosed

Prefer anonymous operational metrics.

---

# 29. Security Requirements

The product must:

* Use HTTPS
* Use secure WebSockets
* Use short-lived room tokens
* Validate room membership
* Validate host actions
* Rate-limit room creation
* Rate-limit joining
* Rate-limit WebSocket messages
* Sanitize chat messages
* Validate all client input
* Avoid exposing secrets in the client
* Avoid logging authentication tokens

---

# 30. Future Product Possibilities

These are explicitly outside the initial roadmap but may be considered later.

### Smart recommendations

```text
What should we watch?
```

### Watch history

```text
Recently watched together
```

### Group scheduling

```text
Friday 9 PM
Movie Night
```

### Reactions timeline

```text
01:23:14 ❤️
01:25:31 😂
01:31:08 😱
```

### Shared watchlists

Friends could collaboratively maintain:

```text
Watch Together
```

---

# 31. What We Will NOT Build Early

To prevent scope explosion, do NOT initially build:

* Complex recommendation algorithms
* Native mobile apps
* Smart TVs
* Social feeds
* Public communities
* Payments
* Subscription billing
* AI recommendations
* Large-scale infrastructure
* Advanced moderation
* Complex friend graphs
* Enterprise functionality

The product should first prove:

> **Two people can reliably watch together.**

---

# 32. MVP Definition

The true MVP is **V0.1 + V0.2**.

MVP capability:

```text
Create Room
     ↓
Friend Joins
     ↓
Camera
     +
Microphone
     ↓
Choose Local/Authorized Video
     ↓
Play
     ↓
Pause
     ↓
Seek
     ↓
Stay Synchronized
```

If this works reliably, WatchSync has validated its core product concept.

---

# 33. Agile Development Rules

Every release must produce a usable artifact.

For example:

```text
V0.1
watchsync-v0.1.0.dmg

V0.2
watchsync-v0.2.0.dmg

V0.3
watchsync-v0.3.0.dmg
```

Each version must have:

* Version number
* Changelog
* Release notes
* Tests
* Documentation
* Build artifact
* Git tag
* Working installation

---

# 34. Definition of Done

A feature is not considered complete until:

* Implementation exists
* UI exists
* Error states exist
* Tests exist
* Feature works end-to-end
* Existing functionality still works
* Documentation is updated
* No obvious console/runtime errors remain

---

# 35. Release Gate

Before starting the next version:

```text
Build
  ↓
Install
  ↓
Run
  ↓
Test core workflows
  ↓
Fix regressions
  ↓
Create release
  ↓
Tag Git
  ↓
Move to next version
```

Never move to V0.2 if V0.1 is broken.

---

# 36. Claude Code Implementation Instructions

Claude Code must follow these rules.

## Rule 1

Implement only the current release.

If the project is currently:

```text
V0.1
```

do not implement V0.2, V0.3 or V1.0.

---

## Rule 2

Do not create fake implementations.

For example, do not create:

```text
"Coming soon"
```

and call the feature complete.

---

## Rule 3

Use vertical slices.

Instead of building:

```text
All frontend
+
All backend
+
All database
```

build complete workflows:

```text
Create room
→
Join room
→
Connect
→
Camera
→
Microphone
```

---

## Rule 4

Keep architecture extensible.

V0.1 should not contain unnecessary complexity, but future functionality should not require rewriting the entire application.

---

## Rule 5

Prioritize working software.

When choosing between:

```text
Complex architecture
```

and

```text
Simple architecture that works
```

choose the simple architecture.

---

## Rule 6

Do not unnecessarily route media through the backend.

Use:

```text
Client A
   ↕
WebRTC
   ↕
Client B
```

rather than:

```text
Client A
   ↓
WatchSync Server
   ↓
Client B
```

for media whenever possible.

---

# 37. Initial V0.1 Development Task

Claude Code must begin with **V0.1 only**.

### Build:

```text
WatchSync macOS Desktop App
```

using:

```text
Tauri 2
React
TypeScript
Vite
FastAPI
WebSockets
WebRTC
```

---

## V0.1 Development Sequence

### Step 1

Initialize repository.

### Step 2

Create Tauri desktop application.

### Step 3

Create React UI.

### Step 4

Create FastAPI signaling service.

### Step 5

Implement room creation.

### Step 6

Implement room joining.

### Step 7

Implement WebSocket connection.

### Step 8

Implement WebRTC signaling.

### Step 9

Implement camera.

### Step 10

Implement microphone.

### Step 11

Implement mute.

### Step 12

Implement camera toggle.

### Step 13

Implement participant UI.

### Step 14

Implement reconnection.

### Step 15

Test on two clients.

### Step 16

Build macOS `.dmg`.

### Step 17

Verify installation.

### Step 18

Tag:

```text
v0.1.0
```

---

# 38. V0.1 Final Acceptance Test

Two separate Macs must be able to complete:

```text
Mac A
  ↓
Install WatchSync
  ↓
Launch
  ↓
Create Room
  ↓
Copy Room Code

Mac B
  ↓
Install WatchSync
  ↓
Launch
  ↓
Enter Room Code
  ↓
Join

Both
  ↓
WebRTC Connected
  ↓
Camera visible
  ↓
Microphone working
  ↓
Mute/unmute
  ↓
Camera on/off
  ↓
Leave
  ↓
Rejoin
```

Only after this entire workflow works should development move to V0.2.

---

# 39. Product North Star

WatchSync should ultimately make this experience feel effortless:

> **“Let's watch something together.”**

The user should not have to think about:

* Networking
* WebRTC
* Signaling
* Playback clocks
* Drift
* TURN
* Browser extensions
* Infrastructure

They should simply:

```text
Create room.
Invite friend.
Press play.
Enjoy.
```

---

# 40. Final Product Direction

WatchSync is not intended to become another generic video-conferencing application.

Its primary identity is:

> **A social watch-together application with reliable synchronization.**

Communication exists to enhance watching.

The product hierarchy should therefore remain:

```text
1. Watching
2. Synchronization
3. Social presence
4. Communication
5. Additional social features
```

The initial engineering priority is not scale.

It is proving that the core experience works beautifully for two people.

**Start with V0.1. Ship it. Validate it. Then build V0.2.**
