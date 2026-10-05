import { BufferAttribute, BufferGeometry, Matrix4, Ray, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { TerrainHeight } from "../src/world/terrainHeight";

const fixture = () => {
  const positions: number[] = [],
    indices: number[] = [];
  for (let z = 0; z <= 8; z++)
    for (let x = 0; x <= 8; x++) positions.push(x * 17, Math.sin(x * 2 + z) * 3, z * 17);
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 8; x++) {
      const a = z * 9 + x;
      indices.push(a, a + 9, a + 1, a + 1, a + 9, a + 10);
    }
  return { position: new BufferAttribute(new Float32Array(positions), 3), indices };
};

describe("terrain triangle heights", () => {
  it("matches vertical ray intersections across slopes, cell boundaries and an origin change", () => {
    const { position, indices } = fixture();
    for (const matrix of [new Matrix4(), new Matrix4().makeRotationY(0.51).setPosition(-57, 13, -89)]) {
      const field = new TerrainHeight(position, indices, matrix);
      const transformed = new BufferGeometry()
        .setAttribute("position", position.clone())
        .applyMatrix4(matrix)
        .getAttribute("position");
      const a = new Vector3(),
        b = new Vector3(),
        c = new Vector3(),
        out = new Vector3();
      for (let i = 0; i < 200; i++) {
        const p = new Vector3((i * 31.43) % 136, 0, (i * 17.37) % 136).applyMatrix4(matrix);
        const ray = new Ray(new Vector3(p.x, 1000, p.z), new Vector3(0, -1, 0));
        let expected: number | null = null;
        for (let t = 0; t < indices.length; t += 3) {
          a.fromBufferAttribute(transformed, indices[t]);
          b.fromBufferAttribute(transformed, indices[t + 1]);
          c.fromBufferAttribute(transformed, indices[t + 2]);
          const hit = ray.intersectTriangle(a, b, c, false, out);
          if (hit) {
            expected = hit.y;
            break;
          }
        }
        const actual = field.at(p.x, p.z);
        if (expected === null) expect(actual).toBeNull();
        else expect(actual).toBeCloseTo(expected, 6);
      }
    }
  });

  it("returns null outside the triangles, including empty space within the bounding cells", () => {
    const p = new BufferAttribute(new Float32Array([0, 1, 0, 8, 2, 0, 0, 3, 8]), 3);
    const field = new TerrainHeight(p, [0, 1, 2], new Matrix4());
    expect(field.at(-1, 1)).toBeNull();
    expect(field.at(7, 7)).toBeNull();
    expect(field.at(100, 100)).toBeNull();
    expect(field.at(0, 0)).toBe(1);
    expect(field.at(4, 4)).toBeCloseTo(2.5);
  });

  it("ignores vertical or degenerate triangles", () => {
    const p = new BufferAttribute(new Float32Array([0, 0, 0, 0, 10, 0, 10, 0, 0]), 3);
    expect(new TerrainHeight(p, [0, 1, 2], new Matrix4()).at(1, 0)).toBeNull();
  });
});
