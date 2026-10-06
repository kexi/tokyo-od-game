import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-witness");
mkdirSync(out, { recursive: true });
const currentSources = {};
for (const file of [
  "src/main.ts",
  "src/game/witnessShot.ts",
  "src/render/frame.ts",
  "src/render/renderer.ts",
  "src/render/sceneMatrices.ts",
  "src/game/darkroom.ts",
  "src/game/darkroom.worker.ts",
  "src/game/photoDevelop.ts",
  "scripts/qa/perf-witness-photos.mjs",
  "scripts/qa/browser.mjs",
]) {
  const source = readFileSync(file, "utf8");
  currentSources[file] = createHash("sha256").update(source).digest("hex");
  writeFileSync(join(out, file.replaceAll("/", "-") + ".txt"), source);
}
const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
for (const [key, value] of Object.entries({
  seed: "20261006",
  start: "35.681236,139.767125",
  time: "night",
  weather: "rain",
}))
  url.searchParams.set(key, value);
const backend = process.env.QA_BACKEND ?? "auto";
const profiled = Boolean(process.env.QA_PROFILE);
const preload = `
  localStorage.setItem('tod.graphics',JSON.stringify({preset:'ultra',backend:${JSON.stringify(backend)}}));
  window.__qaFreeze=false;
  const nativeRAF=requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>nativeRAF(time=>{
    const frozen=__qaFreeze && callback.name==='tick';
    if(!frozen)callback(time);
  });
`;
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  currentSources,
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  url: url.href,
  profiled,
  samples: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const browser = await launch(url.href, { port: 9372, preload });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await browser.evaluate("window.__game?.getState()==='ready'");
    if (ready) break;
    await browser.sleep(1000);
  }
  if (!ready) throw new Error("game did not become ready");
  report.context = await browser.evaluate(`(async()=>{
    const G=__game;
    const {WitnessShot}=await import(new URL('src/game/witnessShot.ts',location.href).href);
    const {GRAPHICS}=await import(new URL('src/device.ts',location.href).href);
    const rows=[];
    let active=null;
    const wrap=(object,method,phase,detail=()=>({}))=>{
      const original=object[method];
      object[method]=function(...args){
        const context=active,start=performance.now();
        try{return original.apply(this,args);}
        finally{if(context)rows.push({phase,at:start,ms:performance.now()-start,...context,...detail(args)});}
      };
    };
    const draw=WitnessShot.prototype.draw;
    WitnessShot.prototype.draw=function(w,h){
      window.__qaShot=this;
      const previous=active;
      active={w,h,kind:w===64?'probe':'photo'};
      const start=performance.now();
      try{return draw.call(this,w,h);}
      finally{rows.push({phase:'draw',at:start,ms:performance.now()-start,...active});active=previous;}
    };
    wrap(WitnessShot.prototype,'target','target');
    wrap(G.renderer,'render','render');
    wrap(G.composer,'toDisplay','toDisplay');
    wrap(G.renderer,'readRenderTargetPixelsAsync','readSubmit');
    wrap(G.scene,'updateMatrixWorld','matrices');
    wrap(G.renderer.backend,'createRenderPipeline','pipeline',args=>({material:args[0].material.name,async:!!args[1]}));
    wrap(G.renderer.backend,'createTexture','texture',args=>({name:args[0].name}));
    wrap(G.renderer.backend,'beginRender','beginRender');
    wrap(G.renderer.backend,'finishRender','finishRender');
    window.__qaPhotoRows=rows;
    G.start();
    return {render:G.renderInfo,graphics:GRAPHICS.settings,userAgent:navigator.userAgent};
  })()`);
  const wrongBackend = backend === "webgl" && report.context.render.backend !== "webgl2";
  if (wrongBackend) throw new Error("requested WebGL2 backend was not used");
  await browser.sleep(30000);
  report.session = await browser.evaluate("__game.debug.logs.query({event:'session_start'}).at(-1)?.traceId");
  if (profiled) {
    await browser.send("Performance.enable", { timeDomain: "timeTicks" });
    const before = await browser.evaluate("performance.now()");
    const metrics = await browser.send("Performance.getMetrics");
    const after = await browser.evaluate("performance.now()");
    const clock = Object.fromEntries(metrics.result.metrics.map((m) => [m.name, m.value]));
    report.clock = {
      navigationStart: clock.NavigationStart,
      before,
      after,
      mapped: (clock.Timestamp - clock.NavigationStart) * 1000,
    };
    await browser.send("Profiler.enable");
    await browser.send("Profiler.setSamplingInterval", { interval: 1000 });
    await browser.send("Profiler.start");
  }
  for (let i = 0; i < 4; i++) {
    const sample = await browser.evaluate(`(async()=>{
      const at=performance.now();
      const result=await __game.debug.perf.violation('signal',${JSON.stringify(i % 2 ? "video" : "photo")},8);
      const rows=__qaPhotoRows.filter(r=>r.at>=at);
      return {at,result,rows};
    })()`);
    report.samples.push(sample);
    save();
    const completed = sample.result.booked === "signal" && sample.result.post?.hasPhoto;
    if (!completed) throw new Error("photo evidence did not complete");
    process.stdout.write(
      JSON.stringify({
        index: i,
        frames: sample.result.after,
        draws: sample.rows.filter((r) => r.phase === "draw"),
        report: join(out, "report.json"),
      }) + "\n",
    );
  }
  if (profiled) {
    const profile = await browser.send("Profiler.stop");
    writeFileSync(join(out, "photos.cpuprofile"), JSON.stringify(profile.result.profile));
  }
  report.errors = await browser.evaluate(
    "__game.debug.logs.query({event:/uncaught_error|witness_shot_failed|prewarm_failed|road_network_failed|road_worker_failed|terrain_worker_failed|collider_worker_failed|log_schema_invalid/})",
  );
  const sameSession = await browser.evaluate(
    `__game.debug.logs.query({event:'session_start'}).at(-1)?.traceId===${JSON.stringify(report.session)}`,
  );
  const valid = sameSession && report.errors.length === 0;
  if (!valid) throw new Error("session changed or runtime failure");
  await browser.screenshot(join(out, "night-rain.png"));
  report.host.loadAfter = loadavg();
  save();
} catch (error) {
  report.failure = String(error);
  save();
  throw error;
} finally {
  await browser.close();
}
