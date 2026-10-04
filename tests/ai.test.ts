import { describe, expect, it } from "vitest";
import { bearingLabel, personaPrompt, templateReply, type Surroundings } from "../src/ai/dialogue";
import { normalizeForTts, numberToKanji, splitForTts } from "../src/ai/tts";
import type { Poi } from "../src/data/schema";
import { profileFor } from "../src/world/pedestrians";

describe("TTS text normalisation (sanoTTS-jp drops digits and Latin letters)", () => {
  it("reads integers as kanji numerals", () => {
    expect(numberToKanji(0)).toBe("零");
    expect(numberToKanji(10)).toBe("十");
    expect(numberToKanji(1250)).toBe("千二百五十");
    expect(numberToKanji(23)).toBe("二十三");
    expect(numberToKanji(120034)).toBe("十二万三十四");
  });

  it("turns units, decimals and symbols into pronounceable Japanese", () => {
    expect(normalizeForTts("南へ約410m、気温21.5℃です")).toBe("南へ約四百十メートル、気温二十一点五度です");
    expect(normalizeForTts("OK！30km/hで")).toBe("!三十キロで");
  });

  it("splits per sentence and keeps every chunk under the 512-byte input limit", () => {
    expect(splitForTts("今日は晴れ。気温は二十度！")).toEqual(["今日は晴れ。", "気温は二十度！"]);
    const long = "あ".repeat(400) + "。";
    for (const chunk of splitForTts(long))
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(512);
  });
});

describe("NPC dialogue grounded in open data", () => {
  const poi = (id: number, category: string, lat: number, lon: number, name: string): Poi => ({
    id,
    category,
    lat,
    lon,
    name,
    ward: "千代田区",
    source: 0,
  });
  const s: Surroundings = {
    ward: "千代田区",
    town: "丸の内二丁目",
    timeLabel: "昼",
    clock: "12時00分",
    weather: "晴れで、気温は二十度くらい",
    nearbyPois: [
      poi(1, "station", 35.6812, 139.7671, "東京駅"),
      poi(2, "culture", 35.6851, 139.7528, "皇居外苑"),
    ],
    categories: [
      { id: "station", label: "都営交通の駅", color: "#0f0", points: 15 },
      { id: "culture", label: "都指定文化財", color: "#f0f", points: 30 },
    ],
    lat: 35.68075,
    lon: 139.76345,
    busLine: "都０４",
  };
  const profile = profileFor(42);

  it("derives stable names and personalities from the NPC id", () => {
    expect(profileFor(42)).toEqual(profile);
    expect(profile.name).toMatch(/^\S+ \S+$/);
  });

  it("answers station questions with the nearest station, not a generic spot", () => {
    expect(templateReply(profile, s, "近くの駅はどこ？")).toContain("東京駅");
  });

  it("gives direction and distance from real coordinates", () => {
    expect(bearingLabel(35.68, 139.76, 35.69, 139.76)).toBe("北");
    expect(bearingLabel(35.68, 139.76, 35.68, 139.77)).toBe("東");
    expect(templateReply(profile, s, "このあたりのおすすめは？")).toMatch(/東へ約\d+m/);
  });

  it("forbids the topics excluded by the voice licence in the system prompt", () => {
    const prompt = personaPrompt(profile, s);
    expect(prompt).toContain("政治・宗教・思想");
    expect(prompt).toContain("東京駅");
    expect(prompt).toContain(profile.name);
  });
});
