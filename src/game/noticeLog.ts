/**
 * 通知: violations, posts about the player and the police, kept in a panel on the left with their
 * game time, instead of toasts that vanish after three seconds in the middle of the road ahead.
 * The latest ten stay listed; tapping one opens what it is about (the Y post, the record).
 */
export type NoticeKind = "violation" | "caught" | "social" | "police";

export type Notice<T = unknown> = { kind: NoticeKind; text: string; clock: string; ref?: T };

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
  ) {}

  add(kind: NoticeKind, text: string, clock: string, ref?: unknown): void {
    this.items.unshift({ kind, text, clock, ref });
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
        text.textContent = `${ICON[n.kind]} ${n.text}`;
        li.title = n.text;
        li.append(time, text);
        li.addEventListener("click", () => this.onOpen(n));
        return li;
      }),
    );
  }
}
