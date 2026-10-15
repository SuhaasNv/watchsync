import { describe, expect, it } from "vitest";
import { detectOs, micHelp, micSettingsUrl } from "./help";

describe("detectOs", () => {
  it("reads the platform string", () => {
    expect(detectOs("MacIntel")).toBe("mac");
    expect(detectOs("macOS")).toBe("mac");
    expect(detectOs("Win32")).toBe("windows");
    expect(detectOs("Windows")).toBe("windows");
    expect(detectOs("Linux x86_64")).toBe("other");
    expect(detectOs("")).toBe("other");
  });
});

describe("micSettingsUrl", () => {
  it("opens Chrome's page for WatchSync's own address", () => {
    expect(micSettingsUrl("chrome-extension://abcdef")).toBe(
      "chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2Fabcdef",
    );
  });
});

describe("micHelp", () => {
  const step = (os: "mac" | "windows" | "other", by: "chrome" | "system") => micHelp(os, by).steps;

  it("a block by Chrome: its settings first, then the system's step for this system, then back", () => {
    const mac = step("mac", "chrome");
    expect(mac).toHaveLength(4);
    expect(mac[0]).toMatch(/Chrome's settings for WatchSync/);
    expect(mac[1]).toBe("Set Microphone to Allow.");
    expect(mac[2]).toMatch(/System Settings › Privacy & Security › Microphone/);
    expect(mac[3]).toBe("Come back and press Talk.");
    const win = step("windows", "chrome");
    expect(win[2]).toMatch(/Settings › Privacy & security › Microphone/);
    expect(win[2]).toMatch(/Let desktop apps access your microphone/);
  });

  it("shows only the step for the system the person is on", () => {
    expect(step("mac", "chrome").join("\n")).not.toMatch(/Windows|desktop apps/);
    expect(step("windows", "chrome").join("\n")).not.toMatch(/Mac|System Settings/);
    const other = step("other", "chrome");
    expect(other).toHaveLength(3);
    expect(other.join("\n")).not.toMatch(/Mac|Windows/);
  });

  it("a block by the system puts its step first", () => {
    expect(step("mac", "system")[0]).toMatch(/System Settings/);
    expect(step("windows", "system")[0]).toMatch(/Settings › Privacy & security/);
    // Nothing to say about the system on another one: the Chrome steps stand.
    expect(step("other", "system")[0]).toMatch(/Chrome's settings/);
  });

  it("says what it is, what keeps working, and where the button goes", () => {
    const help = micHelp("mac", "chrome");
    expect(help.title).toBe("Turn your mic back on");
    expect(help.button).toBe("Open mic settings");
    expect(help.footer).toBe("Sync and chat keep working without a mic.");
  });

  it("no microphone at all: settings can't fix it, so there is no settings button", () => {
    const help = micHelp("mac", "none");
    expect(help.button).toBeNull();
    expect(help.steps.join("\n")).not.toMatch(/Chrome's settings/);
  });
});
