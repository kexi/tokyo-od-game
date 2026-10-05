// Teaser movie: headless Chrome films scripted shots of the game frame by frame (1920×1080, 30 fps)
// on a virtual clock (clock.mjs) with the dev hook window.__game and the staging in page.mjs, then
// ffmpeg cuts the sections together with a synthesized soundtrack (music.py; no third-party music).
//
//   node scripts/teaser/teaser.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/teaser.mp4]
//                                  [--only night,day] [--port 9340]
//
// Needs the dev server (just dev) or a development build served with the dev hook. Each session
// films its sections into out/teaser-frames/<section>/; --only re-films just those sessions and the
// edit reuses the other sections' frames from the last run.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "../qa/browser.mjs";
import { installClock } from "./clock.mjs";
import { stage } from "./page.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? "out/teaser.mp4");
const WORK = resolve(args.work ?? "out/teaser-frames");
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const PORT = Number(args.port ?? 9340);
const FPS = 30;
// The line shape of src/log.ts (ts, level, event, traceId = this run). Why not import it: these
// run on plain node, which cannot load the .ts logger (AGENTS.md: .ts runs through tsx).
const traceId = crypto.randomUUID();
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event, traceId, ...fields }));

/** The cut, in order. Each id is a section one of the sessions below films into WORK/<id>/. */
const EDIT = [
  "cold",
  "title",
  "plateau",
  "river",
  "sign",
  "flare",
  "lapse",
  "red",
  "chase",
  "ticket",
  "y",
  "navi",
  "charm",
  "tv",
  "taxi-call",
  "taxi-come",
  "taxi-ride",
  "gfx",
  "lang",
  "end",
];

// What the browser remembers before the game loads: 画質 最高 (the presets' own values, so the
// preset reads 最高), Japanese, both mirror charms, and the one-time tips already seen.
const ULTRA = {
  resolution: "2",
  shadows: "4096",
  motionBlur: "light",
  bloom: "high",
  lensFlare: "on",
  reflections: "high",
  windows: "rooms",
  wetRoads: "full",
  streetLights: "32",
  rainGlass: "on",
  viewDistance: "far",
  traffic: "many",
  antialias: "on",
  backend: "auto",
};
const STORAGE = {
  "tod.graphics": JSON.stringify(ULTRA),
  "tod.lang": "ja",
  "tod.charmTip": "1",
  "tod.tvNotice": "1",
  "tod.controls": JSON.stringify({ layout: "wasd", assist: "easy", charm: "both", seatModel: 2 }),
};
const PRELOAD = `(() => { const s = ${JSON.stringify(STORAGE)};
  try { for (const k in s) localStorage.setItem(k, s[k]); } catch {} })(); (${installClock})();`;

/** One page of the game: open at a place, time of day and weather, ready to film. */
async function session(name, { start = null, time, weather }) {
  const b = await launch(`${BASE}${start ? `?start=${start}` : ""}`, {
    width: 1920,
    height: 1080,
    port: PORT,
    preload: PRELOAD,
  });
  try {
    let state = null;
    for (let i = 0; i < 150 && state !== "ready"; i++) {
      await b.sleep(1000);
      state = await b.evaluate("window.__game?.getState()").catch(() => null);
    }
    if (state !== "ready") throw new Error(`${name}: the game did not load (${state})`);
    const backend = await b.evaluate("window.__game.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'");
    log("session", { name, backend });
    await b.evaluate("window.__clock.start()");
    await b.evaluate(`(${stage})()`);
  } catch (error) {
    await b.close();
    throw error;
  }
  const s = {
    b,
    ev: (js) => b.evaluate(js),
    /** The shot's time of day and weather (the game starts at random ones: set again after it). */
    sky: () =>
      b.evaluate(`document.querySelector('[data-time="${time}"]').click();
        document.querySelector('[data-weather="${weather}"]').click();
        window.__game.env.wetness = window.__game.env.overcast = ${weather === "rain" ? 1 : 0}`),
    key: (code, shift = false) => b.evaluate(`window.__tz.key('${code}', null, ${shift})`),
    hold: (code, down) => b.evaluate(`window.__tz.key('${code}', ${down})`),
    /** Game frames that are not filmed (getting ready between shots). */
    pump: async (frames) => {
      for (let i = 0; i < frames; i++) await b.evaluate("window.__tz.frame(window.__tz.t, window.__tz.len)");
    },
    /** Frames until `js` is true (checked every `every`), at most `max`; true if it came. */
    until: async (js, max, every = 3) => {
      for (let i = 0; i < max; i += every) {
        if (await b.evaluate(js)) return true;
        await s.pump(every);
      }
      return Boolean(await b.evaluate(js));
    },
    /**
     * Film a section: `seconds` of frames into WORK/<id>/, with `events` ([seconds, js]) run as
     * the shot reaches them. Two unfilmed frames first, so a cut's camera jump is not smeared by
     * the motion blur.
     */
    film: async (id, seconds, events = []) => {
      const dir = join(WORK, id);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const frames = Math.round(seconds * FPS);
      const pending = events.toSorted((x, y) => x[0] - y[0]);
      await b.evaluate(`window.__tz.t = 0; window.__tz.len = ${seconds}`);
      await s.pump(2);
      for (let i = 0; i < frames; i++) {
        const t = i / FPS;
        while (pending.length > 0 && pending[0][0] <= t) await b.evaluate(pending.shift()[1]);
        await b.evaluate(`window.__tz.frame(${t}, ${seconds})`);
        await b.screenshot(join(dir, `f${String(i).padStart(5, "0")}.jpg`), 92);
      }
      log("section", { id, frames });
    },
    close: () => b.close(),
  };
  return s;
}

