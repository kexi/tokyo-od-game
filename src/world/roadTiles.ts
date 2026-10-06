import { latToTileY, lonToTileX } from "../geo/tiles";
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
    return tile?.roads ?? [];
  }
}
