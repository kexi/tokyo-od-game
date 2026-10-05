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