/** Run one session's shots unless --only leaves it out; the page is closed whatever happens. */
async function run(name, options, shots) {
  if (ONLY && !ONLY.has(name)) return;
  const s = await session(name, options);
  try {
    await shots(s);
  } finally {
    await s.close();
  }
}

// ---- page-side snippets ----
/** Start the game and settle in the driver's seat: phone in the pocket, wipers as asked. */
const begin = async (s, { wipersHi = false } = {}) => {
  await s.ev("window.__game.start()");
  await s.pump(5);
  await s.sky();
  await s.pump(25);
  // The phone sits in its holder from the start: in the pocket for the cinematic shots (F).
  await s.key("KeyF");
  // Tab steps the wipers OFF → 間欠 → LO → HI.
  if (wipersHi) for (const _ of [1, 2, 3]) await s.key("Tab");
  await s.pump(15);
};
/** The signal approach ahead of the car (window.__ap), within `range` m; its distance. */
const findSignal = (range) => `(() => { const G = window.__game; const y = G.vehicle.yaw();
  const fwd = G.vehicle.position().set(Math.sin(y), 0, Math.cos(y));
  const a = G.control.ahead(G.vehicle.position(), fwd, ${range});
  window.__ap = a && a.approach.kind === 'signal' ? a.approach : null; return window.__ap ? a.dist : null; })()`;
const lightIs = (state) => `window.__ap && window.__game.control.state(window.__ap) === '${state}'`;
/** No light pillars over the spots and no route arrows on the road (for the cinematic shots). */
const quietWorld = `(() => { const G = window.__game; G.field.beams.visible = false; G.field.gems.visible = false;
  G.ribbon.update = () => {}; G.ribbon.object.visible = false; })()`;
/** The autopilot's cruising speed held at most `ms` m/s (it otherwise drives at the limit). */
const capAutopilot = (
  ms,
) => `(() => { const d = window.__game.getAutopilot()?.driver; if (!d || d.__capped) return;
  const cruise = d.cruise.bind(d); d.cruise = (route) => Math.min(cruise(route), ${ms}); d.__capped = true; })()`;
/** Where the robotaxi is called: the kerb of 行幸通り, the boulevard to the station. */
const TAXI_STAND = { lat: 35.6812, lon: 139.7645 };
/** 東京駅 丸の内駅舎: a point of the road before it that the autopilot routes to, and its middle. */
const STATION_FRONT = { lat: 35.6806, lon: 139.7652 };
const STATION = { lat: 35.6812, lon: 139.7669 };
/**
 * The opening drive aimed at the station's front (the open data's stations are Toei's, which
 * have no 東京駅): a destination of the game's own kind, so the navi and the autopilot go there.
 */
const toStation = `(() => { const G = window.__game; const here = G.getFrame().toGeodetic(G.vehicle.position());
  const target = { id: -77, category: 'landmark', name: '東京駅 丸の内駅舎', ward: '千代田区', source: -77,
    lat: ${STATION_FRONT.lat}, lon: ${STATION_FRONT.lon} };
  G.missions.current = { target, startedAt: performance.now(), timeLimit: Infinity, isTrip: true,
    startDistance: Math.hypot((target.lat - here.lat) * 111000, (target.lon - here.lon) * 90000) }; return true; })()`;
/** The title screen's language button. */
const lang = (code) => `document.querySelector('[data-lang="${code}"]').click()`;
/** 設定 › 画質 › プリセット chosen as by hand. */
const preset = (p) => `(() => { const el = document.querySelector('#opt-graphics-preset'); el.value = '${p}';
  el.dispatchEvent(new Event('change')); })()`;
