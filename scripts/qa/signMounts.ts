// The mounting of each plate for the sign review (標識の見本, scripts/blender/sign_review.py): one plate
// at its real size on a single post, resolved by the game's own resolveMount, its members placed
// relative to the plate's face centre. sign_review.py builds the post, cap, rail and band from
// signs.glb's unit members with these, so the review shows the mounting the game draws.
//
//   pnpm exec tsx scripts/qa/signMounts.ts [.qa/signs]   (just render-sign-review runs it first)
//
// Output: <dir>/mounts.json { <plate node>: { members: [{ node, at: [x, y, z], scale: [x, y, z] }] } }.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../src/log.ts";
import { MEMBER_NODES, resolveMount } from "../../src/signs/mount.ts";
import { SIGN_KERB } from "../../src/signs/mountAssumptions.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const dir = process.argv[2] ?? join(ROOT, ".qa", "signs");
const registry = JSON.parse(readFileSync(join(ROOT, "assets", "signs", "registry.json"), "utf8")) as {
  plates: Record<string, { boxMm: [number, number] }>;
};

const out: Record<string, { members: Array<{ node: string; at: number[]; scale: number[] }> }> = {};
for (const [node, plate] of Object.entries(registry.plates)) {
  const [w, h] = plate.boxMm.map((mm) => mm / 1000);
  const mount = resolveMount({
    kind: "single-post",
    site: "pavement",
    kerbM: SIGN_KERB.value,
    plates: [{ width: w, height: h }],
  });
  const face = mount.faces[0];
  const origin = [face.x, face.y, face.z + face.standoff];
  out[node] = {
    members: mount.members.map((m) => ({
      node: MEMBER_NODES[m.role].node,
      at: [m.x - origin[0], m.y - origin[1], m.z - origin[2]],
      scale: [m.sx, m.sy, m.sz],
    })),
  };
}
mkdirSync(dir, { recursive: true });
const file = join(dir, "mounts.json");
writeFileSync(file, JSON.stringify(out, null, 1));
log("sign_mounts_written", { file, plates: Object.keys(out).length });
