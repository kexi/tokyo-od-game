import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createOfficer, registerOfficer, type OfficerDress, type OfficerKind } from "../src/world/officer";

type GltfJson = {
  scenes: Array<{ nodes: number[]; extras?: { police?: Record<string, unknown> } }>;
  nodes: Array<{ name?: string; mesh?: number; children?: number[]; translation?: number[] }>;
  meshes: Array<{ name?: string; primitives: Array<{ material?: number }> }>;
  materials: Array<{ name?: string; alphaMode?: string }>;
};

/** The JSON chunk of a .glb. */
function gltfJson(file: string): GltfJson {
  const bytes = readFileSync(join(import.meta.dirname, "..", file));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as GltfJson;
}

/**
 * The scene graph GLTFLoader makes of a glb, without decoding the geometry: a node whose mesh has
 * several primitives becomes a Group of the node's name holding one Mesh per primitive
 * (`<name>_1`, `<name>_2`…); a single-primitive node is that Mesh, named after the node.
 */
function loaderScene(json: GltfJson): Group {
  const materials = json.materials.map((m) => {
    const material = new MeshStandardMaterial();
    material.name = m.name ?? "";
    material.transparent = m.alphaMode === "BLEND";
    return material;
  });
  const build = (index: number): Object3D => {
    const node = json.nodes[index];
    const name = node.name ?? "";
    const mesh = node.mesh === undefined ? null : json.meshes[node.mesh];
    const prims = mesh?.primitives ?? [];
    const meshOf = (p: { material?: number }, i: number) =>
      Object.assign(new Mesh(new BufferGeometry(), materials[p.material ?? 0]), { name: `${name}_${i + 1}` });
    const object: Object3D =
      prims.length === 1
        ? Object.assign(meshOf(prims[0], 0), { name })
        : Object.assign(new Group(), { name });
    if (prims.length > 1) prims.forEach((p, i) => object.add(meshOf(p, i)));
    const [x = 0, y = 0, z = 0] = node.translation ?? [];
    object.position.set(x, y, z);
    for (const child of node.children ?? []) object.add(build(child));
    return object;
  };
  const scene = new Group();
  for (const index of json.scenes[0].nodes) scene.add(build(index));
  return scene;
}

/** The materials of the meshes under `root` that are drawn (visible all the way up). */
function drawnMaterials(root: Object3D): string[] {
  const names: string[] = [];
  root.traverseVisible((o) => {
    if (o instanceof Mesh) names.push((o.material as MeshStandardMaterial).name);
  });
  return names;
}

/** How many primitives (materials) the mesh of the node `name` has. */
const primitivesOf = (json: GltfJson, name: string) => {
  const node = json.nodes.find((n) => n.name === name);
  return node?.mesh === undefined ? 0 : json.meshes[node.mesh].primitives.length;
};

const foot = gltfJson("public/models/police.glb");
const rider = gltfJson("public/models/police_rider.glb");
registerOfficer("foot", loaderScene(foot), foot.scenes[0].extras?.police as never);
registerOfficer("rider", loaderScene(rider));

const CASES: Array<[OfficerKind, OfficerDress]> = [
  ["foot", "patrol"],
  ["foot", "traffic"],
  ["foot", "summer"],
  ["rider", "patrol"],
];

describe("officers on foot (world/officer.ts)", () => {
  it("is built from the real models as GLTFLoader hands them over (multi-material parts are Groups)", () => {
    // The parts that were missing before: their mesh has several materials.
    expect(primitivesOf(foot, "Torso")).toBeGreaterThan(1);
    expect(primitivesOf(rider, "Head")).toBeGreaterThan(1);
  });

  it("keeps a solid torso, the head and both arms and legs in every dress", () => {
    for (const [kind, dress] of CASES) {
      const officer = createOfficer(kind, dress);
      if (!officer) throw new Error(`no ${kind} officer`);
      const body = drawnMaterials(officer.body);
      // The torso's shirt (or the rider's jacket) is drawn, with nothing see-through.
      const cloth = kind === "foot" ? "Shirt" : "Jacket";
      expect(body.filter((m) => m === cloth).length, `${kind} ${dress}`).toBeGreaterThanOrEqual(2);
      expect(body, `${kind} ${dress}`).toContain("Skin");
      for (const limb of [...officer.arms, ...officer.forearms, ...officer.legs, ...officer.shins])
        expect(drawnMaterials(limb).length, `${kind} ${dress}`).toBeGreaterThan(0);
      // Only the rider's helmet visor (Shield) is see-through.
      officer.body.traverse((o) => {
        const m = o instanceof Mesh ? (o.material as MeshStandardMaterial) : null;
        if (m && m.name !== "Shield") expect(m.transparent, `${kind} ${dress} ${m.name}`).toBe(false);
      });
    }
  });

  it("dresses the summer officer in the light blue shirt, the 交通整理 one in the vest", () => {
    const summer = createOfficer("foot", "summer");
    const traffic = createOfficer("foot", "traffic");
    if (!summer || !traffic) throw new Error("no officer");
    let shirt = "";
    summer.body.traverse((o) => {
      const m = o instanceof Mesh ? (o.material as MeshStandardMaterial) : null;
      if (m?.name === "Shirt") shirt = `#${m.color.getHexString()}`;
    });
    expect(shirt).toBe("#9cc2e8");
    expect(drawnMaterials(traffic.body)).toContain("Vest");
    expect(drawnMaterials(summer.body)).not.toContain("Vest");
  });
});
