import type { Participant } from "@watchsync/protocol";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ICONS, type IconName } from "../shared/icons";
import {
  type AppState,
  ERRORS,
  type Push,
  type Reply,
  type Request,
  SERVICE_LABEL,
  safeTitleUrl,
  send,
} from "../shared/messages";
import { initialOf, toneOf } from "../shared/people";

export const inviteLink = (code: string) => `${__API_URL__}/j/${code}`;

/** Moves focus to a screen's main control when the screen appears (WCAG 2.4.3 focus order). */
function useFocusOnShow<T extends HTMLElement>(key?: unknown) {
  const ref = useRef<T>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when `key` changes
  useEffect(() => ref.current?.focus(), [key]);
  return ref;
}

function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    const port = chrome.runtime.connect({ name: "popup" });
    port.onMessage.addListener((m: Push) => {
      if (m.kind === "state") setState({ ...m.state });
    });
    return () => port.disconnect();
  }, []);
  return state;
}

/** `unreachable` overrides the generic network message for this action. */
function useAction(unreachable?: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (req: Request): Promise<Reply | null> => {
    setBusy(true);
    setError(null);
    try {
      const r = await send(req);
      if (!r.ok) {
        const generic = ERRORS[r.error] ?? ERRORS.unreachable ?? null;
        setError(r.error === "unreachable" && unreachable ? unreachable : generic);
      }
      return r;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const { d, fill } = ICONS[name];
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {fill ? (
        <path d={d} fill="currentColor" />
      ) : (
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="head">
      <span className="logo" aria-hidden="true" />
      <span className="word">WatchSync</span>
      {__CHANNEL__ === "dev" && <span className="dev-chip">Dev</span>}
      <span className="grow" />
      {right}
    </header>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="callout">
      <Icon name="alert" />
      <p className="error" role="alert">
        {error}
      </p>
    </div>
  ) : null;
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const tone = toneOf(name);
  return (
    <span
      className={`avatar ${size}`}
      style={{ color: tone.fg, background: tone.bg }}
      aria-hidden="true"
    >
      {initialOf(name)}
    </span>
  );
}

function NameScreen({ initial = "", onDone }: { initial?: string; onDone?: () => void }) {
  const [name, setName] = useState(initial);
  const { busy, error, run } = useAction();
  const input = useFocusOnShow<HTMLInputElement>();
  const trimmed = name.trim();
  return (
    <>
      <Header />
      <form
        className="body"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await run({ kind: "setName", name }))?.ok) onDone?.();
        }}
      >
        <div className="intro">
          {trimmed ? (
            <Avatar name={trimmed} size="lg" />
          ) : (
            <span className="avatar lg blank" aria-hidden="true">
              <span className="logo" />
            </span>
          )}
          <h1 className="title">Watch together, in sync</h1>
          <p className="dim">
            Works with Netflix, Prime Video and JioHotstar. Each of you uses your own account.
          </p>
        </div>
        <label className="field">
          <span className="label">Your name</span>
          <input
            ref={input}
            className="input"
            value={name}
            maxLength={30}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
          <span className="hint">Friends see this in the room.</span>
        </label>
        <ErrorLine error={error} />
        <span className="grow" />
        <button className="btn primary" type="submit" disabled={busy || !trimmed}>
          Continue
        </button>
      </form>
    </>
  );
}

function HomeScreen({ state }: { state: AppState }) {
  const { busy, error, run } = useAction("We couldn't create the room. Try again.");
  const [editing, setEditing] = useState(false);
  const create = useFocusOnShow<HTMLButtonElement>(editing);
  if (editing) return <NameScreen initial={state.name ?? ""} onDone={() => setEditing(false)} />;
  return (
    <>
      <Header />
      <div className="body">
        <div>
          <h1 className="title">Start a room</h1>
          <p className="dim">
            Send the link to a friend. Every play, pause and jump stays in step.
          </p>
        </div>
        <button
          ref={create}
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() => run({ kind: "create" })}
        >
          {busy ? "Creating room…" : "Create a room"}
        </button>
        <ErrorLine error={error ?? state.notice} />
        {state.lastRoom && <RejoinRow code={state.lastRoom} />}
        <JoinForm />
        <span className="grow" />
        <div className="me">
          <Avatar name={state.name ?? ""} size="sm" />
          <p className="hint">
            You're <b>{state.name}</b> ·{" "}
            <button className="link" type="button" onClick={() => setEditing(true)}>
              Change name
            </button>
          </p>
        </div>
      </div>
    </>
  );
}

