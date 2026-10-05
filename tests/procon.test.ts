import { describe, expect, it } from "vitest";
import {
  AMPLITUDES,
  encodeAmplitude,
  encodeRumbleSide,
  imuMean,
  NEUTRAL_RUMBLE,
  outputReportSize,
  parseInputReport,
  REPORT,
  rumbleData,
  standardButtons,
  stickAxes,
  SUBCOMMAND,
  subcommandData,
} from "../src/game/procon";
import {
  bumpStrength,
  effectFor,
  idleFrame,
  isSilent,
  mixFrames,
  RumbleMixer,
  SILENT,
} from "../src/game/rumble";
import { gravityRoll, TiltEstimator, tiltSteer, wheelAxis, type Vec3 } from "../src/game/tilt";

/**
 * Fixtures are written byte by byte from dekuNukem's bluetooth_hid_notes.md ("Standard input
 * report format"), minus the report ID byte that WebHID keeps apart. No real controller is read.
 */
function fullReport(opts: {
  right?: number;
  shared?: number;
  left?: number;
  lStick?: [number, number];
  rStick?: [number, number];
  imu?: Array<[number, number, number, number, number, number]>;
  battery?: number;
}): DataView {
  const bytes = new Uint8Array(48);
  bytes[0] = 0x5a; // timer
  bytes[1] = opts.battery ?? 0x8e; // battery 8 (full), not charging; connection info 0xE
  bytes[2] = opts.right ?? 0;
  bytes[3] = opts.shared ?? 0;
  bytes[4] = opts.left ?? 0;
  const stick = (o: number, [x, y]: [number, number]) => {
    bytes[o] = x & 0xff;
    bytes[o + 1] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4);
    bytes[o + 2] = (y >> 4) & 0xff;
  };
  stick(5, opts.lStick ?? [2048, 2048]);
  stick(8, opts.rStick ?? [2048, 2048]);
  bytes[11] = 0x70; // vibrator input report
  const view = new DataView(bytes.buffer);
  (opts.imu ?? []).forEach((s, i) => s.forEach((v, k) => view.setInt16(12 + i * 12 + k * 2, v, true)));
  return view;
}

