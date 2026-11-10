import { describe, expect, it } from "vitest";
import {
  buildLawTable,
  figures,
  grid,
  MIN_SIGNS,
  numbers,
  table1,
  type LawNode,
} from "../src/signs/lawTable";

// Small hand-made tables in the e-Gov law_data shape ({tag, attr, children}).
const node = (
  tag: string,
  children: Array<LawNode | string> = [],
  attr: Record<string, string> = {},
): LawNode => ({
  tag,
  attr,
  children,
});
const col = (content: string | LawNode, attr: Record<string, string> = {}) =>
  node("TableColumn", [node("Sentence", [content])], attr);
const fig = (file: string, attr: Record<string, string> = {}) =>
  node("TableColumn", [node("FigStruct", [node("Fig", [], { src: `./pict/${file}` })])], attr);
const row = (...cols: LawNode[]) => node("TableRow", cols);
const appendix = (title: string, structs: LawNode[]) =>
  node("AppdxTable", [node("AppdxTableTitle", [title]), ...structs]);
const struct = (title: string, rows: LawNode[]) =>
  node("TableStruct", [node("TableStructTitle", [title]), node("Table", rows)]);
const law = (...tables: LawNode[]) => node("Law", [node("LawBody", tables)]);

describe("numbers (the 番号 of a cell)", () => {
  it("reads a single number and expands ・ lists and ～ (U+FF5E) ranges", () => {
    expect(numbers("市町村（１０１）")).toEqual(["101"]);
    expect(numbers("（１０３―Ａ・Ｂ）")).toEqual(["103-A", "103-B"]);
    expect(numbers("（３１１―Ａ～Ｆ）")).toEqual(["311-A", "311-B", "311-C", "311-D", "311-E", "311-F"]);
    expect(numbers("（３２７の４の２）")).toEqual(["327の4の2"]);
  });

  it("reads every number of a cell holding two, and none from a header", () => {
    expect(numbers("大型貨物自動車等通行止め（３０５）特定の…通行止め（３０５の２）")).toEqual([
      "305",
      "305の2",
    ]);
    expect(numbers("種類")).toEqual([]);
  });
});

describe("table1 (別表第一)", () => {
  const t = law(
    appendix("別表第一（第二条関係）", [
      struct("案内標識", [
        row(col("種類"), col("番号"), col("設置場所")),
        row(col("都府県", { rowspan: "2" }), col("（１０２―Ａ）"), col("境界")),
        row(col("（１０２―Ｂ）"), col("境界")),
      ]),
      struct("規制標識", [
        row(col("種類"), col("番号"), col("意味"), col("設置場所")),
        row(col(node("Ruby", ["勾", node("Rt", ["こう"])])), col("（３１１―Ａ～Ｂ）"), col("…"), col("…")),
      ]),
    ]),
  );

  it("carries a 種類 spanning rows down, whatever the number of columns, without ruby readings", () => {
    expect(table1(t)).toEqual([
      { id: "102-A", name: "都府県", group: "案内" },
      { id: "102-B", name: "都府県", group: "案内" },
      { id: "311-A", name: "勾", group: "規制" },
      { id: "311-B", name: "勾", group: "規制" },
    ]);
  });

  it("refuses a group title it does not know", () => {
    expect(() => table1(law(appendix("別表第一", [struct("謎標識", [])])))).toThrow(/unknown sign group 謎/);
  });
});

describe("grid and figures (別表第二)", () => {
  // Captions: 304 (rowspan 2, colspan 2) | 305 | 306 (colspan 2); below 305 a second caption 305の2.
  // Figures under them with other colspans than the captions (as e-Gov writes 125-A / 125-B).
  const t = appendix("別表第二（第三条関係）", [
    struct("規制標識", [
      row(
        col("（３０４）", { rowspan: "2", colspan: "2" }),
        col("（３０５）"),
        col("（３０６）", { colspan: "2" }),
      ),
      row(col("（３０５の２）")),
      row(fig("a.jpg", { colspan: "2" }), fig("b.jpg"), fig("c.jpg", { colspan: "2" })),
      row(col("（１２５―Ａ）", { colspan: "3" }), col("（１２５―Ｂ）")),
      row(fig("d.jpg", { colspan: "2" }), fig("e.jpg", { colspan: "2" })),
    ]),
  ]);

  it("places a cell after the columns a rowspan above still holds", () => {
    const cells = grid(t);
    expect(cells[1].map((c) => [c.ids, c.col])).toEqual([[["305の2"], 2]]);
    expect(cells[2].map((c) => [c.fig, c.col, c.span])).toEqual([
      ["a.jpg", 0, 2],
      ["b.jpg", 2, 1],
      ["c.jpg", 3, 2],
    ]);
  });

  it("gives a figure to every caption above it that starts within its columns", () => {
    expect(Object.fromEntries(figures(law(t)))).toEqual({
      "304": "a.jpg",
      "305": "b.jpg",
      "305の2": "b.jpg",
      "306": "c.jpg",
      "125-A": "d.jpg",
      "125-B": "e.jpg",
    });
  });
});

/** law_data holding these 規制標識 rows in 別表第一 and an empty 別表第二. */
const data = (rows: LawNode[]) => ({
  revision_info: { law_title: "試験の命令" },
  law_full_text: law(appendix("別表第一", [struct("規制標識", rows)]), appendix("別表第二", [])),
});

describe("buildLawTable", () => {
  it(`refuses a parse with fewer than ${MIN_SIGNS} rows (a table that was not read)`, () => {
    const opts = { lawId: "335M50004002003", revision: "r" };
    expect(() => buildLawTable(data([row(col("通行止め"), col("（３０１）"))]), opts)).toThrow(/gave 1 rows/);
  });

  it("writes the figure overrides it is given, and refuses one for a number it does not have", () => {
    const many = Array.from({ length: MIN_SIGNS }, (_, i) =>
      row(col(`種類${i}`), col(`（${String(100 + i)}）`)),
    );
    const opts = { lawId: "335M50004002003", revision: "r", figureOverrides: { "100": "x.jpg" } };
    const table = buildLawTable(data(many), opts);
    expect(table.signs[0]).toEqual({ id: "100", name: "種類0", group: "規制", figure: "x.jpg" });
    expect(table.signs[1].figure).toBeNull();
    expect(() => buildLawTable(data(many), { ...opts, figureOverrides: { "999": null } })).toThrow(/999/);
  });
});
