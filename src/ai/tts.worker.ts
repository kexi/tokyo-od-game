/// <reference lib="webworker" />
import { SanoTts, type Synthesizer } from "./sanoTts";

// The Japanese and multilingual WASM engines stay in a Worker; a synthesis must not block driving.

type SaanModule = {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _saan_web_alloc(n: number): number;
  _saan_web_init(model: number, modelLen: number, dict: number, dictLen: number): number;
  _saan_web_synth(text: number, len: number): number;
  _saan_web_pcm(): number;
  _saan_web_n_samples(): number;
  _saan_web_sample_rate(): number;
  _saan_web_message(): number;
  UTF8ToString(p: number): string;
  lengthBytesUTF8(s: string): number;
  stringToUTF8(s: string, p: number, max: number): void;
};

type Locale = "ja" | "en" | "zh";
type TtsRequest =
  | { type: "init"; base: string; sanoBase: string; locale: Locale }
  | { type: "synth"; id: number; text: string; locale: Locale };

const voices = new Map<Locale, Synthesizer>();
let sano: SanoTts | null = null;
let jobs = Promise.resolve();

let mod: SaanModule | null = null;
let textBuf = 0;
let textCap = 0;

async function bytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const raw = new Uint8Array(await res.arrayBuffer());
  // Some servers (e.g. Vite dev) send .gz with Content-Encoding: gzip, so the browser has already
  // inflated it; only decompress when the gzip magic bytes are still there.
  const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
  if (!isGzip) return raw;
  const inflated = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(inflated).arrayBuffer());
}

function put(m: SaanModule, data: Uint8Array): number {
  const p = m._saan_web_alloc(data.length);
  m.HEAPU8.set(data, p);
  return p;
}

async function initialise(data: Extract<TtsRequest, { type: "init" }>): Promise<void> {
  try {
    if (voices.has(data.locale)) {
      postMessage({ type: "ready", locale: data.locale, ok: true });
      return;
    }
    const isJapanese = data.locale === "ja";
    if (isJapanese) {
      const factory = (await import(/* @vite-ignore */ `${data.base}saan_web_w8a32.mjs`))
        .default as () => Promise<SaanModule>;
      const [model, dict] = await Promise.all([
        bytes(`${data.base}student_i8.bin`),
        bytes(`${data.base}k1_dict.bin.gz`),
      ]);
      const module = await factory();
      const rc = module._saan_web_init(put(module, model), model.length, put(module, dict), dict.length);
      const hasFailed = rc < 0;
      if (hasFailed) throw new Error(module.UTF8ToString(module._saan_web_message()));
      mod = module;
      voices.set("ja", japanese);
    } else {
      sano ??= new SanoTts(data.sanoBase);
      const language = data.locale === "en" ? "en" : "zh";
      voices.set(data.locale, await sano.load(language));
    }
    postMessage({ type: "ready", locale: data.locale, ok: true });
  } catch (error) {
    sano = null;
    postMessage({ type: "ready", locale: data.locale, ok: false, message: String(error) });
  }
}

function japanese(text: string): { pcm: Float32Array; sampleRate: number } {
  const module = mod;
  if (!module) throw new Error("Japanese voice not initialised");
  const need = module.lengthBytesUTF8(text) + 1;
  // The C ABI has no free(); keep growing one text buffer instead of leaking per call.
  const needsCapacity = need > textCap;
  if (needsCapacity) {
    textCap = Math.max(4096, need);
    textBuf = module._saan_web_alloc(textCap);
  }
  module.stringToUTF8(text, textBuf, textCap);
  const rc = module._saan_web_synth(textBuf, need - 1);
  const hasFailed = rc < 0;
  if (hasFailed) throw new Error(module.UTF8ToString(module._saan_web_message()));
  const start = module._saan_web_pcm() >> 2;
  const pcm = module.HEAPF32.slice(start, start + module._saan_web_n_samples());
  return { pcm, sampleRate: module._saan_web_sample_rate() };
}

async function run(data: TtsRequest): Promise<void> {
  const isInitialising = data.type === "init";
  if (isInitialising) {
    await initialise(data);
    return;
  }
  try {
    const synth = voices.get(data.locale);
    if (!synth) throw new Error(`${data.locale} voice not initialised`);
    const { pcm, sampleRate } = synth(data.text);
    postMessage({ type: "pcm", id: data.id, pcm, sampleRate }, [pcm.buffer]);
  } catch (error) {
    postMessage({ type: "error", id: data.id, message: String(error) });
  }
}

self.addEventListener("message", (event: MessageEvent<TtsRequest>) => {
  // One runtime owns the voice buffers. Serialise asynchronous initialisation with synthesis
  // rather than let overlapping message handlers observe partially loaded models.
  jobs = jobs.then(() => run(event.data));
});
