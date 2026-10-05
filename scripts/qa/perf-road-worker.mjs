// Real gameplay, original loaded road lines, alternating inline fallback and the shipped Worker.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + "-roads",
);
mkdirSync(out, { recursive: true });
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  url: url.href,
  samples: [],
};
const browser = await launch(url.href, {
  port: 9356,
  preload: "performance.setResourceTimingBufferSize(10000)",
});
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  await browser.evaluate("__game.start()");
  await browser.sleep(30000);
  report.context = await browser.evaluate(`(async () => {
    const G = __game, input = G.debug.roads.input();
    const { GRAPHICS } = await import(new URL('src/device.ts', location.href).href);
    if (!input.lines.length || !input.regs) throw new Error('road data missing');
    window.__qaRoadInput = input;
    window.__qaRoadExpected = null;
    return { backend: G.renderInfo, graphics: GRAPHICS.settings, userAgent: navigator.userAgent,
      lines: input.lines.length, segments: G.getRoadGraph().segments.length,
      inputBytes: new Blob([JSON.stringify(input)]).size, origin: input.origin };
  })()`);
  report.initialInstalled = await browser.evaluate(
    "__game.debug.logs.query({event:'road_network_built'}).at(-1)",
  );
  for (const phase of process.env.QA_VALIDATE_ONLY ? [] : ["prepare", "install"]) {
    for (const inline of [true, false, false, true, false, true]) {
      const work =
        phase === "prepare"
          ? "roads.builder.build(__qaRoadInput.lines, __qaRoadInput.regs, G.getFrame())"
          : "roads.rebuild()";
      const sample = await browser.evaluate(`(async () => {
        const G = __game, roads = G.debug.roads;
        const { frameStats, longFramesDuring } = await import(new URL('src/game/perf.ts', location.href).href);
        roads.builder.inline = ${inline};
        const stamps = [];
        let finished = false;
        const frames = new Promise(resolve => {
          const loop = t => {
            stamps.push(t);
            if (finished) resolve(stamps);
            else requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        const since = performance.now(), watch = longFramesDuring(since, frames);
        await new Promise(r => setTimeout(r, 150));
        const beforeGraph = G.getRoadGraph();
        const beforeMeshes = new Set([...roads.surface.meshes.values(), ...G.control.meshes, ...G.orbis.meshes]);
        const start = performance.now();
        const result = await ${work};
        const elapsed = performance.now() - start;
        if (!result) throw new Error('road request was discarded');
        await new Promise(r => setTimeout(r, 2000));
        finished = true;
        const {result: measured, long} = await watch;
        let equal = null;
        if (${phase === "prepare"}) {
          const snapshot = JSON.stringify({segments: result.graph.segments, nodes:[...result.graph.nodes], applied:result.applied});
          if (__qaRoadExpected === null) __qaRoadExpected = snapshot;
          equal = snapshot === __qaRoadExpected;
          if (!equal) throw new Error('inline and worker output differ');
          if (G.getRoadGraph() !== beforeGraph) throw new Error('prepare unexpectedly replaced the live graph');
        } else if (G.getRoadGraph() === beforeGraph) throw new Error('install did not replace the graph');
        const afterMeshes = [...roads.surface.meshes.values(), ...G.control.meshes, ...G.orbis.meshes];
        const reused = afterMeshes.filter(m => beforeMeshes.has(m)).length;
        if (${phase === "install"} && reused !== afterMeshes.length)
          throw new Error('unchanged road data recreated render meshes');
        return { reused, meshCount:afterMeshes.length, phase: ${JSON.stringify(phase)}, inline: ${inline}, elapsed, equal, frames:frameStats(measured), long,
          prepared:G.debug.logs.query({event:'road_network_prepared'}).at(-1),
          installed:${phase === "install"} ? G.debug.logs.query({event:'road_network_built'}).at(-1) : null };
      })()`);
      report.samples.push(sample);
      writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
      process.stdout.write(
        JSON.stringify({
          phase,
          inline,
          elapsed: sample.elapsed,
          frames: sample.frames,
          prepared: sample.prepared,
          installed: sample.installed,
        }) + "\n",
      );
      await browser.sleep(1000);
    }
  }
  await browser.evaluate(`window.__qaCheckSurface = () => {
    const G = __game, surface = G.debug.roads.surface;
    const colliders = [...G.terrain.chunks.values()].flatMap(c => c.collider ? [c.collider] : []);
    let checked = 0, maxTerrainError = 0, decks = 0, maxDeckError = 0;
    for (const seg of G.getRoadGraph().segments) {
      const p = G.getRoadGraph().sample(seg, seg.length / 2).pos;
      const terrain = G.terrain.surfaceAt(p.x, p.z);
      const deck = G.water.deckAt(p.x, p.z);
      if (deck !== null) {
        decks++;
        maxDeckError = Math.max(maxDeckError, Math.abs(surface.surfaceAt(p.x, p.z) - deck));
      }
      if (terrain === null) continue;
      const ray = {origin: {x:p.x, y:terrain + 100, z:p.z}, dir:{x:0, y:-1, z:0}};
      const hits = colliders.map(c => c.castRay(ray, 200, true)).filter(t => t >= 0);
      if (!hits.length) continue;
      const hit = terrain + 100 - Math.min(...hits);
      maxTerrainError = Math.max(maxTerrainError, Math.abs(terrain - hit));
      checked++;
    }
    if (checked < 100 || maxTerrainError > 0.001 || maxDeckError !== 0)
      throw new Error('road height disagrees with terrain collider or bridge deck: ' + JSON.stringify({checked,maxTerrainError,maxDeckError}));
    const meshes = [...surface.meshes.values()];
    return {checked,maxTerrainError,decks,maxDeckError,roadMeshes:meshes.length,
      vertices:meshes.reduce((n,m)=>n+m.geometry.getAttribute('position').count,0),
      triangles:meshes.reduce((n,m)=>n+m.geometry.drawRange.count/3,0)};
  }`);
  report.surface = await browser.evaluate("__qaCheckSurface()");
  report.recenter = await browser.evaluate(`(async () => {
    const G = __game;
    G.debug.roads.builder.inline = false;
    const before = G.getFrame(), origin = before.toGeodetic(G.vehicle.position());
    const pending = G.debug.roads.recenter();
    const heldUntilReady = G.getFrame() === before;
    await pending;
    const after = G.getFrame().toGeodetic(G.vehicle.position());
    return { heldUntilReady, frameChanged:G.getFrame() !== before, before:origin, after,
      hasGraphMethods:typeof G.getRoadGraph().nearest === 'function' };
  })()`);
  const isRecentered =
    report.recenter.heldUntilReady && report.recenter.frameChanged && report.recenter.hasGraphMethods;
  if (!isRecentered)
    throw new Error("recenter did not preserve the old frame until the replacement was ready");
  report.surfaceAfterRecenter = await browser.evaluate("__qaCheckSurface()");
  report.warp = await browser.evaluate(`(async () => {
    const G = __game;
    G.debug.roads.warp({name:'QA obsolete', kind:'QA', lat:35.6896, lon:139.6917});
    G.debug.roads.warp({name:'QA latest', kind:'QA', lat:35.6813, lon:139.7671});
    for (let i = 0; i < 120; i++) {
      const landed = G.debug.logs.query({event:'warp_landed'}).at(-1);
      if (landed?.to === 'QA latest') return { landed, origin:G.getFrame().origin };
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('latest warp did not land');
  })()`);
  const isLatestOrigin =
    Math.abs(report.warp.origin.lat - 35.6813) < 0.00001 &&
    Math.abs(report.warp.origin.lon - 139.7671) < 0.00001;
  if (!isLatestOrigin) throw new Error("obsolete warp changed the final origin");
  report.errors = await browser.evaluate(
    "__game.debug.logs.query({event:/uncaught_error|road_worker_failed|road_network_failed|log_schema_invalid/})",
  );
  await browser.screenshot(join(out, "night-rain.png"));
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(
    JSON.stringify({ report: join(out, "report.json"), recenter: report.recenter, errors: report.errors }) +
      "\n",
  );
} finally {
  await browser.close();
}
