import { expect, test } from "vitest";
import { cleanName, codeFrom, nameProblem, safeTitleUrl } from "./messages";

test("invites only redirect to supported service pages", () => {
  expect(safeTitleUrl("https://www.netflix.com/watch/80057281")).toBe(
    "https://www.netflix.com/watch/80057281",
  );
  expect(safeTitleUrl("https://www.amazon.in/gp/video/detail/B0X")).not.toBeNull();
  expect(safeTitleUrl("https://www.netflix.com.evil.example/watch/1")).toBeNull();
  expect(safeTitleUrl("https://www.amazon.in/phishing")).toBeNull();
  expect(safeTitleUrl("javascript:alert(1)")).toBeNull();
  expect(safeTitleUrl(null)).toBeNull();
});

test("title links must be the exact title page each provider reports (BUG-039)", () => {
  const good = [
    "https://www.netflix.com/watch/80057281",
    "https://www.primevideo.com/detail/0TQV0X9RJF64O24RIRD1BHH37H",
    "https://www.amazon.in/gp/video/detail/B0ABC12345",
    "https://www.amazon.co.uk/gp/video/detail/amzn1.dv.gti.1234-ab",
    "https://www.jiohotstar.com/in/shows/panchayat/1260123456/watch",
    "https://www.hotstar.com/in/movies/film-name/1260000001/watch",
  ];
  for (const url of good) expect(safeTitleUrl(url)).toBe(url);
  const bad = [
    // Anywhere else on the service site: account pages, sign-out, search.
    "https://www.netflix.com/YourAccount",
    "https://www.netflix.com/signout",
    "https://www.netflix.com/watch/1/../../YourAccount",
    "https://www.netflix.com/watch/1?x=1",
    "https://www.netflix.com/watch/1#x",
    "https://www.netflix.com/watch/abc",
    "https://user:pw@www.netflix.com/watch/1",
    "https://www.netflix.com:8443/watch/1",
    "http://www.netflix.com/watch/1",
    "https://www.amazon.in/gp/video/settings",
    "https://www.amazon.in/gp/video/detail/..",
    "https://www.amazon.in/gp/video/detail/%2e%2e",
    "https://www.amazon.fr/gp/video/detail/B0X",
    "https://www.jiohotstar.com/in/subscribe",
    "https://www.jiohotstar.com/in/%2e%2e/1260123456/watch",
    "https://www.jiohotstar.com/in/../1260123456/watch",
    "https://www.jiohotstar.com/in/shows/x/1260123456/watch/more",
    // The test player only exists in mock builds.
    "http://localhost:4173/watch/demo",
  ];
  for (const url of bad) expect(safeTitleUrl(url), url).toBeNull();
  // A link must belong to the service the room says it is on.
  expect(safeTitleUrl("https://www.netflix.com/watch/1", "prime")).toBeNull();
  expect(safeTitleUrl("https://www.netflix.com/watch/1", "netflix")).not.toBeNull();
});

test("names keep what the room service accepts", () => {
  expect(cleanName("  Asha  ")).toBe("Asha");
  expect(cleanName("   ")).toBe("");
  // Emoji joined by ZWJ, Indic half forms and pasted marks: the service refuses the
  // invisible characters, so they go here instead of failing at Create.
  expect(cleanName("Dev 👩\u200d💻")).toBe("Dev 👩💻");
  expect(cleanName("\u200fشيماء\u202e")).toBe("شيماء");
  expect(cleanName("A\tB\u0007\ufeff")).toBe("AB");
  // 30 characters, never half an emoji.
  expect(cleanName(`${"a".repeat(29)}😀😀`)).toBe(`${"a".repeat(29)}😀`);
  expect(cleanName("x".repeat(40))).toHaveLength(30);
});

test("a pasted invite link or spaced code becomes the code", () => {
  expect(codeFrom("abc234")).toBe("ABC234");
  expect(codeFrom(" ABC 234 ")).toBe("ABC234");
  expect(codeFrom("ABC-234")).toBe("ABC234");
  expect(codeFrom("https://join.watchsync.space/j/xk4m9q")).toBe("XK4M9Q");
  expect(codeFrom("Join me: https://join.watchsync.space/j/XK4M9Q tonight")).toBe("XK4M9Q");
  expect(codeFrom("ABCDEFGH")).toBe("ABCDEF");
  expect(codeFrom("ab")).toBe("AB");
});

test("a name needs a letter, number or emoji; the message says what to do", () => {
  expect(nameProblem("")).toBe("Enter your name.");
  expect(nameProblem("   ")).toBe("Enter your name.");
  expect(nameProblem("\u200b\u200e")).toBe("Enter your name."); // invisible only
  expect(nameProblem("...!!")).toBe("Use at least one letter or number.");
  expect(nameProblem("Asha")).toBeNull();
  expect(nameProblem("शीला")).toBeNull();
  expect(nameProblem("R2")).toBeNull();
  expect(nameProblem("😀")).toBeNull();
  expect(nameProblem("<b>Sam</b>")).toBeNull(); // shown as text, never HTML
});
