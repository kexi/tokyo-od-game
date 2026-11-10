// Converted once from assets/signs/catalog.json (G1a, knowledge/sign-system.md); this file is the
// definition now: edit it, then `just make-sign-registry`.
import { group } from "../schema";

export const WARNING = group("警戒", [
  {
    id: "201-A",
    name: "┼形道路交差点あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "201a.png", paint: { fn: "warning.crossroads" } },
  },
  {
    id: "201-B",
    name: "├形（又は┤形）道路交差点あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "201b_right.png",
      paint: { fn: "warning.side_road" },
      variants: [
        { key: "left", file: "201b_left.png", paint: { fn: "warning.side_road", args: { left: true } } },
      ],
    },
  },
  {
    id: "201-C",
    name: "Ｔ形道路交差点あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "201c.png", paint: { fn: "warning.t_junction" } },
  },
  {
    id: "201-D",
    name: "Ｙ形道路交差点あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "201d.png", paint: { fn: "warning.y_junction" } },
  },
  {
    id: "201の2",
    name: "ロータリーあり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "201-2.png", paint: { fn: "warning.rotary" } },
  },
  {
    id: "202",
    name: "右（又は左）方屈曲あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "202_right.png",
      paint: { fn: "warning.bend" },
      variants: [{ key: "left", file: "202_left.png", paint: { fn: "warning.bend", args: { left: true } } }],
    },
  },
  {
    id: "203",
    name: "右（又は左）方屈折あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "203_right.png",
      paint: { fn: "warning.sharp_bend" },
      variants: [
        { key: "left", file: "203_left.png", paint: { fn: "warning.sharp_bend", args: { left: true } } },
      ],
    },
  },
  {
    id: "204",
    name: "右（又は左）背向屈曲あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "204_right.png",
      paint: { fn: "warning.reverse_bend" },
      variants: [
        { key: "left", file: "204_left.png", paint: { fn: "warning.reverse_bend", args: { left: true } } },
      ],
    },
  },
  {
    id: "205",
    name: "右（又は左）背向屈折あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "205_right.png",
      paint: { fn: "warning.reverse_sharp_bend" },
      variants: [
        {
          key: "left",
          file: "205_left.png",
          paint: { fn: "warning.reverse_sharp_bend", args: { left: true } },
        },
      ],
    },
  },
  {
    id: "206",
    name: "右（又は左）つづら折りあり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "206_right.png",
      paint: { fn: "warning.winding" },
      variants: [
        { key: "left", file: "206_left.png", paint: { fn: "warning.winding", args: { left: true } } },
      ],
    },
  },
  {
    id: "207-A",
    name: "踏切あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "207a.png", paint: { fn: "warning.level_crossing" } },
  },
  {
    id: "207-B",
    name: "踏切あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "207b.png",
      paint: { fn: "warning.level_crossing", args: { electric: true } },
    },
  },
  {
    id: "208",
    name: "学校、幼稚園、保育所等あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "208.png", paint: { fn: "warning.school" } },
    game: { kind: "school" },
  },
  {
    id: "208の2",
    name: "信号機あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "208-2.png",
      paint: { fn: "warning.traffic_signal" },
      variants: [
        {
          key: "vertical",
          file: "208-2_vertical.png",
          paint: { fn: "warning.traffic_signal", args: { vertical: true } },
        },
      ],
    },
  },
  {
    id: "209",
    name: "すべりやすい",
    plate: "PlateDiamond",
    art: { by: "texture", file: "209.png", paint: { fn: "warning.slippery" } },
  },
  {
    id: "209の2",
    name: "落石のおそれあり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "209-2.png",
      paint: { fn: "warning.rockfall" },
      variants: [
        { key: "mirror", file: "209-2_mirror.png", paint: { fn: "warning.rockfall", args: { left: true } } },
      ],
    },
  },
  {
    id: "209の3",
    name: "路面凹凸あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "209-3.png", paint: { fn: "warning.bumpy" } },
  },
  {
    id: "210",
    name: "合流交通あり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "210.png",
      paint: { fn: "warning.merge" },
      variants: [
        { key: "mirror", file: "210_mirror.png", paint: { fn: "warning.merge", args: { left: true } } },
      ],
    },
  },
  {
    id: "211",
    name: "車線数減少",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "211.png",
      paint: { fn: "warning.lanes_reduce" },
      variants: [
        {
          key: "mirror",
          file: "211_mirror.png",
          paint: { fn: "warning.lanes_reduce", args: { left: true } },
        },
      ],
    },
  },
  {
    id: "212",
    name: "幅員減少",
    plate: "PlateDiamond",
    art: { by: "texture", file: "212.png", paint: { fn: "warning.road_narrows" } },
  },
  {
    id: "212の2",
    name: "二方向交通",
    plate: "PlateDiamond",
    art: { by: "texture", file: "212-2.png", paint: { fn: "warning.two_way" } },
  },
  {
    id: "212の3",
    name: "上り急勾配あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "212-3_10.png", paint: { fn: "warning.gradient" } },
    variable: "text",
  },
  {
    id: "212の4",
    name: "下り急勾配あり",
    plate: "PlateDiamond",
    art: { by: "texture", file: "212-4_10.png", paint: { fn: "warning.gradient", args: { up: false } } },
    variable: "text",
  },
  {
    id: "213",
    name: "道路工事中",
    plate: "PlateDiamond",
    art: { by: "texture", file: "213.png", paint: { fn: "warning.road_works" } },
  },
  {
    id: "214",
    name: "横風注意",
    plate: "PlateDiamond",
    art: { by: "texture", file: "214.png", paint: { fn: "warning.crosswind" } },
  },
  {
    id: "214の2",
    name: "動物が飛び出すおそれあり",
    plate: "PlateDiamond",
    art: {
      by: "texture",
      file: "214-2.png",
      paint: { fn: "warning.animals" },
      variants: [
        { key: "mirror", file: "214-2_mirror.png", paint: { fn: "warning.animals", args: { left: true } } },
      ],
    },
  },
  {
    id: "215",
    name: "その他の危険",
    plate: "PlateDiamond",
    art: { by: "texture", file: "215.png", paint: { fn: "warning.danger" } },
  },
]);
