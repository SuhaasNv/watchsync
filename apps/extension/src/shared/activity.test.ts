import { expect, test } from "vitest";
import { cantPlayText, serviceText } from "./activity";

test("the can't-play line names who, however many (US-128)", () => {
  expect(cantPlayText(["Asha"])).toBe("Asha can't play this here");
  expect(cantPlayText(["Asha", "Ben"])).toBe("Asha and Ben can't play this here");
  expect(cantPlayText(["Asha", "Ben", "Cy"])).toBe("Asha, Ben and 1 more can't play this here");
  expect(cantPlayText(["Asha", "Ben", "Cy", "Di"])).toBe(
    "Asha, Ben and 2 more can't play this here",
  );
});

test("the different-services line names both services and the rule (US-053)", () => {
  expect(serviceText("Alex", "Prime Video", "Netflix")).toBe(
    "Alex is on Prime Video, you're on Netflix. Sync works only on the same title.",
  );
});
