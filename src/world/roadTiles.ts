import { latToTileY, lonToTileX, tileXToLon, tileYToLat } from "../geo/tiles";
import { warn } from "../log";
import { gsiVectorTile } from "./gsiVectorTiles";
import type { RoadLine } from "./roads";

/**
 * Road centrelines from GSI's optimised vector tiles (地理院ベクトルタイル, real-time use with
 * attribution like the other 地理院タイル). Layer `road`, ftCode 27xx = 道路中心線, with
 * 道路種別 rdCtg, 幅員区分 rnkWidth, 幅員 Width (m, when known) and 階層 lvOrder (0 = ground).
 * The tiles come through the shared cache, which the water layer reads too.
 */
const ZOOM = 16;

// rnkWidth classes: 0 <3 m, 1 3–5.5 m, 2 5.5–13 m, 3 13–19.5 m, 4 ≥19.5 m (class midpoints).
const WIDTH_BY_RANK = [2.5, 4.3, 9, 16, 22];

function kindOf(rdCtg: number, motorway: number): RoadLine["kind"] {
  if (rdCtg === 3 || motorway === 1) return "highway";
  if (rdCtg === 0) return "national";
  if (rdCtg === 1) return "prefectural";
  return "local";
}

export class RoadTiles {
  private readonly cache = new Map<string, Promise<RoadLine[]>>();

  /** Ground-level centrelines from the 3×3 z16 tiles (~1.8 km square) around a point. */
  async around(lat: number, lon: number): Promise<RoadLine[]> {
    const cx = Math.floor(lonToTileX(lon, ZOOM));
    const cy = Math.floor(latToTileY(lat, ZOOM));
    const jobs: Promise<RoadLine[]>[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) jobs.push(this.tile(cx + dx, cy + dy));
    return (await Promise.all(jobs)).flat();
  }

  private tile(x: number, y: number): Promise<RoadLine[]> {
    const key = `${x}/${y}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.fetchTile(x, y).catch((error: unknown) => {
        warn("road_tile_failed", { key, error: String(error) });
        this.cache.delete(key);
        return [];
      });
      this.cache.set(key, p);
    }
    return p;
  }

  private async fetchTile(x: number, y: number): Promise<RoadLine[]> {
    const tile = await gsiVectorTile(ZOOM, x, y);
    const layer = tile?.layers.road;
    if (!layer) return [];
    const lines: RoadLine[] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const p = f.properties as Record<string, number>;
      const isCentreline = Math.floor(p.ftCode / 100) === 27;
      // Elevated roads (首都高 etc.) have no drivable surface in the game yet.
      const isGround = (p.lvOrder ?? 0) === 0;
      if (!isCentreline || !isGround || f.type !== 2) continue;
      const width = p.Width && p.Width > 0 ? p.Width : (WIDTH_BY_RANK[p.rnkWidth] ?? 4.3);
      for (const ring of f.loadGeometry()) {
        const coords: number[] = [];
        for (const pt of ring) {
          coords.push(tileXToLon(x + pt.x / layer.extent, ZOOM), tileYToLat(y + pt.y / layer.extent, ZOOM));
        }
        if (coords.length >= 4)
          lines.push({
            coords,
            width,
            oneway: 0,
            kind: kindOf(p.rdCtg, p.motorway),
            bridge: p.ftCode === 2703,
          });
      }
    }
    return lines;
  }
}
