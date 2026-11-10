// Converted once from assets/signs/catalog.json (G1a, knowledge/sign-system.md); this file is the
// definition now: edit it, then `just make-sign-registry`.
import { group } from "../schema";

export const INSTRUCTION = group("指示", [
  { id: "401", name: "並進可", plate: "PlateSquare", art: { by: "texture", file: "401.png" } },
  { id: "402", name: "軌道敷内通行可", plate: "PlateSquare", art: { by: "texture", file: "402.png" } },
  {
    id: "402の2",
    name: "高齢運転者等標章自動車駐車可",
    shares: "403",
    note: "403 と同じ標示板に補助標識 503-D を附置する（備考一(一)34）",
  },
  {
    id: "403",
    name: "駐車可",
    plate: "PlateSquare",
    art: { by: "texture", file: "403.png" },
    game: { kind: "parkingAllowed" },
  },
  {
    id: "403の2",
    name: "高齢運転者等標章自動車停車可",
    shares: "404",
    note: "404 と同じ標示板に補助標識 503-D を附置する（備考一(一)34）",
  },
  { id: "404", name: "停車可", plate: "PlateSquare", art: { by: "texture", file: "404.png" } },
  { id: "405", name: "優先道路", plate: "PlateSquare", art: { by: "texture", file: "405.png" } },
  { id: "406", name: "中央線", plate: "PlateSquare", art: { by: "texture", file: "406.png" } },
  { id: "406の2", name: "停止線", plate: "PlateSquare", art: { by: "texture", file: "406-2.png" } },
  {
    id: "407-A",
    name: "横断歩道",
    plate: "PlatePentagon",
    art: {
      by: "texture",
      file: "407a.png",
      variants: [{ key: "legacy", file: "crosswalk.png", plate: "PlateSquare" }],
    },
    note: "現行の様式は青の五角形に白の記号（図 191）。旧 crosswalk.png（青の正方形に白の三角）は様式外として variants に残す",
    game: { kind: "crosswalk" },
  },
  { id: "407-B", name: "横断歩道", plate: "PlatePentagon", art: { by: "texture", file: "407b.png" } },
  { id: "407の2", name: "自転車横断帯", plate: "PlatePentagon", art: { by: "texture", file: "407-2.png" } },
  {
    id: "407の3",
    name: "横断歩道・自転車横断帯",
    plate: "PlatePentagon",
    art: { by: "texture", file: "407-3.png" },
  },
  { id: "408", name: "安全地帯", plate: "PlateSquare", art: { by: "texture", file: "408.png" } },
  {
    id: "409-A",
    name: "規制予告",
    plate: "PlateRect60x90",
    art: { by: "texture", file: "409a.png" },
    variable: "text",
  },
  {
    id: "409-B",
    name: "規制予告",
    plate: "PlateRect90x60",
    art: { by: "texture", file: "409b.png" },
    variable: "text",
  },
]);
