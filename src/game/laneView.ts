import type { LaneDirection } from "../world/regulations";

/**
 * レーン案内 in the nav panel, as Japanese car navigation draws it: a box per lane (left lane
 * first) with that lane's painted arrows, the lanes leading the route's way lit blue, and the
 * car's own lane outlined when it is on the approach.
 */
const STEM = "M15 34 L15 ";
const PATHS: Record<LaneDirection, string> = {
  through: "M15 34 L15 6 M9 12 L15 6 L21 12",
  left: "M15 20 Q15 14 9 14 L5 14 M9 10 L5 14 L9 18",
  right: "M15 20 Q15 14 21 14 L25 14 M21 10 L25 14 L21 18",
  slight_left: "M15 22 L8 10 M8 16 L8 10 L14 10",
  slight_right: "M15 22 L22 10 M22 16 L22 10 L16 10",
  reverse: "M15 22 Q15 10 9 10 Q5 10 5 16 L5 22 M2 19 L5 22 L8 19",
};

function laneSvg(set: readonly LaneDirection[], ok: boolean, here: boolean): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 30 38");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.toggle("ok", ok);
  svg.classList.toggle("here", here);
  const stemTop = set.includes("through") ? 6 : 20;
  const parts = [`${STEM}${stemTop}`, ...set.map((d) => PATHS[d])];
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", parts.join(" "));
  svg.append(path);
  return svg;
}

export function renderLanes(
  el: HTMLElement,
  lanes: ReadonlyArray<readonly LaneDirection[]> | null,
  ok: readonly boolean[],
  current: number | null,
): void {
  const key = lanes ? `${JSON.stringify(lanes)}|${ok.join()}|${current}` : "";
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.hidden = !lanes;
  el.replaceChildren(...(lanes ?? []).map((set, i) => laneSvg(set, ok[i] ?? false, current === i)));
}

/** "右側の車線" / "左側の車線" / "中央の車線" for the lanes to take, or null when all will do. */
export function laneAdvice(ok: readonly boolean[]): string | null {
  const idx = ok.flatMap((v, i) => (v ? [i] : []));
  if (idx.length === 0 || idx.length === ok.length) return null;
  const isRight = idx[idx.length - 1] === ok.length - 1;
  const isLeft = idx[0] === 0;
  if (isRight && !isLeft) return "右側の車線";
  if (isLeft && !isRight) return "左側の車線";
  return "中央の車線";
}
