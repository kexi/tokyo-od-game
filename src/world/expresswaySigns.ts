import {
  Euler,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  type Scene,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { XwChunk, XwSign } from "../expressway/format";
import { frameAt } from "../expressway/profile";

import { log, warn } from "../log";
import { sharedDraco } from "../render/draco";
import type { BoardLayout } from "../signs/board/boxes";
import { boardKey, boardNames, type BoardContent } from "../signs/board/content";
import { parseBoardContent } from "../signs/board/layout";
import { SIGN } from "../signs/game";
import { STATUTORY_SPEED } from "../signs/expresswaySignStandards";
import { DECK_PLATE_SCALE } from "../signs/expresswaySignAssumptions";
import { MEMBER_NODES, resolveMount, type MemberRole, type ResolvedMount } from "../signs/mount";
import { sharedBoardFaces, type BoardFace } from "./boardFacePool";
import { boardSizeM, deckMount, type DeckMount } from "../signs/deckMount";
export { boardSizeM, deckMount, type DeckMount } from "../signs/deckMount";
import type { GeoToLocal } from "./expresswayMerge";
import { layoutGuideBoard } from "./guideArt";
import { RoadInstances } from "./roadInstances";
import { attachFaceLayers } from "./signFaceMaterial";
import { design, type PostMount, type TrafficSigns } from "./signs";

/**
 * The 都市高速's signs on the decks (G6): the guide boards (108の2-C, 110-B, 111-B, 112-B, 113,
 * 116の4) on a 門型, the girder of a deck overhead or a 壁高欄, and the 323・325 plates on a 壁高欄
 * through a second TrafficSigns (its plate pools and members). Where each stands and what it says
 * is the build's (src/expressway/signPlan.ts, `XwChunk.signs`); this only turns that into meshes:
 * the deck's road surface at the sign is the mount's ground (the frame stands at the deck height,
 * not on the terrain under it), and src/signs/mount.ts resolveMount places the members and faces.
 *
 * The board faces share the one BoardFacePool with the street's GuideSigns (registered as
 * "expressway", each board at its deck's `level`), drawn on the same reused canvas.
 */

/** Signs of the chunks this close to the player stand (the boards' faces are drawn within 400 m). */
const SIGN_RADIUS_M = 900;
/** Re-plan after the player moved this far (or a tile came in). */
const MOVE_M = 150;

type Part = { geometry: BufferGeometry; material: Material };
type Kit = { face: BufferGeometry; back: Part; members: Partial<Record<MemberRole, Part[]>> };

type Standing = {
  sign: XwSign;
  chunk: string;
  layout: BoardLayout;
  key: string;
  board: Matrix4;
  normal: Vector3;
  isNear: boolean;
  faceIndex: number;
  /** Lower edge above the deck's road surface at the sign, m (DeckSignView.bottomM). */
  bottomM: number;
};

/** A deck sign as the review hooks see it (src/debug/viewHooks.ts `expressway-sign` targets). */
export type DeckSignView = {
  id: string;
  chunk: string;
  s: number;
  level: number;
  mount: string;
  pos: Vector3;
  normal: Vector3;
  width: number;
  height: number;
  /** Lower edge above the deck's road surface, m. */
  bottomM: number;
  layer: number;
  names: string[];
};

export class ExpresswaySigns {
  private kit: Kit | null = null;
  private readonly instances = new RoadInstances();
  private meshes: InstancedMesh[] = [];
  private standing: Standing[] = [];
  private faces: InstancedMesh | null = null;
  private faceGeometry: BufferGeometry | null = null;
  private layerVersion = -1;
  private planned: { lat: number; lon: number; version: number } | null = null;
  private lastUpdate = 0;
  private readonly reported = new Set<string>();
  private plateViews: Array<{ sign: XwSign; chunk: string; pos: Vector3; mount: ResolvedMount }> = [];

  constructor(
    private readonly scene: Scene,
    /** A second TrafficSigns: the 323・325 plates stand there (standDeckPosts). */
    private readonly plates: TrafficSigns,
  ) {
    void this.load().catch((error: unknown) => warn("expressway_signs_failed", { error: String(error) }));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader().setDRACOLoader(sharedDraco());
    const base = import.meta.env.BASE_URL;
    const [guide, signs] = await Promise.all([
      loader.loadAsync(`${base}models/guide_signs.glb`),
      loader.loadAsync(`${base}models/signs.glb`),
    ]);
    guide.scene.updateMatrixWorld(true);
    signs.scene.updateMatrixWorld(true);
    const parts = (root: typeof guide.scene, name: string): Part[] => {
      const out: Part[] = [];
      root.getObjectByName(name)?.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        out.push({
          geometry: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
          material: mesh.material as Material,
        });
      });
      return out;
    };
    const board = parts(guide.scene, "GuideBoard");
    const face = board.find((p) => p.material.name === "GuideFace");
    const back = board.find((p) => p.material.name === "GuideBack");
    if (!face || !back) throw new Error("guide_signs.glb: GuideBoard lacks its face or back");
    const roles: MemberRole[] = [
      "gantryLeg",
      "gantryFoot",
      "truss",
      "barrierBracket",
      "post",
      "postCap",
      "rail",
      "band",
      "girderHanger",
    ];
    const members: Kit["members"] = {};
    for (const role of roles) {
      const { glb, node } = MEMBER_NODES[role];
      members[role] = parts(glb === "guide_signs" ? guide.scene : signs.scene, node);
    }
    this.kit = { face: face.geometry, back, members };
  }

  /**
   * Every frame: the face pool's uploads, the layers when one moved in; the signs re-planned when
   * the player moved MOVE_M or a tile came in; the boards asked for every 500 ms from `eye`.
   */
  update(
    chunksNear: (lat: number, lon: number, radius: number) => XwChunk[],
    place: GeoToLocal,
    tileVersion: number,
    geo: { lat: number; lon: number },
    now: number,
    eye: Vector3,
    eyeLevel: number,
  ): void {
    const pool = sharedBoardFaces();
    if (this.faces) {
      // Pumped once a frame by main.ts (pumpBoardFaces): only the layers are re-read here.
      if (pool.version !== this.layerVersion) this.applyLayers();
    }
    const last = this.planned;
    const hasMoved =
      !last || Math.hypot((geo.lat - last.lat) * 111_000, (geo.lon - last.lon) * 90_000) > MOVE_M;
    const isNewTile = last !== null && last.version !== tileVersion;
    if (this.kit && (hasMoved || isNewTile)) {
      this.planned = { ...geo, version: tileVersion };
      this.rebuild(chunksNear(geo.lat, geo.lon, SIGN_RADIUS_M), place);
    }
    if (!this.faces || now - this.lastUpdate < 500) return;
    this.lastUpdate = now;
    const boards: BoardFace[] = this.standing.map((s) => ({
      key: s.key,
      layout: s.layout,
      pos: new Vector3().setFromMatrixPosition(s.board),
      normal: s.normal,
      width: boardSizeM(s.layout).width,
      level: s.sign.level,
    }));
    const wanted = pool.want("expressway", boards, eye, eyeLevel);
    for (const s of this.standing) s.isNear = wanted.has(s.key);
    this.applyLayers();
  }

  /** The frame moved (floating origin): stand everything again in the new frame. */
  reanchor(): void {
    this.planned = null;
  }

  count(): number {
    return this.standing.length + this.plateViews.length;
  }

  debugTargets(): DeckSignView[] {
    const pool = sharedBoardFaces();
    const boards = this.standing.map((s) => {
      const pos = new Vector3().setFromMatrixPosition(s.board);
      const { width: w, height: h } = boardSizeM(s.layout);
      return {
        id: s.sign.id,
        chunk: s.chunk,
        s: s.sign.s,
        level: s.sign.level,
        mount: s.sign.mount,
        pos,
        normal: s.normal.clone(),
        width: w,
        height: h,
        bottomM: s.bottomM,
        layer: s.isNear ? pool.layerOf(s.key) : 0,
        names: boardNames(s.layout.content).map((n) => n.ja),
      };
    });
    const plates = this.plateViews.map((p) => ({
      id: p.sign.id,
      chunk: p.chunk,
      s: p.sign.s,
      level: p.sign.level,
      mount: p.sign.mount,
      pos: p.pos.clone(),
      normal: new Vector3(),
      width: p.mount.faces[0]?.width ?? 0,
      height: p.mount.faces[0]?.height ?? 0,
      bottomM: Math.min(...p.mount.faces.map((f) => f.y - f.height / 2)),
      layer: 0,
      names: [],
    }));
    return [...boards, ...plates];
  }

  private rebuild(chunks: XwChunk[], place: GeoToLocal): void {
    const kit = this.kit;
    if (!kit) return;
    this.instances.begin();
    for (const m of this.meshes) this.scene.remove(m);
    this.meshes = [];
    this.standing = [];
    this.faces = null;
    const lists = new Map<MemberRole, Matrix4[]>();
    const boards: Matrix4[] = [];
    const deckPosts: PostMount[] = [];
    this.plateViews = [];
    let dropped = 0;
    for (const chunk of chunks) {
      for (const sign of chunk.signs ?? []) {
        const at = signFrame(chunk, sign, place);
        if (sign.plate) {
          const post = this.platePost(chunk, sign, at);
          if (post) {
            deckPosts.push(post);
            this.plateViews.push({ sign, chunk: chunk.id, pos: post.pos, mount: post.mount });
          }
          continue;
        }
        const parsed = parseBoardContent(sign.board);
        if (!parsed.success) {
          this.report(`board:${chunk.id}:${sign.s}`, () =>
            warn("expressway_sign_invalid", { chunk: chunk.id, id: sign.id, s: sign.s }),
          );
          continue;
        }
        // The checked content (zod's output): the face's key is boardKey, independent of the order.
        const content: BoardContent = parsed.data;
        const layout = layoutGuideBoard(content);
        const { width: w, height: h } = boardSizeM(layout);
        const dm = deckMount(chunk, sign, [{ width: w, height: h }]);
        const mount = resolveMount(dm.placement);
        dropped += mount.dropped;
        const frame = mountMatrix(at, dm);
        const local = (x: number, y: number, z: number, scale: Vector3, pitch = 0) =>
          frame
            .clone()
            .multiply(
              new Matrix4().compose(
                new Vector3(dm.side * x, y, z),
                new Quaternion().setFromEuler(new Euler(pitch, 0, 0, "YXZ")),
                scale,
              ),
            );
        for (const m of mount.members) {
          const list = lists.get(m.role) ?? [];
          list.push(local(m.x, m.y, m.z, new Vector3(m.sx, m.sy, m.sz), m.pitch));
          lists.set(m.role, list);
        }
        const placed = placeBoard(at, dm, mount, w, h);
        if (!placed) continue;
        const { board, bottomM } = placed;
        boards.push(board);
        this.standing.push({
          sign,
          chunk: chunk.id,
          layout,
          key: boardKey(content),
          board,
          normal: at.travel.clone().negate(),
          isNear: false,
          faceIndex: this.standing.length,
          bottomM,
        });
      }
    }
    for (const [role, list] of lists) {
      for (const part of kit.members[role] ?? []) this.instanced(part.geometry, part.material, list);
    }
    this.instanced(kit.back.geometry, kit.back.material, boards);
    this.faceGeometry ??= kit.face.clone();
    this.faces = this.instanced(this.faceGeometry, sharedBoardFaces().material, boards, attachFaceLayers);
    this.faces.userData.guideFaces = true;
    this.instances.end();
    this.layerVersion = -1;
    this.applyLayers();
    this.plates.standDeckPosts(deckPosts);
    if (dropped > 0) warn("sign_faces_unmounted", { faces: dropped, posts: this.standing.length });
    log("expressway_signs_placed", {
      chunks: chunks.length,
      boards: this.standing.length,
      plates: deckPosts.length,
      gantries: this.standing.filter((s) => s.sign.mount === "gantry").length,
      girders: this.standing.filter((s) => s.sign.mount === "girder-mount").length,
      barriers: this.standing.filter((s) => s.sign.mount === "barrier-mount").length + deckPosts.length,
    });
  }

  /** A 323 / 325 plate on its 壁高欄, as a TrafficSigns post standing at the deck's height. */
  private platePost(chunk: XwChunk, sign: XwSign, at: SignFrame): PostMount | null {
    const plate = sign.plate!;
    const found =
      plate.id === "325"
        ? design(SIGN.motorOnly, 0)
        : design(SIGN.speed, plate.value ?? STATUTORY_SPEED.value.ordinary);
    if (!found) {
      this.report(`plate:${plate.id}:${plate.value}`, () =>
        warn("expressway_sign_invalid", { chunk: chunk.id, id: sign.id, s: sign.s }),
      );
      return null;
    }
    // Drawn larger on the deck than on the streets (expresswaySignAssumptions.ts DECK_PLATE_SCALE).
    const d = { ...found, scale: DECK_PLATE_SCALE.value };
    const size = 0.6 * d.scale;
    const dm = deckMount(chunk, sign, [{ width: size, height: size }]);
    const mount = resolveMount(dm.placement);
    const origin = at.pos.clone().add(leftOf(at.travel, dm.u));
    return {
      pos: origin,
      travel: at.travel.clone(),
      mount,
      designs: mount.faces.map(() => d),
      deck: { baseY: at.pos.y, side: dm.side },
    };
  }

  private instanced(
    geometry: BufferGeometry,
    material: Material,
    list: Matrix4[],
    prepare?: (mesh: InstancedMesh) => void,
  ): InstancedMesh {
    const mesh = this.instances.take(geometry, material, list.length, prepare);
    mesh.count = list.length;
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  private applyLayers(): void {
    const mesh = this.faces;
    if (!mesh) return;
    const pool = sharedBoardFaces();
    const attribute = attachFaceLayers(mesh);
    for (const s of this.standing) attribute.setX(s.faceIndex, s.isNear ? pool.layerOf(s.key) : 0);
    attribute.needsUpdate = true;
    this.layerVersion = pool.version;
  }

  private report(key: string, emit: () => void): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    emit();
  }
}

