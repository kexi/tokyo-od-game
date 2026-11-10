import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  faceInstances,
  nearestInstance,
  READ_FIELDS,
  readLamps,
  readPosts,
  screenShare,
} from "../src/debug/privateViews";

const ROOT = join(import.meta.dirname, "..");
const source = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the private fields the review hooks read", () => {
  it("are still declared in world/signs.ts (posts and the Post fields, the face meshes' userData.key)", () => {
    const signs = source("src/world/signs.ts");
    expect(signs).toMatch(new RegExp(`private ${READ_FIELDS.signs.list}: Post\\[\\]`));
    const post = /type Post = \{([\s\S]*?)\n\};/.exec(signs)?.[1] ?? "";
    for (const f of READ_FIELDS.signs.item) expect(post).toMatch(new RegExp(`\\n  ${f}: `));
    expect(signs).toMatch(/userData\.key = d\.file/);
    const design = /export type Design = \{([\s\S]*?)\n\};/.exec(source("src/signs/game.ts"))?.[1] ?? "";
    for (const f of READ_FIELDS.signs.plate) expect(design).toMatch(new RegExp(`\\n  ${f}\\??: `));
  });

  it("are still declared in world/trafficControl.ts (the lamp meshes and their owners' approach)", () => {
    const control = source("src/world/trafficControl.ts");
    for (const f of READ_FIELDS.control.lists) expect(control).toMatch(new RegExp(`private ${f}: `));
    expect(control).toMatch(/lampOwners: \{ approach: Approach;/);
  });
});

describe("reading the sign posts", () => {
  const post = {
    pos: new Vector3(),
    travel: new Vector3(0, 0, 1),
    plates: [{ id: "323", file: "323" }],
    notes: [],
    hidden: false,
  };

  it("reads posts of the expected shape", () => {
    expect(readPosts({ posts: [post] })).toMatchObject({ ok: true });
  });

  it("says not-built while there are no posts yet", () => {
    expect(readPosts({ posts: [] })).toMatchObject({ ok: false, reason: "not-built" });
  });

  it("says renamed when a field it reads is gone, instead of a TypeError later", () => {
    expect(readPosts({ postz: [post] })).toMatchObject({ ok: false, reason: "renamed" });
    expect(readPosts({ posts: [{ ...post, pos: undefined, position: new Vector3() }] })).toMatchObject({
      reason: "renamed",
    });
    expect(readPosts({ posts: [{ ...post, plates: [{ number: "323", file: "323" }] }] })).toMatchObject({
      reason: "renamed",
    });
  });
});

describe("reading the signal lamps", () => {
  const lamps = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
  const control = { lamps, lampOwners: [{ approach: { id: 3 } }], arrowLamps: null, arrowOwners: [] };

  it("reads lamps of the expected shape", () => {
    expect(readLamps(control)).toMatchObject({ ok: true });
  });

  it("says not-built before the lamps are made", () => {
    expect(readLamps({ ...control, lamps: null })).toMatchObject({ ok: false, reason: "not-built" });
  });

  it("says renamed when a list is gone or an owner lost its approach id", () => {
    const { lampOwners: _gone, ...rest } = control;
    expect(readLamps(rest)).toMatchObject({ ok: false, reason: "renamed" });
    expect(readLamps({ ...control, lampOwners: [{ ap: { id: 3 } }] })).toMatchObject({ reason: "renamed" });
  });
});

/**
 * An instanced face mesh with one plate facing `yaw` (the game's atan2(dx, dz)) at each spot; a yaw
 * of -99 stands for a plate hidden by scaling it away (its post inside a building).
 */
function faces(key: string, plates: Array<[Vector3, number]>) {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), plates.length);
  const o = new Object3D();
  plates.forEach(([p, yaw], i) => {
    o.position.copy(p);
    o.rotation.set(0, yaw, 0);
    o.scale.setScalar(yaw === -99 ? 0 : 1.25);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  mesh.userData.key = key;
  return mesh;
}

describe("finding a post's drawn plate", () => {
  it("reads each plate's facing from its instance matrix (local +Z), skipping hidden (scaled-away) ones", () => {
    const byFile = faceInstances([
      faces("323", [
        [new Vector3(1, 2.6, 0), Math.PI / 2],
        [new Vector3(9, 2.6, 0), -99],
      ]),
    ]);
    const list = byFile.get("323") ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].normal.x).toBeCloseTo(1, 6);
    expect(list[0].normal.z).toBeCloseTo(0, 6);
  });

  it("ignores meshes that are not sign faces (no userData.key)", () => {
    const plain = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
    expect(faceInstances([plain]).size).toBe(0);
  });

  it("picks, of back-to-back plates, the one facing back along the post's travel (the G1c fix)", () => {
    const foot = new Vector3(0, 0, 0);
    const front = { pos: new Vector3(0, 2.6, 0.05), normal: new Vector3(0, 0, -1) };
    const back = { pos: new Vector3(0, 2.6, -0.05), normal: new Vector3(0, 0, 1) };
    expect(nearestInstance([back, front], foot, new Vector3(0, 0, 1))).toBe(front);
  });

  it("does not take another post's plate more than 1.5 m away", () => {
    const far = { pos: new Vector3(3, 2.6, 0), normal: new Vector3(0, 0, -1) };
    expect(nearestInstance([far], new Vector3(), new Vector3(0, 0, 1))).toBeNull();
  });
});

describe("how much of the screen a box takes", () => {
  it("is the clipped area over the screen's (NDC −1..1, area 4) and the part of the box on screen", () => {
    const corners = [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
    ];
    expect(screenShare(corners, 0)).toEqual({ screenShare: 0.25, insideShare: 1, behind: 0 });
    const halfOff = [
      { x: 0.5, y: -0.5 },
      { x: 1.5, y: 0.5 },
    ];
    expect(screenShare(halfOff, 0)).toMatchObject({ insideShare: 0.5 });
  });

  it("is nothing when the whole box is behind the eye", () => {
    expect(screenShare([], 8)).toEqual({ screenShare: 0, insideShare: 0, behind: 8 });
  });
});
