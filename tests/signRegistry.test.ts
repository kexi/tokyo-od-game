import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCatalog } from "../src/signs/catalog";
import { formatGameTable } from "../src/signs/gameTable";
import { signCoverage } from "../src/signs/coverage";
import { layoutJson, PyFloat } from "../src/signs/jsonLayout";
import { buildRegistry, facesOf, formatRegistry, lanePlate } from "../src/signs/registry";
import { laneKey as signLaneKey, laneSign } from "../src/signs/lanes";
import { LANE_KEY, PAINTER_MODULES } from "../src/signs/schema";
import { assumedLanes, SIGN, type LaneDirection } from "../src/world/regulations";
import { design } from "../src/world/signs";
import { loadRegistry, turnlaneValues } from "../scripts/signInputs";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const { law, registry } = loadRegistry(root);
const statutory = registry.signs.filter((s) => s.group !== "法定外");

/** Every face of every sign, with the sign it belongs to. */
const faces = registry.signs.flatMap((s) => facesOf(registry, s.id).map((f) => ({ ...f, id: s.id })));
const signsOfFile = new Map<string, Set<string>>();
for (const f of faces) signsOfFile.set(f.file, (signsOfFile.get(f.file) ?? new Set()).add(f.id));

/** Node names of a .glb (its JSON chunk follows the 12-byte header and the chunk's own 8 bytes). */
function glbNodeNames(path: string): Set<string> {
  const buf = readFileSync(join(root, path));
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as {
    nodes: Array<{ name?: string }>;
  };
  return new Set(gltf.nodes.flatMap((n) => (n.name ? [n.name] : [])));
}

/** `lt-t-r` → [[left, through], [through], [right]] (the lane letters of the render file names). */
function laneDirections(key: string): LaneDirection[][] {
  const letters: Record<string, LaneDirection> = {
    u: "reverse",
    l: "left",
    hl: "slight_left",
    t: "through",
    hr: "slight_right",
    r: "right",
  };
  return key.split("-").map((lane) => [...lane.matchAll(/hl|hr|u|l|t|r/g)].map((m) => letters[m[0]]));
}

/** The files design() picks for a sign type over the values it is placed with. */
function designFiles(kind: keyof typeof SIGN): string[] {
  const type = SIGN[kind];
  const values = Array.from({ length: 13 }, (_, i) => i * 10).concat([1, 2, 3, 4, 5, 6]);
  const lanes = registry.lanes.filter((r) => !r.lanes.includes("~")).map((r) => laneDirections(r.lanes));
  const designs = [...values.map((v) => design(type, v)), ...lanes.map((l) => design(type, 0, l))];
  return [
    ...new Set(designs.flatMap((d) => (d ? [`${d.file}.png`, ...(d.back ? [`${d.back}.png`] : [])] : []))),
  ];
}

describe("the generated files", () => {
  it("are fresh: registry.json and catalog.json are, byte for byte, what the definitions give now", () => {
    // A freshness check (edited defs without `just make-sign-registry`, or a hand-edited file).
    // That the G1a conversion lost nothing was shown once against the pre-G1a catalog.json; its
    // sha256 is in knowledge/sign-system.md.
    expect(formatRegistry(registry)).toBe(read("assets/signs/registry.json"));
    expect(formatCatalog(registry)).toBe(read("assets/signs/catalog.json"));
    expect(formatGameTable(registry)).toBe(read("assets/signs/game.json"));
  });
});

/** An OSM turn:lanes value as the game reads it (regulations.ts resolveLaneUse), as a render key. */
function osmLaneKey(value: string): string {
  const known = new Set(["left", "slight_left", "through", "slight_right", "right", "reverse"]);
  const lanes = value.split("|").map((lane) => {
    const set = lane.split(";").filter((t) => known.has(t)) as LaneDirection[];
    return set.length > 0 ? set : (["through"] as LaneDirection[]);
  });
  return laneKey(lanes);
}

/**
 * Lane directions as the render key, letters in slug order. Spelt out here apart from
 * src/signs/lanes.ts laneKey (which builds the registry and the game's lookup), so the game's own
 * reading of turn:lanes and assumedLanes is checked against the rendered keys independently.
 */
