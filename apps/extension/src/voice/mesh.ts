// The one MediaTransport there is (UC-021): every person in voice connects straight to every
// other (a mesh), which is why a room holds at most four. Of each pair, the one whose id sorts
// first offers and the other answers, so two offers never cross. Nothing here is stored; a
// connection that fails or drops is started again (ICE restart) until the person leaves.
import type { IceServer, VoiceCandidate, VoiceSignalBody } from "@watchsync/protocol";
import type { PeerState } from "./messages";
import { type Peer, type PeerFactory, rtcConfig } from "./peer";
import { SpeakingDetector } from "./speaking";
import type { MediaTransport, TransportEvents } from "./transport";

/** How often a connection that isn't up is looked at, and started again if it needs it. */
export const RETRY_MS = 5000;
/** A connection that has never come up is reported as failed after this long. */
export const FAIL_AFTER_MS = 12_000;
/** Candidates found within this long go out in one message (the room limits messages). */
const BATCH_MS = 80;
const MAX_CANDIDATES = 32;
const LEVEL_EVERY_MS = 100;

/** The certificate fingerprint line of an SDP ("sha-256 AB:CD:..."), if it has one. */
const fingerprint = (sdp: string) => /^a=fingerprint:(\S+ \S+)/m.exec(sdp)?.[1] ?? null;

interface Link {
  id: string;
  peer: Peer;
  offerer: boolean;
  /** The remote description is set, so candidates can be added. */
  remote: boolean;
  /** The other side's certificate fingerprint, from its description. */
  print: string | null;
  /** Our description has gone out, so our candidates may follow it. */
  sent: boolean;
  waiting: VoiceCandidate[];
  found: VoiceCandidate[];
  flush: ReturnType<typeof setTimeout> | undefined;
  everUp: boolean;
  since: number;
  state: PeerState;
  speaker: SpeakingDetector;
  /** One step at a time per connection: negotiation steps may not overlap. */
  chain: Promise<void>;
}

export interface MeshOptions {
  /** Who I am: decides, for each pair, who offers. */
  you: string;
  events: TransportEvents;
  makePeer: PeerFactory;
  /** "relay" sends everything through TURN (for testing that path); "all" tries direct first. */
  policy?: RTCIceTransportPolicy;
  servers?: readonly IceServer[];
  now?: () => number;
}

export class P2PMesh implements MediaTransport {
  private readonly links = new Map<string, Link>();
  private wanted = new Set<string>();
  private mic: MediaStreamTrack | null = null;
  private muted = true;
  private servers: readonly IceServer[];
  private tick: ReturnType<typeof setInterval> | undefined;
  private levels: ReturnType<typeof setInterval> | undefined;
  private readonly policy: RTCIceTransportPolicy;
  private readonly now: () => number;

  constructor(private readonly o: MeshOptions) {
    this.policy = o.policy ?? "all";
    this.servers = o.servers ?? [];
    this.now = o.now ?? (() => performance.now());
  }

  setPeers(ids: readonly string[]) {
    this.wanted = new Set(ids.filter((id) => id !== this.o.you));
    for (const id of [...this.links.keys()]) if (!this.wanted.has(id)) this.drop(id);
    for (const id of this.wanted) {
      if (this.links.has(id)) continue;
      if (this.offers(id)) this.start(id);
      else this.o.events.peer(id, "connecting"); // they offer; we answer when it arrives
    }
  }

  receive(from: string, signal: VoiceSignalBody) {
    if (!this.wanted.has(from)) return; // not someone we are in voice with
    const link = this.links.get(from);
    if (signal.kind === "restart") {
      if (link?.offerer) this.step(link, () => this.offer(link, link.remote));
      return;
    }
    if (signal.kind === "description") {
      // Only the one who answers takes an offer, and only the one who offers takes an answer.
      if ((signal.type === "offer") === this.offers(from)) return;
      // A different fingerprint is a new browser behind the same person (they came back from
      // a dropped connection): the old connection can't carry on with it. Start over.
      let l = link;
      const print = fingerprint(signal.sdp);
      if (l?.print && print && l.print !== print) {
        this.drop(from);
        l = undefined;
        if (signal.type === "answer") return this.start(from);
      }
      const now = l ?? this.open(from, false);
      this.step(now, () => this.describe(now, signal.type, signal.sdp, print));
      return;
    }
    if (!link) return; // candidates ahead of the offer: it will send them again if it matters
    for (const c of signal.candidates) {
      if (link.remote) this.step(link, () => this.add(link, c));
      else link.waiting.push(c);
    }
  }

  setIceServers(servers: readonly IceServer[]) {
    this.servers = servers;
    for (const l of this.links.values()) l.peer.configure(rtcConfig(servers, this.policy));
  }

  setMic(track: MediaStreamTrack | null) {
    this.mic = track;
    if (track) track.enabled = !this.muted;
    for (const l of this.links.values()) {
      l.peer.setMic(track).catch((e: unknown) => console.debug("watchsync: voice mic", e));
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.mic) this.mic.enabled = !muted;
  }

  retry() {
    for (const l of this.links.values()) if (l.state !== "connected") this.again(l);
  }

