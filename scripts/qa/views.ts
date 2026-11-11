// The multi-view review's camera runner (knowledge/review-loop.md): shoots every view of a view
// table (scripts/qa/views/<name>.json) in headless Chrome, each frame with a JSON of what should be
// on the screen (the target as the game has it, where it fell in the frame and how much of it the
// screen holds, the look, how settled the world was), then a contact sheet, a review template and
// the round's run.json.
//
//   just shoot-views signals                       (the next round; the dev server: just serve-dev)
//   pnpm exec tsx scripts/qa/views.ts <name|path.json> [--round N] [--out DIR] [--only ids] [--base URL] [--port N]
//
// Output: .qa/views/<name>/round-NN/<shot>.jpg + .json, run.json, contact-sheet.jpg,
// review-template.json. The round number is the one after the last complete round; an incomplete
// round (a failed or --only shoot) is shot again under its own number. Exit 1 when any shot failed
// (and run.json says incomplete, so check-convergence does not count the round).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { log, warn } from "../../src/log";
import type { Found, TargetQuery, ViewTarget } from "../../src/debug/viewHooks";
import { launch, type Browser } from "./browser.mjs";
import { writeContactSheet } from "./contactSheet.ts";
import { deriveMetrics, probePixels, probeStats, type ProbeRecord, type ProbeStats } from "./pixelProbes.ts";
import { freePort } from "./ports.ts";
import { nextRound, type RunRecord } from "./runRecord.ts";
import { CENTRED_WITHIN, offCentre, placeView, type Vec3 } from "./viewGeometry.ts";
import { WET_RETRO } from "../../src/signs/retroAssumptions";
import { retroEmission, retroWhite } from "../../src/signs/retroreflection";
import {
  loadLook,
  loadsOf,
  loadUrl,
  parseViewTable,
  shotKey,
  shotKeys,
  type Load,
  type Probe,
  type View,
} from "./viewTable.ts";

const ROOT = join(import.meta.dirname, "..", "..");
/** How long after the start the game may still move the car onto a street (main.ts, 15 s) and a margin. */
const STREET_SPAWN_MS = 16_000;
/** Half the side of the box read round the plate's centre, px (a 75 cm plate at 60 m is ~8 px). */
const PLATE_BOX_HALF = 2;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tableArg = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!tableArg)
  throw new Error(
    "usage: views.ts <name|path.json> [--round N] [--out DIR] [--only ids] [--base URL] [--port N]",
  );
const tableFile = tableArg.endsWith(".json")
  ? tableArg
  : join(ROOT, "scripts", "qa", "views", `${tableArg}.json`);
const table = parseViewTable(JSON.parse(readFileSync(tableFile, "utf8")));
const expected = shotKeys(table);
const base = flag("base") || process.env.QA_URL || "http://localhost:5173/tokyo-od-game/";
const fixedPort = flag("port") ? Number(flag("port")) : null;
const only = flag("only")?.split(",").filter(Boolean) ?? null;

// Before any directory is made: a dead server must not leave an empty round behind.
const alive = await fetch(base)
  .then((r) => r.ok)
  .catch(() => false);
if (!alive) throw new Error(`dev server not reachable at ${base} — start it with: just serve-dev`);

const roundsDir = join(ROOT, ".qa", "views", table.name);
const runs = new Map<number, unknown>();
for (const d of existsSync(roundsDir) ? readdirSync(roundsDir) : []) {
  const n = /^round-(\d+)$/.exec(d)?.[1];
  if (!n) continue;
  const file = join(roundsDir, d, "run.json");
  runs.set(Number(n), existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
}
const round = Number(flag("round") ?? nextRound(runs, expected));
const pad = (n: number) => String(n).padStart(2, "0");
const out = flag("out") ?? join(roundsDir, `round-${pad(round)}`);
// Shooting a round again (incomplete, or asked for by --round) replaces what was there.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
/** A path for the logs and the template: repo-relative inside the repo, absolute outside it. */
const shown = (p: string) => {
  const r = relative(ROOT, resolve(p));
  return r.startsWith("..") ? resolve(p) : r;
};

// What the sign numbers are (name, group, standard size, the 別表第二 figure) for the frame's JSON.
type CatalogSign = {
  id: string;
  name: string;
  group: string;
  size_mm: number[] | null;
  plate: string | null;
  figure?: string;
};
const catalog = new Map(
  (
    JSON.parse(readFileSync(join(ROOT, "assets", "signs", "catalog.json"), "utf8")) as {
      signs: CatalogSign[];
    }
  ).signs.map((s) => [
    s.id,
    { name: s.name, group: s.group, sizeMm: s.size_mm, plate: s.plate, figure: s.figure ?? null },
  ]),
);

// Node's WebSocket does not hold the event loop open: while the runner only waits on the page (a
// busy page compiling shaders answers late), the process would exit mid-await. A timer holds it.
const keepAlive = setInterval(() => {}, 1000);

/** An evaluate that gives up after `ms` (a hung page must fail the load, not stall the run). */
function evaluateWithin<T>(b: Browser, expression: string, ms = 60_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`page did not answer in ${ms} ms: ${expression.slice(0, 80)}`)),
      ms,
    );
  });
  return Promise.race([b.evaluate<T>(expression), timeout]).finally(() => clearTimeout(timer));
}