function laneKey(lanes: readonly LaneDirection[][]): string {
  const order: Array<[LaneDirection, string]> = [
    ["reverse", "u"],
    ["left", "l"],
    ["slight_left", "hl"],
    ["through", "t"],
    ["slight_right", "hr"],
    ["right", "r"],
  ];
  return lanes.map((set) => order.flatMap(([d, l]) => (set.includes(d) ? [l] : [])).join("")).join("-");
}

describe("the pre-rendered lane signs (src/signs/defs/lanes.ts)", () => {
  const rendered = new Set(registry.lanes.map((r) => r.lanes));

  it("include every turn:lanes value of public/data/turnlanes, read as the game reads it", () => {
    const values = turnlaneValues(root);
    expect(values.length).toBeGreaterThan(0);
    expect([...new Set(values.map(osmLaneKey))].filter((k) => !rendered.has(k))).toEqual([]);
  });

  it("start with the 図示 of 327の7-A…D and end with the 専用・優先 examples", () => {
    // That the rule gives the 141 patterns lanes.ts listed by hand until G1b, in that order, was
    // checked once (knowledge/sign-system.md); the registry freshness test keeps it since.
    expect(registry.lanes.slice(0, 4).map((r) => `${r.lanes} ${r.sign}`)).toEqual([
      "lt-t-r 327の7-A",
      "lt 327の7-B",
      "l 327の7-C",
      "t 327の7-D",
    ]);
    expect(registry.lanes.slice(-5).map((r) => `${r.lanes} ${r.sign}`)).toEqual([
      "lt~bus-t-r 327の4",
      "lt~busp-t-r 327の5",
      "lt~bus-t-t-r 327の4",
      "lt~busp-t-t-r 327の5",
      "t~cyc-t-r 327の4",
    ]);
  });

  it("read lanes as lanes.py does: + or ; between words, unknown words dropped, an empty lane straight on", () => {
    expect(signLaneKey("left;through|through|right")).toBe("lt-t-r");
    expect(signLaneKey(["right+left", " through ", "", "u_turn"])).toBe("lr-t-t-t");
    expect(signLaneKey([{ dirs: "left;through", use: "bus_priority" }, "slight_right;reverse"])).toBe(
      "lt~busp-uhr",
    );
  });

  it("belong to 327の7-D/C/B for one lane, -A for more, and 327の4 / 327の5 with a 専用・優先 lane", () => {
    expect(["through", "left", "left;through", "right", "reverse"].map((l) => laneSign(l))).toEqual([
      "327の7-D",
      "327の7-C",
      "327の7-B",
      "327の7-B",
      "327の7-B",
    ]);
    expect(laneSign("through|right")).toBe("327の7-A");
    expect(laneSign([{ dirs: "through", use: "bicycle" }])).toBe("327の4");
    expect(
      laneSign([
        { dirs: "through", use: "bus" },
        { dirs: "through", use: "bus_priority" },
      ]),
    ).toBe("327の5");
  });

  it("include every pattern assumedLanes gives for 1–6 lanes and the exits a junction can have", () => {
    const exitSets: LaneDirection[][] = [
      ["through"],
      ["left", "through"],
      ["through", "right"],
      ["left", "through", "right"],
      ["left", "right"],
      ["left"],
      ["right"],
    ];
    const keys = [1, 2, 3, 4, 5, 6].flatMap((n) => exitSets.map((e) => laneKey(assumedLanes(n, new Set(e)))));
    expect(keys.filter((k) => !rendered.has(k))).toEqual([]);
  });

  it("accept only keys with a direction in every lane", () => {
    for (const bad of ["t--r", "-t", "t-", "~bus", "t-~bus", "h"])
      expect(LANE_KEY.test(bad), bad).toBe(false);
    for (const good of ["t", "lt-t-r", "lt~bus-t-r", "u-hl-hr"]) expect(LANE_KEY.test(good), good).toBe(true);
  });
});

