# レインボーブリッジの寸法と、道路側に渡すデッキの高さ（landmarks.json の deckLevels）。
#
#   python3 -I scripts/blender/rainbow_bridge_spec.py   # deckLevels を JSON で標準出力へ（bpy 不要）
#
# Pure Python (standard library only, Python 3.11+), so the deck levels can be produced and checked
# without Blender: scripts/blender/rainbow_bridge.py builds the model from these numbers and writes
# deck_levels() into landmarks.json, and tests/rainbowBridge.test.ts runs this file and checks that
# its output is exactly what landmarks.json holds. The schema the road side parses is
# src/world/deckLevels.ts (DECK_LEVELS_VERSION there and here must agree).
#
# Model coordinates: y = T.P. height (baseHeight 0), +Z = s = distance along the bridge axis from
# mid-span toward Odaiba, +X = offset = to the left of +s (the north-east side).
#
# Sources and how sure each number is: knowledge/rainbow-bridge-blender.md.
import json
import math

DECK_LEVELS_VERSION = 1

# ---------------------------------------------------------------------------------------------- dimensions
HEADING = 111.226  # bearing Shibaura tower -> Odaiba tower (OSM tower cross-beam ways 1348279701 / 1348279694)
ORIGIN = (139.7631596, 35.6365730)  # midpoint of the two OSM towers (lon, lat)
MAIN = 570.0  # 中央径間 (tower centre to tower centre)
TOWER_Z = MAIN / 2
SIDE_CABLE = 114.0  # tower to the anchorage's cable entry (798 = 114 + 570 + 114)
SIDE_GIRDER = 111.5  # 支間割 111.5 + 570 + 111.5: the truss ends on the anchorage
GIRDER_END = TOWER_Z + SIDE_GIRDER  # 396.5
TOWER_TOP = 126.0  # T.P.
SADDLE_Y = 123.6  # main cable centre over the saddle (photo: the cable meets the leg ~2.4 m below its top)
PIER_TOP = 4.2  # footing top (photo, at the water line + 4.2 m)
FOOTING_BOTTOM = -6.0  # below the lowest tide (T.P. −1.35 m) with margin, so no gap shows at low water
CLEAR_MID = 51.266  # 桁下 T.P. at mid-span (Wikipedia ja, 『橋梁』1991)
CLEAR_TOWER = 49.4  # 桁下 at the towers (photo, south view from Odaiba)
K_CREST = (CLEAR_MID - CLEAR_TOWER) / TOWER_Z**2  # crest vertical curve, R = 1 / (2K) ≈ 21.8 km
TRUSS_X = 14.5  # main truss planes (chord centres): 29.0 m apart = 幅員 29.0 m read as the truss spacing
CHORD_W, CHORD_H = 1.0, 1.2
TRUSS_DEPTH = 9.0  # bottom chord centre to top chord centre (photos: 8.3 m from the south, 9.6 m from Shibaura)
LOWER_SURFACE = 2.0  # lower road surface above the girder's underside (桁下)
UPPER_SURFACE = 10.4  # upper road surface above the girder underside (deck plate on the top chord)
LEG_X = 17.2  # tower leg centre (OSM 16.2 m; moved out so the truss clears the legs' inner faces)
LEG_ALONG, LEG_ACROSS = 5.0, 4.0  # leg section at the base (OSM 5.0 × 4.8 m), tapering to 4.2 × 3.4 m
CABLE_X = 15.5  # cable plane at the towers (over the legs' inner half)
CABLE_X_ANCHOR = 19.0  # the cable splays into the anchorage's cable housing
CABLE_D = 0.76  # 127 strands × 127 wires (≈ 16,100 × Ø 5.37 mm assumed, void 20 %) -> Ø ≈ 0.76 m
MAIN_PANELS = 60  # 9.5 m panels (photo count is approximate)
SIDE_PANELS = 12  # 9.29 m panels
ANCHOR_FRONT = 394.0  # anchorage face toward the tower (OSM, 109.5 m from the tower)
ANCHOR_BACK = 463.0
ANCHOR_HALF = 22.7
HOUSING_X = (15.5, ANCHOR_HALF)  # the two cable housings at the outer sides (OSM tier 45–60 m)
HOUSING_TOP = 58.0  # their top at the face toward the tower: level with the upper deck railing (photos)
STRUT_LOW = (27.0, 31.0)  # lower strut between the legs (OSM pylon part 27–31 m; night photo)
INNER = TRUSS_X - CHORD_W / 2  # 14.0: inner face of the chords
BARRIER_FACE = 13.8  # inner face of the outer barriers on both floors (barriers stand on the chords)
WARP_AT = (139.7560316, 35.6391198)  # なぎさ通り on Shibaura (OSM way 1030669190), ~300 m from the anchorage


