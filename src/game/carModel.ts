import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Material,
} from "three";

/**
 * Procedural compact hatchback (~4.3 m × 1.84 m × 1.45 m), built from extruded side profiles so
 * no third-party 3D asset (and its licence) is needed. Chassis frame: +Z forward, +Y up,
 * origin at the physics body centre; the ground sits ~0.86 m below it at rest.
 */
export type CarModel = {
  root: Group;
  wheels: Group[]; // FL, FR, RL, RR — matches the physics wheel order
  headlights: SpotLight[];
  setLights(state: { brake: boolean; reverse: boolean; left: boolean; right: boolean; night: boolean }): void;
};

export const WHEEL_RADIUS = 0.36;
const LENGTH = 4.3;
const WIDTH = 1.84;
const ARCH_Z = 1.35;
const ARCH_Y = -0.5;
const ARCH_R = 0.43;

const BEVEL = 0.035; // outline growth of the body extrusion (bevelSize)

function sideProfile(): Shape {
  // Side silhouette of the lower body in the (z, y) plane, with both wheel arches cut out.
  const s = new Shape();
  s.moveTo(2.08, -0.5);
  s.lineTo(ARCH_Z + ARCH_R, -0.5);
  s.absarc(ARCH_Z, ARCH_Y, ARCH_R, 0, Math.PI, false);
  s.lineTo(-ARCH_Z + ARCH_R, -0.5);
  s.absarc(-ARCH_Z, ARCH_Y, ARCH_R, 0, Math.PI, false);
  s.lineTo(-2.08, -0.5);
  s.quadraticCurveTo(-2.15, -0.48, -2.15, -0.38); // rear bumper corner
  s.lineTo(-2.15, 0.02); // rear face
  s.quadraticCurveTo(-2.14, 0.2, -2.04, 0.25); // tailgate lip
  s.lineTo(-1.62, 0.24);
  s.lineTo(0.92, 0.18); // beltline
  s.bezierCurveTo(1.45, 0.17, 1.85, 0.12, 2.06, 0.04); // bonnet
  s.quadraticCurveTo(2.14, 0.0, 2.15, -0.08); // nose
  s.lineTo(2.15, -0.4); // front face
  s.quadraticCurveTo(2.15, -0.49, 2.08, -0.5);
  return s;
}

/** Outermost z of the body surface at height y (front if sign = 1, rear if -1), incl. bevel. */
function surfaceZ(y: number, sign: 1 | -1): number {
  const pts = sideProfile().getPoints(48);
  let best = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const crosses = (a.y - y) * (b.y - y) <= 0 && a.y !== b.y;
    if (!crosses) continue;
    const z = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (z * sign > best * sign) best = z;
  }
  return best + sign * BEVEL;
}

function greenhouseProfile(): Shape {
  const s = new Shape();
  s.moveTo(0.95, 0.17);
  s.bezierCurveTo(0.7, 0.3, 0.45, 0.5, 0.18, 0.585); // windscreen
  s.lineTo(-0.95, 0.6); // roof
  s.bezierCurveTo(-1.35, 0.58, -1.6, 0.42, -1.66, 0.22); // hatch glass
  s.lineTo(0.95, 0.17);
  return s;
}

