/**
 * Values the expressway compiler needs that no statute fixes. Kept apart from src/law/roadStandards.ts
 * so a guess never passes for a 構造令 value: every entry says `verified: false` and why it is what it
 * is. When a real figure is found (a design manual, a survey), change the value, cite it and flip
 * `verified`; the compiler reads nothing else.
 */

export type Assumption<T> = { readonly value: T; readonly verified: false; readonly reason: string };

/** Depth from the road surface to the soffit of the box girder (slab + girder). */
export const GIRDER_DEPTH: Assumption<number> = {
  value: 2.2,
  verified: false,
  reason: "未確認。都市高架の鋼箱桁・PC 箱桁の桁高 1.8〜2.5 m 程度という一般的な目安から置いた",
};

/** Standard clearance under the girder where nothing forces it higher: the viaduct's target height. */
export const STANDARD_UNDERCLEARANCE: Assumption<number> = {
  value: 6.5,
  verified: false,
  reason:
    "未確認。建築限界 4.5 m（第12条）に余裕を足した値。都市高速（実在の都市高速道路）の実際の桁下高の分布は調べていない",
};

/**
 * The floor over open ground (no road crossed there in OSM): the girder underside at least 第12条's
 * 4.5 m over the ground, as if any ground could hold a road. Not the 6.5 m target height
 * (STANDARD_UNDERCLEARANCE): the floor below which a deck counts as too low.
 */
export const OPEN_GROUND_FLOOR: Assumption<number> = {
  value: 4.5,
  verified: false,
  reason:
    "仮定。第12条の建築限界 4.5 m を、OSM に道路の無い地表全体にも当てはめた（未登録の道路がありうるとして）",
};

/**
 * How far a run that fails at its lowest design speed may still miss OPEN_GROUND_FLOOR and count as
 * solved (the last fallback step, with the amount reported as below_open_ground_floor).
 */
export const OPEN_FLOOR_GIVE: Assumption<number> = {
  value: 0.5,
  verified: false,
  reason:
    "仮定。値は第12条ただし書（第三種第五級でやむを得ない場合の H 4 m）から借りた: 桁下 4.0 m。23 区の都市高速の下の地表に第三種第五級の道路があるという根拠ではない",
};

/** How far the deck may sit in the smoothed DEM near a low end (the floor there is DEM − this). */
export const DEM_SINK_FLOOR: Assumption<number> = {
  value: 0.25,
  verified: false,
  reason:
    "仮定。平滑化した DEM のすぐ上に端を合わせると、拘束点の間の数 cm の起伏で解けなくなったので置いた余裕",
};

/** How much deeper than DEM_SINK_FLOOR a run failing at its lowest speed may go (last step). */
export const DEM_SINK_GIVE: Assumption<number> = {
  value: 0.75,
  verified: false,
  reason:
    "仮定。平滑化した DEM（5×5 中央値と 3×3 の加重平均）は擁壁・盛土の段で段の半分ほどずれるので、低い端の近くでは平滑化した地表に計 1.0 m まで入るのを認めた。実測で確かめていない",
};

/** A short run's ground end may sit this far above or below the DEM there (T5 allows 5 cm). */
export const GROUND_END_BAND: Assumption<number> = {
  value: 0.04,
  verified: false,
  reason: "仮定。T5 の 5 cm から地表の丸め（1 cm）を引いた幅",
};

/** Clearance over a railway (the overhead line), in place of 第12条's 4.5 m which is for roads. */
export const RAIL_CLEARANCE: Assumption<number> = {
  value: 6.0,
  verified: false,
  reason: "未確認。鉄道の建築限界と架空電車線の高さ（約 5〜5.7 m）に余裕を見た値",
};

/** Clearance over water (navigation), when a viaduct crosses a river or canal. */
export const WATER_CLEARANCE: Assumption<number> = {
  value: 4.5,
  verified: false,
  reason: "未確認。航路限界は河川ごとに違い調べていない。道路の建築限界と同じ値を仮に使う",
};

/** Spacing of the piers along the line (distance, from the run's start). */
export const PIER_SPACING: Assumption<number> = {
  value: 35,
  verified: false,
  reason: "未確認。都市高架の支間 30〜40 m 程度という一般的な目安",
};

