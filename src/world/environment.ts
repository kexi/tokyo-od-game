import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Vector3,
  type Scene,
  type Texture,
} from "three";
import { type Node, PMREMGenerator, type WebGPURenderer } from "three/webgpu";
import { ATMOSPHERE, atmosphereFog, extinctionFor } from "./atmosphere";
import { FAR_GROUND_REACH } from "./farGround";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GRAPHICS, QUALITY } from "../device";
import { jstDateAt, jstHour, sunPosition } from "../geo/sun";
import { spellMinutes, rainRateMmH } from "./weatherSpells";
import { SkyEnvMap, type EnvState } from "./skyEnvMap";
import { type SkyLook, TokyoSky } from "./skyShader";
import { lightBalance, nightFactorAt, type LightBalance } from "./skyLight";

export type TimeMode = "real" | "morning" | "day" | "evening" | "night";
export const TIME_MODES: TimeMode[] = ["real", "morning", "day", "evening", "night"];
export const TIME_LABEL: Record<TimeMode, string> = {
  real: "リアル時刻",
  morning: "朝",
  day: "昼",
  evening: "夕方",
  night: "夜",
};

export type WeatherMode = "real" | "auto" | "clear" | "rain";
export const WEATHER_LABEL: Record<WeatherMode, string> = {
  real: "リアル天気",
  auto: "おまかせ",
  clear: "晴れ",
  rain: "雨",
};

/**
 * Game time per real time outside リアル時刻: a minute a second, a day in 24 minutes, so morning,
 * noon, dusk and night all come round in a session. Deadlines, posts' ages, the tide and timed
 * rules follow the same clock; what should keep a human pace (the weather's spells, the feed's
 * chatter) is set in real time.
 */
export const GAME_TIME_SCALE = 60;

export type Observation = {
  /** Meteorological visibility (m) around Tokyo; 20000 = 20 km or more. */
  visibility: number | null;
  humidity: number | null;
  temp: number | null;
  precip10m: number | null;
  wind: number | null;
  sun1h: number | null;
  time: string;
};

const RAIN_DROPS = 5000;
const RAIN_BOX = 90;
/** Seconds for the sky and the light to turn from fair to rain or back. */
const WEATHER_TURN_S = 25;
/** Where the moonlight comes from (high in the south-east; its phase is not modelled). */
const MOON_DIR = new Vector3(0.3, 0.8, 0.4).normalize();
/** The game sky's numeric uniforms that the environment map's sky takes over (the clouds drift with
 * TSL's own clock in both, so no time is copied). */
const SKY_COPIED = ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG", "cloudCoverage"] as const;
/**
 * 画質 › 空の映り込み: the sky's environment map size (per cube face) and how far the sky moves
 * before it is drawn again (degrees of sun, see isEnvStale) and how often at most. 高 is 256, the
 * size of the studio map 「なし」 keeps, so switching between them compiles no material again.
 */
const REFLECTIONS = {
  low: { size: 64, step: 3, gapMs: 3000 },
  high: { size: 256, step: 1, gapMs: 400 },
} as const;

/**
 * Sky, sun, fog and rain. Time presets are derived from today's real solar geometry over Tokyo
 * (e.g. "朝" = sun 9° above the eastern horizon) rather than fixed clock hours, so they look
 * right in every season.
 */
