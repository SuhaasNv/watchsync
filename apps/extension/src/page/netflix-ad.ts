// Whether Netflix's player is showing an ad right now (UC-048). Netflix stitches ads into the
// same <video>, so the film is not paused and no second video plays: the player's own ad flag
// is the one confident signal. Read from the ad manager of the player session
// (`getAdManager().adPresenting._value`, seen live by a third-party extension, 7 Sep 2026;
// see docs/spikes/player-control.md). It reads one boolean, never the stream.

/** True or false when the player says so; null when this version of the player has no such flag. */
export function adPresenting(player: object | null | undefined): boolean | null {
  try {
    if (!player || !("getAdManager" in player) || typeof player.getAdManager !== "function")
      return null;
    const manager: unknown = player.getAdManager();
    if (typeof manager !== "object" || manager === null || !("adPresenting" in manager))
      return null;
    const flag = manager.adPresenting;
    if (typeof flag !== "object" || flag === null || !("_value" in flag)) return null;
    return typeof flag._value === "boolean" ? flag._value : null;
  } catch {
    return null; // the player's internals changed: unknown, not "no ad"
  }
}
