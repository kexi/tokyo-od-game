import { describe, expect, it } from "vitest";
import {
  buttonName,
  familyOf,
  PadInput,
  padIds,
  padKey,
  padName,
  radialDeadzone,
  rampTrigger,
  stickCurve,
} from "../src/game/gamepad";
import { carPitchOf, type Action } from "../src/game/input";
import { parseInputReport, REPORT } from "../src/game/procon";
import {
  bindControl,
  bindingsOf,
  clearControl,
  conflictsOf,
  contextOf,
  contextsMeet,
  DEFAULT_BINDINGS,
  DEFAULT_PROFILE,
  defaultProfile,
  loadPadStore,
  PAD_CONTROLS,
  parseProfile,
  parseStore,
  resetBindings,
  savePadStore,
  serializeStore,
  STORE_KEY,
  type PadProfile,
} from "../src/game/padProfile";

const CHROME_PRO = "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)";
const CHROME_XBOX = "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)";
const FIREFOX_PRO = "57e-2009-Pro Controller";

describe("コントローラーの見分け方", () => {
  it("reads vendor and product from Chrome's and Firefox's ids, and keys profiles by them", () => {
    expect(padIds(CHROME_PRO)).toEqual({ vendor: 0x057e, product: 0x2009 });
    expect(padIds(FIREFOX_PRO)).toEqual({ vendor: 0x057e, product: 0x2009 });
    // The same controller in either browser shares its settings.
    expect(padKey(CHROME_PRO)).toBe("057e-2009");
    expect(padKey(FIREFOX_PRO)).toBe("057e-2009");
    expect(padKey("Some Pad")).toBe("Some Pad");
    expect(padName(CHROME_PRO)).toBe("Pro Controller");
    expect(padName(FIREFOX_PRO)).toBe("Pro Controller");
  });

  it("names the buttons as printed: Pro Controller glyphs by the standard index Chrome uses", () => {
    expect(familyOf(CHROME_PRO, "standard")).toBe("nintendo");
    expect(familyOf(CHROME_XBOX, "standard")).toBe("xbox");
    expect(familyOf(FIREFOX_PRO, "")).toBe("raw");
    const pro = [...Array(18).keys()].map((i) => buttonName("nintendo", i));
    expect(pro).toEqual([
      "B",
      "A",
      "Y",
      "X",
      "L",
      "R",
      "ZL",
      "ZR",
      "−",
      "+",
      "LS",
      "RS",
      "↑",
      "↓",
      "←",
      "→",
      "Home",
      "Capture",
    ]);
    expect(buttonName("xbox", 0)).toBe("A");
    expect(buttonName("raw", 3)).toBe("#3");
  });
});

describe("初期の配置", () => {
  it("puts the pedals on the triggers, the parking brake on the bottom button and closes with +", () => {
    const table = bindingsOf(defaultProfile());
    expect(table.throttle).toBe(7); // ZR
    expect(table.brake).toBe(6); // ZL
    expect(table.handbrake).toBe(0); // B
    expect(table.jump).toBe(0); // B on foot
    expect(table.door).toBe(1); // A
    expect(table.close).toBe(9); // +
    expect(table.indicatorLeft).toBe(4); // L
    expect(table.indicatorRight).toBe(5); // R
    expect(table.run).toBe(5); // R on foot
    // Home is left to the system's game overlay.
    expect(Object.values(table)).not.toContain(16);
  });

  it("never has two controls in force on one button", () => {
    const table = bindingsOf(defaultProfile());
    for (const control of PAD_CONTROLS) {
      const button = table[control];
      if (button === null) continue;
      expect(conflictsOf(table, control, button), control).toEqual([]);
    }
  });

  it("has a default (bound or not) for every bindable control", () => {
    for (const control of PAD_CONTROLS) expect(DEFAULT_BINDINGS[control], control).not.toBeUndefined();
  });

  it("lets B be the parking brake in the car and jump on foot (contexts that do not meet)", () => {
    expect(contextOf("handbrake")).toBe("car");
    expect(contextOf("jump")).toBe("foot");
    expect(contextOf("door")).toBe("any");
    expect(contextsMeet("car", "foot")).toBe(false);
    expect(contextsMeet("any", "foot")).toBe(true);
  });
});

