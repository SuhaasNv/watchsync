import { describe, expect, it } from "vitest";
import { initialOf, TONES, toneOf } from "./people";

describe("initialOf", () => {
  it("takes the first letter, upper-cased", () => {
    expect(initialOf("asha")).toBe("A");
    expect(initialOf("  Suhaas ")).toBe("S");
  });

  it("keeps a whole grapheme", () => {
    expect(initialOf("கீதா")).toBe("கீ");
    expect(initialOf("👋🏽 hi")).toBe("👋🏽");
  });

  it("falls back for an empty name", () => {
    expect(initialOf("")).toBe("?");
  });
});

describe("toneOf", () => {
  it("is stable for a name, ignoring case and outer spaces", () => {
    expect(toneOf("Asha")).toBe(toneOf(" asha "));
  });

  it("is one of the palette tones", () => {
    for (const name of ["Asha", "Suhaas", "Ravi", "Meera", "Jo"]) {
      expect(TONES).toContain(toneOf(name));
    }
  });
});
