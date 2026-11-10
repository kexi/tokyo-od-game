import type { Vector3 } from "three";
import { FrameWork } from "../game/frameWork";
import type { BoardLayout } from "../signs/board/boxes";
import { BASE_GLOW } from "../signs/retroAssumptions";
import { drawBoard } from "./guideArt";
import { FaceLayerPool } from "./signFaces";
import { SignFaceMaterial } from "./signFaceMaterial";
import { rankBoards } from "./boardPriority";

/**
 * BoardFacePool: the Canvas faces of the 案内標識 (108・105・106 now; G6's green boards, the
 * 交差点名 and the text 補助標識 are to join) in one layer pool with one budget, shown through the
 * one SignFaceMaterial of G3.
 *
 * - Layers: 512 × 320 px, 32 faces + layer 0 (the plain blue far face), as G3 had for the 108 —
 *   28.8 MB with mipmaps. Only the NEAR_COUNT most wanted boards within NEAR_RANGE are asked for;
 *   FaceLayerSlots (G3) decides what is drawn: only what fits, the most wanted first, a failed draw
 *   backed off.
 * - Priority (boardPriority, pure): the board's apparent size (width / distance) times how
 *   squarely it faces the eye; a board on another level than the eye (an expressway deck over a
 *   street, G6) after every board on the eye's level.
 * - Drawing: canvases are drawn inside a FrameWork run, a board per step, the run yielding a frame
 *   once 4 ms are spent (FrameWork's budget) — not a fixed three a call as before G5. A step is
 *   `FaceLayerPool.start(1)`: drawBoard records the canvas commands (≈0.4 ms a board), then
 *   createImageBitmap's synchronous part rasterises and copies the canvas, and that is most of a
 *   step. The 4 ms cut is between boards, so one board's step is not cut: G5 measured the longest
 *   slice at 12.5–58.9 ms; with the reused CPU canvas (guideArt.ts drawBoard) 5.8–9.4 ms, steady
 *   steps 4.6–5.9 ms. The 4 ms target is not met and is tracked in knowledge/sign-system.md
 *   「BoardFacePool」. `stats.stepMs` times every step.
 *
 * Why not a pool per kind of board: the layers are the memory, and one budget can give them to
 * whichever boards are in front of the driver. Why not draw on a worker (OffscreenCanvas) yet: the
 * fonts are the document's FontFaces, which a worker would have to load again; the cheaper remedy
 * (the CPU canvas) came first, and the worker is the tracked next step.
 */

/** m: boards this close get their drawn face (beyond, a 30 cm 漢字 is under 3 px). */
export const NEAR_RANGE = 400;
/** Boards asked for at once (the rest of the 32 layers keep recently seen faces). */
export const NEAR_COUNT = 24;
export const TEXTURE_PX = 512; // 280 cm → 1.8 px/cm: a 30 cm 漢字 is 55 px
// Layers are 512 × 320: the boards are about 1.6 times as wide as tall (the canvas is stretched to
// it; the face's UVs cover the board either way). 33 layers with mipmaps: 28.8 MB.
export const TEXTURE_PX_HIGH = 320;
export const FACE_LAYERS = 32;
/** Canvas time per frame before the drawing yields, ms (FrameWork's own default). */
export const DRAW_BUDGET_MS = 4;
/** Drawing steps timed into stats.stepMs (a place's settling draws 5–21; a drive keeps going). */
const STEP_SAMPLES = 256;
/** The 案内標識 blue (boardStandards.ts GUIDE_COLOURS), the far face. */
const FAR_FACE: [number, number, number, number] = [0x1d, 0x4f, 0x9c, 255];

/** A board that may be drawn: its key (boardKey of the content), layout, where it is and faces. */
export type BoardFace = {
  key: string;
  layout: BoardLayout;
  /** The face's centre and its unit normal (horizontal), local frame. */
  pos: Vector3;
  normal: Vector3;
  /** Board width, m. */
  width: number;
  /** 0 the ground streets; G6's decks their own (a board on another level comes last). */
  level: number;
};

export type PoolStats = {
  /** Faces drawn since the pool was made. */
  draws: number;
  /**
   * drawBoard's time alone: recording the canvas commands, not rasterising them (that happens in
   * createImageBitmap, inside the step). Not the cost of a board: read `stepMs`.
   */
  drawMs: number;
  /**
   * Each drawing step's whole time (`FaceLayerPool.start(1)`: the draw and createImageBitmap's
   * synchronous part), ms, in order; the first is the warm-up (the first canvas and context). The
   * first STEP_SAMPLES only.
   */
  stepMs: number[];
  /** The longest FrameWork slice of the drawing (one frame's canvas work), ms. */
  maxSliceMs: number;
  /** Boards asked for last time, and how many of them had their face in. */
  wanted: number;
  shown: number;
};

export class BoardFacePool {
  readonly pool: FaceLayerPool;
  readonly material: SignFaceMaterial;
  private running = false;
  private readonly wanted = new Set<string>();
  /** Each user's boards and the eye it last ranked them from (insertion order: the last caller last). */
  private readonly users = new Map<
    string,
    { boards: readonly BoardFace[]; eye: Vector3; eyeLevel: number }
  >();
  readonly stats: PoolStats = { draws: 0, drawMs: 0, stepMs: [], maxSliceMs: 0, wanted: 0, shown: 0 };

