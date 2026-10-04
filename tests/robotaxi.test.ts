import { describe, expect, it } from "vitest";
import { fareFor } from "../src/game/robotaxi";

describe("taxi fare (東京都特別区・武三地区, from 2026-04-20)", () => {
  it("charges 500 yen up to the first 1.0 km", () => {
    expect(fareFor(0, 0)).toBe(500);
    expect(fareFor(1000, 0)).toBe(500);
  });

  it("adds 100 yen as soon as the meter passes 1.0 km, then every 232 m", () => {
    expect(fareFor(1001, 0)).toBe(600);
    expect(fareFor(1232, 0)).toBe(600);
    expect(fareFor(1233, 0)).toBe(700);
  });

  it("counts every 1 min 25 s below 10 km/h as 232 m (時間距離併用)", () => {
    expect(fareFor(1000, 85)).toBe(600); // 1,000 m + 232 m
    expect(fareFor(1000, 86)).toBe(700); // just past the next step
  });

  it("matches the published estimate for 4.6 km, Tokyo's average ride (about 2,100 yen)", () => {
    expect(fareFor(4600, 0)).toBe(2100);
  });
});
