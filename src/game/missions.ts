import { ConeGeometry, Mesh, MeshBasicMaterial, Vector3, type Object3D } from "three";
import type { Poi } from "../data/schema";
import { haversineMeters } from "../geo/ellipsoid";
import type { PoiField } from "./pois";

export type Mission = {
  target: Poi;
  startedAt: number;
  timeLimit: number; // seconds (Infinity: no clock)
  startDistance: number;
  /** The opening drive to a well-known place a few km away, by the rules and without a clock. */
  isTrip?: boolean;
  /** Driving home to end the day (the post, the day's record, any 行政処分). */
  isHome?: boolean;
};

export type MissionResult = { target: Poi; reward: number; seconds: number };

const ARRIVE_RADIUS = 22;
const MIN_DISTANCE = 450;
const MAX_DISTANCE = 1800;
const TRIP_MIN = 4000;
const TRIP_MAX = 6000;

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

  /**
   * The game opens with a drive: a station 4–6 km away (the ones people know by name, so the
   * guidance reads like a real trip), no clock — the point is to get there by the rules.
   */
  startTrip(lat: number, lon: number, now: number): Mission | null {
    const candidates = this.field
      .near(lat, lon, TRIP_MAX)
      .filter((p) => p.category === "station")
      .filter((p) => haversineMeters(lat, lon, p.lat, p.lon) >= TRIP_MIN);
    if (candidates.length === 0) return null;
    this.serial = (this.serial * 1103515245 + 12345 + Math.floor(now)) >>> 0;
    const target = candidates[this.serial % candidates.length];
    this.current = {
      target,
      startedAt: now,
      timeLimit: Infinity,
      startDistance: haversineMeters(lat, lon, target.lat, target.lon),
      isTrip: true,
    };
    return this.current;
  }

  /** Go and appear (出頭) at a police station or licence centre; the counter closes at 17:00. */
  startAppointment(
    place: { name: string; lat: number; lon: number },
    now: number,
    lat: number,
    lon: number,
  ): Mission {
    const target: Poi = {
      id: -2,
      category: "appointment",
      lat: place.lat,
      lon: place.lon,
      name: place.name,
      ward: "",
      source: -2,
    };
    this.current = {
      target,
      startedAt: now,
      timeLimit: Infinity,
      startDistance: haversineMeters(lat, lon, place.lat, place.lon),
      isTrip: true,
    };
    return this.current;
  }

  /**
   * A place the driver chose (目的地): guided there by the navi, with no clock and no points (the
   * points stay with the missions the game picks, so a place next door is not a free reward).
   */
  startChosen(
    place: { name: string; lat: number; lon: number; ward?: string },
    now: number,
    lat: number,
    lon: number,
  ): Mission {
    const target: Poi = {
      id: -3,
      category: "destination",
      lat: place.lat,
      lon: place.lon,
      name: place.name,
      ward: place.ward ?? "",
      source: -3,
    };
    this.current = {
      target,
      startedAt: now,
      timeLimit: Infinity,
      startDistance: haversineMeters(lat, lon, place.lat, place.lon),
      isTrip: true,
    };
    return this.current;
  }

  /** 案内をやめる: no destination, no guidance. */
  clear(): void {
    this.current = null;
  }

  /** Drive home: the day ends on arrival. */
  startHome(home: { lat: number; lon: number }, now: number, lat: number, lon: number): Mission {
    const target: Poi = {
      id: -1,
      category: "home",
      lat: home.lat,
      lon: home.lon,
      name: "自宅",
      ward: "",
      source: -1,
    };
    this.current = {
      target,
      startedAt: now,
      timeLimit: Infinity,
      startDistance: haversineMeters(lat, lon, home.lat, home.lon),
      isTrip: true,
      isHome: true,
    };
    return this.current;
  }

  remaining(now: number): number {
    if (!this.current) return 0;
    return this.current.timeLimit - (now - this.current.startedAt) / 1000;
  }

  /** Returns a result on arrival, "timeout" when the clock runs out, otherwise null. */
  /**
   * `isRouteDone`: the navi's route reached its end, the street nearest the target. A chosen place
   * (a park, an airport, a station building) can lie far inside from any street, so for those the
   * end of the route is the arrival; the game's own spots keep the 22 m radius.
   */
  check(lat: number, lon: number, now: number, isRouteDone = false): MissionResult | "timeout" | null {
    const mission = this.current;
    if (!mission) return null;
    const distance = haversineMeters(lat, lon, mission.target.lat, mission.target.lon);
    const isChosenReached = isRouteDone && mission.target.category === "destination";
    if (distance <= ARRIVE_RADIUS || isChosenReached) {
      const left = Number.isFinite(mission.timeLimit) ? Math.max(0, this.remaining(now)) : 0;
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
