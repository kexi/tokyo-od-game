/**
 * Where the game starts: the default (東京駅 丸の内), a station chosen on the start screen
 * (`?start=lat,lon`), or the browser's position (`?start=here`). The position itself is kept in
 * sessionStorage, not the URL, so a shared or bookmarked link never carries it.
 */
export type StartPoint = { lat: number; lon: number; yaw: number; label: string };
export type Station = { name: string; ward: string; lat: number; lon: number };

// The game's data covers the 23 wards (same box as the data pipeline).
const BOUNDS = { minLat: 35.48, maxLat: 35.84, minLon: 139.55, maxLon: 139.93 };
const HERE_KEY = "tokyo-od-game:start-here";
const inBounds = (lat: number, lon: number) =>
  lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;

export function readStart(fallback: StartPoint, stations: Station[]): StartPoint {
  const raw = new URLSearchParams(location.search).get("start");
  if (!raw) return fallback;
  if (raw === "here") {
    try {
      const saved = JSON.parse(sessionStorage.getItem(HERE_KEY) ?? "null") as {
        lat: number;
        lon: number;
      } | null;
      if (saved && inBounds(saved.lat, saved.lon)) return { ...saved, yaw: fallback.yaw, label: "現在地" };
    } catch {
      // storage blocked or corrupt: fall through to the default
    }
    return fallback;
  }
  const [lat, lon] = raw.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBounds(lat, lon)) return fallback;
  const station = stations.find((s) => Math.abs(s.lat - lat) < 1e-5 && Math.abs(s.lon - lon) < 1e-5);
  // Station names in the data already end in 駅.
  return { lat, lon, yaw: fallback.yaw, label: station ? station.name : "指定地点" };
}

/** Reload the page starting at `value` ("" = default, "here", or "lat,lon"). */
function go(value: string): void {
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
  option("", "東京駅 丸の内（既定）");
  option("here", "現在地（ブラウザの位置情報）");
  const byWard = new Map<string, Station[]>();
  for (const s of stations) byWard.set(s.ward, [...(byWard.get(s.ward) ?? []), s]);
  for (const ward of [...byWard.keys()].toSorted((a, b) => a.localeCompare(b, "ja"))) {
    const group = document.createElement("optgroup");
    group.label = ward;
    for (const s of (byWard.get(ward) ?? []).toSorted((a, b) => a.name.localeCompare(b.name, "ja")))
      option(`${s.lat},${s.lon}`, s.name, group);
    select.append(group);
  }
  const param = new URLSearchParams(location.search).get("start") ?? "";
  select.value = [...select.options].some((o) => o.value === param) ? param : "";
  note.textContent = `いまのスタート地点: ${current.label}`;

  select.addEventListener("change", () => {
    if (select.value !== "here") {
      go(select.value);
      return;
    }
    if (!("geolocation" in navigator)) {
      note.textContent = "このブラウザでは位置情報が使えません";
      return;
    }
    note.textContent = "位置情報を取得中…";
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!inBounds(coords.latitude, coords.longitude)) {
          note.textContent = "現在地が東京 23 区の外のため、ここからは始められません";
          select.value = param;
          return;
        }
        try {
          sessionStorage.setItem(HERE_KEY, JSON.stringify({ lat: coords.latitude, lon: coords.longitude }));
        } catch {
          note.textContent = "ブラウザの設定で保存できないため、現在地から始められません";
          return;
        }
        go("here");
      },
      (error) => {
        note.textContent =
          error.code === error.PERMISSION_DENIED
            ? "位置情報の利用が許可されませんでした"
            : "位置情報を取得できませんでした";
        select.value = param;
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
