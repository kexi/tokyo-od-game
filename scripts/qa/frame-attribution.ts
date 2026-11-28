// Which code fills the frames over 50 ms while the town streams in: a sampled CPU profile of the
// page, cut at the page's own rAF gaps, and the time inside each long gap added up by function, by
// the game's source file and by the candidates of the October perf stack (#5–#33, the plan's
// "measure-first" gates: a candidate is built only if it takes 8 ms or more of a long frame and is in
// the top five). Two scenes by default, the ones perf-road-streaming.mjs ends with: a warp to a
// region not loaded yet (吾妻橋, coldWarp) and a warp that replaces one still on the way (新宿 then 東京駅,
// latestWarp), at night in the rain from 東京駅 (seed 20261006), 30 s after start as there.
//
// How the two clocks meet: the profile's sample times are the browser's monotonic clock (µs), the
// rAF stamps the page's performance.now() (ms from navigation). Performance.getMetrics (timeTicks)
// gives navigation's start on the monotonic clock, checked against two performance.now() reads
// around it; and at the end of each scene the page spins a named function (__qaMarker) for
// MARKER_MS, which the analysis finds in the profile and compares with where the mapping puts it
// (clockCheck). A long frame is the gap between two rAF stamps (perf.ts's frame gaps); a sample is
// counted in the gap that holds the interval since the sample before it.
//
// Named wrappers make code the profile cannot name show up by name: the near and far tiles'
// load-model dispatch (the game's listeners are arrow functions) runs inside __qaLoadModel, and the
// synchronous prefix of a tile's parse (the b3dm's header, its feature and batch tables' JSON, the
// glTF's JSON chunk) inside __qaParseTile. Why not match the library's files or classes by name: the
// dev server serves 3d-tiles-renderer pre-bundled and minified (node_modules/.vite/deps/renderer-*.js,
// FeatureTable is `Q$1` there), so a match on FeatureTable.js never hit (Phase 0, review of #134), and
// a match on the minified name would stop hitting without a word when the library is updated.
//
// Matches are what the candidates can be told by; three of them count more than their PR changes:
// matrixWorld is every updateMatrixWorld of the scene (#7 changes the cockpit's only: an upper
// bound), colliderBuild every Rapier createCollider (#21 moves the terrain's and the buildings'
// only; the pavements', shores', lamps' and signals' are in it too), and roadReply the road
// worker's reply listener (an arrow function in roadNetworkBuilder.ts: any anonymous frame of that
// file, so the request side's closures too: about 3 ms of the chained warp's 32.6 in Phase 0) with
// restoreRoadNetwork: the listener's own time is reading `event.data`, which is where the
// structured clone is restored (expected, not separated from what the engine inlined into it).
//
// Why not perf-road-streaming.mjs with QA_PROFILE: that script is the baseline every later PR is
// compared with and stays as it is (the October stack's conflicts were mostly in it); it also keeps
// no rAF stamps to cut the profile at. Why not DevTools' trace (Tracing.start): one scene's trace is
// hundreds of MB, and the profile names the same JS functions.
//
//   just measure-frame-attribution label base [args]
//   pnpm exec tsx scripts/qa/frame-attribution.ts --label L [--base URL] [--modes coldWarp,latestWarp]
//     [--interval 1000] [--over 50]
//
// Output: .qa/frame-attribution/<label>/report.json (per scene: the long gaps, each with its top
// functions and candidates, and the scene's totals) and <mode>.cpuprofile, the summary as one JSON
// line a scene on stdout.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";

export type CallFrame = { functionName: string; url: string; lineNumber: number };
export type ProfileNode = { id: number; callFrame: CallFrame; children?: number[] };
export type CpuProfile = {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
};
/** A frame gap on the page's clock (ms). */
export type Gap = { start: number; end: number; ms: number };
export type Candidate = { id: string; prs: string; match: (frame: CallFrame) => boolean };

