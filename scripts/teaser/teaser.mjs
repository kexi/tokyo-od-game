// Teaser movie: headless Chrome films scripted shots of the game frame by frame (1920×1080, 30 fps)
// on a virtual clock (clock.mjs) with the dev hook window.__game and the staging in page.mjs, then
// ffmpeg cuts the sections together with a synthesized soundtrack (music.py; no third-party music).
//
//   node scripts/teaser/teaser.mjs [--lang ja|en] [--base http://localhost:5173/tokyo-od-game/]
//                                  [--out out/teaser.mp4] [--only night,day] [--port 9340] [--sfx on|off]
//
// --lang picks the cut (cuts.mjs): ja, the Japanese teaser (out/teaser.mp4), or en, the English
// introduction that shows the features one by one (out/teaser.en.mp4), the game itself in that
// language. Needs the dev server (just serve-dev) or a development build served with the dev hook.
// Each session films its sections into out/teaser-frames[-<lang>]/<section>/; --only re-films just
// those sessions and the edit reuses the other sections' frames from the last run. --sfx on lays
// the game's own sounds over the music (sound.mjs; on by default for the English cut).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "../qa/browser.mjs";
import { installClock } from "./clock.mjs";
import { CUTS } from "./cuts.mjs";
import { stage } from "./page.mjs";
import { addSound } from "./sound.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const LANG = args.lang ?? "ja";
const CUT = CUTS[LANG];
if (!CUT) throw new Error(`no cut for --lang ${LANG} (${Object.keys(CUTS).join(", ")})`);
const isJa = LANG === "ja";
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? (isJa ? "out/teaser.mp4" : `out/teaser.${LANG}.mp4`));
const WORK = resolve(args.work ?? (isJa ? "out/teaser-frames" : `out/teaser-frames-${LANG}`));
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const PORT = Number(args.port ?? 9340);
const FPS = 30;
// The line shape of src/log.ts (ts, level, event, traceId = this run). Why not import it: these
// run on plain node, which cannot load the .ts logger (AGENTS.md: .ts runs through tsx).
const traceId = crypto.randomUUID();
const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event, traceId, ...fields }));

/** The cut, in order. Each id is a section one of the sessions below films into WORK/<id>/. */
const EDIT = CUT.edit;
/** Whether the cut has a section (the sessions skip the shots of sections it leaves out). */
const has = (id) => EDIT.includes(id);

// What the browser remembers before the game loads: 画質 最高 (the presets' own values, so the
// preset reads 最高), the cut's language, both mirror charms, and the one-time tips already seen.
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
  "tod.lang": CUT.lang,
  "tod.charmTip": "1",
  "tod.tvNotice": "1",
  "tod.controls": JSON.stringify({ layout: "wasd", assist: "easy", charm: "both", seatModel: 2 }),
};
/**
 * The gamepads the page sees: none until a shot plugs one in (window.__pads). Why: Chrome hands a
 * headless page the controllers connected to the machine, and one picked up there would steer the
 * car or change the HUD's key hints mid-take.
 */
