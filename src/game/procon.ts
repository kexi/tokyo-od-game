import { log, warn } from "../log";
import { SILENT, type Band, type RumbleFrame } from "./rumble";
import { TiltEstimator, type Vec3 } from "./tilt";

/**
 * The Nintendo Switch Pro Controller over WebHID (Chrome): its full input report with the 6-axis
 * sensor (gyro steering) and its HD rumble, which the Gamepad API does not expose. The protocol is
 * the community's reverse-engineered one — dekuNukem/Nintendo_Switch_Reverse_Engineering
 * (bluetooth_hid_notes.md, bluetooth_hid_subcommands_notes.md, imu_sensor_notes.md,
 * rumble_data_table.md, USB-HID-Notes.md) — cross-checked with Chromium's own driver
 * (device/gamepad/nintendo_controller.cc) and SDL's (SDL_hidapi_switch.c); knowledge/
 * gamepad-and-procon.md has the bytes used and what is and is not verified on a device.
 *
 * WebHID hands an input report's bytes without the report ID, so every offset below is the notes'
 * byte number minus one; sendReport() likewise takes the ID apart from the data.
 */

export const NINTENDO_VENDOR = 0x057e;
export const PRO_CONTROLLER = 0x2009;

/** Report IDs (dekuNukem bluetooth_hid_notes.md, USB-HID-Notes.md). */
export const REPORT = {
  /** Output: rumble + a subcommand. */
  subcommand: 0x01,
  /** Output: rumble only. */
  rumble: 0x10,
  /** Output (USB): the controller's own USB commands (handshake, no-timeout). */
  usb: 0x80,
  /** Input: a subcommand's reply with the buttons and sticks. */
  reply: 0x21,
  /** Input: standard full mode, buttons + sticks + 3 IMU samples, pushed at 60–120 Hz. */
  full: 0x30,
  /** Input: simple HID mode (the state a fresh controller is in, buttons only on change). */
  simple: 0x3f,
} as const;

/** Subcommands (dekuNukem bluetooth_hid_subcommands_notes.md). */
export const SUBCOMMAND = {
  /** Set input report mode; 0x30 = standard full mode. */
  inputMode: 0x03,
  playerLights: 0x30,
  /** Enable the IMU (6-axis sensor): 0x01 on. Chrome's own driver sends 0x00 when it starts. */
  imu: 0x40,
  /** Enable vibration: 0x01 on. */
  vibration: 0x48,
} as const;

/** Neutral rumble for one side: 320 Hz and 160 Hz at amplitude 0 (bluetooth_hid_notes.md). */
export const NEUTRAL_RUMBLE = [0x00, 0x01, 0x40, 0x40] as const;

// ---------------------------------------------------------------- input reports

export type ProConButtons = {
  y: boolean;
  x: boolean;
  b: boolean;
  a: boolean;
  r: boolean;
  zr: boolean;
  minus: boolean;
  plus: boolean;
  rStick: boolean;
  lStick: boolean;
  home: boolean;
  capture: boolean;
  down: boolean;
  up: boolean;
  right: boolean;
  left: boolean;
  l: boolean;
  zl: boolean;
};

/** One IMU sample, raw int16 counts. */
export type ImuRaw = { accel: Vec3; gyro: Vec3 };

export type ProConReport = {
  reportId: number;
  timer: number;
  /** 0–8 (8 full); charging in the low bit of the nibble. */
  battery: number;
  charging: boolean;
  buttons: ProConButtons;
  /** 12-bit stick readings, uncalibrated (centre ≈ 2048). */
  sticks: { lx: number; ly: number; rx: number; ry: number };
  /** Three samples ~5 ms apart (0x30 only; empty in a 0x21 reply). All zeros = the IMU is off. */
  imu: ImuRaw[];
  /** A 0x21 reply: the subcommand it answers and whether it was acknowledged. */
  reply: { subcommand: number; ack: boolean } | null;
};

const bit = (byte: number, mask: number) => (byte & mask) !== 0;

