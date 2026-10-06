import { Group, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { expect, it, vi } from "vitest";
import { cloneHumanPart } from "../src/world/humanParts";

it("copies rigid part state and children independently while sharing the original geometry and material", () => {
  const root = new Group(),
    mesh = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
  root.name = "Forearm";
  root.position.set(1, 2, 3);
  root.add(mesh);
  mesh.name = "Hand";
  mesh.position.set(4, 5, 6);
  mesh.rotation.set(0.1, 0.2, 0.3);
  mesh.scale.setScalar(0.9);
  mesh.castShadow = true;
  mesh.static = true;
  mesh.userData = { shared: true, value: { number: 7 } };
  root.updateMatrixWorld(true);
  const clone = vi.spyOn(mesh, "clone");
  const copy = cloneHumanPart(root),
    part = copy.children[0] as Mesh;
  expect(clone).not.toHaveBeenCalled();
  expect(copy).not.toBe(root);
  expect(part).not.toBe(mesh);
  expect(copy.position.toArray()).toEqual(root.position.toArray());
  expect(part.position.toArray()).toEqual(mesh.position.toArray());
  expect(part.quaternion.toArray()).toEqual(mesh.quaternion.toArray());
  expect(part.matrix.elements).toEqual(mesh.matrix.elements);
  expect(part.matrixWorld.elements).toEqual(mesh.matrixWorld.elements);
  expect(part.geometry).toBe(mesh.geometry);
  expect(part.material).toBe(mesh.material);
  expect(part.castShadow).toBe(true);
  expect(part.static).toBe(true);
  part.userData.value.number = 9;
  part.position.x = 10;
  expect(mesh.userData.value.number).toBe(7);
  expect(mesh.position.x).toBe(4);
});

it("keeps morph target state separate and preserves specialized mesh cloning", () => {
  const mesh = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
  mesh.morphTargetInfluences = [0.2, 0.4];
  mesh.morphTargetDictionary = { one: 0, two: 1 };
  const copy = cloneHumanPart(mesh) as Mesh;
  copy.morphTargetInfluences![0] = 0.8;
  copy.morphTargetDictionary!.one = 1;
  expect(mesh.morphTargetInfluences).toEqual([0.2, 0.4]);
  expect(mesh.morphTargetDictionary).toEqual({ one: 0, two: 1 });
  class SpecialMesh extends Mesh {}
  const special = new SpecialMesh(mesh.geometry, mesh.material);
  const clone = vi.spyOn(special, "clone");
  expect(cloneHumanPart(special)).toBeInstanceOf(SpecialMesh);
  expect(clone).toHaveBeenCalledExactlyOnceWith(false);
});
