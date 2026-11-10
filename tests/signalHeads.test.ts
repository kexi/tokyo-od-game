import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PED_HEAD,
  SIGNAL_HEADS,
  SignalHeadDefSchema,
  VEHICLE_HEAD,
  headHang,
  housingLayout,
  isArrow,
  lampLayout,
  type LampPlace,
  type SignalHeadDef,
} from "../src/signals/heads";
import { ARM_MOUNT, PED_POLE_MOUNT, SIGNAL_MOUNTS } from "../src/signals/mounts";
import { SIGNAL_REGISTRY_PATH, signalRegistry } from "../src/signals/registry";

const ROOT = join(import.meta.dirname, "..");
const HEADS = Object.values(SIGNAL_HEADS);

/** Where the main lamp of `colour` sits along the head's axis: x (横型) or y (縦型). */
const along = (def: SignalHeadDef, places: LampPlace[], colour: string) => {
  const p = places.find((q) => q.lamp === colour);
  if (!p) throw new Error(`${def.id} has no ${colour} lamp`);
  return def.orientation === "horizontal" ? p.x : p.y;
};

/** 施行令第3条第1項: rightmost (横型) or topmost (縦型) first — 赤・黄・青, or 赤・青 for 2 灯. */
function expectLawOrder(def: SignalHeadDef, places: LampPlace[]) {
  const colours = def.lamps.length === 3 ? ["red", "yellow", "green"] : ["red", "green"];
  const positions = colours.map((c) => along(def, places, c));
  const descending = [...positions].sort((a, b) => b - a);
  expect(
    positions,
    `${def.id}: ${colours.join("・")} from the ${def.orientation === "horizontal" ? "right" : "top"}`,
  ).toEqual(descending);
  expect(new Set(positions).size).toBe(positions.length);
}

const valid = {
  ...VEHICLE_HEAD,
  id: "test-head",
  node: "TestHead",
};

describe("施行令第3条 in the definitions (src/signals/heads.ts)", () => {
  it.each(HEADS.map((d) => [d.id, d] as const))(
    "lays out %s with red rightmost / topmost, then yellow, then green",
    (_, def) => {
      expectLawOrder(def, lampLayout(def));
    },
  );

  it("keeps a 横型 head's lamps on one row and a 縦型 head's on one column", () => {
    for (const def of HEADS) {
      const main = lampLayout(def).filter((p) => !isArrow(p.lamp));
      const across = main.map((p) => (def.orientation === "horizontal" ? p.y : p.x));
      expect(new Set(across), def.id).toEqual(new Set([0]));
    }
  });

  it.each([
    ["横型 青・黄・赤 from the right", ["green", "yellow", "red"]],
    ["黄 on the right", ["yellow", "red", "green"]],
    ["2 灯 青 on the right", ["green", "red"]],
    ["a lamp missing", ["red", "yellow"]],
    ["a lamp twice", ["red", "red", "green"]],
  ])("rejects a head listed %s", (_, lamps) => {
    expect(SignalHeadDefSchema.safeParse({ ...valid, lamps }).success).toBe(false);
  });

  it("accepts the law's two orders", () => {
    expect(SignalHeadDefSchema.safeParse({ ...valid, lamps: ["red", "yellow", "green"] }).success).toBe(true);
    expect(SignalHeadDefSchema.safeParse({ ...valid, lamps: ["red", "green"] }).success).toBe(true);
  });
});

