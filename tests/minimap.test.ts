import { describe, expect, it } from "vitest";
import { compassLabel } from "../src/game/minimap";

describe("小さな地図の方角", () => {
  it("names the eight points of the compass, clockwise from north", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(compassLabel(0)).toBe("北");
    expect(compassLabel(deg(45))).toBe("北東");
    expect(compassLabel(deg(90))).toBe("東");
    expect(compassLabel(deg(180))).toBe("南");
    expect(compassLabel(deg(270))).toBe("西");
    expect(compassLabel(deg(315))).toBe("北西");
  });

  it("rounds to the nearest point and wraps negative and full turns", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(compassLabel(deg(20))).toBe("北");
    expect(compassLabel(deg(25))).toBe("北東");
    expect(compassLabel(deg(-90))).toBe("西");
    expect(compassLabel(deg(360 + 90))).toBe("東");
  });
});
