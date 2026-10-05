import { describe, expect, it } from "vitest";
import { loadHome, searchPlaces, type Place } from "../src/game/warp";

const places: Place[] = [
  { name: "新宿駅前郵便局", kind: "郵便局", lat: 35.69, lon: 139.7, ward: "新宿区" },
  { name: "新宿", kind: "都営交通の駅", lat: 35.69, lon: 139.7, ward: "新宿区" },
  { name: "西新宿五丁目", kind: "都営交通の駅", lat: 35.69, lon: 139.68, ward: "新宿区" },
  { name: "ＪＲ東京駅前", kind: "バス停", lat: 35.68, lon: 139.76, ward: "千代田区" },
  { name: "丸の内警察署", kind: "警察署", lat: 35.68, lon: 139.76 },
];

describe("移動: finding a place by name", () => {
  it("puts names that start with the query first, the shortest of them first", () => {
    expect(searchPlaces(places, "新宿").map((p) => p.name)).toEqual([
      "新宿",
      "新宿駅前郵便局",
      "西新宿五丁目",
    ]);
  });

  it("finds full-width letters from half-width typing", () => {
    expect(searchPlaces(places, "jr").map((p) => p.name)).toEqual(["ＪＲ東京駅前"]);
  });

  it("needs every word, and words may name the kind or the ward", () => {
    expect(searchPlaces(places, "新宿 駅").map((p) => p.name)).toEqual([
      "新宿",
      "新宿駅前郵便局",
      "西新宿五丁目",
    ]);
    expect(searchPlaces(places, "千代田 バス").map((p) => p.name)).toEqual(["ＪＲ東京駅前"]);
    expect(searchPlaces(places, "警察署").map((p) => p.name)).toEqual(["丸の内警察署"]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchPlaces(places, "  ")).toEqual([]);
  });

  it("has no home until one is chosen (or when storage is unavailable)", () => {
    expect(loadHome()).toBeNull();
  });
});

describe("移動・目的地: other names find a place", () => {
  it("finds a place by a name it is not shown with (English, official name, a station's lines)", () => {
    const airport: Place = {
      name: "羽田空港",
      kind: "空港",
      lat: 35.55,
      lon: 139.78,
      aka: "羽田空港 Tokyo International Airport 東京国際空港",
    };
    const station: Place = {
      name: "東京駅",
      kind: "駅",
      lat: 35.68,
      lon: 139.77,
      aka: "東京駅 Tokyo Station JR東日本・東京メトロ",
    };
    expect(searchPlaces([airport, station], "東京国際").map((p) => p.name)).toEqual(["羽田空港"]);
    expect(searchPlaces([airport, station], "tokyo station").map((p) => p.name)).toEqual(["東京駅"]);
    expect(searchPlaces([airport, station], "メトロ").map((p) => p.name)).toEqual(["東京駅"]);
  });
});