describe("the definitions against 別表第一 (assets/signs/law-table.json)", () => {
  it("have one definition per 番号, in the law's order, with its 種類 and group", () => {
    expect(statutory.map((s) => s.id)).toEqual(law.signs.map((r) => r.id));
    expect(statutory.map((s) => [s.id, s.name, s.group])).toEqual(
      law.signs.map((r) => [r.id, r.name, r.group]),
    );
  });

  it("use x- names only for the 法定外 signs, after the statutory ones", () => {
    const nonStatutory = registry.signs.slice(statutory.length);
    expect(nonStatutory.every((s) => s.group === "法定外" && s.id.startsWith("x-"))).toBe(true);
  });

  it("give every id once", () => {
    const ids = registry.signs.map((s) => s.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe("the definitions against the artwork (assets/signs/textures)", () => {
  const pngs = readdirSync(join(root, "assets/signs/textures")).filter((f) => f.endsWith(".png"));

  it("name only PNGs that exist, and every PNG belongs to a definition", () => {
    const named = new Set(faces.map((f) => f.file));
    expect([...named].filter((f) => !pngs.includes(f))).toEqual([]);
    expect(pngs.filter((f) => !named.has(f))).toEqual([]);
  });

  it("name Pillow functions of scripts/textures that are declared to return an image", () => {
    const source = new Map(
      PAINTER_MODULES.map((m) => {
        const file = m === "sign_textures" ? "sign_textures.py" : `signs/${m}.py`;
        return [m, read(`scripts/textures/${file}`)];
      }),
    );
    const named = registry.signs.flatMap((s) =>
      s.art?.by === "texture" ? [s.art.paint, ...s.art.variants.map((v) => v.paint)] : [],
    );
    /** A public `def` declared `-> Image.Image` (parameters may hold one level of brackets). */
    const isPainter = (module: (typeof PAINTER_MODULES)[number], fn: string) =>
      !fn.startsWith("_") &&
      new RegExp(`^def ${fn}\\((?:[^()]|\\([^()]*\\))*\\) -> Image\\.Image:`, "m").test(
        source.get(module) ?? "",
      );
    const missing = named.flatMap((p) => {
      if (!p) return [];
      const [module, fn] = p.fn.split(".") as [(typeof PAINTER_MODULES)[number], string];
      return isPainter(module, fn) ? [] : [p.fn];
    });
    // The generator's own functions and helpers that draw nothing on their own are not painters.
    for (const fn of ["generate", "render", "main", "draw_arrow_head", "_paint_with"])
      expect(isPainter("sign_textures", fn), fn).toBe(false);
    expect(isPainter("auxiliary", "plate_height")).toBe(false);
    expect(named.length).toBeGreaterThan(200);
    expect([...new Set(missing)]).toEqual([]);
    expect(registry.painterModules).toEqual(PAINTER_MODULES);
  });

  it("give each PNG one owner (a sign showing another's plate borrows it through shares)", () => {
    const owned = registry.signs
      .filter((s) => s.shares === undefined)
      .flatMap((s) => facesOf(registry, s.id).map((f) => f.file));
    expect(owned.filter((f, i) => owned.indexOf(f) !== i)).toEqual([]);
  });

  it("give a reason for every number that is not drawn, and draw every other one", () => {
    for (const s of registry.signs) {
      const isDrawn = facesOf(registry, s.id).length > 0;
      const hasReason = s.art?.by === "none" && s.art.reason.length > 0;
      expect(isDrawn !== hasReason, s.id).toBe(true);
    }
  });

  it("share plates only with drawn numbers, and render lanes only for drawn ones", () => {
    const byId = new Map(registry.signs.map((s) => [s.id, s]));
    for (const s of registry.signs.filter((x) => x.shares !== undefined))
      expect(byId.get(s.shares as string)?.art?.by, `${s.id} → ${s.shares}`).toBe("texture");
    for (const r of registry.lanes) expect(byId.get(r.sign)?.art?.by, r.lanes).toBe("texture");
    const keys = registry.lanes.map((r) => r.lanes);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});

describe("the plates (src/signs/plates.ts)", () => {
  const nodes = glbNodeNames("public/models/signs.glb");

  it("are nodes of public/models/signs.glb", () => {
    expect(Object.keys(registry.plates).filter((n) => !nodes.has(n))).toEqual([]);
  });

  it("measure what their names say (PlateRect120x90 = 1200 × 900 mm)", () => {
    for (const [name, plate] of Object.entries(registry.plates)) {
      const m = /(\d+)x(\d+)$/.exec(name);
      if (!m) continue;
      expect(plate.sizeMm, name).toEqual([Number(m[1]) * 10, Number(m[2]) * 10]);
    }
  });

  it("cover the inverted triangle's bounding box, 80 × 69.3 cm (UV 0–1 over the box)", () => {
    const [w, h] = registry.plates.PlateTriangle.sizeMm;
    expect(w).toBe(800);
    expect(h).toBeCloseTo((800 * Math.sqrt(3)) / 2, 0);
  });

  it("put lane renders on 40 cm per lane × 90 cm, one lane on the 90 cm square", () => {
    expect(lanePlate("t")).toBe("PlateSquare90");
    expect(lanePlate("lt-t-r")).toBe("PlateRect120x90");
    expect(registry.lanes.every((r) => r.plate in registry.plates)).toBe(true);
  });
});

describe("the definitions against the game (regulations.ts SIGN, signs.ts design)", () => {
  const kinds = Object.keys(SIGN) as Array<keyof typeof SIGN>;

  it("show 指定方向外進行禁止 by its 別表第一 number, the old turn_<mask> names kept as legacy aliases", () => {
    const byLegacy = new Map(registry.signs.flatMap((s) => (s.legacy ?? []).map((n) => [n, s.id] as const)));
    for (const mask of [1, 2, 3, 4, 5, 6]) {
      const d = design(SIGN.turn, mask);
      expect(d?.id, `mask ${mask}`).toMatch(/^311-[A-D]$/);
      expect(byLegacy.get(`turn_${mask}`), `turn_${mask}`).toBe(d?.id);
    }
    expect(design(SIGN.turn, 7)).toBeNull(); // 311-E (all three) is drawn but not placed
  });

  it("read a lane with no direction, or only unknown words, as straight on when picking the lane plate", () => {
    const empty = [[], ["right"]] as unknown as LaneDirection[][];
    expect(design(SIGN.laneArrows, 0, empty)?.file).toBe("327-7_t-r");
    expect(design(SIGN.laneArrows, 0, [["through"], ["right"]])?.file).toBe("327-7_t-r");
  });

  it("put up no lane plate for a pattern that was not drawn (more lanes than assumedLanes covers)", () => {
    const eight = Array.from({ length: 8 }, () => ["through"]) as LaneDirection[][];
    expect(design(SIGN.laneArrows, 0, eight)).toBeNull();
  });

  it("show the posted speed only for the limits the game always drew (20–80 km/h), not 10 or 100–120", () => {
    expect([20, 30, 40, 50, 60, 70, 80].map((v) => design(SIGN.speed, v)?.file)).toEqual(
      [20, 30, 40, 50, 60, 70, 80].map((v) => `speed_${v}`),
    );
    expect([10, 100, 110, 120].map((v) => design(SIGN.speed, v))).toEqual([null, null, null, null]);
  });

  it("name only sign types the game has", () => {
    const named = registry.signs.flatMap((s) => (s.game ? [s.game.kind] : []));
    expect(named.filter((k) => !(k in SIGN))).toEqual([]);
  });

  it("give every game sign type a definition", () => {
    const named = new Set(registry.signs.flatMap((s) => (s.game ? [s.game.kind] : [])));
    expect(kinds.filter((k) => !named.has(k))).toEqual([]);
  });

  it("are what the game draws for that type: each file design() picks is a face of a definition of the type", () => {
    for (const kind of kinds) {
      for (const file of designFiles(kind)) {
        const owners = [...(signsOfFile.get(file) ?? [])];
        const ofKind = owners.filter((id) => registry.signs.find((s) => s.id === id)?.game?.kind === kind);
        expect(
          ofKind.length,
          `${kind}: ${file} (faces of ${owners.join(", ") || "nothing"})`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("are drawn by the game for their type: every definition with a kind has a face design() picks", () => {
    for (const s of registry.signs.filter((x) => x.game)) {
      const picked = designFiles(s.game?.kind as keyof typeof SIGN);
      const shown = facesOf(registry, s.id).some((f) => picked.includes(f.file));
      expect(shown, `${s.id} (${s.game?.kind})`).toBe(true);
    }
  });
});

describe("the coverage report (just show-sign-coverage)", () => {
  const c = signCoverage(registry, law);

  it("adds up: every definition is undrawn, or drawn and placed or not", () => {
    expect(c.drawn + c.undrawn.length).toBe(c.total);
    expect(c.placed + c.unplaced.length).toBe(c.drawn);
    expect(c.missingFromDefs).toEqual([]);
    expect(c.notInLaw).toEqual([]);
  });

  it("lists drawn signs the game does not place yet (324 最低速度, 325 自動車専用)", () => {
    const ids = c.unplaced.map((u) => u.id);
    expect(ids).toContain("324");
    expect(ids).toContain("325");
    expect(ids).not.toContain("323");
  });
});

/** A thunk building a registry from these definitions, for toThrow. */
const build =
  (defs: unknown[], lanes: unknown[] = []) =>
  () =>
    buildRegistry(defs, lanes, law);

describe("a broken definition", () => {
  const base = { id: "999", name: "試験", group: "規制", plate: "PlateCircle" };

  it("is refused with the sign and the field", () => {
    expect(build([{ ...base, plate: "PlateNothing", art: { by: "texture", file: "a.png" } }])).toThrow(
      /sign 999 plate/,
    );
    expect(build([{ ...base }])).toThrow(/art か shares/);
    expect(build([{ ...base, id: "x-test", group: "規制", art: { by: "texture", file: "a.png" } }])).toThrow(
      /x- の名前は法定外だけ/,
    );
    expect(
      build([{ ...base, id: "x-test", group: "法定外", art: { by: "texture", file: "a.png" } }]),
    ).toThrow(/source/);
  });

  it("cannot share the plate of a sign with no art, nor render lanes for one", () => {
    const undrawn = { ...base, id: "998", plate: null, art: { by: "none", reason: "試験" } };
    expect(build([undrawn, { ...base, shares: "998" }])).toThrow(/sign 999: shares 998/);
    expect(build([undrawn], [{ lanes: "t", sign: "998" }])).toThrow(/lane t: sign 998/);
  });

  const drawn = {
    id: "301",
    name: "通行止め",
    group: "規制",
    plate: "PlateCircle",
    art: { by: "texture", file: "a.png", paint: { fn: "regulatory.road_closed" } },
  };

  it("is refused when its id is given twice, or is not a 番号 of 別表第一", () => {
    expect(build([drawn, drawn])).toThrow(/sign 301: defined more than once/);
    expect(build([{ ...drawn, id: "999" }])).toThrow(/sign 999: not a 番号 of 別表第一/);
  });

  it("takes the plate of the number it shares, and refuses another plate", () => {
    const sharer = { id: "302", name: "車両通行止め", group: "規制", shares: "301" };
    const reg = build([drawn, sharer])();
    expect(reg.signs.find((s) => s.id === "302")?.plate).toBe("PlateCircle");
    expect(build([drawn, { ...sharer, plate: "PlateSquare" }])).toThrow(
      /plate PlateSquare is not the plate of 301/,
    );
    expect(build([{ ...drawn, plate: undefined }])).toThrow(/plate を省けるのは shares のときだけ/);
  });

  it("is refused when two of its faces have the same key", () => {
    const twice = {
      by: "texture",
      file: "a.png",
      variants: [
        { key: "x", file: "b.png" },
        { key: "x", file: "c.png" },
      ],
    };
    expect(build([{ ...drawn, art: twice }])).toThrow(/sign 301: variant key x used more than once/);
  });

  it("is refused when the game could not tell which face to show", () => {
    const game = (g: object) => ({ ...drawn, game: g });
    expect(build([game({ kind: "roadClosed" }), { ...game({ kind: "roadClosed" }), id: "302" }])).toThrow(
      /game roadClosed: shown by default face, but 301,302 claim it/,
    );
    expect(build([game({ kind: "speed", pick: "value" })])).toThrow(
      /game speed: picks by value, but no face has one/,
    );
    const valued = { ...drawn.art, gameValue: 3 };
    expect(build([{ ...drawn, art: valued }])).toThrow(/sign 301: gameValue on a sign whose game type/);
    expect(build([game({ kind: "laneArrows", pick: "lanes" })])).toThrow(
      /picks by lanes, but none are rendered/,
    );
    expect(build([game({ kind: "oneway", back: "left" })])).toThrow(
      /game.back left is not one of its variants/,
    );
    expect(build([game({ kind: "nothing" })])).toThrow(/sign 301 game.kind/);
    expect(build([{ ...drawn, legacy: ["301"] }])).toThrow(/legacy 301: is a sign id/);
    const crossing = (id: string, g: object) => ({
      ...drawn,
      id,
      game: { kind: "turn", pick: "value", ...g },
    });
    const valuedArt = (v: number) => ({ ...drawn.art, gameValue: v });
    expect(
      build([
        { ...crossing("311-A", {}), art: valuedArt(1) },
        { ...crossing("311-B", { bothFaces: true }), art: valuedArt(2) },
      ]),
    ).toThrow(/game turn: its definitions differ in mount, back or bothFaces/);
  });

  it("is refused when a face has no painter, a lane render has one, or a face is drawn over nothing", () => {
    const paint = { fn: "regulatory.road_closed" };
    expect(build([{ ...drawn, art: { by: "texture", file: "a.png" } }])).toThrow(
      /sign 301: a.png has no paint/,
    );
    const laneArt = { by: "texture", file: "327-7_t.png", paint };
    expect(build([{ ...drawn, art: laneArt }], [{ lanes: "t", sign: "301" }])).toThrow(
      /327-7_t.png is a lane render/,
    );
    const over = { key: "x", file: "b.png", paint: { ...paint, over: "z.png" } };
    expect(build([{ ...drawn, art: { ...drawn.art, variants: [over] } }])).toThrow(
      /b.png is drawn over z.png, not drawn on its own/,
    );
    expect(build([{ ...drawn, art: { ...drawn.art, paint: { fn: "os.system" } } }])).toThrow(
      /module.function/,
    );
  });
});

describe("layoutJson (the oxfmt layout catalog.py wrote)", () => {
  it("writes Python floats with .0, and keeps short scalar arrays on one line", () => {
    expect(layoutJson({ a: [new PyFloat(600), new PyFloat(692.8), 3] })).toBe(
      '{\n  "a": [600.0, 692.8, 3]\n}\n',
    );
  });

  it("breaks a scalar array that would pass the width, counting code points (not UTF-16 units)", () => {
    const long = ["あ".repeat(50), "い".repeat(50)];
    expect(layoutJson({ k: long })).toBe(`{\n  "k": [\n    "${long[0]}",\n    "${long[1]}"\n  ]\n}\n`);
    expect(layoutJson({ k: ["𠮷".repeat(60)] })).toBe(`{\n  "k": ["${"𠮷".repeat(60)}"]\n}\n`);
  });

  it("leaves out an object's undefined values, and refuses holes, NaN and Infinity", () => {
    expect(layoutJson({ a: 1, b: undefined })).toBe('{\n  "a": 1\n}\n');
    expect(() => layoutJson([1, undefined] as unknown as number[])).toThrow(/undefined inside an array/);
    expect(() => layoutJson({ a: Number.NaN })).toThrow(/not a JSON number/);
    expect(() => layoutJson({ a: new PyFloat(Number.POSITIVE_INFINITY) })).toThrow(/not a JSON number/);
  });

  it("refuses floats Python would print in exponent form (≥ 1e16, < 1e-4 but not 0)", () => {
    expect(() => layoutJson([new PyFloat(1e16)])).toThrow(/as Python prints it/);
    expect(() => layoutJson([new PyFloat(5e-5)])).toThrow(/as Python prints it/);
    expect(layoutJson([new PyFloat(0), new PyFloat(1e-4)])).toBe("[0.0, 0.0001]\n");
  });
});