/** Polls `expression` in the page until truthy (returns it) or `seconds` pass (returns null). */
async function until<T>(b: Browser, expression: string, seconds: number, every = 500): Promise<T | null> {
  const deadline = performance.now() + seconds * 1000;
  while (performance.now() < deadline) {
    const v = await evaluateWithin<T>(b, expression, 30_000).catch(() => null);
    if (v) return v;
    await b.sleep(every);
  }
  return null;
}

type Settled = { isSettled: boolean; isRoadsLoading: boolean; hasRoads: boolean; buildingsProgress: number };
/** The world settled twice in a row (a tile set finishing can start the next), then 3 frames drawn. */
async function settle(b: Browser, seconds: number): Promise<Settled> {
  const isTwice = await until<boolean>(
    b,
    "(async () => { const a = __game.debug.settled().isSettled; await new Promise((r) => setTimeout(r, 300)); return a && __game.debug.settled().isSettled; })()",
    seconds,
    200,
  );
  await evaluateWithin(
    b,
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))",
  );
  const state = await evaluateWithin<Settled>(b, "__game.debug.settled()");
  return { ...state, isSettled: isTwice === true };
}

// The HUD, the phone and the POI beams are not what is reviewed (the route arrows: the hook).
const CLEAN_FRAME = `(() => {
  if (!document.getElementById('qa-clean')) {
    const st = document.createElement('style'); st.id = 'qa-clean';
    st.textContent = '* { visibility: hidden !important } #scene { visibility: visible !important }';
    document.head.append(st);
  }
  const G = window.__game;
  for (const m of [G.field?.beams, G.field?.gems]) if (m) m.visible = false;
  return true;
})()`;

/** The kind of target a view needs, for the session's health check. */
const kindOf = (v: View) => (v.target ? (Object.keys(v.target)[0] as string) : null);

type Shot = Record<string, unknown> & { image: string; shot: string };
const shots: Shot[] = [];
const probeRecords: ProbeRecord[] = [];
const failed: RunRecord["failed"] = [];

