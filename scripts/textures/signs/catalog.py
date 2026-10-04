"""The sign catalogue: which texture draws which 別表第一 number, on which plate, at what size.

`textures()` lists every PNG the generator writes (with the function that draws it);
`build(...)` joins that with law_table.SIGNS into assets/signs/catalog.json, one entry per
番号 including the ones that are not drawn (texture null and a reason).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image

from . import auxiliary as A
from . import instruction as S
from . import lanes as L
from . import nonstatutory as N
from . import regulatory as R
from . import warning as K
from .law_table import FIGURE_URL, LAW_URL, SIGNS

KIJUN_URL = A.SIZE_SOURCE
MLIT_LIST_URL = "https://www.mlit.go.jp/road/sign/sign/douro/ichiran.pdf"


@dataclass
class Tex:
    file: str
    sign: str
    draw: Callable[[], Image.Image] | None  # None: drawn by the first generator (sign_textures.py)
    variant: str | None = None
    size_mm: tuple[float, float] | None = None  # the plate box the texture covers; None = plate default
    plate_node: str | None = None  # None = the sign's plate


@dataclass
class Meta:
    plate: str  # circle | triangle_down | diamond | square | rect | pentagon
    plate_node: str
    size_mm: tuple[float, float]
    variable: str | None = None  # "lanes" | "text" | None
    note: str | None = None
    sources: list[str] = field(default_factory=list)


def slug(sign_id: str) -> str:
    """「327の7-A」 → "327-7a", 「503-A」 → "503a", 「208の2」 → "208-2"."""
    return re.sub(r"-([A-Z])$", lambda m: m.group(1).lower(), sign_id.replace("の", "-")).lower()


# ----------------------------------------------------------------------
# Plates and sizes (別表第二; 補助 sizes from 交通規制基準)
# ----------------------------------------------------------------------
CIRCLE = ("circle", "PlateCircle", (600.0, 600.0))
SQUARE = ("square", "PlateSquare", (600.0, 600.0))
SQUARE90 = ("square", "PlateSquare90", (900.0, 900.0))
TRI = ("triangle_down", "PlateTriangle", (800.0, 692.8))
DIAMOND = ("diamond", "PlateDiamond", (450.0, 450.0))
PENTA = ("pentagon", "PlatePentagon", (600.0, 719.6))


def _aux(h: float) -> tuple[str, str, tuple[float, float]]:
    return ("rect", f"PlateAux60x{round(h / 10)}", (600.0, h))


def meta_for(sign_id: str, group: str) -> Meta | None:
    if group == "警戒":
        return Meta(*DIAMOND)
    if group == "規制":
        rect = {
            "326-A": ("rect", "PlateWide", (600.0, 350.0)),
            "326の2-A": ("rect", "PlateWide", (600.0, 350.0)),
            "326-B": ("rect", "PlateRect", (350.0, 600.0)),
            "326の2-B": ("rect", "PlateRect", (350.0, 600.0)),
            "327": ("rect", "PlateRect120x90", (1200.0, 900.0)),
            "327の2": ("rect", "PlateRect120x90", (1200.0, 900.0)),
            "327の3": SQUARE90,
            "327の4": SQUARE90,
            "327の4の2": SQUARE,
            "327の5": SQUARE90,
            "327の6": SQUARE90,
            "327の7-A": ("rect", "PlateRect120x90", (1200.0, 900.0)),
            "327の7-B": SQUARE90,
            "327の7-C": SQUARE90,
            "327の7-D": SQUARE90,
            "327の11": SQUARE,
            "327の12": SQUARE,
            "327の13": SQUARE,
            "331": SQUARE,
            "332": SQUARE,
        }
        if sign_id in rect:
            m = Meta(*rect[sign_id])
        elif sign_id.startswith(("329", "330")):
            m = Meta(*TRI)
        else:
            m = Meta(*CIRCLE)
        if sign_id == "327の10":
            m.size_mm = (600.0, 600.0)
        return m
    if group == "指示":
        if sign_id.startswith("407"):
            return Meta(*PENTA)
        if sign_id == "409-A":
            return Meta("rect", "PlateRect60x90", (600.0, 900.0))
        if sign_id == "409-B":
            return Meta("rect", "PlateRect90x60", (900.0, 600.0))
        return Meta(*SQUARE)
    if group == "補助":
        if sign_id == "507-C":
            return Meta("circle", "PlateCircle40", (400.0, 400.0))
        h = {
            "503-B": 250.0,
            "503-C": 380.0,
            "504の2": 320.0,
            "505-A": 180.0,
            "505-C": 320.0,
            "506": 180.0,
            "507-A": 180.0,
            "507-D": 320.0,
            "511": 440.0,
            "512": 320.0,
        }.get(sign_id, 220.0)
        return Meta(*_aux(h))
    return None


# Signs whose value is chosen per installation (図示の文字・記号は例示, 備考一(一)1 / 二(一)1).
VARIABLE_TEXT = {
    "212の3",
    "212の4",
    "310",
    "315",
    "316",
    "317",
    "318",
    "320",
    "321",
    "322",
    "323",
    "323の2",
    "324",
    "327",
    "409-A",
    "409-B",
    "501",
    "502",
    "503-A",
    "503-B",
    "503-C",
    "503の2",
    "504",
    "510",
    "510の2",
    "511",
    "512",
}
VARIABLE_LANES = {"327の7-A", "327の7-B", "327の7-C", "327の7-D", "327の4", "327の5"}

NOTES = {
    "302": "図 122 は赤の環と斜めの帯（2026-10-04 に帯の無い旧テクスチャを訂正）",
    "305の2": "305 と同じ標示板に補助標識 503-C を附置する（備考一(一)34）",
    "314の2": "314 と同じ標示板に補助標識 508の2 を附置する（備考一(一)34）",
    "317": "316 と同じ標示板に補助標識 504 を附置する（備考一(一)34）",
    "323の2": "323 と同じ標示板に補助標識 503-A を附置する（備考一(一)34）",
    "328の2": "328 と同じ標示板に補助標識 505-A・B、506 又は 507-B・C を附置する（備考一(一)34）",
    "329の2-A": "329-A と同じ標示板に補助標識 509 を附置する（備考一(一)34）",
    "329の2-B": "329-B と同じ標示板に補助標識 509 を附置する（備考一(一)34）",
    "402の2": "403 と同じ標示板に補助標識 503-D を附置する（備考一(一)34）",
    "403の2": "404 と同じ標示板に補助標識 503-D を附置する（備考一(一)34）",
    "326-A": "図 155 は矢印のみ。既存テクスチャは矢印の軸に「一方通行」を青字で入れた実務上の表示（図示は例示）",
    "407-A": (
        "現行の様式は青の五角形に白の記号（図 191）。旧 crosswalk.png（青の正方形に白の三角）"
        "は様式外として variants に残す"
    ),
    "331": "図に外形寸法の記載がないため規制標識の標準 60 cm の正方形とした",
    "332": "図に外形寸法の記載がないため規制標識の標準 60 cm の正方形とした。「わたるな」の表示も可（備考一(一)40）",
    "327の5": (
        "図示の記号は例示の対象（備考一(一)1）に含まれない。車線ごとの版は 327の4・327の7 の例示に倣った実務上の表示"
    ),
    "503-C": "図に寸法の記載がなく、交通規制基準にも例が無いため図の縦横比から 60 × 38 cm とした",
}


# ----------------------------------------------------------------------
# Textures
# ----------------------------------------------------------------------
def _lane_variants() -> list[tuple[str, list]]:
    """Lane lists to pre-render: the 図示 ones, every assumed pattern the game derives
    (assumedLanes, 1–6 lanes × exits), every OSM turn:lanes value in public/data/turnlanes, and
    the 専用 / 優先 per-lane examples."""
    out: dict[str, list] = {}

    def add(lanes) -> None:
        out.setdefault(L.slug(lanes), lanes)

    for v in ("left;through|through|right", "left;through", "left", "through"):
        add(v)
    for n in range(1, 7):
        for exits in (
            {"through"},
            {"left", "through"},
            {"through", "right"},
            {"left", "through", "right"},
            {"left", "right"},
            {"left"},
            {"right"},
        ):
            add(L.assumed_lanes(n, exits))
    data = Path(__file__).resolve().parents[3] / "public" / "data" / "turnlanes"
    for path in sorted(data.glob("*.json")):
        for row in json.loads(path.read_text()):
            add(row[3])
    for v in (
        [{"dirs": "left;through", "use": "bus"}, "through", "right"],
        [{"dirs": "left;through", "use": "bus_priority"}, "through", "right"],
        [{"dirs": "left;through", "use": "bus"}, "through", "through", "right"],
        [{"dirs": "left;through", "use": "bus_priority"}, "through", "through", "right"],
        [{"dirs": "through", "use": "bicycle"}, "through", "right"],
    ):
        add(v)
    return list(out.items())


def textures() -> list[Tex]:
    t: list[Tex] = []

    def add(sign: str, draw, variant: str | None = None, file: str | None = None, **kw) -> None:
        name = file or (slug(sign) + (f"_{variant}" if variant else "") + ".png")
        t.append(Tex(name, sign, draw, variant, **kw))

    # 警戒
    add("201-A", K.crossroads)
    add("201-B", K.side_road, "right")
    add("201-B", lambda: K.side_road(True), "left")
    add("201-C", K.t_junction)
    add("201-D", K.y_junction)
    add("201の2", K.rotary)
    for sid, fn in (
        ("202", K.bend),
        ("203", K.sharp_bend),
        ("204", K.reverse_bend),
        ("205", K.reverse_sharp_bend),
        ("206", K.winding),
    ):
        add(sid, fn, "right")
        add(sid, lambda fn=fn: fn(True), "left")
    add("207-A", K.level_crossing)
    add("207-B", lambda: K.level_crossing(True))
    add("208", K.school)
    add("208の2", K.traffic_signal)
    add("208の2", lambda: K.traffic_signal(True), "vertical")
    add("209", K.slippery)
    add("209の2", K.rockfall)
    add("209の2", lambda: K.rockfall(True), "mirror")
    add("209の3", K.bumpy)
    add("210", K.merge)
    add("210", lambda: K.merge(True), "mirror")
    add("211", K.lanes_reduce)
    add("211", lambda: K.lanes_reduce(True), "mirror")
    add("212", K.road_narrows)
    add("212の2", K.two_way)
    add("212の3", K.gradient, "10")
    add("212の4", lambda: K.gradient(False), "10")
    add("213", K.road_works)
    add("214", K.crosswind)
    add("214の2", K.animals)
    add("214の2", lambda: K.animals(True), "mirror")
    add("215", K.danger)

    # 規制
    add("301", R.road_closed)
    add("302", R.vehicles_closed, file="vehicles_closed.png")
    add("303", None, file="no_entry.png")
    add("304", lambda: R.vehicle_closed("car_front", 290))
    add("305", lambda: R.vehicle_closed("truck_side", 310))
    add("306", lambda: R.vehicle_closed("bus_side", 340))
    add("307", lambda: R.vehicle_closed("moped_rider", 300))
    add("308", lambda: R.vehicle_closed("cart", 340))
    add("309", lambda: R.vehicle_closed("bicycle", 375))
    add("310", R.combination_closed)
    add("310", lambda: R.combination_closed(("truck_side", "bus_side")), "truck-bus")
    add("310", lambda: R.combination_closed(("car_front", "bicycle")), "car-bicycle")
    add("310の2", R.two_up_closed)
    add("310の3", R.tyre_chain)
    add("311-A", None, file="turn_3.png")
    add("311-A", None, "right", file="turn_6.png")
    add("311-B", None, file="turn_1.png")
    add("311-B", None, "right", file="turn_4.png")
    add("311-C", None, file="turn_2.png")
    add("311-D", None, file="turn_5.png")
    add("311-E", R.turn_all, file="turn_7.png")
    add("311-F", R.turn_diagonal)
    add("311-F", lambda: R.turn_diagonal(True), "right")
    add("312", R.no_crossing)
    add("313", None, file="no_uturn.png")
    add("314", R.no_overtaking)
    add("315", None, file="no_stopping.png")
    add("315", lambda: R.overlay_ring_text(_existing("no_stopping.png"), "8-20"), "8-20")
    add("316", None, file="no_parking.png")
    add("316", lambda: R.overlay_ring_text(_existing("no_parking.png"), "8-20"), "8-20")
    add("318", R.time_limited_parking)
    add("318", lambda: R.time_limited_parking("60", None), "60")
    add("319", R.dangerous_goods)
    add("320", R.weight_limit, "5.5")
    add("320", lambda: R.weight_limit("20"), "20")
    add("321", R.height_limit, "3.3")
    add("321", lambda: R.height_limit("3.8"), "3.8")
    add("322", R.width_limit, "2.2")
    for v in (20, 30, 40, 50, 60, 70, 80):
        add("323", None, str(v), file=f"speed_{v}.png")
    for v in (10, 100, 110, 120):
        add("323", lambda v=v: R.speed_sign(v), str(v), file=f"speed_{v}.png")
    add("324", lambda: R.speed_sign(30, True), "30")
    add("324", lambda: R.speed_sign(50, True), "50")
    add("325", R.motor_only)
    add("325の2", R.cycle_only)
    add("325の3", R.cycle_pedestrian_only)
    add("325の3", lambda: R.cycle_pedestrian_only(True), "mirror")
    add("325の4", R.pedestrian_only)
    add("325の5-A", lambda: R.permitted_only(("bus_side",), (400.0,)))
    add("325の5-B", lambda: R.permitted_only(("taxi_side",), (400.0,)))
    add("325の5-C", lambda: R.permitted_only(("truck_front",), (230.0,)))
    add("325の6", lambda: R.permitted_only(("bus_side", "taxi_side"), (260.0, 220.0)))
    add("325の7", R.disaster_only)
    add("326-A", None, "right", file="one_way_right.png")
    add("326-A", None, "left", file="one_way_left.png")
    add("326-B", None, file="one_way.png")
    add("326の2-A", R.cycle_one_way, "left")
    add("326の2-A", lambda: R.cycle_one_way(pointing_right=True), "right")
    add("326の2-B", lambda: R.cycle_one_way(tall=True))
    add("327", R.vehicle_class_division)
    add("327の2", R.vehicle_type_lane)
    add("327の3", lambda: R.vehicle_type_lane(True))
    add("327の4", R.exclusive_lane_bus)
    add("327の4", lambda: R.exclusive_lane_bus("路線バス等"), "text")
    add("327の4の2", R.cycle_lane)
    add("327の5", R.bus_priority_lane)
    add("327の6", R.trailer_first_lane)
    for key, lanes in _lane_variants():
        n = len(L.parse(lanes))
        uses = any(u for _, u in L.parse(lanes))
        sid = {1: "327の7-D"}.get(n, "327の7-A")
        dirs = L.parse(lanes)
        if n == 1:
            sid = {("through",): "327の7-D", ("left",): "327の7-C", ("left", "through"): "327の7-B"}.get(
                dirs[0][0], "327の7-B"
            )
        if uses:
            sid = "327の5" if any(u == "bus_priority" for _, u in dirs) else "327の4"
        w, h = L.plate_size(n)
        add(
            sid,
            lambda lanes=lanes: L.lane_sign(lanes),
            f"lanes:{key}",
            file=L.file_name(lanes),
            size_mm=(w, h),
            plate_node=L.plate_node(n),
        )
    add("327の8", R.moped_two_step)
    add("327の9", lambda: R.moped_two_step(True))
    add("327の10", R.roundabout)
    add("327の11", lambda: R.parking_method("parallel"))
    add("327の12", lambda: R.parking_method("perpendicular"))
    add("327の13", lambda: R.parking_method("angle"))
    add("328", R.horn)
    add("329-A", None, file="slow.png")
    add("329-B", R.slow_jp_only)
    add("330-A", None, file="stop.png")
    add("330-B", R.stop_jp_only)
    add("331", R.pedestrians)
    add("332", lambda: R.pedestrians(True))
    add("332", lambda: R.pedestrians(True, "わたるな"), "watarun")

    # 指示
    add("401", S.side_by_side)
    add("402", S.tram_tracks)
    add("403", S.parking_ok)
    add("404", S.stopping_ok)
    add("405", S.priority_road)
    add("406", S.centre_line)
    add("406の2", S.stop_line)
    add("407-A", S.crosswalk)
    add("407-A", None, "legacy", file="crosswalk.png", size_mm=(600.0, 600.0), plate_node="PlateSquare")
    add("407-B", lambda: S.crosswalk(True))
    add("407の2", S.cycle_crossing)
    add("407の3", S.crosswalk_and_cycle)
    add("408", S.safety_zone)
    add("409-A", S.advance_notice)
    add("409-B", S.detour_notice)

    # 補助
    def aux(sign: str, lines: list[str], variant: str | None = None, **kw) -> None:
        n = len(lines)
        h = A.plate_height(n)
        add(
            sign,
            lambda: A.text_plate(lines, **kw),
            variant,
            size_mm=(600.0, h),
            plate_node=f"PlateAux60x{round(h / 10)}",
        )

    aux("501", ["この先100m"])
    for i, v in enumerate((["ここから50m"], ["市内全域"], ["この先50m"], ["この先200m"], ["ここから100m"])):
        aux("501", v, ["k50", "zen", "s50", "s200", "k100"][i], spread=v == ["市内全域"])
    aux("502", ["8-20"])
    for v, key in (
        (["日曜・休日を除く"], "kyujitsu"),
        (["7-9"], "7-9"),
        (["7-19"], "7-19"),
        (["日曜・休日を除く", "8-20"], "kyujitsu-8-20"),
    ):
        aux("502", v, key)
    aux("503-A", ["大　　貨"])
    for v, key in (
        (["原付を除く"], "gentsuki"),
        (["自転車を除く"], "jitensha"),
        (["大型等"], "ogata"),
        (["二輪を除く"], "nirin"),
        (["タクシーを除く"], "taxi"),
    ):
        aux("503-A", v, key)
    add("503-B", A.vehicle_plate, "truck")
    add("503-B", lambda: A.vehicle_plate(("bus_side",)), "bus")
    add("503-C", A.load_plate)
    add("503-D", A.badge_only)
    aux("503の2", ["遠隔小型"])
    aux("503の2", ["遠隔小型を除く"], "jogai")
    aux("504", ["駐車余地6m"])
    add("504の2", A.parking_time, size_mm=(600.0, 320.0), plate_node="PlateAux60x32")
    add("504の2", lambda: A.parking_time(False), "ticket", size_mm=(600.0, 320.0), plate_node="PlateAux60x32")
    add("505-A", lambda: A.arrow_plate("right"))
    aux("505-B", ["こ こ か ら"])
    aux("505-C", ["区　域", "ここから"])
    add("506", lambda: A.arrow_plate("both"))
    aux("506の2", ["区 域 内"])
    add("507-A", lambda: A.arrow_plate("left"))
    aux("507-B", ["こ こ ま で"])
    add("507-C", A.end_of_restriction)
    aux("507-D", ["区　域", "ここまで"])
    aux("508", ["通　学　路"])
    aux("508の2", ["追越し禁止"])
    aux("509", ["前方優先道路"])
    aux("509の2", ["踏切注意"])
    aux("509の3", ["横風注意"])
    aux("509の4", ["動物注意"])
    aux("509の5", ["注　　意"])
    aux("510", ["路肩弱し"])
    add("510", A.safe_speed, "anzen-30", size_mm=(300.0, 300.0), plate_node="PlateAux30x30")
    aux("510の2", ["騒音防止区間"])
    aux("510の2", ["歩行者横断多し"], "hokosha")
    aux("510の2", ["対向車多し"], "taikosha")
    add("511", A.direction_plate, "up_right")
    for d in ("up_left", "right", "left", "up"):
        add("511", lambda d=d: A.direction_plate(d), d)
    aux("512", ["小 諸 市", "本　町"])
    aux("513", ["始　　　点"])
    aux("514", ["終　　　点"])

    # 法定外
    add("x-zone30-entry", N.zone30, file="x-zone30-entry.png")
    add("x-zone30-exit", lambda: N.zone30(False), file="x-zone30-exit.png")
    add("x-zone30plus", N.zone30_plus, file="x-zone30plus.png")
    add("x-fire-water", N.fire_water, file="x-fire-water.png")
    add("x-hydrant", N.hydrant, file="x-hydrant.png")
    add("x-school-route", N.school_route, file="x-school-route.png")
    add("x-school-zone", lambda: N.school_route(True, "7:30-8:30"), file="x-school-zone.png")
    return t


def _existing(name: str) -> Image.Image:
    p = Path(__file__).resolve().parents[3] / "assets" / "signs" / "textures" / name
    return Image.open(p).convert("RGBA")


NONSTATUTORY = [
    {
        "id": "x-zone30-entry",
        "name": "ゾーン30 区域の入口（背板付き区域規制標識）",
        "plate": "rect",
        "plate_node": "PlateBacker40x60",
        "size_mm": [400, 600],
        "source": KIJUN_URL + "#page=185",
        "note": (
            "命令 別表第二 備考四(一)5 の白の背板に 323（φ30）と 505-C を交通規制基準 図例(3) の寸法で配置。"
            "背板に文字・記号は入れない"
        ),
    },
    {
        "id": "x-zone30-exit",
        "name": "ゾーン30 区域の出口（背板付き区域規制標識）",
        "plate": "rect",
        "plate_node": "PlateBacker40x60",
        "size_mm": [400, 600],
        "source": KIJUN_URL + "#page=185",
        "note": "入口と同じ背板に 323（φ30）と 507-D",
    },
    {
        "id": "x-zone30plus",
        "name": "ゾーン30プラス 看板（縮小タイプ）",
        "plate": "rect",
        "plate_node": "PlateRect40x15",
        "size_mm": [400, 150],
        "source": "https://www.mlit.go.jp/road/road/traffic/sesaku/pdf/zone_plus30_06.pdf",
        "note": (
            "白縁 15 mm、緑 370 × 120 mm（R25/R35）、白文字。緑は図面 PDF の塗り #009066。"
            "シンボルマーク入りの標準タイプは描かない"
        ),
    },
    {
        "id": "x-fire-water",
        "name": "消防水利（指定消防水利の標識）",
        "plate": "circle",
        "plate_node": "PlateCircle",
        "size_mm": [600, 600],
        "source": "https://laws.e-gov.go.jp/law/336M50000008006",
        "note": "消防法施行規則 別表第一の四: 文字及び縁を白、枠を赤（8 cm）、地を青。道路標識の命令の外の様式",
    },
    {
        "id": "x-hydrant",
        "name": "消火栓 標識（都内で一般的な赤い円板）",
        "plate": "circle",
        "plate_node": "PlateCircle",
        "size_mm": [600, 600],
        "source": "https://commons.wikimedia.org/wiki/File:Fire_hydrant_sign,_Ogikubo_202406.jpg",
        "note": (
            "公的な寸法・色の規格は見つからず、写真（CC BY-SA 4.0）から意匠を起こした。直径 60 cm は推定。"
            "下に吊る広告枠と製造年月シールは描かない"
        ),
    },
    {
        "id": "x-school-route",
        "name": "通学路 板（区の法定外表示）",
        "plate": "rect",
        "plate_node": "PlateRect30x50",
        "size_mm": [300, 500],
        "source": "https://commons.wikimedia.org/wiki/File:Honmachi_school_zone_shibuya.jpg",
        "note": (
            "渋谷区（CC0）・北区（CC BY-SA 4.0）の写真の共通の型: 緑地に白の「通学路」と「文」。"
            "区の要綱・寸法は見つからず 30 × 50 cm は推定。左下の区名は入れない"
        ),
    },
    {
        "id": "x-school-zone",
        "name": "スクールゾーン 板（区の法定外表示）",
        "plate": "rect",
        "plate_node": "PlateRect30x50",
        "size_mm": [300, 500],
        "source": "https://commons.wikimedia.org/wiki/File:Honmachi_school_zone_shibuya.jpg",
        "note": (
            "同じ写真の緑の路面表示「文 スクールゾーン 7:30−8:30」の文言を通学路板の型で表示したもの。"
            "板としての公的な様式は未確認"
        ),
    },
]

UNDRAWN_REASON = {
    "案内": (
        "案内標識は描画対象外（地名・路線番号・施設名が設置場所ごとに異なり、寸法も字数で変わる。"
        "ゲームの規制データに出てこない）"
    ),
}


def build(written: dict[str, tuple[int, int]]) -> dict:
    """The catalogue: every 別表第一 number (+ the 法定外 ones), textures written by this run."""
    by_sign: dict[str, list[Tex]] = {}
    for tex in textures():
        by_sign.setdefault(tex.sign, []).append(tex)
    shared = {
        "305の2": "305",
        "314の2": "314",
        "317": "316",
        "323の2": "323",
        "328の2": "328",
        "329の2-A": "329-A",
        "329の2-B": "329-B",
        "402の2": "403",
        "403の2": "404",
    }
    entries = []
    for sign_id, name, group, fig in SIGNS:
        meta = meta_for(sign_id, group)
        texs = by_sign.get(sign_id) or by_sign.get(shared.get(sign_id, ""), [])
        e: dict = {"id": sign_id, "name": name, "group": group}
        if meta is None:
            e.update(
                {
                    "texture": None,
                    "plate": None,
                    "plate_node": None,
                    "size_mm": None,
                    "variable": None,
                    "source": LAW_URL,
                    "figure": FIGURE_URL.format(fig) if fig else None,
                    "reason": UNDRAWN_REASON[group],
                }
            )
            entries.append(e)
            continue
        default = next(
            (t for t in texs if t.variant is None or not t.variant.startswith("lanes:")), texs[0] if texs else None
        )
        if sign_id in ("327の7-A",):
            default = next((t for t in texs if t.file == L.file_name("left;through|through|right")), default)
        variable = "lanes" if sign_id in VARIABLE_LANES else "text" if sign_id in VARIABLE_TEXT else None
        e.update(
            {
                "texture": default.file if default else None,
                "plate": meta.plate,
                "plate_node": meta.plate_node,
                "size_mm": [round(v, 1) for v in meta.size_mm],
                "variable": variable,
                "source": LAW_URL,
                "figure": FIGURE_URL.format(fig) if fig else None,
            }
        )
        if group == "補助":
            e["size_source"] = KIJUN_URL + "#page=36"
        if sign_id in NOTES:
            e["note"] = NOTES[sign_id]
        if sign_id in shared:
            e["note"] = NOTES.get(sign_id, f"{shared[sign_id]} と同じ標示板")
        variants = []
        for t in texs:
            if t is default:
                continue
            v: dict = {"key": t.variant or t.file.removesuffix(".png"), "texture": t.file}
            if t.plate_node and t.plate_node != meta.plate_node:
                v["plate_node"] = t.plate_node
            if t.size_mm and tuple(t.size_mm) != tuple(meta.size_mm):
                v["size_mm"] = [round(x, 1) for x in t.size_mm]
            variants.append(v)
        if default and default.size_mm and tuple(default.size_mm) != tuple(meta.size_mm):
            e["size_mm"] = [round(x, 1) for x in default.size_mm]
            if default.plate_node:
                e["plate_node"] = default.plate_node
        if variants:
            e["variants"] = variants
        if default is None:
            e["reason"] = "未描画"
        entries.append(e)
    for ns in NONSTATUTORY:
        tex = by_sign.get(ns["id"], [])
        entries.append(
            {
                "id": ns["id"],
                "name": ns["name"],
                "group": "法定外",
                "texture": tex[0].file if tex else None,
                "plate": ns["plate"],
                "plate_node": ns["plate_node"],
                "size_mm": ns["size_mm"],
                "variable": None,
                "source": ns["source"],
                "note": ns["note"],
            }
        )
    for e in entries:
        files = [e["texture"]] + [v["texture"] for v in e.get("variants", [])]
        missing = [f for f in files if f and f not in written]
        if missing:
            raise RuntimeError(f"{e['id']}: textures not written: {missing}")
    groups: dict[str, list[int]] = {}
    for e in entries:
        g = groups.setdefault(e["group"], [0, 0])
        g[1] += 1
        g[0] += 1 if e["texture"] else 0
    lane_index = [
        {
            "lanes": t.variant.removeprefix("lanes:"),
            "texture": t.file,
            "plate_node": t.plate_node,
            "size_mm": [round(x, 1) for x in t.size_mm or ()],
        }
        for t in textures()
        if t.variant and t.variant.startswith("lanes:")
    ]
    return {
        "schema": {
            "id": "別表第一の番号（例 327の7-A）。法定外は x- で始まる",
            "name": "別表第一の種類",
            "group": "案内|警戒|規制|指示|補助|法定外",
            "texture": "assets/signs/textures のファイル名。描いていないものは null で reason を付ける",
            "plate": "circle|triangle_down|diamond|square|rect|pentagon（標示板の形）",
            "plate_node": "public/models/signs.glb の板のノード名",
            "size_mm": "[横, 縦] 別表第二の標準の大きさ（菱形は一辺）。テクスチャは板の外接矩形を UV 0–1 で覆う",
            "variable": "lanes（車線リストから描く）| text（数値・文言を引数で描く）| null",
            "source": "根拠の URL。figure は別表第二の図の e-Gov 添付ファイル",
            "variants": "同じ番号の別の図柄（左右・例示の値・車線パターン）",
        },
        "law": {"url": LAW_URL, "figures": FIGURE_URL.format("…")},
        "coverage": {g: {"drawn": v[0], "total": v[1]} for g, v in groups.items()},
        "lanes": {
            "generator": "scripts/textures/signs/lanes.py lane_sign()",
            "input": (
                "車線ごと（左から）に OSM turn:lanes の語を + か ; で結ぶ（例 left+through）。"
                "全体は | 区切りも可。専用・優先は {dirs, use: bus|bus_priority|bicycle}"
            ),
            "file": (
                "327-7_<車線ごとの略号を - で連結>.png（u=reverse, l=left, hl=slight_left, t=through, "
                "hr=slight_right, r=right, ~bus/~busp/~cyc=専用・優先）"
            ),
            "rendered": lane_index,
        },
        "signs": entries,
    }


def dumps(obj, width: int = 110) -> str:
    """JSON laid out as the repository formatter (oxfmt, printWidth 110) writes it: objects one key
    per line, arrays of scalars on one line when they fit."""

    def scalar(v) -> str:
        return json.dumps(v, ensure_ascii=False)

    def fmt(v, indent: int, prefix_len: int) -> str:
        pad = "  " * indent
        if isinstance(v, dict):
            if not v:
                return "{}"
            items = [f"{pad}  {scalar(k)}: {fmt(x, indent + 1, len(pad) + 4 + len(scalar(k)))}" for k, x in v.items()]
            return "{\n" + ",\n".join(items) + f"\n{pad}}}"
        if isinstance(v, list):
            if not v:
                return "[]"
            if all(not isinstance(x, (dict, list)) for x in v):
                one = "[" + ", ".join(scalar(x) for x in v) + "]"
                if prefix_len + len(one) + 1 <= width:
                    return one
            items = [f"{pad}  {fmt(x, indent + 1, len(pad) + 2)}" for x in v]
            return "[\n" + ",\n".join(items) + f"\n{pad}]"
        return scalar(v)

    return fmt(obj, 0, 0) + "\n"