/**
 * Parse an input report's data (report ID removed, as WebHID gives it). Only 0x30 and 0x21 carry
 * the standard layout; anything else (the 0x3F simple mode, 0x81 USB replies) is null.
 */
export function parseInputReport(reportId: number, data: DataView): ProConReport | null {
  const isStandard = reportId === REPORT.full || reportId === REPORT.reply;
  if (!isStandard || data.byteLength < 12) return null;
  const u8 = (i: number) => data.getUint8(i);
  const right = u8(2);
  const shared = u8(3);
  const left = u8(4);
  const stick = (o: number) => ({
    x: u8(o) | ((u8(o + 1) & 0x0f) << 8),
    y: (u8(o + 1) >> 4) | (u8(o + 2) << 4),
  });
  const l = stick(5);
  const r = stick(8);
  const imu: ImuRaw[] = [];
  const hasImu = reportId === REPORT.full && data.byteLength >= 48;
  const sampleCount = hasImu ? 3 : 0;
  for (let s = 0; s < sampleCount; s++) {
    const o = 12 + s * 12;
    const i16 = (k: number) => data.getInt16(o + k * 2, true);
    imu.push({ accel: [i16(0), i16(1), i16(2)], gyro: [i16(3), i16(4), i16(5)] });
  }
  const isReply = reportId === REPORT.reply && data.byteLength >= 14;
  return {
    reportId,
    timer: u8(0),
    battery: (u8(1) >> 4) & 0x0e,
    charging: bit(u8(1), 0x10),
    buttons: {
      y: bit(right, 0x01),
      x: bit(right, 0x02),
      b: bit(right, 0x04),
      a: bit(right, 0x08),
      r: bit(right, 0x40),
      zr: bit(right, 0x80),
      minus: bit(shared, 0x01),
      plus: bit(shared, 0x02),
      rStick: bit(shared, 0x04),
      lStick: bit(shared, 0x08),
      home: bit(shared, 0x10),
      capture: bit(shared, 0x20),
      down: bit(left, 0x01),
      up: bit(left, 0x02),
      right: bit(left, 0x04),
      left: bit(left, 0x08),
      l: bit(left, 0x40),
      zl: bit(left, 0x80),
    },
    sticks: { lx: l.x, ly: l.y, rx: r.x, ry: r.y },
    imu,
    reply: isReply ? { ack: bit(u8(12), 0x80), subcommand: u8(13) } : null,
  };
}

/** The buttons in the W3C standard order Chrome's driver uses (nintendo_controller.cc). */
export function standardButtons(b: ProConButtons): boolean[] {
  return [
    b.b,
    b.a,
    b.y,
    b.x,
    b.l,
    b.r,
    b.zl,
    b.zr,
    b.minus,
    b.plus,
    b.lStick,
    b.rStick,
    b.up,
    b.down,
    b.left,
    b.right,
    b.home,
    b.capture,
  ];
}

// Chromium's defaults for a controller whose SPI calibration is unread (nintendo_controller.cc
// kCalDefault*): centre 2050, ±1500, a dead zone of 160 counts. Reading the factory calibration
// (SPI 0x603D) would be exact; the sticks come from the Gamepad API whenever Chrome has the pad,
// so this is only the fallback.
const STICK_CENTRE = 2050;
const STICK_SPAN = 1500;
const STICK_DEAD = 160;

/** A 12-bit stick reading as a standard axis (−1…1, up negative as the W3C mapping has it). */
export function stickAxes(sticks: ProConReport["sticks"]): [number, number, number, number] {
  return [
    stickAxis(sticks.lx, false),
    stickAxis(sticks.ly, true),
    stickAxis(sticks.rx, false),
    stickAxis(sticks.ry, true),
  ];
}

function stickAxis(raw: number, flip: boolean): number {
  const d = raw - STICK_CENTRE;
  if (Math.abs(d) < STICK_DEAD) return 0;
  const v = Math.max(-1, Math.min(1, d / STICK_SPAN));
  return flip ? -v : v;
}

