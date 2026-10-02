/**
 * The install guide's browser tabs (WAI-ARIA tabs pattern, automatic activation).
 * Brave users land on the Brave tab; the choice is kept in the URL hash (#brave).
 */
export function initTabs() {
  const list = document.querySelector<HTMLElement>("[data-tabs]");
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const panels = [...document.querySelectorAll<HTMLElement>("[data-panel]")];

  const select = (id: string, focus: boolean) => {
    for (const tab of tabs) {
      const on = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== id;
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.tab ?? "chrome";
      select(id, false);
      history.replaceState(null, "", `#${id}`);
    });
    tab.addEventListener("keydown", (e) => {
      const last = tabs.length - 1;
      const next =
        e.key === "ArrowRight"
          ? (i + 1) % tabs.length
          : e.key === "ArrowLeft"
            ? (i - 1 + tabs.length) % tabs.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? last
                : -1;
      const target = tabs[next];
      if (!target) return;
      e.preventDefault();
      select(target.dataset.tab ?? "chrome", true);
    });
  });

  const fromHash = window.location.hash.slice(1);
  const isBrave = typeof Reflect.get(navigator, "brave") === "object";
  if (tabs.some((t) => t.dataset.tab === fromHash)) select(fromHash, false);
  else if (isBrave) select("brave", false);
}
