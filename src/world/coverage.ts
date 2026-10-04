/**
 * 漏れなく: every kind of regulation in the JARTIC data (共通規制種別コード, 警視庁 typeD) and what
 * the game shows and checks for it — the sign (道路標識令 別表第一 number, see
 * assets/signs/catalog.json), the road marking (別表第五・第六) and the law check (violation
 * kind). A code with nothing to show gives the reason. tests/coverage.test.ts keeps this table
 * complete against the codes the data build imports and the catalogue's drawings.
 */
export type Coverage = {
  name: string;
  signs: string[];
  markings: string[];
  checks: string[];
  /** Why there is no sign, marking or check (when one of them is empty on purpose). */
  note?: string;
};

export const JARTIC_COVERAGE: Record<string, Coverage> = {
  "1": {
    name: "歩行者用道路",
    signs: ["325の4"],
    markings: [],
    checks: ["closedRoad"],
    note: "標示は無い（標識と補助標識の時間）",
  },
  "4": { name: "通行止め", signs: ["301", "302", "310"], markings: [], checks: ["closedRoad"] },
  "11": { name: "一方通行", signs: ["326-A", "303"], markings: [], checks: ["noEntry"] },
  "12": { name: "指定方向外進行禁止", signs: ["311-A"], markings: [], checks: ["turnBan"] },
  "14": {
    name: "歩行者横断禁止",
    signs: ["332"],
    markings: [],
    checks: [],
    note: "歩行者への規制で、運転者の違反は無い",
  },
  "17": {
    name: "追越しのための右側部分はみ出し通行禁止",
    signs: ["314"],
    markings: ["黄色の中央線"],
    checks: ["keepLeft"],
  },
  "20": {
    name: "車両通行帯",
    signs: [],
    markings: ["車線境界線"],
    checks: ["laneUse"],
    note: "標識は無い（区画線で示す）",
  },
  "21": { name: "車両通行区分", signs: ["327"], markings: [], checks: [] },
  "24": { name: "路線バス等優先通行帯", signs: ["327の5"], markings: [], checks: [] },
  "50": { name: "車両横断禁止", signs: ["312"], markings: [], checks: [] },
  "51": { name: "転回禁止", signs: ["313"], markings: [], checks: ["uturn"] },
  "52": {
    name: "進路変更禁止",
    signs: [],
    markings: ["黄色の車線境界線"],
    checks: ["laneChange"],
    note: "標識は無い（黄色の線で示す）",
  },
  "53": { name: "追越し禁止", signs: ["314の2"], markings: [], checks: [] },
  "58": {
    name: "進行方向別通行区分",
    signs: ["327の7-A"],
    markings: ["進行方向の矢印"],
    checks: ["laneDirection"],
  },
  "61": { name: "徐行", signs: ["329-A"], markings: [], checks: ["slow"] },
  "63": { name: "一時停止", signs: ["330-A"], markings: ["停止線", "止まれ"], checks: ["stopSign"] },
  "65": { name: "駐停車禁止", signs: ["315"], markings: [], checks: ["parkingNoStop"] },
  "70": { name: "駐車可", signs: ["403"], markings: [], checks: [] },
  "71": { name: "停車可", signs: ["403"], markings: [], checks: [] },
  "72": { name: "時間制限駐車区間", signs: ["318"], markings: [], checks: [] },
  "77": { name: "警笛鳴らせ", signs: ["328"], markings: [], checks: [] },
  "81": { name: "普通自転車歩道通行可", signs: ["325の3"], markings: [], checks: [] },
  "85": {
    name: "横断歩道",
    signs: ["407-A"],
    markings: ["横断歩道", "◇（横断歩道あり）"],
    checks: ["pedestrianCrossing"],
  },
  "92": {
    name: "停止線",
    signs: [],
    markings: ["停止線"],
    checks: ["signal", "stopSign"],
    note: "標識は無い（標示）",
  },
  "111": { name: "専用通行帯", signs: ["327の4", "327の4の2"], markings: [], checks: [] },
  "112": { name: "最高速度（区間）", signs: ["323"], markings: ["最高速度の数字"], checks: ["speed"] },
  "114": { name: "最高速度（区域）", signs: ["323"], markings: [], checks: ["speed"] },
  "115": { name: "駐車禁止", signs: ["316"], markings: [], checks: ["parking"] },
  "116": { name: "駐車方法の指定", signs: ["403"], markings: [], checks: [] },
  "119": {
    name: "車両通行帯・進行方向別通行区分・進路変更禁止",
    signs: ["327の7-A"],
    markings: ["黄色の車線境界線", "進行方向の矢印"],
    checks: ["laneChange", "laneDirection"],
  },
};

/** Codes the data build reads (scripts/regulations.ts isWanted), for the completeness test. */
export const IMPORTED_CODES = [
  "1",
  "4",
  "11",
  "12",
  "14",
  "17",
  "20",
  "21",
  "24",
  "50",
  "51",
  "52",
  "53",
  "58",
  "61",
  "63",
  "65",
  "70",
  "71",
  "72",
  "77",
  "81",
  "85",
  "92",
  "111",
  "112",
  "114",
  "115",
  "116",
  "119",
] as const;