/** ±8 g over int16: 0.000244 g per count (imu_sensor_notes.md, the default after 0x40 01). */
export const ACCEL_G_PER_COUNT = 0.000244;
/** ±2000 °/s: 0.06103 °/s per count (imu_sensor_notes.md, "accurate"), here in rad/s. */
export const GYRO_RAD_PER_COUNT = (0.06103 * Math.PI) / 180;

/** The mean of a report's IMU samples in g and rad/s; null when the IMU is off (all zeros). */
export function imuMean(samples: readonly ImuRaw[]): { accel: Vec3; gyro: Vec3 } | null {
  if (samples.length === 0) return null;
  const isOff = samples.every((s) => s.accel.every((v) => v === 0) && s.gyro.every((v) => v === 0));
  if (isOff) return null;
  const mean = (pick: (s: ImuRaw) => Vec3, k: number): Vec3 => {
    const sum = [0, 0, 0];
    for (const s of samples) for (let i = 0; i < 3; i++) sum[i] += pick(s)[i];
    return [(sum[0] / samples.length) * k, (sum[1] / samples.length) * k, (sum[2] / samples.length) * k];
  };
  return { accel: mean((s) => s.accel, ACCEL_G_PER_COUNT), gyro: mean((s) => s.gyro, GYRO_RAD_PER_COUNT) };
}

// ---------------------------------------------------------------- output reports

/** Output report 0x01's data: counter, 8 bytes of rumble, the subcommand and its arguments. */
export function subcommandData(
  counter: number,
  subcommand: number,
  args: readonly number[],
  size = 48,
  rumble: readonly number[] = [...NEUTRAL_RUMBLE, ...NEUTRAL_RUMBLE],
): Uint8Array {
  const out = new Uint8Array(Math.max(size, 10 + args.length));
  out[0] = counter & 0x0f;
  out.set(rumble.slice(0, 8), 1);
  out[9] = subcommand;
  out.set(args, 10);
  return out;
}

/** Output report 0x10's data: counter and rumble for the left and right actuators. */
export function rumbleData(
  counter: number,
  left: readonly number[],
  right: readonly number[],
  size = 48,
): Uint8Array {
  const out = new Uint8Array(Math.max(size, 9));
  out[0] = counter & 0x0f;
  out.set(left.slice(0, 4), 1);
  out.set(right.slice(0, 4), 5);
  return out;
}

/**
 * Amplitudes 1–15 of rumble_data_table.md, which its two formulas (16–31: log2(17a)·16, 32–100:
 * log2(8.7a)·32) do not cover.
 */
const LOW_AMPLITUDES = [
  0.007843, 0.011823, 0.014061, 0.01672, 0.019885, 0.023648, 0.028123, 0.033442, 0.039771, 0.047296, 0.056246,
  0.066886, 0.079542, 0.094592, 0.112491,
];
/** The amplitude of encoded value 0–100 (100 = 1.0, the table's safe maximum, HA 0xC8 / LA 0x72). */
export const AMPLITUDES: readonly number[] = Array.from({ length: 101 }, (_, e) =>
  e === 0 ? 0 : e < 16 ? LOW_AMPLITUDES[e - 1] : e < 32 ? 2 ** (e / 16) / 17 : 2 ** (e / 32) / 8.7,
);

/** The encoded amplitude (0–100) nearest `amp`; never above the table's safe 1.0. */
export function encodeAmplitude(amp: number): number {
  if (!(amp > 0)) return 0;
  let best = 0;
  for (let e = 1; e < AMPLITUDES.length; e++)
    if (Math.abs(AMPLITUDES[e] - amp) < Math.abs(AMPLITUDES[best] - amp)) best = e;
  return best;
}

/** round(log2(f / 10) · 32), the frequency's encoded value (rumble_data_table.md). */
const encodeFrequency = (hz: number) => Math.round(Math.log2(Math.max(1, hz) / 10) * 32);