  constructor() {
    this.pool = new FaceLayerPool({
      name: "guide",
      size: TEXTURE_PX,
      height: TEXTURE_PX_HIGH,
      layers: FACE_LAYERS + 1,
      anisotropy: 8,
      standIn: FAR_FACE,
    });
    this.material = new SignFaceMaterial({ small: this.pool.texture, baseGlow: BASE_GLOW.value.guide });
  }

  /**
   * The boards a user (GuideSigns "guide", ExpresswaySigns "expressway", …) stands now. Each user
   * registers its own list; the pool ranks all users' boards together, so one user's call never
   * drops the faces another asked for (G5 review W5: before, the last caller's list was the whole
   * wanted set). Returns the keys among this user's boards that were chosen.
   *
   * Why not one call with every board: the users rebuild and update on their own clocks (the
   * streets every 300 m, the decks per tile); a merged list would need a common owner of both.
   */
  want(user: string, boards: readonly BoardFace[], eye: Vector3, eyeLevel = 0): Set<string> {
    // The last caller last: Map.set keeps an existing key where it was, so it is moved explicitly.
    // The eye is copied: the caller's camera vector moves on after this call.
    this.users.delete(user);
    this.users.set(user, { boards, eye: eye.clone(), eyeLevel });
    const chosen = this.rank();
    const mine = new Set(boards.map((b) => b.key));
    return new Set([...chosen].filter((k) => mine.has(k)));
  }

  /** A user's boards are gone (its area was cleared): its faces may be given to the others. */
  forget(user: string): void {
    this.users.delete(user);
    this.rank();
  }

  /**
   * Every user's boards ranked from the latest eye (the last caller's: they share the camera),
   * the NEAR_COUNT most wanted within NEAR_RANGE asked of the layer pool.
   */
  private rank(): Set<string> {
    const latest = [...this.users.values()].at(-1);
    const chosen = latest
      ? rankBoards(
          [...this.users.values()].map((u) => u.boards),
          latest.eye,
          latest.eyeLevel,
          { range: NEAR_RANGE, count: NEAR_COUNT },
        )
      : [];
    this.wanted.clear();
    for (const { b } of chosen) this.wanted.add(b.key);
    this.pool.want(
      new Map(
        chosen.map(({ b, priority }) => [b.key, { source: { draw: () => this.draw(b.layout) }, priority }]),
      ),
    );
    this.stats.wanted = chosen.length;
    this.kick();
    return this.wanted;
  }

  /** Per frame: uploads what was drawn and keeps drawing. True when a face moved in or out. */
  frame(): boolean {
    const moved = this.pool.pump();
    this.kick();
    if (moved) this.stats.shown = [...this.wanted].filter((k) => this.pool.has(k)).length;
    return moved;
  }

  layerOf(key: string): number {
    return this.pool.layerOf(key);
  }

  get version(): number {
    return this.pool.version;
  }

  /** Layers in use of the pool's capacity (the review hooks and the perf probe read it). */
  usage(): { used: number; capacity: number; ratio: number } {
    const { used, capacity } = this.pool;
    return { used, capacity, ratio: capacity > 0 ? used / capacity : 0 };
  }

  private draw(layout: BoardLayout): HTMLCanvasElement {
    const started = performance.now();
    try {
      return drawBoard(layout, TEXTURE_PX);
    } finally {
      this.stats.draws++;
      this.stats.drawMs += performance.now() - started;
    }
  }

  /** Runs the drawing in FrameWork slices until nothing more can start (a new run per burst). */
  private kick(): void {
    if (this.running) return;
    this.running = true;
    // A fresh FrameWork per burst: its slice clock only resets on a yield, and a burst that ended
    // without one would start the next with the last one's time spent.
    const work = new FrameWork(DRAW_BUDGET_MS);
    void work.run(this.drawSteps()).finally(() => {
      this.running = false;
      this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, work.maxSliceMs);
    });
  }

  private *drawSteps(): Generator<boolean> {
    for (;;) {
      const stepStarted = performance.now();
      const started = this.pool.start(1);
      if (started === 0) return;
      const isSampling = this.stats.stepMs.length < STEP_SAMPLES;
      if (isSampling) this.stats.stepMs.push(performance.now() - stepStarted);
      yield false;
    }
  }
}

let sharedPool: BoardFacePool | null = null;
/**
 * Once a frame (main.ts): the shared pool's uploads and drawing, for all its users at once (each
 * user only re-reads its layers when the pool's version moved). Nothing before the pool exists.
 * Why not each user's update: two users pumped it twice a frame (G6 review W3).
 */
export function pumpBoardFaces(): void {
  sharedPool?.frame();
}

/**
 * The one pool every user of the 案内標識 faces registers with (GuideSigns, ExpresswaySigns), made
 * on first use (its uploads need the renderer, bound by main.ts).
 */
export function sharedBoardFaces(): BoardFacePool {
  sharedPool ??= new BoardFacePool();
  return sharedPool;
}