/** A zoom keyframe on the ticket: its left part at the middle, so it fills the right of the frame. */
const form = (t, fy) => `{ t: ${t}, sel: '#ticket-form-container', fx: 0.3, fy: ${fy}, s: 1.7 }`;
/** A point at `lat, lon` in the local frame, on the ground (or water) plus `h` m. */
const at = (
  lat,
  lon,
  h,
) => `(() => { const G = window.__game; const f = G.getFrame(); const p = f.toLocal(${lat}, ${lon}, f.origin.h);
  p.y = (G.water.surfaceUnder(p.x, p.z) ?? G.groundY(p.x, p.z) ?? 0) + ${h}; return p; })()`;

// ---- 東京駅 丸の内, a rainy night: the title screen, the opening, the title, 画質, the end ----
await run("night", { time: "night", weather: "rain" }, async (s) => {
  // The title screen's language switch, before the start.
  await s.sky();
  await s.ev("window.__tz.hud('none')");
  await s.pump(20);
  await s.film("lang", 2.5, [
    [0, "window.__tz.caption(null)"],
    [0.55, lang("en")],
    [1.2, lang("zh")],
    [1.85, lang("ja")],
  ]);
  await begin(s, { wipersHi: true });
  await s.ev(quietWorld);
  log("to_station", { ok: await s.ev(toStation) });
  // Off on a fresh green, so the drive to the station is not stopped at the first light.
  await s.ev(findSignal(200));
  await s.until(lightIs("red"), 1500);
  await s.until(lightIs("green"), 1500);
  await s.key("KeyJ");
  log("autopilot", { on: await s.ev("Boolean(window.__game.getAutopilot())") });
  await s.ev(capAutopilot(7.5));
  await s.pump(45);
  await s.ev("window.__tz.caption('雨の夜の東京駅を、運転席から。', '', { at: 1.6, out: 10.6 })");
  await s.film("cold", 12);
  await s.ev("window.__tz.caption(null); window.__tz.card('tz-title', { at: 0.1, out: 3.45 })");
  await s.film("title", 4);
  await s.ev("window.__tz.card(null)");
  // The end: a crane up from behind the car to the floodlit station in the rain.
  await s.ev(`window.__station = ${at(STATION.lat, STATION.lon, 14)}`);
  await s.ev(`window.__tz.camera((cam, c) => { const st = window.__station;
    const dx = st.x - c.car.x; const dz = st.z - c.car.z; const d = Math.hypot(dx, dz) || 1;
    const back = 12 - c.k * 3; const h = 2.4 + c.k * 10;
    cam.position.set(c.car.x - (dx / d) * back - (dz / d) * 2, c.car.y + h, c.car.z - (dz / d) * back + (dx / d) * 2);
    cam.lookAt(st.x, st.y - c.k * 4, st.z); cam.fov = 56; })`);
  await s.ev("window.__tz.card('tz-end', { at: 0.5, out: null })");
  await s.film("end", 4.5);
  await s.ev("window.__tz.card(null); window.__tz.camera(null)");
  // 画質: 最高 → 高 → 中 → 低 in 設定, the night town behind it.
  await s.key("Escape");
  await s.pump(4);
  await s.ev(
    "document.querySelector('#graphics-options').scrollIntoView({ block: 'center' }); window.__tz.raise()",
  );
  await s.ev(`window.__tz.zoom([{ t: 0 }, { t: 0.8, sel: '.graphics-options', fx: 0.4, fy: 0.3, s: 1.35 }])`);
  await s.ev(
    "window.__tz.caption('画質は 4 段階、言語は 3 つ', '最高・高・中・低 ／ 日本語・English・中文', { at: 0.2 })",
  );
  await s.film("gfx", 2.8, [
    [0.9, preset("high")],
    [1.5, preset("medium")],
    [2.1, preset("low")],
  ]);
});