/**
 * One actuator's 4 bytes for a high band and a low band (rumble_data_table.md):
 * HF = (f − 0x60)·4 over 0x0004–0x01FC (81.75–1252.57 Hz), LF = f − 0x40 over 0x01–0x7F (40.88–
 * 626.28 Hz); HA = a·2, LA = 0x40 + a/2 with 0x8000 for an odd a. Bytes: HF low, HA + HF high,
 * LF + LA high, LA low. Frequencies outside a band are clamped to it.
 */
export function encodeRumbleSide(high: Band, low: Band): [number, number, number, number] {
  const hfCode = Math.min(0xdf, Math.max(0x61, encodeFrequency(high.hz)));
  const lfCode = Math.min(0xbf, Math.max(0x41, encodeFrequency(low.hz)));
  const hf = (hfCode - 0x60) * 4;
  const lf = lfCode - 0x40;
  const ha = encodeAmplitude(high.amp) * 2;
  const laCode = encodeAmplitude(low.amp);
  const la = (0x40 + (laCode >> 1)) | (laCode & 1 ? 0x8000 : 0);
  return [hf & 0xff, (ha + ((hf >> 8) & 0xff)) & 0xff, (lf + ((la >> 8) & 0xff)) & 0xff, la & 0xff];
}

export const encodeRumbleFrame = (f: RumbleFrame) => encodeRumbleSide(f.high, f.low);

// ---------------------------------------------------------------- WebHID

/** The slice of WebHID used here (the DOM library has no WebHID types). */
type HidReportItem = { reportSize?: number; reportCount?: number };
type HidReportInfo = { reportId?: number; items?: HidReportItem[] };
type HidCollection = { outputReports?: HidReportInfo[] };
export type HidDeviceLike = EventTarget & {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName: string;
  collections: HidCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
};
type HidLike = EventTarget & {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: {
    filters: Array<{ vendorId: number; productId?: number }>;
  }): Promise<HidDeviceLike[]>;
};
type InputReportEvent = Event & { reportId: number; data: DataView; device: HidDeviceLike };

export const hidOf = (): HidLike | null =>
  (globalThis.navigator as (Navigator & { hid?: HidLike }) | undefined)?.hid ?? null;

const isProCon = (d: HidDeviceLike) => d.vendorId === NINTENDO_VENDOR && d.productId === PRO_CONTROLLER;

/** The data size of an output report from the descriptor (bytes, without the ID). */
export function outputReportSize(collections: readonly HidCollection[], reportId: number): number | null {
  for (const c of collections)
    for (const r of c.outputReports ?? []) {
      if (r.reportId !== reportId) continue;
      const bits = (r.items ?? []).reduce((sum, i) => sum + (i.reportSize ?? 0) * (i.reportCount ?? 0), 0);
      if (bits > 0) return Math.ceil(bits / 8);
    }
  return null;
}

// Chromium tells USB from Bluetooth the same way: the output reports are 63 bytes over USB and 48
// over Bluetooth (nintendo_controller.cc kSwitchProMaxOutputReportSizeBytes*).
const USB_REPORT_BYTES = 63;
const BT_REPORT_BYTES = 48;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ProConStatus = "unsupported" | "idle" | "connecting" | "connected";

/**
 * The connection: opened from the 設定 button (requestDevice needs the click) or, on later visits,
 * from the permission Chrome remembers (getDevices on load, and its connect event when the
 * controller is switched on or plugged in again).
 */
export class ProConHid {
  status: ProConStatus = hidOf() ? "idle" : "unsupported";
  usb = false;
  /** The latest full report, and when it came (performance.now()). */
  report: ProConReport | null = null;
  reportAt = -Infinity;
  /** The latest IMU sample, when the IMU is on. */
  imuAt = -Infinity;
  readonly tilt = new TiltEstimator();
  /** Called on connect, disconnect and the first report. */
  onChange: () => void = () => {};
  private device: HidDeviceLike | null = null;
  private counter = 0;
  private sendSize = BT_REPORT_BYTES;
  private queue: Promise<void> = Promise.resolve();
  private pendingRumble: RumbleFrame | null = null;
  private isSendingRumble = false;
  private lastRumbleKey = "";
  private lastRumbleAt = -Infinity;
  private lastImuFixAt = -Infinity;
  private lastReportTime = -Infinity;
  private readonly onInput = (e: Event) => this.handleReport(e as InputReportEvent);

