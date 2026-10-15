import type { IceServer, VoiceCandidate, VoiceSignalBody } from "@watchsync/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { P2PMesh, RETRY_MS } from "./mesh";
import type { PeerState } from "./messages";
import type { Peer } from "./peer";

class FakePeer implements Peer {
  connection: RTCPeerConnectionState = "new";
  signaling: RTCSignalingState = "stable";
  onCandidate: (c: VoiceCandidate) => void = () => {};
  onState: () => void = () => {};
  onAudio: (s: MediaStream) => void = () => {};
  offers: boolean[] = [];
  remotes: string[] = [];
  added: VoiceCandidate[] = [];
  mics: (MediaStreamTrack | null)[] = [];
  configs: RTCConfiguration[] = [];
  closed = false;
  heard: number | null = null;
  constructor(
    readonly config: RTCConfiguration,
    readonly mic: MediaStreamTrack | null,
  ) {}
  async offer(restartIce: boolean) {
    this.offers.push(restartIce);
    this.signaling = "have-local-offer";
    return `offer${this.offers.length}`;
  }
  async answer() {
    this.signaling = "stable";
    return "answer";
  }
  async setRemote(type: "offer" | "answer", sdp: string) {
    this.remotes.push(`${type}:${sdp}`);
    this.signaling = type === "offer" ? "have-remote-offer" : "stable";
  }
  async addCandidate(c: VoiceCandidate) {
    this.added.push(c);
  }
  async setMic(track: MediaStreamTrack | null) {
    this.mics.push(track);
  }
  configure(config: RTCConfiguration) {
    this.configs.push(config);
  }
  level() {
    return this.heard;
  }
  async energy() {
    return 0;
  }
  close() {
    this.closed = true;
  }
}

const cand = (n: number): VoiceCandidate => ({
  candidate: `candidate:${n}`,
  sdpMid: "0",
  sdpMLineIndex: 0,
});

function setup(you: string, policy?: RTCIceTransportPolicy) {
  const peers: FakePeer[] = [];
  const signals: { to: string; signal: VoiceSignalBody }[] = [];
  const states: [string, PeerState | null][] = [];
  const speaking: [string, boolean][] = [];
  const audio: [string, boolean][] = [];
  let clock = 0;
  const mesh = new P2PMesh({
    you,
    policy,
    now: () => clock,
    makePeer: (config, mic) => {
      const p = new FakePeer(config, mic);
      peers.push(p);
      return p;
    },
    events: {
      signal: (to, signal) => signals.push({ to, signal }),
      peer: (id, state) => states.push([id, state]),
      speaking: (id, on) => speaking.push([id, on]),
      audio: (id, stream) => audio.push([id, stream !== null]),
    },
  });
  return {
    mesh,
    peers,
    signals,
    states,
    speaking,
    audio,
    advance: (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    },
  };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("P2PMesh roles", () => {
  it("of a pair, the one whose id sorts first offers; the other waits and answers", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    expect(a.signals).toEqual([
      { to: "b", signal: { kind: "description", type: "offer", sdp: "offer1" } },
    ]);

    const b = setup("b");
    b.mesh.setPeers(["a"]);
    await settle();
    expect(b.peers).toHaveLength(0); // nothing opened: it waits for the offer
    expect(b.states).toEqual([["a", "connecting"]]);
    b.mesh.receive("a", { kind: "description", type: "offer", sdp: "offer1" });
    await settle();
    expect(b.peers).toHaveLength(1);
    expect(b.peers[0]?.remotes).toEqual(["offer:offer1"]);
    expect(b.signals).toEqual([
      { to: "a", signal: { kind: "description", type: "answer", sdp: "answer" } },
    ]);
    // The answer reaches the one who offered.
    a.mesh.receive("b", { kind: "description", type: "answer", sdp: "answer" });
    await settle();
    expect(a.peers[0]?.remotes).toEqual(["answer:answer"]);
  });

  it("ignores messages from people it is not in voice with, and the wrong kind for its role", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    a.mesh.receive("zed", { kind: "description", type: "offer", sdp: "x" });
    a.mesh.receive("b", { kind: "description", type: "offer", sdp: "x" }); // b should answer to me
    await settle();
    expect(a.peers).toHaveLength(1);
    expect(a.peers[0]?.remotes).toEqual([]);

    const b = setup("b");
    b.mesh.setPeers(["a"]);
    b.mesh.receive("a", { kind: "description", type: "answer", sdp: "x" }); // a should offer
    await settle();
    expect(b.peers).toHaveLength(0);
  });

  it("never connects to itself", async () => {
    const a = setup("a");
    a.mesh.setPeers(["a", "b"]);
    await settle();
    expect(a.peers).toHaveLength(1);
  });
});