export class Environment {
  readonly sun = new DirectionalLight(0xffffff, 2.5);
  private readonly hemi = new HemisphereLight(0xbfd9ff, 0x4a4036, 0.9);
  /** Preetham's sky with clouds, in TSL with Tokyo's additions (skyShader.ts). */
  private readonly sky = new TokyoSky();
  /** The night glow, stars, blue hour, rain deck and horizon haze added to the sky (skyShader.ts). */
  private readonly look: SkyLook = this.sky.look;
  /** scene.environment drawn from this sky (skyEnvMap.ts), or the studio for 空の映り込み なし. */
  envMap: SkyEnvMap | null = null;
  private studio: Texture | null = null;
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
  private autoRaining = false;
  private autoUntil = 0;
  private isPresetPending = false;
  nightFactor = 0;
  sunElevation = 0;
  /**
   * How wet the streets are, 0 (dry) – 1 (soaked): wet within about 20 s of rain, dry over about
   * 5 min after it stops (shortened from the real half hour or more, to be seen in play). Already
   * wet when the game or a replay starts in rain. Road, pavement and facade materials read it.
   */
  wetness = 0;
  private isWetnessSet = false;
  /**
   * How overcast the sky is, 0 (fair) – 1 (raining): follows the weather over WEATHER_TURN_S, so
   * the sky, the light and the haze turn smoothly when おまかせ (or the player) changes it.
   */
  overcast = 0;
  /** The haze's extinction (1/m), eased towards the visibility's over ~10 s. */
  private extinction = 0;

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGPURenderer,
  ) {
    // Image-based lighting, set once now (a noon sun) so that materials compile with an
    // environment map from the start; update() redraws it as the sky changes.
    this.sky.sunPosition.value.set(0, 1, 0.6);
    this.updateReflections({ elevation: 59, azimuth: 180, overcast: 0 }, lightBalance(59, 0));
    this.sky.scale.setScalar(40000);
    this.sky.frustumCulled = false;
    // First of the opaque objects: the sky sits at the far plane without writing depth, and with a
    // reversed depth buffer anything drawn before it would be painted over (its centre is the
    // camera, so the distance sort cannot be trusted to put it first).
    this.sky.renderOrder = -1000;
    scene.add(this.sky);
    // The atmospheric fog (atmosphere.ts) for every node material with fog on. The three Fog stays
    // as the holder of its colour (a radiance, skyLight.ts) and of the linear floor's near and far,
    // which the fog node reads, and for the water, which reflects its colour as the horizon.
    scene.fog = this.fog;
    (scene as Scene & { fogNode: Node | null }).fogNode = atmosphereFog(this.fog);

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

  /**
   * A saved replay shows its own moment: the sun, sky and rain of when it happened, while the game
   * clock runs on underneath. null goes back to the game's own time and weather.
   */
  showMoment(moment: { ms: number; raining: boolean } | null): void {
    this.moment = moment;
  }

  private moment: { ms: number; raining: boolean } | null = null;

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
    const isAutoStart = mode === "auto" && this.weatherMode !== "auto";
    this.weatherMode = mode;
    if (isAutoStart) this.startAutoWeather(Math.random() < 0.3);
  }

  /** おまかせ from fair weather or rain now; it turns by itself after a spell (weatherSpells.ts). */
  startAutoWeather(isRain: boolean): void {
    this.weatherMode = "auto";
    this.autoRaining = isRain;
    this.autoUntil = this.gameMs + spellMinutes(isRain, Math.random()) * 60_000;
  }

  setObservation(obs: Observation | null): void {
    this.observation = obs;
  }

  getObservation(): Observation | null {
    return this.observation;
  }

  /**
   * Meteorological visibility (m): observed in リアル weather when the neighbours report it,
   * otherwise typical values (a clear Tokyo day ~25 km; steady rain ~4 km).
   */
  visibility(raining = this.isRaining()): number {
    const observed = this.weatherMode === "real" ? this.observation?.visibility : null;
    // 20000 is the instrument's ceiling ("20 km or more"): read it as a clear day.
    if (observed != null) return observed >= 20000 ? 25000 : observed;
    return raining ? 4000 : 25000;
  }

  /** How hard it rains now (mm/h): the windscreen's drops and the cabin's rain (weatherSpells.ts). */
  rainMmH(): number {
    const isMeasured = this.moment === null && this.weatherMode === "real";
    return rainRateMmH(this.isRaining(), isMeasured, this.observation?.precip10m ?? null);
  }

  isRaining(): boolean {
    if (this.moment) return this.moment.raining;
    if (this.weatherMode === "rain") return true;
    if (this.weatherMode === "clear") return false;
    if (this.weatherMode === "auto") return this.autoRaining;
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
    this.gameMs = this.mode === "real" ? Date.now() : this.gameMs + dt * 1000 * GAME_TIME_SCALE;
    const isSpellOver = this.weatherMode === "auto" && this.gameMs >= this.autoUntil;
    if (isSpellOver) this.startAutoWeather(!this.autoRaining);
    const date = this.moment ? new Date(this.moment.ms) : this.now();
    const { elevation, azimuth } = sunPosition(date, lat, lon);
    this.sunElevation = elevation;
    const el = MathUtils.degToRad(elevation);
    const az = MathUtils.degToRad(azimuth);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));

    const raining = this.isRaining();
    const isFirstOrReplay = !this.isWetnessSet || this.moment !== null;
    this.isWetnessSet = true;
    if (isFirstOrReplay) this.wetness = raining ? 1 : 0;
    else this.wetness = MathUtils.clamp(this.wetness + (raining ? dt / 20 : -dt / 300), 0, 1);
    // The sky turns with the weather over WEATHER_TURN_S (eased), at once when a game or replay starts.
    const cloudTarget = raining ? 1 : 0;
    const cloudStep = (Math.sign(cloudTarget - this.overcast) * dt) / WEATHER_TURN_S;
    this.overcast = isFirstOrReplay ? cloudTarget : MathUtils.clamp(this.overcast + cloudStep, 0, 1);
    const cloud = MathUtils.smoothstep(this.overcast, 0, 1);
    // The clouds drift with TSL's own clock (the GLSL Sky took a time uniform).
    const sky = this.sky;
    sky.sunPosition.value.copy(this.sunDir);
    sky.turbidity.value = MathUtils.lerp(4, 12, cloud);
    // More Rayleigh while the sun is low (the old step at 12°, smoothed over 8–16°).
    sky.rayleigh.value = MathUtils.lerp(1.4, 2.4, MathUtils.smoothstep(-elevation, -16, -8));
    sky.mieCoefficient.value = MathUtils.lerp(0.005, 0.02, cloud);
    sky.cloudCoverage.value = MathUtils.lerp(0.35, 0.85, cloud);
    this.sky.position.copy(camera);

    // 1 at deep night, 0 in full daylight, smooth through civil twilight.
    this.nightFactor = nightFactorAt(elevation);
    const day = 1 - this.nightFactor;
    const golden = MathUtils.smoothstep(elevation, -2, 4) * (1 - MathUtils.smoothstep(elevation, 8, 22));
    // Sun, skylight, haze and exposure by the sun's elevation and the cloud (skyLight.ts).
    const light = lightBalance(elevation, cloud);
    const isSunUp = elevation > -4;
    const lightDir = isSunUp ? this.sunDir : MOON_DIR;
    const sunColor = light.sunColor;
    if (isSunUp) this.sun.color.setRGB(sunColor.r, sunColor.g, sunColor.b);
    else this.sun.color.set(0x8fa6d8);
    // Both are 0 at −4°, where the light swaps from the sun's direction to the moon's.
    this.sun.intensity = isSunUp ? light.sunIntensity : light.moonIntensity;
    this.sun.position.copy(player).addScaledVector(lightDir, 600);
    this.sun.target.position.copy(player);

    this.hemi.color.setRGB(light.hemiSky.r, light.hemiSky.g, light.hemiSky.b);
    this.hemi.groundColor.setRGB(light.hemiGround.r, light.hemiGround.g, light.hemiGround.b);
    this.hemi.intensity = light.hemiIntensity;

    // A radiance, tone-mapped with the frame; the water reflects it as its horizon.
    const fog = light.fog;
    this.fog.color.setRGB(fog.r, fog.g, fog.b);
    // The linear ramp only hides the end of the drawn world, the far ground's (≥ 31 km); the haze is
    // atmosphere.ts. Why not at the streamed world's end (2.2–4.2 km) as before: the far skyline and
    // ground carry on past it, and the ramp painted the town in front of them fog-coloured.
    this.fog.near = FAR_GROUND_REACH * 0.75;
    this.fog.far = FAR_GROUND_REACH;
    const extinction = extinctionFor(this.visibility(raining));
    const isExtinctionSet = this.extinction > 0 && !isFirstOrReplay;
    this.extinction = isExtinctionSet
      ? this.extinction * Math.pow(extinction / this.extinction, Math.min(1, dt / 10))
      : extinction;
    ATMOSPHERE.fogAtmo.x = this.extinction;
    // Rain fills the whole column; dry haze sits in the lowest ~1 km of the boundary layer.
    ATMOSPHERE.fogAtmo.y = MathUtils.lerp(1100, 2500, cloud);
    ATMOSPHERE.fogSun.x = lightDir.x;
    ATMOSPHERE.fogSun.y = lightDir.y;
    ATMOSPHERE.fogSun.z = lightDir.z;
    // The glow is the sun's (warm and strongest when low); the moon's is faint.
    ATMOSPHERE.fogSun.w = isSunUp
      ? MathUtils.lerp(0.55, 0.15, cloud) * (0.4 + golden) * (0.3 + 0.7 * day)
      : 0.04;
    ATMOSPHERE.fogSunColor.x = sunColor.r;
    ATMOSPHERE.fogSunColor.y = sunColor.g * 0.9;
    ATMOSPHERE.fogSunColor.z = sunColor.b * 0.75;
    this.renderer.toneMappingExposure = light.exposure;

    const look = this.look;
    look.uSkyGain.value = light.skyGain;
    look.uOzone.value = light.ozone;
    look.uGlow.value.setRGB(light.glow.r, light.glow.g, light.glow.b);
    look.uStars.value = light.stars;
    look.uTwilight.value = light.twilight;
    look.uDeck.value.set(light.deck.r, light.deck.g, light.deck.b, cloud);
    // The haze over the sky: less of it in rain, where the deck itself is the grey.
    look.uHaze.value.set(fog.r, fog.g, fog.b, MathUtils.lerp(0.35, 0.12, cloud));
    // After the sky's uniforms: the environment map copies this frame's.
    const isStudio = this.updateReflections({ elevation, azimuth, overcast: cloud }, light);
    // The studio is a bright room whatever the hour (the old balance); the sky's map dims by itself.
    this.scene.environmentIntensity = isStudio
      ? MathUtils.lerp(0.06, MathUtils.lerp(0.5, 0.35, cloud), day) + golden * 0.1
      : light.envIntensity;

    this.rain.visible = raining;
    if (raining) this.animateRain(dt, camera);
  }

  /**
   * The environment map for 画質 › 空の映り込み: the sky's, drawn again as it moves (高: every 1°,
   * 低: a small map every 3°), or the old studio (なし: drawn once, never again). True for the studio.
   */
  private updateReflections(state: EnvState, light: LightBalance): boolean {
    const mode = GRAPHICS.settings.reflections;
    if (mode === "off") {
      this.envMap?.dispose();
      this.envMap = null;
      this.studio ??= studioEnvironment(this.renderer);
      this.scene.environment = this.studio;
      return true;
    }
    const { size, step, gapMs } = REFLECTIONS[mode];
    const isResized = this.envMap?.size !== size;
    if (isResized) {
      this.envMap?.dispose();
      this.envMap = new SkyEnvMap(this.renderer, size);
    }
    const envMap = this.envMap;
    if (!envMap) return false;
    envMap.update(state, performance.now(), (sky) => this.syncEnvSky(sky, light), step, gapMs);
    this.scene.environment = envMap.texture;
    return false;
  }

  /**
   * The environment map's sky is a second Sky (its own uniforms): it takes this one's sun, clouds
   * and night, without the disc, the stars or the screen's haze, and with a ground under it.
   */
  private syncEnvSky(sky: TokyoSky, light: LightBalance): void {
    sky.sunPosition.value.copy(this.sky.sunPosition.value);
    for (const name of SKY_COPIED) sky[name].value = this.sky[name].value;
    const look = this.look;
    const envLook = sky.look;
    envLook.uSkyGain.value = look.uSkyGain.value;
    envLook.uOzone.value = look.uOzone.value;
    envLook.uGlow.value.copy(look.uGlow.value);
    envLook.uTwilight.value = look.uTwilight.value;
    envLook.uDeck.value.copy(look.uDeck.value);
    envLook.uGround.value.set(light.ground.r, light.ground.g, light.ground.b, 1);
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

/**
 * The old image-based light: a procedural studio room (RoomEnvironment), drawn once (three/webgpu's
 * PMREMGenerator: the one in "three" is WebGL's).
 */
function studioEnvironment(renderer: WebGPURenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose();
  return texture;
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
