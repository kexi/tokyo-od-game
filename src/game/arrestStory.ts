import type { MessageKey } from "../i18n";
import type { Sanction } from "./sanctions";

/**
 * What follows a red ticket, an arrest or a getaway, told as a few illustrated panels rather than
 * played (storyArt.ts draws them on a canvas, pursuitScene.ts shows them). Each panel is a few
 * seconds; the player may go on (次へ) or skip to the end (スキップ), the consequences are applied
 * either way. Pure: which panels, in what order, for how long — and the player that steps through
 * them with the frame's dt, so the 設定 pause and a replay (which stop the frame first) hold it.
 *
 * The procedure follows 刑事訴訟法 as fetched from e-Gov (knowledge/pursuit-and-aftermath.md):
 * 現行犯逮捕 (第212条・第213条) or 通常逮捕 on a warrant (第199条), 送致 within 48 hours
 * (第203条第1項), 勾留 asked within 24 more (第205条) or release, 略式命令 for a fine up to
 * 1,000,000 yen (第461条); the 赤切符 and the 交通裁判所; a request to appear (第198条).
 */
export type StoryKind = "redSummons" | "voluntary" | "arrest" | "laterVisit" | "laterArrest";

export type PanelArt =
  | "arrested"
  | "patrolSeat"
  | "redTicket"
  | "court"
  | "fine"
  | "station"
  | "interview"
  | "transfer"
  | "detention"
  | "release"
  | "tvNews"
  | "yFeed"
  | "licence"
  | "plate"
  | "home"
  | "warrant";

export type StoryPanel = { art: PanelArt; caption: MessageKey; ms: number };

/** What the story needs to know about the case. */
export type StoryFacts = {
  /** Grave: ひき逃げ, 危険運転致傷, 公務執行妨害, a 第67条 stop not obeyed — 勾留 and a trial. */
  grave: boolean;
  /** How far the chase went (0: there was none): the news only covers a real chase. */
  stage: 0 | 1 | 2 | 3;
  hitAndRun: boolean;
  /** People posted it on Y. */
  posted: boolean;
  sanction: Sanction;
};

export const PANEL_MS = 4500;
const LONG_MS = 6500;

const panel = (art: PanelArt, caption: MessageKey, ms = PANEL_MS): StoryPanel => ({ art, caption, ms });

/** The panels of a story, in order. */
export function storyPanels(kind: StoryKind, f: StoryFacts): StoryPanel[] {
  const isNews = f.stage >= 2 || f.hitAndRun || f.grave;
  const tv = isNews ? [panel("tvNews", "story.tv", LONG_MS)] : [];
  const y = f.posted ? [panel("yFeed", "story.y")] : [];
  const end = [panel("licence", sanctionCaption(f.sanction), LONG_MS)];
  const custody = f.grave
    ? [panel("detention", "story.detention")]
    : [panel("release", "story.release"), panel("court", "story.summary")];
  if (kind === "redSummons")
    return [
      panel("patrolSeat", "story.red.seat"),
      panel("redTicket", "story.red.ticket"),
      panel("court", "story.red.court"),
      panel("fine", "story.red.fine"),
      ...y,
      ...end,
    ];
  if (kind === "voluntary")
    return [
      panel("patrolSeat", "story.voluntary.ride"),
      panel("station", "story.station"),
      panel("interview", "story.voluntary.interview"),
      panel("transfer", "story.voluntary.transfer"),
      panel("court", "story.voluntary.court"),
      ...y,
      ...end,
    ];
  if (kind === "arrest")
    return [
      panel("arrested", "story.arrest.moment"),
      panel("patrolSeat", "story.arrest.ride"),
      panel("station", "story.arrest.station"),
      panel("interview", "story.interview"),
      panel("transfer", "story.transfer"),
      ...custody,
      ...tv,
      ...y,
      ...end,
    ];
  if (kind === "laterVisit")
    return [
      panel("plate", "story.later.identified"),
      panel("home", "story.later.visit"),
      ...(f.posted ? [panel("yFeed", "story.later.trend")] : []),
      panel("court", "story.later.procedure"),
      ...end,
    ];
  return [
    panel("plate", "story.later.identified"),
    panel("warrant", "story.laterArrest.warrant"),
    panel("home", "story.laterArrest.arrest"),
    panel("interview", "story.interview"),
    panel("transfer", "story.transfer"),
    ...custody,
    ...tv,
    ...(f.posted ? [panel("yFeed", "story.later.trend")] : []),
    ...end,
  ];
}

/** The last panel: what the points come to (src/i18n story.end.*). */
function sanctionCaption(s: Sanction): MessageKey {
  if (s.kind === "revocation") return "story.end.revocation";
  if (s.kind === "suspension") return "story.end.suspension";
  return "story.end.points";
}

export type StoryEvent = "panel" | "done";

/**
 * Steps through the panels with the frame's dt. next() goes on at once, skip() ends the story;
 * both, and running out, report "done" exactly once.
 */
export class StoryPlayer {
  index = 0;
  /** ms into the current panel. */
  t = 0;
  done = false;

  constructor(readonly panels: readonly StoryPanel[]) {
    this.done = panels.length === 0;
  }

  get panel(): StoryPanel | null {
    return this.done ? null : (this.panels[this.index] ?? null);
  }

  /** 0–1 through the current panel (for its slow pan). */
  get progress(): number {
    const p = this.panel;
    return p ? Math.min(1, this.t / p.ms) : 1;
  }

  update(dtSeconds: number): StoryEvent | null {
    if (this.done) return null;
    this.t += dtSeconds * 1000;
    const p = this.panels[this.index];
    if (!p || this.t < p.ms) return null;
    return this.next();
  }

  next(): StoryEvent | null {
    if (this.done) return null;
    this.index++;
    this.t = 0;
    if (this.index < this.panels.length) return "panel";
    this.done = true;
    return "done";
  }

  skip(): StoryEvent | null {
    if (this.done) return null;
    this.index = this.panels.length;
    this.done = true;
    return "done";
  }
}
