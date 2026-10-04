import { describe, expect, it } from "vitest";
import { keyRows } from "../src/game/controlsHelp";
import { actionFor, keyFor } from "../src/game/input";
import {
  autoReturn,
  CHANNELS,
  mayShowPicture,
  naviView,
  pressChannel,
  pressTv,
  programmeAt,
  programmeBed,
  skyOf,
  tickerItems,
  tickerLine,
  trackSetOff,
  TV_OFF,
  type Programme,
  type TvDrive,
  type TvInfo,
  type TvWeather,
} from "../src/game/tvRules";

const parked: TvDrive = { kmh: 0, parkingBrake: true, engineOff: false };
const driving: TvDrive = { kmh: 30, parkingBrake: false, engineOff: false };
const tvOn = pressTv(TV_OFF);

const weather = (over: Partial<TvWeather> = {}): TvWeather => ({
  raining: false,
  fixedSky: false,
  sun1h: 0.8,
  night: false,
  temp: 21.34,
  humidity: 64,
  precip10m: 0,
  wind: 2.1,
  ...over,
});

const info = (over: Partial<TvInfo> = {}): TvInfo => ({
  hour: 10 + 5 / 60,
  place: "千代田区 丸の内",
  ward: "千代田区",
  lat: 35.68,
  lon: 139.76,
  weather: weather(),
  violations: [],
  ...over,
});

describe("映像は停車してサイドブレーキをかけたときだけ（第71条第5号の5・走行中映像制限）", () => {
  it("shows the picture only with the car stopped and parked", () => {
    expect(mayShowPicture(parked)).toBe(true);
    // Stopped at a light with the foot on the brake: not parked, no picture.
    expect(mayShowPicture({ kmh: 0, parkingBrake: false, engineOff: false })).toBe(false);
    // The engine off (the key at ACC) counts as parked.
    expect(mayShowPicture({ kmh: 0, parkingBrake: false, engineOff: true })).toBe(true);
    // A creep below the speed pulse's threshold is still stopped.
    expect(mayShowPicture({ ...parked, kmh: 0.5 })).toBe(true);
  });

  it("never shows it once the car moves, forwards or backwards, whatever the switches say", () => {
    for (const kmh of [1, 5, 30, -3])
      expect(mayShowPicture({ kmh, parkingBrake: true, engineOff: true }), `${kmh} km/h`).toBe(false);
  });

  it("replaces the picture with 「走行中は映像を表示できません」 while moving, and keeps the sound on", () => {
    expect(naviView(tvOn, parked)).toBe("picture");
    expect(naviView(tvOn, driving)).toBe("blocked");
    expect(tvOn.on).toBe(true);
  });

  it("shows the message, not the picture, when the TV is switched to while driving", () => {
    expect(naviView(pressTv(TV_OFF), driving)).toBe("blocked");
  });

  it("shows the map when the TV is off or playing behind the map", () => {
    expect(naviView(TV_OFF, parked)).toBe("map");
    expect(naviView({ ...tvOn, screen: "map" }, parked)).toBe("map");
  });
});

describe("テレビ・チャンネルのボタン", () => {
  it("turns the TV on, off, and back onto the screen from the map", () => {
    expect(tvOn).toEqual({ on: true, screen: "tv", channel: 0 });
    expect(pressTv(tvOn)).toEqual({ on: false, screen: "map", channel: 0 });
    expect(pressTv({ on: true, screen: "map", channel: 2 })).toEqual({ on: true, screen: "tv", channel: 2 });
  });

  it("goes round the channels and turns the TV on at its last channel", () => {
    let s = tvOn;
    const seen = [s.channel];
    for (let i = 0; i < CHANNELS.length; i++) {
      s = pressChannel(s);
      seen.push(s.channel);
    }
    expect(seen).toEqual([0, 1, 2, 0]);
    expect(pressChannel({ on: false, screen: "map", channel: 1 })).toEqual({
      on: true,
      screen: "tv",
      channel: 1,
    });
  });

  it("is on the free number keys 3 and 4 in both layouts, with a row in the help", () => {
    for (const layout of ["wasd", "ccd"] as const) {
      expect(actionFor(layout, "Digit3", false, false)).toBe("tv");
      expect(actionFor(layout, "Digit4", false, false)).toBe("tvChannel");
      for (const mac of [true, false]) {
        expect(keyFor(layout, "tv", mac)).toBe("3");
        expect(keyFor(layout, "tvChannel", mac)).toBe("4");
      }
      for (const assist of ["easy", "real"] as const)
        expect(keyRows({ layout, assist }).find(([k]) => k === "3 / 4")?.[1]).toContain("走行中は音声のみ");
    }
  });
});

describe("簡単操作: 案内中に走り出すと地図に戻る", () => {
  it("sets off once, when the car passes 3 km/h after standing still", () => {
    let armed = true;
    const events = [0, 2, 3.5, 10, 30, 50, 0.5, 4].map((kmh) => {
      const r = trackSetOff(armed, kmh);
      armed = r.armed;
      return r.setOff;
    });
    expect(events).toEqual([false, false, true, false, false, false, false, true]);
    // Already moving (the set-off was spent) when the TV is switched to: no second set-off.
    expect(trackSetOff(false, 40).setOff).toBe(false);
  });

  it("goes back to the map with a route in 簡単操作, the TV's sound staying on", () => {
    const back = autoReturn(tvOn, { assist: "easy", routeActive: true, setOff: true });
    expect(back).toEqual({ on: true, screen: "map", channel: 0 });
  });

  it("leaves the screen alone in リアル, without a route, or when the car did not just set off", () => {
    expect(autoReturn(tvOn, { assist: "real", routeActive: true, setOff: true })).toBe(tvOn);
    expect(autoReturn(tvOn, { assist: "easy", routeActive: false, setOff: true })).toBe(tvOn);
    expect(autoReturn(tvOn, { assist: "easy", routeActive: true, setOff: false })).toBe(tvOn);
  });
});

