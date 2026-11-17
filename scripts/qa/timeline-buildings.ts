// The PLATEAU buildings' loading over time, as the game sees it: when the loading screen closed
// (state "ready"), start(), when debug.settled() first said settled, the last load-model of the near
// town and the far skyline, and what was still queued, downloading or parsing ("remaining", the
// renderers' stats) at each of those moments; the near tiles visible within 300 m of the car when the
// screen closed as a share of those visible at the end; whether the screen closed on its 20 s limit;
// when the tiles within 300 m of the load centre and all the near tiles were in; and the longest
// stretch with nothing remaining before the end (a tileset's nested JSON leaves such
// gaps between one level and the next). With --warp, the same from a warp instead: the car starts at
// --start, settles, goes quiet, then warps, and the landing (the game's warp_landed line) takes the
// place of the screen closing.
//
// How: a page-side script, installed before the page's own, samples both renderers every 100 ms
// (state, settled, remaining, visible counts) and follows every frame's remaining for the gaps;
// load-model and dispose-model are timed as they come. Times are ms from navigation.
//
//   just measure-buildings-timeline label base [args]
//   pnpm exec tsx scripts/qa/timeline-buildings.ts --label L [--base URL] --start lat,lon
//     [--seconds 40] [--view near|medium|far] [--mobile] [--warp lat,lon]
//
// Output: .qa/timeline-buildings/<label>.json (the samples, events and summary) and the summary as
// one JSON line on stdout.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";
import { waitQuiet } from "./quietWatch.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
const start = flag("start") ?? "35.68075,139.76345";
const seconds = Number(flag("seconds") ?? 40);
const view = flag("view");
const isMobile = argv.includes("--mobile");
const warp = flag("warp")?.split(",").map(Number) as [number, number] | undefined;
/** The loading screen's limit (src/main.ts): closing this long after navigation means it gave up waiting. */
const SCREEN_LIMIT_MS = 20_000;
/** The warp's limit (src/main.ts finishWarp). */
const WARP_LIMIT_MS = 12_000;
/** Gaps with nothing remaining up to this long are counted as within a burst of loading. */
const SHORT_GAP_MS = 1000;
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

/**
 * Page-side. Why console wrapped: the warp's landing is only told by its warp_landed log line
 * (src/log.ts writes one JSON line a console call), and the page keeps no list of them.
 */
const PRELOAD = `
${view ? `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: ${JSON.stringify(view)} })); } catch {}` : ""}
(() => {
  const t0 = performance.now();
  const now = () => Math.round(performance.now() - t0);
  const T = (window.__tl = { samples: [], events: [], gaps: [], readyAt: null, warpLandedAt: null, near300: {} });
  for (const k of ["log", "info", "warn"]) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      const line = String(a[0] ?? "");
      if (T.warpLandedAt === null && line.includes('"event":"warp_landed"')) { T.warpLandedAt = now(); T.near300.landed = window.__tlNear300?.() ?? null; }
      return orig(...a);
    };
  }
  const left = (r) => r ? r.stats.queued + r.stats.downloading + r.stats.parsing : 0;
  const stat = (r) => r && { remaining: left(r), downloading: r.stats.downloading, failed: r.stats.failed, refused: r.stats.refused ?? 0, visible: r.visibleTiles.size };
  const codeOf = (tile) => ((tile?.internal?.basePath ?? "").match(new RegExp("/([0-9]{5})_")) || [])[1] ?? "?";
  // The tiles shown within 300 m of a point (ECEF): by default where play begins (the car when it
  // has landed from a warp, else the load's centre: on the title the car is not placed yet). The
  // point is kept, and the end's set is taken round the same point: the car is put on a street
  // after the start, and a set round where it went would differ without anything loading late.
  window.__tlNear300 = (at) => {
    const g = window.__game, b = g.buildings;
    const point = at ? new b.maskRegion.sphere.center.constructor(...at) : T.warpLandedAt !== null
      ? g.vehicle.position().clone().applyMatrix4(b.frame.localToEcef)
      : b.maskRegion.sphere.center.clone();
    if (!at) T.near300.at = point.toArray();
    const keys = [];
    for (const tile of b.tiles.visibleTiles) {
      const bv = tile.engineData?.boundingVolume;
      if (bv && bv.distanceToPoint(point) <= 300) keys.push((tile.internal?.basePath ?? "") + "|" + (tile.content?.uri ?? ""));
    }
    return keys;
  };
  let hookedNear = null, hookedFar = null, gapFrom = null, prevLeft = 0;
  const tick = () => {
    const b = window.__game?.buildings;
    if (b?.tiles) {
      const l = left(b.tiles);
      const t = now();
      if (l === 0 && prevLeft > 0) gapFrom = t;
      if (l > 0 && prevLeft === 0 && gapFrom !== null) { T.gaps.push([gapFrom, t - gapFrom]); gapFrom = null; }
      prevLeft = l;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    const g = window.__game;
    const t = now();
    if (!g?.buildings?.tiles) { T.samples.push({ t, state: g?.getState?.() ?? null }); return; }
    const b = g.buildings;
    if (hookedNear !== b.tiles) {
      hookedNear = b.tiles;
      // The 4th field: 1 when the tile reaches within NEARBY_M of the near load sphere's centre (where
      // the town is loaded around: the car, or a warp's destination before the car lands there).
      b.tiles.addEventListener("load-model", (e) => {
        let isNearby = 0;
        try { isNearby = e.tile.engineData.boundingVolume.distanceToPoint(b.maskRegion.sphere.center) <= ${300} ? 1 : 0; } catch {}
        T.events.push([now(), "nl", codeOf(e.tile), isNearby]);
      });
      b.tiles.addEventListener("dispose-model", () => T.events.push([now(), "nd", ""]));
    }
    if (b.far && hookedFar !== b.far) {
      hookedFar = b.far;
      b.far.addEventListener("load-model", (e) => T.events.push([now(), "fl", codeOf(e.tile)]));
      b.far.addEventListener("dispose-model", () => T.events.push([now(), "fd", ""]));
    }
    const state = g.getState();
    let settled = null;
    try { settled = g.debug.settled().isSettled; } catch {}
    if (state === "ready" && T.readyAt === null) { T.readyAt = t; try { T.near300.ready = window.__tlNear300(); } catch (e) { T.near300.readyError = String(e); } }
    // Where the car and the camera are (local metres): a load that starts late may follow either moving.
    const car = g.vehicle.position();
    const cam = g.camera.position;
    const at = { car: [Math.round(car.x), Math.round(car.z)], cam: [Math.round(cam.x), Math.round(cam.y), Math.round(cam.z)] };
    T.samples.push({ t, state, settled, near: stat(b.tiles), far: stat(b.far), ...at });
  }, 100);
})();`;

