# WatchSync

## Technical Requirements Document

---

> ## Scope revision v2 — extension-first (2 October 2026, DEC-015)
>
> The product now starts as a Chrome extension (PRD "Scope revision v2"). This section says which parts of this TRD apply now. The original text below is unchanged.
>
> **Applies from v0.1:** §1–3 principles (control plane vs media plane, keep media off the server), §7–8 backend, §9 database strategy, §10–16 rooms and WebSocket protocol (minus RTC.* until v0.4), §26–33 playback state and server clock, §36–41 protected streaming mode (now the core of v0.1), §43–44 chat and reactions (v0.2), §45–46 connection state and reconnection, §53–59 security, privacy, telemetry, logging, §65–68 CI and testing (adapted for an extension), §73–79 workflow, config and deployment.
>
> **Changes:**
> - **No native messaging in v0.1.** The extension talks to the room service directly over WebSocket from its background service worker. Native messaging (§38–39) only returns if the v1.1 desktop app needs to talk to the extension.
> - **Provider adapters are the core.** `StreamingProvider` (§80) is implemented for Netflix, Prime Video and JioHotstar in v0.1. How each player is read and controlled is decided by a spike (DEC-019); Netflix errors (M7375) when its video element is seeked directly.
> - **WebRTC (§17–24, §47, §50) moves to v0.4** and runs from an extension-origin frame inside the sidebar, so camera and mic permissions belong to the extension. SFU (§48–49) moves to v0.5.
> - **Screen sharing (§23, §42)** is not on the current roadmap: a shared streaming tab shows black because of DRM, and the core use case doesn't need it.
> - **Desktop-only sections** (§4 Tauri, §6 desktop structure, §25 local playback controller, §35 local media, §62–64 auto-update, macOS permissions and packaging) apply to the v1.1 desktop app.
> - **Releases (§69–70, §87):** replaced by the PRD revision table and the Notion Plan v2.
> - **Packaging:** each release ships a Chrome extension package (unlisted Web Store or zip, DEC-020), not a `.dmg`, until v1.1.
>
> Concrete tools and deployment: `docs/TECH-STACK.md`.

---

**Document Version:** 1.0
**Product:** WatchSync Desktop
**Target Platform:** macOS first
**Distribution:** `.dmg`
**Architecture:** Desktop-first, P2P-first, cloud-assisted
**Primary Stack:** Tauri 2 + React + TypeScript + Rust + WebRTC
**Backend:** Lightweight signaling service
**Future Media Infrastructure:** SFU when group-scale requirements justify it

---

# 1. Technical Vision

WatchSync is a desktop watch-together application that combines:

1. Synchronized video playback
2. Camera communication
3. Microphone/audio communication
4. Screen/window sharing
5. Real-time room state
6. Text chat
7. Peer-to-peer media transport where possible
8. Streaming-service playback synchronization through a companion browser extension
9. Optional server-assisted media infrastructure for larger rooms

The core architectural principle is:

> **Keep media off the central application server whenever technically and legally appropriate.**

For two-person rooms, WatchSync should prefer direct WebRTC connections.

The backend should primarily provide:

* Signaling
* Room coordination
* Authentication/session management
* Presence
* Minimal persistent metadata
* Configuration

It should not unnecessarily proxy video/audio traffic.

---

# 2. Product Architecture

The system consists of:

```text
                    WATCHSYNC
                        │
             ┌──────────┴──────────┐
             │                     │
       Desktop Client        Browser Extension
             │                     │
             └──────────┬──────────┘
                        │
                  Signaling API
                        │
                ┌───────┴───────┐
                │               │
             User A           User B
                │               │
                └── WebRTC ────┘
                        │
                  Direct Media
```

For larger rooms:

```text
                    WATCHSYNC
                        │
                  Signaling API
                        │
                       SFU
                        │
          ┌─────────────┼─────────────┐
          │             │             │
        User A        User B        User C
```

---

# 3. Architectural Principles

## 3.1 P2P First

For two-person rooms:

```text
User A ═══════════════════ User B
             WebRTC
```

The backend should not carry the media.

---

## 3.2 Server-Assisted, Not Server-Dependent

The application may depend on a small backend for signaling.

However, once WebRTC establishes a direct connection:

```text
A ←──────── WebRTC ────────→ B
```

the media should travel directly whenever network conditions permit.

---

## 3.3 Separate Media Plane From Control Plane

```text
                    WATCHSYNC
                        │
          ┌──────────┴──────────┐
          │                     │
     CONTROL PLANE          MEDIA PLANE
          │                     │
      WebSocket              WebRTC
          │                     │
       Backend              P2P / SFU
```