// ---- 大手町, by day: the navi, the towers, a guide sign ----
await run("ote", { start: "35.68530,139.76315", time: "day", weather: "clear" }, async (s) => {
  await begin(s);
  await s.ev(quietWorld);
  await s.ev("window.__tz.hud('drive')");
  await s.pump(30);
  // The navi panel up close: the junction's own picture, its name, the lanes, the road and limit.
  await s.key("KeyJ");
  await s.ev(`window.__tz.zoom([{ t: 0 }, { t: 1.1, sel: '#nav', fx: 0.5, fy: 0.5, s: 1.9 }])`);
  await s.ev(
    "window.__tz.caption('交差点名で案内するナビ', '交差点の拡大図・レーン・道路名・制限速度', { at: 0.3, out: 4.05 })",
  );
  await s.film("navi", 4.5);
  await s.ev("window.__tz.zoom(null); window.__tz.caption(null); window.__tz.hud('none')");
  await s.ev(capAutopilot(8));
  await s.until("window.__game.vehicle.speedKmh() > 15", 300);
  // PLATEAU's towers from low beside the car.
  await s.ev(`window.__tz.camera((cam, c) => {
    const back = 7 - c.k * 1.5;
    cam.position.set(c.car.x - c.fwd.x * back + c.left.x * 2.6, c.car.y - 0.25, c.car.z - c.fwd.z * back + c.left.z * 2.6);
    cam.lookAt(c.car.x + c.fwd.x * 12, c.car.y + 5.5, c.car.z + c.fwd.z * 12); cam.fov = 64; })`);
  await s.ev("window.__tz.caption('実在の東京 23 区を走る', 'PLATEAU の建物・川・案内標識', { at: 0.25 })");
  await s.film("plateau", 2);
  // The nearest overhead 案内標識, from the road before it.
  const sign = await s.ev(`(() => { const G = window.__game; const car = G.vehicle.position();
    const plans = G.guideSigns.plans.filter((p) => p.mount === 'overhead').sort((a, b) => a.pos.distanceTo(car) - b.pos.distanceTo(car));
    const p = plans[0]; if (!p) return null; window.__sign = p; return { d: p.pos.distanceTo(car), text: JSON.stringify(p.board).slice(0, 120) }; })()`);
  log("sign", sign ?? {});
  await s.ev(`window.__tz.camera((cam, c) => { const p = window.__sign; if (!p) return; const tr = p.travel;
    const back = 15 - c.k * 4; const gy = c.G.groundY(p.pos.x, p.pos.z) ?? p.pos.y;
    cam.position.set(p.pos.x - tr.x * back - tr.z * 2.5, gy + 1.6, p.pos.z - tr.z * back + tr.x * 2.5);
    cam.lookAt(p.pos.x - tr.z * 3.5, gy + 5.4, p.pos.z + tr.x * 3.5); cam.fov = 44; })`);
  await s.ev(
    "window.__tz.caption('実在の東京 23 区を走る', 'PLATEAU の建物・川・案内標識', { at: null, out: 1.55 })",
  );
  await s.film("sign", 2);
});

