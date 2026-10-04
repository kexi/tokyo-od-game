import {
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  Vector3,
  type Scene,
} from "three";
import { laneOffset, leftOf } from "../world/roads";
import { pointAt } from "./junctionView";
import type { Route, Turn } from "./navigation";

/**
 * Route guidance in the street itself, as floating green 3D arrows (AR navigation style) rather
 * than a line painted on the road: chevrons hovering over the lane for the next stretch, a big
 * upright turn arrow over the junction of the next turn, and a downward arrow over the
 * destination. A handful of meshes, re-posed every frame (no rebuilds).
 */
const AHEAD = 150; // m of chevrons ahead of the car
const SPACING = 10;
const FIRST = 9; // the first chevron, clear of the car's bonnet
const HOVER = 0.9; // chevrons' height above the road
const TURN_SHOW = 220; // the turn arrow appears this far before the turn
const SIGN_HEIGHT = 4.2; // turn arrow centre above the junction
const COUNT = Math.ceil((AHEAD - FIRST) / SPACING) + 1;
const UP = new Vector3(0, 1, 0);

function extrude(points: Array<[number, number]>, depth: number): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** A chevron pointing +Z, lying flat (shape in XZ, thickness along Y). */
function chevronGeometry(): ExtrudeGeometry {
  const g = extrude(
    [
      [0, 0.55],
      [0.85, -0.3],
      [0.85, -0.78],
      [0, 0.07],
      [-0.85, -0.78],
      [-0.85, -0.3],
    ],
    0.16,
  );
  g.rotateX(Math.PI / 2); // shape +Y → +Z (forward)
  return g;
}

/** Upright arrow facing local +Z; +X is the viewer's right. */
function turnGeometry(turn: Turn): ExtrudeGeometry {
  const right: Array<[number, number]> = [
    [-0.32, -1.6],
    [0.32, -1.6],
    [0.32, -0.3],
    [0.9, -0.3],
    [0.9, -0.8],
    [1.75, 0],
    [0.9, 0.8],
    [0.9, 0.32],
    [-0.32, 0.32],
  ];
  const straight: Array<[number, number]> = [
    [-0.32, -1.6],
    [0.32, -1.6],
    [0.32, 0.4],
    [0.8, 0.4],
    [0, 1.4],
    [-0.8, 0.4],
    [-0.32, 0.4],
  ];
  const slight = (side: 1 | -1) => {
    const g = extrude(straight, 0.28);
    g.rotateZ(-side * (Math.PI / 4));
    return g;
  };
  switch (turn) {
    case "right":
    case "uturn":
      return extrude(right, 0.28);
    case "left":
      return extrude(right.map(([x, y]) => [-x, y] as [number, number]).reverse(), 0.28);
    case "slightRight":
      return slight(1);
    case "slightLeft":
      return slight(-1);
    default:
      return extrude(straight, 0.28);
  }
}

export class RouteArrows {
  private readonly group = new Group();
  private readonly material: MeshStandardMaterial;
  private readonly chevrons: InstancedMesh;
  private readonly turnArrows = new Map<Turn, Mesh>();
  private readonly goal: Mesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3(1, 1, 1);

  constructor(
    scene: Scene,
    private readonly groundAt: (x: number, z: number) => number | null,
  ) {
    // Emissive so the arrows still read at night and against PLATEAU façades.
    this.material = new MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x0e9f45,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0,
      transparent: true,
      opacity: 0.92,
    });
    this.chevrons = new InstancedMesh(chevronGeometry(), this.material, COUNT);
    this.chevrons.frustumCulled = false;
    this.group.add(this.chevrons);
    for (const turn of ["right", "left", "slightRight", "slightLeft", "straight", "uturn"] as Turn[]) {
      const mesh = new Mesh(turnGeometry(turn), this.material);
      mesh.scale.setScalar(1.5);
      mesh.visible = false;
      this.turnArrows.set(turn, mesh);
      this.group.add(mesh);
    }
    this.goal = new Mesh(turnGeometry("straight"), this.material);
    this.goal.rotation.z = Math.PI; // pointing down at the spot
    this.goal.visible = false;
    this.group.add(this.goal);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** The arrows' root, for views that must not show them (a bystander's photo). */
  get object(): Group {
    return this.group;
  }

  /** `at` is the car's distance along the route; null hides the arrows. */
  update(route: Route | null, at: number, now: number): void {
    this.group.visible = route !== null;
    if (!route) return;
    const bob = Math.sin(now / 420) * 0.12;
    // Chevrons over the lane for the next stretch; they step forward with the car.
    const phase = at % SPACING;
    let n = 0;
    for (let k = 0; k < COUNT; k++) {
      const d = at + FIRST + k * SPACING - phase;
      if (d > route.length - 2) break;
      const pose = this.laneAt(route, d);
      if (!pose) continue;
      // Fade the near ones by shrinking, so the closest never pops in front of the camera.
      const near = Math.min(1, (d - at - FIRST + phase) / 8);
      this.q.setFromAxisAngle(UP, Math.atan2(pose.dir.x, pose.dir.z));
      this.s.setScalar(0.55 + 0.45 * near);
      pose.pos.y += HOVER + bob * 0.5;
      this.m.compose(pose.pos, this.q, this.s);
      this.chevrons.setMatrixAt(n++, this.m);
    }
    this.chevrons.count = n;
    this.chevrons.instanceMatrix.needsUpdate = true;
    // The next turn: a big arrow standing over the junction, facing the way the car comes.
    for (const arrow of this.turnArrows.values()) arrow.visible = false;
    const next = route.maneuvers.find((mv) => mv.at > at - 4);
    if (next && next.at - at < TURN_SHOW) {
      const arrow = this.turnArrows.get(next.turn);
      const before = pointAt(route, Math.max(0, next.at - 6));
      const dir = pointAt(route, next.at).sub(before).setY(0);
      if (arrow && dir.lengthSq() > 1e-6) {
        dir.normalize();
        const p = next.pos.clone().addScaledVector(dir, 3);
        p.y = (this.groundAt(p.x, p.z) ?? p.y) + SIGN_HEIGHT + bob;
        arrow.position.copy(p);
        arrow.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
        arrow.visible = true;
      }
    }
    // The destination.
    const remaining = route.length - at;
    this.goal.visible = route.reachesTarget && remaining < TURN_SHOW;
    if (this.goal.visible) {
      const end = pointAt(route, route.length);
      const before = pointAt(route, Math.max(0, route.length - 5));
      const dir = end.clone().sub(before).setY(0);
      end.y = (this.groundAt(end.x, end.z) ?? end.y) + 3.2 + bob;
      this.goal.position.copy(end);
      this.goal.rotation.set(0, dir.lengthSq() > 1e-6 ? Math.atan2(-dir.x, -dir.z) : 0, Math.PI);
    }
  }

  clear(): void {
    this.group.visible = false;
  }

  /** Point in the car's lane (keep-left offset) and the route direction at distance `d`. */
  private laneAt(route: Route, d: number): { pos: Vector3; dir: Vector3 } | null {
    const p = pointAt(route, d);
    const dir = pointAt(route, Math.min(route.length, d + 1))
      .sub(p)
      .setY(0);
    if (dir.lengthSq() < 1e-8) return null;
    dir.normalize();
    let i = 1;
    while (i < route.cum.length - 1 && route.cum[i] < d) i++;
    const seg = route.steps[route.stepOf[i]]?.seg;
    const pos = p.add(leftOf(dir, seg ? laneOffset(seg) : 0));
    pos.y = this.groundAt(pos.x, pos.z) ?? pos.y;
    return { pos, dir };
  }
}
