import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";

export type HumanColors = { shirt: number; pants: number; skin: number; hair: number; umbrella: number };

export type HumanModel = {
  root: Group;
  legs: [Group, Group];
  arms: [Group, Group];
  umbrella: Group;
};

const materials = new Map<number, MeshStandardMaterial>();
function mat(color: number): MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.8 });
    materials.set(color, m);
  }
  return m;
}

/** Low-poly person (~1.7 m) with pivoting limbs for a walk cycle. Feet at y = 0, facing +Z. */
export function createHuman(colors: HumanColors, height = 1): HumanModel {
  const root = new Group();
  const torso = new Mesh(new CapsuleGeometry(0.2, 0.42, 4, 8), mat(colors.shirt));
  torso.position.y = 1.18;
  const head = new Mesh(new SphereGeometry(0.13, 12, 10), mat(colors.skin));
  head.position.y = 1.62;
  const hair = new Mesh(new SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(colors.hair));
  hair.position.y = 1.64;
  const nose = new Mesh(new BoxGeometry(0.03, 0.04, 0.04), mat(colors.skin));
  nose.position.set(0, 1.6, 0.13);
  root.add(torso, head, hair, nose);

  const limb = (w: number, h: number, color: number, x: number, y: number) => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const m = new Mesh(new BoxGeometry(w, h, w), mat(color));
    m.position.y = -h / 2;
    pivot.add(m);
    root.add(pivot);
    return pivot;
  };
  const legs: [Group, Group] = [
    limb(0.13, 0.82, colors.pants, -0.1, 0.84),
    limb(0.13, 0.82, colors.pants, 0.1, 0.84),
  ];
  const arms: [Group, Group] = [
    limb(0.09, 0.6, colors.shirt, -0.27, 1.4),
    limb(0.09, 0.6, colors.shirt, 0.27, 1.4),
  ];

  const umbrella = new Group();
  const canopy = new Mesh(new ConeGeometry(0.55, 0.25, 12, 1, true), mat(colors.umbrella));
  canopy.position.y = 2.05;
  const shaft = new Mesh(new CylinderGeometry(0.01, 0.01, 0.7), mat(0x222222));
  shaft.position.y = 1.75;
  umbrella.add(canopy, shaft);
  umbrella.position.x = -0.2;
  umbrella.visible = false;
  root.add(umbrella);

  root.scale.setScalar(height);
  root.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  return { root, legs, arms, umbrella };
}

/** Advance the walk cycle; speed in m/s. */
export function animateHuman(h: HumanModel, phase: number, speed: number, holdingUmbrella: boolean): void {
  const swing = speed > 0.05 ? Math.sin(phase) * Math.min(0.9, 0.35 + speed * 0.12) : 0;
  h.legs[0].rotation.x = swing;
  h.legs[1].rotation.x = -swing;
  h.arms[0].rotation.x = holdingUmbrella ? -1.2 : -swing * 0.8;
  h.arms[1].rotation.x = swing * 0.8;
  h.umbrella.visible = holdingUmbrella;
}

export function disposeHuman(h: HumanModel): void {
  h.root.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