// ---- 丸の内, by day: the law, Y, the cabin, the robotaxi ----
await run("day", { time: "day", weather: "clear" }, async (s) => {
  await begin(s);
  await s.ev(quietWorld);
  await s.ev("window.__tz.hud('talk')");
  // Where the street starts (for the braking shot later).
  await s.ev("window.__home = { at: window.__game.vehicle.position(), yaw: window.__game.vehicle.yaw() }");
  // Red-light running, staged at the light ahead: a patrol car on patrol is put behind, and the car
  // is set rolling at 40 km/h as the light turns yellow, to reach the stop line a second after red.
  await s.ev(findSignal(200));
  // A marked patrol car if one comes by (an unmarked one tails quietly first, lights off).
  await s.until("window.__game.getPatrols().some((u) => u.kind === 'patrol')", 2400, 15);
  await s.until(lightIs("green"), 1500);
  await s.until(lightIs("yellow"), 1500, 1);
  const V = 11;
  await s.ev(`(() => { const G = window.__game; const ap = window.__ap; const tr = ap.travel;
    const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5); const D = ${V} * 4; const yaw = Math.atan2(tr.x, tr.z);
    const put = (car, back, ride) => { const p = mid.clone().addScaledVector(tr, -back); p.y = (G.groundY(p.x, p.z) ?? p.y) + ride;
      car.teleport(p, yaw); car.body?.setLinvel({ x: tr.x * ${V}, y: 0, z: tr.z * ${V} }, true); return p; };
    put(G.vehicle, D, 0.9);
    const u = G.getPatrols().find((x) => x.kind === 'patrol') ?? G.getPatrols()[0]; const p = put(u.car, D + 20, 0.86); u.car.syncVisuals(); u.driver.place(p, yaw);
    window.__tz.drive(${V * 3.6}); })()`);
  await s.pump(30);
  // The driver's own view, a little narrower so the light ahead reads.
  await s.ev("window.__tz.seat(0, 0.05, window.__game.camera.fov * 0.8)");
  await s.ev(
    "window.__tz.caption('信号無視は、見られている', 'パトカー・白バイ・覆面パトカーが追ってくる', { at: 0.3 })",
  );
  await s.film("red", 4);
  const caught = await s.ev(
    "JSON.stringify({ log: window.__game.law.state.log.map((r) => r.kind), police: window.__game.getPolice()?.state })",
  );
  log("caught", JSON.parse(caught));
  // Behind the patrol car: its beacons, and the car it is after ahead of it. Slower now, so it closes.
  await s.ev("window.__tz.drive(26)");
  await s.ev(`window.__tz.camera((cam, c) => { const u = c.G.getPolice(); const p = u?.position ?? c.car;
    const y = u ? u.car.yaw() : c.yaw; const f = { x: Math.sin(y), z: Math.cos(y) };
    cam.position.set(p.x - f.x * (7.5 - c.k * 1.5) + f.z * 1.2, p.y + 2.1, p.z - f.z * (7.5 - c.k * 1.5) - f.x * 1.2);
    cam.lookAt(p.x + f.x * 14, p.y + 0.9, p.z + f.z * 14); cam.fov = 55; })`);
  await s.ev(
    "window.__tz.caption('信号無視は、見られている', 'パトカー・白バイ・覆面パトカーが追ってくる', { at: null, out: 2.55 })",
  );
  await s.film("chase", 3);
  // Pulled over on the left: after a few seconds stopped, the officer writes the ticket.
  await s.ev("window.__tz.drive(null); window.__tz.camera(null); window.__tz.caption(null)");
  await s.hold("KeyS", true);
  await s.until("window.__game.vehicle.speedKmh() < 0.5", 300);
  await s.hold("KeyS", false);
  const isTicket = "document.querySelector('#ticket-dialog').open";
  if (!(await s.until(isTicket, 1200))) {
    // Held up at the light: the patrol car is brought up behind (it stops within 22 m to write it).
    await s.ev(`(() => { const G = window.__game; const u = G.getPolice(); if (!u) return; const y = G.vehicle.yaw();
      const p = G.vehicle.position().addScaledVector({ x: Math.sin(y), y: 0, z: Math.cos(y) }, -9); p.y = (G.groundY(p.x, p.z) ?? p.y) + 0.86;
      u.car.teleport(p, y); u.car.syncVisuals(); u.driver.place(p, y); })()`);
    await s.until(isTicket, 600);
  }
  log("ticket", { open: await s.ev(isTicket) });
  await s.pump(10);
  await s.ev("window.__tz.raise(); window.__tz.hud('drive')");
  // The ticket: whole, then its top (who, what, where), then the fine and the points.
  // Kept to the right of the frame (the caption is at the lower left).
  await s.ev(`window.__tz.zoom([{ t: 0 }, ${form(0.9, 0.3)}, ${form(2.4, 0.3)}, ${form(3.3, 0.74)}])`);
  await s.ev(
    "window.__tz.caption('その場で青切符', '反則金と違反点数は道路交通法どおり', { at: 0.3, out: 4.05 })",
  );
  await s.film("ticket", 4.5);
  await s.ev(
    "window.__tz.zoom(null); window.__tz.caption(null); document.querySelector('#ticket-accept').click()",
  );
  await s.pump(20);
  // Y: someone saw it. The game's own post if a witness made one, else one of theirs now.
  await s.ev(`(() => { const G = window.__game; if (G.social.posts.length) return;
    const r = G.law.state.log.find((x) => x.kind === 'signal') ?? G.law.state.log[0]; if (!r) return;
    for (let i = 0; i < 40 && !G.social.posts.some((p) => p.media !== 'text'); i++) G.social.maybePost(r, 12, G.debug.gameNow()); })()`);
  await s.pump(150);
  await s.key("KeyF");
  await s.pump(5);
  await s.ev("document.querySelector('#social-open').click()");
  await s.pump(5);
  await s.ev(`(() => { const post = window.__game.social.posts.find((p) => p.media !== 'text') ?? window.__game.social.posts[0];
    if (!post) return; const row = [...document.querySelectorAll('#social-app article.social-post')].find((a) => a.textContent.includes(post.text.slice(0, 12)));
    row?.click(); })()`);
  await s.pump(5);
  await s.key("KeyF", true);
  await s.pump(10);
  // Replies come at a person's pace (one every 8 s): the shot runs the clock 6 times as fast.
  await s.ev(`window.__tz.hooks.set('fast', () => { window.__game.env.gameMs += 10000; })`);
  await s.ev(`window.__tz.zoom([{ t: 0 }, { t: 1.0, sel: '#phone', fx: 0.5, fy: 0.5, s: 1.22 }])`);
  // The post, then down to the replies under it as they come.
  await s.ev(`window.__tz.hooks.set('scroll', (t) => { const page = document.querySelector('#phone-social .sns-page:last-child');
    if (!page) return; const k = Math.min(1, Math.max(0, (t - 2.2) / 1.1)); page.scrollTop = k * k * (3 - 2 * k) * 230; })`);
  await s.ev(
    "window.__tz.caption('その瞬間は Y に投稿される', '目撃者の動画に、返信と拡散が次々と', { at: 0.3, out: 5.05 })",
  );
  await s.film("y", 5.5);
  await s.ev(
    "window.__tz.hooks.delete('fast'); window.__tz.hooks.delete('scroll'); window.__tz.zoom(null); window.__tz.caption(null)",
  );
  // Put away, still in 拡大表示 (the phone remembers it): the taxi app comes up large too.
  await s.key("KeyF");
  await s.pump(5);
  // The mirror charms under a hard stop from 50 km/h, back on the first street.
  await s.ev("window.__tz.hud('none')");
  await s.ev(`(() => { const G = window.__game; const h = window.__home; const v = 13.5;
    G.vehicle.teleport(h.at, h.yaw); G.vehicle.body.setLinvel({ x: Math.sin(h.yaw) * v, y: 0, z: Math.cos(h.yaw) * v }, true);
    window.__tz.drive(48); })()`);
  await s.pump(20);
  await s.ev("window.__tz.camera(null)");
  await s.pump(2);
  await s.ev("window.__tz.seat(0.84, 0.1, 46)");
  await s.ev(
    "window.__tz.caption('運転席のディテール', 'ブレーキで揺れるミラーの飾り、停車中だけ映るナビのテレビ', { at: 0.3 })",
  );
  await s.film("charm", 3, [
    [0.7, "window.__tz.drive(null); window.__tz.key('KeyS', true)"],
    [2.9, "window.__tz.key('KeyS', false)"],
  ]);
  // ナビのテレビ: stopped with the parking brake on, the picture comes up.
  await s.until("window.__game.vehicle.speedKmh() < 0.3", 200);
  await s.hold("Space", true);
  await s.ev("window.__tz.camera(null)");
  await s.pump(2);
  await s.key("Digit3");
  await s.pump(20);
  await s.ev("window.__tz.seat(0.57, -0.25, 24)");
  await s.ev(
    "window.__tz.caption('運転席のディテール', 'ブレーキで揺れるミラーの飾り、停車中だけ映るナビのテレビ', { at: null, out: 2.55 })",
  );
  await s.film("tv", 3);
  await s.hold("Space", false);
  await s.ev("window.__tz.camera(null); window.__tz.caption(null)");
  // The robotaxi: out of the car (Q), called from the phone (U).
  await s.key("Digit3");
  await s.key("KeyQ");
  await s.pump(10);
  // On the pavement of 行幸通り, away from the parked car (the taxi would wait behind it, as behind
  // any stopped car). Not the station's front: from where the taxi stops there, no route to anywhere
  // is found and it lets the passenger out at once.
  const kerb =
    await s.ev(`(() => { const G = window.__game; const g = G.getRoadGraph(); const f = G.getFrame();
    const near = f.toLocal(${TAXI_STAND.lat}, ${TAXI_STAND.lon}, f.origin.h);
    const hit = g.nearest(near, 80, (seg) => seg.line.kind !== 'highway' && seg.line.width >= 5.5 && seg.length > 40);
    if (!hit) return null; const { pos, dir } = g.sample(hit.seg, hit.s); const sign = hit.seg.oneway || 1;
    const tr = { x: dir.x * sign, z: dir.z * sign }; const side = hit.seg.line.width / 2 + 1.4;
    const at = pos.clone().add({ x: tr.z * side, y: 0, z: -tr.x * side }); at.y = G.groundY(at.x, at.z) ?? pos.y;
    G.walker.enter(at, Math.atan2(-tr.z, tr.x)); return { side }; })()`);
  log("kerb", kerb ?? {});
  await s.pump(10);
  await s.key("KeyU");
  await s.pump(10);
  await s.ev("window.__tz.hud('talk')");
  await s.ev(`window.__tz.zoom([{ t: 0 }, { t: 0.7, sel: '#phone', fx: 0.5, fy: 0.42, s: 1.2 }])`);
  await s.ev("window.__tz.caption('自動運転タクシーを呼んで、乗る', 'U で配車、Q で乗車', { at: 0.2 })");
  await s.film("taxi-call", 2);
  await s.ev("window.__tz.zoom(null)");
  await s.key("KeyF");
  // The taxi drives at a robot's pace through every light: it is put 80 m out on its route.
  await s.pump(5);
  log("taxi", {
    put: await s.ev(`(() => { const G = window.__game; const t = G.getTaxi(); const r = t?.route; if (!r) return 'no route';
    const i = r.cum.findIndex((c) => c >= r.length - 80); if (i < 1) return 'near';
    const a = r.points[i - 1]; const b = r.points[i]; const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const p = b.clone(); p.y = (G.groundY(p.x, p.z) ?? p.y) + 0.86;
    t.car.teleport(p, yaw); t.car.syncVisuals(); t.driver.place(p, yaw); t.driver.hint = i;
    const n = r.points.length; const end = r.points[n - 1]; const prev = r.points[n - 2]; const d = Math.hypot(end.x - prev.x, end.z - prev.z) || 1;
    window.__taxiEnd = { p: end.clone(), f: { x: (end.x - prev.x) / d, z: (end.z - prev.z) / d } }; return 'put'; })()`),
  });
  // The caller waits on the kerb where it will pull in (the end of its route).
  await s.ev(`(() => { const G = window.__game; const { p, f } = window.__taxiEnd;
    const at = p.clone().add({ x: f.z * 4, y: 0, z: -f.x * 4 }); at.y = G.groundY(at.x, at.z) ?? p.y; G.walker.enter(at, Math.atan2(-f.z, f.x)); })()`);
  const taxiNear =
    "(window.__game.getTaxi()?.remaining ?? 1e9) < 30 || window.__game.getTaxi()?.state === 'waiting'";
  log("taxi", { near: await s.until(taxiNear, 1800, 1) });
  // Behind it on the road side, as it pulls in to the kerb where its caller stands.
  await s.ev(`window.__tz.camera((cam, c) => { const t = c.G.getTaxi(); if (!t) return; const p = t.position; const y = t.car.yaw();
    const f = { x: Math.sin(y), z: Math.cos(y) }; const back = 8 - c.k * 2;
    cam.position.set(p.x - f.x * back - f.z * 2.6, p.y + 1.9, p.z - f.z * back + f.x * 2.6);
    cam.lookAt(p.x + f.x * 7 + f.z * 1.5, p.y + 0.6, p.z + f.z * 7 - f.x * 1.5); cam.fov = 52; })`);
  await s.ev("window.__tz.caption('自動運転タクシーを呼んで、乗る', 'U で配車、Q で乗車', { at: null })");
  await s.film("taxi-come", 2.5);
  await s.until("window.__game.getTaxi()?.state === 'waiting'", 1200);
  // Up to its kerb-side door, and in (Q).
  await s.ev(`(() => { const G = window.__game; const t = G.getTaxi(); const y = t.car.yaw();
    const at = t.position.clone().add({ x: Math.cos(y) * 1.9, y: 0, z: -Math.sin(y) * 1.9 }); at.y = G.groundY(at.x, at.z) ?? at.y - 0.8;
    G.walker.enter(at, y); })()`);
  // To the nearest station in the app's list (a far one may lie beyond the roads loaded).
  await s.ev(`(() => { const sel = document.querySelector('#taxi-dest');
    const o = [...sel.options].find((x) => /駅（/.test(x.textContent)); if (o) sel.value = o.value; })()`);
  await s.pump(3);
  await s.key("KeyQ");
  log("taxi", { mode: await s.ev("window.__game.getMode()") });
  await s.ev("window.__tz.hud('drive')");
  await s.ev(`window.__tz.camera((cam, c) => { const t = c.G.getTaxi(); if (!t) return; const p = t.position; const y = t.car.yaw();
    const f = { x: Math.sin(y), z: Math.cos(y) }; cam.position.set(p.x - f.x * 8 + f.z * 1.5, p.y + 2.6, p.z - f.z * 8 - f.x * 1.5);
    cam.lookAt(p.x + f.x * 8, p.y + 0.8, p.z + f.z * 8); cam.fov = 55; })`);
  await s.pump(20);
  await s.ev(
    "window.__tz.caption('自動運転タクシーを呼んで、乗る', 'U で配車、Q で乗車', { at: null, out: 1.55 })",
  );
  await s.film("taxi-ride", 2);
});

