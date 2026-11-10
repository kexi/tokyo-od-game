import { LawTableSchema, SIGN_GROUPS, type LawTable, type SignGroup } from "./schema";

/**
 * Reading 別表第一 (番号・種類・群) and the 別表第二 figures out of the e-Gov 法令 API v2 law_data JSON,
 * as pure functions over its node tree: scripts/sign-law-table.ts fetches and writes, the tests
 * feed small hand-made tables (tests/signLawTable.test.ts).
 */

/** A node of law_full_text: {tag, attr, children}, children being nodes or text. */
export type LawNode = { tag: string; attr: Record<string, string>; children: Array<LawNode | string> };
export type LawData = { revision_info: { law_title: string }; law_full_text: LawNode };

/**
 * 別表第一 has 237 rows at the pinned revision; a parse that finds far fewer has
 * lost a table (a changed column layout, a renamed title) rather than met a smaller law.
 */
export const MIN_SIGNS = 200;

const isNode = (c: LawNode | string): c is LawNode => typeof c !== "string";
const childNodes = (n: LawNode, tag?: string) =>
  n.children.filter(isNode).filter((c) => tag === undefined || c.tag === tag);

function descendants(n: LawNode, tag: string, out: LawNode[] = []): LawNode[] {
  for (const c of childNodes(n)) {
    if (c.tag === tag) out.push(c);
    descendants(c, tag, out);
  }
  return out;
}

/** The text of a node without ruby readings (勾＜こう＞配 → 勾配), as law_table.py had it. */
export function text(n: LawNode | string): string {
  if (typeof n === "string") return n;
  const isReading = n.tag === "Rt";
  if (isReading) return "";
  return n.children.map(text).join("");
}

/**
 * The 番号 in a cell, ranges expanded: （１０３―Ａ・Ｂ） → 103-A, 103-B; （３１１―Ａ～Ｆ） → 311-A…F.
 * NFKC makes the digits, letters, brackets and the fullwidth tilde ～ (U+FF5E) ASCII; the dash
 * ― (U+2015) it leaves alone, so it is replaced by hand.
 */
export function numbers(cell: string): string[] {
  const plain = cell.normalize("NFKC").replaceAll("―", "-");
  const out: string[] = [];
  for (const m of plain.matchAll(/\((\d{3}(?:の\d+)*)(?:-([A-Z](?:[・~][A-Z])*))?\)/g)) {
    const [, base, letters] = m;
    const hasLetters = letters !== undefined;
    if (!hasLetters) {
      out.push(base);
      continue;
    }
    for (const part of letters.split("・")) {
      const [from, to = from] = part.split("~");
      for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++)
        out.push(`${base}-${String.fromCharCode(c)}`);
    }
  }
  return out;
}

function appendix(law: LawNode, title: string): LawNode {
  const found = descendants(law, "AppdxTable").find((t) =>
    childNodes(t, "AppdxTableTitle").some((h) => text(h).startsWith(title)),
  );
  const isMissing = found === undefined;
  if (isMissing) throw new Error(`no ${title} in the law data`);
  return found;
}

/** 案内標識 → 案内. */
function groupOf(struct: LawNode): SignGroup {
  const title = childNodes(struct, "TableStructTitle")
    .map(text)
    .join("")
    .replace(/標識$/, "");
  const known = SIGN_GROUPS.find((g) => g === title);
  const isUnknown = known === undefined;
  if (isUnknown) throw new Error(`unknown sign group ${title}`);
  return known;
}

export type LawRow = { id: string; name: string; group: SignGroup };

/** 別表第一: 種類 (spanning rows), 番号, then 設置場所 (and 意味 for 規制・指示). */
export function table1(law: LawNode): LawRow[] {
  const rows: LawRow[] = [];
  for (const struct of childNodes(appendix(law, "別表第一"), "TableStruct")) {
    const group = groupOf(struct);
    let name = "";
    for (const row of descendants(struct, "TableRow")) {
      const cells = childNodes(row, "TableColumn").map(text);
      // Why not count the cells: the tables differ in columns (意味 only in some). A row under a
      // spanning 種類 starts with the 番号; the header row has no 番号 at all.
      const startsWithNumber = numbers(cells[0] ?? "").length > 0;
      if (!startsWithNumber) name = cells[0] ?? "";
      for (const id of numbers((startsWithNumber ? cells[0] : cells[1]) ?? ""))
        rows.push({ id, name, group });
    }
  }
  return rows;
}

