import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyI18n,
  bindText,
  detectLocale,
  getLocale,
  initialLocale,
  interpolate,
  LOCALE_NAMES,
  LOCALES,
  onLocaleChange,
  setI18nText,
  setLocale,
  STORE_KEY,
  t,
  translate,
  type Dictionaries,
} from "../src/i18n";
import { en } from "../src/i18n/en";
import { ja } from "../src/i18n/ja";
import { zh } from "../src/i18n/zh";

const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const DICTS = { ja, en, zh } as const;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();

/** Just enough of an Element for applyI18n / bindText: attributes and text. */
class FakeElement {
  textContent = "";
  private readonly attrs: Map<string, string>;
  constructor(attrs: Record<string, string> = {}) {
    this.attrs = new Map(Object.entries(attrs));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
}

/** A root whose querySelectorAll understands the attribute lists applyI18n asks for ("[a],[b]"). */
function fakeRoot(elements: FakeElement[]): ParentNode {
  const querySelectorAll = (selector: string) => {
    const names = selector.split(",").map((s) => s.trim().replace(/^\[|\]$/g, ""));
    return elements.filter((el) => names.some((n) => el.hasAttribute(n)));
  };
  return { querySelectorAll } as unknown as ParentNode;
}
const asElement = (el: FakeElement) => el as unknown as Element;

afterEach(() => {
  setLocale("ja");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("言語の決め方", () => {
  it("takes the first of the browser's languages we have, by primary subtag", () => {
    expect(detectLocale(["ja-JP"])).toBe("ja");
    expect(detectLocale(["ja"])).toBe("ja");
    expect(detectLocale(["en-US", "ja"])).toBe("en");
    expect(detectLocale(["fr-FR", "de", "ja-JP", "en"])).toBe("ja");
    expect(detectLocale(["ko-KR", "zh-CN", "ja"])).toBe("zh");
    expect(detectLocale(["JA-jp"])).toBe("ja");
    expect(detectLocale(["ja_JP"])).toBe("ja");
  });

  it("gives Traditional Chinese browsers the Simplified dictionary for now (no zh-Hant yet)", () => {
    expect(detectLocale(["zh-TW"])).toBe("zh");
    expect(detectLocale(["zh-HK"])).toBe("zh");
    expect(detectLocale(["zh-Hant-TW"])).toBe("zh");
  });

  it("falls back to English for anything else, or nothing at all", () => {
    expect(detectLocale(["fr-FR", "de-DE"])).toBe("en");
    expect(detectLocale(["yue"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("lets a stored choice win over the browser, and ignores a stored value it does not know", () => {
    expect(initialLocale("zh", ["ja-JP"])).toBe("zh");
    expect(initialLocale("en", ["ja-JP"])).toBe("en");
    expect(initialLocale("fr", ["ja-JP"])).toBe("ja");
    expect(initialLocale(null, ["zh-CN"])).toBe("zh");
    expect(initialLocale("", [])).toBe("en");
  });
});

describe("訳語の引き方", () => {
  const dicts = {
    ja: { a: "あ", b: "い", c: "う", e: "え" },
    en: { a: "A", b: "B", e: "" },
    zh: { a: "甲" },
  } as unknown as Dictionaries;

  it("follows zh → en → ja → the key", () => {
    expect(translate(dicts, "zh", "a")).toBe("甲");
    expect(translate(dicts, "zh", "b")).toBe("B");
    expect(translate(dicts, "zh", "c")).toBe("う");
    expect(translate(dicts, "zh", "missing")).toBe("missing");
  });

  it("takes English to Japanese (never to Chinese) and Japanese to the key", () => {
    expect(translate(dicts, "en", "c")).toBe("う");
    expect(translate(dicts, "ja", "missing")).toBe("missing");
  });

  it("treats an empty string as missing", () => {
    expect(translate(dicts, "en", "e")).toBe("え");
  });

  it("warns once per missing key in development, not every frame", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    translate(dicts, "zh", "only-once");
    translate(dicts, "zh", "only-once");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('"event":"i18n_missing"');
  });

  it("fills {name} slots, leaves unknown ones visible", () => {
    expect(interpolate("{place}から {n}%", { place: "東京", n: 42 })).toBe("東京から 42%");
    expect(interpolate("{a}{a}", { a: "x" })).toBe("xx");
    expect(interpolate("{gone} です", { other: 1 })).toBe("{gone} です");
    expect(interpolate("そのまま")).toBe("そのまま");
  });

  it("uses the language in force", () => {
    expect(t("title.start")).toBe("スタート");
    setLocale("en");
    expect(t("title.start")).toBe("Start");
    expect(t("loading.plateau", { percent: 40 })).toBe("Loading PLATEAU 3D city models… 40%");
    setLocale("zh");
    expect(t("loading.models", { place: "东京站 丸之内" })).toBe(
      "正在加载地形和 3D 模型…（出发地：东京站 丸之内）",
    );
  });
});

describe("辞書", () => {
  const jaKeys = Object.keys(ja).toSorted();

  it("has every Japanese key in English and Chinese, and nothing more", () => {
    expect(Object.keys(en).toSorted()).toEqual(jaKeys);
    expect(Object.keys(zh).toSorted()).toEqual(jaKeys);
  });

  it("has no empty or untrimmed strings", () => {
    for (const [name, dict] of Object.entries(DICTS))
      for (const [key, text] of Object.entries(dict)) {
        expect(text.trim(), `${name} ${key}`).not.toBe("");
        expect(text, `${name} ${key}`).toBe(text.trim());
      }
  });

  it("keeps the same {slots} in every language", () => {
    for (const key of jaKeys) {
      const k = key as keyof typeof ja;
      expect(slots(en[k]), `en ${key}`).toEqual(slots(ja[k]));
      expect(slots(zh[k]), `zh ${key}`).toEqual(slots(ja[k]));
    }
  });

  it("keeps toolbar labels short enough for the 120 px button beside its key", () => {
    // ~70 px of label: about 11 Latin letters or 5 Han characters at 13 px.
    for (const key of jaKeys.filter((k) => k.startsWith("toolbar."))) {
      const k = key as keyof typeof ja;
      expect(en[k].length, `en ${key}: ${en[k]}`).toBeLessThanOrEqual(11);
      expect(zh[k].length, `zh ${key}: ${zh[k]}`).toBeLessThanOrEqual(5);
    }
  });
});

describe("index.html の翻訳対象", () => {
  it("names only keys that exist", () => {
    const keys = [...html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) expect(Object.keys(ja), key).toContain(key);
  });

  it("shows the same Japanese before the script runs as ja.ts has", () => {
    const leaves = [...html.matchAll(/<(\w+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>([^<]*)<\/\1\s*>/g)];
    expect(leaves.length).toBeGreaterThan(40);
    for (const [, , key, text] of leaves) expect(squash(text), key).toBe(ja[key as keyof typeof ja]);
  });

  it("offers each language, named in itself, on the title screen and in 設定", () => {
    const buttons = [...html.matchAll(/<button[^>]*data-lang="(\w+)"[^>]*>([^<]*)</g)];
    expect(buttons.map((m) => m[1])).toEqual([...LOCALES]);
    for (const [, lang, name] of buttons) expect(name).toBe(LOCALE_NAMES[lang as keyof typeof LOCALE_NAMES]);
    const select = html.match(/<select id="opt-lang"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect([...select.matchAll(/value="(\w+)"/g)].map((m) => m[1])).toEqual([...LOCALES]);
    expect(html).toContain("言語 / Language / 语言");
  });

  it("puts a 設定 button on the title screen that opens the same dialog, once main.ts has wired it", () => {
    const start = html.indexOf('<section id="loading"');
    const title = html.slice(start, html.indexOf("</section>", start));
    const button = title.match(/<button[^>]*id="title-settings"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain('data-action="settings"');
    expect(button).toContain("disabled");
    expect(button).toContain('data-i18n="settings.title"');
    const main = readFileSync(join(root, "src/main.ts"), "utf8");
    expect(main).toContain('$<HTMLButtonElement>("#title-settings").disabled = false;');
  });
});

describe("画面への反映", () => {
  it("translates text and attributes, and redoes bound text, on a switch", () => {
    const heading = new FakeElement({ "data-i18n": "settings.title" });
    const toolbar = new FakeElement({ "data-i18n-title": "toolbarTitle.settings" });
    const search = new FakeElement({ "data-i18n-placeholder": "title.start" });
    const close = new FakeElement({ "data-i18n-aria-label": "settings.close" });
    const plain = new FakeElement();
    plain.textContent = "そのまま";
    const status = new FakeElement({ "data-i18n": "loading.data" });
    bindText(asElement(status), () => t("loading.plateau", { percent: 7 }));
    const dom = fakeRoot([heading, toolbar, search, close, plain, status]);

    applyI18n(dom);
    expect(heading.textContent).toBe("設定");
    expect(status.textContent).toBe("PLATEAU 3D 都市モデルを読み込み中… 7%");
    // bindText took the element over from its static key.
    expect(status.getAttribute("data-i18n")).toBeNull();

    setLocale("en");
    applyI18n(dom);
    expect(heading.textContent).toBe("Settings");
    expect(toolbar.getAttribute("title")).toBe("Settings (the game pauses while open)");
    expect(search.getAttribute("placeholder")).toBe("Start");
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(status.textContent).toBe("Loading PLATEAU 3D city models… 7%");
    expect(plain.textContent).toBe("そのまま");

    setLocale("zh");
    applyI18n(dom);
    expect(heading.textContent).toBe("设置");
    expect(status.textContent).toBe("正在加载 PLATEAU 3D 城市模型… 7%");
  });

  it("marks text set from a key so a later switch finds it", () => {
    const option = new FakeElement();
    setI18nText(asElement(option), "graphics.custom");
    expect(option.textContent).toBe("カスタム");
    setLocale("en");
    applyI18n(fakeRoot([option]));
    expect(option.textContent).toBe("Custom");
  });

  it("switches the page at once: <html lang>, the marked text, the listeners and the stored choice", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
    });
    const button = new FakeElement({ "data-i18n": "title.start" });
    const documentElement = { lang: "ja" };
    vi.stubGlobal("document", { documentElement, ...fakeRoot([button]) });
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));

    setLocale("zh");
    expect(getLocale()).toBe("zh");
    expect(documentElement.lang).toBe("zh-Hans");
    expect(button.textContent).toBe("开始");
    expect(stored.get(STORE_KEY)).toBe("zh");
    setLocale("en");
    expect(documentElement.lang).toBe("en");
    expect(seen).toEqual(["zh", "en"]);
    off();
    setLocale("ja");
    expect(seen).toEqual(["zh", "en"]);
  });

  it("still switches when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    setLocale("en");
    expect(getLocale()).toBe("en");
  });
});
