# WatchSync — Notion Product Planning & Agile Execution System

You are acting as the **Product Manager + Technical Product Manager + Agile Delivery Lead** for WatchSync.

The existing WatchSync PRD is the primary product specification.

Your job is to convert the PRD into a structured, implementation-ready Agile planning system that can be maintained in Notion and kept synchronized with the actual codebase.

Do NOT redesign the product independently.

Use the PRD as the source of truth.

---

# 1. OBJECTIVE

Create a complete product-planning system for WatchSync covering:

1. Product roadmap
2. Releases
3. Epics
4. Features
5. Use cases
6. User stories
7. Acceptance criteria
8. Engineering tasks
9. Bugs
10. Technical debt
11. Dependencies
12. Risks
13. Definition of Ready
14. Definition of Done
15. Sprint planning
16. Release planning
17. Product decisions
18. Notion synchronization

The system must be practical for a solo developer or small engineering team.

Avoid creating unnecessary enterprise-style process overhead.

---

# 2. SOURCE OF TRUTH HIERARCHY

Use the following hierarchy.

```text
Product Vision
      ↓
PRD
      ↓
Roadmap / Releases
      ↓
Epics
      ↓
Features
      ↓
Use Cases
      ↓
User Stories
      ↓
Acceptance Criteria
      ↓
Engineering Tasks
      ↓
Code
```

If a conflict exists:

```text
PRD > Roadmap > Epic > Feature > Story > Task
```

Do not silently change requirements.

If implementation reveals that a requirement needs to change, create a **Product Decision** instead of silently modifying the requirement.

---

# 3. NOTION WORKSPACE STRUCTURE

Create the following Notion databases/pages.

```text
WatchSync
│
├── 🧭 Product Home
│
├── 📄 PRD
│
├── 🗺 Product Roadmap
│
├── 🚀 Releases
│
├── 🧩 Epics
│
├── ✨ Features
│
├── 🎯 Use Cases
│
├── 📝 User Stories
│
├── ✅ Acceptance Criteria
│
├── 🛠 Engineering Tasks
│
├── 🐛 Bugs
```

> **[GAP — source paste was truncated here.]** The rest of the §3 workspace tree is missing (items after Bugs, such as technical debt, decisions, dependencies, risks, experiments, sprints), along with any closing text of §3. Everything below resumes at the heading of §4.

---

# 4. PRODUCT HOME

Create a Product Home dashboard.

It should show:

```text
WatchSync

Product Vision
Current Release
Current Sprint
Sprint Progress
Release Progress
Open Bugs
Blocked Items
Upcoming Features
Recent Decisions
Product Metrics
```

The dashboard should provide quick access to:

* Current sprint
* Current release
* Roadmap
* Backlog
* Bugs
* Decisions

---

# 5. RELEASE DATABASE

Create a Releases database.

Properties:

```text
Release ID
Release Name
Version
Status
Start Date
Target Date
Release Goal
Priority
Progress
Epics
Features
Stories
Open Bugs
Release Notes
Definition of Done
```

Statuses:

```text
Planned
In Progress
Code Complete
Testing
Ready to Ship
Shipped
Cancelled
```

---

# 6. WATCHSYNC RELEASE PLAN

Create the following releases.

## V0.1

Name:

```text
Private Video Room
```

Goal:

Two users can create/join a room and communicate through camera and microphone.

---

## V0.2

Name:

```text
Watch Your Own Media
```

Goal:

Two users can watch authorized/local media together with synchronized playback.

---

## V0.3

Name:

```text
Streaming Watch Party
```

Goal:

Synchronize authorized playback sessions on supported streaming websites.

---

## V0.4

Name:

```text
Social Room
```

Goal:

Add screen sharing, chat and reactions.

---

## V0.5

Name:

```text
Multiplayer
```

Goal:

Support small group rooms.

Target:

```text
2–8 participants
```

---

## V0.6

Name:

```text
Smart Synchronization
```

Goal:

Improve playback synchronization under real-world network conditions.

---

## V0.7

Name:

```text
Accounts & Social
```

Goal:

Introduce persistent users, profiles, friends and room history.

---

## V0.8

Name:

```text
Production Hardening
```

Goal:

Prepare WatchSync for reliable public distribution.

