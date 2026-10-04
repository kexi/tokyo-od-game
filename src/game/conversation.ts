import { personaPrompt, QUICK_QUESTIONS, templateReply, type Surroundings } from "../ai/dialogue";
import { NpcBrain } from "../ai/llm";
import type { Voice } from "../ai/tts";
import type { Pedestrian } from "../world/pedestrians";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

/** Chat panel between the player and one pedestrian; Gemma when available, templates otherwise. */
export class ConversationController {
  private partner: Pedestrian | null = null;
  private busy = false;

  constructor(
    private readonly brain: NpcBrain,
    private readonly voice: Voice,
    private readonly surroundings: () => Surroundings,
    private readonly onEnd: (p: Pedestrian) => void,
  ) {
    $("#chat-close").addEventListener("click", () => this.close());
    $<HTMLFormElement>("#chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>("#chat-input");
      const text = input.value.trim();
      input.value = "";
      if (text) void this.send(text);
    });
    const quick = $("#chat-quick");
    for (const q of QUICK_QUESTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.addEventListener("click", () => void this.send(q));
      quick.append(b);
    }
    $<HTMLInputElement>("#voice-toggle").addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on) void this.voice.enable();
      else this.voice.disable();
    });
    $("#ai-enable").addEventListener("click", () => void this.askConsent());
    // Esc inside the text box hands the keyboard back to driving (a second Esc closes the chat).
    $<HTMLInputElement>("#chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Escape") (e.target as HTMLInputElement).blur();
    });
  }

  get active(): Pedestrian | null {
    return this.partner;
  }

  /** Enter while chatting: start typing. */
  focusInput(): void {
    if (this.partner) $<HTMLInputElement>("#chat-input").focus();
  }

  open(p: Pedestrian): void {
    this.partner = p;
    const s = this.surroundings();
    $("#chat-name").textContent = p.profile.name;
    $("#chat-sub").textContent = `${p.profile.age}・${p.profile.role}（${s.ward}${s.town}）`;
    $("#chat-log").replaceChildren();
    $("#chat").hidden = false;
    document.body.classList.add("chatting");
    this.say("npc", templateReply(p.profile, s, "こんにちは"));
    // Do not steal the keyboard: driving / F (get out) keep working until the player presses
    // Enter or clicks the box to type.
  }

  close(): void {
    const p = this.partner;
    this.partner = null;
    $("#chat").hidden = true;
    document.body.classList.remove("chatting");
    $<HTMLInputElement>("#chat-input").blur();
    this.voice.stop();
    if (!p) return;
    void this.brain.forget(p.profile.id);
    this.onEnd(p);
  }

  /** Refresh the AI status line (called from the HUD tick). */
  refreshStatus(): void {
    const status = $("#ai-status");
    const button = $<HTMLButtonElement>("#ai-enable");
    const s = this.brain.status;
    status.textContent =
      s === "ready"
        ? "会話: Gemma 4（端末内で生成）"
        : s === "downloading" || s === "loading"
          ? this.brain.detail
          : s === "error"
            ? `${this.brain.detail}（定型応答で継続）`
            : "会話: 定型応答（オープンデータから回答）";
    button.hidden = s === "ready" || s === "loading";
    button.textContent = s === "downloading" ? "ダウンロードを中止" : "会話 AI（Gemma 4）を使う";
  }

  private async askConsent(): Promise<void> {
    if (this.brain.status === "downloading") {
      this.brain.cancelDownload();
      return;
    }
    const support = await NpcBrain.support();
    const dialog = $<HTMLDialogElement>("#ai-consent");
    const note = $("#ai-consent-note");
    const isCached = await NpcBrain.isCached();
    note.textContent = support.ok
      ? isCached
        ? "保存済みのモデルがあります（ダウンロード不要）。"
        : ""
      : `この端末では利用できません: ${support.reason}`;
    $<HTMLButtonElement>("#ai-consent-ok").disabled = !support.ok;
    $<HTMLButtonElement>("#ai-consent-ok").textContent = isCached ? "有効化" : "ダウンロードして有効化";
    $<HTMLButtonElement>("#ai-clear").hidden = !isCached;
    dialog.returnValue = "";
    dialog.showModal();
    dialog.addEventListener(
      "close",
      () => {
        if (dialog.returnValue === "ok") void this.brain.enable();
        if (dialog.returnValue === "clear") void NpcBrain.clearCache();
      },
      { once: true },
    );
  }

  private async send(text: string): Promise<void> {
    const p = this.partner;
    if (!p || this.busy) return;
    this.busy = true;
    this.say("me", text);
    const s = this.surroundings();
    const bubble = this.say("npc", "…");
    let reply: string | null = null;
    if (this.brain.ready) {
      reply = await this.brain.reply(p.profile.id, personaPrompt(p.profile, s), text, (partial) => {
        bubble.textContent = partial || "…";
        this.scroll();
      });
    }
    // Fall back to grounded templates when the model is off, failed, or returned nothing.
    reply = reply?.trim() || templateReply(p.profile, s, text);
    bubble.textContent = reply;
    this.scroll();
    this.voice.speak(reply);
    this.busy = false;
  }

  private say(who: "npc" | "me", text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `bubble ${who}`;
    el.textContent = text;
    $("#chat-log").append(el);
    this.scroll();
    if (who === "npc" && text !== "…") this.voice.speak(text);
    return el;
  }

  private scroll(): void {
    const log = $("#chat-log");
    log.scrollTop = log.scrollHeight;
  }
}
