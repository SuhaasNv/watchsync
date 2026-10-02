# Accessibility — WCAG 2.2 AA (DEC-022)

Target: WCAG 2.2 level AA for every WatchSync surface from v0.1.0.

## Automated gate

`apps/extension/e2e/a11y.spec.ts` runs axe-core with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`. Any violation fails `pnpm check` and CI. It covers:

| Surface | States audited |
|---|---|
| Popup | name entry, home, join error, room |
| Invite page `/j/{code}` | without the extension (install steps), with it (Join form) |
| On-page overlay | "Open it?" prompt, playback notice |

It also tests the popup end to end by keyboard: name, Enter, Create a room, Enter, Copy link, Tab, Copy code.

## Manual review, 2 October 2026 (popup, invite page, overlay)

| Criterion | Result | How |
|---|---|---|
| 1.4.3 Contrast | Pass | Text tokens on `#0c1215` are 5.5:1 or higher; the yellow primary button text is above 10:1. The overlay draws its own dark background, so service pages can't lower its contrast. |
| 1.4.10 Reflow | Pass | Invite page uses `min(440px, 100% - 32px)`; the popup is a fixed 360 px extension window. |
| 2.1.1 Keyboard | Pass | Native buttons, inputs and forms only; keyboard e2e test. |
| 2.4.3 Focus order | Pass | Each popup screen moves focus to its main control when it appears. |
| 2.4.7 Focus visible | Pass | 2 px yellow `:focus-visible` outline in the popup, invite page and overlay. |
| 2.4.11 Focus not obscured | Pass | The overlay sits bottom-right and holds only notices and prompts; nothing in the popup is sticky. |
| 2.5.8 Target size | Pass | Controls are 34–44 px tall. "Change name" is an inline link inside a sentence, which the inline exception covers. |
| 3.3.1 / 3.3.3 Errors | Pass | Errors appear as text with `role="alert"` and say what to do. |
| 4.1.3 Status messages | Pass | Overlay notices sit in a `role="status"` polite live region. |
| 2.3.3 / reduced motion | Pass | `prefers-reduced-motion` turns off the overlay entrance and button press motion. |

## Open

- The presence pill (UC-008) and the sidebar (v0.2) join the axe gate when they ship.
- A screen-reader pass with VoiceOver on real Netflix, Prime Video and JioHotstar pages, during the v0.1 acceptance test.