describe("ボタンの割り当て（取り込み・重なり・初期化）", () => {
  it("swaps with the control already on the button", () => {
    // 乗降 (A) onto Y, where 話す is: 話す gets A.
    const { profile, swapped, cleared } = bindControl(defaultProfile(), "door", 2, "swap");
    const table = bindingsOf(profile);
    expect(table.door).toBe(2);
    expect(table.talk).toBe(1);
    expect(swapped).toEqual(["talk"]);
    expect(cleared).toEqual([]);
  });

  it("clears the other binding in clear mode", () => {
    const { profile, cleared } = bindControl(defaultProfile(), "door", 2, "clear");
    expect(bindingsOf(profile).talk).toBeNull();
    expect(cleared).toEqual(["talk"]);
  });

  it("clears instead of swapping when the swap would clash elsewhere", () => {
    // 乗降 (A, any) onto B: ジャンプ (foot) and サイドブレーキ (car) are both there. Swapping both to
    // A would put them on A together with nothing else — fine for those two (car vs foot) — but
    // the result must still have no clash anywhere.
    const { profile } = bindControl(defaultProfile(), "door", 0, "swap");
    const table = bindingsOf(profile);
    expect(table.door).toBe(0);
    for (const control of PAD_CONTROLS) {
      const button = table[control];
      if (button !== null) expect(conflictsOf(table, control, button), control).toEqual([]);
    }
  });

  it("clears when the bound control had no button to give", () => {
    const start = clearControl(defaultProfile(), "phone");
    const { profile, cleared } = bindControl(start, "phone", 1, "swap");
    expect(bindingsOf(profile).phone).toBe(1);
    expect(bindingsOf(profile).door).toBeNull();
    expect(cleared).toEqual(["door"]);
  });

  it("does not move a control in another context (B: jump stays when the parking brake moves)", () => {
    const { profile, swapped, cleared } = bindControl(defaultProfile(), "handbrake", 13, "swap");
    const table = bindingsOf(profile);
    expect(table.handbrake).toBe(13);
    expect(table.wipers).toBe(0); // swapped onto the brake's old button
    expect(table.jump).toBe(0); // on foot, unaffected
    expect(swapped).toEqual(["wipers"]);
    expect(cleared).toEqual([]);
  });

  it("stores only what differs from the defaults, and resets to them", () => {
    const { profile } = bindControl(defaultProfile(), "autopilot", 16);
    expect(profile.bindings).toEqual({ autopilot: 16 });
    const back = bindControl(profile, "autopilot", 16);
    expect(back.profile.bindings).toEqual({ autopilot: 16 });
    expect(resetBindings(profile).bindings).toEqual({});
    expect(clearControl(defaultProfile(), "throttle").bindings).toEqual({ throttle: null });
  });
});

describe("保存（localStorage・zod・版）", () => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("round-trips profiles per controller", () => {
    const s = store();
    const pro: PadProfile = {
      ...defaultProfile(),
      bindings: { horn: 3 },
      gyro: { enabled: true, rangeDeg: 45, invert: true },
    };
    savePadStore(new Map([["057e-2009", pro]]), s);
    expect(JSON.parse(s.data.get(STORE_KEY) ?? "{}").version).toBe(1);
    const back = loadPadStore(s);
    expect(back.get("057e-2009")).toEqual(pro);
    expect(back.has("045e-0b13")).toBe(false);
  });

  it("drops a store of another version or that is not JSON", () => {
    expect(parseStore("{")).toEqual(new Map());
    expect(parseStore(JSON.stringify({ version: 2, profiles: { a: {} } }))).toEqual(new Map());
    expect(parseStore(null)).toEqual(new Map());
  });

  it("keeps the valid fields of a damaged profile and defaults the rest", () => {
    const p = parseProfile({
      bindings: { throttle: 3, nonsense: 4, brake: "x", jump: 99, horn: null },
      steer: { deadzone: 5, sensitivity: "fast", linearity: 2 },
      triggerRampS: -1,
      gyro: "on",
      rumble: { enabled: false, intensity: 0.3, engineIdle: true },
    });
    expect(p.bindings).toEqual({ throttle: 3, horn: null });
    expect(p.steer).toEqual({ deadzone: 0.4, sensitivity: DEFAULT_PROFILE.steer.sensitivity, linearity: 2 });
    expect(p.triggerRampS).toBe(0);
    expect(p.gyro).toEqual(DEFAULT_PROFILE.gyro);
    expect(p.rumble).toEqual({ enabled: false, intensity: 0.3, engineIdle: true });
  });

  it("works without storage (blocked or throwing): defaults, no error", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadPadStore(throwing)).toEqual(new Map());
    expect(() => savePadStore(new Map([["k", defaultProfile()]]), throwing)).not.toThrow();
    expect(serializeStore(new Map())).toBe('{"version":1,"profiles":{}}');
  });
});

