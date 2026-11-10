// Converted once from assets/signs/catalog.json (G1a, knowledge/sign-system.md); this file is the
// definition now: edit it, then `just make-sign-registry`.
import { group } from "../schema";

export const NONSTATUTORY = group("法定外", [
  {
    id: "x-zone30-entry",
    name: "ゾーン30 区域の入口（背板付き区域規制標識）",
    plate: "PlateBacker40x60",
    art: { by: "texture", file: "x-zone30-entry.png", paint: { fn: "nonstatutory.zone30" } },
    source:
      "https://www.npa.go.jp/bureau/traffic/seibi2/kisei/mokuteki/kiseikijun/260316kiseikijun.pdf#page=185",
    note: "命令 別表第二 備考四(一)5 の白の背板に 323（φ30）と 505-C を交通規制基準 図例(3) の寸法で配置。背板に文字・記号は入れない",
  },
  {
    id: "x-zone30-exit",
    name: "ゾーン30 区域の出口（背板付き区域規制標識）",
    plate: "PlateBacker40x60",
    art: {
      by: "texture",
      file: "x-zone30-exit.png",
      paint: { fn: "nonstatutory.zone30", args: { entry: false } },
    },
    source:
      "https://www.npa.go.jp/bureau/traffic/seibi2/kisei/mokuteki/kiseikijun/260316kiseikijun.pdf#page=185",
    note: "入口と同じ背板に 323（φ30）と 507-D",
  },
  {
    id: "x-zone30plus",
    name: "ゾーン30プラス 看板（縮小タイプ）",
    plate: "PlateRect40x15",
    art: { by: "texture", file: "x-zone30plus.png", paint: { fn: "nonstatutory.zone30_plus" } },
    source: "https://www.mlit.go.jp/road/road/traffic/sesaku/pdf/zone_plus30_06.pdf",
    note: "白縁 15 mm、緑 370 × 120 mm（R25/R35）、白文字。緑は図面 PDF の塗り #009066。シンボルマーク入りの標準タイプは描かない",
  },
  {
    id: "x-fire-water",
    name: "消防水利（指定消防水利の標識）",
    plate: "PlateCircle",
    art: { by: "texture", file: "x-fire-water.png", paint: { fn: "nonstatutory.fire_water" } },
    source: "https://laws.e-gov.go.jp/law/336M50000008006",
    note: "消防法施行規則 別表第一の四: 文字及び縁を白、枠を赤（8 cm）、地を青。道路標識の命令の外の様式",
  },
  {
    id: "x-hydrant",
    name: "消火栓 標識（都内で一般的な赤い円板）",
    plate: "PlateCircle",
    art: { by: "texture", file: "x-hydrant.png", paint: { fn: "nonstatutory.hydrant" } },
    source: "https://commons.wikimedia.org/wiki/File:Fire_hydrant_sign,_Ogikubo_202406.jpg",
    note: "公的な寸法・色の規格は見つからず、写真（CC BY-SA 4.0）から意匠を起こした。直径 60 cm は推定。下に吊る広告枠と製造年月シールは描かない",
    game: { kind: "hydrant" },
  },
  {
    id: "x-school-route",
    name: "通学路 板（区の法定外表示）",
    plate: "PlateRect30x50",
    art: { by: "texture", file: "x-school-route.png", paint: { fn: "nonstatutory.school_route" } },
    source: "https://commons.wikimedia.org/wiki/File:Honmachi_school_zone_shibuya.jpg",
    note: "渋谷区（CC0）・北区（CC BY-SA 4.0）の写真の共通の型: 緑地に白の「通学路」と「文」。区の要綱・寸法は見つからず 30 × 50 cm は推定。左下の区名は入れない",
    game: { kind: "schoolRoute" },
  },
  {
    id: "x-school-zone",
    name: "スクールゾーン 板（区の法定外表示）",
    plate: "PlateRect30x50",
    art: {
      by: "texture",
      file: "x-school-zone.png",
      paint: { fn: "nonstatutory.school_route", args: { zone: true, hours: "7:30-8:30" } },
    },
    source: "https://commons.wikimedia.org/wiki/File:Honmachi_school_zone_shibuya.jpg",
    note: "同じ写真の緑の路面表示「文 スクールゾーン 7:30−8:30」の文言を通学路板の型で表示したもの。板としての公的な様式は未確認",
  },
]);