---

# 4. Platform

## 4.1 Desktop Framework

Use:

**Tauri 2**

Reasons:

* Lightweight compared with Electron
* Native application packaging
* Rust backend
* Web technologies for UI
* macOS `.app` and `.dmg` distribution
* Access to native APIs where required
* Cross-platform path for future Windows/Linux versions

---

# 5. Frontend

## Required stack

```text
React
TypeScript
Vite
Tailwind CSS
```

Recommended supporting libraries:

```text
React Router
Zustand
Zod
TanStack Query
```

Use libraries only when they solve a real problem.

Avoid unnecessary dependencies.

---

# 6. Application Structure

Recommended structure:

```text
watchsync/
│
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── features/
│   │   │   │   ├── room/
│   │   │   │   ├── playback/
│   │   │   │   ├── chat/
│   │   │   │   ├── participants/
│   │   │   │   ├── media/
│   │   │   │   └── settings/
│   │   │   ├── hooks/
│   │   │   ├── stores/
│   │   │   ├── services/
│   │   │   ├── types/
│   │   │   └── utils/
│   │   └── src-tauri/
│   │       ├── src/
│   │       ├── capabilities/
│   │       └── tauri.conf.json
│   │
│   └── extension/
│       ├── src/
│       └── manifest.json
│
├── services/
│   └── signaling/
│
├── packages/
│   ├── protocol/
│   ├── sync-engine/
│   ├── shared-types/
│   └── validation/
│
├── docs/
│
└── tests/
```

The shared packages are important.

Playback and protocol logic should not be duplicated between applications.

---

# 7. Backend

The initial backend should be deliberately small.

Recommended:

```text
FastAPI
Python 3.12+
WebSocket
Pydantic
```

The backend should provide:

```text
REST API
WebSocket signaling
Room management
Session management
Presence
Health checks
```

---

# 8. Backend Architecture

```text
                 Internet
                    │
             ┌──────▼──────┐
             │ Load Balancer│
             └──────┬──────┘
                    │
             ┌──────▼──────┐
             │   FastAPI   │
             │  Signaling  │
             └──────┬──────┘
                    │
          ┌─────────┼─────────┐
          │         │         │
          ▼         ▼         ▼
       Rooms     Presence   Sessions
```

For MVP, one backend instance is acceptable.

Do not introduce Kubernetes or complex distributed infrastructure prematurely.

---

# 9. Database Strategy

## V0.1

No database required.

Rooms can be held in memory.

## V0.2–V0.5

Use Redis for ephemeral room state if necessary.

## V0.7+

Introduce PostgreSQL for:

```text
Users
Rooms
Friendships
Room history
Preferences
Watch history
```

The architecture must not require PostgreSQL for the initial P2P prototype.

---

# 10. Room Model

```typescript
interface Room {
  id: string;
  hostId: string;
  createdAt: number;
  expiresAt?: number;
  status: "active" | "closed";
  maxParticipants: number;
}
```

Participant:

```typescript
interface Participant {
  id: string;
  displayName: string;
  avatarUrl?: string;
  joinedAt: number;
  isHost: boolean;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  connectionState: ConnectionState;
}
```

---

# 11. Room Lifecycle

```text
CREATE
  ↓
WAITING
  ↓
ACTIVE
  ↓
PARTICIPANTS JOIN
  ↓
MEDIA CONNECTED
  ↓
WATCHING
  ↓
PARTICIPANTS LEAVE
  ↓
EMPTY
  ↓
EXPIRED
```

Empty rooms should eventually expire automatically.

---

# 12. Room Creation

API:

```http
POST /api/v1/rooms
```

Request:

```json
{
  "displayName": "Suhaas"
}
```

Response:

```json
{
  "roomId": "7XK92P",
  "roomToken": "..."
}
```

The room ID must be cryptographically random.

Do not use sequential room IDs.

---

# 13. Room Joining

```http
POST /api/v1/rooms/{roomId}/join
```

Request:

```json
{
  "displayName": "Alex"
}
```

Response:

```json
{
  "participantId": "...",
  "roomToken": "..."
}
```

---

# 14. WebSocket Signaling

Connection:

```text
wss://api.watchsync.app/ws/rooms/{roomId}
```

The WebSocket handles:

* WebRTC signaling
* Room events
* Playback commands
* Chat
* Presence

---

# 15. WebSocket Protocol

Every message should have a consistent envelope.

```typescript
interface WSMessage<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  payload: T;
}
```

Example:

