import { ConeGeometry, Mesh, MeshBasicMaterial, Vector3, type Object3D } from "three";
import type { Poi } from "../data/schema";
import { haversineMeters } from "../geo/ellipsoid";
import type { PoiField } from "./pois";

export type Mission = {
  target: Poi;
  startedAt: number;
  timeLimit: number; // seconds
  startDistance: number;
};

export type MissionResult = { target: Poi; reward: number; seconds: number };

const ARRIVE_RADIUS = 22;
const MIN_DISTANCE = 450;
const MAX_DISTANCE = 1800;

/** "目的地へ向かえ" missions: pick a real POI nearby and race to it against the clock. */
export class Missions {
  current: Mission | null = null;
  readonly arrow: Mesh;
  private serial = 0;

  constructor(private readonly field: PoiField) {
    const geo = new ConeGeometry(0.55, 1.6, 12);
    geo.rotateX(Math.PI / 2); // tip along +Z
    this.arrow = new Mesh(geo, new MeshBasicMaterial({ color: 0xffe14d, depthTest: false }));
    this.arrow.renderOrder = 10;
    this.arrow.visible = false;
  }

  start(lat: number, lon: number, now: number): Mission | null {
    const candidates = this.field
      .near(lat, lon, MAX_DISTANCE)
      .filter((p) => this.field.isEnabled(p.category))
      .filter((p) => haversineMeters(lat, lon, p.lat, p.lon) >= MIN_DISTANCE);
    if (candidates.length === 0) {
      this.current = null;
      return null;
    }
    // Deterministic-but-varied choice without Math.random so missions are reproducible in tests.
    this.serial = (this.serial * 1103515245 + 12345 + Math.floor(now)) >>> 0;
    const target = candidates[this.serial % candidates.length];
    const startDistance = haversineMeters(lat, lon, target.lat, target.lon);
    this.current = {
      target,
      startedAt: now,
      timeLimit: Math.round(startDistance / 9 + 40),
      startDistance,
    };
    return this.current;
  }

  remaining(now: number): number {
    if (!this.current) return 0;
    return this.current.timeLimit - (now - this.current.startedAt) / 1000;
  }

  /** Returns a result on arrival, "timeout" when the clock runs out, otherwise null. */
  check(lat: number, lon: number, now: number): MissionResult | "timeout" | null {
    const mission = this.current;
    if (!mission) return null;
    const distance = haversineMeters(lat, lon, mission.target.lat, mission.target.lon);
    if (distance <= ARRIVE_RADIUS) {
      const left = Math.max(0, this.remaining(now));
      this.current = null;
      return {
        target: mission.target,
        reward: Math.round(200 + mission.startDistance / 5 + left * 8),
        seconds: (now - mission.startedAt) / 1000,
      };
    }
    if (this.remaining(now) <= 0) {
      this.current = null;
      return "timeout";
    }
    return null;
  }

  /** Point the floating arrow above the car at the target. */
  updateArrow(car: Object3D, targetLocal: Vector3 | null): void {
    this.arrow.visible = targetLocal !== null;
    if (!targetLocal) return;
    this.arrow.position.copy(car.position).add(new Vector3(0, 3.2, 0));
    const flat = targetLocal.clone();
    flat.y = this.arrow.position.y;
    this.arrow.lookAt(flat);
  }
}
