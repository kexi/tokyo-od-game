/// <reference lib="webworker" />
// sanoTTS-jp (Emscripten build, public/tts) in a worker: one synthesis blocks for 10–200 ms,
// which would otherwise stall three.js frames.

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

type TtsRequest = { type: "init"; base: string } | { type: "synth"; id: number; text: string };

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

self.addEventListener("message", async (event: MessageEvent<TtsRequest>) => {
  const data = event.data;
  if (data.type === "init") {
    try {
      const factory = (await import(/* @vite-ignore */ `${data.base}saan_web_w8a32.mjs`))
        .default as () => Promise<SaanModule>;
      const [model, dict] = await Promise.all([
        bytes(`${data.base}student_i8.bin`),
        bytes(`${data.base}k1_dict.bin.gz`),
      ]);
      const m = await factory();
      const rc = m._saan_web_init(put(m, model), model.length, put(m, dict), dict.length);
      mod = rc >= 0 ? m : null;
      postMessage({ type: "ready", ok: rc >= 0, message: m.UTF8ToString(m._saan_web_message()) });
    } catch (error) {
      postMessage({ type: "ready", ok: false, message: String(error) });
    }
    return;
  }
  const m = mod;
  if (!m) {
    postMessage({ type: "error", id: data.id, message: "not initialised" });
    return;
  }
  const need = m.lengthBytesUTF8(data.text) + 1;
  // The C ABI has no free(); keep growing one text buffer instead of leaking per call.
  if (need > textCap) {
    textCap = Math.max(4096, need);
    textBuf = m._saan_web_alloc(textCap);
  }
  m.stringToUTF8(data.text, textBuf, textCap);
  const rc = m._saan_web_synth(textBuf, need - 1);
  if (rc < 0) {
    postMessage({ type: "error", id: data.id, message: m.UTF8ToString(m._saan_web_message()) });
    return;
  }
  const start = m._saan_web_pcm() >> 2;
  const pcm = m.HEAPF32.slice(start, start + m._saan_web_n_samples()); // HEAPF32 can be replaced on growth
  postMessage({ type: "pcm", id: data.id, pcm, sampleRate: m._saan_web_sample_rate() }, [pcm.buffer]);
});
