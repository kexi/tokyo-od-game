import { describe, expect, it } from "vitest";
import { Missions } from "../src/game/missions";
import { byDistance, distanceText } from "../src/game/placePicker";
import type { PoiField } from "../src/game/pois";

const TOKYO_STATION = { lat: 35.6812, lon: 139.7671 };
// The chosen place itself is never looked up in the spot field.
const field = {} as PoiField;

describe("目的地: the list shows how far each place is", () => {
  it("reads metres under a kilometre and kilometres from there, never 「1000 m」", () => {
    expect(distanceText(349)).toBe("350 m");
    expect(distanceText(994)).toBe("990 m");
    expect(distanceText(996)).toBe("1.0 km");
    expect(distanceText(12_345)).toBe("12.3 km");
  });

  it("orders the landmarks nearest first and keeps the order of equally far ones", () => {
    const far = { name: "far", lat: 35.71, lon: 139.81 };
    const near = { name: "near", lat: 35.6815, lon: 139.767 };
    const sameA = { name: "a", lat: 35.69, lon: 139.77 };
    const sameB = { name: "b", lat: 35.69, lon: 139.77 };
    expect(byDistance([far, sameA, near, sameB], TOKYO_STATION).map((p) => p.name)).toEqual([
      "near",
      "a",
      "b",
      "far",
    ]);
  });
});

describe("目的地: a chosen place as the navi's destination", () => {
  const place = { name: "上野恩賜公園", lat: 35.7146, lon: 139.7732, ward: "台東区" };

  it("guides there with no clock and keeps the place's name and ward", () => {
    const missions = new Missions(field);
    const m = missions.startChosen(place, 0, TOKYO_STATION.lat, TOKYO_STATION.lon);
    expect(m.target).toMatchObject({ category: "destination", name: "上野恩賜公園", ward: "台東区" });
    expect(m.timeLimit).toBe(Infinity);
    expect(m.isTrip).toBe(true);
    expect(m.startDistance).toBeGreaterThan(3500);
    // No clock: it never times out, however long the drive takes.
    expect(missions.check(TOKYO_STATION.lat, TOKYO_STATION.lon, 3_600_000)).toBeNull();
  });

  it("is reached at the end of the navi's route even when the place lies far inside from the street", () => {
    const missions = new Missions(field);
    missions.startChosen(place, 0, TOKYO_STATION.lat, TOKYO_STATION.lon);
    // 150 m from the park's centre, on the street where the route ends.
    const kerb = { lat: place.lat - 0.00135, lon: place.lon };
    expect(missions.check(kerb.lat, kerb.lon, 1000, false)).toBeNull();
    expect(missions.check(kerb.lat, kerb.lon, 1000, true)).toMatchObject({
      target: { name: "上野恩賜公園" },
    });
    expect(missions.current).toBeNull();
  });

  it("does not let the end of a route complete the game's own missions (they keep the 22 m radius)", () => {
    const missions = new Missions(field);
    const home = missions.startHome(place, 0, TOKYO_STATION.lat, TOKYO_STATION.lon);
    expect(missions.check(place.lat - 0.00135, place.lon, 1000, true)).toBeNull();
    expect(missions.current).toBe(home);
  });

  it("stops the guidance when cleared", () => {
    const missions = new Missions(field);
    missions.startChosen(place, 0, TOKYO_STATION.lat, TOKYO_STATION.lon);
    missions.clear();
    expect(missions.current).toBeNull();
    expect(missions.check(place.lat, place.lon, 1000, true)).toBeNull();
  });
});
