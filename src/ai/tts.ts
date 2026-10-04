import { warn } from "../log";

/**
 * Japanese speech for NPCs with sanoTTS-jp compiled to WASM (scripts/build-tts.sh).
 * The engine silently drops digits and Latin letters and rejects inputs over 512 UTF-8 bytes,
 * so text is normalised and split per sentence before synthesis.
 */
type Pcm = { pcm: Float32Array; sampleRate: number };

export class Voice {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (p: Pcm | null) => void }>();
  private queue: Promise<void> = Promise.resolve();
  private current: AudioBufferSourceNode | null = null;
  enabled = false;

  constructor(private readonly getContext: () => AudioContext | null) {}

  /** Starts the worker and loads ~6 MB of model + dictionary on first use. */
  enable(): Promise<boolean> {
    this.enabled = true;
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL("./tts.worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve) => {
      const w = this.worker;
      if (!w) return resolve(false);
      w.addEventListener("message", (e: MessageEvent) => {
        const msg = e.data as {
          type: string;
          id?: number;
          ok?: boolean;
          message?: string;
          pcm?: Float32Array;
          sampleRate?: number;
        };
        if (msg.type === "ready") {
          if (!msg.ok) warn("tts_init_failed", { message: msg.message });
          resolve(Boolean(msg.ok));
          return;
        }
        const job = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (!job || msg.id === undefined) return;
        this.pending.delete(msg.id);
        job.resolve(
          msg.type === "pcm" && msg.pcm && msg.sampleRate
            ? { pcm: msg.pcm, sampleRate: msg.sampleRate }
            : null,
        );
      });
      w.postMessage({ type: "init", base: `${import.meta.env.BASE_URL}tts/` });
    });
    return this.ready;
  }

  disable(): void {
    this.enabled = false;
    this.stop();
  }

  stop(): void {
    this.current?.stop();
    this.current = null;
    this.queue = Promise.resolve();
  }

  /** Speak a line (queued after anything already speaking). */
  speak(text: string): void {
    if (!this.enabled) return;
    const sentences = splitForTts(normalizeForTts(text));
    for (const s of sentences) {
      const synth = this.synth(s);
      this.queue = this.queue.then(async () => {
        const pcm = await synth;
        if (pcm && this.enabled) await this.play(pcm);
      });
    }
  }

  private async synth(text: string): Promise<Pcm | null> {
    if (!(await this.enable())) return null;
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.worker?.postMessage({ type: "synth", id, text });
    });
  }

  private play({ pcm, sampleRate }: Pcm): Promise<void> {
    const ctx = this.getContext();
    if (!ctx) return Promise.resolve();
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(ctx.destination);
    this.current = src;
    return new Promise((resolve) => {
      src.addEventListener("ended", () => resolve());
      src.start();
    });
  }
}

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

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
