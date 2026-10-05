// Feature photos of the game for sharing, in the landmark photos' manner (photos.mjs: a rainy night,
// from the driver's seat, 画質 最高, the game in `--lang`, English by default), each showing what the
// game is about rather than only how it looks:
//
// - y-viral: a red light run under the Skytree, a witness's video of it on Y with the replies and
//   quote reposts piling up, the phone held up large, the violation's seal on the screen;
// - ticket: stopped by a patrol car before Tokyo Station, the officer's ticket (fine and points);
// - law-abiding: waiting at the stop line on red before Tokyo Tower, the engine switched off by
//   Tokyo's ordinance (the toast cites its article).
//
//   node scripts/teaser/features.mjs [--base http://localhost:5173/tokyo-od-game/] [--out out/photos]
//                                    [--lang en] [--only y-viral,ticket] [--port 9343]
//
// Writes out/photos/<name>-<take>.png (2560×1440) and <name>-raw.png (the take --pick-<name>
// names, by default `pick`); scripts/textures/photo_poster.py lays them out with the landmark photos.
// Needs the dev server (just serve-dev) or a development build served with the dev hook.
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findSignal, lightIs, log, lookAtLandmark, openGame, parseArgs, placeFor, until } from "./stills.mjs";

const args = parseArgs(process.argv.slice(2));
const BASE = args.base ?? "http://localhost:5173/tokyo-od-game/";
const OUT = resolve(args.out ?? "out/photos");
const PORT = Number(args.port ?? 9343);
const LANG = args.lang ?? "en";
const ONLY = args.only ? new Set(args.only.split(",")) : null;

const STATION = { lat: 35.6813763, lon: 139.7660621, height: 46.1 };
const SKYTREE = { lat: 35.7100392, lon: 139.810708, height: 634 };
const TOWER = { lat: 35.658592, lon: 139.74545, height: 333 };

/**
 * Each scene: where the car stands (as photos.mjs), what is staged there (`stage`, given the game
 * and the views helpers), how many takes and how many frames apart.
 */