const PADS = `window.__pads = []; Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });`;
const PRELOAD = `(() => { const s = ${JSON.stringify(STORAGE)};
  try { for (const k in s) localStorage.setItem(k, s[k]); } catch {} })(); (${installClock})();${CUT.pads ? PADS : ""}`;

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
    await b.evaluate(`(${stage})(${JSON.stringify(CUT.cards)})`);
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
    /** The section's caption from the cut (cuts.mjs), if it has one; `seconds` places a negative out. */
    caption: async (id, seconds) => {
      const cap = CUT.captions[id];
      if (!cap) return;
      const [main, sub, timing = {}] = cap;
      const out = typeof timing.out === "number" && timing.out < 0 ? seconds + timing.out : timing.out;
      await b.evaluate(`window.__tz.caption(${JSON.stringify(main)}, ${JSON.stringify(sub)},
        ${JSON.stringify({ ...timing, out: out ?? null })})`);
    },
    /**
     * Film a section: `seconds` of frames (or the cut's own length for it) into WORK/<id>/, under
     * the cut's caption for it, with `events` ([seconds, js]) run as the shot reaches them. Two
     * unfilmed frames first, so a cut's camera jump is not smeared by the motion blur. A section
     * the cut leaves out is not filmed.
     */
    film: async (id, shotSeconds, events = []) => {
      if (!has(id)) return;
      const seconds = CUT.seconds[id] ?? shotSeconds;
      await s.caption(id, seconds);
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

/**
 * Run one session's shots unless --only leaves it out, or the cut has none of its `sections` (when
 * given); the page is closed whatever happens.
 */
async function run(name, options, shots) {
  if (ONLY && !ONLY.has(name)) return;
  if (options.sections && !options.sections.some(has)) return;
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
  const target = { id: -77, category: 'landmark', name: ${JSON.stringify(CUT.station)}, ward: '千代田区', source: -77,
    lat: ${STATION_FRONT.lat}, lon: ${STATION_FRONT.lon} };
  G.missions.current = { target, startedAt: performance.now(), timeLimit: Infinity, isTrip: true,
    startDistance: Math.hypot((target.lat - here.lat) * 111000, (target.lon - here.lon) * 90000) }; return true; })()`;
/** The title screen's language button. */
const lang = (code) => `document.querySelector('[data-lang="${code}"]').click()`;
/** 設定 › 画質 › プリセット chosen as by hand. */
const preset = (p) => `(() => { const el = document.querySelector('#opt-graphics-preset'); el.value = '${p}';
  el.dispatchEvent(new Event('change')); })()`;
/** One item of 設定 › 画質 set as by hand (it applies at once unless it sizes what is loaded). */
const graphic = (
  key,
  value,
) => `(() => { const el = document.querySelector('select[data-graphics="${key}"]'); el.value = '${value}';
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

// ---- page-side snippets of the English cut ----
/** 東京タワー and 東京スカイツリー (public/data/landmarks.json). */
const TOWER = { lat: 35.658592, lon: 139.74545 };
const SKYTREE = { lat: 35.7100392, lon: 139.810708 };
/** A generic gamepad plugged in (standard mapping, two-motor rumble): no maker's name on screen. */
const plugPad = `(() => { const btn = () => ({ pressed: false, touched: false, value: 0 });
  window.__pad = { id: 'Gamepad (STANDARD GAMEPAD Vendor: 1234 Product: 5678)', index: 0, connected: true, mapping: 'standard',
    timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn),
    vibrationActuator: { type: 'dual-rumble', playEffect: () => Promise.resolve('complete'), reset: () => Promise.resolve('complete') } };
  window.__pads = [window.__pad];
  window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: window.__pad })); })()`;
/** One of the pad's buttons pressed or let go. */
const padButton = (
  i,
  down,
) => `(() => { const b = window.__pad.buttons[${i}]; b.pressed = ${down}; b.value = ${down ? 1 : 0};
  window.__pad.timestamp++; })()`;
/** The binding of the horn (LS by default) clicked, to take the next button pressed. */
const bindHorn = `[...document.querySelectorAll('#pad-settings button.pad-bind')].find((b) => b.textContent.trim() === 'LS')?.click()`;
/**
 * The settings' lines that name a maker's controller (the WebHID one) hidden, every frame (the
 * controller section is drawn anew as the pad's state changes): the movie names no brands.
 */
const hideBrands = `window.__tz.hooks.set('brands', () => {
  for (const n of document.querySelectorAll('#settings p, #settings button, #settings label, #settings span, #settings div')) {
    const own = [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('');
    if (/Pro Controller|Nintendo/.test(own)) n.style.display = 'none';
  } })`;
/**
 * A camera at `eye` looking at `to` ([lat, lon, metres over the ground or water]), placed anew each
 * frame from the coordinates: a car moved over 1.5 km re-anchors the local frame (RECENTER_DISTANCE),
 * and points taken before it are then somewhere else. `move` places it for shot time (cam, c, v).
 */
const geoCamera = (eye, to, move) => `window.__tz.camera((cam, c) => { const G = c.G; const f = G.getFrame();
  const at = (lat, lon, h) => { const p = f.toLocal(lat, lon, f.origin.h); p.y = (G.water.surfaceUnder(p.x, p.z) ?? G.groundY(p.x, p.z) ?? 0) + h; return p; };
  const v = { eye: at(${eye.join(", ")}), to: at(${to.join(", ")}) }; ${move} })`;
/**
 * The car brought near `lat, lon` (the nearest street within 300 m, else the ground there), so the
 * city is loaded around a far camera there: buildings and terrain follow the player, not the camera.
 */
const bringCar = (
  lat,
  lon,
) => `(() => { const G = window.__game; const f = G.getFrame(); const q = f.toLocal(${lat}, ${lon}, f.origin.h);
  const hit = G.getRoadGraph()?.nearest(q, 300, (seg) => seg.line.kind !== 'highway'); let p = q; let yaw = G.vehicle.yaw();
  if (hit) { const { pos, dir } = G.getRoadGraph().sample(hit.seg, hit.s); p = pos; yaw = Math.atan2(dir.x, dir.z); }
  p.y = (G.groundY(p.x, p.z) ?? 0) + 0.9; G.vehicle.teleport(p, yaw); G.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  return hit ? 'street' : 'ground'; })()`;
/** The destination search's box, typed into as by hand. */
const typeQuery = (
  text,
) => `(() => { const q = document.querySelector('#dest-query'); q.value = ${JSON.stringify(text)};
  q.dispatchEvent(new Event('input')); })()`;
/** A result of the destination search picked by its name. */
const pickResult = (name) =>
  `[...document.querySelectorAll('#dest-results button')].find((b) => b.firstChild?.textContent === ${JSON.stringify(name)})?.click()`;
/**
 * The roadside stop's window conversation answered as a driver who agrees (the replay of the moment
 * is not watched), a choice every third of a second, until the ticket is open, the step `holdAt` is
 * up, or `done` (page-side) is true.
 */
const answerStop = async (s, holdAt, done = "document.querySelector('#ticket-dialog').open") => {
  for (let i = 0; i < 90; i++) {
    const r = await s.ev(`(() => { if (${done}) return 'done';
      const dlg = document.querySelector('#stop-dialogue'); const step = window.__game.debug.pursuit.state().stop?.step;
      const ok = ['openWindow', 'showLicence', 'seen', 'agree', 'next', 'thanks', 'understood'];
      const b = dlg && !dlg.hidden ? [...dlg.querySelectorAll('.stop-choices button')].find((x) => ok.includes(x.dataset.choice) && !x.disabled) : null;
      if (!b) return 'wait'; if (step === ${JSON.stringify(holdAt)}) return 'held'; b.click(); return step; })()`);
    if (r === "done" || r === "held") return r;
    await s.pump(10);
  }
  return "timeout";
};
/** One of the phone call's quick replies. */
const quick = (i) => `document.querySelectorAll('#call-quick button')[${i}]?.click()`;
/** The car on the fixed camera's road (window.__orb), `ahead` m past it in its inner lane, at `ms` m/s. */
const alongOrbis = (
  ahead,
  ms,
) => `(() => { const G = window.__game; const o = window.__orb = G.orbis.sites.filter((x) => !x.expressway)[0];
  const t = o.travel; const lat = o.kerb - 1.5 * o.laneWidth;
  const p = o.line.clone().addScaledVector(t, ${ahead}); p.x += t.z * lat; p.z += -t.x * lat; p.y = G.groundY(p.x, p.z) + 0.9;
  G.vehicle.teleport(p, Math.atan2(t.x, t.z)); G.vehicle.body.setLinvel({ x: t.x * ${ms}, y: 0, z: t.z * ${ms} }, true); })()`;
/**
 * The car put `back` m before the nearest 止まれ line (on a street over 60 m long) at 25 km/h, braking
 * 8 m before it to stop short of it; window.__stoppedAt is when it stood still.
 */
const toStopLine = (back) => `(() => { const G = window.__game; const car = G.vehicle.position();
  const o = G.control.approaches.filter((a) => a.kind === 'stop' && a.seg && a.seg.length > 60)
    .map((a) => ({ a, mid: a.a.clone().add(a.b).multiplyScalar(0.5) })).sort((x, y) => x.mid.distanceTo(car) - y.mid.distanceTo(car))[0];
  if (!o) return null; window.__stop = o; window.__stoppedAt = null; const t = o.a.travel; const lat = o.a.seg.line.width / 4;
  const p = o.mid.clone().addScaledVector(t, -${back}); p.x += t.z * lat; p.z += -t.x * lat; p.y = G.groundY(p.x, p.z) + 0.9;
  G.vehicle.teleport(p, Math.atan2(t.x, t.z)); G.vehicle.body.setLinvel({ x: t.x * 7, y: 0, z: t.z * 7 }, true);
  window.__tz.drive(25); let isBraking = false;
  window.__tz.hooks.set('stopline', () => { const c = G.vehicle.position();
    const d = (o.mid.x - c.x) * t.x + (o.mid.z - c.z) * t.z;
    if (!isBraking && d < 8) { isBraking = true; window.__tz.drive(null); window.__tz.key('KeyS', true); }
    if (isBraking && !window.__stoppedAt && G.vehicle.speedKmh() < 0.3) { window.__stoppedAt = performance.now(); window.__tz.key('KeyS', false); } });
  return { d: Math.round(o.mid.distanceTo(car)), width: o.a.seg.line.width }; })()`;
/** The speed cameras that fired so far. */
const fired = "JSON.stringify(window.__game.debug.logs.query({ event: /^orbis_fired$/ }).map((l) => l.kind))";
/**
 * The car put `back` m before the nearest speed camera of a kind (fixed: not on an expressway), in a
 * lane it watches, at `over` km/h above the speed it takes a picture at, held there. Every other
 * violation is held off (law.cooldown answers "not yet" for all but speeding) so the camera's own
 * 速度超過 is the one stamp; `delete G.law.cooldown.get` gives them back. Started under 3 s from the
 * camera, so the ordinary speeding check (3 s over the limit) does not book it first.
 */
const throughOrbis = (
  kind,
  back,
  over,
) => `(() => { const G = window.__game; const car = G.vehicle.position();
  const list = ${kind === "fixed" ? "G.orbis.sites.filter((o) => !o.expressway)" : "G.orbis.portable"};
  const o = list.toSorted((a, b) => a.line.distanceTo(car) - b.line.distanceTo(car))[0]; if (!o) return null; window.__orb = o;
  // A clear road (no traffic car to slow behind) and no stamp left from the shot before.
  const T = G.traffic; for (let i = T.cars.length - 1; i >= 0; i--) if (T.cars[i].object.position.distanceTo(o.line) < 110) { T.remove(T.cars[i]); T.cars.splice(i, 1); }
  for (const el of document.querySelectorAll('#stamps > *')) el.remove();
  const cd = G.law.cooldown; cd.get = (k) => (k === 'speed' ? Map.prototype.get.call(cd, k) : Infinity); cd.delete('speed');
  const lat = o.kerb - ${kind === "fixed" ? 1.5 : 0.5} * o.laneWidth; const t = o.travel;
  const p = o.line.clone().addScaledVector(t, -${back}); p.x += t.z * lat; p.z += -t.x * lat; p.y = G.groundY(p.x, p.z) + 0.9;
  const kmh = o.limit + o.threshold + ${over};
  G.vehicle.teleport(p, Math.atan2(t.x, t.z)); G.vehicle.body.setLinvel({ x: (t.x * kmh) / 3.6, y: 0, z: (t.z * kmh) / 3.6 }, true);
  window.__tz.drive(kmh); return { kind: o.kind, limit: o.limit, kmh, d: Math.round(o.line.distanceTo(car)) }; })()`;

// ---- 東京駅 丸の内, a rainy night: the title screen, the opening, the title, 画質, the end ----
await run("night", { time: "night", weather: "rain" }, async (s) => {
  // The title screen's language switch, before the start.
  await s.sky();
  await s.ev("window.__tz.hud('none')");
  await s.pump(20);
  // The English cut closer in, on the title and the language buttons.
  if (!isJa)
    await s.ev("window.__tz.zoom([{ t: 0, sel: 'body', fx: 0.65, fy: 0.33, s: 1.45 }], { edges: true })");
  await s.film("lang", 2.5, [
    // No caption of its own: the one before it in the cut goes (the English cut carries its own).
    ...(CUT.captions.lang ? [] : [[0, "window.__tz.caption(null)"]]),
    [0.55, lang(CUT.langs[0])],
    [1.2, lang(CUT.langs[1])],
    [1.85, lang(CUT.langs[2])],
  ]);
  if (!isJa) await s.ev("window.__tz.zoom(null)");
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
  if (isJa)
    await s.ev(
      `window.__tz.zoom([{ t: 0 }, { t: 0.8, sel: '.graphics-options', fx: 0.4, fy: 0.3, s: 1.35 }])`,
    );
  else {
    await s.ev(hideBrands);
    await s.ev(
      `window.__tz.zoom([{ t: 0 }, { t: 0.8, sel: '.graphics-options', fx: 0.5, fy: 0.3, s: 1.3 }], { edges: true })`,
    );
  }
  await s.film("gfx", 2.8, [
    [0.9, preset("high")],
    [1.5, preset("medium")],
    [2.1, preset("low")],
  ]);
  // Back to 最高 for the shots after it (only the English cut films any).
  if (!isJa) await s.ev(preset("ultra"));
  if (has("pad")) {
    // 設定 › コントローラー with a gamepad plugged in: the gyro and the rumble panels up close, then down
    // to the bindings as the horn is rebound by pressing a button on the pad.
    await s.ev("window.__tz.zoom(null)");
    await s.ev(plugPad);
    await s.pump(10);
    // The three panels (feel, gyro, rumble) at the top of the dialog, then scrolled down to the
    // bindings as one is pressed.
    await s.ev(`(() => { const d = document.querySelector('#settings'); const box = document.querySelector('#pad-settings');
      box.querySelector('.pad-panels').scrollIntoView({ block: 'start' }); d.scrollTop -= 40; const top = d.scrollTop;
      const down = box.querySelector('.pad-bindings').getBoundingClientRect().top - 330;
      window.__tz.hooks.set('pin', (t) => { const k = Math.min(1, Math.max(0, (t - 1.2) / 0.7));
        d.scrollTop = top + k * k * (3 - 2 * k) * down; }); window.__tz.raise(); })()`);
    await s.pump(3);
    await s.ev(`window.__tz.zoom([{ t: 0, sel: '#settings', fx: 0.5, fy: 0.42, s: 1.22 }], { edges: true })`);
    await s.film("pad", 3.2, [
      [1.95, bindHorn],
      [2.45, padButton(3, true)],
      [2.6, padButton(3, false)],
    ]);
    await s.ev("window.__tz.zoom(null); window.__tz.hooks.delete('pin')");
  }
  if (has("tower")) {
    // 東京タワー lit up, from 90 m over 芝公園's neighbourhood 1.5 km off, the rain stopped; the car
    // brought there first so the city around is loaded.
    await s.ev(
      "document.querySelector('#settings').close(); window.__tz.caption(null); window.__tz.hooks.delete('brands')",
    );
    log("tower", { car: await s.ev(bringCar(35.6655, 139.7585)) });
    await s.ev(`(() => { const G = window.__game; document.querySelector('[data-weather="clear"]').click();
      G.env.wetness = G.env.overcast = 0; })()`);
    await s.pump(30);
    await s.ev(
      geoCamera(
        [35.666, 139.759, 90],
        [TOWER.lat, TOWER.lon, 120],
        "cam.position.copy(v.eye).lerp(v.to, c.k * 0.05); cam.lookAt(v.to.x, v.to.y + c.k * 6, v.to.z); cam.fov = 40;",
      ),
    );
    await s.pump(240);
    await s.film("tower", 2.5);
  }
});

// ---- 大手町, by day: the navi, the towers, a guide sign (and the search, the autopilot, on foot) ----
await run("ote", { start: "35.68530,139.76315", time: "day", weather: "clear" }, async (s) => {
  await begin(s);
  await s.ev(quietWorld);
  await s.ev("window.__tz.hud('drive')");
  await s.pump(30);
  // The navi panel up close: the junction's own picture, its name, the lanes, the road and limit.
  await s.key("KeyJ");
  await s.ev(
    `window.__tz.zoom([{ t: 0 }, { t: 1.1, sel: '#nav', fx: 0.5, fy: 0.5, s: 1.9 }]${isJa ? "" : ", { edges: true }"})`,
  );
  await s.film("navi", 4.5);
  await s.ev("window.__tz.zoom(null); window.__tz.caption(null); window.__tz.hud('none')");
  await s.ev(capAutopilot(8));
  await s.until("window.__game.vehicle.speedKmh() > 15", 300);
  // The cockpit view hides the car's body: the outside shots of the English cut use the chase view's.
  if (!isJa) for (const _ of [1, 2, 3]) await s.key("KeyC");
  // PLATEAU's towers from low beside the car.
  await s.ev(`window.__tz.camera((cam, c) => {
    const back = 7 - c.k * 1.5;
    cam.position.set(c.car.x - c.fwd.x * back + c.left.x * 2.6, c.car.y - 0.25, c.car.z - c.fwd.z * back + c.left.z * 2.6);
    cam.lookAt(c.car.x + c.fwd.x * 12, c.car.y + 5.5, c.car.z + c.fwd.z * 12); cam.fov = 64; })`);
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
  await s.film("sign", 2);
  if (has("autopilot")) {
    // The car on its own, from behind and above, the autopilot's chip and the navi on screen.
    await s.ev("window.__tz.hud('auto')");
    await s.ev(`window.__tz.camera((cam, c) => { const back = 10 - c.k * 2;
      cam.position.set(c.car.x - c.fwd.x * back + c.left.x * 1.5, c.car.y + 3.6 - c.k * 0.8, c.car.z - c.fwd.z * back + c.left.z * 1.5);
      cam.lookAt(c.car.x + c.fwd.x * 14, c.car.y + 0.6, c.car.z + c.fwd.z * 14); cam.fov = 55; })`);
    await s.pump(3);
    await s.film("autopilot", 3.5);
  }
  if (has("search")) {
    // The destination search (N): the landmarks typed by name, picked, and the navi sets off there.
    await s.ev("window.__tz.camera(null); window.__tz.caption(null); window.__tz.hud('talk')");
    await s.key("KeyC");
    await s.pump(3);
    await s.key("KeyN");
    await s.pump(6);
    // The dialog's top held where it is (centred, it would move as the list grows and shrinks).
    await s.ev(`(() => { const d = document.querySelector('#dest-query').closest('dialog'); const top = d.getBoundingClientRect().top;
      d.style.margin = top + 'px auto auto'; window.__tz.raise(); })()`);
    await s.pump(2);
    await s.ev(
      `window.__tz.zoom([{ t: 0, sel: '#dest-query', fx: 0.5, fy: 4.5, s: 1.35 }], { edges: true })`,
    );
    await s.film("search", 3, [
      ...[..."Tokyo Tower"].map((_, i) => [0.35 + i * 0.09, typeQuery("Tokyo Tower".slice(0, i + 1))]),
      [2.2, pickResult("Tokyo Tower")],
      [2.25, "window.__tz.zoom(null)"],
    ]);
  }
  if (has("walk")) {
    // On foot among the towers: out of the car (Q), walking up the pavement and looking up.
    await s.ev("window.__tz.zoom(null); window.__tz.caption(null); window.__tz.hud('foot')");
    if (await s.ev("Boolean(window.__game.getAutopilot())")) await s.key("KeyJ");
    await s.hold("KeyS", true);
    await s.until("window.__game.vehicle.speedKmh() < 0.5", 300);
    await s.hold("KeyS", false);
    await s.key("KeyQ");
    await s.pump(20);
    log("on_foot", { mode: await s.ev("window.__game.getMode()") });
    await s.ev(`(() => { const G = window.__game; const w = G.walker; w.camYaw = w.heading; })()`);
    await s.ev(`window.__tz.hooks.set('look', (t, len) => { const k = Math.min(1, Math.max(0, (t - 0.6) / (len - 0.8)));
      window.__game.walker.camPitch = 1.05 * k * k * (3 - 2 * k); })`);
    // Looking up into the sun: no lens flare (its probe shows as a black square on the sun, and the
    // walker's own camera is not one tz.coverSun follows).
    await s.ev(graphic("lensFlare", "off"));
    await s.hold("KeyW", true);
    await s.film("walk", 3);
    await s.hold("KeyW", false);
    await s.ev(graphic("lensFlare", "on"));
    await s.ev("window.__tz.hooks.delete('look'); window.__game.walker.camPitch = 0.12");
  }
  if (has("talk")) {
    // A word with someone on the pavement (E): the set replies the game gives without the AI model.
    log("talk", {
      to: await s.ev(`(() => { const G = window.__game; const w = G.walker.position();
      const ped = G.pedestrians.nearest(w, 120); if (!ped) return null; const p = ped.object.position;
      const d = p.clone().sub(w).setY(0).normalize(); const at = p.clone().addScaledVector(d, -1.6);
      at.y = G.groundY(at.x, at.z) ?? at.y; G.walker.enter(at, Math.atan2(d.x, d.z));
      G.walker.camYaw = Math.atan2(d.x, d.z) + 0.5; return ped.profile.name; })()`),
    });
    await s.pump(10);
    await s.key("KeyE");
    await s.pump(10);
    await s.ev("document.querySelector('#ai-enable')?.style.setProperty('display', 'none', 'important')");
    log("chat", { open: await s.ev("!document.querySelector('#chat').hidden") });
    await s.ev(
      `window.__tz.zoom([{ t: 0 }, { t: 0.8, sel: '#chat', fx: 0.5, fy: 0.45, s: 1.3 }], { edges: true })`,
    );
    await s.film("talk", 3.5, [[0.9, "document.querySelector('#chat-quick button')?.click()"]]);
    await s.ev("window.__tz.zoom(null)");
  }
});

// ---- 丸の内, by day: the law, Y, the cabin, the robotaxi ----
await run("day", { time: "day", weather: "clear" }, async (s) => {
  await begin(s);
  await s.ev(quietWorld);
  // The English cut keeps the notices up: they name the violation in English (the stamp is a seal
  // in Japanese in every language).
  await s.ev(`window.__tz.hud('${isJa ? "talk" : "law"}')`);
  // Where the street starts (for the braking shot later).
  await s.ev("window.__home = { at: window.__game.vehicle.position(), yaw: window.__game.vehicle.yaw() }");
  // Red-light running, staged at the light ahead: a patrol car on patrol is put behind, and the car
  // is set rolling at 40 km/h as the light turns yellow, to reach the stop line a second after red.
  // (Looked for again while the roads around are still being laid out: once it found none.)
  await s.until(`${findSignal(200)} !== null`, 600, 15);
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
  await s.film("red", 4);
  const caught = await s.ev(
    "JSON.stringify({ log: window.__game.law.state.log.map((r) => r.kind), police: window.__game.getPolice()?.state })",
  );
  log("caught", JSON.parse(caught));
  // The English cut keeps the case to the red light: nothing else the staged drive does (the kerb
  // side it pulls in on) is booked from here (law.cooldown answers "not yet").
  if (!isJa) await s.ev("(() => { const cd = window.__game.law.cooldown; cd.get = () => Infinity; })()");
  // Behind the patrol car: its beacons, and the car it is after ahead of it. Slower now, so it closes.
  await s.ev("window.__tz.drive(26)");
  await s.ev(`window.__tz.camera((cam, c) => { const u = c.G.getPolice(); const p = u?.position ?? c.car;
    const y = u ? u.car.yaw() : c.yaw; const f = { x: Math.sin(y), z: Math.cos(y) };
    cam.position.set(p.x - f.x * (7.5 - c.k * 1.5) + f.z * 1.2, p.y + 2.1, p.z - f.z * (7.5 - c.k * 1.5) - f.x * 1.2);
    cam.lookAt(p.x + f.x * 14, p.y + 0.9, p.z + f.z * 14); cam.fov = 55; })`);
  await s.film("chase", 3);
  // Pulled over on the left: the patrol car stops behind, the officer walks up to the window and
  // talks the driver through it (answered here as a driver who agrees), then writes the ticket.
  await s.ev("window.__tz.drive(null); window.__tz.camera(null); window.__tz.caption(null)");
  await s.hold("KeyS", true);
  await s.until("window.__game.vehicle.speedKmh() < 0.5", 300);
  await s.hold("KeyS", false);
  const isTicket = "document.querySelector('#ticket-dialog').open";
  const isStop = "Boolean(window.__game.debug.pursuit.state().stop)";
  if (!(await s.until(`${isStop} || ${isTicket}`, 1200))) {
    // Held up at the light: the patrol car is brought up behind (it stops within 22 m to write it).
    await s.ev(`(() => { const G = window.__game; const u = G.getPolice(); if (!u) return; const y = G.vehicle.yaw();
      const p = G.vehicle.position().addScaledVector({ x: Math.sin(y), y: 0, z: Math.cos(y) }, -9); p.y = (G.groundY(p.x, p.z) ?? p.y) + 0.86;
      u.car.teleport(p, y); u.car.syncVisuals(); u.driver.place(p, y); })()`);
    await s.until(`${isStop} || ${isTicket}`, 600);
  }
  // The English cut stops at the officer's line naming the offence and its article, to film it.
  await answerStop(s, has("stop") ? "offence" : null);
  if (has("stop")) {
    await s.pump(12);
    await s.ev(`window.__tz.zoom([{ t: 0, sel: '#stop-dialogue', fx: 0.5, fy: 0.5, s: 1.2 },
      { t: 2.5, sel: '#stop-dialogue', fx: 0.5, fy: 0.5, s: 1.3 }], { edges: true })`);
    await s.film("stop", 2.5);
    await s.ev("window.__tz.zoom(null)");
    await answerStop(s, null);
  }
  log("ticket", { open: await s.ev(isTicket) });
  await s.pump(10);
  await s.ev("window.__tz.raise(); window.__tz.hud('drive')");
  // The ticket: whole, then its top (who, what, where), then the fine and the points.
  // Kept to the right of the frame (the caption is at the lower left). The English cut reads its
  // summary in English first (the form itself stays Japanese, as the real one), then the form.
  if (isJa)
    await s.ev(`window.__tz.zoom([{ t: 0 }, ${form(0.9, 0.3)}, ${form(2.4, 0.3)}, ${form(3.3, 0.74)}])`);
  else {
    // The summary in English up close (what, the article, the points and the fine), then the form
    // scrolled up to its own lines of the same (信号無視, 2 点, ¥9,000).
    await s.ev("document.querySelector('#ticket-dialog').scrollTop = 0");
    await s.ev(`window.__tz.zoom([{ t: 0 }, { t: 0.7, sel: '.ticket-summary', fx: 0.5, fy: 0.45, s: 1.5 },
      { t: 3.3, sel: '.ticket-summary', fx: 0.5, fy: 0.45, s: 1.5 }, { t: 4.1, sel: '.ticket-summary', fx: 0.5, fy: 1.7, s: 1.3 }],
      { edges: true })`);
    await s.ev(`window.__tz.hooks.set('scroll', (t) => { const k = Math.min(1, Math.max(0, (t - 3.3) / 0.9));
      document.querySelector('#ticket-dialog').scrollTop = k * k * (3 - 2 * k) * 520; })`);
  }
  await s.film("ticket", 4.5);
  await s.ev("window.__tz.hooks.delete('scroll')");
  await s.ev(
    "window.__tz.zoom(null); window.__tz.caption(null); document.querySelector('#ticket-accept').click()",
  );
  await s.pump(20);
  // 「ありがとうございました」 to the officer's farewell; the patrol car leaves.
  await answerStop(s, null, "!window.__game.debug.pursuit.state().stop");
  // Y: someone saw it. The game's own post if a witness made one, else one of theirs now. The
  // English cut wants the red light's (not the passer-by's post of the car pulled over, which the
  // game also makes now).
  await s.ev(`(() => { const G = window.__game; const isRed = (p) => p.record?.kind === 'signal' && p.media !== 'text';
    if (${isJa ? "G.social.posts.length" : "G.social.posts.some(isRed)"}) return;
    const r = G.law.state.log.find((x) => x.kind === 'signal') ?? G.law.state.log[0]; if (!r) return;
    for (let i = 0; i < 40 && !G.social.posts.some(${isJa ? "(p) => p.media !== 'text'" : "isRed"}); i++) G.social.maybePost(r, 12, G.debug.gameNow()); })()`);
  await s.pump(150);
  await s.key("KeyF");
  await s.pump(5);
  await s.ev("document.querySelector('#social-open').click()");
  await s.pump(5);
  // The witness's own post (not a quote of it, once there are some).
  await s.ev(`(() => { const G = window.__game; const post = ${isJa ? "" : "G.social.posts.find((p) => p.record?.kind === 'signal' && p.media !== 'text') ??"}
      G.social.posts.find((p) => p.media !== 'text') ?? G.social.posts[0];
    if (!post) return; const row = [...document.querySelectorAll('#social-app article.social-post')].find((a) => ${isJa ? "" : "!a.querySelector('.sns-quote') && "}a.textContent.includes(post.text.slice(0, 12)));
    row?.click(); })()`);
  await s.pump(5);
  await s.key("KeyF", true);
  await s.pump(10);
  if (isJa) {
    // Replies come at a person's pace (one every 8 s): the shot runs the clock 6 times as fast.
    await s.ev(`window.__tz.hooks.set('fast', () => { window.__game.env.gameMs += 10000; })`);
    await s.ev(`window.__tz.zoom([{ t: 0 }, { t: 1.0, sel: '#phone', fx: 0.5, fy: 0.5, s: 1.22 }])`);
    // The post, then down to the replies under it as they come.
    await s.ev(`window.__tz.hooks.set('scroll', (t) => { const page = document.querySelector('#phone-social .sns-page:last-child');
      if (!page) return; const k = Math.min(1, Math.max(0, (t - 2.2) / 1.1)); page.scrollTop = k * k * (3 - 2 * k) * 230; })`);
    await s.film("y", 5.5);
  } else {
    // The post catching fire: the clock 24 times as fast, so the views, reposts and quotes count up
    // and the replies pile in; down from the video to the counts, then into the replies. The clock
    // is put back after (the shots after it are by day).
    await s.ev("window.__dayMs = window.__game.env.gameMs");
    await s.ev(`window.__tz.hooks.set('fast', () => { window.__game.env.gameMs += 40000; })`);
    await s.ev(`window.__tz.zoom([{ t: 0, sel: '#phone', fx: 0.5, fy: 0.5, s: 1.2 }], { edges: true })`);
    await s.ev(`window.__tz.hooks.set('scroll', (t) => { const page = document.querySelector('#phone-social .sns-page:last-child');
      if (!page) return; const e = (a, b) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
      page.scrollTop = e(1.0, 2.0) * 330 + e(3.0, 4.8) * 520; })`);
    await s.film("y", 5);
    // Its engagements: the quote reposts, one under another.
    await s.ev("document.querySelector('#phone-social .sns-page:last-child .sns-linkrow')?.click()");
    await s.pump(4);
    await s.ev(`window.__tz.hooks.set('scroll', (t) => { const page = document.querySelector('#phone-social .sns-page:last-child');
      if (!page) return; const k = Math.min(1, Math.max(0, (t - 0.9) / 2.4)); page.scrollTop = k * k * (3 - 2 * k) * 560; })`);
    await s.film("y-quotes", 3.5);
  }
  await s.ev(
    "window.__tz.hooks.delete('fast'); window.__tz.hooks.delete('scroll'); window.__tz.zoom(null); window.__tz.caption(null)",
  );
  if (!isJa) await s.ev("window.__game.env.gameMs = window.__dayMs + 2 * 60000");
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
  await s.film("tv", 3);
  if (has("look")) {
    // A look around the cabin from the driver's seat: the door side across to the passenger's.
    await s.ev("window.__tz.camera(null)");
    await s.pump(2);
    await s.ev("window.__tz.seat(-0.95, 0.02, 66, { yaw: 1.05, pitch: -0.04, fov: 66 })");
    await s.film("look", 2.2);
  }
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
  await s.film("taxi-come", 2.5);
  await s.until("window.__game.getTaxi()?.state === 'waiting'", 1200);
  // Once in three takes it stopped short of its caller and never reported arriving (it would not
  // let anyone in): it is told it has arrived where it stands.
  log("taxi", {
    state:
      await s.ev(`(() => { const t = window.__game.getTaxi(); if (t?.state === 'coming') { t.state = 'waiting'; return 'forced'; }
      return t?.state ?? null; })()`),
  });
  // Up to its kerb-side door, and in (Q).
  await s.ev(`(() => { const G = window.__game; const t = G.getTaxi(); const y = t.car.yaw();
    const at = t.position.clone().add({ x: Math.cos(y) * 1.9, y: 0, z: -Math.sin(y) * 1.9 }); at.y = G.groundY(at.x, at.z) ?? at.y - 0.8;
    G.walker.enter(at, y); })()`);
  // To the nearest station in the app's list (a far one may lie beyond the roads loaded).
  log("taxi", {
    to: await s.ev(`(() => { const sel = document.querySelector('#taxi-dest');
    const o = [...sel.options].find((x) => x.textContent.includes(${JSON.stringify(CUT.taxiStation)})); if (o) sel.value = o.value; return o?.textContent ?? null; })()`),
  });
  await s.pump(3);
  await s.key("KeyQ");
  log("taxi", { mode: await s.ev("window.__game.getMode()") });
  await s.ev("window.__tz.hud('drive')");
  await s.ev(`window.__tz.camera((cam, c) => { const t = c.G.getTaxi(); if (!t) return; const p = t.position; const y = t.car.yaw();
    const f = { x: Math.sin(y), z: Math.cos(y) }; cam.position.set(p.x - f.x * 8 + f.z * 1.5, p.y + 2.6, p.z - f.z * 8 - f.x * 1.5);
    cam.lookAt(p.x + f.x * 8, p.y + 0.8, p.z + f.z * 8); cam.fov = 55; })`);
  await s.pump(20);
  await s.film("taxi-ride", 2);
});

// ---- 両国, the Sumida at dusk: the river, the sun, dusk into night (the Skytree, the rain) ----
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
  await s.film("flare", 2.5);
  // Dusk into night in 3.5 s: 90 minutes, the street lights coming on and the windows lighting up.
  await s.ev(`window.__tz.hooks.set('lapse', () => { window.__game.env.gameMs += 49400; })`);
  await s.ev(`window.__tz.camera((cam, c) => { const r = window.__sunset; const a = -0.02 + c.k * 0.14;
    const l = { x: r.look.x * Math.cos(a) - r.look.z * Math.sin(a), z: r.look.x * Math.sin(a) + r.look.z * Math.cos(a) };
    cam.position.copy(r.from); cam.position.y += c.k * 4;
    cam.lookAt(r.from.x + l.x * 100, r.from.y + (r.look.y - 0.04) * 100, r.from.z + l.z * 100); cam.fov = 58; })`);
  await s.film("lapse", 3.5);
  await s.ev("window.__tz.hooks.delete('lapse'); window.__tz.coverSun(false); window.__tz.caption(null)");
  if (has("skytree")) {
    // 東京スカイツリー lit up, from 20 m over the Sumida by 吾妻橋, 1.1 km off, at night (the lights come
    // on after dusk); the car brought to the bank first, as the city is loaded around the player.
    // (From the 浅草 bank's 14 m the camera stood inside a building.)
    await s.ev("document.querySelector('[data-time=\"night\"]').click()");
    log("skytree", { car: await s.ev(bringCar(35.7098, 139.7975)) });
    await s.pump(30);
    await s.ev(
      geoCamera(
        [35.711, 139.7992, 20],
        [SKYTREE.lat, SKYTREE.lon, 300],
        "cam.position.copy(v.eye).lerp(v.to, c.k * 0.02); cam.lookAt(v.to.x, v.to.y - 40 + c.k * 20, v.to.z); cam.fov = 46;",
      ),
    );
    await s.pump(150);
    await s.film("skytree", 2.5);
  }
  if (has("rain")) {
    // The rain comes, from the driver's seat: the weather picked in the HUD, the drops on the glass,
    // the wipers on. The game turns the sky over in minutes: here in two seconds.
    await s.ev("window.__tz.camera(null); window.__tz.hud('sky')");
    await s.pump(30);
    await s.film("rain", 3, [
      [0.5, "document.querySelector('[data-weather=\"rain\"]').click()"],
      [
        0.55,
        `window.__tz.hooks.set('rain', () => { const e = window.__game.env;
          e.overcast = Math.min(1, e.overcast + 0.03); e.wetness = Math.min(1, e.wetness + 0.03); })`,
      ],
      [1.6, "window.__tz.key('Tab'); window.__tz.key('Tab'); window.__tz.key('Tab')"],
    ]);
    await s.ev("window.__tz.hooks.delete('rain')");
  }
});

