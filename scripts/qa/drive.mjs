// QA drive for the road-qa loop: the car cruises on 自動運転モード while the game is filmed. Every
// few seconds it saves a screenshot from the chase camera and a state record of what the scene
// should show (limit, signals and signs ahead, lane and one-way rules, law events), so an AI
// reviewer can compare the picture with Japanese road law and the data.
//
//   node scripts/qa/drive.mjs [--minutes 3] [--every 6] [--time day|night|real] [--start lat,lon]
//
// Needs the dev server (just dev). Output: .qa/runs/<time>/frame-NNN.jpg + frame-NNN.json + run.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const minutes = Number(args.minutes ?? 3);
const every = Number(args.every ?? 6);
const time = args.time ?? "day";
const base = process.env.QA_URL ?? "http://localhost:5173/tokyo-od-game/";
const url = args.start ? `${base}?start=${args.start}` : base;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(import.meta.dirname, "..", "..", ".qa", "runs", stamp);
mkdirSync(out, { recursive: true });
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

// What the scene should show around the car, in the game's own words (dev-only __game hook).
const STATE = `(() => {
  const G = window.__game; const g = G.getRoadGraph(); const A = G.getApplied(); const C = G.control;
  const car = G.vehicle.position(); const f = G.getFrame(); const geo = f.toGeodetic(car);
  const yaw = G.vehicle.object.rotation.y; const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const ahead = (p, range) => { const dx = p.x - car.x, dz = p.z - car.z; const a = dx * fwd.x + dz * fwd.z; return a > 0 && a < range && Math.hypot(dx, dz) < range ? Math.round(Math.hypot(dx, dz)) : null; };
  const hit = g.nearest(car, 20, (s) => s.line.kind !== 'highway');
  const seg = hit?.seg;
  const ap = G.getAutopilot();
  const signs = A.signs.map((s) => ({ type: s.type, value: s.value, note: s.note, d: ahead(s.pos, 80), faces: s.travel.x * fwd.x + s.travel.z * fwd.z > 0.7 ? 'us' : 'other' })).filter((s) => s.d !== null).sort((a, b) => a.d - b.d).slice(0, 8);
  const signals = C.approaches.filter((a) => a.kind === 'signal').map((a) => { const m = a.a.clone().add(a.b).multiplyScalar(0.5); return { d: ahead(m, 120), state: C.state(a), ours: a.travel.x * fwd.x + a.travel.z * fwd.z > 0.7 }; }).filter((s) => s.d !== null && s.ours).sort((a, b) => a.d - b.d).slice(0, 2);
  const signNames = { 1: '最高速度', 2: '一方通行', 3: '車両進入禁止', 4: '駐車禁止', 5: '駐停車禁止', 6: '転回禁止', 7: '徐行', 8: '指定方向外進行禁止', 9: '横断歩道', 10: '一時停止', 11: '車両通行止め' };
  return {
    summary: {
      lat: +geo.lat.toFixed(6), lon: +geo.lon.toFixed(6),
      kmh: Math.round((ap ? ap.driver.speed : 0) * 3.6),
      limit: seg ? G.speedLimit(seg) : null, limitKind: seg?.limitKind ?? null,
      autopilot: !!ap, violations: G.law.state.log.map((v) => v.kind),
    },
    street: seg ? { width: seg.line.width, kind: seg.line.kind, oneway: seg.oneway, lanes: seg.lanes, noOvertake: seg.noOvertake, noLaneChange: seg.noLaneChange, closed: seg.closed, rules: seg.rules.map((r) => r.code), lateral: +(hit.lateral.toFixed(2)) } : null,
    signsAhead: signs.map((s) => ({ ...s, name: signNames[s.type] ?? s.type })),
    signalsAhead: signals,
    hud: { nav: document.querySelector('#nav')?.textContent.replace(/\\s+/g, ' ').trim(), speedometer: document.querySelector('#hud-speed')?.textContent.replace(/\\s+/g, ' ').trim() },
  };
})()`;

const alive = await fetch(base)
  .then((r) => r.ok)
  .catch(() => false);
if (!alive) {
  console.error(`dev server not reachable at ${base} — start it with: just dev`);
  process.exit(1);
}

const b = await launch(url);
try {
  for (let i = 0; i < 60; i++) {
    await b.sleep(1500);
    if ((await b.evaluate("window.__game?.getState()").catch(() => null)) === "ready") break;
  }
  await b.evaluate("window.__game.start()");
  await b.sleep(8000);
  const label = { day: "昼", night: "夜", real: "リアル", morning: "朝", evening: "夕方" }[time] ?? "昼";
  await b.evaluate(
    `[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${label}')?.click()`,
  );
  // Onto the nearest proper street (the default spawn is the station plaza), then autopilot.
  await b.evaluate(`(() => { const G = window.__game; const g = G.getRoadGraph(); const car = G.vehicle.position();
    const seg = g.segments.filter((s) => s.line.kind !== 'highway' && s.line.width >= 7 && s.length > 50 && !s.closed)
      .sort((a, c) => g.sample(a, a.length / 2).pos.distanceTo(car) - g.sample(c, c.length / 2).pos.distanceTo(car))[0];
    if (!seg) return;
    const dir = seg.oneway === 0 ? 1 : seg.oneway; const { pos, dir: d } = g.sample(seg, seg.length / 2); const t = d.clone().multiplyScalar(dir);
    const p = pos.clone().add({ x: t.z * 2.5, y: 0, z: -t.x * 2.5 }); p.y = (G.pedestrians.groundAt(p.x, p.z) ?? 0) + 0.9;
    G.vehicle.teleport(p, Math.atan2(t.x, t.z)); })()`);
  await b.evaluate("window.__game.advance(1.5)");
  await b.evaluate(
    "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyO' }))",
  );
  await b.evaluate("window.__game.advance(0.5)");
  const toasts = await b.evaluate("[...document.querySelectorAll('.toast')].map((t) => t.textContent)");
  log("autopilot", { on: await b.evaluate("!!window.__game.getAutopilot()"), toasts });
  const frames = [];
  const total = Math.round((minutes * 60) / every);
  for (let k = 0; k < total; k++) {
    await b.evaluate(`window.__game.advance(${every})`);
    const state = await b.evaluate(STATE);
    const name = `frame-${String(k + 1).padStart(3, "0")}`;
    await b.screenshot(join(out, `${name}.jpg`));
    writeFileSync(join(out, `${name}.json`), JSON.stringify(state, null, 2));
    frames.push({ frame: name, t: (k + 1) * every, ...state.summary });
    log("frame", { frame: name, ...state.summary });
  }
  writeFileSync(
    join(out, "run.json"),
    JSON.stringify(
      {
        url,
        time,
        minutes,
        every,
        frames,
        console: b.logs.filter((l) => /error|exception|warn/i.test(l)).slice(-30),
      },
      null,
      2,
    ),
  );
  log("done", { out, frames: frames.length });
} finally {
  await b.close();
}
