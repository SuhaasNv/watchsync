/**
 * When to apply an extension update. Chrome clears session storage, where the room ticket
 * lives, when it applies one, so an update mid-room would drop us out of the room. With a
 * listener on runtime.onUpdateAvailable Chrome waits for us: hold the update while in a room
 * (Chrome applies it on the next browser start anyway) and apply it once we're out.
 */
export function updateGate(reload: () => void) {
  let waiting = false;
  return {
    /** Chrome has downloaded an update. */
    available(inRoom: boolean) {
      if (inRoom) waiting = true;
      else reload();
    },
    /** We left the room (or it ended): apply an update that was waiting. */
    left() {
      if (!waiting) return;
      waiting = false;
      reload();
    },
  };
}
