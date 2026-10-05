import type { MessageKey } from "./i18n";

/**
 * 画質: each graphics feature on its own setting, and the 最高 / 高 / 中 / 低 presets that set them
 * all. Remembered in this browser; phones start on 低, computers on 高. Most settings take effect
 * at once (the renderer, the shaders and the passes read them every frame or on change); the
 * ones that size what is loaded (view distance, traffic, anti-aliasing) and the 描画方式 (the
 * renderer's backend) on the next load.
 */
export type GraphicsPreset = "ultra" | "high" | "medium" | "low";

export type GraphicsSettings = {
  preset: GraphicsPreset | "custom";
  /** Pixel ratio cap (×devicePixelRatio, never above it). */
  resolution: "0.75" | "1" | "1.5" | "2";
  /** The sun's shadow map size, "off" for none. */
  shadows: "off" | "1024" | "2048" | "4096";
  motionBlur: "off" | "light" | "strong";
  /** Glow around bright lights (lamps, lit windows, signals, the low sun). */
  bloom: "off" | "low" | "high";
  /** The sun's ghosts, halo and starburst when it is seen (and the lamps' ghosts at night). */
  lensFlare: "off" | "on";
  /** The sky in reflections (car paint, glass, wet roads): off = a fixed studio light. */
  reflections: "off" | "low" | "high";
  /** Night windows: one flat colour, lit with variety, or rooms behind them (interior mapping). */
  windows: "flat" | "lit" | "rooms";
  /** Wet roads in rain: off, darker and glossy, or with puddles and ripples. */
  wetRoads: "off" | "simple" | "full";
  /** Pools of light from the nearest street lights. */
  streetLights: "0" | "8" | "16" | "32";
  /** Drops running on the windscreen (driver's seat). */
  rainGlass: "off" | "on";
  /** How far the ground, imagery and buildings are loaded. */
  viewDistance: "near" | "medium" | "far";
  /** Cars on the roads and people on the pavements. */
  traffic: "few" | "normal" | "many";
  antialias: "off" | "on";
  /**
   * 描画方式: auto = WebGPU where the browser has it, else WebGL 2 (three's WebGPURenderer picks);
   * webgl = WebGL 2 always (forceWebGL), for a GPU or driver that misbehaves under WebGPU.
   */
  backend: "auto" | "webgl";
};

export type GraphicsKey = Exclude<keyof GraphicsSettings, "preset">;
/** The items the presets set (描画方式 is not a quality level: the presets leave it alone). */
export type PresetKey = Exclude<GraphicsKey, "backend">;

/** Labels are i18n keys (src/i18n/ja.ts): the panel shows them in the language in force. */
type Option = { value: string; label: MessageKey };
export type GraphicsItem = {
  key: GraphicsKey;
  label: MessageKey;
  options: Option[];
  onReload?: boolean;
  /** false: not part of the presets (choosing a preset keeps it, changing it keeps the preset). */
  inPreset?: false;
};

