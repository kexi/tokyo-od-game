import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/**
 * The places in src/ that take an object out of the scene without retireObject(), each with why
 * (M1, knowledge/memory-growth.md): an object taken out for good must go through retireObject, or
 * WebGPURenderer keeps its render objects, and with them the object, for the rest of the session.
 */
const ALLOWED: Array<{ file: string; code: string; why: string }> = [
  { file: "src/render/retire.ts", code: "root.removeFromParent();", why: "retireObject itself" },
  {
    file: "src/main.ts",
    code: "scene.remove(gallery);",
    why: "the precompile gallery: its render objects keep the pipelines built before play until the real objects use them",
  },
  {
    file: "src/world/roadPlates.ts",
    code: "entry.mesh.removeFromParent();",
    why: "begin(): every plate leaves until take() puts it back; end() retires the ones not taken",
  },
  ...[
    ["src/world/signs.ts", "for (const m of this.meshes) this.scene.remove(m);"],
    ["src/world/guideSigns.ts", "this.scene.remove(m);"],
    ["src/world/streetLights.ts", "for (const m of [this.metal, this.lens]) if (m) this.scene.remove(m);"],
    ["src/world/orbis.ts", "for (const m of this.meshes) this.scene.remove(m);"],
    ["src/world/expresswaySigns.ts", "for (const m of this.meshes) this.scene.remove(m);"],
    ["src/world/trafficControl.ts", "this.scene.remove(m);"],
  ].map(([file, code]) => ({
    file,
    code,
    why: "pooled instanced meshes (RoadInstances): out until the rebuild takes them again; RoadInstances.end() retires the ones not taken. Retiring them here rebuilt their render objects and pipelines on every rebuild (about 580 pipelines a minute on the back-and-forth)",
  })),
  {
    file: "src/world/trafficControl.ts",
    code: "this.scene.remove(p);",
    why: "pooled plates (RoadPlates): out until the rebuild takes them again; RoadPlates.end() retires the ones not taken",
  },
  {
    file: "src/world/streetFurniture.ts",
    code: "this.group.clear();",
    why: "the group holds only RoadPlates' pooled plates, retired by RoadPlates.end()",
  },
  {
    file: "src/world/human.ts",
    code: "o.removeFromParent();",
    why: "a part template taken out of the loaded glTF: cloned for each person, never drawn itself",
  },
  {
    file: "src/game/carModel.ts",
    code: "o.removeFromParent();",
    why: "a car template taken out of the loaded glTF: cloned for each car, never drawn itself",
  },
  {
    file: "src/game/witnessPhones.ts",
    code: "phone.removeFromParent();",
    why: "the phone template taken out of the loaded glTF: cloned for each phone",
  },
  { file: "src/world/pedestrians.ts", code: "this.remove(i);", why: "Pedestrians.remove, which retires" },
  { file: "src/world/traffic-ai.ts", code: "this.remove(c);", why: "TrafficAI.remove, which retires" },
];

/** Taking an Object3D out: removeFromParent(), remove(object…) and clear() on a group. */
const REMOVAL = /\.removeFromParent\(\)|\.remove\((?!["'`)])|\b(?:group|root|holder|scene)\.clear\(\)/;
/** remove() calls that are not three's: the DOM's class list, the physics contacts. */
const NOT_THREE = /classList\.remove|contacts\.remove/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function removals(): Array<{ file: string; line: number; code: string }> {
  return sources(SRC).flatMap((path) => {
    const file = relative(ROOT, path);
    return readFileSync(path, "utf8")
      .split("\n")
      .flatMap((text, i) => {
        const isRemoval = REMOVAL.test(text) && !NOT_THREE.test(text);
        return isRemoval ? [{ file, line: i + 1, code: text.trim() }] : [];
      });
  });
}

describe("objects taken out of the scene for good go through retireObject", () => {
  it("every other removal in src/ is in the table, with why", () => {
    const unlisted = removals().filter(
      (r) => !ALLOWED.some((a) => a.file === r.file && r.code.includes(a.code)),
    );
    expect(unlisted).toEqual([]);
  });

  it("every entry of the table still stands in the code (no stale reasons)", () => {
    const found = removals();
    const stale = ALLOWED.filter((a) => !found.some((r) => r.file === a.file && r.code.includes(a.code)));
    expect(stale).toEqual([]);
  });
});
