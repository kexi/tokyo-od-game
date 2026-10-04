import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";

/**
 * GSI's optimised vector tiles (地理院ベクトルタイル提供実験, real-time use with attribution), shared
 * by the road and water layers so each z16 tile (~60 KB, every layer) is fetched and decoded once.
 * The decoded tiles are kept for the most recent LIMIT keys, as the layers re-read them when the
 * player moves back and forth. Why not an unbounded map: a long drive would keep every tile decoded.
 */
const URL = (z: number, x: number, y: number) =>
  `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`;
const LIMIT = 64;

const cache = new Map<string, Promise<VectorTile | null>>();

/** The decoded tile, or null where GSI has none (404). Rejects on other HTTP or network errors. */
export function gsiVectorTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    // Re-insert: Map iteration order is insertion order, so the oldest key is evicted first.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = fetchTile(z, x, y);
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return p;
}

async function fetchTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  const res = await fetch(URL(z, x, y));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
}
