// 使い方: pnpm exec tsx .qa/r13/records.mts <ラベル>...
// 記録だけの物（指示書 手順 3）: 麻布台の穴の多角形（737538573:2 の boreHoles、頂点の数と面積）と、
// 895902565 の s 60〜80 の橋脚（piers の s）。合否にしない。
import { readExpresswayFiles } from "../../scripts/expresswayFiles.ts";
import { latToTileY, lonToTileX } from "../../src/geo/tiles.ts";
import { boreHoles } from "../../src/world/expresswayBore.ts";

const root = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a3643aa5cb7a2eb02";
const Z = 16;
const EARTH_M = 40075016.686;
for (const label of process.argv.slice(2)) {
  const dir =
    label === "default" ? `${root}/public/data/expressway` : `${root}/.cache/expressway-area/${label}`;
  const files = readExpresswayFiles(dir);
  const bore = files.chunks.find((c) => c.id === "737538573:2");
  const holes = bore ? boreHoles(bore, (lon, lat) => [lonToTileX(lon, Z), latToTileY(lat, Z)]) : [];
  // Shoelace in tile units, to m² by the tile's size at the chunk's latitude.
  const lat = bore ? bore.st[2] : 35.66;
  const tileM = (EARTH_M * Math.cos((lat * Math.PI) / 180)) / 2 ** Z;
  const polys = holes.map((p) => {
    const r = p[0];
    let a = 0;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      a += r[i] * r[j + 1] - r[j] * r[i + 1];
    }
    return { vertices: r.length / 2, areaM2: Math.round(Math.abs(a / 2) * tileM * tileM) };
  });
  const piers = files.chunks
    .filter((c) => c.run === "895902565")
    .flatMap((c) => {
      const out: number[] = [];
      for (let i = 0; i < c.piers.length; i += 2) out.push(c.piers[i]);
      return out;
    })
    .filter((s) => s >= 50 && s <= 100)
    .map((s) => Math.round(s * 10) / 10);
  console.log(JSON.stringify({ label, azabudaiHole: polys, piers895902565_50to100: piers }));
}
