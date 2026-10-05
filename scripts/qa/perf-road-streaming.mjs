// Measure the complete streamed install, including the frames after new GPU data is published.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(
  import.meta.dirname,
  "../../.qa/perf",
  new Date().toISOString().replace(/[:.]/g, "-") + "-streaming",
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
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
  samples: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9359 });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState() === 'ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  report.demParity = await browser.evaluate(`(async () => {
    const {DemCompute} = await import(new URL('src/world/demCompute.ts',location.href).href);
    const {smoothGround,parseDemText} = await import(new URL('src/world/demData.ts',location.href).href);
    const compute = new DemCompute();
    try {
      const src = Float32Array.from({length:65536}, (_,i) => Math.sin(i*.17)*10 + (i%73===0?12:0));
      const ground = await compute.smooth(src), expected = smoothGround(src);
      const text = '1.5,e,0\\n-3,4';
      const surveyed = await compute.parse(text), reference = parseDemText(text);
      const same = (a,b) => {
        const x=new Uint32Array(a.buffer), y=new Uint32Array(b.buffer);
        return x.every((v,i)=>v===y[i]);
      };
      const matched = same(ground,expected) && same(surveyed,reference);
      if (!matched || !compute.worker) throw new Error('actual DEM worker output differs from inline');
      return {matched,groundValues:ground.length,surveyedValues:surveyed.length,worker:true};
    } finally { compute.worker?.terminate(); }
  })()`);
  await browser.evaluate("__game.start()");
  const started = await browser.evaluate("__game.getState() === 'playing'");
  if (!started) throw new Error("game did not enter playing state");
  await browser.sleep(30000);
  const warmed = await browser.evaluate(`__game.getState() === 'playing' &&
    __game.debug.roads.input().lines.length > 100 &&
    __game.debug.logs.query({event:'road_network_built'}).at(-1)?.segments > 100 &&
    !__game.debug.roads.input().loading`);
  if (!warmed) throw new Error("game or road data not ready after warmup (check for HMR)");
  report.context = await browser.evaluate(`(async () => {
    const { GRAPHICS } = await import(new URL('src/device.ts', location.href).href);
    return { render:__game.renderInfo, graphics:GRAPHICS.settings, userAgent:navigator.userAgent,
      input:__game.debug.roads.input().lines.length, initial:__game.debug.logs.query({event:'road_network_built'}).at(-1),
      session:__game.debug.logs.query({event:'session_start'}).at(-1)?.traceId };
  })()`);
  if (process.env.QA_PROFILE) {
    await browser.send("Performance.enable", { timeDomain: "timeTicks" });
    const before = await browser.evaluate("performance.now()");
    const metrics = await browser.send("Performance.getMetrics");
    const after = await browser.evaluate("performance.now()");
    const clock = Object.fromEntries(metrics.result.metrics.map((m) => [m.name, m.value]));
    const mapped = (clock.Timestamp - clock.NavigationStart) * 1000;
    const isSameClock = mapped >= before - 1 && mapped <= after + 1;
    if (!isSameClock) throw new Error("CDP and page clock mapping differs");
    report.clock = { navigationStart: clock.NavigationStart, before, after, mapped };
  }
  await browser.evaluate(`window.__qaMeshes = () => {
    const G = __game;
    return [...G.debug.roads.surface.meshes.values(), ...G.control.meshes, ...G.control.plates,
      ...G.guideSigns.meshes, G.streetLights.metal, G.streetLights.lens,
      ...G.orbis.meshes, ...G.furniture.group.children].filter(Boolean);
  }`);
  await browser.evaluate(`window.__qaCpu = []; window.__qaWrap = (object, method, phase) => {
    const original = object[method];
    object[method] = function(...args) {
      const start = performance.now();
      try { return original.apply(this,args); }
      finally {
        const ms=performance.now()-start;
        const isRender=phase==='render';
        const view=isRender ? {world:args[0]===__game.scene,far:args[1]?.far,layers:args[1]?.layers?.mask} : undefined;
        __qaCpu.push({phase,at:start,ms,view});
      }
    };
  };
  __qaWrap(__game.world,'step','physics');
  __qaWrap(__game.renderer,'render','render');
  __qaWrap(__game.terrain,'update','terrain');
  __qaWrap(__game.buildings,'update','buildings');
  __qaWrap(__game.streetLights,'update','lights');
  __qaWrap(__game.nav,'update','nav');
  for (const [object,method,phase] of [
    [__game.pedestrians,'update','pedestrians'], [__game.traffic,'update','traffic'],
    [__game.field,'refresh','poiRefresh'], [__game.field,'update','poiDraw'],
    [__game.env,'update','environment'], [__game.water,'renderReflection','reflection'],
    [__game.transit,'update','transit'], [__game.control,'update','control'],
    [__game.guideSigns,'update','guideSigns'], [__game.orbis,'update','orbis'],
  ]) __qaWrap(object,method,phase);`);
  const modes = process.env.QA_MODES?.split(",") ?? [
    "baseline",
    "update",
    "baseline",
    "update",
    "update",
    "recenter",
    "coldWarp",
    "latestWarp",
  ];
  for (const mode of modes) {
    if (process.env.QA_PROFILE) {
      await browser.send("Profiler.enable");
      await browser.send("Profiler.setSamplingInterval", { interval: 1000 });
      await browser.send("Profiler.start");
      await browser.sleep(3000);
    }
    const sample = await browser.evaluate(`(async () => {
      const G = __game;
      const {frameStats, longFramesDuring} = await import(new URL('src/game/perf.ts', location.href).href);
      const stamps = [];
      let finished = false;
      const frames = new Promise(resolve => {
        const loop = t => { stamps.push(t); if(finished) resolve(stamps); else requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      });
      const watchStart = performance.now();
      const beforeWaterCount=G.debug.logs.query({event:'water_masks_prepared'}).length;
      const watch = longFramesDuring(watchStart, frames);
      await new Promise(r => setTimeout(r, 150));
      const beforeMeshes = new Set(__qaMeshes()), beforeParked = new Set(G.traffic.parkedPoses().map(p=>p.key));
      const beforeLines = G.debug.roads.input().lines;
      const beforeFrame = G.getFrame(), beforeGeo = beforeFrame.toGeodetic(G.vehicle.position());
      const start = performance.now();
      __qaCpu = [];
      let heldUntilReady = null, landed = null;
      if (${JSON.stringify(mode)} === 'baseline') await new Promise(r => setTimeout(r, 6000));
      else if (${JSON.stringify(mode)} === 'update') {
        if (!await G.debug.roads.rebuild()) throw new Error('rebuild discarded');
      } else if (${JSON.stringify(mode)} === 'recenter') {
        const pending = G.debug.roads.recenter();
        heldUntilReady = G.getFrame() === beforeFrame;
        await pending;
      } else {
        const cold = ${JSON.stringify(mode)} === 'coldWarp';
        if (!cold) G.debug.roads.warp({name:'QA obsolete', kind:'QA', lat:35.6896, lon:139.6917});
        const goal = cold ? {lat:35.7101,lon:139.8015} : {lat:35.6813,lon:139.7671};
        const label = cold ? 'QA cold Azuma bridge' : 'QA latest';
        G.debug.roads.warp({name:label,kind:'QA',...goal});
        for (let i = 0; i < 360; i++) {
          const input = G.debug.roads.input();
          landed = G.debug.logs.query({event:'warp_landed'}).at(-1);
          const near = Math.abs(input.center.lat-goal.lat)<0.002 && Math.abs(input.center.lon-goal.lon)<0.002;
          const done = landed?.to === label && input.lines !== beforeLines && near && !input.loading;
          if (done) break;
          if (i === 359) throw new Error('warp or new road data did not finish');
          await new Promise(r=>setTimeout(r,250));
        }
        const origin = G.getFrame().origin;
        if(Math.abs(origin.lat-goal.lat)>0.00001 || Math.abs(origin.lon-goal.lon)>0.00001)
          throw new Error('obsolete warp changed the final origin');
        await new Promise(r => setTimeout(r, 10000));
      }
      const elapsed = performance.now() - start;
      await new Promise(r => setTimeout(r,2000));
      finished = true;
      const {result,long} = await watch;
      const afterMeshes = __qaMeshes(), afterParked = G.traffic.parkedPoses();
      const reused = afterMeshes.filter(m=>beforeMeshes.has(m)).length;
      const parkedReused = afterParked.filter(p=>beforeParked.has(p.key)).length;
      const phases = Object.fromEntries([...new Set(__qaCpu.map(r=>r.phase))].map(phase=>{
        const rows = __qaCpu.filter(r=>r.phase===phase).map(r=>r.ms).toSorted((a,b)=>a-b);
        return [phase,{calls:rows.length,mean:rows.reduce((a,b)=>a+b,0)/rows.length,max:rows.at(-1),p95:rows[Math.floor(rows.length*.95)]}];
      }));
      if (${JSON.stringify(mode)} === 'update' && (reused !== afterMeshes.length || parkedReused !== afterParked.length))
        throw new Error('unchanged road data recreated render objects');
      const framePeaks=result.slice(1).map((end,i)=>({start:result[i],end,ms:end-result[i]})).toSorted((a,b)=>b.ms-a.ms).slice(0,12);
      const slow=__qaCpu.filter(r=>r.ms>=20).toSorted((a,b)=>b.ms-a.ms).slice(0,40);
      return {mode:${JSON.stringify(mode)},elapsed,watchStart,framePeaks,slow,frames:frameStats(result),long,phases,reused,meshCount:afterMeshes.length,
        parkedReused,parkedCount:afterParked.length,heldUntilReady,landed,beforeGeo,
        afterGeo:G.getFrame().toGeodetic(G.vehicle.position()),
        recentered:G.debug.logs.query({event:'frame_recentered'}).at(-1),
        installed:G.debug.logs.query({event:'road_network_built'}).at(-1),
        session:G.debug.logs.query({event:'session_start'}).at(-1)?.traceId,
        water:G.debug.logs.query({event:'water_masks_prepared'}).slice(beforeWaterCount),
        errors:G.debug.logs.query({event:/uncaught_error|road_network_failed|road_worker_failed|water_worker_failed|water_tile_failed|log_schema_invalid/})};
    })()`);
    if (process.env.QA_PROFILE) {
      const profile = await browser.send("Profiler.stop");
      writeFileSync(join(out, `${mode}.cpuprofile`), JSON.stringify(profile.result.profile));
    }
    report.samples.push(sample);
    save();
    if (sample.session !== report.context.session) throw new Error("HMR changed the measured session");
    if (sample.errors.length) throw new Error(`${mode} logged a runtime failure; see ${out}/report.json`);
    process.stdout.write(
      JSON.stringify({
        mode,
        frames: sample.frames,
        elapsed: sample.elapsed,
        installed: sample.installed,
        errors: sample.errors,
      }) + "\n",
    );
    await browser.sleep(1000);
  }
  await browser.screenshot(join(out, "night-rain.png"));
  report.host.loadAfter = loadavg();
  save();
  process.stdout.write(JSON.stringify({ report: join(out, "report.json") }) + "\n");
} finally {
  await browser.close();
}