```json
{
  "id": "evt_123",
  "type": "ROOM.USER_JOINED",
  "timestamp": 1790321000123,
  "payload": {
    "participantId": "user_456"
  }
}
```

---

# 16. WebSocket Event Types

## Room

```text
ROOM.JOINED
ROOM.USER_JOINED
ROOM.USER_LEFT
ROOM.HOST_CHANGED
ROOM.CLOSED
```

## WebRTC

```text
RTC.OFFER
RTC.ANSWER
RTC.ICE_CANDIDATE
RTC.RENEGOTIATE
```

## Playback

```text
PLAYBACK.PLAY
PLAYBACK.PAUSE
PLAYBACK.SEEK
PLAYBACK.SYNC_REQUEST
PLAYBACK.SYNC_RESPONSE
PLAYBACK.RATE_CHANGE
PLAYBACK.MEDIA_CHANGED
```

## Chat

```text
CHAT.MESSAGE
CHAT.REACTION
```

---

# 17. WebRTC Architecture

## V0.1

Two-user P2P.

```text
             Signaling Server
                  │
           SDP / ICE messages
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
     User A              User B
        │                   │
        └──── WebRTC ───────┘
```

The signaling server does not carry media.

---

# 18. STUN

Use STUN for NAT discovery.

The application should support configurable STUN servers.

Example configuration:

```text
stun:stun.l.google.com:19302
```

STUN configuration must be server-controlled/configurable rather than hardcoded throughout the application.

---

# 19. TURN

TURN is required for networks where direct P2P connections cannot be established.

Architecture:

```text
Normal:

A ═════════════════ B


Fallback:

A ═════ TURN ═════ B
```

For early development, TURN usage can be limited.

Production should eventually provide a reliable TURN fallback.

---

# 20. Media Tracks

A participant may publish:

```text
Camera
Microphone
Screen
```

Each is an independent WebRTC track.

Example:

```text
PeerConnection
├── AudioTrack
├── CameraTrack
└── ScreenTrack
```

---

# 21. Camera Requirements

Users must be able to:

* Enable camera
* Disable camera
* Switch camera
* Preview camera
* Handle unavailable camera
* Handle permission denial

UI state:

```text
Camera ON
Camera OFF
Camera unavailable
Permission denied
```

---

# 22. Microphone Requirements

Users must be able to:

* Enable microphone
* Disable microphone
* Select microphone
* See microphone level
* Handle permission denial
* Detect device disconnection

---

# 23. Screen Sharing

Use platform/browser-supported screen capture.

Users can choose:

```text
Entire screen
Application/window
```

Screen sharing should be an optional track.

It must not interfere with camera/microphone tracks.

---

# 24. Audio Management

The application should support:

* Microphone mute
* Speaker volume
* Remote participant volume
* Audio device selection
* Echo cancellation
* Automatic gain control
* Noise suppression where supported

WebRTC browser/media APIs should be used rather than manually implementing audio processing initially.

---

# 25. Playback Engine

The application should use:

```text
HTMLMediaElement
```

for controlled local media playback.

Playback controller:

```typescript
interface PlaybackController {
  play(): Promise<void>;
  pause(): void;
  seek(position: number): void;
  getPosition(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
}
```

The synchronization engine should depend on this abstraction rather than directly depending on a particular video player.

---

# 26. Playback State

```typescript
interface PlaybackState {
  mediaId: string;
  status: "playing" | "paused";
  position: number;
  playbackRate: number;
  updatedAt: number;
  controllerId: string;
}
```

---

# 27. Server-Authoritative Playback Clock

The backend maintains the authoritative room playback state.

Example:

```json
{
  "status": "playing",
  "position": 532.42,
  "playbackRate": 1,
  "updatedAt": 1790321000123
}
```

For a playing state:

```text
expectedPosition =
storedPosition +
(currentServerTime - updatedAt) * playbackRate
```

---

# 28. Clock Synchronization

Client clocks cannot be assumed to match.

The client should periodically estimate server clock offset.

Conceptually:

```text
Client sends:
t1

Server receives:
t2

Server responds:
t3

Client receives:
t4
```

Estimate:

```text
RTT = (t4 - t1) - (t3 - t2)

clockOffset ≈ ((t2 - t1) + (t3 - t4)) / 2
```

The exact algorithm can be improved later.

---

# 29. Playback Drift

Each participant periodically calculates:

```text
drift =
actualPosition -
expectedPosition
```

Recommended initial thresholds:

```text
|drift| < 100ms
    → no correction

100ms–500ms
    → gradual playback-rate correction

>500ms
    → hard seek
```

These values must be configurable.

Do not hardcode them into UI components.

---

