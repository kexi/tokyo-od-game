import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  faceInstances,
  nearestInstance,
  notesOf,
  READ_FIELDS,
  readLamps,
  readPosts,
  screenShare,
} from "../src/debug/privateViews";

const ROOT = join(import.meta.dirname, "..");
const source = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the fields the review hooks read", () => {
  it("are still declared in world/signs.ts (debugPlates() and the PostDebug fields, the face meshes' userData.faceKeys)", () => {
    const signs = source("src/world/signs.ts");
    expect(signs).toMatch(new RegExp(`\\n  ${READ_FIELDS.signs.method}\\(\\): PostDebug\\[\\]`));
    const post = /export type PostDebug = \{([\s\S]*?)\n\};/.exec(signs)?.[1] ?? "";
    for (const f of READ_FIELDS.signs.item) expect(post).toMatch(new RegExp(`\\n  ${f}: `));
    expect(signs).toMatch(/userData\.faceKeys = files/);
    const design = /export type Design = \{([\s\S]*?)\n\};/.exec(source("src/signs/game.ts"))?.[1] ?? "";
    for (const f of READ_FIELDS.signs.plate) expect(design).toMatch(new RegExp(`\\n  ${f}\\??: `));
    const aux = /export type AuxPlate = \{([^}]*)\}/.exec(source("src/signs/auxPlates.ts"))?.[1] ?? "";
    for (const f of READ_FIELDS.signs.aux) expect(aux).toMatch(new RegExp(`\\b${f}: `));
  });

  it("are still declared in world/trafficControl.ts (the lamp meshes and their owners' approach)", () => {
    const control = source("src/world/trafficControl.ts");
    for (const f of READ_FIELDS.control.lists) expect(control).toMatch(new RegExp(`private ${f}: `));
    expect(control).toMatch(/lampOwners: \{ approach: Approach;/);
  });
});

/** A stand-in TrafficSigns whose debugPlates() returns these posts. */
const signsOf = (posts: unknown[]) => ({ debugPlates: () => posts });

describe("reading the sign posts", () => {
  const post = {
    pos: new Vector3(),
    travel: new Vector3(0, 0, 1),
    plates: [{ id: "325の4", file: "325-4", scale: 1 }],
    auxOf: [[{ sign: "502", lines: ["土・日・休日", "12-17"] }]],
    hidden: false,
  };

  it("reads posts of the expected shape, and a post's 補助標識 as texts", () => {
    const read = readPosts(signsOf([post]));
    expect(read).toMatchObject({ ok: true });
    expect(read.ok && notesOf(read.value[0])).toEqual(["土・日・休日\n12-17"]);
  });

  it("says not-built while there are no posts yet", () => {
    expect(readPosts(signsOf([]))).toMatchObject({ ok: false, reason: "not-built" });
  });

  it("says renamed when a field it reads is gone, instead of a TypeError later", () => {
    // Before G4 the hooks read the private TrafficSigns.posts; without debugPlates() they must say so.
    expect(readPosts({ posts: [post] })).toMatchObject({ ok: false, reason: "renamed" });
    expect(readPosts({ debugPlates: () => "posts" })).toMatchObject({ ok: false, reason: "renamed" });
    expect(readPosts(signsOf([{ ...post, pos: undefined, position: new Vector3() }]))).toMatchObject({
      reason: "renamed",
    });
    expect(readPosts(signsOf([{ ...post, plates: [{ number: "323", file: "323" }] }]))).toMatchObject({
      reason: "renamed",
    });
    // Before G2 the 補助標識 were Post.notes (strings); a reader of that shape must say so.
    const { auxOf: _gone, ...old } = post;
    expect(readPosts(signsOf([{ ...old, notes: ["12-17"] }]))).toMatchObject({ reason: "renamed" });
    expect(readPosts(signsOf([{ ...post, auxOf: [[{ code: "502", text: "12-17" }]] }]))).toMatchObject({
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
  mesh.userData.faceKeys = plates.map(() => key);
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

  it("splits one plate shape's mesh into its artworks by userData.faceKeys (G3: any artwork per mesh)", () => {
    const mesh = faces("323", [
      [new Vector3(1, 2.6, 0), 0],
      [new Vector3(5, 2.6, 0), 0],
    ]);
    mesh.userData.faceKeys = ["323", "no_entry"];
    const byFile = faceInstances([mesh]);
    expect(byFile.get("323")?.map((f) => f.pos.x)).toEqual([1]);
    expect(byFile.get("no_entry")?.map((f) => f.pos.x)).toEqual([5]);
  });

  it("ignores meshes that are not sign faces (no userData.faceKeys)", () => {
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