const fn = (name: RegExp, url?: RegExp) => (f: CallFrame) =>
  name.test(f.functionName) && (url === undefined || url.test(f.url));

/**
 * The October stack's candidates, by the functions they change on main (2026-11-23). Inclusive: a
 * sample counts for a candidate when any frame of its stack matches, so candidates can overlap (a
 * ground query inside a road build counts for both).
 */
export const CANDIDATES: Candidate[] = [
  { id: "materialCacheKey", prs: "#5", match: fn(/^getMaterialCacheKey$/) },
  { id: "shadowRender", prs: "#5 #9", match: fn(/^(renderShadow|updateShadow)$/) },
  {
    id: "nodeBuild",
    prs: "#9 #11 #19 #20 #24",
    match: fn(/^(build|buildCode|buildFlow|setup|generate|generateNodeType)$/, /three/),
  },
  { id: "pipelineCreate", prs: "#19 #24", match: fn(/^createRenderPipeline$/) },
  { id: "matrixWorld", prs: "#7", match: fn(/^updateMatrixWorld$/) },
  { id: "roadNearest", prs: "#6 #12b", match: fn(/^(nearestWhere|nearestOnSurface|locate)$/, /roads\.ts/) },
  { id: "waterMasks", prs: "#8", match: fn(/^(rasterize|coverage|dilate)$/, /waterGeometry\.ts/) },
  { id: "tileParseSync", prs: "#10", match: fn(/^__qaParseTile$/) },
  {
    id: "routePlan",
    prs: "#12 #14",
    match: fn(/^(plan|bestStart|routeFrom)$/, /autoDriver\.ts|navigation\.ts/),
  },
  { id: "signalMatch", prs: "#13", match: fn(/^buildSignals$/, /trafficControl\.ts/) },
  { id: "buildingLoadModel", prs: "#16", match: fn(/^__qaLoadModel$/) },
  { id: "terrainChunk", prs: "#17", match: fn(/^buildChunk$/, /terrain\.ts/) },
  {
    id: "roadReply",
    prs: "#18",
    match: (f) => fn(/^restoreRoadNetwork$/)(f) || fn(/^$/, /roadNetworkBuilder\.ts/)(f),
  },
  { id: "colliderBuild", prs: "#21", match: fn(/^(createCollider|trimesh)$/) },
  {
    id: "groundQuery",
    prs: "#25",
    match: (f) =>
      fn(/^(sampleGlobal|surveyedAt)$/, /dem\.ts/)(f) ||
      fn(/^toGeodetic$/, /frame\.ts/)(f) ||
      fn(/^groundY$/, /main\.ts/)(f),
  },
  { id: "landmarkCut", prs: "#27", match: fn(/^cutFootprints$/, /buildings\.ts/) },
  { id: "shoreLookup", prs: "#28", match: fn(/^(isWater|surveyedAt)$/, /water\.ts|dem\.ts/) },
  {
    id: "vectorTiles",
    prs: "#31",
    match: (f) => /vector-tile|\/pbf[/.]/.test(f.url) || fn(/^roadLinesOfTile$/)(f),
  },
  { id: "humans", prs: "#33", match: fn(/^(createHuman|animateHuman)$/, /human\.ts/) },
  { id: "gc", prs: "—", match: fn(/^\(garbage collector\)$/) },
];

/** Frame gaps over `overMs` (ms) from rAF stamps. */
export function longGaps(stamps: readonly number[], overMs: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < stamps.length; i++) {
    const ms = stamps[i] - stamps[i - 1];
    const isLong = ms > overMs;
    if (isLong) gaps.push({ start: stamps[i - 1], end: stamps[i], ms });
  }
  return gaps;
}

/** The game's source file a frame belongs to ("world/roads.ts"), or null for library and native code. */
function sourceFile(url: string): string | null {
  const at = url.indexOf("/src/");
  const isGame = at >= 0 && !url.includes("/node_modules/");
  if (!isGame) return null;
  return url.slice(at + 5).split("?")[0];
}