type Stat = { remaining: number; downloading: number; failed: number; refused: number; visible: number };
type Sample = {
  t: number;
  state: string | null;
  settled?: boolean | null;
  near?: Stat | null;
  far?: Stat | null;
};
type Timeline = {
  samples: Sample[];
  events: Array<[number, string, string, number?]>;
  gaps: Array<[number, number]>;
  readyAt: number | null;
  warpLandedAt: number | null;
  near300: { ready?: string[]; landed?: string[] | null; end?: string[]; at?: number[] };
  startAt?: number | null;
  warpAt?: number | null;
};

const sampleAt = (tl: Timeline, t: number | null) =>
  t === null ? null : (tl.samples.find((s) => s.t >= t && s.near) ?? null);
const remainingAt = (tl: Timeline, t: number | null) => {
  const s = sampleAt(tl, t);
  return s ? { near: s.near?.remaining ?? null, far: s.far?.remaining ?? null } : null;
};
const share = (part: string[] | null | undefined, whole: string[] | undefined) => {
  const end = new Set(whole ?? []);
  const isEmpty = end.size === 0 || !part;
  if (isEmpty) return { shown: null, of: end.size, share: null };
  const shown = part.filter((k) => end.has(k)).length;
  return { shown, of: end.size, share: Math.round((shown / end.size) * 1000) / 1000 };
};