function RejoinRow({ code }: { code: string }) {
  const { busy, error, run } = useAction();
  return (
    <div className="field">
      <div className="row">
        <button
          className="btn grow"
          type="button"
          disabled={busy}
          onClick={() => run({ kind: "rejoin" })}
        >
          <Icon name="rejoin" />
          {busy ? "Rejoining…" : `Rejoin room ${code}`}
        </button>
        <button className="btn quiet" type="button" onClick={() => run({ kind: "forgetRoom" })}>
          Forget
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function JoinForm() {
  const [code, setCode] = useState("");
  const { busy, error, run } = useAction();
  const valid = /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        run({ kind: "join", code });
      }}
    >
      <span className="label" id="join-label">
        Or join a friend's room
      </span>
      <div className="row">
        <input
          className="input code-input grow"
          aria-labelledby="join-label"
          placeholder="6-character code"
          value={code}
          maxLength={6}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
        <button className="btn" type="submit" disabled={busy || !valid}>
          {busy ? "Joining…" : "Join room"}
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

function Watching({ p }: { p: Participant }) {
  if (!p.connected) return <span className="hint">Away</span>;
  if (p.service === "none") return <span className="hint">No title open</span>;
  const service = SERVICE_LABEL[p.service];
  const what = p.titleName ? `${service} · ${p.titleName}` : service;
  return <span className="hint">{p.following ? what : `On their own · ${what}`}</span>;
}

/** Where a person stands against the room: in sync, held up, or nothing to say. */
function standing(p: Participant, roomTitle: string | null): "sync" | "ad" | "loading" | null {
  if (!p.connected || !p.following || roomTitle === null || p.titleId !== roomTitle) return null;
  if (p.hold === "ad") return "ad";
  if (p.hold === "buffering") return "loading";
  return "sync";
}

const STANDING = {
  sync: { icon: "check", text: "In sync" },
  ad: { icon: "ad", text: "On an ad" },
  loading: { icon: "wait", text: "Loading" },
} as const;

function Person({ p, me, roomTitle }: { p: Participant; me: boolean; roomTitle: string | null }) {
  const s = standing(p, roomTitle);
  return (
    <li className={p.connected ? "" : "away"}>
      <Avatar name={p.name} />
      <span className="grow stack">
        <span className="name">
          {p.name}
          {me ? " (you)" : ""}
        </span>
        <Watching p={p} />
      </span>
      {s && (
        <span className={`chip ${s}`}>
          <Icon name={STANDING[s].icon} size={14} />
          {STANDING[s].text}
        </span>
      )}
    </li>
  );
}

/** One line on what the room is doing, e.g. "Everyone's together" or "Asha is on another title". */
function summary(state: AppState, me: string): string {
  const media = state.media;
  if (!media) return "Nobody has a title open yet. Open one on Netflix, Prime Video or JioHotstar.";
  if (!state.following) return "You're watching on your own. The room carries on without you.";
  const self = state.participants.find((p) => p.id === me);
  if (self && self.titleId !== media.titleId) return "You're on a different title from the room.";
  const others = state.participants.filter((p) => p.id !== me && p.connected);
  const odd = others.find((p) => standing(p, media.titleId) !== "sync");
  if (!odd) return "Everyone's together.";
  if (odd.hold === "ad") return `${odd.name} is on an ad.`;
  if (odd.hold === "buffering") return `${odd.name} is loading.`;
  if (!odd.following) return `${odd.name} is watching on their own.`;
  if (odd.service === "none") return `${odd.name} hasn't opened a title yet.`;
  return `${odd.name} is on another title.`;
}

interface CopyButtonProps {
  text: string;
  label: string;
  icon: IconName;
  primary?: boolean;
  onCopied: (what: string) => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

function CopyButton({ text, label, icon, primary, onCopied, buttonRef }: CopyButtonProps) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      ref={buttonRef}
      className={`btn ${primary ? "primary" : ""} grow`}
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        onCopied(label === "Copy link" ? "Link copied" : "Code copied");
      }}
    >
      <Icon name={done ? "check" : icon} />
      {done ? "Copied" : label}
    </button>
  );
}

const CONNECTION = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  idle: "Offline",
} as const;

/** "Open Dark" when the room is on a title this person doesn't have open. */
function OpenTitle({ state, me }: { state: AppState; me: string }) {
  const media = state.media;
  const url = safeTitleUrl(media?.titleUrl);
  const self = state.participants.find((p) => p.id === me);
  if (!media || !url || self?.titleId === media.titleId) return null;
  return (
    <button className="btn primary" type="button" onClick={() => void chrome.tabs.create({ url })}>
      <Icon name="title" />
      <span className="ellipsis">Open {media.titleName ?? "the room's title"}</span>
    </button>
  );
}

