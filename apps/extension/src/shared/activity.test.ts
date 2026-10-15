import { expect, test } from "vitest";
import { serviceText } from "./activity";

test("the different-services line names both services and the rule (US-053)", () => {
  expect(serviceText("Alex", "Prime Video", "Netflix")).toBe(
    "Alex is on Prime Video, you're on Netflix. Sync works only on the same title.",
  );
});
