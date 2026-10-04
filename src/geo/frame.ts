import { Matrix4, Quaternion, Vector3 } from "three";
import { ecefToGeodetic, geodeticToEcef, type Geodetic } from "./ellipsoid";

const DEG = Math.PI / 180;

/**
 * Local game frame anchored at a geodetic origin.
 * three.js axes: +X = East, +Y = Up, -Z = North (right-handed, Y-up).
 *
 * The whole of the 23 wards spans ~30 km, where Earth's curvature drops ~18 m at the edge,
 * so a single tangent plane cannot host the map. Instead the game re-anchors this frame
 * near the player (floating origin) and converts everything through ECEF.
 */
export class LocalFrame {
  readonly origin: Geodetic;
  readonly ecefToLocal = new Matrix4();
  readonly localToEcef = new Matrix4();

  constructor(lat: number, lon: number, h: number) {
    this.origin = { lat, lon, h };
    const phi = lat * DEG;
    const lambda = lon * DEG;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const sl = Math.sin(lambda);
    const cl = Math.cos(lambda);
    const o = geodeticToEcef(lat, lon, h);
    // Rows: East, Up, -North expressed in ECEF.
    const e = [-sl, cl, 0];
    const u = [cp * cl, cp * sl, sp];
    const s = [sp * cl, sp * sl, -cp];
    const t = (r: number[]) => -(r[0] * o.x + r[1] * o.y + r[2] * o.z);
    this.ecefToLocal.set(e[0], e[1], e[2], t(e), u[0], u[1], u[2], t(u), s[0], s[1], s[2], t(s), 0, 0, 0, 1);
    this.localToEcef.copy(this.ecefToLocal).invert();
  }

  toLocal(lat: number, lon: number, h: number, target = new Vector3()): Vector3 {
    const p = geodeticToEcef(lat, lon, h);
    return target.set(p.x, p.y, p.z).applyMatrix4(this.ecefToLocal);
  }

  toGeodetic(local: Vector3): Geodetic {
    const p = local.clone().applyMatrix4(this.localToEcef);
    return ecefToGeodetic(p.x, p.y, p.z);
  }

  /** Rigid transform mapping coordinates of `from` into this frame (used when re-anchoring). */
  transformFrom(from: LocalFrame, target = new Matrix4()): Matrix4 {
    return target.multiplyMatrices(this.ecefToLocal, from.localToEcef);
  }

  rotationFrom(from: LocalFrame, target = new Quaternion()): Quaternion {
    return target.setFromRotationMatrix(this.transformFrom(from));
  }
}
