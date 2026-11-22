// The exit / JCT signs pointing at a mouth (R1-1b 3.5, R1-7's material): per mouth of a folder's
// scorecard, the signs on the parent's chunks whose target (s + beforeM) lies within 30 m of the
// mouth's s, counted by the parent's district.
//   pnpm exec tsx .qa/r1b_mouthsigns.mts <dir> <scorecard>
import { readFileSync } from "node:fs";
import { districtsOfFiles, readExpresswayFiles } from "../../scripts/expresswayFiles.ts";

const [dir, card] = process.argv.slice(2);
const files = readExpresswayFiles(dir);
const report = JSON.parse(readFileSync(card, "utf8"));
const district = districtsOfFiles(files);
const byDistrict: Record<string, { mouths: number; withSign: number; signs: number }> = {};
for (const m of report.ends.mouths) {
  const d = district.get(m.run) ?? "?";
  const row = (byDistrict[d] ??= { mouths: 0, withSign: 0, signs: 0 });
  row.mouths++;
  const signs = (files.byRun.get(m.run) ?? []).flatMap((c) =>
    (c.signs ?? []).filter(
      (sg) => (sg.ref.kind === "exit" || sg.ref.kind === "jct") && Math.abs(sg.s + sg.ref.beforeM - m.s) <= 30,
    ),
  );
  row.signs += signs.length;
  if (signs.length > 0) row.withSign++;
}
console.log(JSON.stringify(byDistrict));