/** Height of the 壁高欄 (concrete parapet) above the deck. */
export const PARAPET_HEIGHT: Assumption<number> = {
  value: 1.1,
  verified: false,
  reason: "未確認。防護柵の設置基準の高さの目安（0.9〜1.1 m 程度）から。種別 SS などは調べていない",
};

/** Width of the 壁高欄 itself and the deck beyond the shoulder (the curb of the slab). */
export const PARAPET_WIDTH: Assumption<number> = {
  value: 0.5,
  verified: false,
  reason: "未確認。壁高欄の天端幅の目安",
};

/** Side friction f in e = V²/(127R) − f. */
export const SIDE_FRICTION: Assumption<number> = {
  value: 0.15,
  verified: false,
  reason: "未確認。設計速度 40〜60 km/h の横すべり摩擦係数の一般的な値（0.13〜0.15）から",
};

/** Smallest radius a ramp may keep after smoothing (28条4項 frees ramps from 第15条). */
export const RAMP_MIN_RADIUS: Assumption<number> = {
  value: 15,
  verified: false,
  reason:
    "knowledge/road-redesign-plan.mdの判断（走行できる下限）。法令値ではない（第15条の V20 の値と同じ）",
};

/** How far the smoothed centre line may move away from the OSM line. */
export const MAX_LATERAL_SHIFT: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason: "knowledge/road-redesign-plan.mdの判断。OSM の位置精度と車線幅の半分未満という目安",
};

/** Lanes and design speed when OSM has no lanes / maxspeed. */
export const DEFAULT_LANES: Assumption<{ main: number; ramp: number; street: number }> = {
  value: { main: 2, ramp: 1, street: 2 },
  verified: false,
  reason:
    "knowledge/road-redesign-plan.md 4.1 の既定。OSM の lanes が無い way の実態は調べていない。street は構造物上書きで指名した臨港道路（P7）で、橋の上の way が lanes=2 なので取付けも 2",
};

export const DEFAULT_SPEED: Assumption<{ main: number; ramp: number; street: number }> = {
  value: { main: 60, ramp: 40, street: 40 },
  verified: false,
  reason:
    "knowledge/road-redesign-plan.md 4.1 の既定（法定速度 60、ランプは 40）。street（P7 の臨港道路）は芝浦のループの way が maxspeed=40 なので橋の上も 40 と置いた（橋の上の規制速度は確かめていない）",
};

/** Lane width, shoulders and design speed table used for ramps (statute frees them: 28条4項). */
export const RAMP_SECTION: Assumption<{ laneWidth: number; shoulderL: number; shoulderR: number }> = {
  value: { laneWidth: 3.25, shoulderL: 1.0, shoulderR: 0.5 },
  verified: false,
  reason: "未確認。連結路は第5・8条の適用外。第二種第二級の車線幅と狭めた路肩を仮に使う",
};

/** Half width of a ground road crossed under a viaduct, to keep piers off its carriageway. */
export const GROUND_ROAD_HALF_WIDTH: Assumption<number> = {
  value: 6,
  verified: false,
  reason: "未確認。OSM に幅が無いので 2〜4 車線の一般道の半幅の目安",
};

/**
 * Lane-line dash and gap inside 標識令's ranges (3〜10 m, 1〜2 times). 8 m / 12 m is within them; the
 * value actually painted on urban expressways is not confirmed.
 */
export const LANE_LINE_DASH: Assumption<{ dash: number; gap: number }> = {
  value: { dash: 8, gap: 12 },
  verified: false,
  reason: "未確認。令の範囲内の値。実務値は調べていない",
};

/**
 * The thick dashed line between a main line and a ramp where they merge or part (標識令 別表第四
 * の分合流部: 幅 0.30〜0.75 m、線長 2〜5 m、間隔 線長の 1〜1.5 倍). 0.45 / 3 / 3 is within it; the value
 * painted on urban expressways is not confirmed.
 */
export const BRANCH_LINE: Assumption<{ width: number; dash: number; gap: number }> = {
  value: { width: 0.45, dash: 3, gap: 3 },
  verified: false,
  reason: "未確認。令の範囲内の値。実務値は調べていない",
};

/**
 * 導流帯 (標示 107) at a nose: outline width, stripe width and the stripes' spacing along the road.
 * The order's example figure is not transcribed yet (knowledge/road-redesign-plan.md 4.7).
 */