# 30. Synchronization Loop

Example:

```text
Every 500–1000ms:

1. Obtain expected room position
2. Obtain local playback position
3. Calculate drift
4. Decide correction strategy
5. Apply correction
6. Report health if necessary
```

The interval should be tuned through testing.

---

# 31. Play Event

When host presses Play:

```text
Host
 ↓
Get current position
 ↓
Create PLAY event
 ↓
Attach server timestamp
 ↓
Broadcast
 ↓
Participants calculate expected position
 ↓
Participants play
```

Event:

```json
{
  "type": "PLAYBACK.PLAY",
  "payload": {
    "position": 523.21,
    "serverTimestamp": 1790321000123,
    "playbackRate": 1
  }
}
```

---

# 32. Pause Event

```json
{
  "type": "PLAYBACK.PAUSE",
  "payload": {
    "position": 532.88,
    "serverTimestamp": 1790321010123
  }
}
```

Participants pause at the calculated position.

---

# 33. Seek Event

```json
{
  "type": "PLAYBACK.SEEK",
  "payload": {
    "position": 1250.22,
    "serverTimestamp": 1790321010123
  }
}
```

---

# 34. Host Model

Initially:

**One host controls playback.**

Host can:

* Play
* Pause
* Seek
* Change media

Participants can:

* Watch
* Request control

Future versions can support:

* Co-host
* Democratic control
* Queue management

---

# 35. Local Media

V0.2 should support authorized/local media.

Example:

```text
User selects:

/Users/Suhaas/Movies/movie.mp4
```

The application should not upload the file to the backend.

The media should remain local wherever possible.

For sharing media with another user, the application must only transmit content the user has the right to share.

---

# 36. Protected Streaming Mode

V0.3 introduces a separate integration mode.

Architecture:

```text
Streaming Website
       │
       ▼
Browser
       │
       ▼
WatchSync Extension
       │
       ▼
Playback State
       │
       ▼
WatchSync Signaling
       │
       ▼
Friend's Extension
       │
       ▼
Friend's Browser
```

The actual protected media remains inside each user's authorized streaming session.

---

# 37. Protected Media Boundary

WatchSync must not:

* Extract DRM keys
* Decrypt protected media
* Capture protected frames
* Circumvent DRM
* Bypass HDCP
* Download protected streams
* Proxy protected media
* Redistribute protected media

The extension is strictly a playback synchronization layer.

---

# 38. Browser Extension

Manifest:

**Chrome Manifest V3**

Potential structure:

```text
extension/
├── manifest.json
├── background/
├── content/
├── popup/
├── services/
└── shared/
```

The extension communicates with the desktop application through a secure mechanism.

Possible mechanisms:

```text
Native Messaging
Local WebSocket
Deep link / custom protocol
```

Preferred approach:

**Native Messaging** for a production-grade desktop/extension integration.

---

# 39. Extension Communication

Conceptually:

```text
Netflix tab
    │
    ▼
Content Script
    │
    ▼
Extension Runtime
    │
    ▼
Native Messaging
    │
    ▼
WatchSync Desktop
```

Only permitted playback state should cross this boundary.

---

# 40. Supported Streaming Events

Initial:

```text
PLAY
PAUSE
SEEK
POSITION
RATE_CHANGE
MEDIA_CHANGED
```

Do not attempt to access protected media data.

---

# 41. Content Identification

The extension should identify a media session using non-sensitive metadata where permitted.

Example:

```typescript
interface MediaSession {
  service: string;
  title?: string;
  url?: string;
  duration?: number;
}
```

Do not store protected content.

---

# 42. Screen Sharing Mode

V0.4 adds screen sharing.

Architecture:

```text
Screen
  │
  ▼
MediaStream
  │
  ▼
WebRTC
  │
  ▼
Friend
```

Camera and microphone can continue independently.

---

# 43. Chat

Chat is implemented through WebSocket.

```json
{
  "type": "CHAT.MESSAGE",
  "payload": {
    "message": "BRO 😂"
  }
}
```

Requirements:

* Maximum message size
* Rate limiting
* Sanitization
* Message timestamps
* Participant identity

---

# 44. Reactions

Reactions are ephemeral events.

Example:

```json
{
  "type": "CHAT.REACTION",
  "payload": {
    "emoji": "😂"
  }
}
```

They should not necessarily be persisted.

---

# 45. Connection State

Each participant has:

```text
connecting
connected
degraded
reconnecting
disconnected
```

The UI should expose meaningful status.

Example:

```text
🟢 Connected
🟡 Network unstable
🔴 Reconnecting
```

---

# 46. Reconnection