def girder_bottom(z):
    """桁下 (T.P.) along the bridge: a crest vertical curve through 51.266 m at mid-span."""
    return CLEAR_MID - K_CREST * z * z


def lower_surface(z):
    return girder_bottom(z) + LOWER_SURFACE


def upper_surface(z):
    return girder_bottom(z) + UPPER_SURFACE


def bearing_top():
    """Top of the anchorage's middle block, where the truss ends rest."""
    return girder_bottom(GIRDER_END) - 0.2


def main_cable_y(z):
    """Main span cable centre: a parabola from the saddles down to just above the top chord at mid-span."""
    low = girder_bottom(0.0) + CHORD_H / 2 + TRUSS_DEPTH + CHORD_H / 2 + 1.0 + CABLE_D / 2
    return low + (SADDLE_Y - low) * (z / TOWER_Z) ** 2


MAIN_SAG = SADDLE_Y - main_cable_y(0.0)
ANCHOR_ENTRY_Y = 56.5  # cable enters the housing just under the top of its front face
# Equal horizontal tension in all spans: side-span sag = main sag × (114 / 570)²
SIDE_SAG = MAIN_SAG * (SIDE_CABLE / MAIN) ** 2


def side_cable(t):
    """Side span cable (x, y, z>0) at t ∈ [0, 1] from the Odaiba saddle to the anchorage entry."""
    z = TOWER_Z + SIDE_CABLE * t
    y = SADDLE_Y + (ANCHOR_ENTRY_Y - SADDLE_Y) * t - 4 * SIDE_SAG * t * (1 - t)
    x = CABLE_X + (CABLE_X_ANCHOR - CABLE_X) * t * t
    return x, y, z


def side_cable_at_z(z):
    t = (abs(z) - TOWER_Z) / SIDE_CABLE
    return side_cable(t)


# ---------------------------------------------------------------------------------------------- geo
# The same flat-earth conversion as scripts/blender/landmarks.py (model_to_lonlat), so the deck
# levels and the model are placed by one formula.
M_LAT = 110_540.0


def model_to_lonlat(origin, heading_deg, x, z):
    """Model (x, z) -> lon/lat; +Z points to `heading_deg` (bearing), +X is 90° to its left."""
    h = math.radians(heading_deg)
    east = z * math.sin(h) - x * math.cos(h)
    north = z * math.cos(h) + x * math.sin(h)
    return origin[0] + east / (111_320.0 * math.cos(math.radians(origin[1]))), origin[1] + north / M_LAT


# ---------------------------------------------------------------------------------------------- cross-sections
# Strips across each floor, from the south-west barrier (−13.8) to the north-east one (+13.8), left
# to right looking toward Odaiba; contiguous, so their widths add up to betweenOuterBarriers.
# Offsets are fitted to the OSM ways on the bridge projected on the axis (motorway 316305907/8 at
# −6.1/+4.9, port road 316305913/4848879 at −10.3/+8.8, ゆりかもめ 749205417/275936305 at −2.2/+0.8,
# promenades 508040811/2 at −14.1/+12.8: on average 0.68 m to the south-west of the towers' axis, see
# OSM_BIAS). Lane widths, shoulders, median and verges are assumed, not published values.
CROSSFALL = 0.02  # carriageways fall 2 % toward their outer edge (assumed)


def mirror(strips):
    """North-east half (from offset 0 outward) -> the whole floor, south-west half mirrored."""
    out = []
    for s in reversed(strips):
        m = {**s, "from": -s["to"], "to": -s["from"]}
        if m.get("direction") == "forward":
            m["direction"] = "backward"
            m["osmWays"] = s["osmWaysBackward"]
        if "osmWaysBackward" in m:
            del m["osmWaysBackward"]
        if s.get("name") == "north":
            m["name"] = "south"
            m["osmWays"] = s["osmWaysSouth"]
        m.pop("osmWaysSouth", None)
        out.append(m)
    for s in strips:
        m = {k: v for k, v in s.items() if k not in ("osmWaysBackward", "osmWaysSouth")}
        out.append(m)
    # the strip that straddles the axis was written twice (−to..to and from 0): keep one, whole
    merged = []
    for s in out:
        if merged and merged[-1]["kind"] == s["kind"] and merged[-1]["to"] == s["from"] == 0.0:
            merged[-1] = {**merged[-1], "to": s["to"]}
        else:
            merged.append(s)
    return merged


def carriageway(use, lanes, lane_width, start, osm_forward, osm_backward):
    return {
        "kind": "carriageway",
        "use": use,
        "direction": "forward",
        "from": start,
        "to": round(start + lanes * lane_width, 3),
        "lanes": lanes,
        "laneWidth": lane_width,
        "crossfall": CROSSFALL,
        "crossfallDown": "outer",
        "osmWays": osm_forward,
        "osmWaysBackward": osm_backward,
    }


