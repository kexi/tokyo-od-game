import { describe, expect, it } from "vitest";
import type { BoxNode, Measure, TextBox } from "../src/signs/board/boxes";
import {
  BoardContentSchema,
  boardKey,
  boardNames,
  templateOf,
  type BoardContent,
  type RowsContent,
} from "../src/signs/board/content";
import {
  baseLetter,
  enlargement,
  inArrowHeight,
  letterHeight,
  romanHeight,
} from "../src/signs/board/letters";
import { keepValidBoards, layoutBoard, parseBoardContent } from "../src/signs/board/layout";
import { LETTER_ENLARGEMENTS } from "../src/signs/boardStandards";
import { boardPriority } from "../src/world/boardPriority";

/**
 * The 案内標識 layouter (src/signs/board/, knowledge/sign-system.md「案内標識のレイアウタ（G5）」):
 * content checked by its schema, letters by the 命令, and every template laid out as boxes in cm
 * that stay on the board. A fixed text advance stands in for the canvas (a 漢字 one em, Latin 0.6).
 */

/** px width: 漢字 and kana 1 em, everything else 0.6 em (the font's px size is in the string). */
const measure: Measure = (font, text) => {
  const px = Number(/ (\d+)px /.exec(font)?.[1] ?? 0);
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 0x2fff ? px : 0.6 * px;
  return w;
};

const name = (ja: string, en = "", expressway = false) => ({ ja, en, expressway });
/** Numbers to 0.01 cm, for a snapshot that does not hang on the last bits. */
const round = (v: unknown): unknown =>
  typeof v === "number"
    ? Math.round(v * 100) / 100
    : Array.isArray(v)
      ? v.map(round)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;
const texts = (nodes: BoxNode[]) => nodes.filter((n): n is TextBox => n.type === "text").map((n) => n.text);

const JUNCTION: BoardContent = {
  kind: "108の2-A",
  arms: [
    { angle: 0, names: [name("日本橋", "Nihonbashi"), name("上野", "Ueno")], shields: [], street: null },
    {
      angle: 90,
      names: [name("新宿", "Shinjuku")],
      shields: [{ kind: "national", number: "20" }],
      street: null,
    },
    { angle: -90, names: [name("晴海", "Harumi")], shields: [], street: "晴海通り" },
  ],
  distance: null,
  letter: 30,
};
const CONFIRM: RowsContent = {
  kind: "106-A",
  rows: [
    { angle: null, name: name("日本橋", "Nihonbashi"), km: 10 },
    { angle: null, name: name("日比谷", "Hibiya"), km: 7 },
  ],
  letter: 30,
};
const DIRECTION: RowsContent = {
  kind: "105-A",
  rows: [
    { angle: 0, name: name("国分寺", "Kokubunji"), km: 4 },
    { angle: -90, name: name("調布", "Chofu"), km: 5 },
    { angle: 90, name: name("立川", "Tachikawa"), km: 7 },
  ],
  letter: 20,
};
const EXIT: BoardContent = {
  kind: "110-B",
  names: [],
  exitName: name("西神田", "Nishikanda"),
  number: "501",
  distance: 400,
  angle: 45,
  letter: 30,
};
const ENTRANCE: BoardContent = {
  kind: "104",
  operator: "guide.operator",
  route: { kind: "route", number: "5" },
  entranceName: name("代官町", "Daikancho"),
  names: [],
  angle: null,
  distance: 150,
  letter: 20,
};
const DIAGRAM: BoardContent = {
  kind: "108の2-C",
  arms: [
    { angle: 0, names: [name("名古屋", "Nagoya")], shields: [], street: null },
    { angle: 90, names: [name("大垣", "Ogaki")], shields: [{ kind: "route", number: "C1" }], street: null },
  ],
  distance: 300,
  letter: 30,
};
const ALL = [JUNCTION, CONFIRM, DIRECTION, EXIT, ENTRANCE, DIAGRAM];