// ---- 両国, the Sumida at dusk: the river, the sun, dusk into night ----
await run("ryogoku", { start: "35.6935,139.7862", time: "evening", weather: "clear" }, async (s) => {
  await begin(s);
  await s.ev(quietWorld);
  await s.ev("window.__tz.hud('none')");
  // The 夕方 preset puts the sun 3° up: a while before that for the river in the low light.
  await s.ev("window.__game.env.gameMs -= 28 * 60000");
  await s.pump(20);
  const river = await s.ev(
    `(() => { window.__river = { from: ${at(35.6913, 139.7886, 2.6)}, to: ${at(35.6945, 139.7884, 3.5)} }; return true; })()`,
  );
  log("river", { river });
  await s.ev(`window.__tz.camera((cam, c) => { const r = window.__river;
    cam.position.copy(r.from).lerp(r.to, c.k * 0.06); cam.lookAt(r.to.x - c.k * 8, r.to.y, r.to.z); cam.fov = 56; })`);
  await s.pump(20);
  await s.ev("window.__tz.caption('実在の東京 23 区を走る', 'PLATEAU の建物・川・案内標識', { at: null })");
  await s.film("river", 2.5);
  // The low sun (about 9° up) across the water, from 30 m over the river so it clears the far
  // bank's roofs; the view keeps the direction the sun had when the shot began.
  await s.ev("window.__game.env.gameMs -= 8 * 60000");
  await s.ev(`(() => { const sd = window.__game.env.sunDir;
    window.__sunset = { from: ${at(35.693, 139.7888, 30)}, look: { x: sd.x, y: sd.y - 0.12, z: sd.z } }; })()`);
  await s.ev(`window.__tz.camera((cam, c) => { const r = window.__sunset; const a = -0.12 + c.k * 0.1;
    const l = { x: r.look.x * Math.cos(a) - r.look.z * Math.sin(a), z: r.look.x * Math.sin(a) + r.look.z * Math.cos(a) };
    cam.position.copy(r.from); cam.lookAt(r.from.x + l.x * 100, r.from.y + r.look.y * 100, r.from.z + l.z * 100); cam.fov = 58; })`);
  await s.ev("window.__tz.coverSun(true)");
  await s.pump(30);
  await s.ev(
    "window.__tz.caption('時間が流れ、街が灯る', 'ゲームの時計は 1 秒で 1 分（ここは早回し）', { at: 0.3 })",
  );
  await s.film("flare", 2.5);
  // Dusk into night in 3.5 s: 90 minutes, the street lights coming on and the windows lighting up.
  await s.ev(`window.__tz.hooks.set('lapse', () => { window.__game.env.gameMs += 49400; })`);
  await s.ev(`window.__tz.camera((cam, c) => { const r = window.__sunset; const a = -0.02 + c.k * 0.14;
    const l = { x: r.look.x * Math.cos(a) - r.look.z * Math.sin(a), z: r.look.x * Math.sin(a) + r.look.z * Math.cos(a) };
    cam.position.copy(r.from); cam.position.y += c.k * 4;
    cam.lookAt(r.from.x + l.x * 100, r.from.y + (r.look.y - 0.04) * 100, r.from.z + l.z * 100); cam.fov = 58; })`);
  await s.ev(
    "window.__tz.caption('時間が流れ、街が灯る', 'ゲームの時計は 1 秒で 1 分（ここは早回し）', { at: null, out: 3.05 })",
  );
  await s.film("lapse", 3.5);
});

