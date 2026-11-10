// Converted once from assets/signs/catalog.json (G1a, knowledge/sign-system.md); this file is the
// definition now: edit it, then `just make-sign-registry`.
import { group } from "../schema";

/** 補助標識 sizes come from 警察庁「交通規制基準」 (the 別表第二 figures are not legible on e-Gov). */
const AUX_SIZE_SOURCE =
  "https://www.npa.go.jp/bureau/traffic/seibi2/kisei/mokuteki/kiseikijun/260316kiseikijun.pdf#page=36";

export const AUXILIARY = group("補助", [
  {
    id: "501",
    name: "距離・区域",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "501.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["この先100m"] } },
      variants: [
        {
          key: "k50",
          file: "501_k50.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["ここから50m"], spread: false } },
        },
        {
          key: "zen",
          file: "501_zen.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["市内全域"], spread: true } },
        },
        {
          key: "s50",
          file: "501_s50.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["この先50m"], spread: false } },
        },
        {
          key: "s200",
          file: "501_s200.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["この先200m"], spread: false } },
        },
        {
          key: "k100",
          file: "501_k100.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["ここから100m"], spread: false } },
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "502",
    name: "日・時間",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "502.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["8-20"] } },
      variants: [
        {
          key: "kyujitsu",
          file: "502_kyujitsu.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["日曜・休日を除く"] } },
        },
        { key: "7-9", file: "502_7-9.png", paint: { fn: "auxiliary.text_plate", args: { lines: ["7-9"] } } },
        {
          key: "7-19",
          file: "502_7-19.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["7-19"] } },
        },
        {
          key: "kyujitsu-8-20",
          file: "502_kyujitsu-8-20.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["日曜・休日を除く", "8-20"] } },
          plate: "PlateAux60x32",
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "503-A",
    name: "車両の種類",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "503a.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["大　　貨"] } },
      variants: [
        {
          key: "gentsuki",
          file: "503a_gentsuki.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["原付を除く"] } },
        },
        {
          key: "jitensha",
          file: "503a_jitensha.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["自転車を除く"] } },
        },
        {
          key: "ogata",
          file: "503a_ogata.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["大型等"] } },
        },
        {
          key: "nirin",
          file: "503a_nirin.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["二輪を除く"] } },
        },
        {
          key: "taxi",
          file: "503a_taxi.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["タクシーを除く"] } },
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "503-B",
    name: "車両の種類",
    plate: "PlateAux60x25",
    art: {
      by: "texture",
      file: "503b_truck.png",
      paint: { fn: "auxiliary.vehicle_plate" },
      variants: [
        {
          key: "bus",
          file: "503b_bus.png",
          paint: { fn: "auxiliary.vehicle_plate", args: { names: ["bus_side"] } },
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "503-C",
    name: "車両の種類",
    plate: "PlateAux60x38",
    art: { by: "texture", file: "503c.png", paint: { fn: "auxiliary.load_plate" } },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
    note: "図に寸法の記載がなく、交通規制基準にも例が無いため図の縦横比から 60 × 38 cm とした",
  },
  {
    id: "503-D",
    name: "車両の種類",
    plate: "PlateAux60x22",
    art: { by: "texture", file: "503d.png", paint: { fn: "auxiliary.badge_only" } },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "503の2",
    name: "遠隔操作型小型車",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "503-2.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["遠隔小型"] } },
      variants: [
        {
          key: "jogai",
          file: "503-2_jogai.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["遠隔小型を除く"] } },
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "504",
    name: "駐車余地",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "504.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["駐車余地6m"] } },
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "504の2",
    name: "駐車時間制限",
    plate: "PlateAux60x32",
    art: {
      by: "texture",
      file: "504-2.png",
      paint: { fn: "auxiliary.parking_time" },
      variants: [
        {
          key: "ticket",
          file: "504-2_ticket.png",
          paint: { fn: "auxiliary.parking_time", args: { meter: false } },
        },
      ],
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "505-A",
    name: "始まり",
    plate: "PlateAux60x18",
    art: { by: "texture", file: "505a.png", paint: { fn: "auxiliary.arrow_plate", args: { kind: "right" } } },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "505-B",
    name: "始まり",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "505b.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["こ こ か ら"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "505-C",
    name: "始まり",
    plate: "PlateAux60x32",
    art: {
      by: "texture",
      file: "505c.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["区　域", "ここから"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "506",
    name: "区間内",
    plate: "PlateAux60x18",
    art: { by: "texture", file: "506.png", paint: { fn: "auxiliary.arrow_plate", args: { kind: "both" } } },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "506の2",
    name: "区域内",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "506-2.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["区 域 内"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "507-A",
    name: "終わり",
    plate: "PlateAux60x18",
    art: { by: "texture", file: "507a.png", paint: { fn: "auxiliary.arrow_plate", args: { kind: "left" } } },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "507-B",
    name: "終わり",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "507b.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["こ こ ま で"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "507-C",
    name: "終わり",
    plate: "PlateCircle40",
    art: { by: "texture", file: "507c.png", paint: { fn: "auxiliary.end_of_restriction" } },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "507-D",
    name: "終わり",
    plate: "PlateAux60x32",
    art: {
      by: "texture",
      file: "507d.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["区　域", "ここまで"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "508",
    name: "通学路",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "508.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["通　学　路"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "508の2",
    name: "追越し禁止",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "508-2.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["追越し禁止"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "509",
    name: "前方優先道路",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "509.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["前方優先道路"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "509の2",
    name: "踏切注意",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "509-2.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["踏切注意"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "509の3",
    name: "横風注意",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "509-3.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["横風注意"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "509の4",
    name: "動物注意",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "509-4.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["動物注意"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "509の5",
    name: "注意",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "509-5.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["注　　意"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "510",
    name: "注意事項",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "510.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["路肩弱し"] } },
      variants: [
        {
          key: "anzen-30",
          file: "510_anzen-30.png",
          paint: { fn: "auxiliary.safe_speed" },
          plate: "PlateAux30x30",
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "510の2",
    name: "規制理由",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "510-2.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["騒音防止区間"] } },
      variants: [
        {
          key: "hokosha",
          file: "510-2_hokosha.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["歩行者横断多し"] } },
        },
        {
          key: "taikosha",
          file: "510-2_taikosha.png",
          paint: { fn: "auxiliary.text_plate", args: { lines: ["対向車多し"] } },
        },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "511",
    name: "方向",
    plate: "PlateAux60x44",
    art: {
      by: "texture",
      file: "511_up_right.png",
      paint: { fn: "auxiliary.direction_plate" },
      variants: [
        {
          key: "up_left",
          file: "511_up_left.png",
          paint: { fn: "auxiliary.direction_plate", args: { angle: "up_left" } },
        },
        {
          key: "right",
          file: "511_right.png",
          paint: { fn: "auxiliary.direction_plate", args: { angle: "right" } },
        },
        {
          key: "left",
          file: "511_left.png",
          paint: { fn: "auxiliary.direction_plate", args: { angle: "left" } },
        },
        { key: "up", file: "511_up.png", paint: { fn: "auxiliary.direction_plate", args: { angle: "up" } } },
      ],
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "512",
    name: "地名",
    plate: "PlateAux60x32",
    art: {
      by: "texture",
      file: "512.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["小 諸 市", "本　町"] } },
    },
    variable: "text",
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "513",
    name: "始点",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "513.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["始　　　点"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
  {
    id: "514",
    name: "終点",
    plate: "PlateAux60x22",
    art: {
      by: "texture",
      file: "514.png",
      paint: { fn: "auxiliary.text_plate", args: { lines: ["終　　　点"] } },
    },
    sizeSource: AUX_SIZE_SOURCE,
  },
]);
