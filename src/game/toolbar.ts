import { onLocaleChange, setI18nText, t, type MessageKey } from "../i18n";
import { keyFor, type Action, type KeyLayout } from "./input";

/**
 * The buttons at the bottom right: one per action, each with its key in the current layout
 * ("目的地 N"), so the keys can be learnt from the screen. The first group always shows; the rest
 * (the car's switches, the phone, the view) only where the screen is wide enough for them.
 * Labels and tooltips are i18n keys (toolbar.* / toolbarTitle.*), kept short for the 120 px button.
 */
type Item = { action: Action; label: MessageKey; title?: MessageKey; wide?: boolean };

const ITEMS: Item[] = [
  { action: "mission", label: "toolbar.mission", title: "toolbarTitle.mission" },
  { action: "autopilot", label: "toolbar.autopilot" },
  { action: "home", label: "toolbar.home", title: "toolbarTitle.home" },
  { action: "warp", label: "toolbar.warp", title: "toolbarTitle.warp" },
  { action: "taxi", label: "toolbar.taxi", title: "toolbarTitle.taxi" },
  { action: "replay", label: "toolbar.replay" },
  { action: "weather", label: "toolbar.weather" },
  { action: "ground", label: "toolbar.ground", title: "toolbarTitle.ground" },
  { action: "camera", label: "toolbar.camera" },
  { action: "mute", label: "toolbar.mute" },
  { action: "help", label: "toolbar.help" },
  { action: "settings", label: "toolbar.settings", title: "toolbarTitle.settings" },
  { action: "credits", label: "toolbar.credits" },
  { action: "title", label: "toolbar.title", title: "toolbarTitle.title" },
  { action: "door", label: "toolbar.door", wide: true },
  { action: "talk", label: "toolbar.talk", title: "toolbarTitle.talk", wide: true },
  { action: "phone", label: "toolbar.phone", wide: true },
  { action: "phoneZoom", label: "toolbar.phoneZoom", wide: true },
  { action: "indicatorLeft", label: "toolbar.indicatorLeft", wide: true },
  { action: "indicatorRight", label: "toolbar.indicatorRight", wide: true },
  { action: "hazard", label: "toolbar.hazard", wide: true },
  { action: "lights", label: "toolbar.lights", wide: true },
  { action: "highBeam", label: "toolbar.highBeam", wide: true },
  { action: "wipers", label: "toolbar.wipers", wide: true },
  { action: "belt", label: "toolbar.belt", wide: true },
  { action: "nav", label: "toolbar.nav", wide: true },
  {
    action: "tv",
    label: "toolbar.tv",
    title: "toolbarTitle.tv",
    wide: true,
  },
  { action: "tvChannel", label: "toolbar.tvChannel", title: "toolbarTitle.tvChannel", wide: true },
  { action: "minimap", label: "toolbar.minimap", wide: true },
  { action: "time", label: "toolbar.time", wide: true },
  { action: "pause", label: "toolbar.pause", wide: true },
  { action: "reset", label: "toolbar.reset", wide: true },
  { action: "screenshot", label: "toolbar.screenshot", wide: true },
];

/**
 * Fill the toolbar with its buttons (call once, before the [data-action] buttons are wired). The
 * labels follow a language switch through data-i18n; the tooltips, which carry the key, are redone
 * here for the layout last shown.
 */
export function buildToolbar(root: HTMLElement): void {
  onLocaleChange(() => {
    const layout = root.dataset.layout;
    const isLayout = layout === "wasd" || layout === "ccd";
    if (isLayout) labelToolbar(root, layout);
  });
  root.replaceChildren(
    ...ITEMS.map((item) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.action = item.action;
      if (item.wide) b.classList.add("wide-only");
      const label = document.createElement("span");
      setI18nText(label, item.label);
      const key = document.createElement("kbd");
      b.append(label, key);
      return b;
    }),
  );
}

/** Show each button's key (and a tooltip) for a layout. */
export function labelToolbar(root: HTMLElement, layout: KeyLayout): void {
  root.dataset.layout = layout;
  for (const item of ITEMS) {
    const b = root.querySelector<HTMLButtonElement>(`[data-action="${item.action}"]`);
    if (!b) continue;
    const key = keyFor(layout, item.action);
    const kbd = b.querySelector("kbd");
    // Shift as its keycap symbol, so every badge fits the same button.
    if (kbd) kbd.textContent = key.replace("Shift+", "⇧");
    const tip = t(item.title ?? item.label);
    b.title = key ? `${tip} (${key})` : tip;
  }
}
