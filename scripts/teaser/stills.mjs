// What the stills (og.mjs: the share card, photos.mjs: the landmark photos) share: the game opened
// in headless Chrome at 画質 最高 with the teaser's staging (page.mjs) on its virtual clock
// (clock.mjs), set to a time and weather, the light pillars and the route arrows hidden, and the
// car placed from the driver's seat.
import { launch } from "../qa/browser.mjs";
import { installClock } from "./clock.mjs";
import { stage } from "./page.mjs";

/** The command line as `--name value` pairs. */
export const parseArgs = (argv) =>
  Object.fromEntries(
    argv.reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
  );

// The line shape of src/log.ts. Why not import it: plain node cannot load the .ts logger.
const traceId = crypto.randomUUID();
export const log = (event, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", event, traceId, ...fields }));

// 画質 最高 (src/graphics.ts PRESETS.ultra).
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

/** What the browser remembers before the game loads: 最高, the language, the one-time tips seen. */
const preloadFor = (lang) => {
  const storage = {
    "tod.graphics": JSON.stringify(ULTRA),
    "tod.lang": lang,
    "tod.charmTip": "1",
    "tod.tvNotice": "1",
    "tod.controls": JSON.stringify({ layout: "wasd", assist: "easy", charm: "both", seatModel: 2 }),
  };
  return `(() => { const s = ${JSON.stringify(storage)};
  try { for (const k in s) localStorage.setItem(k, s[k]); } catch {} })(); (${installClock})();`;
};

/** A point at `lat, lon` in the local frame, on the ground plus `h` m (page-side expression). */
export const at = (lat, lon, h) =>
  `(() => { const G = window.__game; const f = G.getFrame(); const p = f.toLocal(${lat}, ${lon}, f.origin.h);
  p.y = (G.groundY(p.x, p.z) ?? 0) + ${h}; return p; })()`;

/**
 * The game started at `start` ("lat,lon") in `lang`, at `time` and `weather`, with no panels over
 * the view (the attribution line stays), no light pillars and no route arrows, the phone in the
 * pocket, after `settle` frames for the city's tiles, the far skyline and the wet road to come in.
 */
export async function openGame({
  base,
  start,
  lang,
  width,
  height,
  port,
  time = "night",
  weather = "rain",
  settle = 240,
}) {
  const b = await launch(`${base}?start=${start}`, { width, height, port, preload: preloadFor(lang) });
  const pump = async (frames) => {
    for (let i = 0; i < frames; i++) await b.evaluate("window.__tz.frame(window.__tz.t, window.__tz.len)");
  };
  try {
    let state = null;
    for (let i = 0; i < 150 && state !== "ready"; i++) {
      await b.sleep(1000);
      state = await b.evaluate("window.__game?.getState()").catch(() => null);
    }
    if (state !== "ready") throw new Error(`the game did not load (${state})`);
    await b.evaluate("window.__clock.start()");
    await b.evaluate(`(${stage})()`);
    await b.evaluate("window.__game.start()");
    await pump(5);
    // The game starts at a random time and weather: set again after it.
    await b.evaluate(`document.querySelector('[data-time="${time}"]').click();
      document.querySelector('[data-weather="${weather}"]').click();
      window.__game.env.wetness = window.__game.env.overcast = ${weather === "rain" ? 1 : 0}`);
    await b.evaluate("window.__tz.hud('none')");
    await b.evaluate(`(() => { const G = window.__game; G.field.beams.visible = false; G.field.gems.visible = false;
      G.ribbon.update = () => {}; G.ribbon.object.visible = false; })()`);
    await b.evaluate("window.__tz.key('KeyF')");
    await pump(settle);
  } catch (error) {
    await b.close();
    throw error;
  }
  return { b, pump, ev: (js) => b.evaluate(js), close: () => b.close() };
}

/**
 * Page side: the car placed for `photo` (photos.mjs describes the fields: landmark, from, toward,
 * fixed, minWidth); returns the driver's turn towards the landmark (rad, left +) and how far up
 * its top is (rad), with where it stood.
 */
export const placeFor = (photo) => `(() => {
  const G = window.__game; const V = G.camera.position.constructor; const f = G.getFrame();
  const lm = f.toLocal(${photo.landmark.lat}, ${photo.landmark.lon}, f.origin.h);
  const from = f.toLocal(${photo.from.lat}, ${photo.from.lon}, f.origin.h);
  const to = ${photo.toward ? `f.toLocal(${photo.toward.lat}, ${photo.toward.lon}, f.origin.h)` : "lm"};
  let p = from.clone(); let heading = new V(to.x - from.x, 0, to.z - from.z).normalize(); let road = null;
  if (!${Boolean(photo.fixed)}) {
    const graph = G.getRoadGraph();
    // Only a road running towards the landmark (within ≈ 25°): the nearest wide road alone was a
    // cross street, the landmark off to the side behind the pillars.
    const toward = new V(to.x - from.x, 0, to.z - from.z).normalize();
    // Not an expressway: its deck is not in the road graph's heights, and a car put on the ground
    // under it stood among the buildings. A one-way street only the way it may be driven.
    const isToward = (seg) => {
      if (seg.line.kind === 'highway') return false;
      const a = seg.pts[0]; const z = seg.pts[seg.pts.length - 1];
      const run = new V(z.x - a.x, 0, z.z - a.z);
      if (run.lengthSq() <= 1) return false;
      const along = run.normalize().dot(toward);
      const isAllowed = seg.line.oneway === 0 || Math.sign(along) === seg.line.oneway;
      return isAllowed && Math.abs(along) > 0.9;
    };
    const hit = graph && graph.nearest(from, 250, (seg) => seg.line.width >= ${photo.minWidth ?? 6} && isToward(seg));
    if (!hit) return { error: 'no road near the viewpoint' };
    const s = graph.sample(hit.seg, hit.s);
    const d = s.dir.clone().setY(0).normalize();
    const toGo = new V(to.x - s.pos.x, 0, to.z - s.pos.z);
    if (d.dot(toGo) < 0) d.negate();
    // Keep left: the lane a quarter of the road's width left of its middle (at most 4 m).
    const left = new V(d.z, 0, -d.x);
    p = s.pos.clone().addScaledVector(left, Math.min(hit.seg.line.width * 0.25, 4));
    heading = d;
    road = { width: hit.seg.line.width, kind: hit.seg.line.kind, offM: Math.round(hit.lateral) };
  }
  p.y = (G.groundY(p.x, p.z) ?? 0) + 0.9;
  const yaw = Math.atan2(heading.x, heading.z);
  G.vehicle.teleport(p, yaw);
  const bearing = Math.atan2(lm.x - p.x, lm.z - p.z);
  const turn = Math.atan2(Math.sin(bearing - yaw), Math.cos(bearing - yaw));
  const dist = Math.hypot(lm.x - p.x, lm.z - p.z);
  return { turn, dist: Math.round(dist), top: Math.atan2(${photo.landmark.height} - 1.2, dist), road };
})()`;

/**
 * The driver's eye turned towards the landmark (as far as the windscreen allows) and looking up so
 * its top sits about four fifths of the way up the picture (0.6 of the half view above the middle);
 * `photo.turn` / `pitch` / `fov` adjust or override it.
 */
export async function lookAtLandmark(game, photo, placed) {
  const yaw = Math.max(-0.6, Math.min(0.6, placed.turn + (photo.turn ?? 0)));
  const halfView = (((photo.fov ?? 60) / 2) * Math.PI) / 180;
  const pitch = photo.pitch ?? Math.max(0.03, Math.min(0.3, placed.top - 0.6 * halfView));
  await game.ev(`window.__tz.seat(${yaw}, ${pitch}, ${photo.fov ?? 60})`);
  return { yaw, pitch };
}

/** Page side: the signal ahead of the car within `range` m (kept as window.__ap); its distance. */
export const findSignal = (range) => `(() => { const G = window.__game; const y = G.vehicle.yaw();
  const fwd = G.vehicle.position().set(Math.sin(y), 0, Math.cos(y));
  const a = G.control.ahead(G.vehicle.position(), fwd, ${range});
  window.__ap = a && a.approach.kind === 'signal' ? a.approach : null; return window.__ap ? a.dist : null; })()`;

/** Page side: whether the signal found by findSignal shows `state`. */
export const lightIs = (state) => `window.__ap && window.__game.control.state(window.__ap) === '${state}'`;

/** Frames until `js` is true (checked every `every`), at most `max`; true if it came. */
export async function until(game, js, max, every = 3) {
  for (let i = 0; i < max; i += every) {
    if (await game.ev(js)) return true;
    await game.pump(every);
  }
  return Boolean(await game.ev(js));
}