const round = (ms: number) => Math.round(ms * 10) / 10;

/** Each sample as [from, to] on the profile's clock (µs) with its stack (leaf first). */
function sampled(profile: CpuProfile): Array<{ from: number; to: number; stack: CallFrame[] }> {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const stacks = new Map<number, CallFrame[]>();
  const stackOf = (id: number): CallFrame[] => {
    const known = stacks.get(id);
    const isKnown = known !== undefined;
    if (isKnown) return known;
    const stack: CallFrame[] = [];
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const node = byId.get(at);
      const isNode = node !== undefined;
      if (isNode) stack.push(node.callFrame);
    }
    stacks.set(id, stack);
    return stack;
  };
  const out: Array<{ from: number; to: number; stack: CallFrame[] }> = [];
  let cursor = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const next = cursor + profile.timeDeltas[i];
    out.push({ from: cursor, to: next, stack: stackOf(profile.samples[i]) });
    cursor = next;
  }
  return out;
}

/** Overlap (ms) of the sample interval [from, to] (µs) with [start, end] (µs). */
const overlapMs = (from: number, to: number, start: number, end: number) =>
  Math.max(0, Math.min(end, to) - Math.max(start, from)) / 1000;

type Totals = { ms: number; maxInFrame: number; framesOver8: number };

/**
 * Attribute the profile to the long gaps. `navigationStartUs` puts the page's ms on the profile's
 * clock. Per gap: the observed ms, the top self functions, the game's files (the nearest game frame
 * to the leaf) and the candidates; over all gaps: each candidate's sum, its largest share of one gap,
 * and in how many gaps it took 8 ms or more.
 */