describe("プロコンの入力レポート（0x30・0x21）", () => {
  it("reads the doc's sample button bytes 41 00 82: Y + R on the right, ↑ + ZL on the left", () => {
    const r = parseInputReport(REPORT.full, fullReport({ right: 0x41, shared: 0x00, left: 0x82 }));
    expect(r).not.toBeNull();
    const pressed = Object.entries(r?.buttons ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .toSorted();
    expect(pressed).toEqual(["r", "up", "y", "zl"]);
  });

  it("reads every button bit of the three bytes", () => {
    const all = parseInputReport(REPORT.full, fullReport({ right: 0xcf, shared: 0x3f, left: 0xcf }));
    expect(Object.values(all?.buttons ?? {}).every(Boolean)).toBe(true);
    const a = parseInputReport(REPORT.full, fullReport({ right: 0x08, shared: 0x02 | 0x10, left: 0x80 }));
    expect(a?.buttons).toMatchObject({
      a: true,
      plus: true,
      home: true,
      zl: true,
      b: false,
      minus: false,
      capture: false,
    });
  });

  it("puts them in the W3C standard order Chrome uses (B A Y X L R ZL ZR − + LS RS ↑ ↓ ← → Home Capture)", () => {
    const b = parseInputReport(REPORT.full, fullReport({ right: 0x04, shared: 0x20, left: 0x08 }))?.buttons;
    const order = standardButtons(b as NonNullable<typeof b>);
    expect(order.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([0, 14, 17]); // B, ←, Capture
  });

  it("unpacks the 12-bit sticks and scales them like a standard axis (up negative)", () => {
    const r = parseInputReport(REPORT.full, fullReport({ lStick: [0x7ff, 0xabc], rStick: [0xfff, 0x001] }));
    expect(r?.sticks).toEqual({ lx: 0x7ff, ly: 0xabc, rx: 0xfff, ry: 0x001 });
    const [lx, ly, rx, ry] = stickAxes({ lx: 2050, ly: 3550, rx: 3600, ry: 550 });
    expect(lx).toBe(0);
    expect(ly).toBe(-1); // pushed up
    expect(rx).toBe(1);
    expect(ry).toBe(1); // pushed down
    expect(stickAxes({ lx: 2100, ly: 2000, rx: 2050, ry: 2050 })).toEqual([0, 0, 0, 0]); // in the dead zone
  });

  it("reads the battery nibble and the three IMU samples (int16 LE)", () => {
    const r = parseInputReport(
      REPORT.full,
      fullReport({
        battery: 0x6e | 0x10,
        imu: [
          [0, 0, 4096, 100, -50, 0],
          [10, -10, 4100, 110, -40, 2],
          [-10, 10, 4092, 90, -60, -2],
        ],
      }),
    );
    expect(r?.battery).toBe(6);
    expect(r?.charging).toBe(true);
    expect(r?.imu).toHaveLength(3);
    expect(r?.imu[1]).toEqual({ accel: [10, -10, 4100], gyro: [110, -40, 2] });
    const mean = imuMean(r?.imu ?? []);
    expect(mean?.accel[2]).toBeCloseTo(4096 * 0.000244, 6); // ≈ 1 g
    expect(mean?.gyro[0]).toBeCloseTo((100 * 0.06103 * Math.PI) / 180, 6);
  });

  it("says the IMU is off when its samples are all zero (Chrome's driver switches it off)", () => {
    const r = parseInputReport(REPORT.full, fullReport({}));
    expect(r?.imu).toHaveLength(3);
    expect(imuMean(r?.imu ?? [])).toBeNull();
  });

  it("reads a subcommand reply's ack and id, and ignores other reports", () => {
    const bytes = new Uint8Array(48);
    bytes[12] = 0x80;
    bytes[13] = SUBCOMMAND.vibration;
    const r = parseInputReport(REPORT.reply, new DataView(bytes.buffer));
    expect(r?.reply).toEqual({ ack: true, subcommand: 0x48 });
    expect(r?.imu).toEqual([]);
    expect(parseInputReport(REPORT.simple, new DataView(new Uint8Array(11).buffer))).toBeNull();
    expect(parseInputReport(REPORT.full, new DataView(new Uint8Array(5).buffer))).toBeNull();
  });
});

describe("出力レポート（サブコマンド 0x01・振動 0x10）", () => {
  it("lays out a subcommand: counter, neutral rumble ×2, id, arguments, padded to the report size", () => {
    const d = subcommandData(0x13, SUBCOMMAND.inputMode, [0x30], 48);
    expect(d).toHaveLength(48);
    expect(Array.from(d.subarray(0, 12))).toEqual([
      0x03, 0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40, 0x03, 0x30, 0x00,
    ]);
    expect(Array.from(subcommandData(1, SUBCOMMAND.imu, [0x01], 63).subarray(9, 11))).toEqual([0x40, 0x01]);
    expect(subcommandData(1, SUBCOMMAND.imu, [0x01], 63)).toHaveLength(63);
  });

  it("lays out a rumble report: counter, left 4 bytes, right 4 bytes", () => {
    const d = rumbleData(2, [1, 2, 3, 4], [5, 6, 7, 8], 48);
    expect(Array.from(d.subarray(0, 9))).toEqual([2, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("tells USB (63-byte) from Bluetooth (48-byte) output reports by the descriptor", () => {
    const usb = [{ outputReports: [{ reportId: 0x01, items: [{ reportSize: 8, reportCount: 63 }] }] }];
    const bt = [{ outputReports: [{ reportId: 0x01, items: [{ reportSize: 8, reportCount: 48 }] }] }];
    expect(outputReportSize(usb, 0x01)).toBe(63);
    expect(outputReportSize(bt, 0x01)).toBe(48);
    expect(outputReportSize(bt, 0x10)).toBeNull();
  });
});

describe("HD 振動の符号化（rumble_data_table.md）", () => {
  it("encodes silence at 320 Hz / 160 Hz as the documented neutral 00 01 40 40", () => {
    expect(encodeRumbleSide({ hz: 320, amp: 0 }, { hz: 160, amp: 0 })).toEqual([...NEUTRAL_RUMBLE]);
  });

  it("reproduces the doc's worked example (HF 0x01a8, HA 0x88, LF 0x63, LA 0x804d → a8 89 e3 4d)", () => {
    // 0x01a8 = (0xCA − 0x60)·4 → 10·2^(0xCA/32) Hz; HA 0x88 → amplitude 0.501433; LF 0x63 →
    // 10·2^(0xA3/32) Hz; LA 0x804d → amplitude 0.189185 (the table's rows).
    const high = { hz: 10 * 2 ** (0xca / 32), amp: 0.501433 };
    const low = { hz: 10 * 2 ** (0xa3 / 32), amp: 0.189185 };
    expect(encodeRumbleSide(high, low)).toEqual([0xa8, 0x89, 0xe3, 0x4d]);
  });

  it("matches Chromium's dual-rumble table entries (141 Hz → HF 0x0068 / LF 0x3a; 182 Hz → 0x0098 / 0x46)", () => {
    expect(encodeRumbleSide({ hz: 141, amp: 0 }, { hz: 141, amp: 0 })).toEqual([0x68, 0x00, 0x3a, 0x40]);
    expect(encodeRumbleSide({ hz: 182, amp: 0 }, { hz: 182, amp: 0 })).toEqual([0x98, 0x00, 0x46, 0x40]);
  });

  it("follows the amplitude table and never exceeds its safe maximum (HA 0xC8, LA 0x0072)", () => {
    expect(AMPLITUDES[1]).toBeCloseTo(0.007843, 6);
    expect(AMPLITUDES[16]).toBeCloseTo(0.117471, 3);
    expect(AMPLITUDES[32]).toBeCloseTo(0.229908, 4);
    expect(AMPLITUDES[68]).toBeCloseTo(0.501433, 3);
    expect(AMPLITUDES[100]).toBeCloseTo(1.002867, 3);
    expect(encodeAmplitude(0)).toBe(0);
    expect(encodeAmplitude(-1)).toBe(0);
    expect(encodeAmplitude(0.9)).toBe(95); // 0xbe / 0x806f, 0.899928
    expect(encodeAmplitude(5)).toBe(100);
    expect(encodeRumbleSide({ hz: 320, amp: 1 }, { hz: 160, amp: 1 })).toEqual([
      0x00,
      0xc8 + 0x01,
      0x40,
      0x72,
    ]);
  });

  it("marks an odd low-band amplitude with the 0x80 flag (LA 0x8040 for the first step)", () => {
    expect(encodeRumbleSide({ hz: 320, amp: 0 }, { hz: 160, amp: 0.007843 })).toEqual([
      0x00,
      0x01,
      0x80 + 0x40,
      0x40,
    ]);
  });

  it("clamps frequencies to each band (HF 81.75–1252.57 Hz, LF 40.88–626.28 Hz)", () => {
    const [hf0, hf1, lf] = encodeRumbleSide({ hz: 5000, amp: 0 }, { hz: 1, amp: 0 });
    expect(hf0 | ((hf1 & 0x01) << 8)).toBe(0x1fc);
    expect(lf & 0x7f).toBe(0x01);
  });
});

describe("ジャイロの傾き（相補フィルタ）", () => {
  const deg = (r: number) => (r * 180) / Math.PI;
  const flatTilt = (theta: number): Vec3 => [0, Math.sin(theta), Math.cos(theta)];

  it("finds the wheel's axis from the centre pose: forward when flat, out of the face when upright", () => {
    expect(wheelAxis([0, 0, 1])).toEqual([1, 0, 0]);
    const upright = wheelAxis([1, 0, 0]);
    expect(upright[2]).toBeCloseTo(-1);
    // Turned right (right hand down) from flat is positive.
    expect(deg(gravityRoll(flatTilt((20 * Math.PI) / 180), [0, 0, 1], [1, 0, 0]))).toBeCloseTo(20, 6);
    expect(deg(gravityRoll(flatTilt((-35 * Math.PI) / 180), [0, 0, 1], [1, 0, 0]))).toBeCloseTo(-35, 6);
  });

  it("settles on the accelerometer's angle when held still at a tilt", () => {
    const tilt = new TiltEstimator();
    tilt.update([0, 0, 1], [0, 0, 0], 0.01);
    for (let i = 0; i < 500; i++) tilt.update(flatTilt((30 * Math.PI) / 180), [0, 0, 0], 0.01);
    expect(deg(tilt.roll)).toBeCloseTo(30, 0);
  });

  it("follows a quick turn from the gyro at once, with gravity agreeing", () => {
    const tilt = new TiltEstimator();
    const rate = Math.PI / 2; // 90°/s to the right for 0.4 s
    let theta = 0;
    tilt.update(flatTilt(0), [0, 0, 0], 0.005);
    for (let i = 0; i < 80; i++) {
      theta += rate * 0.005;
      tilt.update(flatTilt(theta), [rate, 0, 0], 0.005);
    }
    expect(deg(tilt.roll)).toBeCloseTo(36, 0);
  });

  it("does not drift with a biased gyro while the pad lies still", () => {
    const tilt = new TiltEstimator();
    const bias: Vec3 = [0.03, 0, 0]; // 1.7°/s
    for (let i = 0; i < 6000; i++) tilt.update([0, 0, 1], bias, 0.01);
    expect(Math.abs(deg(tilt.roll))).toBeLessThan(1);
  });

  it("trusts the gyro over a shaking accelerometer (far from 1 g)", () => {
    const tilt = new TiltEstimator();
    tilt.update([0, 0, 1], [0, 0, 0], 0.01);
    // A jolt: 2.5 g sideways for 0.1 s, the pad not turning.
    for (let i = 0; i < 10; i++) tilt.update([0, 2.5, 1], [0, 0, 0], 0.01);
    expect(Math.abs(deg(tilt.roll))).toBeLessThan(0.5);
  });

  it("recentres on how the pad is held when asked", () => {
    const tilt = new TiltEstimator();
    for (let i = 0; i < 300; i++) tilt.update(flatTilt(0.5), [0, 0, 0], 0.01);
    tilt.calibrate();
    tilt.update(flatTilt(0.5), [0, 0, 0], 0.01);
    expect(tilt.roll).toBeCloseTo(0, 6);
  });

  it("steers right for a right turn, full at the set tilt, straight inside 1.5°", () => {
    const rad = (d: number) => (d * Math.PI) / 180;
    expect(tiltSteer(rad(1), 60)).toBeCloseTo(0);
    expect(tiltSteer(rad(60), 60)).toBeCloseTo(-1, 9);
    expect(tiltSteer(rad(90), 60)).toBe(-1);
    expect(tiltSteer(rad(-30), 60)).toBeGreaterThan(0.45);
    expect(tiltSteer(rad(30), 60, true)).toBeGreaterThan(0.45);
  });
});

describe("振動の混ぜ方とイベント", () => {
  it("ends each effect after its duration", () => {
    const m = new RumbleMixer();
    m.play("bump", 1, 0);
    expect(isSilent(m.frame(10))).toBe(false);
    expect(isSilent(m.frame(200))).toBe(true);
    m.play("impact", 1, 1000);
    expect(m.frame(1010).low.amp).toBeGreaterThan(0.9);
    expect(isSilent(m.frame(1600))).toBe(true);
  });

  it("scales a crash by its strength and the intensity setting", () => {
    const soft = effectFor("impact", 0.1, 0).sample(0);
    const hard = effectFor("impact", 1, 0).sample(0);
    expect(hard.low.amp).toBeGreaterThan(soft.low.amp);
    const m = new RumbleMixer();
    m.play("impact", 1, 0);
    expect(m.frame(0, 0.5).low.amp).toBeCloseTo(hard.low.amp * 0.5);
    expect(isSilent(m.frame(0, 0))).toBe(true);
  });

  it("presses the stamp in two beats with a gap", () => {
    const stamp = effectFor("stamp", 1, 0);
    expect(stamp.sample(20).low.amp).toBeGreaterThan(0.5);
    expect(isSilent(stamp.sample(100))).toBe(true);
    expect(stamp.sample(150).low.amp).toBeGreaterThan(0.2);
  });

  it("adds amplitudes (to at most 1) and takes each band's pitch from its loudest part", () => {
    const mixed = mixFrames([
      { low: { hz: 70, amp: 0.7 }, high: { hz: 160, amp: 0.1 } },
      { low: { hz: 120, amp: 0.6 }, high: { hz: 300, amp: 0.3 } },
    ]);
    expect(mixed.low).toEqual({ hz: 70, amp: 1 });
    expect(mixed.high.hz).toBe(300);
    expect(mixed.high.amp).toBeCloseTo(0.4);
    expect(mixFrames([])).toEqual(SILENT);
  });

  it("keeps the idle hum only while it is fed (a paused game lets it stop)", () => {
    const m = new RumbleMixer();
    m.hold("idle", idleFrame(0), 0);
    expect(m.frame(100).low.amp).toBeCloseTo(0.07);
    expect(m.frame(100).low.hz).toBe(42);
    expect(isSilent(m.frame(400))).toBe(true);
  });

  it("feels a kerb's jolt in the vertical speed, not the road's slope", () => {
    expect(bumpStrength(0, 0.2)).toBe(0);
    expect(bumpStrength(0.1, -0.3)).toBe(0);
    expect(bumpStrength(0, 1.5)).toBeGreaterThan(0.4);
    expect(bumpStrength(-1, 2)).toBe(1);
  });
});
