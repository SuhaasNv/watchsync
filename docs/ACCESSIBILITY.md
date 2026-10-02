# Accessibility: WCAG 2.2 AA (DEC-022)

Target: WCAG 2.2 level AA for every WatchSync surface from v0.1.0.

## Automated gate

`apps/extension/e2e/a11y.spec.ts` runs axe-core with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`. Any violation fails `pnpm check` and CI. It covers:

| Surface | States audited |
|---|---|
| Popup | name entry, home, join error, room alone, room with people, a friend on another title |
| Invite page `/j/{code}` | without the extension (install steps), with it (Join form) |
| On-page overlay | "Open it?" prompt, playback notice, presence pill, wait card (early and late), start-together countdown |

The audit runs with reduced motion so it measures each screen settled, not mid-fade. It also tests the popup end to end by keyboard: name, Enter, Create a room, Enter, Copy link, Tab, Copy code.

## Manual review, 2 October 2026 (popup, invite page, overlay)

| Criterion | Result | How |
|---|---|---|
| 1.4.1 Use of colour | Pass | "In sync", "Loading" and "On an ad" are chips with an icon and a word; in the pill a tick or dots mark each face, and every face has a spoken label. Each person's avatar colour comes from their name and never carries meaning on its own. |
| 1.4.3 Contrast | Pass | Text tokens on `#0c1215` are 5.5:1 or higher; the yellow primary button text is above 10:1. The overlay draws its own dark background, so service pages can't lower its contrast. |
| 1.4.10 Reflow | Pass | Invite page uses `min(480px, 100% - 32px)` and reads at 375 px; the popup is a fixed 360 px extension window. |
| 2.1.1 Keyboard | Pass | Native buttons, inputs and forms only; keyboard e2e test. |
| 2.4.3 Focus order | Pass | Each popup screen moves focus to its main control when it appears. |
| 2.4.7 Focus visible | Pass | 2 px yellow `:focus-visible` outline in the popup, invite page and overlay. |
| 2.4.11 Focus not obscured | Pass | The overlay sits bottom-right and holds at most three notices and one prompt; passing notices let clicks through to the player; nothing in the popup is sticky. Prompts never take focus. |
| 2.5.8 Target size | Pass | Popup controls are 44 px tall; overlay and pill buttons are 32–36 px. "Change name" is an inline link inside a sentence, which the inline exception covers. |
| 3.3.1 / 3.3.3 Errors | Pass | Errors appear as text with `role="alert"` and say what to do. |
| 4.1.3 Status messages | Pass | Overlay notices sit in a `role="status"` polite live region; prompts sit in a polite live region as groups named by their question. The popup's connection badge and "Link copied" are `role="status"`. |
| 2.3.3 / reduced motion | Pass | `prefers-reduced-motion` turns off screen transitions, the loading shimmer, the reconnecting pulse, the overlay entrance and exit, and button press motion. |

## Open

- The sidebar (v0.2) joins the axe gate when it ships.
- A screen-reader pass with VoiceOver on real Netflix, Prime Video and JioHotstar pages, during the v0.1 acceptance test.
