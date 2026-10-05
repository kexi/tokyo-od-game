import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Scene } from "three";
import { ODPT } from "../config";
// As a namespace: `t` is the buses' progress along their legs here.
import * as i18n from "../i18n";
import { warn } from "../log";
import { haversineMeters } from "../geo/ellipsoid";
import type { LocalFrame } from "../geo/frame";
import type { DemStore } from "./dem";

type BusRecord = {
  "owl:sameAs": string;
  "odpt:note"?: string;
  "odpt:fromBusstopPole"?: string;
  "odpt:toBusstopPole"?: string;
  "odpt:fromBusstopPoleTime"?: string;
};

type Bus = {
  id: string;
  note: string;
  from: [number, number];
  to: [number, number] | null;
  departed: number;
  object: Group;
  body: RAPIER.RigidBody | null;
  lat: number;
  lon: number;
};

const POLL_MS = 30_000;
const BUS_SPEED = 5.5; // m/s average between stops (Tokyo city bus incl. signals)
const DRAW_RADIUS = 2500;
const BODY_RADIUS = 350;

/**
 * Live Toei buses from ODPT's key-free public API. Positions are only reported as
 * "between stop A and stop B", so each bus is interpolated along that segment and turned into
 * a kinematic obstacle the player's car can bump into.
 */
export class Transit {
  private readonly buses = new Map<string, Bus>();
  private readonly geometry = new BoxGeometry(2.5, 3.0, 10.5);
  private readonly materials = [
    new MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 }),
    new MeshStandardMaterial({ color: 0x2f9e5a, roughness: 0.5 }),
  ];
  private lastPoll = -Infinity;
  private frame: LocalFrame;
  private feed: "loading" | "running" | "failed" = "loading";
  /** The HUD's line about the buses, in the language in force. */
  get status(): string {
    if (this.feed === "running") return i18n.t("transit.running", { n: this.buses.size });
    return i18n.t(this.feed === "failed" ? "transit.failed" : "transit.loading");
  }

  constructor(
    private readonly scene: Scene,
    private readonly world: RAPIER.World,
    private readonly dem: DemStore,
    private readonly stops: Record<string, [number, number]>,
    frame: LocalFrame,
  ) {
    this.frame = frame;
  }

  setFrame(frame: LocalFrame): void {
    this.frame = frame;
    // Kinematic bodies would "teleport" with huge implied velocity; recreate them instead.
    for (const bus of this.buses.values()) this.dropBody(bus);
  }

  count(): number {
    return this.buses.size;
  }

  positionsNear(lat: number, lon: number, radius: number): Array<{ lat: number; lon: number }> {
    return [...this.buses.values()].filter((b) => haversineMeters(lat, lon, b.lat, b.lon) < radius);
  }

  nearest(lat: number, lon: number): { bus: Bus; distance: number } | null {
    let best: { bus: Bus; distance: number } | null = null;
    for (const bus of this.buses.values()) {
      const d = haversineMeters(lat, lon, bus.lat, bus.lon);
      if (!best || d < best.distance) best = { bus, distance: d };
    }
    return best;
  }

  /**
   * Optional road snapping: ODPT only says "between stop A and stop B", so the straight-line
   * position is moved onto the nearest road's left lane (Japan drives on the left).
   */
  snap: ((p: Vector3, heading: number) => { pos: Vector3; heading: number } | null) | null = null;

  update(now: number, lat: number, lon: number, player: Vector3): void {
    if (now - this.lastPoll > POLL_MS) {
      this.lastPoll = now;
      void this.poll();
    }
    const up = new Vector3(0, 1, 0);
    for (const bus of this.buses.values()) {
      const [blat, blon, heading] = this.interpolate(bus, Date.now());
      bus.lat = blat;
      bus.lon = blon;
      const isDrawn = haversineMeters(lat, lon, blat, blon) < DRAW_RADIUS;
      bus.object.visible = isDrawn;
      if (!isDrawn) {
        this.dropBody(bus);
        continue;
      }
      const ground = this.dem.heightAt(blat, blon) ?? this.frame.origin.h;
      let p = this.frame.toLocal(blat, blon, ground + 1.55);
      let yaw = heading;
      const snapped = this.snap?.(p, heading);
      if (snapped) {
        p = snapped.pos.setY(p.y);
        yaw = snapped.heading;
      }
      const q = new Quaternion().setFromAxisAngle(up, yaw);
      bus.object.position.copy(p);
      bus.object.quaternion.copy(q);
      const isNear = p.distanceTo(player) < BODY_RADIUS;
      if (isNear && !bus.body) {
        bus.body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z).setRotation(q),
        );
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.25, 1.5, 5.25), bus.body);
      } else if (!isNear) {
        this.dropBody(bus);
      }
      bus.body?.setNextKinematicTranslation(p);
      bus.body?.setNextKinematicRotation(q);
    }
  }

  private dropBody(bus: Bus): void {
    if (!bus.body) return;
    this.world.removeRigidBody(bus.body);
    bus.body = null;
  }

  /** Returns [lat, lon, yaw] where yaw rotates +Z (bus front) toward the next stop. */
  private interpolate(bus: Bus, nowMs: number): [number, number, number] {
    if (!bus.to) return [bus.from[0], bus.from[1], 0];
    const distance = haversineMeters(bus.from[0], bus.from[1], bus.to[0], bus.to[1]);
    const t = distance > 1 ? Math.min(1, ((nowMs - bus.departed) / 1000) * (BUS_SPEED / distance)) : 1;
    const lat = bus.from[0] + (bus.to[0] - bus.from[0]) * t;
    const lon = bus.from[1] + (bus.to[1] - bus.from[1]) * t;
    const a = this.frame.toLocal(bus.from[0], bus.from[1], this.frame.origin.h);
    const b = this.frame.toLocal(bus.to[0], bus.to[1], this.frame.origin.h);
    return [lat, lon, Math.atan2(b.x - a.x, b.z - a.z)];
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(ODPT.toeiBus);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const records = (await res.json()) as BusRecord[];
      const seen = new Set<string>();
      for (const r of records) {
        const from = r["odpt:fromBusstopPole"] && this.stops[r["odpt:fromBusstopPole"]];
        if (!from) continue;
        const toId = r["odpt:toBusstopPole"];
        const to = (toId && this.stops[toId]) || null;
        const id = r["owl:sameAs"];
        seen.add(id);
        const departed = r["odpt:fromBusstopPoleTime"]
          ? Date.parse(r["odpt:fromBusstopPoleTime"])
          : Date.now();
        const existing = this.buses.get(id);
        if (existing) {
          Object.assign(existing, { from, to, departed, note: r["odpt:note"] ?? "" });
          continue;
        }
        this.buses.set(id, {
          id,
          note: r["odpt:note"] ?? "",
          from,
          to,
          departed,
          object: this.createMesh(),
          body: null,
          lat: from[0],
          lon: from[1],
        });
      }
      for (const [id, bus] of this.buses) {
        if (seen.has(id)) continue;
        this.dropBody(bus);
        this.scene.remove(bus.object);
        this.buses.delete(id);
      }
      this.feed = "running";
    } catch (error) {
      this.feed = "failed";
      warn("odpt_poll_failed", { error: String(error) });
    }
  }

  private createMesh(): Group {
    const group = new Group();
    const body = new Mesh(this.geometry, this.materials[0]);
    const stripe = new Mesh(new BoxGeometry(2.52, 0.5, 10.52), this.materials[1]);
    stripe.position.y = -0.6;
    group.add(body, stripe);
    group.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
    this.scene.add(group);
    return group;
  }
}