When WebSocket disconnects:

```text
Detect
 ↓
Reconnect
 ↓
Authenticate
 ↓
Rejoin room
 ↓
Request current room state
 ↓
Synchronize playback
 ↓
Restore WebRTC
```

The user should not need to restart the application.

---

# 47. WebRTC Reconnection

Handle:

```text
connectionState
iceConnectionState
signalingState
```

Possible recovery:

```text
connected
    ↓
disconnected
    ↓
ICE restart
    ↓
connected
```

If P2P fails:

```text
P2P failure
     ↓
TURN fallback
```

---

# 48. Group Rooms

V0.5 introduces group rooms.

P2P mesh should not be used beyond a small number of users.

Mesh complexity grows approximately as:

```text
N × (N - 1) / 2
```

connections.

Therefore:

```text
2 users → P2P
3–4 users → P2P may be acceptable
5+ users → SFU recommended
```

Final threshold should be determined through testing.

---

# 49. SFU Architecture

Potential implementation:

```text
              WatchSync
                  │
                SFU
       ┌──────────┼──────────┐
       │          │          │
       A          B          C
```

Candidate technology:

**LiveKit**

Alternative:

**mediasoup**

The application should abstract the media transport layer so the client isn't tightly coupled to one provider.

---

# 50. Media Transport Abstraction

Create:

```typescript
interface MediaTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  publishCamera(): Promise<void>;
  publishMicrophone(): Promise<void>;
  publishScreen(): Promise<void>;

  subscribe(participantId: string): Promise<void>;
}
```

Implementations:

```text
PeerMediaTransport
SFUMediaTransport
```

This allows V0.1–V0.4 to use P2P while V0.5+ can introduce SFU without rewriting the entire UI.

---

# 51. State Management

Recommended:

**Zustand**

Separate stores:

```text
roomStore
participantStore
playbackStore
mediaStore
connectionStore
chatStore
settingsStore
```

Do not create one enormous global store.

---

# 52. Room State Example

```typescript
interface RoomState {
  roomId: string;
  currentUserId: string;
  hostId: string;
  participants: Participant[];
  playback: PlaybackState | null;
  connectionState: ConnectionState;
}
```

---

# 53. Security

## Authentication

V0.1:

Temporary room tokens.

Later:

OAuth/email authentication.

## Authorization

Every room operation must verify:

```text
participant belongs to room
```

Host operations must verify:

```text
participant.id === room.hostId
```

Never trust the client.

---

# 54. Room Security

Room IDs must be unguessable.

Use cryptographically secure random generation.

Room access tokens should be:

* Short-lived where appropriate
* Scoped to a room
* Revocable

---

# 55. Rate Limiting

Rate-limit:

```text
Room creation
Room joining
WebSocket messages
Chat messages
Signaling messages
```

Prevent:

* Spam
* Message flooding
* Room creation abuse
* Signaling abuse

---

# 56. Privacy

WatchSync should minimize collection.

The server should not store:

* Camera recordings
* Microphone recordings
* Screen recordings
* Protected media
* DRM keys

By default, camera/microphone media should be transient WebRTC traffic.

---

# 57. Telemetry

Collect only necessary technical telemetry.

Useful metrics:

```text
Room creation success
Join success
WebSocket latency
WebRTC connection success
ICE failures
Reconnect rate
Playback drift
Room duration
Application crashes
```

Avoid collecting unnecessary media/content data.

---

# 58. Error Reporting

Use:

**Sentry**

for:

* Desktop crashes
* JavaScript errors
* Rust errors
* Backend errors

No media content should be attached to crash reports.

---

# 59. Logging

Client logs should include:

```text
timestamp
component
event
severity
room session ID
```

Never log:

```text
passwords
tokens
private keys
media contents
DRM information
```

---

# 60. Performance Requirements

## Desktop

Application startup target:

**<3 seconds** on a normal modern Mac.

## UI

Target:

**60 FPS** during normal room operation.

## Signaling

Normal room events should generally propagate within:

**<200 ms**

under normal network conditions.

## Playback

Target median drift:

**<200 ms**

during stable network conditions.

These are engineering targets, not guarantees.

---

# 61. Resource Requirements

The application should avoid unnecessary CPU usage when:

* Camera disabled
* Screen sharing disabled
* No active playback

The UI should not continuously poll the backend.

Prefer:

```text
WebSocket
WebRTC events
event-driven architecture
```

over aggressive polling.

---

# 62. Auto Update

Tauri updater should eventually support:

```text
Current Version
      ↓
Check Update
      ↓
Download
      ↓
Verify Signature
      ↓
Install
      ↓
Restart
```