describe("スティックの曲線・遊び・トリガー", () => {
  const curve = { deadzone: 0.1, sensitivity: 1, linearity: 1 };

  it("gives nothing inside the dead zone and starts from 0 at its edge (no jump)", () => {
    expect(stickCurve(0.05, curve)).toBe(0);
    expect(stickCurve(-0.1, curve)).toBe(0);
    expect(stickCurve(0.1001, curve)).toBeLessThan(0.001);
    expect(stickCurve(1, curve)).toBe(1);
    expect(stickCurve(-1, curve)).toBe(-1);
  });

  it("is finer near the centre with a higher linearity, and capped at 1 with a high sensitivity", () => {
    const half = 0.1 + (1 - 0.1 - 0.04) / 2;
    expect(stickCurve(half, curve)).toBeCloseTo(0.5, 5);
    expect(stickCurve(half, { ...curve, linearity: 2 })).toBeCloseTo(0.25, 5);
    expect(stickCurve(half, { ...curve, sensitivity: 3 })).toBe(1);
    // Monotonic: more stick never steers less.
    let last = 0;
    for (let v = 0; v <= 1; v += 0.01) {
      const out = stickCurve(v, { deadzone: 0.12, sensitivity: 1.2, linearity: 1.5 });
      expect(out).toBeGreaterThanOrEqual(last);
      last = out;
    }
  });

  it("uses a round dead zone for walking", () => {
    expect(radialDeadzone(0.1, 0.1, 0.15)).toEqual([0, 0]);
    const [x, y] = radialDeadzone(0, -1, 0.15);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-1);
  });

  it("ramps a digital ZR up over the set time and drops it fast; passes an analog trigger as it is", () => {
    let v = 0;
    for (let i = 0; i < 15; i++) v = rampTrigger(v, true, 1, false, 0.45, 1 / 60);
    expect(v).toBeCloseTo(15 / 60 / 0.45, 5);
    for (let i = 0; i < 30; i++) v = rampTrigger(v, true, 1, false, 0.45, 1 / 60);
    expect(v).toBe(1);
    for (let i = 0; i < 5; i++) v = rampTrigger(v, false, 0, false, 0.45, 1 / 60);
    expect(v).toBe(0);
    expect(rampTrigger(0, true, 0.37, true, 0.45, 1 / 60)).toBe(0.37);
    expect(rampTrigger(0, true, 1, false, 0, 1 / 60)).toBe(1);
  });
});

/** A Gamepad as the API gives it (only what PadInput reads). */
function fakePad(
  id: string,
  pressed: number[] = [],
  axes = [0, 0, 0, 0],
  values: Record<number, number> = {},
): Gamepad {
  const buttons = [...Array(18).keys()].map((i) => {
    const value = values[i] ?? (pressed.includes(i) ? 1 : 0);
    return { pressed: pressed.includes(i) || value > 0.5, touched: false, value };
  });
  return {
    id,
    index: 0,
    connected: true,
    mapping: "standard",
    axes,
    buttons,
    timestamp: 0,
  } as unknown as Gamepad;
}

function rig(onFoot = false) {
  const fired: Action[] = [];
  const state = { onFoot };
  const pad = new PadInput({
    trigger: (a) => fired.push(a),
    onFoot: () => state.onFoot,
    autoStart: false,
    storage: null,
  });
  let now = 0;
  const step = (...pads: Gamepad[]) => pad.step((now += 16), pads);
  return { pad, fired, state, step };
}