export const ZEBRA: Assumption<{ outline: number; stripe: number; pitch: number }> = {
  value: { outline: 0.2, stripe: 0.45, pitch: 3 },
  verified: false,
  reason: "未確認。別表の例示図から転記していない。見た目の目安",
};

/**
 * Room above a tunnel's clearance for the lamps, signs and jet fans hung there: the inner height is
 * 第12条's H plus this (below.ts TUNNEL_INNER_HEIGHT_M). 第34条 asks for lighting, ventilation and
 * emergency facilities "where needed" and fixes no height.
 */
export const TUNNEL_EQUIPMENT_ROOM: Assumption<number> = {
  value: 0.8,
  verified: false,
  reason:
    "未確認。建築限界 H 4.5 m（第12条、e-Gov で確認）の上に照明・標識・換気設備を吊る余裕。都市高速の開削トンネルの内空高（H + この値 = 5.3 m）は調べていない",
};

/**
 * Depth of the tunnel box's roof (頂版) and the least soil over it: the compiler keeps the road at
 * least TUNNEL_INNER_HEIGHT + roof + cover below the ground wherever it can reach that depth from a
 * portal at the 第20条 grade.
 */
export const TUNNEL_ROOF: Assumption<{ slab: number; cover: number }> = {
  value: { slab: 0.8, cover: 0.5 },
  verified: false,
  reason:
    "未確認。開削の箱型トンネルの頂版厚 0.6〜1.0 m 程度と、坑口付近の最小の土被りの目安。都市高速の実際の土被りは調べていない（道路の下の埋設物の深さで決まることが多い）",
};

/**
 * The raised inspection walkway (監査路・監視員通路) along each tunnel wall: width and curb height. It
 * stands outside the shoulder, so the clearance (第12条) is not narrowed by it.
 */
export const TUNNEL_WALKWAY: Assumption<{ width: number; curb: number }> = {
  value: { width: 0.75, curb: 0.25 },
  verified: false,
  reason: "未確認。トンネルの監査路の幅 0.75 m・縁石高 0.25 m 程度という一般的な目安。基準書は確かめていない",
};

/**
 * The retaining walls of a cut (掘割の擁壁): how far they rise above the ground at the road's edge
 * (a parapet against falling in), and their thickness.
 */
export const CUT_WALL: Assumption<{ above: number; thickness: number }> = {
  value: { above: 0.4, thickness: 0.5 },
  verified: false,
  reason:
    "未確認。擁壁の天端を地表から立ち上げた転落防止の高さと壁厚の目安。地表は DEM（平滑化）なので、ずれを隠す分も含む",
};

/** Spacing and length of the lamps along a tunnel's ceiling (two rows, one at each wall). */
export const TUNNEL_LAMPS: Assumption<{ pitch: number; length: number }> = {
  value: { pitch: 6, length: 1.5 },
  verified: false,
  reason:
    "未確認。トンネル照明の基本照明の灯具間隔の目安。第34条第2項は照明施設を求めるが輝度・間隔は令に無い（トンネル照明の基準書は確かめていない）",
};

/**
 * Blocks (P2.7-2, blocks.ts, `--partition blocks`): an anchor splits a main line only in a quiet
 * stretch, at least Q = max(BLOCK_QUIET_MIN, k × approachLength) from anything that couples the
 * run to another (junctions, crossings, decks over or beside it, a structure, a portal, a speed
 * change). k is this factor; below 1 the climb from a low end could be cut in two.
 */
export const BLOCK_QUIET_FACTOR: Assumption<number> = {
  value: 1.5,
  verified: false,
  reason:
    "仮定。登坂長（approachLength）の何倍を静かな区間の片側に取るか。1 未満は受け付けない。S2 の A/B（knowledge/expressway-generation.md「P2.7-2」、2026-11-11）では pruned で k = 1・1.5 が全項目可、all はどの k でも本線の閉鎖 14 → 18 で否（k によらない）、k = 2 は両方で T2 +1。余裕のある 1.5 を暫定とし、41009552 の修正と S3 の後の A/B で決め直す",
};

/** The least quiet margin Q either side of an anchor, whatever the design speed. */
export const BLOCK_QUIET_MIN: Assumption<number> = {
  value: 300,
  verified: false,
  reason:
    "仮定。低速（V40〜60）の登坂長は 150〜200 m で、その 1 倍では固定点の脇に縦断曲線 1〜2 本分しか残らないので置いた下限",
};