describe("番組（架空のチャンネルだけ）", () => {
  it("uses remote keys 10–12 and names no real broadcaster", () => {
    expect(CHANNELS.map((c) => c.number)).toEqual([10, 11, 12]);
    const real = /NHK|日本テレビ|日テレ|テレビ朝日|テレ朝|TBS|テレビ東京|テレ東|フジテレビ|MX|放送大学/;
    for (const c of CHANNELS) expect(c.station).not.toMatch(real);
  });

  it("airs the news, the weather, and nature by day with colour bars from 1:00 to 5:00", () => {
    expect(programmeAt(0, 3)).toBe("news");
    expect(programmeAt(1, 3)).toBe("weather");
    expect(programmeAt(2, 12)).toBe("nature");
    expect(programmeAt(2, 1)).toBe("colorBars");
    expect(programmeAt(2, 4.99)).toBe("colorBars");
    expect(programmeAt(2, 5)).toBe("nature");
  });
});

describe("ニュースのテロップ", () => {
  it("reads the time, the place, the weather at the car, today's violations and a word on safety", () => {
    const items = tickerItems(info());
    expect(items.map((i) => i.tag)).toEqual(["時刻", "現在地", "天気", "本日の交通違反", "交通安全"]);
    expect(items[0]).toMatchObject({ text: "10時05分", speech: "10時5分になりました。" });
    expect(items[1].speech).toBe("現在地は、千代田区丸の内付近です。");
    expect(items[2].text).toBe("都心（北の丸公園）晴れ　気温 21.3℃　湿度 64%　風 2.1m/s");
    expect(items[2].speech).toBe("都心の天気は晴れ、気温は21度、湿度は64パーセントです。");
    expect(items[3].text).toBe("0件　きょうも法令厳守です");
    expect(tickerLine(items)).toContain("【本日の交通違反】0件");
  });

  it("says 「ちょうど」 times without 0 minutes and below-zero temperatures as 氷点下", () => {
    expect(tickerItems(info({ hour: 7 }))[0].speech).toBe("7時になりました。");
    const cold = tickerItems(info({ weather: weather({ temp: -2.6 }) }))[2];
    expect(cold.speech).toContain("気温は氷点下3度");
  });

  it("lists today's violations once each, without the bracketed detail, with how many were caught", () => {
    const v = tickerItems(
      info({
        violations: [
          { label: "信号無視（赤色等）", caught: true },
          { label: "速度超過（15未満）", caught: false },
          { label: "信号無視（赤色等）", caught: false },
        ],
      }),
    )[3];
    expect(v.text).toBe("3件（信号無視・速度超過）　うち検挙 1件");
    expect(v.speech).toBe("本日の交通違反は3件です。信号無視、速度超過。");
  });

  it("says the game's own sky when it is set (晴れ / 雨 / おまかせ), with the observed numbers beside it", () => {
    const w = tickerItems(info({ weather: weather({ fixedSky: true, raining: true, precip10m: 1.5 }) }))[2];
    expect(w.text).toBe("雨（ゲームの天気）　都心（北の丸公園）気温 21.3℃　湿度 64%　風 2.1m/s");
    expect(w.speech).toBe("天気は雨です。都心の気温は21度、湿度は64パーセントです。");
    const bare = weather({ fixedSky: true, temp: null, humidity: null, wind: null });
    expect(tickerItems(info({ weather: bare }))[2]).toMatchObject({
      text: "晴れ（ゲームの天気）",
      speech: "天気は晴れです。",
    });
  });

  it("says that it does not rain at night, the observation telling no clouds after dark", () => {
    const w = tickerItems(info({ weather: weather({ night: true, sun1h: 0 }) }))[2];
    expect(w.speech).toBe("都心は、雨は降っていません。気温は21度、湿度は64パーセントです。");
  });

  it("drops the place when the car's ward is not known", () => {
    expect(tickerItems(info({ place: "" })).map((i) => i.tag)).not.toContain("現在地");
  });

  it("tells sun from cloud by the sunshine, and only rain or not at night", () => {
    expect(skyOf(weather({ raining: true }))).toBe("雨");
    expect(skyOf(weather({ sun1h: 0.8 }))).toBe("晴れ");
    expect(skyOf(weather({ sun1h: 0 }))).toBe("くもり");
    expect(skyOf(weather({ night: true, sun1h: 0 }))).toBe("雨なし");
    expect(skyOf(weather({ fixedSky: true, sun1h: 0 }))).toBe("晴れ");
  });
});

describe("番組の音（ループ）", () => {
  it("loops without a click and stays below full scale", () => {
    const sr = 8000;
    for (const p of ["news", "weather", "nature", "colorBars"] as Programme[]) {
      const bed = programmeBed(p, sr);
      const peak = bed.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, p).toBeGreaterThan(0.05);
      expect(peak, p).toBeLessThan(0.75);
      // The jump from the last sample back to the first is no bigger than a step inside the loop.
      let step = 0;
      for (let i = 1; i < bed.length; i++) step = Math.max(step, Math.abs(bed[i] - bed[i - 1]));
      expect(Math.abs(bed[0] - bed[bed.length - 1]), `${p} seam`).toBeLessThanOrEqual(step * 1.05);
    }
  });
});