for (const load of loadsOf(table)) {
  const views = load.session.views.filter(
    (v) => !only || [v.id, load.session.id, shotKey(load, v)].some((k) => only.includes(k)),
  );
  if (views.length === 0) continue;
  const look = loadLook(table, load);
  const url = loadUrl(base, table, load);
  const started = performance.now();
  const b = await launch(url, {
    port: fixedPort ?? (await freePort()),
    width: table.defaults.width,
    height: table.defaults.height,
  });
  const failAll = (error: string) => {
    for (const v of views) failed.push({ shot: shotKey(load, v), error });
    warn("views_shot_failed", { viewTable: table.name, viewId: `${load.prefix}/*`, error });
  };
  try {
    const isReady = await until<boolean>(b, "window.__game?.getState() === 'ready'", 180, 1000);
    if (!isReady) throw new Error(`page not ready: ${url}`);
    await evaluateWithin(b, "window.__game.start()");
    const startedAt = Date.now();
    await evaluateWithin(b, CLEAN_FRAME);
    await evaluateWithin(
      b,
      `__game.debug.camera.moment(${JSON.stringify(look.moment)}, ${look.weather === "rain"})`,
    );
    const first = await settle(b, table.defaults.settleTimeoutS);
    if (!first.isSettled) throw new Error(`the world did not settle: ${JSON.stringify(first)}`);
    // For 15 s after the start the game moves the waiting car onto the nearest street
    // (main.ts placeOnStreet): a lit car (state.headlamps) put down before then was moved back.
    const streetSpawnLeft = STREET_SPAWN_MS - (Date.now() - startedAt);
    const isLitLoad = views.some((v) => v.state?.headlamps !== undefined);
    if (isLitLoad && streetSpawnLeft > 0) await b.sleep(streetSpawnLeft);
    // Each target kind the views need must be readable before any view is tried: one clear cause
    // (not built, renamed) instead of every view failing alike.
    const needed = new Set(
      views.map(kindOf).filter((k): k is "sign" | "signal" => k === "sign" || k === "signal"),
    );
    const health = await until<Record<string, { ok: boolean; reason?: string; detail?: string }>>(
      b,
      `(() => { const h = __game.debug.targets.health(); return ${JSON.stringify([...needed])}.every((k) => h[k === 'sign' ? 'signs' : 'signals'].ok) ? h : null; })()`,
      30,
      1000,
    );
    if (!health) {
      const h = await evaluateWithin<Record<string, { ok: boolean; reason?: string; detail?: string }>>(
        b,
        "__game.debug.targets.health()",
      );
      const bad = Object.entries(h)
        .filter(([, v]) => !v.ok)
        .map(([k, v]) => `${k}: ${v.reason} (${v.detail})`);
      throw new Error(`targets not readable: ${bad.join("; ")}`);
    }
    log("views_session_loaded", {
      viewTable: table.name,
      start: load.session.start.join(","),
      views: views.length,
      loadS: Math.round((performance.now() - started) / 100) / 10,
    });
    for (const view of views) {
      const key = shotKey(load, view);
      try {
        const shot = await shoot(b, load, view, look);
        shots.push(shot);
        const p = shot.projection as { isInView: boolean; offCentre: number } | null;
        log("views_shot", {
          viewTable: table.name,
          viewId: key,
          file: shown(join(out, shot.image)),
          targetId: (shot.target as { id: string } | null)?.id ?? null,
          isInView: p?.isInView ?? null,
          offCentre: p?.offCentre ?? null,
        });
      } catch (error) {
        failed.push({ shot: key, error: String(error) });
        warn("views_shot_failed", { viewTable: table.name, viewId: key, error: String(error) });
      }
    }
  } catch (error) {
    failAll(String(error));
  } finally {
    writeFileSync(
      join(out, `console-${load.prefix}.txt`),
      b.logs.filter((l) => /error|exception|warn/i.test(l)).join("\n"),
    );
    await b.close();
  }
}

/**
 * The luminance statistics of each probe's rectangle in the saved frame. How: the page decodes the
 * JPEG (the image the reviewers see, after its compression) into a 2D canvas and returns every
 * second pixel's luma of each rectangle; the statistics are pixelProbes.ts's.
 */
async function measureProbes(
  b: Browser,
  file: string,
  probes: readonly Probe[],
): Promise<Record<string, ProbeStats | null>> {
  const data = readFileSync(file).toString("base64");
  const rects = probes.map((p) => probePixels(p, table.defaults.width, table.defaults.height));
  const lumas = await evaluateWithin<number[][]>(
    b,
    `(async () => {
    const picture = new Image();
    picture.src = "data:image/jpeg;base64,${data}";
    await picture.decode();
    const c = document.createElement("canvas");
    c.width = picture.width;
    c.height = picture.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(picture, 0, 0);
    return ${JSON.stringify(rects)}.map((r) => {
      const d = g.getImageData(r.x, r.y, r.w, r.h).data;
      const out = [];
      for (let y = 0; y < r.h; y += 2)
        for (let x = 0; x < r.w; x += 2) {
          const i = (y * r.w + x) * 4;
          out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        }
      return out;
    });
  })()`,
  );
  return Object.fromEntries(probes.map((p, i) => [p.name, probeStats(lumas[i] ?? [])]));
}

/** Finds the target, waiting a little only for what is still being built or loaded. */
async function findTarget(b: Browser, spec: TargetQuery, start: [number, number]): Promise<ViewTarget> {
  let last: Found | null = null;
  for (let i = 0; i < 15; i++) {
    last = await evaluateWithin<Found>(
      b,
      `__game.debug.targets.find(${JSON.stringify(spec)}, ${JSON.stringify(start)})`,
    );
    if (last.ok) return last.target;
    const isWorthWaiting = last.reason === "not-built" || last.reason === "not-drawn";
    if (!isWorthWaiting) break;
    await b.sleep(2000);
  }
  const why = last && !last.ok ? `${last.reason}: ${last.detail}` : "no answer";
  throw new Error(`target ${JSON.stringify(spec)}: ${why}`);
}