describe("コントローラーの入力（PadInput）", () => {
  it("looks down from the driver's seat with the stick pulled down, not up", () => {
    // What it guarantees: down tilts the view down (it turned it up before: 「上しか向けない？」),
    // a little either way — less down than up, the bonnet fills the view sooner than the roof.
    expect(carPitchOf(-1)).toBeLessThan(0);
    expect(carPitchOf(1)).toBeGreaterThan(0);
    expect(Math.abs(carPitchOf(-1))).toBeLessThan(carPitchOf(1));
    expect(carPitchOf(1)).toBeLessThanOrEqual(0.3);
  });

  it("looks up with the right stick pushed up, and rests level when it is let go", () => {
    // What it guarantees: the right stick's up / down tilts the view (up is the axis's negative
    // side), in the car as a share of the tilt and on foot as a rate; inside the dead zone it rests.
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO, [], [0, 0, 0, -1]));
    expect(pad.lookPitch()).toBe(1);
    expect(pad.walk().pitch).toBe(1);
    step(fakePad(CHROME_PRO, [], [0, 0, 0, 0.6]));
    expect(pad.lookPitch()).toBeLessThan(0);
    step(fakePad(CHROME_PRO, [], [0, 0, 0, 0.05]));
    expect(pad.lookPitch()).toBeNull();
    expect(Math.abs(pad.walk().pitch)).toBe(0);
  });

  it("keeps a button bound in 設定 when the game is opened again, for that controller only", () => {
    // What it guarantees: a binding changed in 設定 › 操作 › コントローラー is in localStorage at once
    // and drives the next session — the Pro Controller's own, not the Xbox pad's.
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    } as unknown as Storage;
    const options = { trigger: () => {}, onFoot: () => false, autoStart: false, storage };
    const first = new PadInput(options);
    const pro = padKey(CHROME_PRO);
    first.setProfile(pro, bindControl(first.profileFor(pro), "highBeam", 13).profile);

    const fired: Action[] = [];
    const next = new PadInput({ ...options, trigger: (a) => fired.push(a) });
    next.step(16, [fakePad(CHROME_PRO)]);
    next.step(32, [fakePad(CHROME_PRO, [13])]); // ↓ on the d-pad, now ハイビーム
    expect(fired).toEqual(["highBeam"]);
    expect(bindingsOf(next.profileFor(padKey(CHROME_XBOX))).highBeam).toBe(DEFAULT_BINDINGS.highBeam);
  });

  it("fires an action once per press: holding does not repeat, a new press does", () => {
    const { fired, step } = rig();
    step(fakePad(CHROME_PRO));
    step(fakePad(CHROME_PRO, [3])); // X: スマホ
    step(fakePad(CHROME_PRO, [3]));
    step(fakePad(CHROME_PRO, [3]));
    step(fakePad(CHROME_PRO));
    step(fakePad(CHROME_PRO, [3]));
    expect(fired).toEqual(["phone", "phone"]);
  });

  it("does on foot what B does on foot (jump, held) and in the car what it does there", () => {
    const { pad, fired, state, step } = rig();
    step(fakePad(CHROME_PRO, [0]));
    expect(pad.drive().handbrake).toBe(true);
    expect(pad.walk().jump).toBe(true); // read only on foot by Input
    state.onFoot = true;
    step(fakePad(CHROME_PRO));
    step(fakePad(CHROME_PRO, [4])); // L: 合図 is car-only, nothing on foot
    expect(fired).toEqual([]);
  });

  it("drives with the pad used last when two are connected", () => {
    const { pad, step } = rig();
    const xbox = (pressed: number[] = [], axes = [0, 0, 0, 0]) =>
      ({ ...fakePad(CHROME_XBOX, pressed, axes), index: 1 }) as Gamepad;
    step(fakePad(CHROME_PRO, [1]), xbox());
    expect(pad.pad?.key).toBe("057e-2009");
    step(fakePad(CHROME_PRO), xbox([], [0.9, 0, 0, 0]));
    expect(pad.pad?.key).toBe("045e-0b13");
    expect(pad.drive().steer).toBeLessThan(-0.5); // stick right steers right (negative)
  });

  it("keeps two pads of one model apart (same profile, own buttons)", () => {
    const { pad, fired, step } = rig();
    const second = (pressed: number[] = []) => ({ ...fakePad(CHROME_PRO, pressed), index: 1 }) as Gamepad;
    step(fakePad(CHROME_PRO, [3]), second());
    step(fakePad(CHROME_PRO, [3]), second([3]));
    expect(fired).toEqual(["phone", "phone"]);
    expect(pad.pad?.slot).toBe("api:1");
    expect(pad.pad?.key).toBe("057e-2009");
  });

  it("drives from the WebHID report only when the Gamepad API has no Pro Controller (never both)", () => {
    const { pad, fired, step } = rig();
    const bytes = new Uint8Array(48);
    bytes[2] = 0x02; // X
    bytes.set([0x02, 0x08, 0x80], 5); // left stick centred (0x802, 0x800)
    bytes.set([0x02, 0x08, 0x80], 8);
    const report = parseInputReport(REPORT.full, new DataView(bytes.buffer));
    Object.assign(pad.procon, { status: "connected", report, reportAt: 0 });
    step();
    expect(pad.pad?.source).toBe("hid");
    expect(fired).toEqual(["phone"]);
    // Chrome's own Gamepad API pad appears: it takes over, the WebHID copy is dropped.
    Object.assign(pad.procon, { reportAt: 32 });
    step(fakePad(CHROME_PRO, [3]));
    expect(pad.connectedPads.map((p) => p.source)).toEqual(["api"]);
  });

  it("names the pad's buttons once the pad is used, the keyboard's after a key", () => {
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO));
    expect(pad.label("door")).toBeNull();
    step(fakePad(CHROME_PRO, [1]));
    expect(pad.source).toBe("pad");
    expect(pad.label("door")).toBe("A");
    expect(pad.label("settings")).toBe("+"); // 設定 is what 閉じる does with nothing open
    expect(pad.label("autopilot")).toBe(""); // unbound by default
    pad.noteKeyboard();
    expect(pad.label("door")).toBeNull();
  });

  it("captures the next new press for binding, ignoring a button held when it starts", () => {
    const { pad, fired, step } = rig();
    step(fakePad(CHROME_PRO, [1]));
    const got: number[] = [];
    let cancelled = false;
    pad.startCapture(
      (i) => got.push(i),
      () => (cancelled = true),
    );
    step(fakePad(CHROME_PRO, [1])); // still holding A from the click
    step(fakePad(CHROME_PRO, [1, 7])); // ZR newly pressed
    expect(got).toEqual([7]);
    expect(pad.capturing).toBe(false);
    expect(cancelled).toBe(false);
    // Nothing else acted on the press that was captured.
    expect(fired).toEqual(["door"]);
  });

  it("cancels a capture on request and after its timeout", () => {
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO));
    let cancels = 0;
    pad.startCapture(
      () => {},
      () => cancels++,
    );
    pad.cancelCapture();
    expect(cancels).toBe(1);
    pad.startCapture(
      () => {},
      () => cancels++,
    );
    for (let i = 0; i < 600; i++) step(fakePad(CHROME_PRO));
    expect(cancels).toBe(2);
    expect(pad.capturing).toBe(false);
  });

  it("ramps the Pro Controller's on/off ZR and passes an analog RT", () => {
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO));
    step(fakePad(CHROME_PRO, [7]));
    const first = pad.drive().throttle;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.1);
    for (let i = 0; i < 40; i++) step(fakePad(CHROME_PRO, [7]));
    expect(pad.drive().throttle).toBe(1);
    const x = rig();
    x.step(fakePad(CHROME_XBOX, [], [0, 0, 0, 0], { 7: 0.4 }));
    expect(x.pad.drive().throttle).toBeCloseTo(0.4);
  });

  it("latches a control set to toggle (parking brake on one press, off on the next)", () => {
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO));
    pad.setProfile("057e-2009", {
      ...defaultProfile(),
      toggles: { handbrake: true, run: false, lookBack: false },
    });
    step(fakePad(CHROME_PRO, [0]));
    step(fakePad(CHROME_PRO));
    expect(pad.drive().handbrake).toBe(true);
    step(fakePad(CHROME_PRO, [0]));
    step(fakePad(CHROME_PRO));
    expect(pad.drive().handbrake).toBe(false);
  });

  it("looks with the right stick (left is positive yaw) and inverts on request", () => {
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO, [], [0, 0, -1, 0]));
    expect(pad.lookYaw()).toBeCloseTo(2.6);
    pad.setProfile("057e-2009", { ...defaultProfile(), invertLookX: true });
    expect(pad.lookYaw()).toBeCloseTo(-2.6);
    step(fakePad(CHROME_PRO));
    expect(pad.lookYaw()).toBeNull();
  });

  it("lists the pad's bindings in the help by their printed names", () => {
    const { pad, step } = rig();
    step(fakePad(CHROME_PRO, [1]));
    const rows = pad.helpRows();
    expect(rows[0][0]).toBe("ZR / ZL");
    expect(rows.some(([k]) => k === "Capture")).toBe(true);
  });
});