// Not 施行令第3条 (it sets only the 赤・黄・青 and 赤・青 orders): the arrow rules below follow
// common practice, unconfirmed against 施行規則 or 警察庁の灯器の仕様書 (knowledge/signal-system.md).
describe("the arrow row (矢印段, practice not yet checked against a primary source)", () => {
  it("builds arrows only under a 横型 3 灯 vehicle head, left to right, each once (other heads: not supported)", () => {
    const parse = (d: object) => SignalHeadDefSchema.safeParse({ ...valid, ...d }).success;
    expect(parse({ arrows: ["left", "through", "right"] })).toBe(true);
    expect(parse({ arrows: ["right", "left"] })).toBe(false);
    expect(parse({ arrows: ["right", "right"] })).toBe(false);
    expect(parse({ orientation: "vertical", arrows: ["right"] })).toBe(false);
    expect(parse({ lamps: ["red", "green"], arrows: ["right"] })).toBe(false);
  });

  const def = SIGNAL_HEADS["vehicle-h3-arrows"];
  const places = lampLayout(def);
  const at = (lamp: string) => {
    const p = places.find((q) => q.lamp === lamp);
    if (!p) throw new Error(`no ${lamp}`);
    return p;
  };

  it("puts each arrow under the main lamp of its side, below the main row", () => {
    expect(at("arrow-left").x).toBe(at("green").x);
    expect(at("arrow-through").x).toBe(at("yellow").x);
    expect(at("arrow-right").x).toBe(at("red").x);
    for (const a of ["arrow-left", "arrow-through", "arrow-right"])
      expect(at(a).y).toBeLessThan(-def.housing.hM / 2);
  });

  it("turns the arrow artwork (drawn pointing up) to point the way it means", () => {
    const pointing = (lamp: string) => {
      const { turn } = at(lamp);
      return { x: -Math.sin(turn), y: Math.cos(turn) }; // (0, 1) turned by `turn`
    };
    expect(pointing("arrow-left").x).toBeCloseTo(-1);
    expect(pointing("arrow-through").y).toBeCloseTo(1);
    expect(pointing("arrow-right").x).toBeCloseTo(1);
  });

  it("gives a right-arrow-only head a one-slot row under the red lamp", () => {
    const right = SIGNAL_HEADS["vehicle-h3-right"];
    const [, row] = housingLayout(right);
    expect(row.x).toBe(lampLayout(right).find((p) => p.lamp === "red")?.x);
    expect(row.wM).toBeCloseTo(right.housing.wM - 2 * right.pitchM);
  });

  it("keeps every lens inside its housing box, clear of its neighbours", () => {
    for (const d of HEADS) {
      const half = d.lens.sizeMm / 2000 + d.lens.bezelM;
      const boxes = housingLayout(d);
      for (const p of lampLayout(d)) {
        const inside = boxes.some(
          (b) =>
            Math.abs(p.x - b.x) + half <= b.wM / 2 + 1e-9 && Math.abs(p.y - b.y) + half <= b.hM / 2 + 1e-9,
        );
        expect(inside, `${d.id} ${p.lamp}`).toBe(true);
      }
      expect(d.pitchM, d.id).toBeGreaterThanOrEqual(2 * half);
    }
  });
});

describe("what the game shows (unchanged by T1)", () => {
  it("places the 3 灯横型 on its arm and the 歩行者用 2 灯 on its pole, from the housings it always has", () => {
    expect([VEHICLE_HEAD.id, VEHICLE_HEAD.node, VEHICLE_HEAD.mount]).toEqual([
      "vehicle-h3",
      "SignalHead",
      "arm",
    ]);
    expect([PED_HEAD.id, PED_HEAD.node, PED_HEAD.mount]).toEqual(["ped-v2", "PedHead", "pole"]);
    expect(SIGNAL_MOUNTS[VEHICLE_HEAD.mount]).toBe(ARM_MOUNT);
    expect(SIGNAL_MOUNTS[PED_HEAD.mount]).toBe(PED_POLE_MOUNT);
  });

  it("keeps the sizes and heights the game has used: 300 mm lenses 0.37 m apart at 5.2 m, drawn 1.3 times", () => {
    expect(VEHICLE_HEAD.lens.sizeMm).toBe(300);
    expect(VEHICLE_HEAD.pitchM).toBe(0.37);
    expect(VEHICLE_HEAD.housing).toEqual({ wM: 1.15, hM: 0.4, dM: 0.11, cornerM: 0.07 });
    expect(headHang(VEHICLE_HEAD)).toBe(0.48);
    expect(ARM_MOUNT).toMatchObject({ centreHeightM: 5.2, drawScale: 1.3, verified: false });
    expect(PED_HEAD.lens).toMatchObject({ shape: "square", sizeMm: 250 });
    expect(lampLayout(PED_HEAD).map((p) => p.y)).toEqual([0.175, -0.175]);
    expect(PED_POLE_MOUNT).toMatchObject({ centreHeightM: 2.75, offsetM: 0.3, verified: false });
  });
});

