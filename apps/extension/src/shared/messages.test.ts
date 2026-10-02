import { expect, test } from "vitest";
import { safeTitleUrl } from "./messages";

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
