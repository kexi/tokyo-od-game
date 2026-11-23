import { describe, expect, it } from "vitest";
import { judgeVehicleBlow, ownKmhIntoBlow } from "../src/game/vehicleBlow";

describe("a blow between the player's car and a vehicle (vehicleBlow.ts)", () => {
  it("T-c1: is no accident for a car standing (0.2 km/h) that a car pushed to 11 km/h", () => {
    expect(judgeVehicleBlow("vehicle", 11, 0.2)).toEqual({ isAccident: false, isStandingBump: true });
  });

  it("T-c2: stays as before for a moving car, and for blows at 5 km/h or under", () => {
    expect(judgeVehicleBlow("vehicle", 36, 36).isAccident).toBe(true);
    expect(judgeVehicleBlow("vehicle", 6, 2).isAccident).toBe(true);
    expect(judgeVehicleBlow("vehicle", 5, 4)).toEqual({ isAccident: false, isStandingBump: false });
    expect(judgeVehicleBlow("wall", 20, 20).isAccident).toBe(true);
    expect(judgeVehicleBlow("ground", 30, 30)).toEqual({ isAccident: false, isStandingBump: false });
  });

  it("T-c3: takes the speed before the steps when the blow left no record", () => {
    expect(ownKmhIntoBlow(null, 0.1)).toBe(0.1);
    expect(ownKmhIntoBlow({ carSpeed: 10 }, 0.1)).toBeCloseTo(36);
    // Pushed from standing with no record: the speed before the steps decides, not the 11 after.
    expect(judgeVehicleBlow("vehicle", 11, ownKmhIntoBlow(null, 0)).isAccident).toBe(false);
  });
});
