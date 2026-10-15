import { describe, expect, it } from "vitest";
import { blockedBy, cancelsAllEcho, micMode } from "./echo";

const track = (capabilities: (boolean | string)[] | undefined, setting: boolean | string) => ({
  getCapabilities: (): MediaTrackCapabilities => ({ echoCancellation: capabilities }),
  getSettings: (): MediaTrackSettings => ({ echoCancellation: setting }),
});

describe("cancelsAllEcho (DEC-037)", () => {
  it("is true only when Chrome offers 'all' and the mic it gave is using it", () => {
    expect(cancelsAllEcho(track([true, false, "remote-only", "all"], "all"))).toBe(true);
    // Offered but not what the mic got: not doing it.
    expect(cancelsAllEcho(track([true, false, "all"], true))).toBe(false);
    // An older Chrome: only true and false.
    expect(cancelsAllEcho(track([true, false], true))).toBe(false);
    expect(cancelsAllEcho(track(undefined, true))).toBe(false);
  });
});

describe("micMode", () => {
  it("is the person's choice, else what was found, else push-to-talk", () => {
    expect(micMode("open", "ptt")).toBe("open");
    expect(micMode("ptt", "open")).toBe("ptt");
    expect(micMode(undefined, "open")).toBe("open");
    expect(micMode(undefined, "ptt")).toBe("ptt");
    expect(micMode(undefined, undefined)).toBe("ptt");
    expect(micMode("loud", "banana")).toBe("ptt");
  });
});

describe("blockedBy", () => {
  const fail = (name: string, message = "") => new DOMException(message, name);

  it("tells Chrome's no from the system's no, and a closed question from both", () => {
    expect(blockedBy(fail("NotAllowedError", "Permission denied"))).toBe("chrome");
    expect(blockedBy(fail("NotAllowedError", "Permission denied by system"))).toBe("system");
    expect(blockedBy(fail("NotAllowedError", "Permission dismissed"))).toBeNull();
    expect(blockedBy(fail("NotFoundError", "Requested device not found"))).toBe("none");
    expect(blockedBy(fail("NotReadableError", "Could not start audio source"))).toBe("system");
    expect(blockedBy(fail("SecurityError"))).toBe("chrome");
    expect(blockedBy(new Error("boom"))).toBe("chrome");
  });
});
