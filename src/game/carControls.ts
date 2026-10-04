/**
 * The switches a driver works besides the wheel and pedals, with City Car Driving's default keys
 * (`,` `.` 方向指示器, G ハザード, L 前照灯, K ハイビーム, Tab ワイパー, B シートベルト, E エンジン).
 * The law checks read them: 合図 before turning and changing lanes (第53条), 前照灯 at night
 * (第52条), the seat belt (第71条の3).
 */
export type Indicator = "off" | "left" | "right";
export type LightSwitch = "auto" | "on" | "off";
/** 簡単操作 (the default): the car works its switches; リアル: the driver does everything. */
export type Assist = "easy" | "real";

/** What 簡単操作 needs to know to work the switches. */
export type AutoContext = {
  raining: boolean;
  /** Rain in the last 10 minutes (mm), when observed. */
  rain10m: number | null;
  /** The next turn on the navigation's route and how far ahead it is (m). */
  nextTurn: { side: "left" | "right" | null; metres: number } | null;
  /** The car has left the navigation's route. */
  offRoute: boolean;
  kmh: number;
  throttle: number;
};

// 合図 is given 30 m before the point of turning (道路交通法施行令 第21条); a few metres more so
// the lamp is already blinking at 30 m.
const SIGNAL_AHEAD_M = 34;

export class CarControls {
  indicator: Indicator = "off";
  hazard = false;
  /** Auto-lighting is standard on new cars in Japan (保安基準, 2020 年以降の新型車). */
  lights: LightSwitch = "auto";
  highBeam = false;
  engineOn = true;
  belt = false;
  /** 0 off, 1 intermittent, 2 low, 3 high. */
  wipers = 0;
  assist: Assist = "easy";
  /** 簡単操作's brake hold (like an electronic parking brake's auto hold) while stopped. */
  autoHold = false;
  private turnStartYaw: number | null = null;
  private stoppedFor = 0;
  /** The side 簡単操作 switched the indicator on for (null: off, or the driver's own). */
  private autoSignal: "left" | "right" | null = null;
  /** How far the car has turned since the indicator went on (rad). */
  private turned = 0;

  toggleIndicator(side: "left" | "right"): void {
    this.indicator = this.indicator === side ? "off" : side;
    this.turnStartYaw = null;
    this.autoSignal = null;
  }

  cycleLights(): LightSwitch {
    this.lights = this.lights === "auto" ? "on" : this.lights === "on" ? "off" : "auto";
    return this.lights;
  }

  /** Whether the headlights are lit now. */
  headlightsOn(isDark: boolean): boolean {
    return this.lights === "on" || (this.lights === "auto" && isDark);
  }

  /**
   * Self-cancelling, as the column switch does: once the car has turned well past the way it
   * pointed when the turn began and the wheel comes back, the indicator goes off.
   */
  update(yaw: number, steer: number): void {
    if (this.indicator === "off") return;
    this.turnStartYaw ??= yaw;
    const turned = Math.abs(Math.atan2(Math.sin(yaw - this.turnStartYaw), Math.cos(yaw - this.turnStartYaw)));
    this.turned = turned;
    if (turned > 1.0 && Math.abs(steer) < 0.15) {
      this.indicator = "off";
      this.turnStartYaw = null;
      this.autoSignal = null;
    }
  }

  /**
   * 簡単操作: engine, seat belt, lights (AUTO, dipped), rain-sensing wipers, the indicator from the
   * route 30 m before each turn, and a brake hold once stopped. The law checks still read the
   * switches, so the car keeps the rules a careful driver would.
   */
  autoOperate(c: AutoContext, dt: number): void {
    if (this.assist !== "easy") {
      this.autoHold = false;
      return;
    }
    this.engineOn = true;
    this.belt = true;
    this.lights = "auto";
    this.highBeam = false;
    // Rain sensor: 間欠 in a drizzle, LO in steady rain, HI in a downpour (mm per 10 min).
    const rate = c.rain10m ?? 0.5;
    this.wipers = !c.raining ? 0 : rate >= 3 ? 3 : rate >= 0.5 ? 2 : 1;
    const turn = c.nextTurn;
    const isSignalling = turn !== null && turn.side !== null && turn.metres <= SIGNAL_AHEAD_M;
    if (isSignalling && turn.side && this.indicator !== turn.side && !this.hazard) {
      this.indicator = turn.side;
      this.turnStartYaw = null;
      this.autoSignal = turn.side;
      this.turned = 0;
    }
    // The signal it gave is no longer true: the car left the route, or the turn it was for is gone
    // (passed, or far again after a replan) before the car began turning. Signalling a turn the car
    // will not make misleads everyone around it.
    const isOwnSignal = this.autoSignal !== null && this.indicator === this.autoSignal;
    const isMidTurn = this.turned > 0.35;
    const isStale = !isSignalling || turn?.side !== this.autoSignal;
    if (isOwnSignal && (c.offRoute || (isStale && !isMidTurn))) {
      this.indicator = "off";
      this.turnStartYaw = null;
      this.autoSignal = null;
    }
    const isStopped = c.kmh < 0.5 && c.throttle === 0;
    this.stoppedFor = isStopped ? this.stoppedFor + dt : 0;
    this.autoHold = this.stoppedFor > 0.6;
  }

  /** Lamps for the model: hazard flashes both. */
  lamps(): { left: boolean; right: boolean } {
    return {
      left: this.hazard || this.indicator === "left",
      right: this.hazard || this.indicator === "right",
    };
  }
}