/** The longest stretch between two anchors of a long quiet stretch (more anchors, equally spaced). */
export const BLOCK_ANCHOR_SPACING: Assumption<number> = {
  value: 3000,
  verified: false,
  reason:
    "仮定。長い静かな区間を等分する上限の間隔。block の大きさ（QP の変数）と固定点の数の釣り合いで置いた目安",
};

/**
 * How close two main lines' ground ends must be to count as one touchdown: the up and down
 * carriageways of one road coming down to the same place. Their deck pairs within the climb of
 * those ends are not held a level apart (compile.ts `markSharedTouchdowns`).
 */
export const SHARED_TOUCHDOWN: Assumption<number> = {
  value: 60,
  verified: false,
  reason:
    "仮定。上下線が同じ地点へ降りるとみなす端どうしの距離。C1 の上下線 41009552・668292569 の低い端（標高 3.56 m と 3.59 m）が同じ場所に降りる形から、車線域 2 本分と OSM の中心線の取り方の揺れを見込んで置いた目安。全域の計画で条件に掛かる 5 組の端どうしの距離は 6.9〜11.3 m で、11.3〜60 m のどの値でも同じ組になる（P2.7-3a のレビューの実測、knowledge/expressway-generation.md）",
};

/**
 * Two main lines running beside each other (S6 PR 3, compile.ts findCompanions): carriageways apart
 * by at most gapM for minLengthM or more on one OSM layer, held within dzM of one height every stepM
 * along the first (by id), softly, but for the climb (approachLength) at either end of the stretch.
 */
export const COMPANIONS: Assumption<{ gapM: number; dzM: number; minLengthM: number; stepM: number }> = {
  value: { gapM: 4, dzM: 0.3, minLengthM: 200, stepM: 25 },
  verified: false,
  reason:
    "仮定。並走する上下線は同じ構造（一つの橋脚の上の 2 枚の床版など）とみなす。車線域の間 4 m は中央分離帯と路肩の幅の目安、0.3 m は 2 枚の床版の高さの差として目に付かない目安、200 m は分合流の取付けより長く並ぶもの（S5 の記録: 45021976 と 24402611 が並走しながら 0.6 → 4.7 m 離れた）。25 m は QP の行の間隔（測点 20 m の倍に近い粗さ）。行の重み（--companion-weight）の実効の強さは、1 m あたり 重み ÷ stepM（重み 1 で 0.04 / m、床版の重なりの W_PAIR 5 は 20 m の測点ごと）。区間の両端から climb の内は行にしない（並走の始まりと終わりでは片方が分合流や交差へ向けて離れていく。PR 3 のレビューで、0.3 m を超えた 80 測点中 46 が端から 150 m 以内）。どれも実測で確かめていない",
};

/**
 * How far either side the design ground line (designGround.ts `envelope`) takes the ground's
 * extreme and then its mean, for the objective-v2 target (P2.7-3): over a viaduct the upper
 * envelope of the ground, under it (a tunnel or cut) the lower one.
 */
export const DESIGN_GROUND_REACH: Assumption<{ viaduct: number; below: number }> = {
  value: { viaduct: 150, below: 300 },
  verified: false,
  reason:
    "仮定。波長が 2 × reach 以下の地表の起伏（DEM の凸凹、川の護岸、盛土）を目標から落とす長さ。高架は登坂長（V60 で約 200 m）より短い 150 m で、それより長い起伏には沿う。地下は土被りを取るので短い起伏に沿う理由が無く、倍の 300 m。設計の試作（ship/pruned、2026-11-11）の値。P2.7-3 の掃引（ship/pruned）では高架 250 m で強制なしの短波長相関が 0.240 → 0.197 に下がるが（勾配変化の重み 1）、床版の地表からの高さの中央値が v1 より 1.07 m 上がり（合否 +1.0 m 以内）、200 m は未収束が 3 回出たので 150 m のまま（knowledge/expressway-generation.md「P2.7-3」）",
};

/**
 * The thinnest girder a deck may take where it crosses a road, a railway or another deck and the
 * clearance (第12条 + GIRDER_DEPTH) is short by no more than the difference (P2.7-6 PR 1, `--structures
 * height`): the chunk's `girder` is then the clearance's surplus, at least this. The QP still aims at
 * GIRDER_DEPTH; only the judgement and the drawing take the thinner girder.
 */
