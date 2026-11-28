import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const seconds = Number(process.env.QA_SECONDS ?? 8);
const isValid = Number.isFinite(seconds) && seconds > 0;
if (!isValid) throw new Error("QA_SECONDS must be positive");
const out = join(".qa/perf", new Date().toISOString().replace(/[:.]/g, "-") + "-matrices");
mkdirSync(out, { recursive: true });
const backend = process.env.QA_BACKEND ?? "auto";
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  host: { cpu: cpus()[0]?.model, load: loadavg() },
  seconds,
  scenarios: [],
};
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
const preload = `
  localStorage.setItem('tod.graphics', JSON.stringify({preset:'ultra',backend:${JSON.stringify(backend)}}));
  window.__qaFreeze = false; window.__qaCapture = false; window.__qaCpu = [];
  const nativeRAF = requestAnimationFrame.bind(window), mainCallbacks = new WeakMap();
  window.requestAnimationFrame = callback => nativeRAF(time => {
    const frozenGameFrame=__qaFreeze && callback.name === 'tick';
    if (frozenGameFrame) return;
    const isKnownCallback=mainCallbacks.has(callback);
    if (!isKnownCallback) mainCallbacks.set(callback, callback.name === 'tick' && callback.toString().includes('step('));
    const capture = __qaCapture && mainCallbacks.get(callback), start = performance.now();
    try { callback(time); }
    finally { if (capture) __qaCpu.push(performance.now()-start); }
  });
`;
for (const time of process.env.QA_TIMES?.split(",") ?? ["night", "day"]) {
  const url = new URL(process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/");
  for (const [key, value] of Object.entries({
    seed: "20261006",
    start: "35.681236,139.767125",
    time,
    weather: time === "night" ? "rain" : "clear",
  }))
    url.searchParams.set(key, value);
  const browser = await launch(url.href, { port: 9371, preload });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      ready = await browser.evaluate("window.__game?.getState() === 'ready'");
      if (ready) break;
      await browser.sleep(1000);
    }
    if (!ready) throw new Error("game did not become ready");
    const context = await browser.evaluate(`(async () => {
      const G = __game;
      const path = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname.endsWith('/src/game/cockpit.ts'))?.name;
      if (!path) throw new Error('cockpit module missing');
      const {Cockpit,INTERIOR_LAYER,OUTSIDE_LAYER} = await import(path);
      const {GRAPHICS} = await import(new URL('src/device.ts',location.href).href);
      const {watchFrames,frameStats} = await import(new URL('src/game/perf.ts',location.href).href);
      const {readPixels} = await import(new URL('src/render/renderer.ts',location.href).href);
      const actual = Cockpit.prototype.render;
      // Frozen render from 11462bd: the renderer updates the scene for each view.
      function legacyDraw(composer,renderer,scene,camera,updateMirrors=true) {
        if (!this.active || !this.root) { composer.begin(); composer.drawWorld(scene,camera); composer.street(); return; }
        this.lightInterior(scene);
        const near = this.nearCamera;
        near.position.copy(camera.position); near.quaternion.copy(camera.quaternion);
        near.fov=camera.fov; near.aspect=camera.aspect; near.coordinateSystem=camera.coordinateSystem;
        near.updateProjectionMatrix(); near.updateMatrixWorld();
        if (updateMirrors) this.updateMirror(renderer,scene,near);
        const wet=GRAPHICS.settings.rainGlass!=='off' && this.rain.isWet();
        if(wet) this.rain.drawDrops(renderer);
        composer.begin(); composer.drawWorld(scene,camera); composer.street();
        near.layers.set(OUTSIDE_LAYER); composer.drawOver(scene,near);
        near.layers.set(INTERIOR_LAYER);
        const glass=wet?composer.copyForGlass():null;
        composer.drawOver(scene,near);
        if(glass) this.rain.drawPanes(composer,glass,camera,this.root,near);
      }
      let legacy=false, matrixCalls=0, matrixMs=0;
      const matrixUpdate=G.scene.updateMatrixWorld;
      G.scene.updateMatrixWorld=function(...args) {
        const start=performance.now(); matrixCalls++;
        try{return matrixUpdate.apply(this,args);}
        finally{matrixMs+=performance.now()-start;}
      };
      const drawRows=[];
      Cockpit.prototype.render=function(...args) {
        window.__qaCockpit=this;
        const before=matrixCalls, beforeMs=matrixMs, start=performance.now();
        try{return (legacy?legacyDraw:actual).apply(this,args);}
        finally{if(__qaCapture) drawRows.push({ms:performance.now()-start,calls:matrixCalls-before,matrixMs:matrixMs-beforeMs});}
      };
      const summary=values=>{
        const sorted=values.toSorted((a,b)=>a-b);
        return {mean:values.reduce((a,b)=>a+b,0)/values.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)]};
      };
      window.__qaSample=async(mode,seconds)=>{
        legacy=mode==='A';
        await new Promise(r=>setTimeout(r,2000));
        __qaCpu=[]; drawRows.length=0; __qaCapture=true;
        let stamps;
        try{stamps=await watchFrames(seconds*1000);}finally{__qaCapture=false;}
        const validLoop=drawRows.length>0 && drawRows.length===__qaCpu.length && __qaCockpit.active && G.getState()==='playing';
        if(!validLoop) throw new Error('gameplay or frame instrumentation changed');
        const invalid=drawRows.some(r=>legacy ? r.calls<3 : r.calls!==1);
        const invalidScope=invalid || !G.scene.matrixWorldAutoUpdate;
        if(invalidScope) throw new Error('scene matrix update scope was not applied');
        const elapsed=stamps.at(-1)-stamps[0];
        return {mode,elapsed,frames:frameStats(stamps),cpu:summary(__qaCpu),drawCpu:summary(drawRows.map(r=>r.ms)),
          matrices:summary(drawRows.map(r=>r.matrixMs)),matrixCalls:summary(drawRows.map(r=>r.calls)),renders:drawRows.length};
      };
      window.__qaParity=async()=>{
        __qaFreeze=true; await new Promise(r=>setTimeout(r,250));
        const cockpit=__qaCockpit;
        const activeCockpit=cockpit?.active;
        if(!activeCockpit) throw new Error('cockpit inactive');
        const now=performance.now.bind(performance), frozen=now();
        performance.now=()=>frozen;
        const next=cockpit.mirrorUpdates.next;
        cockpit.mirrorUpdates.next=()=>0;
        const capture=async mode=>{
          legacy=mode==='A';
          for(let i=0;i<2;i++) cockpit.render(G.composer,G.renderer,G.scene,G.camera);
          const matrices=[];
          G.scene.traverse(o=>matrices.push(o.uuid,...o.matrixWorld.elements));
          const {width,height}=G.composer.target;
          const target=G.composer.toDisplay(G.composer.target.texture,width,height);
          return {pixels:await readPixels(G.renderer,target,width,height),matrices:JSON.stringify(matrices)};
        };
        const diff=(a,b)=>{
          const sameShape=a.length===b.length;
          if(!sameShape) throw new Error('pixel shape differs');
          let changed=0,max=0;
          for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d);}
          return {changed,max};
        };
        try {
          // Prime the photo target too; comparing the first read with settled reads is unstable.
          await capture('A');
          const first=await capture('A'), reference=await capture('A'), revised=await capture('B');
          const selfMatch=diff(first.pixels,reference.pixels), match=diff(first.pixels,revised.pixels);
          const matricesSame=first.matrices===revised.matrices;
          G.vehicle.object.position.x+=0.35;
          if(cockpit.wipers[0]) cockpit.wipers[0].node.rotation.z+=0.3;
          const moved=await capture('A'), movedRevised=await capture('B');
          const movedMatch=diff(moved.pixels,movedRevised.pixels), movedMatricesSame=moved.matrices===movedRevised.matrices;
          const responds=diff(first.pixels,moved.pixels), restored=G.scene.matrixWorldAutoUpdate;
          const matched=!selfMatch.changed && !match.changed && !movedMatch.changed && responds.changed>=1000 && matricesSame && movedMatricesSame && restored;
          return {matched,selfMatch,match,movedMatch,matricesSame,movedMatricesSame,responds,restored,values:first.pixels.length,wet:cockpit.rain.isWet(),backend:G.renderInfo};
        } finally {cockpit.mirrorUpdates.next=next;performance.now=now;}
      };
      G.start();
      return {render:G.renderInfo,graphics:GRAPHICS.settings,userAgent:navigator.userAgent};
    })()`);
    const ignoredWebGL = backend === "webgl" && context.render.backend !== "webgl2";
    if (ignoredWebGL) throw new Error("requested WebGL2 backend was not used");
    await browser.sleep(30000);
    const warmed = await browser.evaluate(
      `__game.getState()==='playing' && __game.getRoadGraph()?.segments.length>100 && !__game.debug.roads.input().loading && __qaCockpit?.active`,
    );
    if (!warmed) throw new Error("gameplay did not warm up");
    const session = await browser.evaluate(
      "__game.debug.logs.query({event:'session_start'}).at(-1)?.traceId",
    );
    const scenario = { time, url: url.href, context, session, samples: [] };
    report.scenarios.push(scenario);
    if (!process.env.QA_PARITY_ONLY) {
      for (const mode of process.env.QA_MODES?.split(",") ?? ["A", "B", "B", "A", "B", "A", "A", "B"]) {
        const sample = await browser.evaluate(`__qaSample(${JSON.stringify(mode)},${seconds})`);
        scenario.samples.push(sample);
        save();
        process.stdout.write(JSON.stringify({ time, ...sample }) + "\n");
      }
    }
    if (process.env.QA_VIOLATIONS) {
      scenario.violations = [];
      for (const media of ["photo", "video"]) {
        const result = await browser.evaluate(
          `__game.debug.perf.violation('signal',${JSON.stringify(media)},8)`,
        );
        scenario.violations.push(result);
        save();
        const hasEvidence =
          result.booked === "signal" && result.post?.media === media && result.post.hasPhoto;
        if (!hasEvidence) throw new Error("violation evidence did not finish: " + JSON.stringify(result));
        process.stdout.write(
          JSON.stringify({ time, media, frames: result.after, totals: result.totals }) + "\n",
        );
      }
    }
    scenario.parity = await browser.evaluate("__qaParity()");
    save();
    if (!scenario.parity.matched) throw new Error("render parity failed: " + JSON.stringify(scenario.parity));
    scenario.errors = await browser.evaluate(
      "__game.debug.logs.query({event:/uncaught_error|road_network_failed|road_worker_failed|log_schema_invalid/})",
    );
    const sameSession = await browser.evaluate(
      `__game.debug.logs.query({event:'session_start'}).at(-1)?.traceId===${JSON.stringify(session)}`,
    );
    const validSession = sameSession && scenario.errors.length === 0;
    if (!validSession) throw new Error("session or runtime errors changed");
    await browser.screenshot(join(out, `${time}.png`));
    report.host.loadAfter = loadavg();
    save();
    process.stdout.write(
      JSON.stringify({ time, parity: scenario.parity, report: join(out, "report.json") }) + "\n",
    );
  } finally {
    await browser.close();
  }
}
