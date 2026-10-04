import { JMA } from "../config";
import { warn } from "../log";
import type { Observation } from "./environment";

type AmedasValue = [number | null, number] | undefined;

/** Latest 10-minute AMeDAS observation at Tokyo (Kitanomaru). JMA serves these with CORS `*`. */
export async function fetchTokyoObservation(): Promise<Observation | null> {
  try {
    const latest = (await (await fetch(JMA.latestTime)).text()).trim();
    const stamp = latest.slice(0, 19).replace(/[-T:]/g, "");
    const map = (await (await fetch(JMA.map(stamp))).json()) as Record<string, Record<string, AmedasValue>>;
    const s = map[JMA.tokyoStation];
    if (!s) return null;
    const value = (v: AmedasValue) => (v && v[0] !== null ? v[0] : null);
    return {
      temp: value(s.temp),
      precip10m: value(s.precipitation10m),
      wind: value(s.wind),
      time: latest.slice(11, 16),
    };
  } catch (error) {
    warn("amedas_fetch_failed", { error: String(error) });
    return null;
  }
}
