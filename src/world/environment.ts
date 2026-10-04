import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PMREMGenerator } from "three";
import { QUALITY } from "../device";
import { jstDateAt, jstHour, sunPosition } from "../geo/sun";

export type TimeMode = "real" | "morning" | "day" | "evening" | "night";
export const TIME_MODES: TimeMode[] = ["real", "morning", "day", "evening", "night"];
export const TIME_LABEL: Record<TimeMode, string> = {
  real: "リアル時刻",
  morning: "朝",
  day: "昼",
  evening: "夕方",
  night: "夜",
};

export type WeatherMode = "real" | "clear" | "rain";
export const WEATHER_LABEL: Record<WeatherMode, string> = {
  real: "リアル天気",
  clear: "晴れ",
  rain: "雨",
};

export type Observation = {
  temp: number | null;
  precip10m: number | null;
  wind: number | null;
  sun1h: number | null;
  time: string;
};

const RAIN_DROPS = 5000;
const RAIN_BOX = 90;

/**
 * Sky, sun, fog and rain. Time presets are derived from today's real solar geometry over Tokyo
 * (e.g. "朝" = sun 9° above the eastern horizon) rather than fixed clock hours, so they look
 * right in every season.
 */
export class Environment {
  readonly sun = new DirectionalLight(0xffffff, 2.5);
  private readonly hemi = new HemisphereLight(0xbfd9ff, 0x4a4036, 0.9);
  private readonly sky = new Sky();
  private readonly fog = new Fog(0xbfd2e4, 400, 3200);
  private readonly rain: LineSegments;
  private readonly sunDir = new Vector3();
  private mode: TimeMode = "real";
  private weatherMode: WeatherMode = "real";
  private observation: Observation | null = null;
  /**
   * The game moment (epoch ms). In リアル時刻 it is the wall clock; a preset jumps to that time
   * of day on the game's date and the clock runs on from there, so timed rules (通学路の通行止め,
   * 時間帯の一方通行) come into and out of force while playing.
   */
  private gameMs = Date.now();
  private isPresetPending = false;
  nightFactor = 0;
  sunElevation = 0;

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
  ) {
    // Image-based lighting gives the clear-coated car and PLATEAU façades something to reflect;
    // a procedural room avoids shipping an HDR asset.
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.sky.scale.setScalar(40000);
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -140;
    cam.right = cam.top = 140;
    cam.near = 10;
    cam.far = 1500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target, this.hemi);

    const positions = new Float32Array(RAIN_DROPS * 6);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = (Math.random() - 0.5) * RAIN_BOX;
      const y = Math.random() * RAIN_BOX * 0.6;
      const z = (Math.random() - 0.5) * RAIN_BOX;
      positions.set([x, y, z, x + 0.05, y - 0.9, z], i * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.rain = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.45 }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  get timeMode(): TimeMode {
    return this.mode;
  }

  set timeMode(mode: TimeMode) {
    this.mode = mode;
    this.isPresetPending = mode !== "real";
    if (mode === "real") this.gameMs = Date.now();
  }

  /** Game time now. */
  now(): Date {
    return new Date(this.gameMs);
  }

  /** The next morning at `hour` (JST), the clock running on from there (after the day ends). */
  startNextDay(hour = 8): void {
    if (this.mode === "real") this.mode = "morning";
    this.isPresetPending = false;
    const tomorrow = new Date(this.gameMs + 24 * 3600_000);
    this.gameMs = jstDateAt(hour, tomorrow).getTime();
  }

  get weather(): WeatherMode {
    return this.weatherMode;
  }

  set weather(mode: WeatherMode) {
    this.weatherMode = mode;
  }

  setObservation(obs: Observation | null): void {
    this.observation = obs;
  }

  getObservation(): Observation | null {
    return this.observation;
  }

  isRaining(): boolean {
    if (this.weatherMode === "rain") return true;
    if (this.weatherMode === "clear") return false;
    return (this.observation?.precip10m ?? 0) > 0;
  }

  /** Clock hour (JST) currently being rendered. */
  displayHour(lat: number, lon: number): number {
    this.resolvePreset(lat, lon);
    return jstHour(this.now());
  }

  /** The preset's hour depends on where the sun is (夕方 = sunset here), so it is set on first use. */
  private resolvePreset(lat: number, lon: number): void {
    if (!this.isPresetPending) return;
    this.isPresetPending = false;
    this.gameMs = jstDateAt(computePresetHour(this.mode, lat, lon), this.now()).getTime();
  }

  update(dt: number, player: Vector3, camera: Vector3, lat: number, lon: number): void {
    this.resolvePreset(lat, lon);
    this.gameMs = this.mode === "real" ? Date.now() : this.gameMs + dt * 1000;
    const date = this.now();
    const { elevation, azimuth } = sunPosition(date, lat, lon);
    this.sunElevation = elevation;
    const el = MathUtils.degToRad(elevation);
    const az = MathUtils.degToRad(azimuth);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));

    const raining = this.isRaining();
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = raining ? 12 : 4;
    u.rayleigh.value = elevation < 12 ? 2.4 : 1.4;
    u.mieCoefficient.value = raining ? 0.02 : 0.005;
    u.cloudCoverage.value = raining ? 0.85 : 0.35;
    u.time.value += dt;
    this.sky.position.copy(camera);

    // 1 at deep night, 0 in full daylight, smooth through civil twilight.
    this.nightFactor = MathUtils.smoothstep(-elevation, -2, 8);
    const day = 1 - this.nightFactor;
    const golden = MathUtils.smoothstep(elevation, -2, 4) * (1 - MathUtils.smoothstep(elevation, 8, 22));

    const sunColor = new Color(0xffffff).lerp(new Color(0xff9a52), golden);
    const lightDir = elevation > -4 ? this.sunDir : new Vector3(0.3, 0.8, 0.4).normalize(); // moon
    this.sun.color.copy(elevation > -4 ? sunColor : new Color(0x8fa6d8));
    this.sun.intensity = elevation > -4 ? MathUtils.lerp(0.25, raining ? 1.2 : 2.8, day) : 0.35;
    this.sun.position.copy(player).addScaledVector(lightDir, 600);
    this.sun.target.position.copy(player);

    this.hemi.intensity = MathUtils.lerp(0.45, raining ? 1.6 : 1.5, day);
    this.hemi.color.set(0xbfd9ff).lerp(new Color(0x324a7a), this.nightFactor);

    const dayFog = new Color(raining ? 0x9aa3ab : 0xbfd2e4);
    const fogColor = dayFog
      .lerp(new Color(0xf0a070), golden * 0.7)
      .lerp(new Color(0x0c1528), this.nightFactor);
    this.fog.color.copy(fogColor);
    this.fog.near = raining ? 120 : 500;
    this.fog.far = raining ? 1300 : MathUtils.lerp(2600, 4200, day);
    this.renderer.toneMappingExposure = MathUtils.lerp(0.75, raining ? 0.95 : 1.0, day) + golden * 0.1;

    this.scene.environmentIntensity = MathUtils.lerp(0.06, raining ? 0.35 : 0.5, day) + golden * 0.1;

    this.rain.visible = raining;
    if (raining) this.animateRain(dt, camera);
  }

  private animateRain(dt: number, camera: Vector3): void {
    const pos = this.rain.geometry.getAttribute("position") as BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = dt * 22;
    for (let i = 0; i < RAIN_DROPS; i++) {
      const k = i * 6;
      arr[k + 1] -= fall;
      arr[k + 4] -= fall;
      if (arr[k + 4] < 0) {
        const y = RAIN_BOX * 0.6;
        arr[k + 1] = y;
        arr[k + 4] = y - 0.9;
      }
    }
    pos.needsUpdate = true;
    this.rain.position.set(camera.x, camera.y - RAIN_BOX * 0.25, camera.z);
  }
}

function computePresetHour(mode: TimeMode, lat: number, lon: number): number {
  const elevationAt = (h: number) => sunPosition(jstDateAt(h), lat, lon).elevation;
  const scan = (from: number, to: number, step: number, test: (el: number) => boolean) => {
    for (let h = from; step > 0 ? h <= to : h >= to; h += step) if (test(elevationAt(h))) return h;
    return from;
  };
  switch (mode) {
    case "morning":
      return scan(3, 11, 1 / 12, (el) => el >= 9);
    case "evening":
      return scan(20, 13, -1 / 12, (el) => el >= 3);
    case "day": {
      let best = 12;
      for (let h = 10; h <= 14; h += 1 / 12) if (elevationAt(h) > elevationAt(best)) best = h;
      return best;
    }
    case "night":
      return 21.5;
    default:
      return jstHour(new Date());
  }
}
