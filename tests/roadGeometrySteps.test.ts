import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";
import { describe, expect, it } from "vitest";
import { roadGeometrySteps } from "../src/world/roadGeometrySteps";

describe("cooperative geometry preparation", () => {
  it("keeps Three.js normals and bounds for curved, shared and degenerate triangles", () => {
    const source = new BoxGeometry(40, 20, 70, 40, 40, 40);
    const positions = source.getAttribute("position");
    for (let i = 0; i < positions.count; i++)
      positions.setY(i, positions.getY(i) + Math.sin(positions.getX(i)));
    const degenerate = new BufferGeometry();
    degenerate.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    degenerate.setIndex([0, 1, 2]);
    for (const input of [source, degenerate]) {
      const expected = input.clone();
      expected.computeVertexNormals();
      expected.computeBoundingBox();
      expected.computeBoundingSphere();
      const prepared = input.clone();
      const checkpoints = [...roadGeometrySteps(prepared)];
      const normals = prepared.getAttribute("normal").array;
      const target = expected.getAttribute("normal").array;
      expect(normals.length).toBe(target.length);
      for (let i = 0; i < normals.length; i++) expect(normals[i]).toBeCloseTo(target[i], 6);
      expect(prepared.boundingBox).toEqual(expected.boundingBox);
      expect(prepared.boundingSphere).toEqual(expected.boundingSphere);
      expect(checkpoints.length).toBeGreaterThan(0);
    }
  });
});
