import {
  GRAPHICS_ITEMS,
  PRESET_LABEL,
  withItem,
  withPreset,
  type Graphics,
  type GraphicsKey,
  type GraphicsPreset,
} from "../graphics";
import { bindText, setI18nText, t, type MessageKey } from "../i18n";

/**
 * 設定 › 画質: the preset (最高 / 高 / 中 / 低, カスタム once an item is changed by hand) and one
 * select per feature, built from GRAPHICS_ITEMS so a new feature only needs its row there. The
 * items that size what is loaded say so and offer a reload. Every text is an i18n key, kept in the
 * language in force. `running` names the backend the renderer is on now (描画方式 自動 may have
 * fallen back to WebGL 2).
 */
export function buildGraphicsPanel(root: HTMLElement, graphics: Graphics, running?: MessageKey): void {
  const loaded = { ...graphics.settings };
  const preset = document.createElement("select");
  preset.id = "opt-graphics-preset";
  for (const p of ["ultra", "high", "medium", "low", "custom"] as const) {
    const o = document.createElement("option");
    o.value = p;
    setI18nText(o, PRESET_LABEL[p]);
    // カスタム is where hand-made settings land, not a choice of its own.
    o.disabled = p === "custom";
    preset.append(o);
  }
  root.append(labelled(() => t("graphics.preset"), preset, "graphics-preset"));

  const selects = new Map<GraphicsKey, HTMLSelectElement>();
  for (const item of GRAPHICS_ITEMS) {
    const select = document.createElement("select");
    select.dataset.graphics = item.key;
    for (const opt of item.options) {
      const o = document.createElement("option");
      o.value = opt.value;
      setI18nText(o, opt.label);
      select.append(o);
    }
    select.addEventListener("change", () =>
      graphics.set(withItem(graphics.settings, item.key, select.value)),
    );
    selects.set(item.key, select);
    const text = () => (item.onReload ? t("graphics.reloadSuffix", { label: t(item.label) }) : t(item.label));
    root.append(labelled(text, select));
  }
  preset.addEventListener("change", () => {
    const isPreset = preset.value !== "custom";
    if (isPreset) graphics.set(withPreset(preset.value as GraphicsPreset, graphics.settings));
  });

  const reload = document.createElement("p");
  reload.className = "graphics-reload";
  reload.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  setI18nText(button, "graphics.reload");
  button.addEventListener("click", () => location.reload());
  const note = document.createElement("span");
  setI18nText(note, "graphics.reloadNote");
  reload.append(note, " ", button);
  const backend = document.createElement("p");
  backend.className = "graphics-backend";
  if (running) bindText(backend, () => t("graphics.running", { backend: t(running) }));
  backend.hidden = running === undefined;
  root.after(backend, reload);

  const show = () => {
    const s = graphics.settings;
    preset.value = s.preset;
    for (const [key, select] of selects) select.value = s[key];
    reload.hidden = !GRAPHICS_ITEMS.some((i) => i.onReload && s[i.key] !== loaded[i.key]);
  };
  graphics.onChange(show);
  show();
}

/** A label whose text (a span, so a language switch can redo it) sits above its control. */
function labelled(text: () => string, control: HTMLElement, className?: string): HTMLLabelElement {
  const label = document.createElement("label");
  if (className) label.className = className;
  const span = document.createElement("span");
  bindText(span, text);
  label.append(span, control);
  return label;
}
