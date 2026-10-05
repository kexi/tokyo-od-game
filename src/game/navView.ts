import type { Vector3 } from "three";
import { getLocale, t } from "../i18n";
import { formatDistance as formatDistanceIn, spokenDistance as spokenDistanceIn } from "../i18n/format";
import { signEnglish, type RouteInfo } from "../world/guidePlan";
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

/** A distance on the panel ("300m" / "300 m" / "300米"): src/i18n/format.ts, re-exported for the nav modules. */
export const formatDistance = (m: number): string => formatDistanceIn(m);
/** A distance read aloud ("300メートル" / "300 meters" / "300米"). */
export const spokenDistance = (m: number): string => spokenDistanceIn(m);

/** The road line's placeholder on a street with no name (道路名なし / Unnamed road / 无名道路). */
export const noRoadName = (): string => t("nav.noRoadName");

/**
 * The street's name as car navigation shows it: 「晴海通り（都道304号）」「国道15号」「外堀通り」.
 * From the OSM route matched to the segment (guidePlan.matchRoutes); without one, the GSI 道路種別
 * ("国道"/"都道") or null. 都道府県道 numbers are read as 都道 inside the 23 wards only (the
 * extract reaches 川崎 and 埼玉, whose 県道 share the numbering scheme).
 *
 * In English the OSM English name as the guide signs print it ("Harumi-dori Ave.", signEnglish) and
 * "Route 15" / "Tokyo Route 304"; a street without an English name keeps its Japanese one. Chinese
 * readers read the Japanese names and numbers (国道15号) as they are.
 */
export function roadLabel(
  info: (Pick<RouteInfo, "cls" | "refs" | "name"> & Partial<Pick<RouteInfo, "nameEn">>) | undefined,
  kind: RoadLine["kind"],
  inWards = true,
): string | null {
  const refs = info?.refs ?? [];
  const isNumbered = info !== undefined && info.cls < 3 && refs.length > 0;
  const numberKey = info?.cls === 0 ? "nav.road.national" : inWards ? "nav.road.metro" : null;
  const numbers = isNumbered && numberKey ? refs.slice(0, 2).map((n) => t(numberKey, { n })) : [];
  const number =
    numbers.length > 1 ? t("nav.road.pair", { a: numbers[0], b: numbers[1] }) : (numbers[0] ?? null);
  const name = roadName(info);
  if (name && number) return t("nav.road.named", { name, number });
  if (name || number) return name ?? number;
  if (kind === "national") return t("nav.road.nationalBare");
  if (kind === "prefectural" && inWards) return t("nav.road.metroBare");
  return null;
}

/** The route's own name, in English when OSM has one and English is in force. */
function roadName(
  info: (Pick<RouteInfo, "name"> & Partial<Pick<RouteInfo, "nameEn">>) | undefined,
): string | null {
  if (!info?.name) return null;
  const isEnglishNamed = getLocale() === "en" && !!info.nameEn?.trim();
  if (!isEnglishNamed) return info.name;
  return signEnglish(info.name, info.nameEn ?? "") || info.name;
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
  const place = o.town || (hasWard ? o.ward : t("nav.here"));
  return {
    state: "idle",
    icon: { kind: "compass", label: o.heading },
    dist: place,
    sub: o.town && hasWard ? o.ward : "",
    words: o.searching
      ? t("nav.searching")
      : t(isWalk ? "nav.headingWalk" : "nav.headingDrive", { dir: o.heading }),
    list: o.junctions
      .slice(0, 3)
      .map((j) => ({ icon: "straight", dist: formatDistance(j.distance), name: j.name })),
    listNote: t("nav.noJunctions"),
    limit: isWalk ? null : o.limit,
    walk: isWalk,
    road: o.road ?? noRoadName(),
    roadKnown: o.road !== null,
    notice: o.notice ? { kind: o.notice.kind, text: o.notice.text } : null,
  };
}
