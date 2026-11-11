/**
 * Where signals go (T3): every distance the OSM extractor (scripts/osm-signals.ts, the census
 * scripts/signal-tags.ts) and TrafficControl use to place junction and 単路 (mid-block) crossing
 * signals, in one place. Metres. None is from a standard: each is the game's rule, with its reason.
 */

/**
 * OSM side: a crossing signal more than this from any car-road junction node is a 単路 one (design
 * 5.3's "交差点から 25 m 以内に節点が無い信号").
 */
export const SIGNAL_JUNCTION_M = 25;

/** Game side: an OSM signal node snaps to a GSI junction node this close (the rule since T0). */
export const SIGNAL_SNAP_M = 25;

/** OSM records of one 単路 crossing (its crossing node and the signal nodes either side) within this. */
export const CROSSING_CLUSTER_M = 30;

/** A JARTIC 横断歩道 this close to a 単路 crossing's OSM nodes may be the one its signal controls. */
export const CROSSING_MATCH_M = 15;

/**
 * …and only on a segment that passes this close to one of those nodes: OSM puts them on the road
 * the crossing crosses, so a side street's crosswalk within CROSSING_MATCH_M is not it.
 */
export const CROSSING_ON_ROAD_M = 8;

/** No 単路 controller this close to a signalled junction's node: that junction's signal governs. */
export const CROSSING_CLEAR_OF_JUNCTION_M = 30;

/**
 * Stop line before a 単路 crossing's middle when JARTIC maps none: the 横断歩道 is 4 m wide
 * (roadSurface.ts) and the line about 2 m short of it. Assumed, not from a standard read.
 */
export const CROSSING_STOP_BACK_M = 4;

/** A JARTIC stop line this far before the crosswalk's middle counts as the crossing's. */
export const CROSSING_STOP_RANGE_M = [2.5, 12] as const;

/** How far beyond the crosswalk's middle a 単路 crossing's vehicle head hangs. */
export const CROSSING_HEAD_BEYOND_M = 3.5;

/**
 * A 単路 crossing's vehicle pole this close to a crosswalk end carries that end's walk head and
 * button: the pole stands CROSSING_HEAD_BEYOND_M past the crosswalk's middle, just behind the kerb.
 */
export const SHARED_POLE_M = 7;

/** A walk light governs a crosswalk whose middle is this close to a signal approach's stop line. */
export const PED_LIGHT_REACH_M = 30;

/**
 * A 単路 crossing's controller lights only its own crosswalks: one whose middle is this close to
 * the spot asked about (other crosswalks within PED_LIGHT_REACH_M, such as a junction corner's, are
 * not its).
 */
export const CROSSING_OWN_CROSSWALK_M = 3;

/** A walker this close to a 押ボタン箱's stand point (from the kerb they cross from) uses it. */
export const BUTTON_STAND_REACH_M = 8;