---

## V1.0

Name:

```text
Complete WatchSync
```

Goal:

Polished production-ready watch-party product.

---

# 7. EPIC STRUCTURE

Create Epics underneath each release.

Example V0.1:

```text
V0.1
│
├── Room Management
├── User Presence
├── WebRTC Connection
├── Camera
├── Microphone
├── Participant UI
├── Connection State
└── Reconnection
```

V0.2:

```text
V0.2
│
├── Local Media
├── Video Player
├── Playback Controls
├── Playback State
├── Playback Synchronization
└── Sync-on-Join
```

V0.3:

```text
V0.3
│
├── Browser Extension
├── Desktop ↔ Extension Bridge
├── Provider Detection
├── Playback Events
└── Streaming Synchronization
```

V0.4:

```text
V0.4
│
├── Screen Sharing
├── Chat
├── Reactions
├── Camera Overlay
└── Social Room UI
```

V0.5:

```text
V0.5
│
├── Multiplayer Rooms
├── SFU
├── Participant Grid
├── Active Speaker
└── Host Controls
```

Continue this pattern for later releases.

---

# 8. FEATURE DATABASE

Each feature should contain:

```text
Feature ID
Feature Name
Description
Release
Epic
Priority
Status
User Value
Technical Complexity
Dependencies
Use Cases
User Stories
Acceptance Criteria
Design Status
Engineering Status
Test Status
```

Status:

```text
Idea
Planned
Ready
In Development
Testing
Done
Blocked
Cancelled
```

Priority:

```text
P0 — Critical
P1 — Important
P2 — Nice to Have
```

Do not assign priorities arbitrarily.

Use product necessity and release goals.

---

# 9. USE CASE DATABASE

Use cases describe what users need to accomplish.

Do NOT write use cases as technical tasks.

Use this format:

```text
UC-ID
Name
Actor
Goal
Preconditions
Trigger
Main Flow
Alternative Flows
Exception Flows
Postconditions
Related Features
Related User Stories
Release
Priority
Status
```

---

# 10. USE CASE TEMPLATE

Use:

```text
UC-001 — Create Watch Room

Actor:
Host

Goal:
Create a private WatchSync room and invite another user.

Preconditions:
- WatchSync is installed.
- User is on the home screen.

Trigger:
User selects "Create Room".

Main Flow:
1. User opens WatchSync.
2. User selects Create Room.
3. WatchSync requests room creation.
4. Backend creates a room.
5. WatchSync displays the room code.
6. User copies the invitation.
7. User sends the code to a friend.

Alternative Flow:
- Room creation request temporarily fails.
- User receives an error.
- User can retry.

Postcondition:
An active private room exists.
```

---

# 11. INITIAL USE CASES

Create at least these use cases.

### V0.1

```text
UC-001 Create Room
UC-002 Join Room
UC-003 View Participants
UC-004 Enable Camera
UC-005 Disable Camera
UC-006 Enable Microphone
UC-007 Disable Microphone
UC-008 Leave Room
UC-009 Rejoin Room
UC-010 Recover From Connection Loss
```

### V0.2

```text
UC-011 Select Local Media
UC-012 Play Media
UC-013 Pause Media
UC-014 Seek Media
UC-015 Synchronize Playback
UC-016 Join While Playback Is Active
UC-017 Recover Playback After Reconnection
```

### V0.3

```text
UC-018 Connect Browser Extension
UC-019 Detect Supported Streaming Provider
UC-020 Synchronize Streaming Playback
UC-021 Handle Unsupported Provider
UC-022 Recover Extension Connection
```

### V0.4

```text
UC-023 Share Screen
UC-024 Send Chat Message
UC-025 Send Reaction
UC-026 Toggle Camera Overlay
```

### V0.5

```text
UC-027 Create Multiplayer Room
UC-028 Join Multiplayer Room
UC-029 View Participant Grid
UC-030 Identify Active Speaker
UC-031 Host Controls Participant
```

---

# 12. USER STORY DATABASE

User stories must describe user value.

Use the format:

> As a [user], I want [capability], so that [benefit].

Properties:

```text
Story ID
Story
Release
Epic
Feature
Use Case
Persona
Priority
Status
Story Points
Acceptance Criteria
Dependencies
Assignee
Sprint
```

