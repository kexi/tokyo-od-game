import { onLocaleChange } from "../i18n";

/**
 * 通知: violations, posts about the player and the police, kept in a panel on the left with their
 * game time, instead of toasts that vanish after three seconds in the middle of the road ahead.
 * The latest ten stay listed; tapping one opens what it is about (the Y post, the record).
 */
export type NoticeKind = "violation" | "caught" | "social" | "police";

/** `text` runs again on a language switch, so the notices still listed follow it. */
export type Notice<T = unknown> = { kind: NoticeKind; text: () => string; clock: string; ref?: T };

const ICON: Record<NoticeKind, string> = { violation: "⚠", caught: "🚓", social: "📱", police: "👮" };
const COLOR: Record<NoticeKind, string> = {
  violation: "#ffb347",
  caught: "#ff6b6b",
  social: "#4dd2ff",
  police: "#ff6b6b",
};
const KEEP = 10;

export class NoticeLog {
  readonly items: Notice[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly onOpen: (n: Notice) => void,
  ) {
    onLocaleChange(() => this.render(false));
  }

  /** `text` as a function to follow a language switch; a plain string stays as written. */
  add(kind: NoticeKind, text: string | (() => string), clock: string, ref?: unknown): void {
    const render = typeof text === "string" ? () => text : text;
    this.items.unshift({ kind, text: render, clock, ref });
    if (this.items.length > KEEP) this.items.length = KEEP;
    this.root.hidden = false;
    this.render(true);
  }

  private render(isNew: boolean): void {
    const list = this.root.querySelector("ol");
    if (!list) return;
    list.replaceChildren(
      ...this.items.map((n, i) => {
        const li = document.createElement("li");
        li.style.borderLeftColor = COLOR[n.kind];
        if (isNew && i === 0) li.classList.add("fresh");
        const time = document.createElement("time");
        time.textContent = n.clock;
        const text = document.createElement("span");
        const words = n.text();
        text.textContent = `${ICON[n.kind]} ${words}`;
        li.title = words;
        li.append(time, text);
        li.addEventListener("click", () => this.onOpen(n));
        return li;
      }),
    );
  }
}
