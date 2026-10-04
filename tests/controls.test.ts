import { describe, expect, it } from "vitest";
import { CarControls, type AutoContext } from "../src/game/carControls";
import { DEFAULT_PREFS, keyRows, loadPrefs } from "../src/game/controlsHelp";
import { keyFor } from "../src/game/input";

const context = (over: Partial<AutoContext> = {}): AutoContext => ({
  raining: false,
  rain10m: null,
  nextTurn: null,
  offRoute: false,
  kmh: 30,
  throttle: 0.3,
  ...over,
});

describe("簡単操作: the car works its own switches", () => {
  it("is the default, with WASD", () => {
    expect(DEFAULT_PREFS).toEqual({
      layout: "wasd",
      assist: "easy",
      seatUp: 0,
      seatBack: 0,
      volume: 0.8,
      minimap: true,
      nav: true,
      minimapNorthUp: false,
    });
    expect(new CarControls().assist).toBe("easy");
    // Without storage (here, or a private window) the defaults apply.
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("fastens the belt, keeps the engine running and the lights on AUTO", () => {
    const c = new CarControls();
    c.engineOn = false;
    c.lights = "off";
    c.highBeam = true;
    c.autoOperate(context(), 0.016);
    expect(c.belt).toBe(true);
    expect(c.engineOn).toBe(true);
    expect(c.lights).toBe("auto");
    expect(c.highBeam).toBe(false);
  });

  it("sets the wipers by how hard it rains, and stops them when it is dry", () => {
    const c = new CarControls();
    c.autoOperate(context({ raining: true, rain10m: 0.2 }), 0.016);
    expect(c.wipers).toBe(1);
    c.autoOperate(context({ raining: true, rain10m: 1 }), 0.016);
    expect(c.wipers).toBe(2);
    c.autoOperate(context({ raining: true, rain10m: 4 }), 0.016);
    expect(c.wipers).toBe(3);
    c.autoOperate(context({ raining: false }), 0.016);
    expect(c.wipers).toBe(0);
  });

  it("signals the route's next turn from 30 m before it, not earlier", () => {
    const c = new CarControls();
    c.autoOperate(context({ nextTurn: { side: "left", metres: 60 } }), 0.016);
    expect(c.indicator).toBe("off");
    c.autoOperate(context({ nextTurn: { side: "left", metres: 30 } }), 0.016);
    expect(c.indicator).toBe("left");
    c.indicator = "off";
    c.autoOperate(context({ nextTurn: { side: "right", metres: 12 } }), 0.016);
    expect(c.indicator).toBe("right");
    c.indicator = "off";
    c.autoOperate(context({ nextTurn: { side: null, metres: 10 } }), 0.016);
    expect(c.indicator).toBe("off");
  });

  it("switches its signal off when the car leaves the route, or the turn is no longer ahead", () => {
    const c = new CarControls();
    c.autoOperate(context({ nextTurn: { side: "left", metres: 20 } }), 0.016);
    expect(c.indicator).toBe("left");
    c.autoOperate(context({ nextTurn: { side: "left", metres: 18 }, offRoute: true }), 0.016);
    expect(c.indicator).toBe("off");
    c.autoOperate(context({ nextTurn: { side: "right", metres: 25 } }), 0.016);
    expect(c.indicator).toBe("right");
    c.autoOperate(context({ nextTurn: { side: "left", metres: 300 } }), 0.016);
    expect(c.indicator).toBe("off");
  });

  it("leaves the driver's own signal alone", () => {
    const c = new CarControls();
    c.toggleIndicator("right");
    c.autoOperate(context({ offRoute: true }), 0.016);
    expect(c.indicator).toBe("right");
  });

  it("holds the brake once stopped and lets go when the accelerator is pressed", () => {
    const c = new CarControls();
    const stopped = context({ kmh: 0, throttle: 0 });
    c.autoOperate(stopped, 0.3);
    expect(c.autoHold).toBe(false);
    c.autoOperate(stopped, 0.4);
    expect(c.autoHold).toBe(true);
    c.autoOperate(context({ kmh: 0, throttle: 0.5 }), 0.016);
    expect(c.autoHold).toBe(false);
  });

  it("leaves everything to the driver in リアル", () => {
    const c = new CarControls();
    c.assist = "real";
    c.autoOperate(
      context({ raining: true, rain10m: 4, nextTurn: { side: "left", metres: 10 }, kmh: 0, throttle: 0 }),
      2,
    );
    expect(c.belt).toBe(false);
    expect(c.wipers).toBe(0);
    expect(c.indicator).toBe("off");
    expect(c.autoHold).toBe(false);
  });
});

describe("key layouts", () => {
  it("moves 自動運転 off A in WASD, where A steers", () => {
    expect(keyFor("wasd", "autopilot")).toBe("J");
    expect(keyFor("ccd", "autopilot")).toBe("A");
  });

  it("zooms the phone with Shift+F in both layouts, F alone still taking it out", () => {
    for (const layout of ["wasd", "ccd"] as const) {
      expect(keyFor(layout, "phoneZoom")).toBe("Shift+F");
      expect(keyFor(layout, "phone")).toBe("F");
      expect(keyRows({ layout, assist: "easy" }).some(([k]) => k === "Shift+F")).toBe(true);
    }
  });

  it("lists the layout's own keys and marks what 簡単操作 does itself", () => {
    const wasd = keyRows({ layout: "wasd", assist: "easy" });
    expect(wasd[0]).toEqual(["W / S", "アクセル / ブレーキ（停止中はバック）"]);
    expect(wasd.find(([, what]) => what.startsWith("ワイパー"))?.[1]).toContain("簡単操作では自動");
    const ccd = keyRows({ layout: "ccd", assist: "real" });
    expect(ccd[0][0]).toBe("↑ / ↓");
    expect(ccd.some(([, what]) => what.includes("簡単操作"))).toBe(false);
  });
});

describe("座席の保存値", () => {
  const withStorage = (stored: unknown, run: () => void) => {
    const store = new Map([["tod.controls", JSON.stringify(stored)]]);
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    };
    const had = "localStorage" in globalThis;
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    try {
      run();
    } finally {
      if (had) Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  };

  it("starts the seat over when it was saved for the old cockpit, keeping the other settings", () => {
    withStorage({ layout: "ccd", seatUp: 0.05, seatBack: 0.02 }, () => {
      const prefs = loadPrefs();
      expect(prefs.seatUp).toBe(0);
      expect(prefs.seatBack).toBe(0);
      expect(prefs.layout).toBe("ccd");
    });
  });

  it("keeps a seat saved for the current cockpit", () => {
    withStorage({ seatUp: 0.03, seatBack: -0.02, seatModel: 2 }, () => {
      expect(loadPrefs().seatUp).toBe(0.03);
      expect(loadPrefs().seatBack).toBe(-0.02);
    });
  });
});
