import type { Participant } from "@watchsync/protocol";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type AppState,
  ERRORS,
  type Push,
  type Reply,
  type Request,
  SERVICE_LABEL,
  send,
} from "../shared/messages";

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
        <ErrorLine error={error ?? state.notice} />
        {state.lastRoom && <RejoinRow code={state.lastRoom} />}
        <JoinForm />
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
          Rejoin room {code}
        </button>
        <button className="btn" type="button" onClick={() => run({ kind: "forgetRoom" })}>
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
          placeholder="Code"
          value={code}
          maxLength={6}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        />
        <button className="btn" type="submit" disabled={busy || !valid}>
          {busy ? "Joining…" : "Join"}
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
  return <span className="hint">{p.titleName ? `${service} · ${p.titleName}` : service}</span>;
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
  const status = {
    connected: "Connected",
    connecting: "Connecting…",
    reconnecting: "Reconnecting…",
    idle: "Offline",
  }[state.connection];
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
              <span className="grow stack">
                <span>
                  {p.name}
                  {p.id === s.participantId ? " (you)" : ""}
                </span>
                <Watching p={p} />
              </span>
            </li>
          ))}
        </ul>
        <span className="grow" />
        <button className="btn danger" type="button" onClick={() => send({ kind: "leave" })}>
          Leave room
        </button>
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
