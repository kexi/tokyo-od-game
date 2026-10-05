type HeapModule = {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  lengthBytesUTF8(text: string): number;
  stringToUTF8(text: string, pointer: number, capacity: number): void;
};
type G2pModule = HeapModule & {
  _snt_g2p_init(): number;
  _snt_g2p_text_to_ids(text: number, ids: number, capacity: number): number;
  cwrap(name: string, result: string, args: string[]): (voice: string, slot: number) => number;
};
type VoiceModule = HeapModule & {
  _snt_voice_synthesize(
    front: number,
    decoder: number,
    ids: number,
    count: number,
    scale: number,
    output: number,
    capacity: number,
  ): number;
};
type Dimensions = { meta_bytes: number; weight_floats: number };
type Meta = {
  front_bytes: number;
  dec_bytes: number;
  front?: string;
  dec?: string;
  weights?: string;
  front_dims: Dimensions;
  dec_dims: Dimensions;
  front_widened_sha256?: string;
  dec_widened_sha256?: string;
  phoneme_id_map?: Record<string, number>;
  espeak_voice: string;
  g2p_voice_slot: number;
  length_scale: number;
  sample_rate: number;
};
type ZhG2p = { textToIds(text: string, map: Record<string, number>): { ids: number[] } };
export type Synthesizer = (text: string) => { pcm: Float32Array; sampleRate: number };
type Factory<T> = (options: { locateFile: (path: string) => string }) => Promise<T>;

export class TtsInputTooLong extends Error {}

/** Preserve every part of a line when the WASM token or PCM capacity rejects it. */
export function synthesizeWholeText(text: string, render: Synthesizer): ReturnType<Synthesizer> {
  try {
    return render(text);
  } catch (error) {
    const points = [...text];
    const canSplit = error instanceof TtsInputTooLong && points.length > 1;
    if (!canSplit) throw error;
    const middle = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, middle).join("");
    const wordBoundary = firstHalf.lastIndexOf(" ");
    const at = wordBoundary > firstHalf.length / 2 ? wordBoundary + 1 : firstHalf.length;
    const first = synthesizeWholeText(text.slice(0, at), render);
    const second = synthesizeWholeText(text.slice(at), render);
    const pcm = new Float32Array(first.pcm.length + second.pcm.length);
    pcm.set(first.pcm);
    pcm.set(second.pcm, first.pcm.length);
    return { pcm, sampleRate: first.sampleRate };
  }
}

/** Restores the float32 reference blobs from the upstream's float16 storage format. */
export function widenF16(bytes: Uint8Array, dimensions: Dimensions): Uint8Array {
  const { meta_bytes: header, weight_floats: count } = dimensions;
  const isInvalid =
    !Number.isInteger(header) ||
    !Number.isInteger(count) ||
    header < 0 ||
    count <= 0 ||
    bytes.length !== header + count * 2;
  if (isInvalid) throw new Error("invalid sanoTTS float16 blob");
  const output = new Uint8Array(header + count * 4);
  output.set(bytes.subarray(0, header));
  const inputView = new DataView(bytes.buffer, bytes.byteOffset + header, count * 2);
  const outputView = new DataView(output.buffer, header);
  for (let i = 0; i < count; i++) {
    const value = inputView.getUint16(i * 2, true);
    const exponent = (value >> 10) & 31;
    const fraction = value & 1023;
    const sign = value & 0x8000 ? -1 : 1;
    const float =
      exponent === 0
        ? sign * fraction * 2 ** -24
        : exponent === 31
          ? fraction === 0
            ? sign * Infinity
            : NaN
          : sign * 2 ** (exponent - 25) * (1024 + fraction);
    outputView.setFloat32(i * 4, float, true);
  }
  return output;
}

