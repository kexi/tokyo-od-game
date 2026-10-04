import {
  DISPATCHED,
  hasEnoughInfo,
  OPENING,
  operatorPrompt,
  QUICK_REPLIES,
  scriptedOperator,
  type Line,
} from "../ai/dispatch";
import type { NpcBrain } from "../ai/llm";
import type { Voice } from "../ai/tts";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el;
};

// Conversation ids for the operators so their Gemma sessions do not mix with pedestrians'.
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
    if (byHand) this.touchedAt = performance.now();
    this.refresh();
  }

  close(): void {
    if (this.inCall) this.hangUp();
    $("#phone").hidden = true;
  }

  focusInput(): void {
    if (this.inCall) $<HTMLInputElement>("#call-input").focus();
  }

  /** Clock, location and call timer (called from the HUD tick). */
  refresh(): void {
    if (!this.open) return;
    const ctx = this.context();
    $("#phone-clock").textContent = ctx.clock;
    $("#phone-loc").textContent = `現在地: ${ctx.location}`;
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
    $("#phone-home").hidden = true;
    $("#phone-call").hidden = false;
    $("#call-number").textContent = line;
    $("#call-log").replaceChildren();
    const quick = $("#call-quick");
    quick.replaceChildren(
      ...QUICK_REPLIES[line].map((q) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = q;
        b.addEventListener("click", () => {
          const text = q === "現在地を伝える" ? `場所は東京都${this.context().location}付近です` : q;
          void this.say(text);
        });
        return b;
      }),
    );
    this.operator(OPENING[line]);
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
    if (isReadyToDispatch && !this.dispatched) {
      this.dispatched = this.onDispatch(line);
      reply = this.dispatched ? DISPATCHED[line] : "すでに出動しています。そのまま待っていてください。";
    }
    this.operator(reply?.trim() || scriptedOperator(line, this.callerText, ctx.hasIncident));
    this.busy = false;
  }

  private operator(text: string): void {
    this.bubble("op", text);
    this.voice.speak(text);
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