Updates must be cryptographically signed.

---

# 63. macOS Permissions

The application may require:

```text
Camera
Microphone
Screen Recording
```

The app must clearly explain why permissions are needed.

If permission is denied, show actionable UI rather than crashing.

Example:

> Camera permission is disabled. Open System Settings → Privacy & Security → Camera.

---

# 64. Packaging

Development:

```bash
npm run tauri dev
```

Production:

```bash
npm run tauri build
```

Output:

```text
WatchSync.app
WatchSync.dmg
```

The release pipeline should eventually produce signed/notarized macOS builds.

---

# 65. CI/CD

Use GitHub Actions.

Pipeline:

```text
Push
 ↓
Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
Build
 ↓
Package
 ↓
Release
```

For release:

```text
Git Tag
 ↓
Build macOS
 ↓
Sign
 ↓
Notarize
 ↓
Create Release
 ↓
Upload DMG
```

---

# 66. Testing Strategy

Testing should happen at multiple levels.

## Unit

Test:

* Sync calculations
* Clock calculations
* Drift correction
* Room state
* Message validation

## Integration

Test:

* WebSocket
* Room creation
* Room joining
* Signaling
* Reconnection

## E2E

Test:

```text
Mac A
 ↓
Create room

Mac B
 ↓
Join room

Camera
Mic
Playback
Chat
```

---

# 67. Synchronization Test Suite

Create deterministic tests.

Example:

```text
Expected = 100.0
Actual = 100.05

Expected correction:
NONE
```

```text
Expected = 100.0
Actual = 100.30

Expected:
GRADUAL CORRECTION
```

```text
Expected = 100.0
Actual = 102.0

Expected:
HARD SEEK
```

Test negative drift as well.

---

# 68. Network Simulation

The development environment should support testing:

```text
Latency
Packet loss
Jitter
Bandwidth limits
Disconnects
Reconnects
```

Test scenarios:

```text
50ms latency
100ms latency
250ms latency
500ms latency
5% packet loss
10% packet loss
Temporary disconnect
Network switch
```

---

# 69. Agile Release Architecture

Every release must be independently usable.

## V0.1 — Private Calls

```text
Create room
Join room
Camera
Microphone
P2P
```

Architecture:

```text
Tauri
React
WebRTC
Signaling
```

---

## V0.2 — Local/Owned Media Watch Party

Adds:

```text
Video player
Playback synchronization
Play
Pause
Seek
```

Architecture:

```text
V0.1
 +
Playback engine
 +
Sync engine
```

---

## V0.3 — Protected Streaming Synchronization

Adds:

```text
Browser extension
Native messaging
Streaming-service playback synchronization
```

Architecture:

```text
V0.2
 +
Chrome extension
 +
Native messaging
 +
Streaming integration
```

---

## V0.4 — Social Watch Room

Adds:

```text
Screen sharing
Chat
Reactions
Improved room UI
```

Architecture:

```text
V0.3
 +
Screen track
 +
Chat
 +
Reactions
```

---

## V0.5 — Group Rooms

Adds:

```text
SFU
Multi-user rooms
Participant grid
Host controls
```

Architecture:

```text
P2P
    ↓
SFU abstraction
    ↓
LiveKit / mediasoup
```

---

## V0.6 — Intelligent Synchronization

Adds:

```text
Clock synchronization
Drift correction
Network-aware recovery
Buffer handling
```

---

## V0.7 — Accounts & Social

Adds:

```text
Authentication
Profiles
Friends
Room history
Watchlists
```

---

## V0.8 — Production Hardening

Adds:

```text
Security
Observability
Crash reporting
Auto-update
Performance
macOS signing
Notarization
```

---

## V1.0 — Production WatchSync

Combines all validated capabilities.

---

# 70. Version Dependency Graph

```text
                    V0.1
                     │
              P2P communication
                     │
                     ▼
                    V0.2
              Watch synchronization
                     │
                     ▼
                    V0.3
          Streaming integration
                     │
                     ▼
                    V0.4
              Social experience
                     │
                     ▼
                    V0.5
               Group rooms
                     │
                     ▼
                    V0.6
          Advanced synchronization
                     │
                     ▼
                    V0.7
              Social accounts
                     │
                     ▼
                    V0.8
           Production hardening
                     │
                     ▼
                    V1.0
```

---

# 71. Definition of Done

A feature is not considered complete until:

* Implementation exists
* Unit tests exist where applicable
* Error states are handled
* Loading states are handled
* Permission failures are handled
* Reconnection is handled where relevant
* UI is usable
* Security validation exists
* Documentation exists
* The feature works in a packaged `.dmg`
* No critical console/runtime errors exist

