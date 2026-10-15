import { expect, it } from "vitest";
import { meterPercent } from "./mic-test";

it("the meter is empty at -60 dB, half at -30 dB and full at 0 dB", () => {
  expect(meterPercent(0)).toBe(0);
  expect(meterPercent(0.0005)).toBe(0); // quieter than -60 dB
  expect(meterPercent(0.0316)).toBe(50);
  expect(meterPercent(0.1)).toBe(67);
  expect(meterPercent(1)).toBe(100);
  expect(meterPercent(2)).toBe(100); // never past full
});
