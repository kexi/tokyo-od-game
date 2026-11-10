import { InstancedMesh, Matrix4, Vector3, type Object3D } from "three";

/**
 * How the review hooks (viewHooks.ts) read what TrafficSigns and TrafficControl keep private: the
 * sign posts with their plates and 補助標識, and the signal lamps with the approach each belongs to.
 * Each reader checks the shape it relies on and says why it cannot read (`not-built`: the list is
 * there but empty; `renamed`: a field it reads is gone or of another type), instead of a TypeError
 * deep in a lookup that the shooting script would only see as "target not found".
 *
 * Why not public accessors: world/signs.ts and world/trafficControl.ts are being reworked in
 * parallel (G2, T3). Once merged they get TrafficSigns.debugPlates() / TrafficControl.debugHeads()
 * and these readers go (knowledge/review-loop.md, 残課題). READ_FIELDS names every field read, and
 * tests/viewHooks.test.ts checks that those sources still declare them.
 */

export const READ_FIELDS = {
  /** world/signs.ts: TrafficSigns.posts (type Post) and the face meshes' userData.key. */
  signs: {
    list: "posts",
    item: ["pos", "travel", "plates", "auxOf", "hidden"],
    plate: ["id", "file", "parallel"],
    /** src/signs/auxPlates.ts AuxPlate: a 補助標識 hung under a plate (G2). */
    aux: ["sign", "lines"],
  },
  /** world/trafficControl.ts: the lamp meshes and their owners (the approach of each instance). */
  control: { lists: ["lamps", "lampOwners", "arrowLamps", "arrowOwners"], owner: ["approach"] },
} as const;

export type Unreadable = { ok: false; reason: "not-built" | "renamed"; detail: string };
export type Readable<T> = { ok: true; value: T };

export type PostView = {
  pos: Vector3;
  travel: Vector3;
  plates: Array<{ id: string; file: string; parallel?: boolean; scale?: number }>;
  /** The 補助標識 of each plate (same index as `plates`), drawn as faces right under it. */
  auxOf: Array<Array<{ sign: string; lines: string[] }>>;
  hidden: boolean;
};

/** A post's 補助標識 as texts (their lines joined), all plates' together. */
export const notesOf = (p: PostView): string[] => p.auxOf.flat().map((a) => a.lines.join("\n"));

export type LampView = {
  lamps: InstancedMesh;
  lampOwners: Array<{ approach: { id: number } }>;
  arrowLamps: InstancedMesh | null;
  arrowOwners: Array<{ approach: { id: number } }>;
};

const isVec = (v: unknown): v is Vector3 =>
  typeof v === "object" &&
  v !== null &&
  ["x", "y", "z"].every((k) => typeof (v as Record<string, unknown>)[k] === "number");
const renamed = (detail: string): Unreadable => ({ ok: false, reason: "renamed", detail });
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** TrafficSigns' posts, checked field by field (the first post and its first plate stand for all). */
export function readPosts(signs: unknown): Readable<PostView[]> | Unreadable {
  const posts = (signs as Record<string, unknown> | null)?.[READ_FIELDS.signs.list];
  if (!Array.isArray(posts)) return renamed("TrafficSigns.posts is not an array");
  if (posts.length === 0) return { ok: false, reason: "not-built", detail: "no sign posts yet" };
  const p = posts[0] as Record<string, unknown>;
  if (!isVec(p.pos) || !isVec(p.travel)) return renamed("Post.pos / Post.travel is not a vector");
  if (!Array.isArray(p.plates) || !Array.isArray(p.auxOf) || typeof p.hidden !== "boolean")
    return renamed("Post.plates / auxOf / hidden changed");
  const plate = p.plates[0] as Record<string, unknown> | undefined;
  const isPlateOk = plate !== undefined && typeof plate.id === "string" && typeof plate.file === "string";
  if (!isPlateOk) return renamed("Post.plates[].id / file changed");
  // The first 補助標識 anywhere stands for all (most posts have none).
  const aux = (posts as Array<{ auxOf?: unknown }>)
    .flatMap((x) => (Array.isArray(x.auxOf) ? (x.auxOf as unknown[]).flat() : []))
    .at(0) as Record<string, unknown> | undefined;
  const isAuxOk = aux === undefined || (typeof aux.sign === "string" && Array.isArray(aux.lines));
  if (!isAuxOk) return renamed("Post.auxOf[][].sign / lines changed");
  return { ok: true, value: posts as PostView[] };
}