type SceneLamps = {
  signFaces?: {
    lamps?: {
      on: boolean;
      high: boolean;
      gain: number;
      positions: Vec3[];
      forward: Vec3;
      up: Vec3;
      eye?: Vec3 | null;
    };
  } | null;
  eye?: Vec3;
  wetness?: number;
};

/**
 * What the sign face material adds over the albedo at the target plate's centre, by the model it
 * copies (src/signs/retroreflection.ts): white luminance (cd/m²) and the emission with the frame's
 * gain (lamps lit × darkness × wet). The reviewer compares it with the picture; null for a target
 * that is not a sign.
 */
function retroAt(aim: ViewTarget | null, scene: unknown) {
  const s = scene as SceneLamps;
  const lamps = s.signFaces?.lamps;
  // A 案内標識 face returns the lamps as a plate does (one SignFaceMaterial).
  const isSign = (aim?.kind === "sign" || aim?.kind === "guide") && aim.normal !== null;
  if (!aim || !isSign || !aim.normal || !lamps || !s.eye) return null;
  const L = retroWhite(
    { ...lamps, beam: lamps.high ? "high" : "low" },
    aim.point,
    aim.normal,
    lamps.eye ?? s.eye,
  );
  const dryEmission = retroEmission(L, 0);
  const wet = 1 + (WET_RETRO.value - 1) * (s.wetness ?? 0);
  // gain already holds the wet factor (signFaces.ts): the dry emission × gain is what is drawn.
  return {
    whiteCdM2: Math.round(L * 100) / 100,
    emission: Math.round(dryEmission * lamps.gain * 1000) / 1000,
    dryEmission: Math.round(dryEmission * 1000) / 1000,
    wetFactor: Math.round(wet * 100) / 100,
    lit: lamps.on,
  };
}

/**
 * The mean relative luminance (linear, 0–1) of the picture round the plate's centre: measured from
 * the shot itself, so it checks what the shader drew, not the model's value (retroAtTarget). The
 * JPEG is decoded by the page (the scripts carry no image decoder).
 */
async function plateLuminance(
  b: Browser,
  file: string,
  ndc: { x: number; y: number },
): Promise<number | null> {
  const data = readFileSync(file).toString("base64");
  return evaluateWithin<number | null>(
    b,
    `(async () => {
      const img = new Image();
      img.src = "data:image/jpeg;base64,${data}";
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const x = Math.round(((${ndc.x} + 1) / 2) * img.width);
      const y = Math.round(((1 - ${ndc.y}) / 2) * img.height);
      const h = ${PLATE_BOX_HALF};
      const isInside = x - h >= 0 && y - h >= 0 && x + h < img.width && y + h < img.height;
      if (!isInside) return null;
      const px = g.getImageData(x - h, y - h, 2 * h + 1, 2 * h + 1).data;
      const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);
      return Math.round((sum / (px.length / 4)) * 10000) / 10000;
    })()`,
  );
}

