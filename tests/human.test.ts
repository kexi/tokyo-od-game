import { Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { beforeAll, expect, it, vi } from "vitest";
import { animateHuman, createHuman, disposeHuman, loadHumanModels } from "../src/world/human";

vi.mock("../src/render/draco", () => ({ sharedDraco: () => ({}) }));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setDRACOLoader() {
      return this;
    }
    async loadAsync() {
      const scene = new Group();
      for (const name of [
        "Torso",
        "Head",
        "HairShort",
        "HairLong",
        "HairBun",
        "UpperArmL",
        "UpperArmR",
        "ForearmL",
        "ForearmR",
        "ThighL",
        "ThighR",
        "ShinL",
        "ShinR",
      ]) {
        const part = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
        part.name = name;
        (part.material as MeshStandardMaterial).name = "Skin";
        scene.add(part);
      }
      return { scene };
    }
  },
}));
const colors = { shirt: 0x111111, pants: 0x222222, skin: 0x333333, hair: 0x444444, umbrella: 0x555555 };
beforeAll(async () => {
  await loadHumanModels();
});

it("shares umbrella vertices between people while keeping their transforms and animation independent", () => {
  const a = createHuman(colors, 0.9, 0),
    b = createHuman(colors, 1.1, 1);
  expect((a.umbrella.children[0] as Mesh).geometry).toBe((b.umbrella.children[0] as Mesh).geometry);
  expect((a.umbrella.children[1] as Mesh).geometry).toBe((b.umbrella.children[1] as Mesh).geometry);
  expect(a.umbrella).not.toBe(b.umbrella);
  expect(a.root.scale.y).toBe(0.9);
  expect(b.root.scale.y).toBe(1.1);
  animateHuman(a, 0.7, 1.4, true);
  expect(a.umbrella.visible).toBe(true);
  expect(b.umbrella.visible).toBe(false);
  expect(a.legs[0].quaternion.toArray()).not.toEqual(b.legs[0].quaternion.toArray());
});

it("disposes per-person attachments without freeing shared body or umbrella geometry used by other people", () => {
  const a = createHuman(colors),
    b = createHuman(colors);
  const shared = vi.spyOn((a.umbrella.children[0] as Mesh).geometry, "dispose");
  const attachment = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
  const owned = vi.spyOn(attachment.geometry, "dispose");
  a.root.add(attachment);
  disposeHuman(a);
  expect(shared).not.toHaveBeenCalled();
  expect(owned).toHaveBeenCalledOnce();
  expect((b.umbrella.children[0] as Mesh).geometry).toBe((a.umbrella.children[0] as Mesh).geometry);
  disposeHuman(b);
  expect(shared).not.toHaveBeenCalled();
});
