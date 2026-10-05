import { t } from "../i18n";

/**
 * Analogue speedometer (SVG): 0–120 km/h over a 240° dial, the range above the speed limit in
 * red, and the limit itself as a 最高速度 sign (red ring, blue numerals) inside the dial.
 * The needle and readout turn red while the car is over the limit.
 */
const MAX = 120;
// Dial angles in degrees, 0 = right, counter-clockwise positive: 0 km/h sits at bottom-left
// (210°) and the scale runs clockwise over the top to bottom-right (−30°).
const START = 210;
const SWEEP = 240;
const CX = 100;
const CY = 100;
const R = 84;
const NS = "http://www.w3.org/2000/svg";

const angleOf = (kmh: number) => START - (SWEEP * Math.min(Math.max(kmh, 0), MAX)) / MAX;
const point = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};
/** SVG arc along the dial from speed a to speed b (clockwise on screen as speed rises). */
const arc = (a: number, b: number, r: number) => {
  const [x0, y0] = point(angleOf(a), r);
  const [x1, y1] = point(angleOf(b), r);
  const large = (SWEEP * (b - a)) / MAX > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
};

/** Under the limit sign: 規制速度 (posted), 区域規制 (zone) or 法定速度 (statutory), in the language in force. */
const KIND_LABEL = { sign: "speedo.sign", zone: "speedo.zone", statutory: "speedo.statutory" } as const;

export class Speedometer {
  private readonly needle: SVGLineElement;
  private readonly redZone: SVGPathElement;
  private readonly readout: SVGTextElement;
  private readonly limitGroup: SVGGElement;
  private readonly limitText: SVGTextElement;
  private readonly kindText: SVGTextElement;
  private shownLimit: number | null | undefined = undefined;

  constructor(container: HTMLElement) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("role", "img");
    // data-i18n-aria-label: applyI18n renames it on a language switch.
    svg.setAttribute("data-i18n-aria-label", "speedo.aria");
    svg.setAttribute("aria-label", t("speedo.aria"));
    const el = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
      parent: Element = svg,
    ) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.append(e);
      return e;
    };
    el("path", { d: arc(0, MAX, R), class: "dial" });
    this.redZone = el("path", { d: "", class: "red-zone" });
    for (let v = 0; v <= MAX; v += 10) {
      const isMajor = v % 20 === 0;
      const [x0, y0] = point(angleOf(v), R - 3);
      const [x1, y1] = point(angleOf(v), R - (isMajor ? 15 : 9));
      el("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: isMajor ? "tick major" : "tick" });
      if (isMajor) {
        const [tx, ty] = point(angleOf(v), R - 27);
        const label = el("text", { x: tx, y: ty, class: "tick-label" });
        label.textContent = String(v);
      }
    }
    // Readout below the hub (clear of the tick labels), the limit sign in the open bottom.
    this.readout = el("text", { x: CX, y: CY + 31, class: "readout" });
    this.readout.textContent = "0";
    const unit = el("text", { x: CX, y: CY + 43, class: "unit" });
    unit.textContent = "km/h";
    this.limitGroup = el("g", { class: "limit" });
    el("circle", { cx: CX, cy: CY + 64, r: 15, class: "limit-ring" }, this.limitGroup);
    this.limitText = el("text", { x: CX, y: CY + 65, class: "limit-value" }, this.limitGroup);
    this.kindText = el("text", { x: CX, y: CY + 91, class: "limit-kind" }, this.limitGroup);
    // Needle drawn after the readout so it sweeps over it; hub on top.
    this.needle = el("line", { x1: CX, y1: CY + 12, x2: CX, y2: CY - R + 12, class: "needle" });
    el("circle", { cx: CX, cy: CY, r: 5, class: "hub" });
    container.replaceChildren(svg);
  }

  update(speedKmh: number, limit: number | null, kind: keyof typeof KIND_LABEL | null): void {
    const speed = Math.abs(speedKmh);
    // Needle drawn pointing up (90°); rotate clockwise to the speed's dial angle.
    this.needle.setAttribute("transform", `rotate(${90 - angleOf(speed)} ${CX} ${CY})`);
    this.readout.textContent = String(Math.round(speed));
    const isOver = limit !== null && speed > limit + 1;
    this.needle.parentElement?.classList.toggle("over", isOver);
    if (limit !== this.shownLimit) {
      this.shownLimit = limit;
      this.redZone.setAttribute("d", limit === null ? "" : arc(limit, MAX, R - 6));
      this.limitGroup.style.display = limit === null ? "none" : "";
      this.limitText.textContent = limit === null ? "" : String(limit);
    }
    this.kindText.textContent = kind ? t(KIND_LABEL[kind]) : "";
  }
}