/** Where a sign is on its deck: the centre line's point at its road surface and the travel there. */
export type SignFrame = { pos: Vector3; travel: Vector3 };

const leftOf = (travel: Vector3, u: number) => new Vector3(travel.z * u, 0, -travel.x * u);

/** The centre line at the sign's run distance, on the road surface, and the direction of travel. */
export function signFrame(chunk: XwChunk, sign: Pick<XwSign, "s">, place: GeoToLocal): SignFrame {
  const at = (s: number) => {
    const f = frameAt(chunk.st, s);
    return place.frame.toLocal(f.lat, f.lon, place.ellipsoidal(f.lat, f.lon, f.z));
  };
  const pos = at(sign.s);
  const a = at(sign.s - 2);
  const b = at(sign.s + 2);
  const travel = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  return { pos, travel };
}

/**
 * A board's matrix on its mount (the first face of `mount`, scaled to w × h, pitched as resolved)
 * and its lower edge over the road surface at the sign (the board's centre less half its height,
 * against the centre line's road there, as guideSigns.ts measures a street board over its ground).
 * Null for a mount with no face. Why not NaN for the boards as before 7c1: the review hooks read
 * bottomM to check a 門型's 4.7 m (S6 PR 7c, H; only the 323・325 plates had it).
 */
export function placeBoard(
  at: SignFrame,
  dm: DeckMount,
  mount: ResolvedMount,
  w: number,
  h: number,
): { board: Matrix4; bottomM: number } | null {
  const [f] = mount.faces;
  if (!f) return null;
  const board = mountMatrix(at, dm).multiply(
    new Matrix4().compose(
      new Vector3(dm.side * f.x, f.y, f.z + f.standoff),
      new Quaternion().setFromEuler(new Euler(f.pitch, 0, 0, "YXZ")),
      new Vector3(w, h, 1),
    ),
  );
  const centre = new Vector3().setFromMatrixPosition(board);
  return { board, bottomM: centre.y - h / 2 - at.pos.y };
}

/**
 * The mount's frame in the world: origin on the road surface `u` across from the centre line, +z
 * toward the oncoming traffic, +x right of travel (the mirrored side is applied to positions).
 */
function mountMatrix(at: SignFrame, dm: DeckMount): Matrix4 {
  const facing = at.travel.clone().negate();
  const yaw = Math.atan2(facing.x, facing.z);
  const origin = at.pos.clone().add(leftOf(at.travel, dm.u));
  return new Matrix4().compose(
    origin,
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    new Vector3(1, 1, 1),
  );
}