function extrude(shape: Shape, width: number, bevel: number, round = bevel): BufferGeometry {
  // `bevel` grows the outline; `round` rounds the edges across the width.
  const g = new ExtrudeGeometry(shape, {
    depth: width - round * 2,
    bevelEnabled: true,
    bevelThickness: round,
    bevelSize: bevel,
    bevelSegments: 5,
    curveSegments: 28,
  });
  // Extrusion runs along +Z of the shape space; turn it so the profile's x becomes chassis z.
  g.translate(0, 0, -(width - round * 2) / 2);
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function plateTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 330;
  c.height = 165;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#f7f7f2";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#1e6b3a";
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
    ctx.fillStyle = "#1e6b3a";
    ctx.textAlign = "center";
    ctx.font = "bold 40px 'Hiragino Sans', sans-serif";
    ctx.fillText("東京 23", c.width / 2, 58);
    ctx.font = "bold 30px 'Hiragino Sans', sans-serif";
    ctx.fillText("と", 46, 128);
    ctx.font = "bold 74px 'Hiragino Sans', sans-serif";
    ctx.fillText("20-26", c.width / 2 + 24, 140);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function wheel(materials: { tire: Material; rim: Material; caliper: Material; disc: Material }): Group {
  const g = new Group();
  // Tyre: lathe of a rounded rectangle cross-section, axis along X.
  const pts: Vector2[] = [];
  const r = WHEEL_RADIUS;
  const w = 0.125;
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    pts.push(new Vector2(r - 0.05 + Math.cos(a) * 0.05, Math.sin(a) * w));
  }
  pts.unshift(new Vector2(r - 0.13, -w));
  pts.push(new Vector2(r - 0.13, w));
  const tire = new Mesh(new LatheGeometry(pts, 32).rotateZ(Math.PI / 2), materials.tire);
  const rim = new Mesh(new CylinderGeometry(r - 0.12, r - 0.12, 0.2, 24).rotateZ(Math.PI / 2), materials.rim);
  const face = new Group();
  face.position.x = 0.1;
  for (let i = 0; i < 5; i++) {
    const spoke = new Mesh(new BoxGeometry(0.04, 0.19, 0.055), materials.rim);
    spoke.position.y = 0.11;
    const holder = new Group();
    holder.rotation.x = (i / 5) * Math.PI * 2;
    holder.add(spoke);
    face.add(holder);
  }
  const ring = new Mesh(new TorusGeometry(r - 0.125, 0.018, 8, 32).rotateY(Math.PI / 2), materials.rim);
  const cap = new Mesh(new CylinderGeometry(0.05, 0.05, 0.03, 16).rotateZ(Math.PI / 2), materials.caliper);
  face.add(ring, cap);
  const disc = new Mesh(new CylinderGeometry(0.17, 0.17, 0.02, 24).rotateZ(Math.PI / 2), materials.disc);
  disc.position.x = 0.02;
  g.add(tire, rim, face, disc);
  return g;
}