// ---- 第一京浜, 品川区, by day: the speed cameras, a pursuit the car flees (the English cut) ----
await run(
  "orbis",
  { start: "35.5940,139.7363", time: "day", weather: "clear", sections: ["orbis", "portable", "flee"] },
  async (s) => {
    await begin(s);
    await s.ev(quietWorld);
    await s.ev("window.__tz.hud('outside')");
    // The chase view, for the car's body in the outside shots.
    for (const _ of [1, 2, 3]) await s.key("KeyC");
    await s.pump(30);
    // The fixed camera (a gantry over 第一京浜, 60 km/h): 98 km/h through it, seen from the middle of the
    // road past the gantry. Other violations are held off so its 速度超過 is the one stamp.
    log("orbis", { site: await s.ev(throughOrbis("fixed", 60, 8)) });
    await s.ev(`window.__tz.camera((cam, c) => { const o = window.__orb; const L = o.line; const t = o.travel;
    const gy = c.G.groundY(L.x, L.z) ?? 0;
    cam.position.set(L.x + t.x * (14 - c.k * 2) - t.z, gy + 3.2, L.z + t.z * (14 - c.k * 2) + t.x);
    cam.lookAt(L.x - t.x * 40 + t.z * 9, gy + 3.0, L.z - t.z * 40 - t.x * 9); cam.fov = 55; })`);
    await s.film("orbis", 3.5);
    log("orbis", { fired: await s.ev(fired) });
    // A portable one on a side street (where today's are put), 30 km/h: 55 km/h past its tripod.
    await s.ev("window.__tz.drive(null); window.__game.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true)");
    await s.pump(40);
    log("portable", { site: await s.ev(throughOrbis("portable", 37, 10)) });
    await s.ev(`window.__tz.camera((cam, c) => { const o = window.__orb; const L = o.line; const t = o.travel; const st = o.stand ?? L;
    const sx = st.x - L.x; const sz = st.z - L.z; const gy = c.G.groundY(L.x, L.z) ?? 0;
    cam.position.set(L.x + t.x * 7 + sx * 0.75, gy + 1.3, L.z + t.z * 7 + sz * 0.75);
    cam.lookAt(L.x - t.x * 16 - sx * 0.2, gy + 0.9, L.z - t.z * 16 - sz * 0.2); cam.fov = 58; })`);
    // A few frames on the new camera first: the motion blur still smears a far jump after two.
    await s.pump(4);
    await s.film("portable", 3);
    log("portable", { fired: await s.ev(fired) });
    if (has("flee")) {
      // Back on 第一京浜: a police motorcycle sees a red light run and calls the car over; it does not
      // stop. The chase moves up to the radio calls and the helicopter (the debug hook's fast-forward).
      await s.ev(
        "delete window.__game.law.cooldown.get; window.__tz.drive(null); window.__tz.camera(null); window.__tz.hud('pursuit')",
      );
      await s.ev(alongOrbis(30, 0));
      await s.pump(20);
      log("flee", { start: await s.ev("window.__game.debug.pursuit.start('shirobai', 'signal')") });
      // Only the flight from here: no lane or light the car crosses on the way books anything more.
      // The car waits where it is while the chase is moved on (a drive meanwhile went through the
      // junction ahead into people crossing); the hook keeps a standing car fleeing for 12 s.
      await s.ev("(() => { const cd = window.__game.law.cooldown; cd.get = () => Infinity; })()");
      await s.pump(40);
      await s.ev("window.__game.debug.pursuit.flee(30)");
      await s.pump(30);
      await s.ev("window.__game.debug.pursuit.flee(30)");
      await s.pump(60);
      log("flee", { state: await s.ev("JSON.stringify(window.__game.debug.pursuit.state())") });
      // The two put back on the straight past the gantry, the motorcycle 16 m behind, for the take.
      await s.ev(alongOrbis(24, 10));
      await s.ev(`(() => { const G = window.__game; const u = G.getPolice(); if (!u) return; const o = window.__orb; const t = o.travel;
      const lat = o.kerb - 1.5 * o.laneWidth; const p = o.line.clone().addScaledVector(t, 12); p.x += t.z * lat; p.z += -t.x * lat;
      p.y = (G.groundY(p.x, p.z) ?? p.y) + 0.86; const yaw = Math.atan2(t.x, t.z);
      u.car.teleport(p, yaw); u.car.body?.setLinvel({ x: t.x * 10, y: 0, z: t.z * 10 }, true); u.car.syncVisuals(); u.driver.place(p, yaw); })()`);
      await s.ev("window.__tz.drive(36)");
      // Behind the police motorcycle on the car's tail, looking down the road.
      await s.ev(`window.__tz.camera((cam, c) => { const u = c.G.getPolice(); const p = u?.position ?? c.car;
      const f = window.__orb.travel; const back = 6.5 - c.k * 1.5;
      cam.position.set(p.x - f.x * back + f.z * 1.2, p.y + 2.1, p.z - f.z * back - f.x * 1.2);
      cam.lookAt(p.x + f.x * 22, p.y + 1.4, p.z + f.z * 22); cam.fov = 54; })`);
      await s.pump(4);
      await s.film("flee", 4.5);
    }
  },
);

