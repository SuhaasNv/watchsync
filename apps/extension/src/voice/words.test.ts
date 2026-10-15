import { expect, it } from "vitest";
import { NO_VOICE } from "./messages";
import { talkWords } from "./words";

it("says Talk until the mic is allowed, then Mute/Unmute or Hold to talk", () => {
  const on = { ...NO_VOICE, mic: "on" } as const;
  expect(talkWords(NO_VOICE)).toEqual({ text: "Talk", label: "Talk" });
  expect(talkWords({ ...NO_VOICE, mic: "blocked" })).toEqual({ text: "Talk", label: "Talk" });
  expect(talkWords({ ...on, mode: "open", live: true })).toEqual({
    text: "Mute",
    label: "Mute your mic",
  });
  expect(talkWords({ ...on, mode: "open", live: false })).toEqual({
    text: "Unmute",
    label: "Unmute your mic",
  });
  expect(talkWords({ ...on, mode: "ptt", live: false })).toEqual({
    text: "Hold to talk",
    label: "Hold to talk",
  });
  expect(talkWords({ ...on, mode: "ptt", live: true })).toEqual({
    text: "Talking",
    label: "Hold to talk",
  });
});