// ---- Edit: the sections in order → H.264, with the soundtrack fitted to the cut ----
// Sections not filmed yet (a first run with --only): nothing to cut.
const missing = EDIT.filter((id) => !existsSync(join(WORK, id)));
if (missing.length > 0) {
  log("edit_skipped", { missing });
  process.exit(0);
}
const edit = join(WORK, "edit");
rmSync(edit, { recursive: true, force: true });
mkdirSync(edit, { recursive: true });
let frameNo = 0;
const starts = {};
for (const id of EDIT) {
  const dir = join(WORK, id);
  starts[id] = frameNo / FPS;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".jpg"))
    .toSorted())
    symlinkSync(join(dir, f), join(edit, `f${String(frameNo++).padStart(5, "0")}.jpg`));
}
const seconds = frameNo / FPS;
const music = join(WORK, "music.wav");
// The music's turns on the cut: the drop on the title, a break over the navi and the cabin, the
// outro on the end card.
const cues = [starts.title, starts.navi, starts["taxi-call"], starts.end].map((x) => x.toFixed(2)).join(",");
execFileSync("uv", ["run", join(import.meta.dirname, "music.py"), music, String(seconds), cues], {
  stdio: "inherit",
});
mkdirSync(resolve(OUT, ".."), { recursive: true });
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(edit, "f%05d.jpg"),
    "-i",
    music,
    // The JPEG frames are full range: limited-range yuv420p plays the same everywhere.
    "-vf",
    "scale=in_range=pc:out_range=tv,format=yuv420p",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "19",
    "-preset",
    "medium",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    "-movflags",
    "+faststart",
    OUT,
  ],
  { stdio: "ignore" },
);
writeFileSync(join(WORK, "done.json"), JSON.stringify({ frames: frameNo, seconds, starts }, null, 2));
log("done", { out: OUT, frames: frameNo, seconds: Math.round(seconds * 10) / 10 });
