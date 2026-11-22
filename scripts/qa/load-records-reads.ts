// Does anything read a b3dm tile's load records after load-model? Run on a build that keeps them
// (before dropLoadRecords): each loaded near and far tile's scene.batchTable, scene.featureTable and
// tile.engineData.metadata are swapped for proxies that count every property read, then the game
// is played as a player would: the start at 東京駅 (far), warps to five places, five minutes of the
// autopilot. Expected: 0 reads (then dropping them changes nothing the game does). M2,
// knowledge/memory-growth.md.
// Why proxies and not a search of the code alone: the library and its plugins read the tile too.
//
//   pnpm exec tsx scripts/qa/load-records-reads.ts --label L --base URL [--autopilot-s 300]
//
// Output: one JSON line on stdout and .qa/load-records-reads/<label>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { freePort } from "./ports.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag("label") ?? "run";
const base = flag("base") ?? "http://localhost:4174/tokyo-od-game/";
const autopilotS = Number(flag("autopilot-s") ?? 300);
const url = `${base}?start=35.6812,139.7671&time=day&weather=clear&seed=20261115`;
const preload = `try { localStorage.setItem("tod.graphics", JSON.stringify({ viewDistance: "far" })); } catch {}`;
/** The five places warped to: around the wards loop. */
const PLACES: Array<[number, number]> = [
  [35.6896, 139.7006],
  [35.658, 139.7016],
  [35.7295, 139.7109],
  [35.7138, 139.7773],
  [35.6812, 139.7671],
];
/** Page-side: hook a renderer's load-model (once) to swap the records for counting proxies. */
const HOOK = `(() => {
  const r = (window.__reads ??= { proxied: 0, reads: {} });
  const count = (what) => (target) => new Proxy(target, { get(t, key, recv) {
    if (typeof key === "string") r.reads[what + "." + key] = (r.reads[what + "." + key] || 0) + 1;
    return Reflect.get(t, key, recv);
  } });
  const hook = (tiles) => {
    if (!tiles || tiles.__readsHooked) return;
    tiles.__readsHooked = true;
    tiles.addEventListener("load-model", ({ scene, tile }) => {
      if (scene.batchTable) scene.batchTable = count("batchTable")(scene.batchTable);
      if (scene.featureTable) scene.featureTable = count("featureTable")(scene.featureTable);
      if (tile?.engineData?.metadata) tile.engineData.metadata = count("metadata")(tile.engineData.metadata);
      r.proxied++;
    });
  };
  hook(__game.buildings.tiles);
  hook(__game.buildings.far);
  return r.proxied;
})()`;
const AUTOPILOT_KEYS = [
  { code: "KeyA", key: "a", windowsVirtualKeyCode: 65 },
  { code: "KeyJ", key: "j", windowsVirtualKeyCode: 74 },
];

const outDir = join(ROOT, ".qa", "load-records-reads");
mkdirSync(outDir, { recursive: true });
const port = await freePort();
const b = await launch("about:blank", { width: 1280, height: 720, port, preload });
const until = async (expr: string, tries = 180): Promise<boolean> => {
  for (let i = 0; i < tries; i++) {
    const v = await b.evaluate<boolean>(expr).catch(() => false);
    if (v) return true;
    await b.sleep(1000);
  }
  return false;
};
let out: Record<string, unknown> = { label, base, url };
try {
  await b.send("Page.navigate", { url });
  await until("window.__game?.getState() === 'ready'");
  await b.evaluate(HOOK);
  await b.evaluate("window.__game.start()");
  await until("__game.debug.settled().isSettled", 150);
  // The far renderer comes after the town: hook it as soon as it is there.
  await until("Boolean(__game.buildings.far)", 60);
  await b.evaluate(HOOK);
  for (const [lat, lon] of PLACES) {
    await b.evaluate(`__game.debug.roads.warp({ name: "qa", lat: ${lat}, lon: ${lon} })`);
    await b.sleep(15_000);
    await b.evaluate(HOOK);
  }
  let isOn = false;
  for (let tries = 0; tries < 20 && !isOn; tries++) {
    for (const k of AUTOPILOT_KEYS) {
      await b.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
      await b.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
      await b.sleep(1500);
      isOn =
        (await b.evaluate<boolean>(`document.querySelector("#autopilot-chip")?.hidden === false`)) === true;
      if (isOn) break;
    }
  }
  await b.sleep(autopilotS * 1000);
  const reads = await b.evaluate<{ proxied: number; reads: Record<string, number> }>("window.__reads");
  const total = Object.values(reads.reads).reduce((s, n) => s + n, 0);
  out = {
    ...out,
    at: new Date().toISOString(),
    autopilot: isOn,
    proxiedTiles: reads.proxied,
    reads: reads.reads,
    totalReads: total,
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
} catch (error) {
  out = { ...out, failure: String(error) };
  process.stdout.write(`${JSON.stringify({ failure: String(error) })}\n`);
} finally {
  writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(out, null, 2)}\n`);
  await b.close();
}