export function attribute(
  profile: CpuProfile,
  gaps: readonly Gap[],
  navigationStartUs: number,
  candidates: readonly Candidate[] = CANDIDATES,
) {
  const samples = sampled(profile);
  const totals = new Map<string, Totals>(
    candidates.map((c) => [c.id, { ms: 0, maxInFrame: 0, framesOver8: 0 }]),
  );
  const files = new Map<string, number>();
  const selfAll = new Map<string, number>();
  const perGap = gaps.map((gap) => {
    const start = navigationStartUs + gap.start * 1000;
    const end = navigationStartUs + gap.end * 1000;
    const self = new Map<string, number>();
    const own = new Map<string, number>();
    const inGap = new Map<string, number>(candidates.map((c) => [c.id, 0]));
    let observed = 0;
    for (const s of samples) {
      const ms = overlapMs(s.from, s.to, start, end);
      const isOutside = ms === 0;
      if (isOutside) continue;
      observed += ms;
      const leaf = s.stack[0];
      const key = `${leaf.functionName || "(anonymous)"} ${leaf.url.split("/").at(-1)?.split("?")[0] ?? ""}:${leaf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + ms);
      const file = s.stack.map((f) => sourceFile(f.url)).find((f) => f !== null) ?? "(library or native)";
      own.set(file, (own.get(file) ?? 0) + ms);
      for (const c of candidates) {
        const isInside = s.stack.some(c.match);
        if (isInside) inGap.set(c.id, (inGap.get(c.id) ?? 0) + ms);
      }
    }
    for (const [id, ms] of inGap) {
      const t = totals.get(id) as Totals;
      t.ms += ms;
      t.maxInFrame = Math.max(t.maxInFrame, ms);
      const isLarge = ms >= 8;
      if (isLarge) t.framesOver8++;
    }
    for (const [k, ms] of own) files.set(k, (files.get(k) ?? 0) + ms);
    for (const [k, ms] of self) selfAll.set(k, (selfAll.get(k) ?? 0) + ms);
    const top = (m: Map<string, number>, n: number) =>
      [...m]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, ms]) => ({ name, ms: round(ms) }));
    return {
      gap: { start: round(gap.start), ms: round(gap.ms) },
      observedMs: round(observed),
      self: top(self, 12),
      files: top(own, 8),
      candidates: top(inGap, candidates.length).filter((c) => c.ms > 0),
    };
  });
  const ranked = candidates
    .map((c) => {
      const t = totals.get(c.id) as Totals;
      return {
        id: c.id,
        prs: c.prs,
        ms: round(t.ms),
        maxInFrameMs: round(t.maxInFrame),
        framesOver8: t.framesOver8,
      };
    })
    .toSorted((a, b) => b.ms - a.ms);
  const sortTop = (m: Map<string, number>, n: number) =>
    [...m]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, ms]) => ({ name, ms: round(ms) }));
  return {
    gaps: gaps.length,
    gapMs: round(gaps.reduce((a, g) => a + g.ms, 0)),
    candidates: ranked,
    files: sortTop(files, 15),
    self: sortTop(selfAll, 25),
    perGap,
  };
}

/** A candidate's self time over the whole profile and its share of the sampled time (the #33 gate is 1 %). */
export function selfShare(profile: CpuProfile, match: (f: CallFrame) => boolean) {
  const samples = sampled(profile);
  let ms = 0;
  let all = 0;
  for (const s of samples) {
    const d = (s.to - s.from) / 1000;
    all += d;
    const isMatch = match(s.stack[0]);
    if (isMatch) ms += d;
  }
  return {
    ms: round(ms),
    sampledMs: round(all),
    share: all > 0 ? Math.round((ms / all) * 10000) / 10000 : 0,
  };
}

/**
 * Where the samples of `__qaMarker` fall (µs), next to where the mapping puts the marker: the clock
 * mapping holds when most of the marker's samples are inside its mapped window.
 */
export function markerCheck(profile: CpuProfile, startUs: number, ms: number) {
  const end = startUs + ms * 1000;
  let inside = 0;
  let outside = 0;
  for (const s of sampled(profile)) {
    const isMarker = s.stack.some((f) => f.functionName === "__qaMarker");
    if (!isMarker) continue;
    const d = (s.to - s.from) / 1000;
    const isInside = s.to > startUs && s.from < end;
    if (isInside) inside += d;
    else outside += d;
  }
  const isMapped = inside >= ms * 0.8 && outside <= ms * 0.2;
  return { insideMs: round(inside), outsideMs: round(outside), isMapped };
}

/**
 * Page-side JS: the named wrappers the candidates match by (the header) and the clock's marker.
 * Exported so a test ties every page-made name a candidate matches to this source: renamed here
 * alone, a candidate would count 0 without a word (the review of #134, R3).
 */
export const NAMED_WRAPPERS = `(() => {
      const wrap = (tiles) => {
        const isNamed = !tiles || tiles.__qaNamed;
        if (isNamed) return;
        const dispatch = tiles.dispatchEvent.bind(tiles);
        const __qaLoadModel = (e) => dispatch(e);
        tiles.dispatchEvent = (e) => e?.type === "load-model" ? __qaLoadModel(e) : dispatch(e);
        tiles.__qaNamed = true;
      };
      window.__qaNameTiles = () => { wrap(__game.buildings.tiles); wrap(__game.buildings.far); };
      const proto = Object.getPrototypeOf(__game.buildings.tiles);
      const isParseNamed = proto.__qaParseNamed === true;
      if (!isParseNamed) {
        const parse = proto.parseTile;
        // Only the synchronous prefix runs inside the wrapper: what resumes after the parse's awaits
        // (the glTF after Draco) is not under it.
        const __qaParseTile = (self, args) => parse.apply(self, args);
        proto.parseTile = function (...args) { return __qaParseTile(this, args); };
        proto.__qaParseNamed = true;
      }
      window.__qaNameTiles();
      setInterval(window.__qaNameTiles, 500);
      window.__qaMarker = function __qaMarker(ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) {} return t0; };
    })()`;

const MARKER_MS = 30;

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const ROOT = join(import.meta.dirname, "..", "..");
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const label = flag("label") ?? "run";
  const base = flag("base") ?? "http://localhost:5173/tokyo-od-game/";
  const modes = (flag("modes") ?? "coldWarp,latestWarp").split(",");
  const unknown = modes.filter((m) => m !== "coldWarp" && m !== "latestWarp");
  const hasUnknown = unknown.length > 0;
  if (hasUnknown) throw new Error(`unknown --modes ${unknown.join(",")} (coldWarp, latestWarp)`);
  const intervalUs = Number(flag("interval") ?? 1000);
  const overMs = Number(flag("over") ?? 50);
  const out = join(ROOT, ".qa", "frame-attribution", label);
  mkdirSync(out, { recursive: true });
  const url = new URL(base);
  for (const [key, value] of Object.entries({
    seed: "20261006",
    start: "35.681236,139.767125",
    time: "night",
    weather: "rain",
  }))
    url.searchParams.set(key, value);
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", cwd: ROOT }).trim();
  const report: Record<string, unknown> & { scenes: unknown[] } = {
    label,
    commit: git("rev-parse", "HEAD"),
    status: git("status", "--short"),
    url: url.href,
    intervalUs,
    overMs,
    scenes: [],
  };
  const save = () => writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const b = await launch(url.href, { port: await freePort() });
  try {
    let isReady = false;
    for (let i = 0; i < 120 && !isReady; i++) {
      isReady = await b.evaluate<boolean>("window.__game?.getState() === 'ready'").catch(() => false);
      if (!isReady) await b.sleep(1000);
    }
    if (!isReady) throw new Error("game did not become ready");
    await b.evaluate("__game.start()");
    await b.sleep(30000);
    // Then up to WARM_MAX_S more for the roads, so the scenes start from settled roads. (The run of
    // 2026-11-28 that stopped here at 30 s had measured another worktree's dev server: not a sign
    // that main's roads take longer. The wait stays: it costs nothing when the roads are ready.)
    const WARM = `__game.getState() === 'playing' &&
      __game.debug.roads.input().lines.length > 100 && !__game.debug.roads.input().loading`;
    const WARM_MAX_S = 90;
    let isWarm = await b.evaluate<boolean>(WARM);
    for (let i = 0; i < WARM_MAX_S && !isWarm; i++) {
      await b.sleep(1000);
      isWarm = await b.evaluate<boolean>(WARM);
    }
    if (!isWarm) throw new Error("game or road data not ready after warmup");
    // Named wrappers (see the header) and the marker.
    await b.evaluate(NAMED_WRAPPERS);
    // The two clocks (see the header).
    await b.send("Performance.enable", { timeDomain: "timeTicks" });
    const before = await b.evaluate<number>("performance.now()");
    const metrics = await b.send("Performance.getMetrics");
    const after = await b.evaluate<number>("performance.now()");
    const m = Object.fromEntries(
      (metrics.result.metrics as Array<{ name: string; value: number }>).map((x) => [x.name, x.value]),
    );
    const mapped = (m.Timestamp - m.NavigationStart) * 1000;
    const isSameClock = mapped >= before - 1 && mapped <= after + 1;
    if (!isSameClock) throw new Error(`page and CDP clocks differ (${mapped} not in ${before}..${after})`);
    const navigationStartUs = m.NavigationStart * 1e6;
    report.clock = { navigationStartUs, before, after, mapped };
    report.context = await b.evaluate(`({ render: __game.renderInfo, userAgent: navigator.userAgent,
      session: __game.debug.logs.query({ event: 'session_start' }).at(-1)?.traceId })`);
    for (const mode of modes) {
      await b.send("Profiler.enable");
      await b.send("Profiler.setSamplingInterval", { interval: intervalUs });
      await b.send("Profiler.start");
      // The scene: the same warps and waits as perf-road-streaming.mjs's coldWarp / latestWarp.
      const scene = await b.evaluate<
        Record<string, unknown> & { stamps: number[]; markerAt: number }
      >(`(async () => {
        const G = __game;
        const mode = ${JSON.stringify(mode)};
        const stamps = [];
        let finished = false;
        const frames = new Promise((resolve) => {
          const loop = (t) => { stamps.push(t); if (finished) resolve(); else requestAnimationFrame(loop); };
          requestAnimationFrame(loop);
        });
        await new Promise((r) => setTimeout(r, 150));
        const beforeLines = G.debug.roads.input().lines;
        const start = performance.now();
        const isCold = mode === 'coldWarp';
        if (!isCold) G.debug.roads.warp({ name: 'QA obsolete', kind: 'QA', lat: 35.6896, lon: 139.6917 });
        const goal = isCold ? { lat: 35.7101, lon: 139.8015 } : { lat: 35.6813, lon: 139.7671 };
        const name = isCold ? 'QA cold Azuma bridge' : 'QA latest';
        G.debug.roads.warp({ name, kind: 'QA', ...goal });
        let landedAt = null;
        for (let i = 0; i < 360; i++) {
          const input = G.debug.roads.input();
          const landed = G.debug.logs.query({ event: 'warp_landed' }).at(-1);
          const isNear = Math.abs(input.center.lat - goal.lat) < 0.002 && Math.abs(input.center.lon - goal.lon) < 0.002;
          const isDone = landed?.to === name && input.lines !== beforeLines && isNear && !input.loading;
          if (isDone) { landedAt = performance.now() - start; break; }
          const isLast = i === 359;
          if (isLast) throw new Error('warp or new road data did not finish');
          await new Promise((r) => setTimeout(r, 250));
        }
        await new Promise((r) => setTimeout(r, 10000));
        const elapsed = performance.now() - start;
        await new Promise((r) => setTimeout(r, 2000));
        finished = true;
        await frames;
        const markerAt = window.__qaMarker(${MARKER_MS});
        return { mode, start, elapsed, landedAt, stamps, markerAt,
          session: G.debug.logs.query({ event: 'session_start' }).at(-1)?.traceId,
          errors: G.debug.logs.query({ event: /uncaught_error|road_network_failed|road_worker_failed|log_schema_invalid/ }) };
      })()`);
      const stopped = await b.send("Profiler.stop");
      const profile = stopped.result.profile as CpuProfile;
      writeFileSync(join(out, `${mode}.cpuprofile`), JSON.stringify(profile));
      const gaps = longGaps(scene.stamps, overMs);
      const clockCheck = markerCheck(profile, navigationStartUs + scene.markerAt * 1000, MARKER_MS);
      const result = attribute(profile, gaps, navigationStartUs);
      const humans = selfShare(profile, fn(/^(createHuman|animateHuman)$/, /human\.ts/));
      const gapsMs = scene.stamps.slice(1).map((t, i) => t - scene.stamps[i]);
      const summary = {
        mode,
        elapsedMs: Math.round(Number(scene.elapsed)),
        landedAtMs: scene.landedAt === null ? null : Math.round(Number(scene.landedAt)),
        frames: gapsMs.length,
        longestMs: round(Math.max(...gapsMs)),
        clockCheck,
        humansSelf: humans,
        ...result,
      };
      // The rAF stamps too, so the frames can be cut again (another threshold) from the profile.
      report.scenes.push({ ...summary, errors: scene.errors, session: scene.session, stamps: scene.stamps });
      save();
      const hasErrors = Array.isArray(scene.errors) && scene.errors.length > 0;
      if (hasErrors) throw new Error(`${mode} logged a runtime failure; see ${out}/report.json`);
      process.stdout.write(
        `${JSON.stringify({ mode, longestMs: summary.longestMs, gaps: summary.gaps, clockCheck, top: summary.candidates.slice(0, 6), humans })}\n`,
      );
      await b.sleep(1000);
    }
    save();
    process.stdout.write(`${JSON.stringify({ report: join(out, "report.json") })}\n`);
  } finally {
    await b.close();
  }
}
