import { warn } from "../log";
import { getLocale, type Locale } from "../i18n";

/** Japanese uses sanoTTS-jp; English and Mandarin use sanoTTS, all in the same Worker. */
type Pcm = { pcm: Float32Array; sampleRate: number };

/**
 * Where a line is heard from (game/spatialAudio.ts): `attach` gets the playing source (its
 * detune follows the Doppler shift) and returns the node to connect to; `release` frees it
 * when the line ends. Without one, lines go straight to the speakers (the phone).
 */
export type VoiceOutput = {
  attach(src: AudioBufferSourceNode): AudioNode;
  release(): void;
};
/** Asked when the line starts playing (it may wait in the queue), so the speaker is free then. */
export type VoiceFrom = () => VoiceOutput | null;

export class Voice {
  private worker: Worker | null = null;
  private readonly ready = new Map<Locale, Promise<boolean>>();
  private readonly initialising = new Map<Locale, (ok: boolean) => void>();
  private generation = 0;
  private seq = 0;
  private readonly pending = new Map<number, { locale: Locale; resolve: (p: Pcm | null) => void }>();
  private queue: Promise<void> = Promise.resolve();
  private current: AudioBufferSourceNode | null = null;
  enabled = false;

  constructor(private readonly getContext: () => AudioContext | null) {}

  /** Load only the language currently needed; later language changes reuse the Worker. */
  enable(locale: Locale = getLocale()): Promise<boolean> {
    this.enabled = true;
    const loaded = this.ready.get(locale);
    const isLoaded = loaded !== undefined;
    if (isLoaded) return loaded;
    try {
      const needsWorker = this.worker === null;
      if (needsWorker) {
        const worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
        this.worker = worker;
        worker.addEventListener("message", (event: MessageEvent) => {
          const msg = event.data as {
            type: string;
            id?: number;
            locale?: Locale;
            ok?: boolean;
            message?: string;
            pcm?: Float32Array;
            sampleRate?: number;
          };
          const isReady = msg.type === "ready" && msg.locale !== undefined;
          if (isReady && msg.locale) {
            const resolve = this.initialising.get(msg.locale);
            this.initialising.delete(msg.locale);
            const hasFailed = !msg.ok;
            if (hasFailed) {
              this.ready.delete(msg.locale);
              warn("tts_init_failed", { error: msg.message ?? "" });
            }
            resolve?.(Boolean(msg.ok));
            return;
          }
          const job = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
          if (!job || msg.id === undefined) return;
          this.pending.delete(msg.id);
          const hasFailed = msg.type === "error";
          if (hasFailed)
            warn("tts_synth_failed", { locale: job.locale, id: msg.id, error: msg.message ?? "" });
          job.resolve(
            msg.type === "pcm" && msg.pcm && msg.sampleRate
              ? { pcm: msg.pcm, sampleRate: msg.sampleRate }
              : null,
          );
        });
        worker.addEventListener("error", (event) => this.fail(event.message));
        worker.addEventListener("messageerror", () => this.fail("TTS Worker message could not be read"));
      }
      const loading = new Promise<boolean>((resolve) => {
        this.initialising.set(locale, resolve);
      });
      this.ready.set(locale, loading);
      const worker = this.worker;
      const hasWorker = worker !== null;
      if (!hasWorker) throw new Error("TTS Worker was not created");
      worker.postMessage({
        type: "init",
        locale,
        base: `${import.meta.env.BASE_URL}tts/`,
        sanoBase: `${import.meta.env.BASE_URL}sanotts/`,
      });
      return loading;
    } catch (error) {
      this.fail(String(error));
      return Promise.resolve(false);
    }
  }