describe("P2PMesh set-up", () => {
  it("passes the ICE policy and servers to every connection", async () => {
    const servers: IceServer[] = [
      { urls: ["turn:turn.example:3478"], username: "u", credential: "c" },
    ];
    const relay = setup("a", "relay");
    relay.mesh.setIceServers(servers);
    relay.mesh.setPeers(["b", "c"]);
    await settle();
    for (const p of relay.peers) {
      expect(p.config.iceTransportPolicy).toBe("relay");
      expect(p.config.iceServers).toEqual(servers);
    }
    const direct = setup("a");
    direct.mesh.setPeers(["b"]);
    await settle();
    expect(direct.peers[0]?.config.iceTransportPolicy).toBe("all");
  });

  it("holds candidates until the remote description is set, then adds them", async () => {
    const b = setup("b");
    b.mesh.setPeers(["a"]);
    b.mesh.receive("a", { kind: "description", type: "offer", sdp: "o" });
    b.mesh.receive("a", { kind: "candidates", candidates: [cand(1), cand(2)] });
    await settle();
    expect(b.peers[0]?.added.map((c) => c.candidate)).toEqual(["candidate:1", "candidate:2"]);
    b.mesh.receive("a", { kind: "candidates", candidates: [cand(3)] });
    await settle();
    expect(b.peers[0]?.added).toHaveLength(3);
  });

  it("sends found candidates in batches, after the description", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    const peer = a.peers[0];
    peer?.onCandidate(cand(1));
    peer?.onCandidate(cand(2));
    await settle();
    a.advance(100);
    expect(a.signals.map((s) => s.signal.kind)).toEqual(["description", "candidates"]);
    const batch = a.signals[1]?.signal;
    expect(batch?.kind === "candidates" && batch.candidates).toHaveLength(2);
  });

  it("gives a new connection the microphone, and swaps it on the open ones", async () => {
    const a = setup("a");
    const track = { enabled: true } as MediaStreamTrack;
    a.mesh.setPeers(["b"]);
    a.mesh.setMic(track);
    await settle();
    expect(a.peers[0]?.mics).toEqual([track]);
    expect(track.enabled).toBe(false); // everyone starts muted
    a.mesh.setMuted(false);
    expect(track.enabled).toBe(true);
    a.mesh.setPeers(["b", "c"]);
    expect(a.peers[1]?.mic).toBe(track);
  });
});

describe("P2PMesh lifetime", () => {
  it("closes the connection of someone who leaves, and stops their audio", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b", "c"]);
    await settle();
    a.mesh.setPeers(["c"]);
    expect(a.peers[0]?.closed).toBe(true);
    expect(a.peers[1]?.closed).toBe(false);
    expect(a.states.at(-1)).toEqual(["b", null]);
    expect(a.audio.at(-1)).toEqual(["b", false]);
    a.mesh.close();
    expect(a.peers[1]?.closed).toBe(true);
  });

  it("reports connected, and failed when it never connects", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    const peer = a.peers[0];
    if (!peer) throw new Error("no connection");
    peer.connection = "connecting";
    peer.onState();
    a.advance(13_000);
    expect(a.states.at(-1)).toEqual(["b", "failed"]);
    peer.connection = "connected";
    peer.onState();
    expect(a.states.at(-1)).toEqual(["b", "connected"]);
  });

  it("starts a dropped connection again with new network paths, until it is back", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    const peer = a.peers[0];
    if (!peer) throw new Error("no connection");
    a.mesh.receive("b", { kind: "description", type: "answer", sdp: "a" });
    peer.connection = "connected";
    peer.onState();
    a.advance(RETRY_MS);
    await settle();
    expect(peer.offers).toEqual([false]); // up: left alone
    peer.connection = "disconnected";
    peer.onState();
    a.advance(RETRY_MS);
    await settle();
    expect(peer.offers).toEqual([false, true]); // an ICE restart
    a.advance(RETRY_MS);
    await settle();
    expect(peer.offers).toEqual([false, true, true]);
    peer.connection = "connected";
    peer.onState();
    a.advance(RETRY_MS * 2);
    await settle();
    expect(peer.offers).toHaveLength(3);
  });

  it("the one who answers asks the other to start again; the other does", async () => {
    const b = setup("b");
    b.mesh.setPeers(["a"]);
    b.mesh.receive("a", { kind: "description", type: "offer", sdp: "o" });
    await settle();
    const peer = b.peers[0];
    if (!peer) throw new Error("no connection");
    peer.connection = "failed";
    b.signals.length = 0;
    b.advance(RETRY_MS);
    expect(b.signals).toEqual([{ to: "a", signal: { kind: "restart" } }]);

    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    a.mesh.receive("b", { kind: "restart" });
    await settle();
    expect(a.peers[0]?.offers).toEqual([false, false]);
  });

  it("an offer never answered is made again", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    a.advance(RETRY_MS);
    await settle();
    expect(a.peers[0]?.offers).toEqual([false, false]);
  });

  it("reports who is speaking from the levels heard", async () => {
    const a = setup("a");
    a.mesh.setPeers(["b"]);
    await settle();
    const peer = a.peers[0];
    if (!peer) throw new Error("no connection");
    peer.heard = 0.1;
    a.advance(100);
    a.advance(100);
    expect(a.speaking).toEqual([]);
    a.advance(100);
    expect(a.speaking).toEqual([["b", true]]);
    peer.heard = null;
    a.advance(100);
    expect(a.speaking.at(-1)).toEqual(["b", false]);
  });
});
