import { BoxGeometry, BufferGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import { updateRoadGeometry } from "../src/world/roadGeometry";

describe("road geometry buffers", () => {
  it("retains buffers while updating geometry, draw count and bounds", () => {
    const source = new BoxGeometry(3, 4, 5, 2, 2, 2);
    const first = updateRoadGeometry(new BufferGeometry(), source);
    const positions = first.getAttribute("position"),
      indices = first.getIndex();
    const smaller = new BoxGeometry(1, 1, 1).translate(100, -10, 50);
    const second = updateRoadGeometry(first, smaller);
    expect(second).toBe(first);
    expect(second.getAttribute("position")).toBe(positions);
    expect(second.getIndex()).toBe(indices);
    expect(second.drawRange.count).toBe(smaller.getIndex()!.count);
    for (const name of Object.keys(smaller.attributes)) {
      const expected = smaller.getAttribute(name).array;
      expect(Array.from(second.getAttribute(name).array.slice(0, expected.length))).toEqual(
        Array.from(expected),
      );
    }
    expect(second.boundingBox).toEqual(smaller.boundingBox);
    expect(second.boundingSphere).toEqual(smaller.boundingSphere);
    expect(second.boundingBox!.min.x).toBe(99.5);
  });

  it("releases undersized buffers when growing and retains the new capacity on the next update", () => {
    const small = updateRoadGeometry(new BufferGeometry(), new BoxGeometry());
    const disposed = vi.fn();
    small.addEventListener("dispose", disposed);
    const large = updateRoadGeometry(small, new BoxGeometry(10, 10, 10, 5, 5, 5));
    expect(large).not.toBe(small);
    expect(disposed).toHaveBeenCalledOnce();
    expect(updateRoadGeometry(large, new BoxGeometry())).toBe(large);
  });
});