---

# 72. Release Definition of Done

Every release must have:

```text
✓ Working feature
✓ Tests
✓ Error handling
✓ Documentation
✓ Version number
✓ Git tag
✓ Build artifact
✓ Release notes
✓ Installable DMG
```

A release must never be:

> "The backend is ready but frontend isn't."

Every version must represent a usable product.

---

# 73. Development Workflow

Use:

```text
main
develop
feature/*
fix/*
```

Recommended flow:

```text
Issue
 ↓
Feature branch
 ↓
Implementation
 ↓
Tests
 ↓
Pull Request
 ↓
Review
 ↓
Merge
 ↓
Release
```

Commit style:

```text
feat:
fix:
refactor:
test:
docs:
chore:
```

---

# 74. Feature Flags

Potentially use feature flags for:

```text
SFU
Streaming integration
Screen sharing
Experimental sync algorithm
```

This allows incomplete capabilities to remain hidden without destabilizing released functionality.

---

# 75. Configuration

Do not hardcode:

```text
API URLs
STUN servers
TURN servers
Feature flags
Environment-specific settings
```

Use configuration:

```text
development
staging
production
```

---

# 76. Environment Configuration

Example:

```text
VITE_API_URL
VITE_WS_URL
VITE_ENVIRONMENT
VITE_SENTRY_DSN
```

Tauri/native configuration should be handled separately from frontend environment variables where appropriate.

Never expose secrets in frontend bundles.

---

# 77. Deployment

## Signaling server

Initially:

**Railway**

Deployment:

```text
GitHub
   ↓
Railway
   ↓
FastAPI
```

The backend should remain stateless where possible.

---

# 78. Cost Strategy

The architecture should minimize bandwidth costs.

### Expensive architecture

```text
User A
 ↓
Cloud
 ↓
User B
```

Video/audio traverses cloud.

### Preferred early architecture

```text
User A ═══════════ User B
        WebRTC P2P
```

Cloud handles:

```text
Signaling
Room metadata
Authentication
```

This significantly reduces media bandwidth costs.

---

# 79. Scaling Strategy

Do not prematurely scale.

### Stage 1

```text
1 FastAPI instance
P2P WebRTC
```

### Stage 2

```text
FastAPI
+
Redis
```

### Stage 3

```text
FastAPI
+
Redis
+
SFU
```

### Stage 4

```text
Load Balancer
      │
 ┌────┼────┐
 API  API  API
      │
    Redis
      │
     SFU
```

Only introduce each layer when actual product requirements justify it.

---

# 80. Major Risks

## Risk 1 — WebRTC connectivity

Some networks will prevent direct P2P.

Mitigation:

TURN fallback.

---

## Risk 2 — Protected streaming integration

Browser APIs and streaming services can change.

Mitigation:

Create a provider abstraction:

```typescript
interface StreamingProvider {
  detect(): boolean;
  getPlaybackState(): PlaybackState;
  sendCommand(command: PlaybackCommand): void;
}
```

Each supported service becomes an adapter.

---

## Risk 3 — DRM

WatchSync must never depend on bypassing DRM.

Protected streaming mode is based only on authorized local playback and synchronization.

---

## Risk 4 — Synchronization quality

Naive play/pause synchronization will drift.

Mitigation:

Server clock + periodic synchronization + drift correction.

---

## Risk 5 — Bandwidth cost

SFU can become expensive.

Mitigation:

P2P for small rooms and introduce SFU only for group rooms.

---

## Risk 6 — macOS permissions

Camera, microphone and screen recording permissions can cause friction.

Mitigation:

Clear permission onboarding and recovery screens.

---

# 81. UX Principle

Technical complexity must be hidden from the user.

The user should not think about:

```text
ICE
STUN
TURN
SDP
WebSocket
SFU
NAT
```

They should see:

```text
Create Room
Join Room
Camera
Mic
Play
Pause
Share Screen
```

---

# 82. Core UX Flow

```text
Launch WatchSync
       │
       ▼
┌─────────────────────┐
│ Create Room         │
│ Join Room           │
└──────────┬──────────┘
           │
           ▼
       Room Lobby
           │
      Invite Friend
           │
           ▼
      Friend Joins
           │
           ▼
     Media Connection
           │
           ▼
      Watch Together
```

---

# 83. Final Application Layout

