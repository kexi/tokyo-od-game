// S6 PR 7c's「走行に足す確認」: drive the car on the game's autopilot along the street nearest each
// place (40 m before → 40 m past it), put in the lane's centre (left half of a two-way street), and
// judge it: arrived within ARRIVE_M of the end, no fall, no stop, the car's height over the drawn
// ground within RIDE_BAND (on the street: not on a deck, not sunk, not up a wall), sampled every
// 0.25 s. pnpm exec tsx .qa/street-drive.mts <base> [ids]  (one JSON line per check)
import { readdirSync, readFileSync } from "node:fs";
import { launch } from "../scripts/qa/browser.mjs";
import { freePort } from "../scripts/qa/ports.ts";

const base = process.argv[2] ?? "http://localhost:5291/tokyo-od-game/";
const only = process.argv[3]?.split(",") ?? null;
const ARRIVE_M = 10;
/** The car body's height over the drawn ground on a street (m): its resting ride is 0.7–0.9 m. */
const RIDE_BAND = [0.4, 1.3] as const;
const dir = "public/data/expressway/";
type Chunk = { id: string; run: string; k: number; st: number[] };
const chunks: Chunk[] = [];
for (const f of readdirSync(dir).filter((f) => /^\d+-\d+\.json$/.test(f)))
  chunks.push(...JSON.parse(readFileSync(dir + f, "utf8")).chunks);
