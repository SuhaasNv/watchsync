// BUG-083: the popup says who is with the room by service and title ID together.
import type { Media, Participant } from "@watchsync/protocol";
import { expect, test } from "vitest";
import type { AppState } from "../shared/messages";
import { titleKey } from "../shared/title";
import { standing, summary } from "./main";

const person = (id: string, service: Participant["service"], titleId: string | null) =>
  ({
    id,
    name: id,
    service,
    titleId,
    titleName: null,
    following: true,
    connected: true,
    hold: null,
    adLeft: null,
  }) satisfies Participant;
const media = (service: Media["service"], titleId: string): Media => ({
  service,
  titleId,
  titleName: null,
  titleUrl: null,
});
const room = (m: Media, participants: Participant[]): AppState => ({
  name: "me",
  session: null,
  connection: "connected",
  participants,
  media: m,
  playback: null,
  following: true,
  clockOffset: 0,
  clockUncertainty: null,
  lastRoom: null,
  mediaMove: null,
  notice: null,
  update: null,
  updating: false,
  unreachable: false,
  unread: 0,
});

test("a title key is its service and its ID", () => {
  expect(titleKey(media("netflix", "81"))).toBe("netflix:81");
  expect(titleKey(media("netflix", "81"))).not.toBe(titleKey(media("jiohotstar", "81")));
  expect(titleKey(person("a", "netflix", null))).toBeNull();
  expect(titleKey(null)).toBeNull();
});

test("the same ID on another service is not the room's title", () => {
  const roomTitle = titleKey(media("netflix", "81"));
  expect(standing(person("a", "jiohotstar", "81"), roomTitle)).toBeNull();
  expect(standing(person("a", "netflix", "81"), roomTitle)).toBe("sync");
});

test("the summary tells a same-ID person on another service from someone in sync", () => {
  const m = media("netflix", "81");
  expect(
    summary(room(m, [person("me", "netflix", "81"), person("a", "netflix", "81")]), "me"),
  ).toBe("Everyone's together.");
  expect(
    summary(room(m, [person("me", "netflix", "81"), person("a", "jiohotstar", "81")]), "me"),
  ).toBe("a is on another title.");
  expect(summary(room(m, [person("me", "jiohotstar", "81")]), "me")).toBe(
    "You're on a different title from the room.",
  );
});
