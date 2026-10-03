import { expect, test } from "vitest";
import { badgeText } from "./badge";

test("the badge shows the unread count, 9+ past nine, and clears at 0", () => {
  expect(badgeText(0, "prod")).toBe("");
  expect(badgeText(1, "prod")).toBe("1");
  expect(badgeText(9, "prod")).toBe("9");
  expect(badgeText(10, "prod")).toBe("9+");
});

test("dev builds show DEV only while nothing is unread", () => {
  expect(badgeText(0, "dev")).toBe("DEV");
  expect(badgeText(3, "dev")).toBe("3");
  expect(badgeText(12, "dev")).toBe("9+");
});
