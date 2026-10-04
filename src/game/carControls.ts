/**
 * The switches a driver works besides the wheel and pedals, with City Car Driving's default keys
 * (`,` `.` 方向指示器, G ハザード, L 前照灯, K ハイビーム, Tab ワイパー, B シートベルト, E エンジン).
 * The law checks read them: 合図 before turning and changing lanes (第53条), 前照灯 at night
 * (第52条), the seat belt (第71条の3).
 */
export type Indicator = "off" | "left" | "right";
export type LightSwitch = "auto" | "on" | "off";

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
  private turnStartYaw: number | null = null;

  toggleIndicator(side: "left" | "right"): void {
    this.indicator = this.indicator === side ? "off" : side;
    this.turnStartYaw = null;
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
    if (turned > 1.0 && Math.abs(steer) < 0.15) {
      this.indicator = "off";
      this.turnStartYaw = null;
    }
  }

  /** Lamps for the model: hazard flashes both. */
  lamps(): { left: boolean; right: boolean } {
    return {
      left: this.hazard || this.indicator === "left",
      right: this.hazard || this.indicator === "right",
    };
  }
}