/** The 設定 screen's rows, in order. */
export const GRAPHICS_ITEMS: GraphicsItem[] = [
  {
    key: "resolution",
    label: "graphics.resolution",
    options: [
      { value: "2", label: "graphics.resolution2" },
      { value: "1.5", label: "graphics.resolution15" },
      { value: "1", label: "graphics.resolution1" },
      { value: "0.75", label: "graphics.resolution075" },
    ],
  },
  {
    key: "shadows",
    label: "graphics.shadows",
    options: [
      { value: "4096", label: "graphics.ultra" },
      { value: "2048", label: "graphics.high" },
      { value: "1024", label: "graphics.medium" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "reflections",
    label: "graphics.reflections",
    options: [
      { value: "high", label: "graphics.high" },
      { value: "low", label: "graphics.low" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "bloom",
    label: "graphics.bloom",
    options: [
      { value: "high", label: "graphics.high" },
      { value: "low", label: "graphics.low" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "lensFlare",
    label: "graphics.lensFlare",
    options: [
      { value: "on", label: "graphics.on" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "motionBlur",
    label: "graphics.motionBlur",
    options: [
      { value: "strong", label: "graphics.strong" },
      { value: "light", label: "graphics.weak" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "windows",
    label: "graphics.windows",
    options: [
      { value: "rooms", label: "graphics.windowsRooms" },
      { value: "lit", label: "graphics.windowsLit" },
      { value: "flat", label: "graphics.windowsFlat" },
    ],
  },
  {
    key: "wetRoads",
    label: "graphics.wetRoads",
    options: [
      { value: "full", label: "graphics.wetRoadsFull" },
      { value: "simple", label: "graphics.wetRoadsSimple" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "streetLights",
    label: "graphics.streetLights",
    options: [
      { value: "32", label: "graphics.many" },
      { value: "16", label: "graphics.medium" },
      { value: "8", label: "graphics.few" },
      { value: "0", label: "graphics.off" },
    ],
  },
  {
    key: "rainGlass",
    label: "graphics.rainGlass",
    options: [
      { value: "on", label: "graphics.on" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "viewDistance",
    label: "graphics.viewDistance",
    onReload: true,
    options: [
      { value: "far", label: "graphics.far" },
      { value: "medium", label: "graphics.medium" },
      { value: "near", label: "graphics.near" },
    ],
  },
  {
    key: "traffic",
    label: "graphics.traffic",
    onReload: true,
    options: [
      { value: "many", label: "graphics.many" },
      { value: "normal", label: "graphics.normal" },
      { value: "few", label: "graphics.few" },
    ],
  },
  {
    key: "antialias",
    label: "graphics.antialias",
    onReload: true,
    options: [
      { value: "on", label: "graphics.on" },
      { value: "off", label: "graphics.off" },
    ],
  },
  {
    key: "backend",
    label: "graphics.backend",
    onReload: true,
    inPreset: false,
    options: [
      { value: "auto", label: "graphics.backendAuto" },
      { value: "webgl", label: "graphics.backendWebgl" },
    ],
  },
];

/** The rows the presets set. */
export const PRESET_ITEMS = GRAPHICS_ITEMS.filter(
  (i): i is GraphicsItem & { key: PresetKey } => i.inPreset !== false,
);

export const PRESET_LABEL: Record<GraphicsPreset | "custom", MessageKey> = {
  ultra: "graphics.ultra",
  high: "graphics.high",
  medium: "graphics.medium",
  low: "graphics.low",
  custom: "graphics.custom",
};

/** 高 is the computer's default: what the game drew before the presets, plus the new effects. */
export const PRESETS: Record<GraphicsPreset, Pick<GraphicsSettings, PresetKey>> = {
  ultra: {
    resolution: "2",
    shadows: "4096",
    motionBlur: "light",
    bloom: "high",
    lensFlare: "on",
    reflections: "high",
    windows: "rooms",
    wetRoads: "full",
    streetLights: "32",
    rainGlass: "on",
    viewDistance: "far",
    traffic: "many",
    antialias: "on",
  },
  high: {
    resolution: "1.5",
    shadows: "2048",
    motionBlur: "light",
    bloom: "high",
    lensFlare: "on",
    reflections: "high",
    windows: "rooms",
    wetRoads: "full",
    streetLights: "16",
    rainGlass: "on",
    viewDistance: "medium",
    traffic: "normal",
    antialias: "on",
  },
  medium: {
    resolution: "1",
    shadows: "1024",
    motionBlur: "light",
    bloom: "low",
    lensFlare: "off",
    reflections: "low",
    windows: "lit",
    wetRoads: "simple",
    streetLights: "8",
    rainGlass: "on",
    viewDistance: "medium",
    traffic: "normal",
    antialias: "on",
  },
  low: {
    resolution: "0.75",
    shadows: "off",
    motionBlur: "off",
    bloom: "off",
    lensFlare: "off",
    reflections: "off",
    windows: "flat",
    wetRoads: "simple",
    streetLights: "0",
    rainGlass: "off",
    viewDistance: "near",
    traffic: "few",
    antialias: "off",
  },
};

const STORE_KEY = "tod.graphics";

/** What the presets leave alone, as a fresh browser has it. */
const NON_PRESET: Omit<GraphicsSettings, PresetKey | "preset"> = { backend: "auto" };

export function defaultGraphics(isMobile: boolean): GraphicsSettings {
  const preset: GraphicsPreset = isMobile ? "low" : "high";
  return { preset, ...NON_PRESET, ...PRESETS[preset] };
}

/** The settings with a preset applied; the items outside the presets stay as they were in `from`. */
export function withPreset(preset: GraphicsPreset, from?: GraphicsSettings): GraphicsSettings {
  const kept = from ? { backend: from.backend } : NON_PRESET;
  return { preset, ...kept, ...PRESETS[preset] };
}

/** One item changed: the preset becomes the one it now matches, or カスタム. */
export function withItem(s: GraphicsSettings, key: GraphicsKey, value: string): GraphicsSettings {
  const item = GRAPHICS_ITEMS.find((i) => i.key === key);
  const isKnown = item?.options.some((o) => o.value === value) ?? false;
  if (!isKnown) return s;
  const next = { ...s, [key]: value } as GraphicsSettings;
  return { ...next, preset: matchingPreset(next) };
}

function matchingPreset(s: GraphicsSettings): GraphicsPreset | "custom" {
  const names = Object.keys(PRESETS) as GraphicsPreset[];
  const match = names.find((p) => PRESET_ITEMS.every((i) => PRESETS[p][i.key] === s[i.key]));
  return match ?? "custom";
}

/** Stored settings, each item checked against its options (anything unknown: the default's). */
export function parseGraphics(raw: unknown, isMobile: boolean): GraphicsSettings {
  const base = defaultGraphics(isMobile);
  if (typeof raw !== "object" || raw === null) return base;
  let s = base;
  for (const item of GRAPHICS_ITEMS) {
    const value = (raw as Record<string, unknown>)[item.key];
    if (typeof value === "string") s = withItem(s, item.key, value);
  }
  return s;
}

export function loadGraphics(isMobile: boolean): GraphicsSettings {
  try {
    return parseGraphics(JSON.parse(localStorage.getItem(STORE_KEY) ?? "null"), isMobile);
  } catch {
    // Storage blocked (private window, previews): the defaults.
    return defaultGraphics(isMobile);
  }
}

export function saveGraphics(s: GraphicsSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Not remembered when storage is blocked; the choice still applies now.
  }
}

/**
 * The settings in force, for everything that draws: read `settings` each frame or listen with
 * `onChange`. One instance (`GRAPHICS` in device.ts).
 */
export class Graphics {
  private listeners: Array<(s: GraphicsSettings) => void> = [];

  constructor(public settings: GraphicsSettings) {}

  onChange(fn: (s: GraphicsSettings) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  set(next: GraphicsSettings): void {
    this.settings = next;
    saveGraphics(next);
    for (const l of this.listeners) l(next);
  }
}
