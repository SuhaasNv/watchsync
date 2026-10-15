// The mic test (US-134), the "test" mode of the microphone page. A live level meter moves as
// the person speaks; a 3-second recording plays back through the same processing friends would
// hear (the stream is opened exactly as voice opens it). The recording lives in this page's
// memory only: it is never sent anywhere, and it is dropped right after it plays and when the
// page closes. The test never transmits: while it is open the voice document keeps this
// person's mic muted (the "mictest" port tells the worker for as long as the page lives).
import { blockedBy, deviceIdOf, MIC_ID_KEY, openMic } from "./echo";
import { appRoot, backTab, blockedCard, button, el, heading, PROMISE, returnTo } from "./mic-page";
import { START_LEVEL } from "./speaking";

const RECORD_LABEL = "Record a 3-second test";
const RECORD_MS = 3000;
/** No speech for this long after the mic opens: say so. */
const SILENT_MS = 5000;
const LEVEL_EVERY_MS = 50;
const FOOTER =
  "The test recording stays on this computer, is never sent and is deleted after it plays.";

/** The meter's width, 0 to 100, from a linear level: -60 dB is empty, 0 dB is full. */
export const meterPercent = (rms: number): number =>
  rms <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60)) * 100);

export async function micTest() {
  const app = appRoot();
  const back = backTab();

  const select = el("select", { className: "input" });
  select.id = "mic-device";
  const pickLabel = el("label", { className: "label", text: "Microphone" });
  pickLabel.htmlFor = "mic-device";
  const picker = el("div", { className: "field" }, pickLabel, select);
  picker.hidden = true; // only with more than one microphone

  const fill = el("div", { className: "meter-fill" });
  const meter = el("div", { className: "meter" }, fill);
  const levelLabel = el("span", { className: "label", text: "Input level" });
  levelLabel.id = "mic-level-label";
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-labelledby", levelLabel.id);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", "0");

  const status = el("p", { className: "status", text: "Opening your microphone…" });
  status.setAttribute("role", "status");
  const again = button("Try again", "btn primary");
  again.hidden = true;
  const record = button(RECORD_LABEL, "btn primary");
  record.disabled = true;
  const done = button("Done", "btn quiet");
  const title = heading("Test your microphone");

  app.replaceChildren(
    title,
    el("p", { className: "hint", text: PROMISE }),
    picker,
    el("div", { className: "field" }, levelLabel, meter),
    status,
    el("div", { className: "row" }, record, again, done),
    el("p", { className: "hint", text: FOOTER }),
  );
  title.focus();

  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let port: chrome.runtime.Port | null = null;
  let recorder: MediaRecorder | null = null;
  let playing: { audio: HTMLAudioElement; url: string } | null = null;
  let heard = false;
  let busy = false;
  let closed = false;

  const setLevel = (rms: number) => {
    const pct = meterPercent(rms);
    fill.style.transform = `scaleX(${pct / 100})`;
    meter.setAttribute("aria-valuenow", String(pct));
  };

  function stopStream() {
    clearInterval(levelTimer);
    clearTimeout(silenceTimer);
    levelTimer = undefined;
    for (const t of stream?.getTracks() ?? []) t.stop();
    stream = null;
    context?.close().catch((e: unknown) => console.debug("watchsync: mic test", e));
    context = null;
    setLevel(0);
  }

  /** The recording and everything that plays it: gone. */
  function dropRecording() {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorder = null;
    if (playing) {
      playing.audio.pause();
      playing.audio.remove();
      URL.revokeObjectURL(playing.url);
      playing = null;
    }
  }

  function close() {
    closed = true;
    dropRecording();
    stopStream();
    port?.disconnect();
    port = null;
    navigator.mediaDevices.removeEventListener("devicechange", onDevices);
  }

  function onDevices() {
    listDevices().catch((e: unknown) => console.debug("watchsync: mic test", e));
  }

  async function listDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    // Chrome lists the system's default twice (as "default" and as the device itself).
    const mics = all.filter(
      (d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications",
    );
    const saved = deviceIdOf((await chrome.storage.local.get(MIC_ID_KEY))[MIC_ID_KEY]);
    select.replaceChildren(new Option("System default", ""));
    for (const [i, d] of mics.entries())
      select.append(new Option(d.label || `Microphone ${i + 1}`, d.deviceId));
    select.value = mics.some((d) => d.deviceId === saved) ? (saved ?? "") : "";
    picker.hidden = mics.length < 2;
  }

  async function start() {
    stopStream();
    heard = false;
    again.hidden = true;
    record.disabled = true;
    status.className = "status";
    status.textContent = "Opening your microphone…";
    const id =
      deviceIdOf(select.value) ??
      deviceIdOf((await chrome.storage.local.get(MIC_ID_KEY))[MIC_ID_KEY]);
    try {
      ({ stream } = await openMic(id));
    } catch (e) {
      const by = blockedBy(e);
      if (by === null) {
        status.textContent = "Chrome didn't get an answer.";
        again.hidden = false;
        again.focus();
      } else {
        status.textContent = "";
        app.append(blockedCard(by));
      }
      return;
    }
    if (closed) return stopStream();
    // From here on the test is open: the worker keeps this person muted until the page goes.
    port ??= chrome.runtime.connect({ name: "mictest" });
    const source = stream;
    context = new AudioContext();
    context.resume().catch((e: unknown) => console.debug("watchsync: mic test", e));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(source).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    status.textContent = "Say something.";
    record.disabled = busy;
    levelTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      setLevel(rms);
      if (rms >= START_LEVEL && !heard) {
        heard = true;
        status.className = "status done";
        status.textContent = "We can hear you.";
      }
    }, LEVEL_EVERY_MS);
    silenceTimer = setTimeout(() => {
      if (heard) return;
      status.className = "status";
      status.textContent = "We can't hear anything: check your mic.";
    }, SILENT_MS);
    await listDevices();
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function recordAndPlay() {
    if (!stream || busy) return;
    busy = true;
    record.disabled = true;
    const rec = new MediaRecorder(stream);
    recorder = rec;
    const chunks: Blob[] = [];
    rec.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    const stopped = new Promise<void>((resolve) => rec.addEventListener("stop", () => resolve()));
    rec.start();
    for (let s = RECORD_MS / 1000; s > 0 && !closed; s--) {
      record.textContent = `Recording… ${s} s`;
      await sleep(1000);
    }
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    recorder = null;
    const clip = new Blob(chunks, { type: rec.mimeType });
    chunks.length = 0;
    if (closed) return;
    const url = URL.createObjectURL(clip);
    const audio = el("audio");
    audio.hidden = true;
    audio.src = url;
    document.body.append(audio);
    playing = { audio, url };
    record.textContent = "Playing back…";
    const finish = () => {
      dropRecording();
      busy = false;
      record.textContent = RECORD_LABEL;
      record.disabled = stream === null;
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    audio.play().catch((e: unknown) => {
      console.debug("watchsync: mic test", e);
      finish();
    });
  }

  select.addEventListener("change", () => {
    const id = deviceIdOf(select.value);
    const saved = id
      ? chrome.storage.local.set({ [MIC_ID_KEY]: id })
      : chrome.storage.local.remove(MIC_ID_KEY);
    saved.then(start).catch((e: unknown) => console.debug("watchsync: mic test", e));
  });
  navigator.mediaDevices.addEventListener("devicechange", onDevices);
  record.addEventListener("click", () => {
    recordAndPlay().catch((e: unknown) => console.debug("watchsync: mic test", e));
  });
  again.addEventListener("click", () => {
    start().catch((e: unknown) => console.debug("watchsync: mic test", e));
  });
  done.addEventListener("click", () => {
    close();
    returnTo(back)
      .then(async (went) => {
        if (went) return;
        const me = await chrome.tabs.getCurrent();
        if (me?.id !== undefined) await chrome.tabs.remove(me.id);
      })
      .catch((e: unknown) => console.debug("watchsync: mic test", e));
  });
  window.addEventListener("pagehide", close);

  await start();
}
