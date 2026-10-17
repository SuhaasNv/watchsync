// Friend controls (US-135): mute a friend, or turn them down, for me alone. Nothing here is sent
// to the friend or to the room: it only changes what the voice document plays to me, and the
// microphone of the friend stays as it was. The setting is kept per room and per name (not per
// member id: a rejoin after a browser restart is a new member), in chrome.storage.local.

/** Where the settings live: { [room code]: { seen, people: { [name, lower case]: setting } } }. */
export const FRIENDS_KEY = "voiceFriends";
/** A room not seen for this long is forgotten. */
export const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** `seen` is refreshed no more than once a day. */
const TOUCH_MS = 24 * 60 * 60 * 1000;
/** A room has at most this many people on file (voice is for four; names are many over time). */
const MAX_PEOPLE = 32;
const MAX_ROOMS = 64;

export interface FriendSetting {
  /** Muted for me. */
  muted: boolean;
  /** 0 to 100, percent of their voice. 0 counts as muted. */
  volume: number;
}

interface RoomFriends {
  /** The last time this room was in use (ms). */
  seen: number;
  people: Record<string, FriendSetting>;
}

export type FriendStore = Record<string, RoomFriends>;

export const FULL: FriendSetting = { muted: false, volume: 100 };

/** One name, one setting: case and surrounding spaces do not matter. */
export const friendKey = (name: string): string => name.trim().toLowerCase();

/** Heard at all? Muted, or turned all the way down. */
export const silenced = (s: FriendSetting): boolean => s.muted || s.volume === 0;

/** What the <audio> element that plays a friend is set to: muted and 0 to 1 (never the track). */
export const playback = (s: FriendSetting): { muted: boolean; volume: number } => ({
  muted: silenced(s),
  volume: s.volume / 100,
});

const isObject = (v: unknown): v is object =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const field = (v: object, k: string): unknown => Reflect.get(v, k);

function isSetting(v: unknown): v is FriendSetting {
  if (!isObject(v)) return false;
  const volume = field(v, "volume");
  return (
    typeof field(v, "muted") === "boolean" &&
    typeof volume === "number" &&
    Number.isInteger(volume) &&
    volume >= 0 &&
    volume <= 100
  );
}

/** The people of one room, as the voice document is sent them; false if anything is off. */
export function isPeople(v: unknown): v is Record<string, FriendSetting> {
  if (!isObject(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= MAX_PEOPLE && entries.every(([k, s]) => k.length <= 64 && isSetting(s));
}

/** What storage held, keeping only what is well formed. */
export function readFriends(raw: unknown): FriendStore {
  const store: FriendStore = {};
  if (!isObject(raw)) return store;
  for (const [code, room] of Object.entries(raw).slice(0, MAX_ROOMS)) {
    if (!isObject(room)) continue;
    const seen = field(room, "seen");
    const people = field(room, "people");
    if (typeof seen !== "number" || !Number.isFinite(seen) || !isObject(people)) continue;
    const kept: Record<string, FriendSetting> = {};
    for (const [name, s] of Object.entries(people).slice(0, MAX_PEOPLE)) {
      if (name.length <= 64 && isSetting(s)) kept[name] = { muted: s.muted, volume: s.volume };
    }
    store[code] = { seen, people: kept };
  }
  return store;
}

/** The setting for a friend in a room (full volume if none is on file). */
export function settingOf(store: FriendStore, code: string, name: string): FriendSetting {
  return store[code]?.people[friendKey(name)] ?? FULL;
}

/** The people of one room, keyed by lower case name. */
export const roomFriends = (store: FriendStore, code: string): Record<string, FriendSetting> =>
  store[code]?.people ?? {};

const clamp = (v: number): number => Math.min(100, Math.max(0, Math.round(v)));

/** Changes one friend's setting; a friend back at the default is not kept on file. */
export function changeFriend(
  store: FriendStore,
  code: string,
  name: string,
  patch: Partial<FriendSetting>,
  now: number,
): FriendStore {
  const key = friendKey(name);
  if (!key) return store;
  const was = settingOf(store, code, name);
  const next: FriendSetting = {
    muted: patch.muted ?? was.muted,
    volume: patch.volume === undefined ? was.volume : clamp(patch.volume),
  };
  const people = { ...store[code]?.people };
  if (next.muted === FULL.muted && next.volume === FULL.volume) delete people[key];
  else people[key] = next;
  const { [code]: _old, ...rest } = store;
  return Object.keys(people).length === 0 ? rest : { ...rest, [code]: { seen: now, people } };
}

/**
 * What the Mute for me / Unmute for me button does. Unmuting someone turned all the way down
 * brings them back to full, so the button always makes them audible.
 */
export const muteToggle = (s: FriendSetting): Partial<FriendSetting> =>
  silenced(s) ? { muted: false, volume: s.volume === 0 ? 100 : s.volume } : { muted: true };

/** Moving the slider to anything above 0 un-mutes: a raised volume must be heard. */
export const volumePatch = (volume: number): Partial<FriendSetting> => ({
  volume,
  muted: false,
});

/**
 * Forgets rooms not seen for 30 days, and notes that `code` (the room in use) was seen today.
 * Gives back the same object when nothing changed.
 */
export function tidy(store: FriendStore, code: string | undefined, now: number): FriendStore {
  let out = store;
  for (const [c, room] of Object.entries(store)) {
    if (now - room.seen > KEEP_MS) {
      const { [c]: _gone, ...rest } = out;
      out = rest;
    }
  }
  const room = code === undefined ? undefined : out[code];
  if (code !== undefined && room && now - room.seen > TOUCH_MS) {
    out = { ...out, [code]: { ...room, seen: now } };
  }
  return out;
}

/**
 * Whether anyone I can hear is speaking (never me, never a friend I muted or turned to 0):
 * that is what the film dips for. A friend turned down but not to 0 still counts.
 */
export function friendHeard(
  speaking: Iterable<string>,
  you: string,
  settingOfId: (id: string) => FriendSetting,
): boolean {
  for (const id of speaking) if (id !== you && !silenced(settingOfId(id))) return true;
  return false;
}

/**
 * The settings as a page (the room pill, the popup) sees them: read once, kept up to date when
 * storage changes, and changed through `change`, which shows at once and then saves. `stop`
 * takes the listener away.
 */
export function trackFriends(onChange: () => void) {
  let store: FriendStore = {};
  const take = (raw: unknown) => {
    store = readFriends(raw);
    onChange();
  };
  chrome.storage.local
    .get(FRIENDS_KEY)
    .then((got) => take(got[FRIENDS_KEY]))
    .catch((e: unknown) => console.debug("watchsync: friend settings", e));
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[FRIENDS_KEY];
    if (area === "local" && change) take(change.newValue);
  };
  chrome.storage.onChanged.addListener(listener);
  return {
    get: () => store,
    change(code: string, name: string, patch: Partial<FriendSetting>) {
      store = changeFriend(store, code, name, patch, Date.now());
      onChange();
      chrome.storage.local
        .set({ [FRIENDS_KEY]: store })
        .catch((e: unknown) => console.debug("watchsync: friend settings", e));
    },
    stop: () => chrome.storage.onChanged.removeListener(listener),
  };
}
