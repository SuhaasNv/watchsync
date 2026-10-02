import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type AppState, type Push, type Reply, type Request, send } from "../shared/messages";

const ERRORS: Record<string, string> = {
  unreachable: "We couldn't reach WatchSync. Check your connection and try again.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  invalid: "Enter a name of 1 to 30 characters.",
  not_found: "We can't find that room. Check the code with your friend.",
  expired: "This room is no longer available.",
  full: "This room is full.",
};

export const inviteLink = (code: string) => `${__API_URL__}/j/${code}`;

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

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="head">
      <span className="logo" aria-hidden="true" />
      <span className="word">WatchSync</span>
      <span className="grow" />
      {right}
    </header>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

function NameScreen({ initial = "", onDone }: { initial?: string; onDone?: () => void }) {
  const [name, setName] = useState(initial);
  const { busy, error, run } = useAction();
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
        <div>
          <h1 className="title">Watch together, in sync</h1>
          <p className="dim">
            Works with Netflix, Prime Video and JioHotstar. Each of you uses your own account.
          </p>
        </div>
        <label className="field">
          <span className="label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="hint">Friends see this in the room.</span>
        </label>
        <ErrorLine error={error} />
        <span className="grow" />
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
          Continue
        </button>
      </form>
    </>
  );
}

function HomeScreen({ state }: { state: AppState }) {
  const { busy, error, run } = useAction("We couldn't create the room. Try again.");
  const [editing, setEditing] = useState(false);
  if (editing) return <NameScreen initial={state.name ?? ""} onDone={() => setEditing(false)} />;
  return (
    <>
      <Header />
      <div className="body">
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          onClick={() => run({ kind: "create" })}
        >
          {busy ? "Creating room…" : "Create a room"}
        </button>
        <ErrorLine error={error} />
        <span className="grow" />
        <p className="hint center">
          You're <b>{state.name}</b> ·{" "}
          <button className="link" type="button" onClick={() => setEditing(true)}>
            Change name
          </button>
        </p>
      </div>
    </>
  );
}

function CopyButton({ text, label, primary }: { text: string; label: string; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`btn ${primary ? "primary" : ""} grow`}
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function RoomScreen({ state }: { state: AppState }) {
  const s = state.session;
  if (!s) return null;
  const status =
    state.connection === "connected"
      ? "Connected"
      : state.connection === "idle"
        ? "Offline"
        : "Connecting…";
  return (
    <>
      <Header right={<span className={`badge ${state.connection}`}>{status}</span>} />
      <div className="body">
        <div>
          <p className="dim">Send this to your friend</p>
          <p className="code" data-testid="room-code">
            {s.code}
          </p>
        </div>
        <div className="row">
          <CopyButton text={inviteLink(s.code)} label="Copy link" primary />
          <CopyButton text={s.code} label="Copy code" />
        </div>
        <p className="hint">Your friend needs the WatchSync extension and their own account.</p>
        <ul className="people" aria-label="People in the room">
          {state.participants.map((p) => (
            <li key={p.id}>
              <span className="avatar" aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="grow">
                {p.name}
                {p.id === s.participantId ? " (you)" : ""}
              </span>
              <span className="dim">{p.connected ? "" : "away"}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Popup() {
  const state = useAppState();
  if (!state) return null;
  if (!state.name) return <NameScreen />;
  if (state.session) return <RoomScreen state={state} />;
  return <HomeScreen state={state} />;
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<Popup />);
