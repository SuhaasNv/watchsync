// One browser-to-browser audio connection: the only place that calls RTCPeerConnection. The
// mesh (mesh.ts) works with this narrow shape, so it can be tested without a browser.
import type { IceServer, VoiceCandidate } from "@watchsync/protocol";
import { freshLevel } from "./speaking";

export interface Peer {
  readonly connection: RTCPeerConnectionState;
  readonly signaling: RTCSignalingState;
  /** Set by the owner: a local ICE candidate was found / the connection changed / audio arrived. */
  onCandidate: (candidate: VoiceCandidate) => void;
  onState: () => void;
  onAudio: (stream: MediaStream) => void;
  /** A new offer (with restartIce: new network paths); returns its SDP. */
  offer(restartIce: boolean): Promise<string>;
  answer(): Promise<string>;
  setRemote(type: "offer" | "answer", sdp: string): Promise<void>;
  addCandidate(candidate: VoiceCandidate): Promise<void>;
  /** Swap the microphone without negotiating again. */
  setMic(track: MediaStreamTrack | null): Promise<void>;
  configure(config: RTCConfiguration): void;
  /** The loudest level heard from them in the last 300 ms (0 to 1); null if nothing fresh. */
  level(now: number): number | null;
  /** Audio energy heard from them so far (test builds read it to tell sound from silence). */
  energy(): Promise<number>;
  close(): void;
}

/** offerer: starts the connection and owns its audio line. Otherwise: takes the offer's line. */
export type PeerFactory = (
  config: RTCConfiguration,
  mic: MediaStreamTrack | null,
  offerer: boolean,
) => Peer;

export const rtcConfig = (
  servers: readonly IceServer[],
  policy: RTCIceTransportPolicy,
): RTCConfiguration => ({ iceServers: servers.map((s) => ({ ...s })), iceTransportPolicy: policy });

export const webRtcPeer: PeerFactory = (config, first, offerer) => {
  const pc = new RTCPeerConnection(config);
  let mic = first;
  // One audio line, both ways. The mic is put on it with replaceTrack, which needs no new
  // negotiation, so everyone can listen before they ever press Talk. The one who offers makes
  // the line; the one who answers takes the line the offer made (a line of its own would not
  // be matched with it, and its mic would go nowhere) and turns it to send as well.
  let audio: RTCRtpTransceiver | null = offerer
    ? pc.addTransceiver("audio", { direction: "sendrecv" })
    : null;
  if (audio && mic) audio.sender.replaceTrack(mic).catch(() => {});
  const peer: Peer = {
    get connection() {
      return pc.connectionState;
    },
    get signaling() {
      return pc.signalingState;
    },
    onCandidate: () => {},
    onState: () => {},
    onAudio: () => {},
    async offer(restartIce) {
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: restartIce }));
      return pc.localDescription?.sdp ?? "";
    },
    async answer() {
      await pc.setLocalDescription(await pc.createAnswer());
      return pc.localDescription?.sdp ?? "";
    },
    async setRemote(type, sdp) {
      await pc.setRemoteDescription({ type, sdp });
      if (audio) return;
      audio = pc.getTransceivers().find((t) => t.receiver.track.kind === "audio") ?? null;
      if (!audio) return;
      audio.direction = "sendrecv";
      if (mic) await audio.sender.replaceTrack(mic);
    },
    addCandidate: (c) => pc.addIceCandidate(c),
    async setMic(track) {
      mic = track;
      await audio?.sender.replaceTrack(track);
    },
    configure: (c) => pc.setConfiguration(c),
    level(now) {
      const heard = pc.getReceivers().flatMap((r) => r.getSynchronizationSources());
      return freshLevel(heard, now);
    },
    async energy() {
      let total = 0;
      for (const report of (await pc.getStats()).values()) {
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          total += typeof report.totalAudioEnergy === "number" ? report.totalAudioEnergy : 0;
        }
      }
      return total;
    },
    close: () => {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.close();
    },
  };
  pc.onicecandidate = (e) => {
    const c = e.candidate;
    if (!c) return;
    peer.onCandidate({
      candidate: c.candidate,
      sdpMid: c.sdpMid,
      sdpMLineIndex: c.sdpMLineIndex,
      usernameFragment: c.usernameFragment,
    });
  };
  pc.onconnectionstatechange = () => peer.onState();
  pc.ontrack = (e) => peer.onAudio(e.streams[0] ?? new MediaStream([e.track]));
  return peer;
};