UPPER_STRIPS = mirror(
    [
        {"kind": "median", "from": 0.0, "to": 1.0},
        {"kind": "shoulder", "from": 1.0, "to": 2.0},
        carriageway("expressway", 2, 3.5, 2.0, [316305908], [316305907]),
        {"kind": "shoulder", "from": 9.0, "to": 11.5},
        {"kind": "verge", "from": 11.5, "to": BARRIER_FACE},
    ]
)
LOWER_STRIPS = mirror(
    [
        {"kind": "guideway", "use": "transit", "from": 0.0, "to": 4.0, "osmWays": [275936305, 749205417]},
        {"kind": "barrier", "from": 4.0, "to": 4.4},
        {"kind": "shoulder", "from": 4.4, "to": 4.9},
        carriageway("localRoad", 2, 3.25, 4.9, [4848879], [316305913]),
        {"kind": "shoulder", "from": 11.4, "to": 11.9},
        {"kind": "barrier", "from": 11.9, "to": 12.2},
        {
            "kind": "walkway",
            "name": "north",
            "from": 12.2,
            "to": BARRIER_FACE,
            "osmWays": [508040812],
            "osmWaysSouth": [508040811],
        },
    ]
)
OSM_BIAS = -0.68  # mean of the four OSM pairs' centres: (−6.1+4.9)/2, (−10.3+8.8)/2, (−2.2+0.8)/2, (−14.1+12.8)/2


# ---------------------------------------------------------------------------------------------- deck levels
def station_list():
    """s of the stations: the girder every ~23.3 m (one on the crest), then over each anchorage to its back."""
    n = 2 * round(GIRDER_END / 24.0)
    girder = [-GIRDER_END + 2 * GIRDER_END * k / n for k in range(n + 1)]
    m = 3
    over = [GIRDER_END + (ANCHOR_BACK - GIRDER_END) * k / m for k in range(1, m + 1)]
    return [-z for z in reversed(over)] + girder + over


def deck_levels():
    """landmarks.json `deckLevels` (schema: src/world/deckLevels.ts)."""

    def stations(above):
        out = []
        for s in station_list():
            lon, lat = model_to_lonlat(ORIGIN, HEADING, 0.0, s)
            out.append(
                {
                    "s": round(s, 3),
                    "lon": round(lon, 7),
                    "lat": round(lat, 7),
                    "h": round(girder_bottom(s) + above, 3),
                    "grade": round(-2 * K_CREST * s, 5) + 0.0,  # + 0.0: no "-0.0" on the crest
                    "segment": "girder" if abs(s) <= GIRDER_END + 1e-9 else "anchorage",
                }
            )
        return out

    end_grade = round(2 * K_CREST * ANCHOR_BACK, 5)
    girder_end_grade = round(2 * K_CREST * GIRDER_END, 5)
    return {
        "version": DECK_LEVELS_VERSION,
        "datum": {"horizontal": "WGS84", "vertical": "TP"},
        "axis": {
            "origin": [ORIGIN[0], ORIGIN[1]],
            "bearing": HEADING,
            "sRange": [-ANCHOR_BACK, ANCHOR_BACK],
            "girderRange": [-GIRDER_END, GIRDER_END],
            "pierFreeRange": [-ANCHOR_BACK, ANCHOR_BACK],
        },
        "profile": {
            "kind": "parabola",
            "undersideAtMid": CLEAR_MID,
            "k": round(K_CREST, 10),
            "aboveUnderside": {"upper": UPPER_SURFACE, "lower": LOWER_SURFACE},
            "endGrades": {"start": end_grade, "end": -end_grade},
            "girderEndGrades": {"start": girder_end_grade, "end": -girder_end_grade},
        },
        "tolerance": {"horizontal": 3.0, "vertical": 1.5},
        "osmBias": {"meanOffset": OSM_BIAS, "decision": "recorded"},
        "anchorages": [
            {
                "sFrom": sign * ANCHOR_FRONT if sign > 0 else -ANCHOR_BACK,
                "sTo": ANCHOR_BACK if sign > 0 else -ANCHOR_FRONT,
                "clearHalfWidth": HOUSING_X[0],
                "bearingTop": round(bearing_top(), 3),
                "housingTop": HOUSING_TOP,
            }
            for sign in (-1, 1)
        ],
        "levels": {
            "upper": {
                "betweenOuterBarriers": 2 * BARRIER_FACE,
                "strips": UPPER_STRIPS,
                "stations": stations(UPPER_SURFACE),
            },
            "lower": {
                "betweenOuterBarriers": 2 * BARRIER_FACE,
                "strips": LOWER_STRIPS,
                "stations": stations(LOWER_SURFACE),
            },
        },
    }


if __name__ == "__main__":
    print(json.dumps(deck_levels(), ensure_ascii=False, indent=2))