export type GridCell = { row: number; col: number; span: number; ids: string[]; fig: string | undefined };

/** The cells of a table on its grid: the column each starts at, after the rowspans above it. */
export function grid(table: LawNode): GridCell[][] {
  const taken = new Map<number, Set<number>>(); // row → columns held by a rowspan from above
  return descendants(table, "TableRow").map((row, r) => {
    let col = 0;
    return childNodes(row, "TableColumn").map((cell) => {
      while (taken.get(r)?.has(col)) col++;
      const span = Number(cell.attr.colspan ?? 1);
      const down = Number(cell.attr.rowspan ?? 1);
      for (let k = 1; k < down; k++) {
        const held = taken.get(r + k) ?? new Set<number>();
        for (let c = col; c < col + span; c++) held.add(c);
        taken.set(r + k, held);
      }
      const fig = descendants(cell, "Fig")[0]?.attr.src?.replace(/^\.\/pict\//, "");
      const out = { row: r, col, span, ids: numbers(text(cell)), fig };
      col += span;
      return out;
    });
  });
}

/**
 * 別表第二 figures: rows of captions 「種類（番号）」 above a row of figures. A figure belongs to the
 * captions of the rows above it (up to the previous row of figures) that start within its columns.
 * Why not pair the cells by index: captions and figures often differ in colspan, and a caption with
 * rowspan 2 sits beside a second caption row (305 and 305の2 share one figure).
 */
export function figures(law: LawNode): Map<string, string> {
  const out = new Map<string, string>();
  const rows = grid(appendix(law, "別表第二"));
  let captions: GridCell[] = [];
  for (const row of rows) {
    const isFigureRow = row.some((c) => c.fig !== undefined);
    if (!isFigureRow) {
      captions.push(...row.filter((c) => c.ids.length > 0));
      continue;
    }
    for (const cell of row) {
      const fig = cell.fig;
      if (fig === undefined) continue;
      const isUnder = (c: GridCell) => c.col >= cell.col && c.col < cell.col + cell.span;
      for (const id of captions.filter(isUnder).flatMap((c) => c.ids)) if (!out.has(id)) out.set(id, fig);
    }
    captions = [];
  }
  return out;
}

export type LawTableOptions = {
  lawId: string;
  revision: string;
  /** Figures to write other than the law data says (with the reason at the call site). */
  figureOverrides?: Readonly<Record<string, string | null>>;
};

/** The law table (assets/signs/law-table.json) from the law data. */
export function buildLawTable(data: LawData, opts: LawTableOptions): LawTable {
  const law = data.law_full_text;
  const rows = table1(law);
  const isTooFew = rows.length < MIN_SIGNS;
  if (isTooFew) throw new Error(`別表第一 gave ${rows.length} rows (< ${MIN_SIGNS}): the table was not read`);
  const figs = figures(law);
  const overrides = opts.figureOverrides ?? {};
  const unknownOverrides = Object.keys(overrides).filter((id) => !rows.some((r) => r.id === id));
  const hasUnknownOverride = unknownOverrides.length > 0;
  if (hasUnknownOverride)
    throw new Error(`figure overrides for numbers not in 別表第一: ${unknownOverrides}`);
  const figureOf = (id: string) => (id in overrides ? overrides[id] : (figs.get(id) ?? null));
  return LawTableSchema.parse({
    law: {
      id: opts.lawId,
      title: data.revision_info.law_title,
      revision: opts.revision,
      url: `https://laws.e-gov.go.jp/law/${opts.lawId}`,
      figureUrl: `https://laws.e-gov.go.jp/api/2/attachment/${opts.revision}?src=./pict/{}`,
    },
    signs: rows.map((r) => ({ ...r, figure: figureOf(r.id) })),
  });
}