export const GIRDER_MIN: Assumption<number> = {
  value: 1.7,
  verified: false,
  reason:
    "仮定。都市高架の鋼箱桁・鋼床版の桁高の下限の目安（1.5〜2.0 m 程度）から置いた。GIRDER_DEPTH 2.2 m との差 0.5 m は、ship の重なりで「1 段にあと少し」の 25 組のうち 22 組（最小 |Δz| 6.2 m 以上）が受かる量（設計の数え直し、P2.7-6 の指示 0.3 節）。実際の桁高の分布は調べていない",
};

/**
 * How a viaduct-tagged run's stretch is drawn once its solved height decides the structure (P2.7-6
 * PR 1, `--structures height`): a cut where the road is under the ground, an embankment (retaining
 * walls to the ground, no piers) where it is over the ground but under the open-ground floor, and a
 * viaduct above. `smoothM`: shorter stretches of one class merge into their neighbours (no flicker of
 * chunks). `cut` / `embankment`: the longest (and for a cut the deepest) stretch a rule accepts without
 * a review (the ledger's cut-stretch / embankment-stretch); longer ones are listed.
 */
export const HEIGHT_STRUCTURES: Assumption<{
  smoothM: number;
  cut: { depthM: number; lengthM: number; fromM: number; minLengthM: number };
  embankment: { lengthM: number };
  ground: { cutBelowM: number; bandM: number };
}> = {
  value: {
    smoothM: 20,
    cut: { depthM: 3, lengthM: 150, fromM: 0.5, minLengthM: 10 },
    embankment: { lengthM: 500 },
    ground: { cutBelowM: 0.3, bandM: 1.5 },
  },
  verified: false,
  reason:
    "仮定（P2.7-6 の指示 4.2・5.1 の初期値）。掘割は坑口へ下りる取付け（代官町、坑口の手前で地表より 0.9〜2.5 m 低い）を、盛土は低いまま走るランプ（護国寺・新宿出口、600 m 前後）の半分ほどを規則で通す長さとして置いた。20 m は一つのチャンクに満たない出入りをならす長さ。高架タグの run の掘割は中心線の地表より fromM（0.5 m、DEM に沈まない床 0.25 m を譲った run だけが越える深さ）を超えて下から、minLengthM（10 m）未満の掘割はならす（PR 1 の再レビュー R2: 床と同じ 0.25 m では高さ由来の掘割 11 区間中 9 区間が深さ 0.22〜0.27 m・長さ 1〜16 m の切れ端）。地平 run（S6 PR 2）は地表 + cutBelowM（0.3 m）より低い所が掘割、設計地盤線から ±bandM（1.5 m）の帯。ship の分布は knowledge/expressway-generation.md「P2.7-6」",
};

export const ASSUMPTIONS: Readonly<Record<string, Assumption<unknown>>> = {
  GIRDER_DEPTH,
  GIRDER_MIN,
  HEIGHT_STRUCTURES,
  STANDARD_UNDERCLEARANCE,
  OPEN_GROUND_FLOOR,
  OPEN_FLOOR_GIVE,
  DEM_SINK_FLOOR,
  DEM_SINK_GIVE,
  GROUND_END_BAND,
  RAIL_CLEARANCE,
  WATER_CLEARANCE,
  PIER_SPACING,
  PARAPET_HEIGHT,
  PARAPET_WIDTH,
  SIDE_FRICTION,
  RAMP_MIN_RADIUS,
  MAX_LATERAL_SHIFT,
  DEFAULT_LANES,
  DEFAULT_SPEED,
  RAMP_SECTION,
  GROUND_ROAD_HALF_WIDTH,
  LANE_LINE_DASH,
  BRANCH_LINE,
  ZEBRA,
  TUNNEL_EQUIPMENT_ROOM,
  TUNNEL_ROOF,
  TUNNEL_WALKWAY,
  CUT_WALL,
  TUNNEL_LAMPS,
  BLOCK_QUIET_FACTOR,
  BLOCK_QUIET_MIN,
  BLOCK_ANCHOR_SPACING,
  SHARED_TOUCHDOWN,
  COMPANIONS,
  DESIGN_GROUND_REACH,
};
