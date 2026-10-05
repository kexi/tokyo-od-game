import type { MessageKey } from "../i18n";
import { warn } from "../log";

/**
 * On-device NPC dialogue with Gemma 4 E2B through LiteRT-LM (WebGPU). Nothing leaves the
 * browser; the 2.0 GB model is fetched from Hugging Face only after explicit consent and kept
 * in Cache Storage. Runs on the main thread like Google's own demo: the work is on the GPU and
 * a worker would need module/classic importScripts shims for LiteRT-LM's loader.
 */
const MODEL_URL =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it-web.litertlm";
const MODEL_BYTES = 2_008_432_640;
// <user>.github.io is shared by every project site of the account; namespace the cache.
const CACHE_NAME = "tokyo-od-game:gemma-4-e2b:v1";
const CONSENT_KEY = "tokyo-od-game:llm-consent";

export type LlmStatus = "unsupported" | "idle" | "downloading" | "loading" | "ready" | "error";

type Engine = Awaited<ReturnType<typeof import("@litert-lm/core").Engine.create>>;
type Conversation = Awaited<ReturnType<Engine["createConversation"]>>;

// Sentences the synthesized voice must never say (sanoTTS-jp model licence §3.2, inherited from
// the つくよみちゃん corpus terms) and that a street NPC has no business saying anyway.
const BLOCKED = /(選挙|政党|自民|立憲|共産|公明|維新|宗教|信仰|布教|殺|死ね|バカ|アホ|クズ|差別)/;

export class NpcBrain {
  status: LlmStatus = "idle";
  progress = 0;
  detail = "";
  private engine: Engine | null = null;
  private readonly conversations = new Map<number, Conversation>();
  private abort: AbortController | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  /** Whether Gemma can run here; `reason` is an i18n key, shown in the language in force. */
  static async support(): Promise<{ ok: boolean; reason?: MessageKey }> {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIos) return { ok: false, reason: "ai.reason.ios" };
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return { ok: false, reason: "ai.reason.noWebGpu" };
    const adapter = await gpu.requestAdapter().catch(() => null);
    if (!adapter) return { ok: false, reason: "ai.reason.noAdapter" };
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const free = est?.quota && est.usage !== undefined ? est.quota - est.usage : Infinity;
    const isCached = await NpcBrain.isCached();
    if (!isCached && free < MODEL_BYTES * 1.05) return { ok: false, reason: "ai.reason.storage" };
    return { ok: true };
  }

  static async isCached(): Promise<boolean> {
    try {
      return (await (await caches.open(CACHE_NAME)).match(MODEL_URL)) !== undefined;
    } catch {
      return false;
    }
  }

  static hasConsent(): boolean {
    try {
      return localStorage.getItem(CONSENT_KEY) === "yes";
    } catch {
      return false;
    }
  }

  static async clearCache(): Promise<void> {
    await caches.delete(CACHE_NAME).catch(() => undefined);
    try {
      localStorage.removeItem(CONSENT_KEY);
    } catch {
      // ignore
    }
  }

  get ready(): boolean {
    return this.status === "ready";
  }

  /** Download (once) and initialise Gemma. Call only after the player agreed. */
  async enable(): Promise<void> {
    if (this.status === "ready" || this.status === "downloading" || this.status === "loading") return;
    try {
      localStorage.setItem(CONSENT_KEY, "yes");
    } catch {
      // ignore
    }
    try {
      const cache = await caches.open(CACHE_NAME);
      if (!(await cache.match(MODEL_URL))) await this.download(cache);
      this.status = "loading";
      this.detail = "モデルを GPU に読み込み中…";
      await navigator.storage?.persist?.().catch(() => false);
      const { Engine } = await import("@litert-lm/core");
      const cached = await cache.match(MODEL_URL);
      if (!cached?.body) throw new Error("model cache missing");
      this.engine = await Engine.create({ model: cached.body, mainExecutorSettings: { maxNumTokens: 2048 } });
      this.status = "ready";
      this.detail = "会話 AI 準備完了";
    } catch (error) {
      const isAbort = (error as Error).name === "AbortError";
      this.status = isAbort ? "idle" : "error";
      this.detail = isAbort ? "ダウンロードを中止しました" : `会話 AI を起動できません: ${String(error)}`;
      warn("llm_enable_failed", { error: String(error) });
    }
  }

  cancelDownload(): void {
    this.abort?.abort();
  }

  /**
   * One short reply from an NPC. Calls are serialised because the engine runs a single session
   * at a time. Returns null when the model is unavailable so callers can fall back to templates.
   */
  reply(
    npcId: number,
    persona: string,
    text: string,
    onDelta: (partial: string) => void,
  ): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      if (!this.engine) return null;
      let conv = this.conversations.get(npcId);
      if (!conv) {
        conv = await this.engine.createConversation({
          preface: { messages: [{ role: "system", content: persona }] },
          sessionConfig: { maxOutputTokens: 120 },
        });
        this.conversations.set(npcId, conv);
      }
      let out = "";
      for await (const chunk of conv.sendMessageStreaming(text)) {
        for (const part of chunk.content ?? []) {
          if (typeof part === "string") out += part;
          else if (part.type === "text") out += part.text;
        }
        onDelta(trimToSentences(out, 3));
        // Soft stop: once three sentences exist, stop showing more (cancel can wedge sessions).
        if (countSentences(out) >= 3) break;
      }
      const final = trimToSentences(out, 3).trim();
      return BLOCKED.test(final) ? "ごめんなさい、その話はちょっとわからないです。" : final;
    };
    const next = this.busy.then(run, run).catch((error: unknown) => {
      warn("llm_reply_failed", { error: String(error) });
      return null;
    });
    this.busy = next;
    return next;
  }

  async forget(npcId: number): Promise<void> {
    const conv = this.conversations.get(npcId);
    this.conversations.delete(npcId);
    await conv?.delete().catch(() => undefined);
  }

  private async download(cache: Cache): Promise<void> {
    this.status = "downloading";
    this.abort = new AbortController();
    const res = await fetch(MODEL_URL, { signal: this.abort.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    let received = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        received += chunk.byteLength;
        this.progress = received / MODEL_BYTES;
        this.detail = `Gemma 4 をダウンロード中… ${(received / 1e9).toFixed(2)} / ${(MODEL_BYTES / 1e9).toFixed(2)} GB`;
        controller.enqueue(chunk);
      },
    });
    await cache.put(
      MODEL_URL,
      new Response(res.body.pipeThrough(counter), { headers: { "Content-Length": String(MODEL_BYTES) } }),
    );
    this.abort = null;
  }
}

function countSentences(s: string): number {
  return (s.match(/[。！？!?]/g) ?? []).length;
}

function trimToSentences(s: string, max: number): string {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (!/[。！？!?]/.test(s[i])) continue;
    count++;
    if (count >= max) return s.slice(0, i + 1);
  }
  return s;
}
