import { haversineMeters } from "../geo/ellipsoid";
import type { Place } from "./warp";

type LatLon = { lat: number; lon: number };

/** How far: "350 m" under a kilometre, "1.2 km" from there (rounded first, so never "1000 m"). */
export function distanceText(metres: number): string {
  const tens = Math.round(metres / 10) * 10;
  return tens < 1000 ? `${tens} m` : `${(Math.round(metres / 100) / 10).toFixed(1)} km`;
}

/** The places nearest `from` first (a stable sort: equal distances keep the list's order). */
export function byDistance<T extends LatLon>(places: readonly T[], from: LatLon): T[] {
  return places
    .map((p) => ({ p, d: haversineMeters(from.lat, from.lon, p.lat, p.lon) }))
    .toSorted((a, b) => a.d - b.d)
    .map((x) => x.p);
}

/**
 * One button per place in `list`: the name, then its kind and ward, and how far it is from `from`
 * when given (目的地 shows it; 移動 does not need it). `onPick` gets the place clicked.
 */
export function renderPlaceList(
  list: HTMLElement,
  places: readonly Place[],
  onPick: (place: Place) => void,
  options: { separator: string; from?: LatLon },
): void {
  const { separator, from } = options;
  list.replaceChildren(
    ...places.map((p) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const name = document.createElement("span");
      name.textContent = p.name;
      const kind = document.createElement("span");
      kind.className = "kind";
      const far = from ? distanceText(haversineMeters(from.lat, from.lon, p.lat, p.lon)) : "";
      kind.textContent = [p.kind, p.ward, far].filter(Boolean).join(separator);
      b.append(name, kind);
      b.addEventListener("click", () => onPick(p));
      li.append(b);
      return li;
    }),
  );
}