/** TrafficControl's lamps and their owners, checked the same way. */
export function readLamps(control: unknown): Readable<LampView> | Unreadable {
  const c = control as Record<string, unknown> | null;
  const isListed = c !== null && READ_FIELDS.control.lists.every((k) => k in c);
  if (!isListed) return renamed(`TrafficControl lacks one of ${READ_FIELDS.control.lists.join(", ")}`);
  if (!Array.isArray(c.lampOwners) || !Array.isArray(c.arrowOwners))
    return renamed("lampOwners / arrowOwners are not arrays");
  if (c.lamps === null) return { ok: false, reason: "not-built", detail: "no signal lamps yet" };
  if (!(c.lamps instanceof InstancedMesh)) return renamed("TrafficControl.lamps is not an InstancedMesh");
  const owner = c.lampOwners[0] as { approach?: { id?: unknown } } | undefined;
  const isOwnerOk = owner === undefined || typeof owner.approach?.id === "number";
  if (!isOwnerOk) return renamed("lampOwners[].approach.id changed");
  return { ok: true, value: c as unknown as LampView };
}

export type FaceInstance = { pos: Vector3; normal: Vector3 };

/** Sign face instances drawn now, by artwork file: position and the plate's facing (its local +Z). */
export function faceInstances(children: readonly Object3D[]): Map<string, FaceInstance[]> {
  const byFile = new Map<string, FaceInstance[]>();
  const m = new Matrix4();
  for (const o of children) {
    const key: unknown = o.userData.key;
    const isFace = o instanceof InstancedMesh && typeof key === "string";
    if (!isFace) continue;
    const list = byFile.get(key) ?? [];
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      const z = new Vector3().setFromMatrixColumn(m, 2);
      // A hidden plate (its post inside a building) is scaled to nothing.
      const isHidden = z.lengthSq() < 1e-6;
      if (isHidden) continue;
      list.push({ pos: new Vector3().setFromMatrixPosition(m), normal: z.setY(0).normalize() });
    }
    byFile.set(key, list);
  }
  return byFile;
}

/**
 * The drawn plate of a post: an instance of its face within 1.5 m of the post's foot, the one facing
 * most nearly back along the post's travel (横断歩道 draws the same face back to back). Null: none.
 */
export function nearestInstance(
  list: readonly FaceInstance[],
  foot: Vector3,
  travel: Vector3,
): FaceInstance | null {
  const back = travel.clone().setY(0).normalize().negate();
  let best: FaceInstance | null = null;
  let bestScore = -Infinity;
  for (const it of list) {
    const d = Math.hypot(it.pos.x - foot.x, it.pos.z - foot.z);
    const isNear = d < 1.5;
    if (!isNear) continue;
    const score = it.normal.dot(back) - d * 0.1;
    if (score > bestScore) {
      best = it;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How much of the screen a box covers and how much of it is on the screen, from its eight corners
 * in front of the eye, in normalised device coordinates (`behind`: how many corners were behind the
 * eye and left out, where the projection breaks).
 */
export function screenShare(corners: ReadonlyArray<{ x: number; y: number }>, behind: number) {
  if (corners.length === 0) return { screenShare: 0, insideShare: 0, behind };
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const full = (x1 - x0) * (y1 - y0);
  const cx = Math.max(0, Math.min(1, x1) - Math.max(-1, x0));
  const cy = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
  const clipped = cx * cy;
  return { screenShare: round3(clipped / 4), insideShare: full > 0 ? round3(clipped / full) : 0, behind };
}
