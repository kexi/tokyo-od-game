import {
  OPENING_WORDS,
  personaPrompt,
  QUICK_QUESTIONS,
  templateLine,
  type Surroundings,
} from "../ai/dialogue";
import { NpcBrain } from "../ai/llm";
import type { Voice, VoiceFrom } from "../ai/tts";
import { bindText, getLocale, t } from "../i18n";
import { matchJapanese, translateWord } from "../i18n/reverse";
import type { Pedestrian, PedestrianProfile } from "../world/pedestrians";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

/** Chat panel between the player and one pedestrian; Gemma when available, templates otherwise. */
export class ConversationController {
  private partner: Pedestrian | null = null;
  private busy = false;
  /** Where the partner's voice comes from (their mouth, on the spatial layer); unset: plain. */
  voiceFrom: ((p: Pedestrian) => VoiceFrom) | null = null;

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
    for (const key of QUICK_QUESTIONS) {
      const b = document.createElement("button");
      b.type = "button";
      // Shown and asked in the language in force (templateLine understands all three).
      bindText(b, () => t(key));
      b.addEventListener("click", () => void this.send(t(key)));
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
    bindText($("#chat-sub"), () => partnerSub(p.profile, `${s.ward}${s.town}`));
    $("#chat-log").replaceChildren();
    $("#chat").hidden = false;
    document.body.classList.add("chatting");
    const greeting = templateLine(p.profile, s, OPENING_WORDS);
    this.say("npc", greeting.text, greeting.ja);
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
        ? t("talk.status.ready")
        : s === "downloading" || s === "loading"
          ? this.brain.detail
          : s === "error"
            ? t("talk.status.error", { detail: this.brain.detail })
            : t("talk.status.templates");
    button.hidden = s === "ready" || s === "loading";
    button.textContent = s === "downloading" ? t("talk.aiCancel") : t("talk.aiEnable");
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
        ? t("ai.consent.cached")
        : ""
      : t("ai.consent.unsupported", { reason: support.reason ? t(support.reason) : "" });
    $<HTMLButtonElement>("#ai-consent-ok").disabled = !support.ok;
    $<HTMLButtonElement>("#ai-consent-ok").textContent = isCached
      ? t("ai.consent.enable")
      : t("ai.consent.download");
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
    const fromModel = reply?.trim() || null;
    const fallback = fromModel === null ? templateLine(p.profile, s, text) : null;
    bubble.textContent = fromModel ?? fallback?.text ?? "";
    this.scroll();
    // The voice (sanoTTS-jp) speaks Japanese only: a set reply's Japanese original under the
    // translated bubble; the model's reply only when the game is in Japanese (in English or
    // Chinese the model answers in that language, and there is no Japanese to say).
    const isModelInJapanese = fromModel !== null && getLocale() === "ja";
    const spoken = fallback?.ja ?? (isModelInJapanese ? fromModel : null);
    if (spoken) this.voice.speak(spoken, this.voiceFrom?.(p));
    this.busy = false;
  }

  /** A bubble; `spoken` is what the pedestrian's voice says with it (null: nothing). */
  private say(who: "npc" | "me", text: string, spoken: string | null = null): HTMLElement {
    const el = document.createElement("div");
    el.className = `bubble ${who}`;
    el.textContent = text;
    $("#chat-log").append(el);
    this.scroll();
    const p = this.partner;
    const isVoiced = who === "npc" && spoken !== null;
    if (isVoiced) this.voice.speak(spoken, p ? this.voiceFrom?.(p) : undefined);
    return el;
  }

  private scroll(): void {
    const log = $("#chat-log");
    log.scrollTop = log.scrollHeight;
  }
}

/**
 * Under the partner's name: 「20代・会社員（千代田区丸の内二丁目）」 / "office worker, in their 20s
 * (…)". The profile is Japanese (the persona prompt reads it); its words are translated here, the
 * place stays as e-Stat names it.
 */
function partnerSub(profile: PedestrianProfile, place: string): string {
  const decade = matchJapanese(profile.age, "talk.age");
  const age = decade ? t("talk.age", decade) : profile.age;
  return t("talk.partnerSub", { age, role: translateWord(profile.role, "talk.role."), place });
}