describe("letter heights (別表第二 備考一(五)2・3)", () => {
  it("takes 10 / 20 / 30 cm by the design speed's band", () => {
    expect(baseLetter(30)).toBe(10);
    expect(baseLetter(40)).toBe(20);
    expect(baseLetter(60)).toBe(20);
    expect(baseLetter(70)).toBe(30);
  });

  it("enlarges by 1.5 on two lanes or more below 70 km/h, and only by steps the 命令 lists", () => {
    expect(enlargement(50, 2)).toBe(1.5);
    expect(enlargement(50, 1)).toBe(1);
    expect(enlargement(80, 3)).toBe(1);
    expect(LETTER_ENLARGEMENTS.value).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it("keeps the heights the 108 series had: 15 / 30 / 30 wide, 10 / 20 / 30 narrow", () => {
    expect([30, 50, 80].map((v) => letterHeight(v, 2))).toEqual([15, 30, 30]);
    expect([30, 50, 80].map((v) => letterHeight(v, 1))).toEqual([10, 20, 30]);
  });

  it("writes ローマ字 at half and the letters inside an arrow at 0.6", () => {
    expect(romanHeight(30)).toBe(15);
    expect(inArrowHeight(30)).toBeCloseTo(18);
  });
});

describe("board content (zod)", () => {
  it("accepts every template's example and tells its template by the number", () => {
    for (const c of ALL) expect(BoardContentSchema.safeParse(c).success, c.kind).toBe(true);
    expect(ALL.map((c) => templateOf(c.kind))).toEqual([
      "junction-diagram",
      "rows",
      "rows",
      "exit",
      "entrance",
      "expressway-diagram",
    ]);
  });

  it("rejects a board without arms, a 106 with four rows and a real operator's name", () => {
    expect(parseBoardContent({ ...JUNCTION, arms: [] }).success).toBe(false);
    const four = { ...CONFIRM, rows: [...CONFIRM.rows, ...CONFIRM.rows] };
    expect(parseBoardContent(four).success).toBe(false);
    expect(parseBoardContent({ ...ENTRANCE, operator: "首都高速" }).success).toBe(false);
  });

  it("keys two equal contents to one face whatever order their properties were written in", () => {
    const reordered = {
      letter: JUNCTION.letter,
      distance: JUNCTION.distance,
      arms: JUNCTION.arms.map(({ street, shields, names, angle }) => ({ street, shields, names, angle })),
      kind: JUNCTION.kind,
    } as BoardContent;
    expect(boardKey(reordered)).toBe(boardKey(JUNCTION));
    expect(boardKey({ ...JUNCTION, letter: 20 })).not.toBe(boardKey(JUNCTION));
  });

  it("stands only the boards that pass the schema and reports why the others fail", () => {
    const reported: Array<{ kind: string; paths: string[] }> = [];
    const kept = keepValidBoards(
      [{ board: JUNCTION }, { board: { ...JUNCTION, arms: [] } }, { board: CONFIRM }],
      (item, issues) => reported.push({ kind: item.board.kind, paths: issues.map((i) => i.path) }),
    );
    expect(kept.map((k) => k.board)).toEqual([JUNCTION, CONFIRM]);
    expect(kept[0].board).toBe(JUNCTION); // kept as it was, not zod's copy
    expect(reported).toEqual([{ kind: JUNCTION.kind, paths: ["arms"] }]);
  });

  it("lists the places a board names in reading order", () => {
    expect(boardNames(JUNCTION).map((n) => n.ja)).toEqual(["日本橋", "上野", "新宿", "晴海"]);
    expect(boardNames(CONFIRM).map((n) => n.ja)).toEqual(["日本橋", "日比谷"]);
    expect(boardNames(EXIT).map((n) => n.ja)).toEqual(["西神田"]);
  });
});

describe("layout (boxes in cm)", () => {
  it("keeps every box of every template on the board", () => {
    for (const c of ALL) {
      const l = layoutBoard(c, measure);
      const isInside = (x: number, y: number) =>
        x >= -1e-6 && y >= -1e-6 && x <= l.width + 1e-6 && y <= l.height + 1e-6;
      for (const n of l.nodes) {
        const points =
          n.type === "text" || n.type === "shield" || n.type === "street"
            ? [[n.x, n.y]]
            : n.type === "field"
              ? [
                  [n.x, n.y],
                  [n.x + n.w, n.y + n.h],
                ]
              : n.type === "arrow"
                ? [
                    [n.tail.x, n.tail.y],
                    [n.tip.x, n.tip.y],
                  ]
                : n.type === "rule"
                  ? [
                      [n.from.x, n.from.y],
                      [n.to.x, n.to.y],
                    ]
                  : n.type === "junction-arrows"
                    ? n.tips.map((t) => [t.x, t.y])
                    : [];
        for (const [x, y] of points) expect(isInside(x, y), `${c.kind} ${n.type} at ${x}, ${y}`).toBe(true);
      }
    }
  });

  it("sizes the 108の2-A at 280 × 220 cm for 30 cm letters (国土交通省 Q&A4)", () => {
    const l = layoutBoard(JUNCTION, measure);
    expect(l.width).toBeCloseTo(280);
    expect(l.height).toBeCloseTo(220);
  });

  it("sizes the two-place 106-A 200 cm tall and at least 240 cm wide for 30 cm letters (確認標識, Q&A4)", () => {
    const l = layoutBoard(CONFIRM, measure);
    expect(l.height).toBeCloseTo(200, 0);
    expect(l.width).toBeGreaterThanOrEqual(240);
  });

  it("draws a 106 with one arrow up the left and the farthest place on top", () => {
    const l = layoutBoard(CONFIRM, measure);
    const arrows = l.nodes.filter((n) => n.type === "arrow");
    expect(arrows).toHaveLength(1);
    const ys = new Map(l.nodes.filter((n): n is TextBox => n.type === "text").map((t) => [t.text, t.y]));
    expect(ys.get("日本橋") ?? 0).toBeLessThan(ys.get("日比谷") ?? 0);
  });

  it("puts a 105's right arrow at the right with its distance at the left, rules between rows (図 008)", () => {
    const l = layoutBoard(DIRECTION, measure);
    expect(l.nodes.filter((n) => n.type === "rule")).toHaveLength(2);
    const arrows = l.nodes.filter((n) => n.type === "arrow");
    expect(arrows).toHaveLength(3);
    const right = arrows.find((a) => a.type === "arrow" && a.tip.x > a.tail.x + 1);
    expect(right && right.type === "arrow" ? right.tip.x : 0).toBeGreaterThan(l.width / 2);
    const fives = l.nodes.filter((n): n is TextBox => n.type === "text" && n.text === "5");
    expect(fives[0]?.x ?? Infinity).toBeLessThan(l.width / 2);
  });

  it("writes the 通称名 inside the arrow and the 国道番号 on its arm", () => {
    const l = layoutBoard(JUNCTION, measure);
    expect(l.nodes.some((n) => n.type === "street" && n.text === "晴海通り")).toBe(true);
    expect(l.nodes.some((n) => n.type === "shield" && n.shield.number === "20")).toBe(true);
  });

  it("puts the exit number on a white plate with green figures (110-B)", () => {
    const l = layoutBoard(EXIT, measure);
    expect(l.nodes[0]).toMatchObject({ type: "background", field: "green" });
    expect(l.nodes.some((n) => n.type === "field" && n.fill === "white")).toBe(true);
    expect(l.nodes.some((n) => n.type === "text" && n.text === "501" && n.colour === "green")).toBe(true);
    expect(texts(l.nodes)).toEqual(expect.arrayContaining(["西神田", "出口", "400m"]));
  });

  it("names the operator by its i18n key, never by a real operator's name (103・104)", () => {
    const l = layoutBoard(ENTRANCE, measure);
    const all = texts(l.nodes).join(" ");
    expect(all).toContain("都市高速");
    expect(all).toContain("TOSHI EXPWY");
    expect(all).not.toMatch(/首都高|阪神高速|名古屋高速|福岡北九州|広島高速/);
    expect(l.nodes.some((n) => n.type === "shield" && n.shield.kind === "route")).toBe(true);
  });

  it("lays out the same content to the same boxes (a snapshot of each template)", () => {
    for (const c of ALL) {
      const { width, height, nodes } = layoutBoard(c, measure);
      expect(round({ width, height, nodes })).toMatchSnapshot(c.kind);
    }
  });
});

describe("the board face pool's priority (apparent size × facing)", () => {
  it("wants a board that looks larger and faces the eye first", () => {
    const near = boardPriority({ width: 3, distance: 50, facing: 1, isOtherLevel: false });
    const far = boardPriority({ width: 3, distance: 200, facing: 1, isOtherLevel: false });
    const oblique = boardPriority({ width: 3, distance: 50, facing: 0.3, isOtherLevel: false });
    expect(near).toBeLessThan(far);
    expect(near).toBeLessThan(oblique);
  });

  it("puts a board on another level after every board on the eye's", () => {
    const deck = boardPriority({ width: 5, distance: 20, facing: 1, isOtherLevel: true });
    const street = boardPriority({ width: 2, distance: 390, facing: 0.1, isOtherLevel: false });
    expect(street).toBeLessThan(deck);
  });
});