async function fetchBytes(url: string, size: number): Promise<Uint8Array> {
  const response = await fetch(url);
  const hasFailed = !response.ok;
  if (hasFailed) throw new Error(`${url}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const isTruncated = data.length !== size;
  if (isTruncated) throw new Error(`${url}: expected ${size} bytes, got ${data.length}`);
  return data;
}

async function checkedWeights(data: Uint8Array, expected?: string): Promise<void> {
  const needsCheck = expected !== undefined;
  if (!needsCheck) return;
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const hasChanged = actual !== expected;
  if (hasChanged) throw new Error("sanoTTS widened weights failed SHA-256 verification");
}

function put(module: HeapModule, data: Uint8Array): number {
  const pointer = module._malloc(data.length);
  const hasFailed = pointer === 0;
  if (hasFailed) throw new Error("sanoTTS allocation failed");
  module.HEAPU8.set(data, pointer);
  return pointer;
}

/** One acoustic WASM runtime shared by the English and Mandarin voices, entirely in the Worker. */
export class SanoTts {
  private runtime: Promise<VoiceModule> | null = null;
  private english: Promise<G2pModule> | null = null;
  private chinese: Promise<ZhG2p> | null = null;

  constructor(private readonly base: string) {}

  private voiceModule(): Promise<VoiceModule> {
    this.runtime ??= (async () => {
      const factory = (await import(/* @vite-ignore */ `${this.base}snt_voice.mjs`))
        .default as Factory<VoiceModule>;
      return factory({ locateFile: (path) => `${this.base}${path}` });
    })();
    return this.runtime;
  }

  private englishG2p(): Promise<G2pModule> {
    this.english ??= (async () => {
      const factory = (await import(/* @vite-ignore */ `${this.base}snt_g2p.mjs`))
        .default as Factory<G2pModule>;
      const module = await factory({ locateFile: (path) => `${this.base}${path}` });
      const hasFailed = module._snt_g2p_init() !== 0;
      if (hasFailed) throw new Error("sanoTTS English G2P init failed");
      return module;
    })();
    return this.english;
  }

  private chineseG2p(): Promise<ZhG2p> {
    this.chinese ??= (async () => {
      const module = await import(/* @vite-ignore */ `${this.base}g2p-lazy/zh/zh_g2p.mjs`);
      return module.loadZhG2P(`${this.base}g2p-lazy/zh/`, (url: string) => fetch(url)) as Promise<ZhG2p>;
    })();
    return this.chinese;
  }

  async load(locale: "en" | "zh"): Promise<Synthesizer> {
    const key = locale === "en" ? "amy" : "chinese-xiaoya";
    const base = `${this.base}voices/${key}/`;
    const response = await fetch(`${base}meta.json`);
    const hasFailed = !response.ok;
    if (hasFailed) throw new Error(`${base}meta.json: HTTP ${response.status}`);
    const meta = (await response.json()) as Meta;
    const [module, frontRaw, decoderRaw, g2p] = await Promise.all([
      this.voiceModule(),
      fetchBytes(`${base}${meta.front ?? "front_f32.bin"}`, meta.front_bytes),
      fetchBytes(`${base}${meta.dec ?? "dec_f32.bin"}`, meta.dec_bytes),
      locale === "en" ? this.englishG2p() : this.chineseG2p(),
    ]);
    const isFloat16 = meta.weights === "f16";
    const front = isFloat16 ? widenF16(frontRaw, meta.front_dims) : frontRaw;
    const decoder = isFloat16 ? widenF16(decoderRaw, meta.dec_dims) : decoderRaw;
    await Promise.all([
      checkedWeights(front, meta.front_widened_sha256),
      checkedWeights(decoder, meta.dec_widened_sha256),
    ]);
    const frontPointer = put(module, front);
    const decoderPointer = put(module, decoder);
    const phonemes =
      locale === "en"
        ? this.englishIds(g2p as G2pModule, meta)
        : (text: string) => {
            const map = meta.phoneme_id_map;
            const lacksMap = map === undefined;
            if (lacksMap) throw new Error("sanoTTS Mandarin phoneme map missing");
            return Int32Array.from((g2p as ZhG2p).textToIds(text, map).ids);
          };
    const render: Synthesizer = (text) => {
      const ids = phonemes(text);
      const idsPointer = put(module, new Uint8Array(ids.buffer));
      const capacity = meta.sample_rate * 20;
      const outputPointer = module._malloc(capacity * 4);
      try {
        const lacksOutput = outputPointer === 0;
        if (lacksOutput) throw new Error("sanoTTS PCM allocation failed");
        const count = module._snt_voice_synthesize(
          frontPointer,
          decoderPointer,
          idsPointer,
          ids.length,
          meta.length_scale,
          outputPointer,
          capacity,
        );
        const exceedsCapacity = count === -11 || count === -5;
        if (exceedsCapacity) throw new TtsInputTooLong(`sanoTTS ${key} capacity exceeded: ${count}`);
        const isSynthesisFailed = count <= 0;
        if (isSynthesisFailed) throw new Error(`sanoTTS ${key} synthesis failed: ${count}`);
        const pcm = module.HEAPF32.slice(outputPointer >> 2, (outputPointer >> 2) + count);
        return { pcm, sampleRate: meta.sample_rate };
      } finally {
        module._free(idsPointer);
        module._free(outputPointer);
      }
    };
    return (text) => synthesizeWholeText(text, render);
  }

  private englishIds(module: G2pModule, meta: Meta): (text: string) => Int32Array {
    const setVoice = module.cwrap("snt_g2p_set_voice", "number", ["string", "number"]);
    return (text) => {
      const lacksVoice = setVoice(meta.espeak_voice, meta.g2p_voice_slot) !== 0;
      if (lacksVoice) throw new Error("sanoTTS English voice not available");
      const length = module.lengthBytesUTF8(text) + 1;
      const textPointer = module._malloc(length);
      const idsPointer = module._malloc(1024 * 4);
      try {
        module.stringToUTF8(text, textPointer, length);
        const count = module._snt_g2p_text_to_ids(textPointer, idsPointer, 1024);
        const hasFailed = count <= 0 || count > 1024;
        if (hasFailed) throw new Error(`sanoTTS English G2P failed: ${count}`);
        return module.HEAP32.slice(idsPointer >> 2, (idsPointer >> 2) + count);
      } finally {
        module._free(textPointer);
        module._free(idsPointer);
      }
    };
  }
}