// ---- 丸の内, by day: a full stop at a stop line, the idling rule; a pedestrian hit, 119 and 110
// from the phone (the English cut) ----
await run(
  "accident",
  { time: "day", weather: "clear", sections: ["stopline", "idle", "accident", "call", "radar"] },
  async (s) => {
    await begin(s);
    await s.ev(quietWorld);
    await s.ev("window.__tz.hud('law')");
    await s.pump(60);
    await s.ev("window.__home = { at: window.__game.vehicle.position(), yaw: window.__game.vehicle.yaw() }");
    if (has("stopline")) {
      // Up to a 止まれ line at 25 km/h and a full stop just before it, from the driver's seat (the
      // HUD counts the metres down to it).
      log("stopline", { at: await s.ev(toStopLine(22)) });
      await s.pump(4);
      await s.ev("window.__tz.seat(0, -0.03, window.__game.camera.fov * 0.9)");
      await s.film("stopline", 3.5);
      log("stopline", { stopped: await s.ev("Boolean(window.__stoppedAt)") });
    }
    if (has("idle")) {
      // Twenty seconds standing with the engine on, and the game switches it off citing the
      // ordinance (東京都環境確保条例 第52条): the toast up close.
      await s.until("window.__stoppedAt && performance.now() - window.__stoppedAt > 19300", 900, 15);
      await s.ev(
        `window.__tz.zoom([{ t: 0 }, { t: 0.5, sel: '#toasts', fx: 0.5, fy: 0.15, s: 1.9 }], { edges: true })`,
      );
      await s.film("idle", 3);
      await s.ev("window.__tz.zoom(null); window.__tz.hooks.delete('stopline')");
    }
    // Back to the street the drive began on.
    await s.ev(`(() => { const G = window.__game; const h = window.__home; G.vehicle.teleport(h.at, h.yaw);
      G.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true); window.__tz.camera(null); })()`);
    await s.ev("window.__tz.hud('talk')");
    await s.pump(30);
    // Someone who does not step aside (one in five), standing in the lane 12 m ahead; the car at
    // 20 km/h, braking as it hits.
    log("victim", {
      name: await s.ev(`(() => { const G = window.__game; const car = G.vehicle.position(); const y = G.vehicle.yaw();
      const ped = G.pedestrians.list.filter((p) => p.state === 'walk' && p.profile.id % 5 === 0)
        .sort((a, b) => a.object.position.distanceTo(car) - b.object.position.distanceTo(car))[0];
      if (!ped) return null; G.pedestrians.startTalk(ped, car);
      ped.object.position.set(car.x + Math.sin(y) * 12, G.groundY(car.x, car.z) ?? car.y, car.z + Math.cos(y) * 12);
      return ped.profile.name; })()`),
    });
    await s.ev("window.__tz.drive(20)");
    await s.ev(`window.__tz.hooks.set('hit', () => { if (!window.__game.emergency.scene) return;
      window.__tz.drive(null); window.__tz.key('KeyS', true); window.__tz.hooks.delete('hit'); })`);
    await s.pump(6);
    await s.ev("window.__tz.seat(0, -0.02, window.__game.camera.fov * 0.9)");
    await s.film("accident", 3);
    log("accident", { scene: await s.ev("Boolean(window.__game.emergency.scene)") });
    // 119 from the phone, held up large: the operator asks, the quick replies answer (no AI model:
    // the set lines).
    // The seals of the accident (seen in the shot before) cleared off the phone.
    await s.ev(
      "window.__tz.key('KeyS', false); window.__tz.camera(null); for (const el of document.querySelectorAll('#stamps > *')) el.remove()",
    );
    await s.ev(`document.querySelector('#incident [data-dial="119"]').click()`);
    await s.ev("window.__game.phone.setZoom(true)");
    await s.pump(10);
    await s.film("call", 3.5, [
      [0.9, quick(2)],
      [2.2, quick(1)],
    ]);
    await s.pump(40);
    // 110 as well (not filmed), then the phone away.
    await s.ev(
      `document.querySelector('#call-hangup').click(); document.querySelector('#incident [data-dial="110"]').click()`,
    );
    await s.pump(40);
    await s.ev(quick(2));
    await s.pump(45);
    await s.ev(quick(1));
    await s.pump(60);
    await s.ev("window.__game.phone.setZoom(false); window.__game.phone.close()");
    await s.pump(10);
    log("radar", { status: await s.ev("document.querySelector('#incident-status').textContent") });
    // The radar: the scene, the ambulance and the patrol car coming; their distance and time above.
    await s.ev(`window.__tz.zoom([{ t: 0, sel: '#incident', fx: 1.12, fy: 0.62, s: 1.4 },
      { t: 2.5, sel: '#incident', fx: 1.12, fy: 0.62, s: 1.5 }], { edges: true })`);
    await s.film("radar", 2.5);
  },
);

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
// The music's turns on the cut (the drop, a break and its end, the outro): the starts of the
// sections the cut names for them.
const cues = CUT.music.map((id) => starts[id].toFixed(2)).join(",");
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
// The game's own sounds over the music (sound.mjs): by default for a cut with `sfx` (the English
// one), or with --sfx on / off. Muxed into the same file, the picture as it is.
const withSound = args.sfx ? args.sfx === "on" : Boolean(CUT.sfx);
if (withSound) await addSound({ lang: LANG, video: OUT, out: OUT, work: WORK, base: BASE, port: PORT });