const SCENES = [
  {
    name: "y-viral",
    at: { landmark: SKYTREE, from: { lat: 35.7104, lon: 139.7962 }, minWidth: 10, fov: 50 },
    hud: "all",
    pick: 0,
    stage: async (game) => {
      // The game's own account on the left (the violation, the witness, the post on Y), not the key
      // bar and the hints that clutter the picture.
      await game.ev(
        `document.head.insertAdjacentHTML('beforeend', '<style>#hud-toolbar, #hud-time, #talk-hint, #autopilot-chip, #phone-button, #hud-mission, #hud-score { visibility: hidden !important; }</style>')`,
      );
      // A red light run with a bystander's video of it (the dev hook books it in the next frame, as
      // a violation is; not awaited: its frames are the ones pumped here).
      await game.ev("void window.__game.debug.perf.violation('signal', 'video', 2); true");
      const isPosted = "window.__game.social.posts.some((p) => p.media === 'video')";
      if (!(await until(game, isPosted, 600, 10))) throw new Error("no video post on Y");
      // The phone up in its holder, Y open on that post. Not held large (拡大): that dims the whole
      // view, the Skytree and the seal with it.
      await game.ev("window.__tz.key('KeyF')");
      await game.pump(5);
      await game.ev("document.querySelector('#social-open').click()");
      await game.pump(5);
      await game.ev(`(() => { const post = window.__game.social.posts.find((p) => p.media === 'video');
        const row = [...document.querySelectorAll('#social-app article.social-post')].find((a) => a.textContent.includes(post.text.slice(0, 12)));
        row?.click(); })()`);
      await game.pump(5);
      // Replies and quote reposts come at a person's pace: the game clock runs on meanwhile.
      await game.ev("window.__tz.hooks.set('fast', () => { window.__game.env.gameMs += 10000; })");
      await game.pump(240);
      await game.ev("window.__tz.hooks.delete('fast')");
      // The light ahead on green, its lamp and the panel agreeing: the picture is the aftermath an
      // hour on (on red the panel said red while the lamp in view still showed green).
      if ((await game.ev(findSignal(250))) !== null) await until(game, lightIs("green"), 3600, 5);
      // The seal again as the picture is taken (it fades within 3 s of the violation), moved up
      // right between the Skytree and the phone (the left is the poster's words, photo_poster.py),
      // and given time to land (it is see-through while it slams down).
      await game.ev(`(() => { const G = window.__game; const r = G.law.state.log.findLast((x) => x.kind === 'signal');
        G.stamps.stamp('違反', r.label.replace(/（.*?）/g, ''), false, '${LANG === "ja" ? "" : "Running a red light"}');
        const st = document.querySelector('#stamps .stamp:last-child'); st?.style.setProperty('--dx', '430px'); st?.style.setProperty('--dy', '-250px'); })()`);
      await game.pump(24);
    },
    // Down the thread to the replies piling up (they say more than the counts above them); takes
    // spread over the wipers' stroke, the one with the blade out of the way picked.
    beforeTake: async (game) => {
      await game.ev(`(() => { const page = document.querySelector('#phone-social .sns-page:last-child');
        if (page) page.scrollTop = 620; })()`);
      await game.pump(1);
    },
    takes: 4,
    every: 9,
  },
  {
    name: "ticket",
    at: {
      landmark: STATION,
      from: { lat: 35.68124, lon: 139.7652 },
      fixed: true,
      turn: -0.08,
      pitch: 0.06,
      fov: 62,
    },
    hud: "drive",
    pick: 0,
    stage: async (game) => {
      // A patrol car 30 m behind sees the red light run (the dev hook), pulls up behind the stopped
      // car, and the officer writes the ticket.
      const isStarted = await game.ev("window.__game.debug.pursuit.start('patrol', 'signal')");
      if (!isStarted) throw new Error("the patrol car could not be placed");
      await game.pump(30);
      // It stops a driver only within 22 m (pursuitEscalation STOP_GAP_M); before the station's
      // front it could not drive up from 30 m, so it is brought 10 m behind, as the teaser does.
      await game.ev(`(() => { const G = window.__game; const u = G.getPolice(); if (!u) return; const y = G.vehicle.yaw();
        const p = G.vehicle.position().addScaledVector({ x: Math.sin(y), y: 0, z: Math.cos(y) }, -10);
        p.y = (G.groundY(p.x, p.z) ?? p.y) + 0.86; u.car.teleport(p, y); u.car.syncVisuals(); u.driver.place(p, y); })()`);
      const isTicket = "document.querySelector('#ticket-dialog').open";
      // At the window the officer talks and the driver answers (open the window, the licence …):
      // the first answer each time, the cooperative one, until the ticket is written.
      for (let i = 0; i < 40 && !(await game.ev(isTicket)); i++) {
        await game.ev("document.querySelector('[data-choice]')?.click()");
        await game.pump(45);
      }
      if (!(await until(game, isTicket, 600, 15))) {
        const state = await game.ev("JSON.stringify(window.__game.debug.pursuit.state())");
        throw new Error(`no ticket: ${state}`);
      }
      await game.pump(20);
    },
    takes: 1,
    every: 1,
  },
  {
    name: "law-abiding",
    at: { landmark: TOWER, from: { lat: 35.652, lon: 139.743 }, minWidth: 10 },
    hud: "talk",
    pick: 1,
    stage: async (game) => {
      // At the stop line of the light ahead, 2 m short, facing the way the lane goes.
      const dist = await game.ev(findSignal(250));
      if (dist === null) throw new Error("no signal ahead");
      await game.ev(`(() => { const G = window.__game; const ap = window.__ap; const tr = ap.travel;
        const mid = ap.a.clone().add(ap.b).multiplyScalar(0.5);
        const p = mid.clone().addScaledVector(tr, -3.2); p.y = (G.groundY(p.x, p.z) ?? p.y) + 0.9;
        G.vehicle.teleport(p, Math.atan2(tr.x, tr.z)); })()`);
      await game.pump(30);
      // Waiting through a red from its start: the engine goes off after 20 s stopped (Tokyo's
      // ordinance), which a nudge at the red's start counts from, so the toast comes on red.
      await until(game, lightIs("green"), 3600, 15);
      await until(game, lightIs("red"), 3600, 3);
      await game.ev(`(() => { const G = window.__game; const y = G.vehicle.yaw();
        G.vehicle.body.setLinvel({ x: Math.sin(y) * 0.6, y: 0, z: Math.cos(y) * 0.6 }, true); })()`);
      await game.pump(2);
      await game.ev("window.__game.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true)");
      const isToast = `[...document.querySelectorAll('#toasts > *')].some((t) => /Art\\. 52|第52条|第52条/.test(t.textContent))`;
      if (!(await until(game, isToast, 900, 5))) throw new Error("no idling toast");
      await game.pump(8);
      log("law_abiding_light", { red: await game.ev(lightIs("red")) });
    },
    takes: 2,
    every: 20,
  },
];

mkdirSync(OUT, { recursive: true });
for (const scene of SCENES) {
  if (ONLY && !ONLY.has(scene.name)) continue;
  const game = await openGame({
    base: BASE,
    start: `${scene.at.from.lat},${scene.at.from.lon}`,
    lang: LANG,
    width: 2560,
    height: 1440,
    port: PORT,
  });
  try {
    const placed = await game.ev(placeFor(scene.at));
    if (placed?.error) throw new Error(placed.error);
    await game.ev("window.__tz.camera(null)");
    await game.pump(90);
    await lookAtLandmark(game, scene.at, placed);
    await game.ev(`window.__tz.hud('${scene.hud}')`);
    await scene.stage(game);
    for (let take = 0; take < scene.takes; take++) {
      await scene.beforeTake?.(game, take);
      await game.b.screenshot(join(OUT, `${scene.name}-${take}.png`));
      await game.pump(scene.every);
    }
    const pick = args[`pick-${scene.name}`] ?? String(scene.pick);
    copyFileSync(join(OUT, `${scene.name}-${pick}.png`), join(OUT, `${scene.name}-raw.png`));
    log("feature_shot", { name: scene.name, pick });
  } catch (error) {
    log("feature_failed", { name: scene.name, reason: String(error?.message ?? error) });
  } finally {
    await game.close();
  }
}
