// 別表第一 of 道路標識、区画線及び道路標示に関する命令 as assets/signs/law-table.json: one row per 番号
// (ranges such as （３１１―Ａ～Ｆ） expanded) with its 種類, group and the 別表第二 figure, read from the
// e-Gov 法令 API v2 at a pinned revision (parsing: src/signs/lawTable.ts). This is the list the sign
// definitions are checked against (tests/signRegistry.test.ts); scripts/textures/signs/law_table.py
// reads it too. The file is only ever this script's output: do not edit it by hand.
// Run: pnpm exec tsx scripts/sign-law-table.ts [--from law_data.json]   (just fetch-sign-law-table)
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { log } from "../src/log.ts";
import { layoutJson } from "../src/signs/jsonLayout.ts";
import { buildLawTable, type LawData } from "../src/signs/lawTable.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "assets", "signs", "law-table.json");
const LAW_ID = "335M50004002003";
// Pinned: a new revision is a deliberate update (re-run with the new id and review the diff).
const REVISION = "335M50004002003_20260901_508M60000802003";
const API = `https://laws.e-gov.go.jp/api/2/law_data/${REVISION}?law_full_text_format=json`;

/** Figures written other than e-Gov gives them (none now; add with a Why not and a removal condition). */
const FIGURE_OVERRIDES: Readonly<Record<string, string | null>> = {};

async function lawData(): Promise<LawData> {
  const from = process.argv.indexOf("--from");
  const file = from >= 0 ? process.argv[from + 1] : undefined;
  const isFromFile = file !== undefined;
  if (isFromFile) return JSON.parse(await readFile(file, "utf8")) as LawData;
  const res = await fetch(API);
  const isFailed = !res.ok;
  if (isFailed) throw new Error(`${API}: HTTP ${res.status}`);
  return (await res.json()) as LawData;
}

async function main(): Promise<void> {
  const table = buildLawTable(await lawData(), {
    lawId: LAW_ID,
    revision: REVISION,
    figureOverrides: FIGURE_OVERRIDES,
  });
  await writeFile(OUT, layoutJson(table));
  log("sign_law_table_written", { file: relative(ROOT, OUT), revision: REVISION, signs: table.signs.length });
}

await main();
