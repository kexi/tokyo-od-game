import {
  alreadyDispatched,
  dispatched,
  hasEnoughInfo,
  opening,
  operatorPrompt,
  QUICK_REPLIES,
  scriptedOperator,
  type Line,
  type Said,
} from "../ai/dispatch";
import type { NpcBrain } from "../ai/llm";
import type { Voice } from "../ai/tts";
import { bindText, getLocale, onLocaleChange, t } from "../i18n";
import { translateWord } from "../i18n/reverse";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

// Conversation ids for the operators so their Gemma sessions do not mix with pedestrians'.
const ZOOM_KEY = "tokyo-od:phone-zoom";
/** The zoom chosen earlier in this session (sessionStorage: forgotten when the tab closes). */
function readZoom(): boolean {
  try {
    return sessionStorage.getItem(ZOOM_KEY) === "1";
  } catch {
    return false;
  }
}

const OPERATOR_ID: Record<Line, number> = { "119": -119, "110": -110 };

/**
 * In-game smartphone for emergency calls. Operators are voiced by Gemma (or a script without
 * it); `onDispatch` fires once the caller has given a place and what happened.
 */
export class Phone {
  private line: Line | null = null;
  private callerText = "";
  private callStart = 0;
  private dispatched = false;
  private busy = false;
  /**
   * When the player last worked the phone (a tap or a key on it). The law forbids holding it to talk
   * or watching its screen while the car moves (第71条第5号の5), not a phone sitting in its holder,
   * so only working it counts.
   */
  private touchedAt = -Infinity;