---

# 13. USER STORY EXAMPLES

## US-001

```text
As a host,
I want to create a private room,
so that I can invite a friend to watch with me.
```

Acceptance criteria:

```text
Given I am on the WatchSync home screen
When I click Create Room
Then a room is created
And I receive a unique room code
And I can copy the invitation
```

---

## US-002

```text
As a friend,
I want to join a room using a room code,
so that I can enter the same watch session.
```

Acceptance criteria:

```text
Given I have a valid room code
When I enter the code
Then I join the room
And I can see the host
```

---

## US-003

```text
As a participant,
I want to mute my microphone,
so that I can control when others hear me.
```

Acceptance criteria:

```text
Given my microphone is enabled
When I click the microphone control
Then my microphone track is muted
And the UI reflects the muted state
```

---

## US-004

```text
As a participant,
I want to turn off my camera,
so that I can control whether others see me.
```

---

## US-005

```text
As a host,
I want playback controls to synchronize,
so that everyone watches the same moment.
```

Acceptance criteria:

```text
Given both participants are watching the same media
When the host presses Play
Then the participant starts playback

When the host pauses
Then the participant pauses

When the host seeks
Then the participant seeks to approximately the same position
```

---

## US-006

```text
As a participant joining an active room,
I want my playback to synchronize automatically,
so that I don't have to manually find the current position.
```

---

# 14. USER STORY RULES

Every story must:

* Have a clear user
* Have one primary goal
* Explain user value
* Be independently testable
* Have acceptance criteria
* Belong to an Epic
* Belong to a Release

Avoid stories like:

```text
Implement WebSocket server
```

That is an engineering task, not a user story.

Instead:

```text
As a participant,
I want my room connection to remain active,
so that I can continue watching without interruption.
```

Then create the engineering task:

```text
Implement WebSocket room connection management.
```

---

# 15. ACCEPTANCE CRITERIA

Use **Given / When / Then** wherever possible.

Example:

```text
Given the host and participant are connected
When the host presses Play
Then the participant receives a playback command
And the participant begins playback
And the playback positions remain within the configured tolerance
```

Acceptance criteria must be:

* Observable
* Testable
* Specific
* Unambiguous

---

# 16. ENGINEERING TASK DATABASE

Engineering tasks translate stories into implementation work.

Properties:

```text
Task ID
Task Name
Description
Release
Epic
Feature
User Story
Task Type
Status
Priority
Estimate
Dependencies
Assignee
PR
Environment
Testing Status
```

Task types:

```text
Frontend
Backend
Desktop
WebRTC
Infrastructure
Testing
Security
Documentation
Design
DevOps
```

---

# 17. TASK EXAMPLE

User Story:

```text
US-001
Create private room
```

Engineering tasks:

```text
TASK-001
Create FastAPI room endpoint

TASK-002
Generate cryptographically random room ID

TASK-003
Create React Create Room page

TASK-004
Implement room creation client service

TASK-005
Create room-code display component

TASK-006
Implement copy invitation button

TASK-007
Add room creation error handling

TASK-008
Write room creation integration tests
```

---

# 18. BUG DATABASE

Create:

```text
Bug ID
Title
Description
Severity
Priority
Release
Environment
Steps to Reproduce
Expected Result
Actual Result
Status
Related Story
Related Feature
Fix Version
```

Severity:

```text
Critical
High
Medium
Low
```

---

# 19. TECHNICAL DEBT DATABASE

Track technical debt separately.

Fields:

```text
Debt ID
Description
Reason
Impact
Priority
Affected Area
Release Introduced
Target Release
Status
```

Do not mix technical debt with normal feature work.

---

# 20. PRODUCT DECISIONS

Create a Product Decisions database.

Every important architectural/product change should be recorded.

Fields:

```text
Decision ID
Date
Decision
Context
Options Considered
Chosen Approach
Reason
Impact
Related Release
Related Feature
Status
```

Example:

```text
DEC-001

Decision:
Use P2P WebRTC for two-person media.

Context:
V0.1 requires camera and microphone.

Options:
1. Media server
2. P2P WebRTC
3. SFU

Decision:
P2P WebRTC.

Reason:
Simpler infrastructure and lower server media bandwidth for two participants.

Impact:
SFU can be introduced later for multiplayer rooms.
```

