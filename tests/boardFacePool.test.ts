import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { BoardLayout } from "../src/signs/board/boxes";
import { BoardFacePool, type BoardFace } from "../src/world/boardFacePool";

const layout = { content: { kind: "116の4", letter: 14 }, width: 60, height: 90, nodes: [] } as BoardLayout;
const board = (key: string, x: number, level = 0): BoardFace => ({
  key,
  layout,
  pos: new Vector3(x, 5, 0),
  normal: new Vector3(-1, 0, 0),
  width: 3,
  level,
});

describe("BoardFacePool の利用者ごとの登録（G5 レビュー W5、G6 レビュー W3）", () => {
  it("keeps the street's boards wanted when the deck's user asks for its own", () => {
    const pool = new BoardFacePool();
    const eye = new Vector3(0, 1, 0);
    pool.want("guide", [board("street", -40)], eye);
    const deck = pool.want("expressway", [board("deck", -60)], eye);
    expect(deck).toEqual(new Set(["deck"]));
    expect(pool.stats.wanted).toBe(2);
  });

  it("ranks from the last caller's eye and level, whichever user called last", () => {
    const pool = new BoardFacePool();
    pool.want("expressway", [board("deck", -60, 1)], new Vector3(0, 1, 0), 1);
    pool.want("guide", [board("street", -40)], new Vector3(0, 1, 0), 0);
    // The street user called last from level 0: the deck board (level 1) is on another level.
    const again = pool.want("expressway", [board("deck", -60, 1)], new Vector3(0, 1, 0), 1);
    // Now the deck user is last, from level 1: its board is on the eye's level and is chosen.
    expect(again).toEqual(new Set(["deck"]));
  });

  it("copies the eye: moving the caller's vector afterwards changes nothing", () => {
    const pool = new BoardFacePool();
    const eye = new Vector3(0, 1, 0);
    pool.want("guide", [board("near", -50)], eye);
    eye.set(5000, 0, 0);
    // A second user's call re-ranks from its own eye, not from the moved vector.
    pool.want("expressway", [], new Vector3(0, 1, 0));
    expect(pool.stats.wanted).toBe(1);
  });

  it("forgets a user's boards", () => {
    const pool = new BoardFacePool();
    const eye = new Vector3(0, 1, 0);
    pool.want("guide", [board("street", -40)], eye);
    pool.want("expressway", [board("deck", -60)], eye);
    pool.forget("guide");
    expect(pool.stats.wanted).toBe(1);
  });
});
