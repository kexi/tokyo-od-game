import type { Vector3 } from "three";
import type { RouteInfo } from "../world/guidePlan";
import type { RoadLine } from "../world/roads";
import type { TravelMode, Turn } from "./navigation";
import type { Notice, NoticeKind } from "./navNotices";

/**
 * What the nav panel shows, whatever the state: the same slots in the same fixed box (picture,
 * main line, list, road line, notice line), so switching between turn guidance, 直進案内, 道なり,
 * walking and the current location changes the content only, never the size.
 */
export type NavIcon = { kind: "arrow"; turn: Turn } | { kind: "goal" } | { kind: "compass"; label: string };
export type NavListItem = { icon: Turn | "goal"; dist: string; name: string };
export type NavView = {
  state: "turn" | "straight" | "follow" | "arrive" | "idle";
  icon: NavIcon;
  /** The big line: the distance, or the town where there is nothing to guide. */
  dist: string;
  /** Beside the big line: the distance to the goal, or the ward. */
  sub: string;
  /** The second line: what to do there, or the heading. */
  words: string;
  list: NavListItem[];
  /** Said in the list's place when it is empty. */
  listNote: string;
  /** Limit in force (km/h), null when unknown; not shown on foot. */
  limit: number | null;
  walk: boolean;
  road: string;
  /** False when `road` is the placeholder (shown dimmed). */
  roadKnown: boolean;
  notice: { kind: NoticeKind; text: string } | null;
};

export const formatDistance = (m: number): string =>
  Math.round(m / 10) * 10 >= 1000
    ? `${(m / 1000).toFixed(1)}km`
    : `${Math.max(10, Math.round(m / 10) * 10)}m`;
export const spokenDistance = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(1)}キロ` : `${Math.max(10, Math.round(m / 10) * 10)}メートル`;

export const NO_ROAD_NAME = "道路名なし";

/**
 * The street's name as car navigation shows it: 「晴海通り（都道304号）」「国道15号」「外堀通り」.
 * From the OSM route matched to the segment (guidePlan.matchRoutes); without one, the GSI 道路種別
 * ("国道"/"都道") or null. 都道府県道 numbers are read as 都道 inside the 23 wards only (the
 * extract reaches 川崎 and 埼玉, whose 県道 share the numbering scheme).
 */
export function roadLabel(
  info: Pick<RouteInfo, "cls" | "refs" | "name"> | undefined,
  kind: RoadLine["kind"],
  inWards = true,
): string | null {
  const refs = info?.refs ?? [];
  const isNumbered = info !== undefined && info.cls < 3 && refs.length > 0;
  const prefix = info?.cls === 0 ? "国道" : inWards ? "都道" : null;
  const number =
    isNumbered && prefix
      ? refs
          .slice(0, 2)
          .map((r) => `${prefix}${r}号`)
          .join("・")
      : null;
  const name = info?.name ? info.name : null;
  if (name && number) return `${name}（${number}）`;
  if (name || number) return name ?? number;
  if (kind === "national") return "国道";
  if (kind === "prefectural" && inWards) return "都道";
  return null;
}

/** Heading of a ground direction: radians, 0 = north, clockwise (x east, z south). */
export const headingOf = (forward: Vector3): number => Math.atan2(forward.x, -forward.z);

/**
 * The panel with nothing to guide (no mission, arrived, no route found): where the player is (town
 * and ward), the way they head, the named junctions coming up on the street followed, the street's
 * name and limit, and the notices on it.
 */
export function idleView(o: {
  ward: string;
  town: string;
  road: string | null;
  heading: string;
  limit: number | null;
  mode: TravelMode;
  junctions: ReadonlyArray<{ distance: number; name: string }>;
  notice: Pick<Notice, "kind" | "text"> | null;
  /** A target exists but no route yet (loading the streets, or none reaches it). */
  searching?: boolean;
}): NavView {
  const hasWard = o.ward !== "" && o.ward !== "—";
  const isWalk = o.mode === "walk";
  const place = o.town || (hasWard ? o.ward : "現在地");
  return {
    state: "idle",
    icon: { kind: "compass", label: o.heading },
    dist: place,
    sub: o.town && hasWard ? o.ward : "",
    words: o.searching ? "ルートを探索しています" : `${o.heading}へ${isWalk ? "歩行中" : "進行中"}`,
    list: o.junctions
      .slice(0, 3)
      .map((j) => ({ icon: "straight", dist: formatDistance(j.distance), name: j.name })),
    listNote: "この先の交差点名はありません",
    limit: isWalk ? null : o.limit,
    walk: isWalk,
    road: o.road ?? NO_ROAD_NAME,
    roadKnown: o.road !== null,
    notice: o.notice ? { kind: o.notice.kind, text: o.notice.text } : null,
  };
}
