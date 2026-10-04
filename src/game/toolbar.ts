import { keyFor, type Action, type KeyLayout } from "./input";

/**
 * The buttons at the bottom right: one per action, each with its key in the current layout
 * ("目的地 N"), so the keys can be learnt from the screen. The first group always shows; the rest
 * (the car's switches, the phone, the view) only where the screen is wide enough for them.
 */
type Item = { action: Action; label: string; title?: string; wide?: boolean };

const ITEMS: Item[] = [
  { action: "mission", label: "目的地", title: "新しい目的地" },
  { action: "autopilot", label: "自動運転" },
  { action: "home", label: "帰宅", title: "家に帰って今日の運転を終える" },
  { action: "warp", label: "移動", title: "好きな場所へ移動" },
  { action: "replay", label: "リプレイ" },
  { action: "weather", label: "天気" },
  { action: "ground", label: "地面", title: "地面: 地理院写真 / PLATEAU オルソ" },
  { action: "camera", label: "視点" },
  { action: "mute", label: "音" },
  { action: "help", label: "操作" },
  { action: "credits", label: "出典" },
  { action: "title", label: "タイトル", title: "タイトル画面に戻る" },
  { action: "door", label: "乗降", wide: true },
  { action: "talk", label: "話す・始動", title: "話しかける・エンジン始動", wide: true },
  { action: "phone", label: "スマホ", wide: true },
  { action: "phoneZoom", label: "スマホ拡大", wide: true },
  { action: "indicatorLeft", label: "◀ 合図", wide: true },
  { action: "indicatorRight", label: "合図 ▶", wide: true },
  { action: "hazard", label: "ハザード", wide: true },
  { action: "lights", label: "ライト", wide: true },
  { action: "highBeam", label: "ハイビーム", wide: true },
  { action: "wipers", label: "ワイパー", wide: true },
  { action: "belt", label: "ベルト", wide: true },
  { action: "nav", label: "ナビ", wide: true },
  { action: "minimap", label: "地図", wide: true },
  { action: "time", label: "時間帯", wide: true },
  { action: "pause", label: "一時停止", wide: true },
  { action: "reset", label: "復帰", wide: true },
  { action: "screenshot", label: "撮影", wide: true },
];

/** Fill the toolbar with its buttons (call once, before the [data-action] buttons are wired). */
export function buildToolbar(root: HTMLElement): void {
  root.replaceChildren(
    ...ITEMS.map((item) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.action = item.action;
      if (item.wide) b.classList.add("wide-only");
      const label = document.createElement("span");
      label.textContent = item.label;
      const key = document.createElement("kbd");
      b.append(label, key);
      return b;
    }),
  );
}

/** Show each button's key (and a tooltip) for a layout. */
export function labelToolbar(root: HTMLElement, layout: KeyLayout): void {
  for (const item of ITEMS) {
    const b = root.querySelector<HTMLButtonElement>(`[data-action="${item.action}"]`);
    if (!b) continue;
    const key = keyFor(layout, item.action);
    const kbd = b.querySelector("kbd");
    // Shift as its keycap symbol, so every badge fits the same button.
    if (kbd) kbd.textContent = key.replace("Shift+", "⇧");
    b.title = key ? `${item.title ?? item.label} (${key})` : (item.title ?? item.label);
  }
}