async function shoot(b: Browser, load: Load, view: View, look: ReturnType<typeof loadLook>): Promise<Shot> {
  const key = shotKey(load, view);
  const spec = view.target as TargetQuery | undefined;
  const start = load.session.start;
  const found = spec ? await findTarget(b, spec, start) : null;
  // The signals' time of day (night plans), then a held 現示 (or the clock running again).
  const clock = view.state?.signalClock;
  const minute = clock ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) : null;
  const untilChangeOf = view.state?.signalClockToChange && found ? Number(found.facts.approachId) : null;
  await evaluateWithin(
    b,
    `__game.debug.signals.clock(${JSON.stringify(minute)}, ${JSON.stringify(untilChangeOf)})`,
  );
  const step = view.state?.signalStep;
  if (step !== undefined && found) {
    const held = await evaluateWithin<{ error?: string }>(
      b,
      `__game.debug.signals.hold(${Number(found.facts.approachId)}, ${JSON.stringify(step)})`,
    );
    if (held.error) throw new Error(held.error);
  } else await evaluateWithin(b, "__game.debug.signals.release()");
  const car = await evaluateWithin<Vec3>(
    b,
    "(() => { const p = __game.vehicle.position(); return { x: p.x, y: p.y, z: p.z }; })()",
  );
  const ctx: Parameters<typeof placeView>[2] = { fov: table.defaults.fov, car };
  const local = (p: unknown) =>
    evaluateWithin<Vec3 | null>(b, `__game.debug.targets.local(${JSON.stringify(p)})`);
  if (view.camera === "free") {
    ctx.eyeLocal = (await local(view.eye)) ?? undefined;
    ctx.lookLocal = (await local(view.lookAt)) ?? undefined;
    if (!ctx.eyeLocal || !ctx.lookLocal)
      throw new Error("free camera: ground not loaded under eye or lookAt");
  }
  const isStanding = view.camera !== "free" && view.camera !== "overhead" && view.at !== undefined && !found;
  if (isStanding && view.at) {
    ctx.atLocal = (await local({ lat: view.at.lat, lon: view.at.lon, h: 0, ref: "ground" })) ?? undefined;
    if (!ctx.atLocal) throw new Error("at: ground not loaded there");
  }
  const placement = placeView(view, found, ctx);
  const hide = view.hide ?? look.hide;
  const placed = await evaluateWithin<{ error?: string }>(
    b,
    `(() => {
    const G = __game;
    const lampCar = ${JSON.stringify(placement.lampCar ?? null)};
    const car = lampCar ?? ${JSON.stringify(placement.car ?? null)};
    if (car) {
      const ground = car.surfaceY ?? G.groundY(car.x, car.z) ?? G.vehicle.position().y;
      G.vehicle.teleport(G.vehicle.position().set(car.x, ground + car.above, car.z), car.yaw);
    } else {
      // Stopped where it is (hidden): a rolling car would move the streaming centre and its speed.
      G.vehicle.teleport(G.vehicle.position(), G.vehicle.yaw());
    }
    G.vehicle.setFrozen(true);
    // The model (and the headlamps on it) follows the body at once, not on the next step.
    G.vehicle.syncVisuals();
    G.vehicle.object.updateMatrixWorld(true);
    G.vehicle.object.visible = !!car;
    // A lit car (state.headlamps): its lamps on, its body hidden mesh by mesh (hiding the root
    // would take the SpotLights out of the scene too). The next view shows the body again.
    G.vehicle.object.traverse((o) => {
      if (!o.isMesh) return;
      const isQaHidden = o.userData.qaHidden === true;
      if (isQaHidden) { o.visible = true; o.userData.qaHidden = false; }
      if (lampCar && !lampCar.showBody && o.visible) { o.visible = false; o.userData.qaHidden = true; }
    });
    // かんたん操作 (assist "easy") sets the lights to auto and the low beam every frame: the beam
    // a view asks for holds only with the switches the player's own ("real").
    G.controls.assist = lampCar ? "real" : "easy";
    G.controls.lights = lampCar ? "on" : "auto";
    G.controls.highBeam = lampCar?.beam === "high";
    // Whose eye sees the faces' return: 後方追従 stands in for the driver (the game's rule for its
    // own camera, world/signFaceMaterial.ts); any other placed view is a camera of its own (a
    // passer-by, a photo), seen from where it stands.
    G.debug.signFaces?.().setObserver(${JSON.stringify(view.camera === "chase" ? "driver" : "camera")});
    return G.debug.camera.place({ eye: ${JSON.stringify(placement.eye)}, target: ${JSON.stringify(placement.lookAt)}, fov: ${placement.fov}, hide: ${JSON.stringify(hide)} });
  })()`,
  );
  if (placed.error) throw new Error(placed.error);
  const settled = await settle(b, table.defaults.settleTimeoutS);
  if (!settled.isSettled)
    throw new Error(`the world did not settle around the view: ${JSON.stringify(settled)}`);
  // Read the target again: lamps change, a plate may have been rebuilt meanwhile.
  const aim = spec ? await findTarget(b, spec, start) : null;
  const image = `${key}.jpg`;
  await b.screenshot(join(out, image), 85);
  const probes = view.probes?.length ? await measureProbes(b, join(out, image), view.probes) : null;
  if (probes) probeRecords.push({ shot: key, view: view.id, look: look.look, probes });
  let projection: Record<string, unknown> | null = null;
  if (aim) {
    const p = await evaluateWithin<{ ndc: { x: number; y: number }; isInView: boolean; distanceM: number }>(
      b,
      `__game.debug.camera.project(${JSON.stringify(aim.point)})`,
    );
    const box = await evaluateWithin<{ screenShare: number; insideShare: number; behind: number }>(
      b,
      `__game.debug.camera.projectBox(${JSON.stringify(aim.box)})`,
    );
    const off = offCentre(p.ndc);
    projection = { ...p, offCentre: off, isCentred: p.isInView && off <= CENTRED_WITHIN, ...box };
    const isPlate = (aim.kind === "sign" || aim.kind === "guide") && p.isInView;
    if (isPlate) projection.plateLuminance = await plateLuminance(b, join(out, image), p.ndc);
  }
  const scene = await evaluateWithin(
    b,
    `(() => { const G = __game; return {
    camera: G.debug.camera.look(),
    timeMode: G.env.timeMode, weather: G.env.weather, raining: G.env.isRaining(),
    nightFactor: Math.round(G.env.nightFactor * 100) / 100, sunElevationDeg: Math.round(G.env.sunElevation * 10) / 10,
    gameTime: G.env.now().toISOString(),
    wetness: Math.round(G.env.wetness * 100) / 100,
    eye: (() => { const p = G.camera.position; return { x: p.x, y: p.y, z: p.z }; })(),
    signFaces: G.debug.signFaces?.() ?? null,
  }; })()`,
  );
  const retro = retroAt(aim, scene);
  if (retro) (scene as Record<string, unknown>).retroAtTarget = retro;
  const signInfo = aim?.kind === "sign" || aim?.kind === "guide" ? (catalog.get(aim.id) ?? null) : null;
  const record: Shot = {
    image,
    shot: key,
    table: table.name,
    round,
    session: load.session.id,
    look,
    url: loadUrl(base, table, load),
    view,
    target: aim ? { ...aim, path: undefined, catalog: signInfo } : null,
    projection,
    scene,
    settled,
    probes,
    expect: view.expect ?? null,
  };
  writeFileSync(join(out, `${key}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

const taken = shots.map((s) => s.shot);
const run: RunRecord = {
  table: table.name,
  round,
  only,
  shots: taken,
  failed,
  complete: failed.length === 0 && only === null && expected.every((k) => taken.includes(k)),
};
writeFileSync(
  join(out, "run.json"),
  `${JSON.stringify({ ...run, tableFile: basename(tableFile), base }, null, 2)}\n`,
);
// The computed metrics as review lines: copied into round-NN.jsonl by the reviewer (the runner does
// not write the review file, which holds the reviewers' own lines).
const metricLines = deriveMetrics(table.metrics, probeRecords, round);
writeFileSync(join(out, "metrics.jsonl"), metricLines.map((l) => `${JSON.stringify(l)}\n`).join(""));
const sheet =
  shots.length > 0 ? await writeContactSheet(out, { title: `${table.name} round ${round}` }) : null;
const reviews = join(ROOT, ".qa", "reviews", table.name);
mkdirSync(reviews, { recursive: true });
// The reviewers' starting point: the shots to look at and the shape of each line.
writeFileSync(
  join(out, "review-template.json"),
  `${JSON.stringify(
    {
      table: table.name,
      round,
      isComplete: run.complete,
      writeTo: shown(join(reviews, `round-${pad(round)}.jsonl`)),
      contactSheet: sheet ? shown(sheet) : null,
      severities: ["Critical", "Warning", "Info"],
      statuses: ["open", "fixed", "wontfix"],
      requiredMetrics: table.metrics,
      shots: shots.map((s) => ({
        shot: s.shot,
        image: shown(join(out, s.image)),
        json: shown(join(out, `${s.shot}.json`)),
        expect: s.expect,
      })),
      failed,
      exampleReview: { type: "review", round, perspective: "様式", reviewer: "reviewer-1", views: taken },
      exampleFinding: {
        type: "finding",
        id: `${taken[0] ?? "shot"}:short-slug`,
        round,
        view: taken[0] ?? "shot",
        severity: "Warning",
        status: "open",
        finding: "what is wrong, in one line",
        perspective: "様式",
        basis: "道路標識令 別表第二 / the frame JSON field",
      },
      exampleClose: {
        note: "a finding stays open until a line closes it: status fixed, or wontfix with the reason in fix",
      },
      exampleMetric: {
        type: "metric",
        name: "sign-text-px-30m",
        round,
        view: taken[0] ?? "shot",
        value: 0,
        min: 12,
        unit: "px",
      },
    },
    null,
    2,
  )}\n`,
);
log("views_done", {
  viewTable: table.name,
  round,
  shots: shots.length,
  failed: failed.length,
  outDir: shown(out),
});
if (failed.length > 0) process.exitCode = 1;
clearInterval(keepAlive);