/** (lat, lon) of a run at s, `left` m to its left. */
function at(run: string, s: number, left = 0) {
  const list = chunks.filter((c) => c.run === run).sort((a, b) => a.k - b.k);
  if (list.length === 0) throw new Error(`no run ${run}`);
  const st = list.flatMap((c) => {
    const rows: number[][] = [];
    for (let i = 0; i < c.st.length; i += 7) rows.push(c.st.slice(i, i + 7));
    return rows;
  });
  let i = 0;
  while (i + 2 < st.length && st[i + 1][0] < s) i++;
  const [a, b] = [st[i], st[i + 1]];
  const t = Math.max(0, Math.min(1, (s - a[0]) / (b[0] - a[0] || 1)));
  const lat = a[2] + (b[2] - a[2]) * t;
  const lon = a[1] + (b[1] - a[1]) * t;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ex = (b[1] - a[1]) * kx;
  const ny = (b[2] - a[2]) * 110574;
  const n = Math.hypot(ex, ny) || 1;
  return { lat: lat + ((ex / n) * left) / 110574, lon: lon - ((ny / n) * left) / kx };
}
const lengthOf = (run: string) => {
  const list = chunks.filter((c) => c.run === run).sort((a, b) => a.k - b.k);
  const last = list[list.length - 1];
  return last.st[last.st.length - 7];
};
const checks = [
  { id: "azabudai-north-portal-over", what: "麻布台の北の坑門の上の道（737538573）", ...at("737538573", 118) },
  { id: "azabudai-north-portal-over-2", what: "麻布台の北の坑門の上の道（先、737538573）", ...at("737538573", 135) },
  { id: "wall-24039751-left", what: "24039751:0 の盛土の壁際（左）", ...at("24039751", 50, 12) },
  { id: "wall-24039751-right", what: "24039751:0 の盛土の壁際（右）", ...at("24039751", 50, -12) },
  { id: "wall-45068169-left", what: "45068169 の盛土の壁際（左）", ...at("45068169", 100, 12) },
  { id: "wall-45068169-right", what: "45068169 の盛土の壁際（右）", ...at("45068169", 100, -12) },
  { id: "wall-24402611-start", what: "24402611 の始まりの盛土の壁際", ...at("24402611", 30, 12) },
  { id: "kasumi-24402611-75", what: "霞が関の低い径間の下（24402611 s 75）", ...at("24402611", 74.7) },
  { id: "kasumi-24402611-84", what: "霞が関の低い径間の下（24402611 s 84）", ...at("24402611", 83.9) },
  { id: "kasumi-24402611-90", what: "霞が関の低い径間の下（24402611 s 90）", ...at("24402611", 90.2) },
  { id: "kasumi-895902565-850", what: "895902565 の低い径間の下（s 850）", ...at("895902565", 849.6) },
  { id: "kasumi-895902565-856", what: "895902565 の低い径間の下（s 856）", ...at("895902565", 856.5) },
  { id: "kasumi-895902565-865", what: "895902565 の低い径間の下（s 865）", ...at("895902565", 865.1) },
  { id: "decided-895902565-80", what: "決定で高架に戻した 895902565 s 80 の下の街路（区間 815）", ...at("895902565", 80) },
  { id: "decided-45021976-3412", what: "決定で高架に戻した 45021976 s 3412 の下の街路（区間 650）", ...at("45021976", 3412) },
  { id: "control-two-way", what: "対照: 双方向の街路（幅 9 m、床版から 200 m 以上）", lat: 35.666023, lon: 139.750794 },
  { id: "control-one-way", what: "対照: 一方通行の街路（幅 9 m、床版から 200 m 以上）", lat: 35.664318, lon: 139.755902 },
  { id: "control-narrow", what: "対照: 幅 4.3 m の街路（一方通行、床版から 200 m 以上）", lat: 35.664136, lon: 139.756425 },
].filter((c) => only === null || only.includes(c.id));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const c of checks) {
  const start = `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
  const url = `${base}?start=${start}&time=day&weather=clear&seed=20261110&expressway`;
  const b = await launch(url, { width: 960, height: 540, port: await freePort() });
  try {
    const until = async (expr: string, tries = 180) => {
      for (let i = 0; i < tries; i++) {
        const v = await b.evaluate(expr).catch(() => null);
        if (v) return v;
        await sleep(1000);
      }
      throw new Error(`timeout: ${expr}`);
    };
    await until("window.__game?.getState() === 'ready'");
    await b.evaluate("window.__game.start()");
    await until("__game.debug.settled().isSettled", 150);
    await sleep(3000);
    const placed = (await b.evaluate(`(() => {
      const G = window.__game; const g = G.getRoadGraph(); const f = G.getFrame();
      const P = f.toLocal(${c.lat}, ${c.lon}, f.origin.h);
      const street = (s) => !s.line.xid;
      const hit = g.nearest(P, 30, street);
      if (!hit) return { error: "no street within 30 m" };
      const d = hit.dir.clone().setY(0).normalize();
      for (const sign of [1, -1]) {
        const A = f.toGeodetic(P.clone().addScaledVector(d, -40 * sign));
        const B = f.toGeodetic(P.clone().addScaledVector(d, 40 * sign));
        const put = G.debug.expressway.placeOnStreet({ lat: A.lat, lon: A.lon }, { lat: B.lat, lon: B.lon });
        if (put) {
          window.__streetCheck = { minOver: Infinity, maxOver: -Infinity, n: 0, below: 0, above: 0 };
          return { ...put, kind: hit.seg.line.kind, to: { lat: B.lat, lon: B.lon } };
        }
      }
      return { error: "no lane to put the car in (one-way against both ways?)" };
    })()`)) as { error?: string; to: { lat: number; lon: number } };
    if (placed.error) {
      console.log(JSON.stringify({ check: c.id, what: c.what, placed, pass: false }));
      continue;
    }
    const logsBefore = b.logs.length;
    const started = await b.evaluate(`__game.debug.expressway.route(${JSON.stringify(placed.to)})`);
    for (let t = 0; t < 240 && started; t++) {
      await b.evaluate("__game.advance(0.25)");
      await b.evaluate(`(() => { const G = window.__game; const p = G.vehicle.position(); const o = p.y - G.groundY(p.x, p.z); const s = window.__streetCheck; s.minOver = Math.min(s.minOver, o); s.maxOver = Math.max(s.maxOver, o); s.n++; if (o < ${RIDE_BAND[0]}) s.below++; if (o > ${RIDE_BAND[1]}) s.above++; })()`);
      const isDriving = await b.evaluate("!!window.__game.getAutopilot()");
      if (!isDriving && t > 12) break;
    }
    const summary = (await b.evaluate(`__game.debug.expressway.stop(${JSON.stringify(c.id)})`)) as Record<string, unknown>;
    const endM = (await b.evaluate(`(() => { const G = window.__game; const f = G.getFrame(); const p = G.vehicle.position(); const T = f.toLocal(${placed.to.lat}, ${placed.to.lon}, f.origin.h); return Math.hypot(p.x - T.x, p.z - T.z); })()`)) as number;
    const over = (await b.evaluate("window.__streetCheck")) as { below: number; above: number; minOver: number; maxOver: number; n: number };
    const during = (e: string) => b.logs.slice(logsBefore).filter((l: string) => l.includes(`"event":"${e}"`)).length;
    const counts = {
      crossed: during("expressway_building_crossed"),
      stalled: during("expressway_car_stalled"),
      accident: during("accident"),
      respawned: during("car_respawned"),
    };
    const isArrived = endM <= ARRIVE_M;
    const isOnStreet = over.below === 0 && over.above === 0;
    const pass = isArrived && isOnStreet && summary?.fell !== true && counts.crossed + counts.stalled + counts.respawned === 0;
    console.log(
      JSON.stringify({
        check: c.id,
        what: c.what,
        pass,
        placed,
        started,
        endM: Math.round(endM * 10) / 10,
        fell: summary?.fell,
        carOverGroundM: { min: Math.round(over.minOver * 100) / 100, max: Math.round(over.maxOver * 100) / 100, n: over.n, below: over.below, above: over.above },
        ...counts,
      }),
    );
  } finally {
    await b.close();
  }
}