  /** Audio energy heard from each person so far (test builds only read this). */
  async heard(): Promise<Record<string, number>> {
    const entries = await Promise.all(
      [...this.links].map(async ([id, l]) => [id, await l.peer.energy()] as const),
    );
    return Object.fromEntries(entries);
  }

  close() {
    this.wanted = new Set();
    for (const id of [...this.links.keys()]) this.drop(id);
  }

  /** Of this pair, do I offer? */
  private offers(id: string) {
    return this.o.you < id;
  }

  private start(id: string) {
    const link = this.open(id, true);
    this.step(link, () => this.offer(link, false));
  }

  private open(id: string, offerer: boolean): Link {
    const peer = this.o.makePeer(rtcConfig(this.servers, this.policy), this.mic, offerer);
    const link: Link = {
      id,
      peer,
      offerer,
      remote: false,
      print: null,
      sent: false,
      waiting: [],
      found: [],
      flush: undefined,
      everUp: false,
      since: this.now(),
      state: "connecting",
      speaker: new SpeakingDetector(),
      chain: Promise.resolve(),
    };
    peer.onCandidate = (c) => {
      link.found.push(c);
      this.flushSoon(link);
    };
    peer.onState = () => this.changed(link);
    peer.onAudio = (stream) => this.o.events.audio(id, stream);
    this.links.set(id, link);
    this.o.events.peer(id, "connecting");
    this.tick ??= setInterval(() => this.check(), RETRY_MS);
    this.levels ??= setInterval(() => this.listen(), LEVEL_EVERY_MS);
    return link;
  }

  private drop(id: string) {
    const link = this.links.get(id);
    this.links.delete(id);
    if (!link) return;
    clearTimeout(link.flush);
    link.peer.close();
    this.o.events.audio(id, null);
    if (link.speaker.speaking) this.o.events.speaking(id, false);
    this.o.events.peer(id, null);
    if (this.links.size === 0) {
      clearInterval(this.tick);
      clearInterval(this.levels);
      this.tick = undefined;
      this.levels = undefined;
    }
  }

  /** Runs one negotiation step after the one before it; a step that fails is tried again later. */
  private step(link: Link, work: () => Promise<void>) {
    link.chain = link.chain.then(work).catch((e: unknown) => {
      console.debug("watchsync: voice step", e);
    });
  }

  private async offer(link: Link, restart: boolean) {
    const sdp = await link.peer.offer(restart);
    this.say(link, { kind: "description", type: "offer", sdp });
  }

  private async describe(link: Link, type: "offer" | "answer", sdp: string, print: string | null) {
    if (type === "answer" && link.peer.signaling !== "have-local-offer") return;
    await link.peer.setRemote(type, sdp);
    link.remote = true;
    link.print = print;
    for (const c of link.waiting.splice(0)) await this.add(link, c);
    if (type === "offer")
      this.say(link, { kind: "description", type: "answer", sdp: await link.peer.answer() });
  }

  private async add(link: Link, c: VoiceCandidate) {
    try {
      await link.peer.addCandidate(c);
    } catch (e) {
      // A candidate from a connection attempt that has been replaced: nothing to do.
      console.debug("watchsync: voice candidate", e);
    }
  }

  /** Sends our description, and from then on the candidates found for it. */
  private say(link: Link, signal: VoiceSignalBody) {
    this.o.events.signal(link.id, signal);
    link.sent = true;
    this.flushSoon(link);
  }

  private flushSoon(link: Link) {
    if (!link.sent || link.flush !== undefined || link.found.length === 0) return;
    link.flush = setTimeout(() => {
      link.flush = undefined;
      for (;;) {
        const [first, ...rest] = link.found.splice(0, MAX_CANDIDATES);
        if (!first) break;
        this.o.events.signal(link.id, { kind: "candidates", candidates: [first, ...rest] });
      }
    }, BATCH_MS);
  }

  private changed(link: Link) {
    const cs = link.peer.connection;
    if (cs === "connected") link.everUp = true;
    const state: PeerState =
      cs === "connected"
        ? "connected"
        : cs === "failed" || (!link.everUp && this.now() - link.since > FAIL_AFTER_MS)
          ? "failed"
          : "connecting";
    if (state === link.state) return;
    link.state = state;
    this.o.events.peer(link.id, state);
  }

  /** Every few seconds: a connection that isn't up is started again. */
  private check() {
    for (const l of this.links.values()) {
      this.changed(l);
      const cs = l.peer.connection;
      if (cs === "connected" || cs === "connecting") continue;
      this.again(l);
    }
  }

  /** Start one connection again: the one who offers makes a new offer, the other asks for it. */
  private again(link: Link) {
    if (link.offerer) {
      // Never answered: the same set-up again. Otherwise new network paths (ICE restart).
      this.step(link, () => this.offer(link, link.remote));
    } else {
      this.o.events.signal(link.id, { kind: "restart" });
    }
  }

  private listen() {
    const now = this.now();
    for (const l of this.links.values()) {
      if (l.speaker.feed(l.peer.level(now), now)) this.o.events.speaking(l.id, l.speaker.speaking);
    }
  }
}