---

# 21. DEPENDENCY DATABASE

Track dependencies.

Example:

```text
DEP-001

Feature:
Playback Synchronization

Depends On:
Local Media Player

Required By:
V0.2
```

Dependency statuses:

```text
Open
In Progress
Resolved
Blocked
```

---

# 22. RISK DATABASE

Track product and engineering risks.

Fields:

```text
Risk ID
Risk
Probability
Impact
Mitigation
Owner
Release
Status
```

Examples:

```text
WebRTC NAT traversal failure
Browser extension compatibility
Streaming-provider changes
macOS permission issues
Playback drift
TURN cost
SFU complexity
```

Do not assign arbitrary numerical scores unless there is a clear reason.

---

# 23. EXPERIMENT DATABASE

Use experiments when something is uncertain.

Example:

```text
EXP-001

Hypothesis:
P2P WebRTC provides acceptable reliability for two-person rooms.

Experiment:
Test two Macs across different networks.

Success Criteria:
Connection succeeds under normal home-network conditions.

Result:
...

Decision:
...
```

Experiments should reduce uncertainty before committing to expensive implementation.

---

# 24. SPRINT STRUCTURE

Use lightweight 1-week or 2-week sprints.

Each sprint should contain:

```text
Sprint Goal
Stories
Tasks
Bugs
Expected Outcome
Actual Outcome
Demo
Retrospective
```

---

# 25. SPRINT PLANNING RULE

Do not fill a sprint with arbitrary tasks.

First define:

```text
Sprint Goal
```

Then select stories required to achieve that goal.

Example:

```text
Sprint 1 Goal:

Two users can create and join a WatchSync room.
```

Stories:

```text
US-001 Create Room
US-002 Join Room
US-003 View Participants
```

---

# 26. STORY POINTS

Use simple relative estimation:

```text
1
2
3
5
8
13
```

If a story is larger than 13 points:

> Break it down.

Do not use story points as hours.

---

# 27. DEFINITION OF READY

A story is Ready when:

* User value is clear
* Story is understandable
* Acceptance criteria exist
* Dependencies are identified
* UX requirements are known
* Technical uncertainty is understood
* Story is small enough to implement

---

# 28. DEFINITION OF DONE

A story is Done when:

* Code is implemented
* Acceptance criteria pass
* Tests exist
* Error states are handled
* UI is complete where applicable
* Code review is complete
* No blocking bugs remain
* Documentation is updated where necessary
* Feature works in the target environment

---

# 29. RELEASE DEFINITION OF DONE

A release is Done when:

```text
All committed stories complete
        ↓
Integration tests pass
        ↓
Regression testing
        ↓
Critical bugs resolved
        ↓
Build succeeds
        ↓
DMG generated
        ↓
Installation tested
        ↓
Release notes written
        ↓
Git tag created
        ↓
Release published
```

---

# 30. NOTION RELATIONSHIPS

Create actual relations between databases.

The structure should be:

```text
Release
   ↓
Epic
   ↓
Feature
   ↓
Use Case
   ↓
User Story
   ↓
Acceptance Criteria
   ↓
Engineering Task
```

Also support:

```text
User Story ↔ Dependencies

Feature ↔ Risks

Feature ↔ Product Decisions

Release ↔ Bugs

Story ↔ Experiments
```

Do not duplicate information unnecessarily.

Use Notion relations and rollups.

---

# 31. NOTION VIEWS

Create useful views.

## Product Roadmap

Grouped by:

```text
Release
```

---

## Current Sprint

Filtered:

```text
Sprint = Current Sprint
```

---

## Product Backlog

Grouped by:

```text
Priority
```

---

## Release Board

Kanban:

```text
Planned
In Progress
Testing
Ready to Ship
Shipped
```

---

## User Story Board

Kanban:

```text
Backlog
Ready
In Development
Testing
Done
```

---

## Bug Board

Grouped by:

```text
Severity
```

---

## Blocked Work

Filter:

```text
Status = Blocked
```

---

# 32. TRACEABILITY

Every requirement must be traceable.

Example:

```text
PRD Requirement
      ↓
Release
      ↓
Epic
      ↓
Feature
      ↓
Use Case
      ↓
User Story
      ↓
Acceptance Criteria
      ↓
Engineering Task
      ↓
Test
```

There should never be an important feature that exists only

> **[GAP — source paste was truncated here.]** The end of §32 and all of §33 are missing. The source text jumped from this sentence to a stray fragment ("reused.") and then to §34.

---

# 34. V0.1 BACKLOG

Create the initial V0.1 backlog.

## Epic: Room Management

Features:

```text
FEAT-001 Create Room
FEAT-002 Join Room
FEAT-003 Leave Room
FEAT-004 Rejoin Room
```

---

## Epic: WebRTC

Features:

```text
FEAT-005 Peer Connection
FEAT-006 Camera
FEAT-007 Microphone
FEAT-008 Media Controls
```

---

## Epic: Participants

Features:

```text
FEAT-009 Participant View
FEAT-010 Connection Status
```

---

## Epic: Reliability

Features:

```text
FEAT-011 Reconnection
FEAT-012 Error Handling
```

---

# 35. V0.1 USER STORIES

Create at minimum:

```text
US-001 Create a room

US-002 Join a room

US-003 See the other participant

US-004 Enable my camera

US-005 Disable my camera

US-006 Enable my microphone

US-007 Disable my microphone

US-008 Leave the room

US-009 Rejoin the room

US-010 Understand my connection status

US-011 Recover after temporary connection loss
```

Each story must have Given/When/Then acceptance criteria.

---

# 36. V0.2 BACKLOG

Create:

```text
Epic: Local Media

Epic: Video Player

Epic: Playback Controls

Epic: Playback Synchronization

Epic: Sync-on-Join
```

Stories should cover:

```text
Select video
Load video
Play
Pause
Seek
Change playback rate
Synchronize playback
Join active playback
Recover playback
```

---

# 37. V0.3 BACKLOG

Create:

```text
Epic: Browser Extension

Epic: Provider Detection

Epic: Playback Event Synchronization

Epic: Desktop Extension Bridge
```

Stories should cover:

```text
Install extension
Connect extension
Detect supported provider
Detect playback
Send play event
Send pause event
Send seek event
Receive playback command
Handle unsupported site
Reconnect extension
```

---

# 38. V0.4 BACKLOG

Create:

```text
Epic: Screen Sharing
Epic: Chat
Epic: Reactions
Epic: Social Room UI
```

---

# 39. V0.5 BACKLOG

Create:

```text
Epic: Multiplayer
Epic: SFU
Epic: Participant Management
Epic: Host Controls
```

---

# 40. V0.6 BACKLOG

Create:

```text
Epic: Clock Synchronization
Epic: Drift Detection
Epic: Drift Correction
Epic: Network Recovery
```

---

# 41. V0.7 BACKLOG

Create:

```text
Epic: Authentication
Epic: Profiles
Epic: Friends
Epic: Room History
Epic: Watchlists
```

---

# 42. V0.8 BACKLOG

Create:

```text
Epic: Security
Epic: Observability
Epic: Performance
Epic: Auto Update
Epic: macOS Distribution
Epic: Production Reliability
```

---

# 43. PRODUCT ROADMAP VIEW

Create a roadmap similar to:

```text
                 NOW                         FUTURE

V0.1 ─────── V0.2 ─────── V0.3 ─────── V0.4
Room         Local        Streaming     Social
             Media        Sync          Room
   │            │             │            │
   ↓            ↓             ↓            ↓

V0.5 ─────── V0.6 ─────── V0.7 ─────── V0.8 ───── V1.0
Multi         Smart         Accounts     Production   Complete
player        Sync           Social       Hardening    Product
```

---

# 44. PRODUCT METRICS DASHBOARD

Track:

```text
Rooms Created
Rooms Joined
Successful Connections
Average Room Duration
Playback Sync Accuracy
Reconnection Rate
Crash Rate
Active Rooms
Participants Per Room
```

Metrics should only be added when they help answer a product question.

Do not collect analytics simply because they are technically possible.

---

# 45. NOTION ↔ CODE SYNCHRONIZATION

This is extremely important.

Notion and the repository must not become two unrelated systems.

Use this principle:

