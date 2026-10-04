import { describe, expect, it } from "vitest";
import { actionFor, boundKeys, keyFor, LOOK_KEYS, MOVE_KEYS, type KeyLayout } from "../src/game/input";

const LAYOUTS: KeyLayout[] = ["wasd", "ccd"];

describe("操作のキーがかぶらない", () => {
  it("never binds a key that moves the car to an action", () => {
    for (const layout of LAYOUTS)
      for (const code of MOVE_KEYS[layout].drive)
        expect(actionFor(layout, code, false, false), `${layout} ${code}`).toBeUndefined();
  });

  it("lets W/A/S/D walk on foot in either layout (A is not the autopilot then)", () => {
    for (const layout of LAYOUTS)
      for (const code of MOVE_KEYS[layout].walk)
        expect(actionFor(layout, code, false, true), `${layout} ${code}`).toBeUndefined();
    expect(actionFor("ccd", "KeyA", false, false)).toBe("autopilot");
    expect(actionFor("ccd", "KeyA", false, true)).toBeUndefined();
  });

  it("does not look aside with Ctrl in the WASD layout (Ctrl+W would close the tab)", () => {
    expect(LOOK_KEYS.wasd.left).toBeNull();
    expect(LOOK_KEYS.wasd.right).toBeNull();
    for (const code of [LOOK_KEYS.wasd.back]) expect(boundKeys("wasd")).not.toContain(code);
  });

  it("keeps the look keys off every action", () => {
    for (const layout of LAYOUTS) {
      const look = [LOOK_KEYS[layout].left, LOOK_KEYS[layout].right, LOOK_KEYS[layout].back].filter(Boolean);
      for (const code of look) expect(boundKeys(layout), `${layout} ${code}`).not.toContain(code);
    }
  });

  it("gives every action one key per layout, and Shift+F is the zoom, not the phone too", () => {
    for (const layout of LAYOUTS) {
      const actions = boundKeys(layout)
        .map((c) => actionFor(layout, c, false, false))
        .filter(Boolean);
      expect(new Set(actions).size, layout).toBe(actions.length);
    }
    expect(actionFor("wasd", "KeyF", true, false)).toBe("phoneZoom");
    expect(actionFor("wasd", "KeyF", false, false)).toBe("phone");
    expect(keyFor("wasd", "phoneZoom")).toBe("Shift+F");
  });
});
