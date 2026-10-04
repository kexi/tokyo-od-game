/**
 * Line icons for つぶやき, drawn for this game on a 24×24 grid: `stroke` paths are outlined,
 * `fill` paths are solid, and `solid` replaces the outline when the icon is active (the tab you are
 * on, a post you liked). Why drawn here: an icon font or a copied set would bring someone else's
 * marks (and a real app's look-alike glyphs) into the game.
 */
type Icon = { stroke?: string; fill?: string; solid?: string };

/** A cog: `teeth` blocks round a ring, as path data. */
function cog(teeth: number): string {
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? 9.6 : 7.4;
    for (const d of [-0.22, 0.22]) {
      const a = ((i + 0.5 + d) / (teeth * 2)) * Math.PI * 2;
      pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`);
    }
  }
  return `M${pts.join("L")}Z M12 8.9a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 1 0 0-6.2Z`;
}

/** A five-pointed star, as path data. */
function star(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 10 : 4.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12.6 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

const HEART =
  "M12 20.2s-7.6-4.5-7.6-10.2A4.2 4.2 0 0 1 12 7.5a4.2 4.2 0 0 1 7.6 2.5c0 5.7-7.6 10.2-7.6 10.2Z";
const HOME = "M4 10.4 12 4.1l8 6.3V20h-5.4v-5.7H9.4V20H4Z";
const BELL = "M6.2 16.4v-5.2a5.8 5.8 0 0 1 11.6 0v5.2l1.7 1.9H4.5Z";
const MAIL = "M3.6 6.2h16.8v11.6H3.6Z";

export const ICONS = {
  reply: {
    stroke:
      "M4.6 6.6A2.6 2.6 0 0 1 7.2 4h9.6a2.6 2.6 0 0 1 2.6 2.6v6.6a2.6 2.6 0 0 1-2.6 2.6h-5.6L7.3 19.3v-3.5h-.1a2.6 2.6 0 0 1-2.6-2.6Z",
  },
  repost: {
    stroke:
      "M5 15.5V9.2a2.2 2.2 0 0 1 2.2-2.2H18M15 4l3 3-3 3M19 8.5v6.3a2.2 2.2 0 0 1-2.2 2.2H6M9 20l-3-3 3-3",
  },
  like: { stroke: HEART, solid: HEART },
  views: { stroke: "M4.5 20h15M6.5 17v-5M11 17V7M15.5 17v-7.5M19.5 17V4.5" },
  bookmark: { stroke: "M6.5 4.2h11v16l-5.5-4-5.5 4Z", solid: "M6.5 4.2h11v16l-5.5-4-5.5 4Z" },
  share: {
    stroke: "M12 15V4.5M7.8 8.5 12 4.3l4.2 4.2M5 13v5.4A1.6 1.6 0 0 0 6.6 20h10.8a1.6 1.6 0 0 0 1.6-1.6V13",
  },
  back: { stroke: "M19 12H5.5M11.5 5.5 5 12l6.5 6.5" },
  more: {
    fill: "M5.3 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0ZM10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0ZM15.7 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z",
  },
  home: { stroke: HOME, solid: HOME },
  search: {
    stroke: "M10.8 4.3a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13ZM15.6 15.6 20.2 20.2",
  },
  bell: { stroke: `${BELL}M9.8 20.6a2.3 2.3 0 0 0 4.4 0`, solid: `${BELL}M9.8 20.6a2.3 2.3 0 0 0 4.4 0Z` },
  mail: { stroke: `${MAIL}M3.8 6.6 12 12.4l8.2-5.8`, solid: MAIL },
  plus: { stroke: "M12 5v14M5 12h14" },
  pen: { stroke: "M4.5 19.5 5.6 15 15.8 4.8a2 2 0 0 1 2.9 2.9L8.5 17.9ZM14 6.6l2.9 2.9" },
  gear: { fill: cog(8) },
  star: { fill: star() },
  person: { fill: "M12 3.8a4.2 4.2 0 1 0 0 8.4a4.2 4.2 0 1 0 0-8.4ZM3.8 20.5a8.2 6.6 0 0 1 16.4 0Z" },
  pin: {
    stroke:
      "M12 21s-6.2-5.7-6.2-10.6a6.2 6.2 0 0 1 12.4 0C18.2 15.3 12 21 12 21ZM12 8.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4Z",
  },
  calendar: { stroke: "M4.5 6h15v14h-15ZM4.5 10.2h15M8.5 3.6v4M15.5 3.6v4" },
  play: { fill: "M8 5.2v13.6L19 12Z" },
  close: { stroke: "M6 6l12 12M18 6 6 18" },
  up: { stroke: "M12 19V5.5M6 11.5l6-6 6 6" },
  signal: { fill: "M3 16h2.6v4H3ZM7.4 13h2.6v7H7.4ZM11.8 10h2.6v10h-2.6ZM16.2 6.5h2.6V20h-2.6Z" },
  wifi: {
    stroke: "M3.5 9.6a12.5 12.5 0 0 1 17 0M6.4 12.8a8.3 8.3 0 0 1 11.2 0M9.3 15.9a4.2 4.2 0 0 1 5.4 0",
    fill: "M12 17.4a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3Z",
  },
  battery: { stroke: "M2.8 7.8h16.4v8.4H2.8ZM21.2 10.6v2.8", fill: "M4.6 9.6h10.6v4.8H4.6Z" },
} as const satisfies Record<string, Icon>;

export type IconName = keyof typeof ICONS;

const SVG = "http://www.w3.org/2000/svg";

/** An inline SVG icon in currentColor; `solid` swaps in the filled form where there is one. */
export function icon(name: IconName, solid = false): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("sns-icon", `sns-icon-${name}`);
  const def: Icon = ICONS[name];
  const path = (d: string, filled: boolean) => {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", filled ? "currentColor" : "none");
    if (!filled) {
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "1.8");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
    }
    svg.append(p);
  };
  const isSolid = solid && def.solid !== undefined;
  if (isSolid && def.solid) path(def.solid, true);
  if (!isSolid && def.stroke) path(def.stroke, false);
  if (def.fill) path(def.fill, true);
  // The open envelope's flap stays visible on the filled form, cut in the background colour.
  if (isSolid && name === "mail") {
    path("M3.8 6.6 12 12.4l8.2-5.8", false);
    svg.lastElementChild?.setAttribute("stroke", "var(--sns-bg, #000)");
  }
  return svg;
}

/** An SVG of a single path (the logo, the badge) in a 24×24 box. */
export function pathIcon(d: string, className: string, extra?: { d: string; stroke: string }): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(className);
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "currentColor");
  p.setAttribute("fill-rule", "evenodd");
  svg.append(p);
  if (extra) {
    const t = document.createElementNS(SVG, "path");
    t.setAttribute("d", extra.d);
    t.setAttribute("fill", "none");
    t.setAttribute("stroke", extra.stroke);
    t.setAttribute("stroke-width", "2.2");
    t.setAttribute("stroke-linecap", "round");
    t.setAttribute("stroke-linejoin", "round");
    svg.append(t);
  }
  return svg;
}