/** The summary of one run (pure over the page's record). */
export function summarise(tl: Timeline) {
  const isWarp = tl.warpAt !== undefined && tl.warpAt !== null;
  const from = tl.warpAt ?? tl.startAt ?? 0;
  // After a warp, settled counts from the landing: the world was settled before it left.
  const settledFrom = isWarp ? (tl.warpLandedAt ?? from) : from;
  const settledAt = tl.samples.find((s) => s.t >= settledFrom && s.settled)?.t ?? null;
  const last = (kind: string) => tl.events.filter((e) => e[1] === kind && e[0] >= from).at(-1)?.[0] ?? null;
  // When the tiles near the load sphere's centre, and all the near town's tiles, were in (the last
  // load-model of each in the load), as ms from the load's start and as a share of the latter. The
  // start's load is the one the loading screen waits for, up to its close (later loads follow the
  // camera leaving the title); a warp's runs from leaving to settled, as the landing need not wait
  // for all of it.
  const loadFrom = isWarp ? from : 0;
  const loadEnd = isWarp ? settledAt : tl.readyAt;
  const inLoad = tl.events.filter(
    (e) => e[1] === "nl" && e[0] >= loadFrom && (loadEnd === null || e[0] <= loadEnd),
  );
  const allDoneAt = inLoad.at(-1)?.[0] ?? null;
  const nearbyDoneAt = inLoad.filter((e) => e[3] === 1).at(-1)?.[0] ?? null;
  const nearbyShareOfAll =
    allDoneAt === null || nearbyDoneAt === null || allDoneAt === loadFrom
      ? null
      : Math.round(((nearbyDoneAt - loadFrom) / (allDoneAt - loadFrom)) * 1000) / 1000;
  const loadsAfterSettled =
    settledAt === null
      ? null
      : tl.events.filter((e) => e[0] > settledAt && (e[1] === "nl" || e[1] === "fl")).length;
  const closedAt = isWarp ? tl.warpLandedAt : tl.readyAt;
  const isLimit = isWarp
    ? closedAt !== null && closedAt - from >= WARP_LIMIT_MS
    : closedAt !== null && closedAt >= SCREEN_LIMIT_MS;
  const gaps = tl.gaps.filter(
    ([t]) => t >= (isWarp ? from : 0) && (settledAt === null || t < settledAt + 10_000),
  );
  return {
    readyAtMs: tl.readyAt,
    startAtMs: tl.startAt ?? null,
    warpAtMs: tl.warpAt ?? null,
    warpLandedAtMs: tl.warpLandedAt,
    closedAfterMs: closedAt === null ? null : closedAt - (isWarp ? from : 0),
    closedOnLimit: isLimit,
    settledAtMs: settledAt,
    lastNearLoadMs: last("nl"),
    nearbyDoneMs: nearbyDoneAt === null ? null : nearbyDoneAt - loadFrom,
    allDoneMs: allDoneAt === null ? null : allDoneAt - loadFrom,
    nearbyShareOfAll,
    lastFarLoadMs: last("fl"),
    loadsAfterSettled,
    remainingAtClose: remainingAt(tl, closedAt),
    remainingAtSettled: remainingAt(tl, settledAt),
    near300AtClose: share(isWarp ? tl.near300.landed : tl.near300.ready, tl.near300.end),
    // Short gaps (≤ SHORT_GAP_MS) are the ones within a burst (one JSON level done, the next not yet
    // queued); longer ones are between bursts (the title camera turning, the far skyline starting).
    longestShortGapMs: Math.max(0, ...gaps.filter(([, d]) => d <= SHORT_GAP_MS).map(([, d]) => d)),
    shortGaps: gaps.filter(([, d]) => d <= SHORT_GAP_MS).length,
    longGapsMs: gaps.filter(([, d]) => d > SHORT_GAP_MS).map(([, d]) => d),
    failedMax: Math.max(0, ...tl.samples.map((s) => (s.near?.failed ?? 0) + (s.far?.failed ?? 0))),
    refusedMax: Math.max(0, ...tl.samples.map((s) => (s.near?.refused ?? 0) + (s.far?.refused ?? 0))),
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const url = `${base}?start=${start}&time=day&weather=clear&seed=20261116`;
  const port = await freePort();
  const b = await launch("about:blank", { width: 1280, height: 720, port, preload: PRELOAD });
  try {
    if (isMobile) await b.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA });
    await b.send("Page.navigate", { url });
    for (let i = 0; i < 240; i++) {
      await b.sleep(250);
      if ((await b.evaluate("window.__game?.getState()").catch(() => null)) === "ready") break;
    }
    // The 100 ms sampler can miss a "ready" that start() ends at once: then it is taken here.
    await b.evaluate(`(() => {
      const T = window.__tl;
      const t = T.samples.at(-1)?.t ?? null;
      if (T.readyAt === null) { T.readyAt = t; T.near300.ready = window.__tlNear300(); }
      T.startAt = t;
      window.__game.start();
    })()`);
    if (warp) {
      for (let i = 0; i < 180; i++) {
        await b.sleep(1000);
        if (await b.evaluate("__game.debug.settled().isSettled").catch(() => false)) break;
      }
      await waitQuiet(b, 5000, 120_000, true);
      await b.evaluate(
        `window.__tl.warpAt = window.__tl.samples.at(-1)?.t ?? null; __game.debug.roads.warp({ name: "qa", lat: ${warp[0]}, lon: ${warp[1]} })`,
      );
    }
    await b.sleep(seconds * 1000);
    await b.evaluate("window.__tl.near300.end = window.__tlNear300(window.__tl.near300.at)");
    const tl = await b.evaluate<Timeline>("window.__tl");
    const summary = { label, start, warp: warp ?? null, view: view ?? null, isMobile, ...summarise(tl) };
    const dir = join(ROOT, ".qa", "timeline-buildings");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}.json`), `${JSON.stringify({ url, summary, ...tl })}\n`);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await b.close();
  }
}