```text
Notion
=
Product / Planning Source of Truth

Git Repository
=
Implementation Source of Truth
```

The two systems should be connected through IDs.

Example:

```text
US-005
```

can appear in:

```text
Notion User Story
Git branch
Commit message
Pull request
Test
```

Example branch:

```text
feature/US-005-camera-toggle
```

Commit:

```text
feat(US-005): implement camera toggle
```

---

# 46. GIT CONVENTION

Use:

```text
feature/US-001-create-room
feature/US-002-join-room
feature/US-005-camera-toggle

fix/BUG-001-webrtc-reconnect
```

Commit style:

```text
feat(US-001): create room
feat(US-002): join room
fix(BUG-001): recover websocket connection
test(US-005): add camera toggle tests
```

---

# 47. PULL REQUEST TEMPLATE

Every PR should contain:

```text
## User Story

US-XXX

## What changed

...

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Testing

...

## Screenshots

...

## Risks

...

## Related Notion item

...
```

---

# 48. CLAUDE CODE WORKFLOW

Whenever Claude Code starts a task:

### Step 1

Identify the relevant:

```text
Release
Epic
Feature
User Story
```

### Step 2

Read the acceptance criteria.

### Step 3

Check dependencies.

### Step 4

Inspect the existing implementation.

### Step 5

Implement only the required scope.

### Step 6

Write/update tests.

### Step 7

Run tests.

### Step 8

Verify acceptance criteria.

### Step 9

Update documentation.

### Step 10

Report:

```text
Implemented
Tests
Files changed
Acceptance criteria status
Known issues
Next recommended story
```

---

# 49. IMPORTANT SCOPE CONTROL

Never automatically expand scope.

If implementing:

```text
US-005 Camera Toggle
```

do not also implement:

```text
Screen sharing
Chat
Reactions
Accounts
```

unless explicitly requested.

If you identify a useful future improvement, create:

```text
Future Improvement
```

or:

```text
Technical Debt
```

instead of implementing it immediately.

---

# 50. PRODUCT DECISION PROCESS

When an important decision is unclear:

1. Identify the problem.
2. List reasonable options.
3. Evaluate tradeoffs.
4. Choose the simplest option that satisfies the current release.
5. Record the decision.
6. Continue implementation.

Do not endlessly over-engineer.

---

# 51. NOTION SYNC STATUS

Every implementation item should have:

```text
Notion Status
```

Possible values:

```text
Not Synced
Synced
Implementation Ahead
Notion Ahead
Conflict
```

If code and Notion disagree:

```text
STOP
↓
Identify conflict
↓
Determine intended requirement
↓
Update Product Decision
↓
Synchronize
↓
Continue
```

Never silently overwrite product requirements.

---

# 52. FINAL DELIVERY FORMAT

Whenever you complete a story, report:

```text
WatchSync Implementation Report

Release:
V0.X

Epic:
...

Feature:
...

User Story:
US-XXX

Status:
Done

Implemented:
- ...
- ...
- ...

Acceptance Criteria:
✓ ...
✓ ...
✓ ...

Tests:
- ...

Files Changed:
- ...

Known Issues:
- ...

Technical Debt:
- ...

Next Recommended Story:
US-XXX
```

---

# 53. MOST IMPORTANT RULE

Do not treat WatchSync as one giant project.

Treat it as a sequence of small, independently shippable products.

```text
V0.1
Prove people can connect.

↓

V0.2
Prove people can watch together.

↓

V0.3
Prove authorized streaming playback can synchronize.

↓

V0.4
Make the room social.

↓

V0.5
Scale to groups.

↓

V0.6
Make synchronization resilient.

↓

V0.7
Build the persistent social product.

↓

V0.8
Make it production-ready.

↓

V1.0
Ship the complete experience.
```

The most important product principle is:

> **Do not build features because they sound impressive. Build them because they solve a user problem required by the current product stage.**

Start by creating the **Notion Product Home, Releases, Epics, Features, Use Cases, User Stories, Acceptance Criteria, Engineering Tasks, Bugs, Risks, Dependencies, and Product Decisions** databases.

Then populate them from the WatchSync PRD.

After that, create the **V0.1 backlog** and prepare the first sprint.

Do not begin V0.2 work until V0.1 has passed its release acceptance criteria.