  constructor(
    private readonly brain: NpcBrain,
    private readonly voice: Voice,
    private readonly context: () => { location: string; clock: string; hasIncident: boolean },
    private readonly onDispatch: (line: Line) => boolean,
  ) {
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-dial]")) {
      b.addEventListener("click", () => this.dial(b.dataset.dial as Line));
    }
    const touch = () => (this.touchedAt = performance.now());
    $("#phone").addEventListener("pointerdown", touch, true);
    $("#phone").addEventListener("keydown", touch, true);
    $("#phone-close").addEventListener("click", () => this.close());
    $("#call-hangup").addEventListener("click", () => this.hangUp());
    $("#phone-button").addEventListener("click", () => this.toggle());
    $("#phone-zoom").addEventListener("click", () => this.toggleZoom());
    // Clicking the dimmed screen round the large phone puts it back.
    $("#phone-backdrop").addEventListener("click", () => this.setZoom(false));
    window.addEventListener("resize", () => this.fitZoom());
    this.applyZoom(readZoom());
    // The zoom button's label and tooltip, again in a new language.
    onLocaleChange(() => this.applyZoom(this.zoomed));
    $<HTMLFormElement>("#call-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>("#call-input");
      const text = input.value.trim();
      input.value = "";
      if (text) void this.say(text);
    });
    $<HTMLInputElement>("#call-input").addEventListener("keydown", (e) => {
      if (e.key === "Escape") (e.target as HTMLInputElement).blur();
    });
  }

  get open(): boolean {
    return !$("#phone").hidden;
  }

  get inCall(): boolean {
    return this.line !== null;
  }

  /** Being worked now: touched in the last 2 s (about the time of a glance that becomes 注視). */
  isInUse(now: number): boolean {
    return this.open && now - this.touchedAt < 2000;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  /** Taking it out by hand counts as working it; the game putting it in the holder does not. */
  show(byHand = true): void {
    $("#phone").hidden = false;
    $("#phone-backdrop").hidden = !this.zoomed;
    if (byHand) this.touchedAt = performance.now();
    this.fitZoom();
    this.refresh();
  }

  close(): void {
    if (this.inCall) this.hangUp();
    $("#phone").hidden = true;
    $("#phone-backdrop").hidden = true;
  }

  /** 拡大表示: the phone large in the middle of the screen (remembered for this session). */
  get zoomed(): boolean {
    return $("#phone").classList.contains("zoomed");
  }

  toggleZoom(): void {
    this.setZoom(!this.zoomed);
  }

  /** Zooming in or out is working the phone (a look at its screen while driving is booked). */
  setZoom(on: boolean): void {
    this.touchedAt = performance.now();
    this.applyZoom(on);
    try {
      sessionStorage.setItem(ZOOM_KEY, on ? "1" : "0");
    } catch {
      // Storage blocked (private mode, sandbox): the choice just lasts until the page is left.
    }
  }

  private applyZoom(on: boolean): void {
    $("#phone").classList.toggle("zoomed", on);
    $("#phone-backdrop").hidden = !(on && this.open);
    const button = $("#phone-zoom");
    button.setAttribute("aria-pressed", String(on));
    const label = t(on ? "phoneUi.zoomOut" : "phoneUi.zoomIn");
    button.setAttribute("aria-label", label);
    button.title = t("phoneUi.keyTitle", { label, key: "Shift+F" });
    this.fitZoom();
  }

  /** Scale for the large view: about 1.6×, less when the window is too small for that. */
  private fitZoom(): void {
    const el = $("#phone");
    const isMeasurable = el.offsetHeight > 0 && el.offsetWidth > 0;
    if (!isMeasurable) return;
    const fit = Math.min(
      (window.innerHeight - 32) / el.offsetHeight,
      (window.innerWidth - 32) / el.offsetWidth,
    );
    el.style.setProperty("--phone-zoom", String(Math.max(1, Math.min(1.6, fit))));
  }

  focusInput(): void {
    if (this.inCall) $<HTMLInputElement>("#call-input").focus();
  }

  /** Clock, location and call timer (called from the HUD tick). */
  refresh(): void {
    if (!this.open) return;
    const ctx = this.context();
    $("#phone-clock").textContent = ctx.clock;
    // The town is the data's own (Japanese); only the game's 「不明」 is a word to translate.
    const place = translateWord(ctx.location, "phoneUi.unknownPlace");
    $("#phone-loc").textContent = t("phoneUi.location", { place });
    if (this.inCall) {
      const s = Math.floor((performance.now() - this.callStart) / 1000);
      $("#call-timer").textContent =
        `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }
  }

  dial(line: Line): void {
    this.line = line;
    this.callerText = "";
    this.dispatched = false;
    this.callStart = performance.now();
    // Out of the pocket and over whatever app was open (Y, the taxi): the call screen alone. Why not
    // only hide the home screen: with Y open — as the phone starts — the call stayed behind it.
    this.show();
    for (const app of ["#phone-home", "#phone-social", "#phone-taxi"]) $(app).hidden = true;
    $("#phone-call").hidden = false;
    $("#call-number").textContent = line;
    $("#call-log").replaceChildren();
    const quick = $("#call-quick");
    quick.replaceChildren(
      ...QUICK_REPLIES[line].map((q) => {
        const b = document.createElement("button");
        b.type = "button";
        // Shown and said in the language in force (the operators understand all three).
        bindText(b, () => t(q.key));
        b.addEventListener("click", () => {
          const text = q.location ? t("call.location", { location: this.context().location }) : t(q.key);
          void this.say(text);
        });
        return b;
      }),
    );
    this.operator(opening(line));
  }

  hangUp(): void {
    const line = this.line;
    this.line = null;
    $("#phone-call").hidden = true;
    $("#phone-home").hidden = false;
    this.voice.stop();
    if (line) void this.brain.forget(OPERATOR_ID[line]);
  }

  private async say(text: string): Promise<void> {
    const line = this.line;
    if (!line || this.busy) return;
    this.busy = true;
    this.bubble("me", text);
    this.callerText += ` ${text}`;
    const ctx = this.context();
    let reply: string | null = null;
    const isReadyToDispatch = ctx.hasIncident && hasEnoughInfo(this.callerText);
    if (!isReadyToDispatch && this.brain.ready) {
      const bubble = this.bubble("op", "…");
      reply = await this.brain.reply(
        OPERATOR_ID[line],
        operatorPrompt(line, ctx.location),
        text,
        (partial) => {
          bubble.textContent = partial || "…";
        },
      );
      bubble.remove();
    }
    let scripted: Said | null = null;
    if (isReadyToDispatch && !this.dispatched) {
      this.dispatched = this.onDispatch(line);
      scripted = this.dispatched ? dispatched(line) : alreadyDispatched();
    }
    const fromModel = scripted ? null : reply?.trim() || null;
    // The model's reply is in the language in force; it has a Japanese voice only in Japanese.
    const isModelInJapanese = getLocale() === "ja";
    this.operator(
      fromModel !== null
        ? { text: fromModel, ja: isModelInJapanese ? fromModel : "" }
        : (scripted ?? scriptedOperator(line, this.callerText, ctx.hasIncident)),
    );
    this.busy = false;
  }

  /**
   * The operator's line: shown in the language in force, spoken by the on-device voice (sanoTTS-jp,
   * Japanese only) in its Japanese original — a scripted line has one, a model's reply in English
   * or Chinese does not, and is not spoken.
   */
  private operator(line: Said): void {
    this.bubble("op", line.text);
    if (line.ja) this.voice.speak(line.ja);
  }

  private bubble(who: "me" | "op", text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `bubble ${who === "me" ? "me" : "npc"}`;
    el.textContent = text;
    const log = $("#call-log");
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
}
