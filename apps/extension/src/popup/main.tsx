import type { Participant } from "@watchsync/protocol";
import { type ReactNode, type Ref, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ICONS, type IconName } from "../shared/icons";
import {
  type AppState,
  type ChatTabRequest,
  cleanName,
  codeFrom,
  type Edge,
  ERRORS,
  nameProblem,
  type Push,
  type Reply,
  type Request,
  SERVICE_LABEL,
  safeTitleUrl,
  send,
  UNREACHABLE,
} from "../shared/messages";
import { initialOf, toneOf } from "../shared/people";
import { cannotTalk, joinNames, VOICE_MAX, voiceOffer } from "../voice/capability";
import { MODE_AUTO_KEY, MODE_KEY, micMode } from "../voice/echo";
import { detectOs, micHelp, micSettingsUrl } from "../voice/help";
import { watchTalkKey } from "../voice/keys";
import { type BlockedBy, type MicMode, NO_VOICE, type VoiceView } from "../voice/messages";
import { talkWords } from "../voice/words";

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
  const [voice, setVoice] = useState<VoiceView>(NO_VOICE);
  useEffect(() => {
    const port = chrome.runtime.connect({ name: "popup" });
    port.onMessage.addListener((m: Push) => {
      if (m.kind === "state") setState({ ...m.state });
      if (m.kind === "voice") setVoice(m.view);
    });
    return () => port.disconnect();
  }, []);
  return { state, voice };
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
  const trimmed = cleanName(name);
  const problem = nameProblem(name);
  // Say what's wrong only once they've typed something and moved on, or tried to continue.
  const [touched, setTouched] = useState(false);
  const shown = touched && name !== "" ? problem : null;
  return (
    <>
      <Header />
      <form
        className="body"
        onSubmit={async (e) => {
          e.preventDefault();
          setTouched(true);
          if (problem) return;
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
          <h1 className="title">
            Watch together, <span className="em">in sync</span>
          </h1>
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
            aria-invalid={shown ? true : undefined}
            aria-describedby="name-hint"
            onBlur={() => setTouched(true)}
            onChange={(e) => setName(e.target.value)}
          />
          <span className={shown ? "hint bad" : "hint"} id="name-hint" aria-live="polite">
            {shown ?? "Friends see this in the room."}
          </span>
        </label>
        <ErrorLine error={error} />
        <span className="grow" />
        <button className="btn primary" type="submit" disabled={busy || problem !== null}>
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
          <h1 className="title">
            Start <span className="em">a room</span>
          </h1>
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
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(codeFrom(e.target.value))}
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

/** What a person's row says about voice (US-056), or nothing. */
function voiceLine(p: Participant): { cls: "talking" | "muted" | "update"; text: string } | null {
  if (!p.connected) return null;
  if (p.canTalk !== true) return { cls: "update", text: "Needs an update to talk" };
  if (p.voice === "live") return { cls: "talking", text: "Talking" };
  if (p.voice === "muted") return { cls: "muted", text: "Muted" };
  return null;
}

function Person({ p, me, roomTitle }: { p: Participant; me: boolean; roomTitle: string | null }) {
  const s = standing(p, roomTitle);
  const v = voiceLine(p);
  return (
    <li className={p.connected ? "" : "away"}>
      <Avatar name={p.name} />
      <span className="grow stack">
        <span className="name">
          {p.name}
          {me ? " (you)" : ""}
        </span>
        <Watching p={p} />
        {v && <span className={`voice ${v.cls}`}>{v.text}</span>}
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

/**
 * The room's title name, or the name someone on that title reported later: Netflix shows
 * its title only with the player controls, so the room can start without one (BUG-025).
 */
function roomTitleName(state: AppState): string | null {
  const media = state.media;
  if (!media) return null;
  return (
    media.titleName ??
    state.participants.find((p) => p.titleId === media.titleId && p.titleName)?.titleName ??
    null
  );
}

/** Whether anyone in the room has the room's title open right now (BUG-026). */
function someoneOn(state: AppState): boolean {
  const media = state.media;
  return (
    Boolean(media) && state.participants.some((p) => p.connected && p.titleId === media?.titleId)
  );
}

/** "Open Dark" when the room is on a title this person doesn't have open. */
function OpenTitle({ state, me }: { state: AppState; me: string }) {
  const media = state.media;
  const url = safeTitleUrl(media?.titleUrl);
  const self = state.participants.find((p) => p.id === me);
  if (!media || !url || self?.titleId === media.titleId) return null;
  // Only offer a title someone is watching now: after everyone closes it, the room still
  // remembers it, and "Open the room's title" alone in a room made no sense (owner, 2 Oct).
  const watched = state.participants.some(
    (p) => p.id !== me && p.connected && p.titleId === media.titleId,
  );
  if (!watched) return null;
  return (
    <button className="btn primary" type="button" onClick={() => void chrome.tabs.create({ url })}>
      <Icon name="title" />
      <span className="ellipsis">Open {roomTitleName(state) ?? "the room's title"}</span>
    </button>
  );
}

/** The chat shortcut as set at chrome://extensions/shortcuts; null when there is none. */
function useChatShortcut() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    chrome.commands
      .getAll()
      .then((all) => setShortcut(all.find((c) => c.name === "toggle-sidebar")?.shortcut || null))
      .catch(() => setShortcut(null)); // no shortcut to show; the pill still opens chat
  }, []);
  return shortcut;
}

const NO_TAB = "Open the title on a supported service first.";

/** The mic is blocked (US-057): the exact steps, and a button to Chrome's settings for WatchSync. */
function MicHelpCard({ by }: { by: BlockedBy }) {
  const help = micHelp(detectOs(navigator.platform), by);
  return (
    <section className="mic-help" aria-labelledby="mic-help-title">
      <h2 className="mic-help-title" id="mic-help-title">
        {help.title}
      </h2>
      <p className="hint">{help.text}</p>
      <ol>
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {help.button && (
        <button
          className="btn primary"
          type="button"
          onClick={() => void chrome.tabs.create({ url: micSettingsUrl(location.origin) })}
        >
          {help.button}
        </button>
      )}
      <p className="hint">{help.footer}</p>
    </section>
  );
}

/**
 * Talk in the popup (US-056): the same button as on the page, and Alt+T. Pressed, the tab
 * playing the title acts on it (and asks first if the mic isn't allowed yet: the question is
 * on the page, so the popup closes to let you see it).
 */
function TalkRow({ state, voice }: { state: AppState; voice: VoiceView }) {
  const [noTab, setNoTab] = useState(false);
  const offer = voiceOffer(state.participants);
  const { text, label } = talkWords(voice);
  const held = useRef(false);
  // What the press reads when it comes back: the latest, without redoing the listeners.
  const now = useRef({ mic: voice.mic, offer });
  now.current = { mic: voice.mic, offer };
  const press = useCallback(async (edge: Edge) => {
    const r = await send({ kind: "talk", edge });
    setNoTab(!r.ok && r.error === "no_tab");
    if (r.ok && edge === "down" && now.current.offer === "ok" && now.current.mic !== "on")
      window.close();
  }, []);
  const up = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    void press("up");
  }, [press]);
  useEffect(() => {
    const stop = watchTalkKey(document, (edge) => void press(edge));
    return () => {
      stop();
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [press, up]);
  const who = joinNames(
    cannotTalk(state.participants.filter((p) => p.connected)).map((p) => p.name),
  );
  return (
    <div className="talk-row">
      <button
        className={`btn talk ${voice.live ? "live" : ""}`}
        type="button"
        aria-pressed={voice.live}
        aria-label={label}
        aria-keyshortcuts="Alt+T"
        aria-busy={voice.mic === "asking" || undefined}
        onPointerDown={(e) => {
          if (e.button !== 0 || held.current) return;
          held.current = true;
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
          void press("down");
        }}
        onClick={(e) => {
          // A screen reader's "activate" has no pointer before it: a quick press.
          if (e.detail === 0) void press("down").then(() => press("up"));
        }}
      >
        <Icon name={voice.live ? "mic" : "micoff"} />
        {text}
        <span className="key" aria-hidden="true">
          Alt+T
        </span>
      </button>
      {offer === "update" && (
        <p className="hint under">
          Talk turns on for everyone once {who} updates. Sync and chat work now.
        </p>
      )}
      {offer === "full" && (
        <p className="hint under">
          Voice is for up to {VOICE_MAX} people for now. Sync and chat still work.
        </p>
      )}
      {noTab && <p className="hint under">{NO_TAB}</p>}
    </div>
  );
}

/**
 * Opens chat on the tab playing the room's title (US-115): a full-width row with the unread
 * count and the shortcut inside it. Off, it says why in one line under it.
 */
function OpenChat({ shortcut, unread }: { shortcut: string | null; unread: number }) {
  const [hasTab, setHasTab] = useState<boolean | null>(null);
  useEffect(() => {
    const ask: ChatTabRequest = { kind: "hasChatTab" };
    chrome.runtime
      .sendMessage(ask)
      .then((r: unknown) => setHasTab(r === true))
      .catch(() => setHasTab(false));
  }, []);
  const open = async () => {
    const r = await send({ kind: "openChat" });
    if (r.ok) window.close();
    else setHasTab(false);
  };
  return (
    <div className="open-chat">
      <button
        className="btn chat-row"
        type="button"
        disabled={hasTab !== true}
        aria-label={unread > 0 ? `Open chat, ${unread} unread` : "Open chat"}
        aria-describedby={hasTab === false ? "open-chat-why" : undefined}
        title={shortcut ? `Open chat on the player with ${shortcut}` : undefined}
        onClick={() => void open()}
      >
        <Icon name="chat" />
        <span className="chat-label">Open chat</span>
        {unread > 0 && (
          <span className="count-pill" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        {shortcut && (
          <span className="key" aria-hidden="true">
            {shortcut}
          </span>
        )}
      </button>
      {hasTab === false && (
        <p className="hint under" id="open-chat-why">
          {NO_TAB}
        </p>
      )}
    </div>
  );
}

function RoomScreen({ state, voice }: { state: AppState; voice: VoiceView }) {
  const copy = useFocusOnShow<HTMLButtonElement>();
  const [copied, setCopied] = useState("");
  const shortcut = useChatShortcut();
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
            {state.updating && state.connection === "reconnecting"
              ? "Updating…"
              : CONNECTION[state.connection]}
          </span>
        }
      />
      <div className="body">
        {state.unreachable && state.connection === "reconnecting" && (
          <div className="row center">
            <p className="hint grow" role="status">
              {UNREACHABLE}
            </p>
            <button
              className="btn compact"
              type="button"
              onClick={() => send({ kind: "retryNow" })}
            >
              Try now
            </button>
          </div>
        )}
        {alone ? (
          <section className="invite-card" aria-labelledby="invite-title">
            <p className="invite-title" id="invite-title">
              Send this to <span className="em">your friends</span>
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
              {media && someoneOn(state)
                ? (roomTitleName(state) ?? SERVICE_LABEL[media.service])
                : "Nothing playing"}
            </p>
            <p className="hint">{summary(state, s.participantId)}</p>
          </section>
        )}
        <section className="section">
          <h2 className="label">In this room ({state.participants.length})</h2>
          {people}
        </section>
        <OpenTitle state={state} me={s.participantId} />
        <TalkRow state={state} voice={voice} />
        {voice.mic === "blocked" && <MicHelpCard by={voice.blocked ?? "chrome"} />}
        <OpenChat shortcut={shortcut} unread={state.unread} />
        <div className="bottom">
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
              {state.following ? "Watch on my own" : "Watch with the room"}
            </button>
            <button className="btn danger" type="button" onClick={() => send({ kind: "leave" })}>
              <Icon name="leave" />
              Leave room
            </button>
          </div>
        </div>
        <p className="sr-only" role="status">
          {copied}
        </p>
      </div>
    </>
  );
}

const MODE_HELP: Record<MicMode, string> = {
  open: "Unmute once and talk freely. Chrome keeps the film out of your mic.",
  ptt: "Hold Talk, or Alt+T, while you talk. Best on laptop speakers.",
};

/** Voice settings (US-056): how the mic behaves. The default follows what this Chrome can do. */
function VoiceSettings({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<MicMode>("ptt");
  const first = useFocusOnShow<HTMLInputElement>();
  useEffect(() => {
    const read = () =>
      chrome.storage.local
        .get([MODE_KEY, MODE_AUTO_KEY])
        .then((got) => setMode(micMode(got[MODE_KEY], got[MODE_AUTO_KEY])))
        .catch(() => {});
    read();
    const changed = (_: unknown, area: string) => {
      if (area === "local") read();
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  const choose = (next: MicMode) => {
    setMode(next);
    chrome.storage.local.set({ [MODE_KEY]: next }).catch(() => {});
  };
  const option = (value: MicMode, label: string) => (
    <label className={`seg-option ${mode === value ? "on" : ""}`}>
      <input
        ref={mode === value ? first : undefined}
        type="radio"
        name="mic-mode"
        value={value}
        checked={mode === value}
        aria-describedby="mic-help"
        onChange={() => choose(value)}
      />
      {label}
    </label>
  );
  return (
    <>
      <Header
        right={
          <button className="btn compact" type="button" onClick={onBack}>
            <Icon name="left" size={14} />
            Back
          </button>
        }
      />
      <div className="body">
        <h1 className="title">Voice</h1>
        <fieldset className="field seg">
          <legend className="label">Microphone</legend>
          <div className="seg-row">
            {option("open", "Open mic")}
            {option("ptt", "Push to talk")}
          </div>
          <p className="hint" id="mic-help">
            {MODE_HELP[mode]}
          </p>
        </fieldset>
        <span className="grow" />
        <p className="hint">
          Your voice goes straight to the people in the room. WatchSync never records it and our
          server never hears it.
        </p>
      </div>
    </>
  );
}

function Footer({ update, onVoice }: { update: AppState["update"]; onVoice: () => void }) {
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
        <a href={__SITE_URL__} target="_blank" rel="noreferrer">
          {new URL(__SITE_URL__).host}
        </a>
        <a href={`${__SITE_URL__}/privacy/`} target="_blank" rel="noreferrer">
          Privacy
        </a>
        <a href={`${__SITE_URL__}/terms/`} target="_blank" rel="noreferrer">
          Terms
        </a>
        <button className="link" type="button" onClick={onVoice}>
          Voice
        </button>
        <span className="grow" />
        <span className="version">
          v{chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version}
        </span>
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

function Screen({ state, voice }: { state: AppState; voice: VoiceView }) {
  if (!state.name) return <NameScreen />;
  if (state.session) return <RoomScreen state={state} voice={voice} />;
  return <HomeScreen state={state} />;
}

function Popup() {
  const { state, voice } = useAppState();
  const [page, setPage] = useState<"main" | "voice">("main");
  return (
    <>
      <main
        className="screen"
        key={page === "voice" ? "voice" : state ? screenOf(state) : "loading"}
      >
        {page === "voice" ? (
          <VoiceSettings onBack={() => setPage("main")} />
        ) : state ? (
          <Screen state={state} voice={voice} />
        ) : (
          <Loading />
        )}
      </main>
      <Footer update={state?.update ?? null} onVoice={() => setPage("voice")} />
    </>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<Popup />);
