import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeWholeText, TtsInputTooLong, widenF16 } from "../src/ai/sanoTts";
import { speechChunks, Voice } from "../src/ai/tts";
import { setLocale } from "../src/i18n";
import files from "../assets/sanotts-files.json";
import { NavGuide } from "../src/game/navGuide";
import { recentLogs } from "../src/log";

afterEach(() => {
  setLocale("ja");
  vi.unstubAllGlobals();
});

describe("multilingual TTS input", () => {
  it("keeps English and Chinese words and decimals while normalising Japanese numbers", () => {
    expect(speechChunks("Turn right in 300 m. It's 21.5 degrees!", "en")).toEqual([
      "Turn right in 300 m.",
      "It's 21.5 degrees!",
    ]);
    expect(speechChunks("前方300米右转。气温21.5度！", "zh")).toEqual(["前方300米右转。", "气温21.5度!"]);
    expect(speechChunks("３００m先です。", "ja")).toEqual(["三百メートル先です。"]);
  });

  it("keeps every character in long Chinese sentences, without splitting surrogate pairs", () => {
    const original = "前方𠀀".repeat(80) + "。";
    const chunks = speechChunks(original, "zh");
    expect(chunks.join("")).toBe(original);
    for (const chunk of chunks) {
      expect([...chunk].length).toBeLessThanOrEqual(100);
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });
});

describe("the shipped sanoTTS resources", () => {
  it("preserves all text and PCM in order when long lines exceed the engine's capacity", () => {
    const text = "前方300米右转。然后继续直行。";
    const rendered: string[] = [];
    const result = synthesizeWholeText(text, (part) => {
      if ([...part].length > 4) throw new TtsInputTooLong("capacity exceeded");
      rendered.push(part);
      return {
        pcm: Float32Array.from([...part], (character) => character.codePointAt(0)!),
        sampleRate: 22050,
      };
    });
    expect(rendered.join("")).toBe(text);
    expect([...result.pcm]).toEqual([...text].map((character) => character.codePointAt(0)));
  });

  it("does not retry unrelated model failures as long-text errors", () => {
    const render = vi.fn(() => {
      throw new Error("malformed model");
    });
    expect(() => synthesizeWholeText("Hello, world.", render)).toThrow("malformed model");
    expect(render).toHaveBeenCalledOnce();
  });

  it("matches the fixed download/adaptation hashes for every runtime, voice and dictionary", () => {
    for (const file of files.files) {
      const bytes = readFileSync(file.file);
      expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(file.output_sha256);
      expect(file.url).toContain(files.commit);
    }
  });

  it("restores the exact Chinese float32 reference hashes from the shipped float16 models", () => {
    const base = "public/sanotts/voices/chinese-xiaoya/";
    const meta = JSON.parse(readFileSync(`${base}meta.json`, "utf8"));
    for (const part of ["front", "dec"] as const) {
      const bytes = readFileSync(base + meta[part]);
      const restored = widenF16(bytes, meta[`${part}_dims`]);
      const digest = createHash("sha256").update(restored).digest("hex");
      expect(digest).toBe(meta[`${part}_widened_sha256`]);
    }
  });

  it("rejects truncated float16 models before allocating the output", () => {
    expect(() => widenF16(new Uint8Array(3), { meta_bytes: 1, weight_floats: 2 })).toThrow(
      "invalid sanoTTS float16 blob",
    );
  });
});

type Request = { type: string; locale: string; id: number; text?: string };
class FakeWorker {
  static instance: FakeWorker;
  requests: Request[] = [];
  listeners = new Map<string, Array<(event: { data: unknown; message?: string }) => void>>();
  constructor() {
    FakeWorker.instance = this;
  }
  addEventListener(type: string, listener: (event: { data: unknown; message?: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  postMessage(request: Request): void {
    this.requests.push(request);
    if (request.type === "init") this.emit({ type: "ready", locale: request.locale, ok: true });
  }
  emit(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
  terminate(): void {}
}

describe("on-device speech language and cancellation", () => {
  it("records the language and request id when synthesis fails without trying an OS voice", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const voice = new Voice(() => null);
    await voice.enable("zh");
    voice.speak("前方右转。", undefined, "zh");
    await vi.waitFor(() => expect(FakeWorker.instance.requests.some((r) => r.type === "synth")).toBe(true));
    const request = FakeWorker.instance.requests.find((r) => r.type === "synth")!;
    FakeWorker.instance.emit({ type: "error", id: request.id, message: "decoder failed" });
    expect(recentLogs.query({ event: "tts_synth_failed" }).at(-1)).toMatchObject({
      locale: "zh",
      id: request.id,
      error: "decoder failed",
    });
  });

  it("sends navigation guidance through the on-device voice without invoking browser speech", () => {
    const speak = vi.fn();
    const guide = new NavGuide({ querySelector: () => null } as never, () => false);
    guide.voice = { enabled: true, speak } as never;
    setLocale("en");
    (guide as unknown as { say(text: string): void }).say("Turn right in 300 m.");
    expect(speak).toHaveBeenCalledWith("Turn right in 300 m.");
  });

  it("captures each line's locale and lazily initialises both voices when language changes", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const voice = new Voice(() => null);
    await voice.enable("en");
    setLocale("en");
    voice.speak("Turn right in 300 m.");
    setLocale("zh");
    voice.speak("前方300米右转。");
    await vi.waitFor(() =>
      expect(FakeWorker.instance.requests.filter((r) => r.type === "synth")).toHaveLength(2),
    );
    expect(FakeWorker.instance.requests.filter((r) => r.type === "init").map((r) => r.locale)).toEqual([
      "en",
      "zh",
    ]);
    expect(
      FakeWorker.instance.requests.filter((r) => r.type === "synth").map((r) => [r.locale, r.text]),
    ).toEqual([
      ["en", "Turn right in 300 m."],
      ["zh", "前方300米右转。"],
    ]);
  });

  it("does not play a late synthesis after the conversation was stopped", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const getContext = vi.fn(() => null);
    const voice = new Voice(getContext);
    await voice.enable("en");
    voice.speak("Hello.", undefined, "en");
    await vi.waitFor(() => expect(FakeWorker.instance.requests.some((r) => r.type === "synth")).toBe(true));
    const request = FakeWorker.instance.requests.find((r) => r.type === "synth")!;
    voice.stop();
    FakeWorker.instance.emit({
      type: "pcm",
      id: request.id,
      pcm: new Float32Array([0, 0.5]),
      sampleRate: 22050,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(getContext).not.toHaveBeenCalled();
  });
});
