// The sign review's sheets (標識の見本): every render of scripts/blender/sign_review.py on one sheet
// per angle, captioned with the 別表第一 number, the name and the standard size, so a reviewer goes
// through all the drawn numbers at once and opens a single render (or the 別表第二 figure, its URL
// in index.json) where something looks off.
//
//   pnpm exec tsx scripts/qa/signSheet.ts [.qa/signs]   (just render-sign-review runs it)
//
// Output: <dir>/sheet-<angle>.jpg (and .html).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escape, writeSheet } from "./contactSheet.ts";

type Render = {
  id: string;
  variant: string | null;
  name: string;
  group: string;
  plate: string;
  sizeMm: [number, number] | null;
  angleDeg: number;
  image: string;
};

const dir = process.argv[2] ?? join(import.meta.dirname, "..", "..", ".qa", "signs");
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as {
  angles: number[];
  renders: Render[];
};
for (const angle of index.angles) {
  const items = index.renders
    .filter((r) => r.angleDeg === angle)
    .map((r) => ({
      image: r.image,
      isFlagged: false,
      captionHtml: `<b>${escape(r.id)}${r.variant ? ` ~${escape(r.variant)}` : ""}</b> ${escape(r.name)}<br>${escape(r.group)} · ${r.sizeMm ? `${r.sizeMm[0]}×${r.sizeMm[1]} mm` : "–"} · ${escape(r.plate)}`,
    }));
  const file = await writeSheet(dir, items, {
    title: `標識の見本 ${angle}°`,
    name: `sheet-${angle}`,
    columns: 10,
    thumbW: 180,
  });
  process.stdout.write(`${file}\n`);
}