  private fail(error: string): void {
    warn("tts_init_failed", { error });
    this.worker?.terminate();
    this.worker = null;
    this.ready.clear();
    for (const resolve of this.initialising.values()) resolve(false);
    this.initialising.clear();
    for (const job of this.pending.values()) job.resolve(null);
    this.pending.clear();
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  disable(): void {
    this.enabled = false;
    this.stop();
  }

  stop(): void {
    this.generation++;
    this.current?.stop();
    this.current = null;
    this.queue = Promise.resolve();
  }

  /** Speak a line (queued after anything already speaking), from `from` when given. */
  speak(text: string, from?: VoiceFrom, locale: Locale = getLocale()): void {
    const isDisabled = !this.enabled;
    if (isDisabled) return;
    const generation = this.generation;
    const sentences = speechChunks(text, locale);
    for (const s of sentences) {
      const synth = this.synth(s, locale);
      this.queue = this.queue.then(async () => {
        const pcm = await synth;
        const isCurrent = generation === this.generation && this.enabled;
        if (pcm && isCurrent) await this.play(pcm, from);
      });
    }
  }

  private async synth(text: string, locale: Locale): Promise<Pcm | null> {
    const isReady = await this.enable(locale);
    if (!isReady) return null;
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { locale, resolve });
      this.worker?.postMessage({ type: "synth", id, text, locale });
    });
  }

  private play({ pcm, sampleRate }: Pcm, from?: VoiceFrom): Promise<void> {
    const ctx = this.getContext();
    if (!ctx) return Promise.resolve();
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    const out = from?.() ?? null;
    src.connect(gain).connect(out?.attach(src) ?? ctx.destination);
    this.current = src;
    return new Promise((resolve) => {
      src.addEventListener("ended", () => {
        const isCurrent = this.current === src;
        if (isCurrent) this.current = null;
        out?.release();
        resolve();
      });
      src.start();
    });
  }
}

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** Limits each multilingual synthesis to a short sentence, keeping decimals and words intact. */
export function speechChunks(text: string, locale: Locale): string[] {
  const isJapanese = locale === "ja";
  if (isJapanese) return splitForTts(normalizeForTts(text));
  const sentences = text.normalize("NFKC").match(/(?:[^.!?。！？]|(?<=\d)\.(?=\d))+[.!?。！？]*/gu) ?? [];
  const chunks: string[] = [];
  const limit = 100;
  for (let sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    while ([...sentence].length > limit) {
      const first = [...sentence].slice(0, limit).join("");
      const breakAt = Math.max(first.lastIndexOf(" "), first.lastIndexOf("，"), first.lastIndexOf(","));
      const split = breakAt > 35 ? breakAt + 1 : first.length;
      chunks.push(sentence.slice(0, split).trim());
      sentence = sentence.slice(split).trim();
    }
    const hasText = sentence.length > 0;
    if (hasText) chunks.push(sentence);
  }
  return chunks;
}

/** 0 ≤ n < 1e12 → kanji numerals (e.g. 1250 → 千二百五十). */
export function numberToKanji(n: number): string {
  if (n === 0) return "零";
  const small = (v: number) => {
    let out = "";
    for (const [unit, value] of [
      ["千", 1000],
      ["百", 100],
      ["十", 10],
    ] as const) {
      const d = Math.floor(v / value) % 10;
      if (d > 0) out += (d === 1 ? "" : DIGITS[d]) + unit;
    }
    return out + DIGITS[v % 10];
  };
  let out = "";
  for (const [unit, value] of [
    ["億", 1e8],
    ["万", 1e4],
  ] as const) {
    const part = Math.floor(n / value) % 10000;
    if (part > 0) out += small(part) + unit;
  }
  return out + small(n % 10000);
}

const UNIT_READINGS: Array<[RegExp, string]> = [
  [/km\/h/gi, "キロ"],
  [/km/gi, "キロメートル"],
  [/(\d)\s*m(?![a-z])/gi, "$1メートル"],
  [/°C|℃/g, "度"], // NFKC turns ℃ into °C
  [/%/g, "パーセント"],
  [/〜|~/g, "から"],
];

/** Make text pronounceable by sanoTTS-jp: kanji numerals, unit words, no Latin/emoji. */
export function normalizeForTts(text: string): string {
  let s = text.normalize("NFKC");
  for (const [re, rep] of UNIT_READINGS) s = s.replace(re, rep);
  s = s.replace(
    /(\d+)\.(\d+)/g,
    (_, a: string, b: string) =>
      `${numberToKanji(Number(a))}点${[...b].map((d) => (d === "0" ? "零" : DIGITS[Number(d)])).join("")}`,
  );
  s = s.replace(/\d+/g, (d) => numberToKanji(Number(d)));
  // Latin words and symbols are dropped silently by the engine; remove them explicitly.
  s = s
    .replace(/[A-Za-z]+/g, "")
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー、。！？!?「」\s]/gu, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Sentence chunks below the engine's 512-byte input limit. */
export function splitForTts(text: string): string[] {
  const parts = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [];
  const out: string[] = [];
  const encoder = new TextEncoder();
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    let rest = p;
    while (encoder.encode(rest).length > 480) {
      out.push(rest.slice(0, 150));
      rest = rest.slice(150);
    }
    out.push(rest);
  }
  return out;
}