  get connected(): boolean {
    return this.status === "connected";
  }

  get name(): string {
    return this.device?.productName || "Pro Controller";
  }

  /** Reopen a controller this site was allowed before, and follow it coming and going. */
  async restore(): Promise<void> {
    const hid = hidOf();
    if (!hid) return;
    hid.addEventListener("connect", (e) => {
      const device = (e as Event & { device: HidDeviceLike }).device;
      if (isProCon(device) && !this.device) void this.open(device);
    });
    hid.addEventListener("disconnect", (e) => {
      const device = (e as Event & { device: HidDeviceLike }).device;
      if (device === this.device) this.dropped();
    });
    try {
      const granted = (await hid.getDevices()).find(isProCon);
      if (granted) await this.open(granted);
    } catch (err) {
      warn("procon_hid_failed", { step: "restore", error: String(err) });
    }
  }

  /** The chooser (call from a click). */
  async request(): Promise<boolean> {
    const hid = hidOf();
    if (!hid) return false;
    try {
      const [device] = await hid.requestDevice({
        filters: [{ vendorId: NINTENDO_VENDOR, productId: PRO_CONTROLLER }],
      });
      if (!device) return false;
      await this.open(device);
      return this.connected;
    } catch (err) {
      warn("procon_hid_failed", { step: "request", error: String(err) });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    if (!device) return;
    await this.sendRumbleNow(SILENT).catch(() => {});
    this.dropped();
    try {
      await device.close();
    } catch {
      // Already gone (unplugged): nothing to close.
    }
  }

  /** Recentre the gyro wheel on how the controller is held now. */
  centre(): void {
    this.tilt.calibrate();
  }

  /** Play a rumble frame (coalesced: only the newest waits while one is being sent). */
  rumble(f: RumbleFrame, now: number): void {
    if (!this.connected) return;
    const bytes = encodeRumbleFrame(f);
    const key = bytes.join(",");
    // The same command again only to keep a long effect alive (the actuator is not documented to
    // hold a command for any length of time; Chromium resends each 100 ms chunk too).
    const isRepeat = key === this.lastRumbleKey && now - this.lastRumbleAt < 90;
    if (isRepeat) return;
    this.lastRumbleKey = key;
    this.lastRumbleAt = now;
    this.pendingRumble = f;
    if (!this.isSendingRumble) void this.flushRumble();
  }

  private async flushRumble(): Promise<void> {
    this.isSendingRumble = true;
    while (this.pendingRumble) {
      const f = this.pendingRumble;
      this.pendingRumble = null;
      await this.sendRumbleNow(f).catch((err) =>
        warn("procon_hid_failed", { step: "rumble", error: String(err) }),
      );
    }
    this.isSendingRumble = false;
  }

  private sendRumbleNow(f: RumbleFrame): Promise<void> {
    const side = encodeRumbleFrame(f);
    return this.send(REPORT.rumble, rumbleData(this.nextCounter(), side, side, this.sendSize));
  }

  private nextCounter(): number {
    this.counter = (this.counter + 1) & 0x0f;
    return this.counter;
  }

  private send(reportId: number, data: Uint8Array): Promise<void> {
    const device = this.device;
    if (!device) return Promise.resolve();
    // One write at a time: the controller answers subcommands in order, and Chrome queues anyway.
    const next = this.queue.then(() => device.sendReport(reportId, data as BufferSource));
    this.queue = next.catch(() => {});
    return next;
  }

  private subcommand(id: number, args: readonly number[]): Promise<void> {
    return this.send(REPORT.subcommand, subcommandData(this.nextCounter(), id, args, this.sendSize));
  }

  private async open(device: HidDeviceLike): Promise<void> {
    this.status = "connecting";
    this.onChange();
    try {
      if (!device.opened) await device.open();
    } catch (err) {
      this.status = "idle";
      this.onChange();
      warn("procon_hid_failed", { step: "open", error: String(err) });
      return;
    }
    this.device = device;
    const size = outputReportSize(device.collections, REPORT.subcommand);
    this.usb = (size ?? 0) >= USB_REPORT_BYTES;
    this.sendSize = size ?? BT_REPORT_BYTES;
    device.addEventListener("inputreport", this.onInput);
    this.status = "connected";
    this.tilt.calibrate();
    this.onChange();
    log("procon_hid_connected", { name: this.name, usb: this.usb, reportBytes: this.sendSize });
    try {
      await this.start();
    } catch (err) {
      warn("procon_hid_failed", { step: "init", error: String(err) });
    }
  }

  /**
   * Into full mode with the IMU and vibration on. Chrome's own Gamepad driver usually has the
   * controller already (the page polls getGamepads): it did the USB handshake and set full mode,
   * but switched the IMU off — so the IMU is switched on here, and again by handleReport() if
   * Chrome's driver switches it off later (it re-initialises on reconnect). Without Chrome's driver
   * (no reports at all after a moment), the USB handshake of USB-HID-Notes.md comes first.
   */
  private async start(): Promise<void> {
    await sleep(600);
    const isSilentUsb = this.usb && performance.now() - this.lastReportTime > 500;
    if (isSilentUsb) {
      for (const command of [0x02, 0x03, 0x02, 0x04]) {
        const data = new Uint8Array(USB_REPORT_BYTES);
        data[0] = command;
        await this.send(REPORT.usb, data);
        await sleep(60);
      }
    }
    await this.subcommand(SUBCOMMAND.inputMode, [0x30]);
    await sleep(50);
    await this.subcommand(SUBCOMMAND.imu, [0x01]);
    await sleep(50);
    await this.subcommand(SUBCOMMAND.vibration, [0x01]);
    if (isSilentUsb) {
      await sleep(50);
      await this.subcommand(SUBCOMMAND.playerLights, [0x01]);
    }
  }

  private handleReport(e: InputReportEvent): void {
    const now = performance.now();
    this.lastReportTime = now;
    const isSimpleMode = e.reportId === REPORT.simple;
    // Back in simple mode (the controller was reset, or another driver asked for it): full mode
    // again, at most every 2 s.
    if (isSimpleMode && now - this.lastImuFixAt > 2000) {
      this.lastImuFixAt = now;
      void this.subcommand(SUBCOMMAND.inputMode, [0x30]).catch(() => {});
      return;
    }
    const report = parseInputReport(e.reportId, e.data);
    if (!report) return;
    const isFirst = this.report === null;
    const dt = Math.min(0.1, Math.max(0.001, (now - this.reportAt) / 1000));
    this.report = report;
    this.reportAt = now;
    if (isFirst) this.onChange();
    if (report.reportId !== REPORT.full) return;
    const imu = imuMean(report.imu);
    if (imu) {
      this.tilt.update(imu.accel, imu.gyro, dt);
      this.imuAt = now;
      return;
    }
    // Full mode but the IMU is off (Chrome's driver switches it off when it initialises).
    const isImuStale = now - this.imuAt > 1000 && now - this.lastImuFixAt > 2000;
    if (isImuStale) {
      this.lastImuFixAt = now;
      void this.subcommand(SUBCOMMAND.imu, [0x01]).catch(() => {});
    }
  }

  private dropped(): void {
    this.device?.removeEventListener("inputreport", this.onInput);
    this.device = null;
    this.report = null;
    this.reportAt = -Infinity;
    this.imuAt = -Infinity;
    this.status = hidOf() ? "idle" : "unsupported";
    log("procon_hid_disconnected", {});
    this.onChange();
  }
}
