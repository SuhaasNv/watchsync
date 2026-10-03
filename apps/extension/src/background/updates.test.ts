import { expect, test } from "vitest";
import { updateGate } from "./updates";

test("an update waits while in a room and applies once we leave", () => {
  let reloads = 0;
  const gate = updateGate(() => reloads++);
  gate.available(true);
  expect(reloads).toBe(0); // mid-room: never drop out of the room
  gate.left();
  expect(reloads).toBe(1);
  gate.left(); // leaving again with nothing waiting does nothing
  expect(reloads).toBe(1);
});

test("an update outside a room applies at once", () => {
  let reloads = 0;
  const gate = updateGate(() => reloads++);
  gate.left();
  expect(reloads).toBe(0);
  gate.available(false);
  expect(reloads).toBe(1);
});
