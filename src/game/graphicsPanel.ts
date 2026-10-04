import {
  GRAPHICS_ITEMS,
  PRESET_LABEL,
  withItem,
  withPreset,
  type Graphics,
  type GraphicsKey,
  type GraphicsPreset,
} from "../graphics";

/**
 * 設定 › 画質: the preset (最高 / 高 / 中 / 低, カスタム once an item is changed by hand) and one
 * select per feature, built from GRAPHICS_ITEMS so a new feature only needs its row there. The
 * items that size what is loaded say so and offer a reload.
 */
export function buildGraphicsPanel(root: HTMLElement, graphics: Graphics): void {
  const loaded = { ...graphics.settings };
  const preset = document.createElement("select");
  preset.id = "opt-graphics-preset";
  for (const p of ["ultra", "high", "medium", "low", "custom"] as const) {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = PRESET_LABEL[p];
    // カスタム is where hand-made settings land, not a choice of its own.
    o.disabled = p === "custom";
    preset.append(o);
  }
  root.append(labelled("プリセット", preset, "graphics-preset"));

  const selects = new Map<GraphicsKey, HTMLSelectElement>();
  for (const item of GRAPHICS_ITEMS) {
    const select = document.createElement("select");
    select.dataset.graphics = item.key;
    for (const opt of item.options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      select.append(o);
    }
    select.addEventListener("change", () =>
      graphics.set(withItem(graphics.settings, item.key, select.value)),
    );
    selects.set(item.key, select);
    root.append(labelled(item.onReload ? `${item.label}（再読み込みで反映）` : item.label, select));
  }
  preset.addEventListener("change", () => {
    const isPreset = preset.value !== "custom";
    if (isPreset) graphics.set(withPreset(preset.value as GraphicsPreset));
  });

  const reload = document.createElement("p");
  reload.className = "graphics-reload";
  reload.hidden = true;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "再読み込み";
  button.addEventListener("click", () => location.reload());
  reload.append("描画距離・車と歩行者の数・アンチエイリアスは再読み込みで変わります。 ", button);
  root.after(reload);

  const show = () => {
    const s = graphics.settings;
    preset.value = s.preset;
    for (const [key, select] of selects) select.value = s[key];
    reload.hidden = !GRAPHICS_ITEMS.some((i) => i.onReload && s[i.key] !== loaded[i.key]);
  };
  graphics.onChange(show);
  show();
}

function labelled(text: string, control: HTMLElement, className?: string): HTMLLabelElement {
  const label = document.createElement("label");
  if (className) label.className = className;
  label.append(text, control);
  return label;
}