```text
┌────────────────────────────────────────────────────────────┐
│ WATCHSYNC                          Room: 7XK92P   ● Live   │
├────────────────────────────────────────────┬───────────────┤
│                                            │ PARTICIPANTS  │
│                                            │               │
│                                            │ Suhaas   🎙️📷 │
│                 VIDEO                      │ Alex     🎙️📷 │
│                                            │               │
│                                            ├───────────────┤
│                                            │ CHAT          │
│                                            │               │
│                                            │ Alex: 😂      │
│                                            │ Suhaas: bro   │
│                                            │               │
├────────────────────────────────────────────┴───────────────┤
│ ▶   ━━━━━━━━━━━━━━━━━━━━━━━━   42:31 / 1:52:03             │
│                                                            │
│ 🎙️ Mic    📷 Camera    🖥️ Share    🔊 Audio    ⚙ Settings │
└────────────────────────────────────────────────────────────┘
```

---

# 84. Final Technical Stack

## Desktop

```text
Tauri 2
Rust
React
TypeScript
Vite
Tailwind
Zustand
```

## Networking

```text
WebRTC
WebSocket
STUN
TURN
```

## Backend

```text
FastAPI
Python 3.12+
Pydantic
WebSockets
```

## Data

```text
In-memory → Redis → PostgreSQL
```

depending on release.

## Group media

```text
LiveKit / mediasoup
```

## Extension

```text
Chrome Manifest V3
TypeScript
Native Messaging
```

## Infrastructure

```text
Railway initially
GitHub Actions
Sentry
```

---

# 85. Engineering North Star

The architecture should always preserve this separation:

```text
             WATCHSYNC
                  │
       ┌──────────┴──────────┐
       │                     │
   CONTROL PLANE          MEDIA PLANE
       │                     │
       ▼                     ▼
   Signaling              WebRTC
   Sync                   Camera
   Chat                   Microphone
   Presence               Screen
   Room state             Authorized media
```

The backend should primarily coordinate.

The clients should handle media.

---

# 86. Final Product Definition

WatchSync is not fundamentally a Netflix screen-sharing application.

It is:

> **A peer-to-peer social watch platform that synchronizes playback while allowing users to communicate through camera, microphone, screen sharing and chat.**

For content that users own or are authorized to share:

```text
WebRTC can transport the media.
```

For DRM-protected streaming services:

```text
Each user's authorized session plays locally.
WatchSync synchronizes playback state.
```

The application should never depend on defeating content protection.

---

# 87. Claude Code Implementation Instruction

When implementing this project:

1. Follow this TRD as the source of truth.
2. Do not attempt to implement DRM circumvention.
3. Do not build the entire system before shipping the first release.
4. Follow the release sequence V0.1 → V0.2 → V0.3 → V0.4 → V0.5 → V0.6 → V0.7 → V0.8 → V1.0.
5. Every release must be independently buildable and installable.
6. Prefer simple architecture until a real requirement demands complexity.
7. Keep control-plane and media-plane concerns separate.
8. Keep media P2P whenever practical.
9. Do not introduce an SFU until group-room requirements need it.
10. Keep shared protocol and synchronization logic in reusable packages.
11. Write tests alongside implementation.
12. Do not leave placeholder implementations disguised as completed features.
13. Do not silently remove requirements to make implementation easier.
14. When a technical decision is ambiguous, choose the simplest architecture that preserves future extensibility.
15. Maintain a clear `CHANGELOG.md` and release notes for every version.
16. Every release must produce an installable macOS `.dmg`.
17. Before moving to the next release, verify the previous release remains functional.
18. Prefer vertical slices over building isolated infrastructure layers.
19. Keep infrastructure costs low by avoiding unnecessary server-side media processing.
20. Treat reliability, privacy and security as first-class requirements rather than final-stage cleanup.

## First implementation target

Start with **V0.1 only**.

Do not implement V0.2+ until V0.1 is working end-to-end.

V0.1 success criteria:

```text
Mac A
  ↓
Install WatchSync.dmg
  ↓
Create Room
  ↓
Share Room Code
  ↓
Mac B
  ↓
Install WatchSync.dmg
  ↓
Join Room
  ↓
P2P WebRTC Connection
  ↓
Camera + Microphone
  ↓
Mute / Unmute
  ↓
Camera On / Off
  ↓
Leave / Rejoin
```

Once V0.1 passes its acceptance tests, proceed to V0.2.

---

# Appendix A — Development Rhythm Note

One architectural decision to especially stick to:

Don't let Claude build V0.1 as if it's already V1.0. That's the easiest way for this project to explode into 30 services, a huge codebase, and a giant Railway bill.

The development rhythm should literally be:

```text
build → test → package .dmg → use it with a friend → fix → release → then add the next capability
```
