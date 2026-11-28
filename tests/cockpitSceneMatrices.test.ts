import { Group, PerspectiveCamera, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import { Cockpit } from "../src/game/cockpit";
import type { FrameComposer } from "../src/render/frame";

// Cockpit.render draws the driver's seat's views inside one scene-wide matrix update: the scene's
// matrices are updated once a frame and automatic updates are off while its views are drawn, then
// on again. A change that drops the scope from render (the views each updating the scene again)
// fails here; the browser measurement (just measure-scene-matrices) is the only other guard.
describe("the driver's seat's draw (Cockpit.render) and the scene's matrices", () => {
  it("updates the scene once and draws every view with automatic updates off", () => {
    const scene = new Scene();
    const update = vi.spyOn(scene, "updateMatrixWorld");
    const seen: boolean[] = [];
    const look = () => seen.push(scene.matrixWorldAutoUpdate);
    const composer = {
      begin: look,
      drawWorld: look,
      street: look,
      drawOver: look,
      copyForGlass: () => null,
    } as unknown as FrameComposer;
    // A cockpit in the driver's seat with its loaded parts stubbed: only render's own logic runs.
    const cockpit = Object.create(Cockpit.prototype) as Cockpit;
    Object.assign(cockpit, {
      active: true,
      root: new Group(),
      nearCamera: new PerspectiveCamera(),
      lightInterior: () => undefined,
      updateMirror: look,
      rain: { isWet: () => false },
    });
    cockpit.render(composer, {} as never, scene, new PerspectiveCamera());
    expect(update).toHaveBeenCalledTimes(1);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen.every((isAuto) => isAuto === false)).toBe(true);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
  });
});