describe(`${SIGNAL_REGISTRY_PATH} (what the Blender script models from)`, () => {
  it("is what scripts/signals.ts writes from the definitions now (run just make-signal-layout)", () => {
    expect(JSON.parse(readFileSync(join(ROOT, SIGNAL_REGISTRY_PATH), "utf8"))).toEqual(signalRegistry());
  });

  it("is the only lamp spacing: neither the Blender script nor the game keeps a copy", () => {
    for (const file of [
      "scripts/blender/signals.py",
      "src/world/signalModels.ts",
      "src/world/trafficControl.ts",
    ])
      expect(readFileSync(join(ROOT, file), "utf8"), file).not.toMatch(
        /\b(LAMP_GAP|PED_Y|PED_LAMP_Y)\s*=\s*[\d.]/,
      );
  });
});

// ---------- the model ----------

type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
};
type GltfJson = { nodes: GltfNode[]; scenes: Array<{ extras?: { signalHeadsSha256?: string } }> };
/** The JSON chunk of a .glb (node names, transforms, extras; the geometry stays compressed). */
function gltfJson(file: string): GltfJson {
  const bytes = readFileSync(join(ROOT, file));
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) as GltfJson;
}

// What this proves: the glb was built from the current definitions, so its lenses sit where
// lampLayout (and so 施行令第3条, tested above) puts them. It does not look at the geometry.
describe("public/models/signals.glb in step with lampLayout", () => {
  const gltf = gltfJson("public/models/signals.glb");
  const { nodes } = gltf;
  const byName = new Map(nodes.map((n) => [n.name, n]));

  it(`was built from the current ${SIGNAL_REGISTRY_PATH} (else run just make-signal-model)`, () => {
    const sha = createHash("sha256")
      .update(readFileSync(join(ROOT, SIGNAL_REGISTRY_PATH)))
      .digest("hex");
    expect(gltf.scenes[0].extras?.signalHeadsSha256).toBe(sha);
  });

  it.each(HEADS.map((d) => [d.node, d] as const))(
    "marks every lens of %s where lampLayout puts it (red rightmost / topmost)",
    (node, def) => {
      const housing = byName.get(node);
      expect(housing?.mesh, `${node} is a mesh`).toBeDefined();
      // No rotation: the housing keeps the lens-faces-+Z convention, so +X is the viewer's right.
      expect(housing?.rotation).toBeUndefined();
      const marks = (housing?.children ?? []).map((i) => nodes[i]);
      const places: LampPlace[] = marks.map((m) => {
        const [x = 0, y = 0] = m.translation ?? [];
        return { lamp: (m.name ?? "").slice(node.length + 1) as LampPlace["lamp"], x, y, turn: 0 };
      });
      const expected = lampLayout(def);
      expect(places.map((p) => p.lamp).sort()).toEqual(expected.map((p) => p.lamp).sort());
      for (const e of expected) {
        const p = places.find((q) => q.lamp === e.lamp);
        expect(p?.x, `${node}_${e.lamp}`).toBeCloseTo(e.x, 5);
        expect(p?.y, `${node}_${e.lamp}`).toBeCloseTo(e.y, 5);
      }
      expectLawOrder(def, places);
    },
  );

  it("has the lens and support parts the game builds heads from", () => {
    for (const name of ["SignalLamp", "SignalArrowLamp", "PedLamp", "SignalPole", "SignalArm"])
      expect(byName.get(name)?.mesh, name).toBeDefined();
  });
});
