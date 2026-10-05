import { bindText, setI18nText, t, type MessageKey } from "../i18n";
import { savedStart, saveStart } from "./titlePrefs";

/**
 * Where the game starts: the default (東京駅 丸の内), a station chosen on the start screen
 * (`?start=lat,lon`), or the browser's position (`?start=here`). The position itself is kept in
 * sessionStorage, not the URL, so a shared or bookmarked link never carries it.
 *
 * `label` is a function so the name follows a language switch: our own names are i18n keys, a
 * station keeps its name as the data has it (Japanese; place names are phase 2 of the i18n).
 */
export type StartPoint = { lat: number; lon: number; yaw: number; label: () => string };
export type Station = { name: string; ward: string; lat: number; lon: number };

/**
 * Landmarks to start beside, at the tower itself: the car is put on the nearest street around it
 * (main.ts placeOnStreet), as with a station. `name` as the landmark data has it; `key` is the
 * name shown, in the language in force (the towers have well-known English and Chinese names,
 * unlike most stations).
 */
export const START_LANDMARKS: ReadonlyArray<Station & { key: MessageKey }> = [
  { name: "東京タワー", key: "start.towerTokyo", ward: "港区", lat: 35.658581, lon: 139.745433 },
  { name: "東京スカイツリー", key: "start.towerSkytree", ward: "墨田区", lat: 35.710063, lon: 139.8107 },
];

// The game's data covers the 23 wards (same box as the data pipeline).
const BOUNDS = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
const HERE_KEY = "tokyo-od-game:start-here";
const inBounds = (lat: number, lon: number) =>
  lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;

/** The start asked for: the URL's ?start= (a link, a reproduction), else the one chosen last time. */
function askedStart(): string {
  return new URLSearchParams(location.search).get("start") ?? savedStart() ?? "";
}

export function readStart(fallback: StartPoint, stations: Station[]): StartPoint {
  const raw = askedStart();
  if (!raw) return fallback;
  if (raw === "here") {
    try {
      const saved = JSON.parse(sessionStorage.getItem(HERE_KEY) ?? "null") as {
        lat: number;
        lon: number;
      } | null;
      if (saved && inBounds(saved.lat, saved.lon))
        return { ...saved, yaw: fallback.yaw, label: () => t("start.here") };
    } catch {
      // storage blocked or corrupt: fall through to the default
    }
    return fallback;
  }
  const [lat, lon] = raw.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBounds(lat, lon)) return fallback;
  const isAt = (s: Station) => Math.abs(s.lat - lat) < 1e-5 && Math.abs(s.lon - lon) < 1e-5;
  const landmark = START_LANDMARKS.find(isAt);
  if (landmark) return { lat, lon, yaw: fallback.yaw, label: () => t(landmark.key) };
  const station = stations.find(isAt);
  // Station names in the data already end in 駅.
  const label = station ? () => station.name : () => t("start.picked");
  return { lat, lon, yaw: fallback.yaw, label };
}

/** Reload the page starting at `value` ("" = default, "here", or "lat,lon"). */
function go(value: string): void {
  saveStart(value);
  const url = new URL(location.href);
  if (value) url.searchParams.set("start", value);
  else url.searchParams.delete("start");
  location.assign(url);
}

/** Fills the start-screen picker; choosing an entry reloads the page at that place. */
export function initStartPicker(
  select: HTMLSelectElement,
  note: HTMLElement,
  stations: Station[],
  current: StartPoint,
): void {
  const option = (value: string, text: string, parent: HTMLElement = select) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    parent.append(o);
    return o;
  };
  setI18nText(option("", ""), "start.defaultOption");
  setI18nText(option("here", ""), "start.hereOption");
  for (const l of START_LANDMARKS) setI18nText(option(`${l.lat},${l.lon}`, ""), l.key);
  const byWard = new Map<string, Station[]>();
  for (const s of stations) byWard.set(s.ward, [...(byWard.get(s.ward) ?? []), s]);
  for (const ward of [...byWard.keys()].toSorted((a, b) => a.localeCompare(b, "ja"))) {
    const group = document.createElement("optgroup");
    group.label = ward;
    for (const s of (byWard.get(ward) ?? []).toSorted((a, b) => a.name.localeCompare(b.name, "ja")))
      option(`${s.lat},${s.lon}`, s.name, group);
    select.append(group);
  }
  const param = askedStart();
  select.value = [...select.options].some((o) => o.value === param) ? param : "";
  bindText(note, () => t("start.current", { place: current.label() }));

  select.addEventListener("change", () => {
    if (select.value !== "here") {
      go(select.value);
      return;
    }
    if (!("geolocation" in navigator)) {
      bindText(note, () => t("start.noGeolocation"));
      return;
    }
    bindText(note, () => t("start.locating"));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!inBounds(coords.latitude, coords.longitude)) {
          bindText(note, () => t("start.outside"));
          select.value = param;
          return;
        }
        try {
          sessionStorage.setItem(HERE_KEY, JSON.stringify({ lat: coords.latitude, lon: coords.longitude }));
        } catch {
          bindText(note, () => t("start.noStorage"));
          return;
        }
        go("here");
      },
      (error) => {
        const isDenied = error.code === error.PERMISSION_DENIED;
        bindText(note, () => t(isDenied ? "start.denied" : "start.failed"));
        select.value = param;
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