function RoomScreen({ state }: { state: AppState }) {
  const copy = useFocusOnShow<HTMLButtonElement>();
  const [copied, setCopied] = useState("");
  const s = state.session;
  if (!s) return null;
  // Alone, inviting is the next step; once others are here, the room is about them (BUG-016).
  const alone = state.participants.filter((p) => p.id !== s.participantId).length === 0;
  const media = state.media;
  const people = (
    <ul className="people" aria-label="People in the room">
      {state.participants.map((p) => (
        <Person
          key={p.id}
          p={p}
          me={p.id === s.participantId}
          roomTitle={alone ? null : (media?.titleId ?? null)}
        />
      ))}
    </ul>
  );
  const copyRow = (primary: boolean) => (
    <div className="row">
      <CopyButton
        text={inviteLink(s.code)}
        label="Copy link"
        icon="link"
        primary={primary}
        onCopied={setCopied}
        buttonRef={primary ? copy : undefined}
      />
      <CopyButton text={s.code} label="Copy code" icon="copy" onCopied={setCopied} />
    </div>
  );
  return (
    <>
      <Header
        right={
          <span className={`badge ${state.connection}`} role="status">
            <span className="dot" aria-hidden="true" />
            {CONNECTION[state.connection]}
          </span>
        }
      />
      <div className="body">
        {alone ? (
          <section className="invite-card" aria-labelledby="invite-title">
            <p className="dim" id="invite-title">
              Send this to your friends
            </p>
            <p className="code" data-testid="room-code">
              {s.code}
            </p>
            {copyRow(true)}
            <p className="hint">Your friend needs the WatchSync extension and their own account.</p>
          </section>
        ) : (
          <section className="now" aria-labelledby="now-title">
            <span className="eyebrow" id="now-title">
              Now watching
            </span>
            <p className="now-name">
              {media ? (media.titleName ?? SERVICE_LABEL[media.service]) : "Nothing yet"}
            </p>
            <p className="hint">{summary(state, s.participantId)}</p>
          </section>
        )}
        <section className="section">
          <h2 className="label">In this room ({state.participants.length})</h2>
          {people}
        </section>
        <OpenTitle state={state} me={s.participantId} />
        <span className="grow" />
        {!alone && (
          <div className="invite">
            <p className="hint">
              Invite more · <span data-testid="room-code">{s.code}</span>
            </p>
            {copyRow(false)}
          </div>
        )}
        <div className="row">
          <button
            className="btn grow"
            type="button"
            onClick={() => send({ kind: "follow", following: !state.following })}
          >
            <Icon name="sync" />
            {state.following ? "Watch on my own" : "Sync with the room"}
          </button>
          <button className="btn danger" type="button" onClick={() => send({ kind: "leave" })}>
            <Icon name="leave" />
            Leave room
          </button>
        </div>
        <p className="sr-only" role="status">
          {copied}
        </p>
      </div>
    </>
  );
}

function Footer({ update }: { update: AppState["update"] }) {
  return (
    <footer className="foot">
      {update && (
        <p className="update">
          {__CHANNEL__ === "dev"
            ? "A newer dev build is out"
            : `WatchSync ${update.version} is out`}{" "}
          ·{" "}
          <a href={update.url} target="_blank" rel="noreferrer">
            Download
          </a>
        </p>
      )}
      <p className="foot-row">
        <a href={`${__API_URL__}/privacy`} target="_blank" rel="noreferrer">
          Privacy
        </a>
        <a href={`${__API_URL__}/terms`} target="_blank" rel="noreferrer">
          Terms
        </a>
        <span className="grow" />
        <span>v{chrome.runtime.getManifest().version}</span>
      </p>
    </footer>
  );
}

/** While the first state arrives: the popup's shape, so it never opens blank. */
function Loading() {
  return (
    <>
      <Header />
      <div className="body skeleton" aria-busy="true">
        <p className="sr-only" role="status">
          Loading WatchSync…
        </p>
        <span className="bone title-bone" />
        <span className="bone line-bone" />
        <span className="bone btn-bone" />
        <span className="bone btn-bone" />
      </div>
    </>
  );
}

function screenOf(state: AppState): string {
  if (!state.name) return "name";
  return state.session ? "room" : "home";
}

function Screen({ state }: { state: AppState }) {
  if (!state.name) return <NameScreen />;
  if (state.session) return <RoomScreen state={state} />;
  return <HomeScreen state={state} />;
}

function Popup() {
  const state = useAppState();
  return (
    <>
      <main className="screen" key={state ? screenOf(state) : "loading"}>
        {state ? <Screen state={state} /> : <Loading />}
      </main>
      <Footer update={state?.update ?? null} />
    </>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<Popup />);