export function createCarModel(color = 0x1f5fbf): CarModel {
  const paint = new MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const glass = new MeshPhysicalMaterial({
    color: 0x0b1118,
    metalness: 0.1,
    roughness: 0.04,
    clearcoat: 1,
    transparent: true,
    opacity: 0.88,
  });
  const black = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
  const chrome = new MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 });
  const rimMat = new MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.28 });
  const tireMat = new MeshStandardMaterial({ color: 0x18181a, roughness: 0.92 });
  const caliper = new MeshStandardMaterial({ color: 0xc8202a, roughness: 0.45 });
  const disc = new MeshStandardMaterial({ color: 0x777b80, metalness: 0.8, roughness: 0.45 });
  const headLens = new MeshStandardMaterial({
    color: 0xf4f7ff,
    emissive: 0xfff4dc,
    emissiveIntensity: 0.3,
    metalness: 0.4,
    roughness: 0.1,
  });
  const drl = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 });
  const tailMat = new MeshStandardMaterial({
    color: 0x4a0508,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.6,
    roughness: 0.25,
  });
  const reverseMat = new MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 });
  const amberL = new MeshStandardMaterial({ color: 0x6b3a00, emissive: 0xff9a1a, emissiveIntensity: 0 });
  const amberR = amberL.clone();
  const plateMat = new MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 });

  const root = new Group();
  root.name = "car";

  const body = new Mesh(extrude(sideProfile(), WIDTH, BEVEL, 0.09), paint);
  const cabin = new Mesh(extrude(greenhouseProfile(), WIDTH - 0.3, 0.06), glass);
  const roofShape = new Shape();
  roofShape.moveTo(0.16, 0.585);
  roofShape.lineTo(-0.94, 0.6);
  roofShape.lineTo(-0.94, 0.625);
  roofShape.lineTo(0.12, 0.61);
  const roof = new Mesh(extrude(roofShape, WIDTH - 0.38, 0.03), paint);
  root.add(body, cabin, roof);

  // Pillars and window trim on both sides.
  for (const side of [-1, 1]) {
    const x = side * (WIDTH / 2 - 0.16);
    const aPillar = new Mesh(new BoxGeometry(0.06, 0.52, 0.07), paint);
    aPillar.position.set(x, 0.38, 0.58);
    aPillar.rotation.x = -0.95;
    const bPillar = new Mesh(new BoxGeometry(0.05, 0.42, 0.09), black);
    bPillar.position.set(x + side * 0.005, 0.38, -0.32);
    const cPillar = new Mesh(new BoxGeometry(0.06, 0.4, 0.22), paint);
    cPillar.position.set(x, 0.38, -1.3);
    cPillar.rotation.x = 0.55;
    const belt = new Mesh(new BoxGeometry(0.03, 0.025, 2.55), chrome);
    belt.position.set(side * (WIDTH / 2 - 0.13), 0.185, -0.35);
    // Door shut lines and handles.
    const doorLineF = new Mesh(new BoxGeometry(0.012, 0.55, 0.012), black);
    doorLineF.position.set(side * (WIDTH / 2 + 0.001), -0.12, 0.85);
    const doorLineM = doorLineF.clone();
    doorLineM.position.z = -0.3;
    const doorLineR = doorLineF.clone();
    doorLineR.position.z = -1.32;
    const handleF = new Mesh(new BoxGeometry(0.03, 0.035, 0.16), chrome);
    handleF.position.set(side * (WIDTH / 2 + 0.01), 0.07, 0.15);
    const handleR = handleF.clone();
    handleR.position.z = -0.85;
    // Side mirror on a short stalk.
    const mirror = new Group();
    const stalk = new Mesh(new BoxGeometry(0.1, 0.03, 0.06), black);
    stalk.position.x = side * 0.05;
    const housing = new Mesh(new SphereGeometry(0.1, 18, 12), paint);
    housing.scale.set(1.05, 0.62, 0.5);
    housing.position.x = side * 0.14;
    const glassFace = new Mesh(new PlaneGeometry(0.17, 0.09), chrome);
    glassFace.position.set(side * 0.14, 0, -0.045);
    glassFace.rotation.y = Math.PI;
    mirror.add(stalk, housing, glassFace);
    mirror.position.set(side * (WIDTH / 2 - 0.06), 0.25, 0.82);
    const sideSkirt = new Mesh(new BoxGeometry(0.04, 0.07, 1.75), black);
    sideSkirt.position.set(side * (WIDTH / 2 + 0.01), -0.49, 0);
    root.add(
      aPillar,
      bPillar,
      cPillar,
      belt,
      doorLineF,
      doorLineM,
      doorLineR,
      handleF,
      handleR,
      mirror,
      sideSkirt,
    );
  }

  // Front: grille, headlights with DRL strip, bumper intake, plate, wipers.
  const front = (y: number, depth: number) => surfaceZ(y, 1) - depth / 2 + 0.012;
  const rear = (y: number, depth: number) => surfaceZ(y, -1) + depth / 2 - 0.012;
  const grille = new Mesh(new BoxGeometry(0.9, 0.17, 0.04), black);
  grille.position.set(0, -0.15, front(-0.15, 0.04));
  root.add(grille);
  for (let i = 0; i < 3; i++) {
    const bar = new Mesh(new BoxGeometry(0.86, 0.016, 0.02), chrome);
    bar.position.set(0, -0.2 + i * 0.05, front(-0.15, 0.02) + 0.015);
    root.add(bar);
  }
  const intake = new Mesh(new BoxGeometry(1.25, 0.1, 0.04), black);
  intake.position.set(0, -0.38, front(-0.38, 0.04));
  root.add(intake);
  const headlights: SpotLight[] = [];
  for (const side of [-1, 1]) {
    const lamp = new Mesh(new BoxGeometry(0.42, 0.11, 0.06), headLens);
    lamp.position.set(side * 0.6, -0.06, front(-0.06, 0.06));
    lamp.rotation.y = side * -0.12;
    const housing = new Mesh(new BoxGeometry(0.46, 0.14, 0.05), black);
    housing.position.set(side * 0.6, -0.06, front(-0.06, 0.05) - 0.006);
    housing.rotation.y = side * -0.12;
    const strip = new Mesh(new BoxGeometry(0.4, 0.018, 0.02), drl);
    strip.position.set(side * 0.6, -0.125, front(-0.125, 0.02));
    strip.rotation.y = side * -0.12;
    const fog = new Mesh(new SphereGeometry(0.04, 12, 8), headLens);
    fog.position.set(side * 0.72, -0.38, front(-0.38, 0.06));
    const indicator = new Mesh(new BoxGeometry(0.09, 0.045, 0.04), side < 0 ? amberL : amberR);
    indicator.position.set(side * 0.86, -0.06, front(-0.06, 0.04) - 0.02);
    root.add(housing, lamp, strip, fog, indicator);

    const light = new SpotLight(0xfff2d6, 0, 110, 0.48, 0.55, 1.1);
    light.position.set(side * 0.62, -0.03, 2.1);
    light.target.position.set(side * 0.9, -1.6, 28);
    root.add(light, light.target);
    headlights.push(light);
  }
  const plateF = new Mesh(new PlaneGeometry(0.33, 0.165), plateMat);
  plateF.position.set(0, -0.28, surfaceZ(-0.28, 1) + 0.004);
  root.add(plateF);
  for (const side of [-1, 1]) {
    const wiper = new Mesh(new BoxGeometry(0.55, 0.012, 0.02), black);
    wiper.position.set(side * 0.3, 0.2, 0.93);
    wiper.rotation.z = side * 0.08;
    root.add(wiper);
  }

  // Rear: wraparound tail lamps, reversing lights, plate, diffuser, exhaust, spoiler.
  for (const side of [-1, 1]) {
    const tail = new Mesh(new BoxGeometry(0.46, 0.11, 0.05), tailMat);
    tail.position.set(side * 0.62, 0.08, rear(0.08, 0.05));
    const tailSide = new Mesh(new BoxGeometry(0.05, 0.09, 0.2), tailMat);
    tailSide.position.set(side * (WIDTH / 2 + 0.005), 0.08, surfaceZ(0.08, -1) + 0.12);
    const rev = new Mesh(new BoxGeometry(0.12, 0.045, 0.03), reverseMat);
    rev.position.set(side * 0.42, -0.3, rear(-0.3, 0.03));
    const indicator = new Mesh(new BoxGeometry(0.12, 0.035, 0.04), side < 0 ? amberL : amberR);
    indicator.position.set(side * 0.62, 0.0, rear(0.0, 0.04));
    root.add(tail, tailSide, rev, indicator);
  }
  const plateR = new Mesh(new PlaneGeometry(0.33, 0.165), plateMat);
  plateR.position.set(0, -0.12, surfaceZ(-0.12, -1) - 0.004);
  plateR.rotation.y = Math.PI;
  const diffuser = new Mesh(new BoxGeometry(1.3, 0.1, 0.12), black);
  diffuser.position.set(0, -0.46, rear(-0.46, 0.12));
  const exhaust = new Mesh(new CylinderGeometry(0.045, 0.045, 0.18, 16).rotateX(Math.PI / 2), chrome);
  exhaust.position.set(0.45, -0.47, surfaceZ(-0.45, -1) - 0.02);
  const spoiler = new Mesh(new BoxGeometry(1.36, 0.035, 0.22), paint);
  spoiler.position.set(0, 0.62, -1.0);
  spoiler.rotation.x = 0.12;
  const fin = new Mesh(new BoxGeometry(0.05, 0.06, 0.16), black);
  fin.position.set(0, 0.65, -0.75);
  const underbody = new Mesh(new BoxGeometry(WIDTH - 0.2, 0.04, LENGTH - 0.4), black);
  underbody.position.y = -0.53;
  root.add(plateR, diffuser, exhaust, spoiler, fin, underbody);

  const wheels: Group[] = [];
  const order: Array<[number, number]> = [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (const [side, axle] of order) {
    const w = wheel({ tire: tireMat, rim: rimMat, caliper, disc });
    // Mirror the left-hand wheels so the spoke face always points outward.
    if (side < 0) w.scale.x = -1;
    // Holder steers; its first child (the wheel) spins; the caliper steers but does not spin.
    const brakeCaliper = new Mesh(new BoxGeometry(0.05, 0.1, 0.14), caliper);
    brakeCaliper.position.set(side * 0.05, 0.12, axle * -0.06);
    const holder = new Group();
    holder.add(w, brakeCaliper);
    wheels.push(holder);
  }

  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  for (const w of wheels) w.traverse((o) => o instanceof Mesh && (o.castShadow = true));

  return {
    root,
    wheels,
    headlights,
    setLights({ brake, reverse, left, right, night }) {
      tailMat.emissiveIntensity = brake ? 3.2 : night ? 1.1 : 0.45;
      reverseMat.emissiveIntensity = reverse ? 2.5 : 0;
      const blink = Math.floor(performance.now() / 380) % 2 === 0;
      amberL.emissiveIntensity = left && blink ? 3 : 0;
      amberR.emissiveIntensity = right && blink ? 3 : 0;
      headLens.emissiveIntensity = night ? 2.2 : 0.3;
      for (const l of headlights) l.intensity = night ? 70 : 0;
    },
  };
}
