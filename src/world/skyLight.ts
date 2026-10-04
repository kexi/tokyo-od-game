/**
 * The light of Tokyo's sky as a function of the sun's elevation and the cloud: direct sun, skylight,
 * the city's glow at night, the haze colour, exposure. Pure numbers (no three.js), so the curves are
 * tested on their own (tests/skyLight.test.ts) and Environment only copies them into lights.
 *
 * Colours are linear RGB radiances (what three's Color.setRGB takes); the haze too, which
 * atmosphere.ts tone-maps like a lit surface.
 */
export type Rgb = { r: number; g: number; b: number };

export type LightBalance = {
  /** Direct sunlight: tint (max channel 1) and DirectionalLight intensity; 0 once the sun has set. */
  sunColor: Rgb;
  sunIntensity: number;
  /** Moonlight (a fixed high direction) fading in after dusk. */
  moonIntensity: number;
  /** HemisphereLight: the sky's and the ground's colour and its intensity. */
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  /** scene.environmentIntensity for the sky's own environment map. */
  envIntensity: number;
  exposure: number;
  /** The haze (linear radiance): the far city and the sky's horizon both fade into it. */
  fog: Rgb;
  /** Night: the city's light scattered back by the air, radiance at the horizon (linear). */
  glow: Rgb;
  /** Stars, 0–1: clear nights only. */
  stars: number;
  /** Twilight dome, 0–1: the blue hour after Preetham's sky has gone dark. */
  twilight: number;
  /** Gain on the analytic sky (Preetham over-brightens at 5–15° and goes dark at sunset). */
  skyGain: number;
  /** Ozone's blue on the sky while the sun is low, 0–1. */
  ozone: number;
  /** Rain: radiance of the cloud deck at the zenith (linear). */
  deck: Rgb;
  /** Environment map: tint of the ground and the blocks, times the horizon's own brightness. */
  ground: Rgb;
};

const DEG = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** GLSL smoothstep. */
export const smoothstep = (x: number, edge0: number, edge1: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: mix(a.r, b.r, t),
  g: mix(a.g, b.g, t),
  b: mix(a.b, b.b, t),
});
const scale = (c: Rgb, k: number): Rgb => ({ r: c.r * k, g: c.g * k, b: c.b * k });

/** sRGB transfer function, one channel (display → linear). */
export const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

/** A 0xRRGGBB sRGB colour in linear RGB, as `new Color(hex)` stores it. */
export const hex = (h: number): Rgb => ({
  r: srgbToLinear(((h >> 16) & 255) / 255),
  g: srgbToLinear(((h >> 8) & 255) / 255),
  b: srgbToLinear((h & 255) / 255),
});

/** 1 at deep night, 0 in full daylight, smooth through civil twilight (sun +2° … −8°). */
export const nightFactorAt = (elevation: number): number => smoothstep(-elevation, -2, 8);

/**
 * Relative optical air mass towards the sun (Kasten & Young 1989): 1 overhead, ~5.6 at 10°, ~38 on
 * the horizon. Below −1° the sun is gone, so it is held there.
 */
export function airMass(elevation: number): number {
  const h = Math.max(elevation, -1);
  return 1 / (Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

// Optical depth of the air at the Preetham sky's primaries (680, 550, 450 nm): Rayleigh after
// Bodhaine et al. (0.008569 λ⁻⁴ (1 + 0.0113 λ⁻² + 0.00013 λ⁻⁴), λ in µm) and a light urban aerosol
// (Ångström β = 0.04, α = 1.3).
const WAVELENGTHS = [0.68, 0.55, 0.45];
const TAU = WAVELENGTHS.map(
  (l) => 0.008569 * l ** -4 * (1 + 0.0113 * l ** -2 + 0.00013 * l ** -4) + 0.04 * l ** -1.3,
);
/**
 * Below 1 the eye's (and a camera's) adaptation: the transmitted colour and brightness are raised
 * to this power. With 1 the sun at 3° is a deep red at a twentieth of noon's light, which is what a
 * spectrometer sees but not what a photo of a sunset shows.
 */
const ADAPTATION = 0.6;

function transmitted(elevation: number): [number, number, number] {
  const m = airMass(elevation);
  // White-balanced to the sun overhead (air mass 1): noon reads white, the low sun warm.
  const t = TAU.map((tau) => Math.exp(-tau * (m - 1) * ADAPTATION));
  return [t[0], t[1], t[2]];
}

/** Colour of direct sunlight at an elevation, normalised to its brightest channel. */
export function sunTint(elevation: number): Rgb {
  const [r, g, b] = transmitted(elevation);
  const m = Math.max(r, g, b);
  return { r: r / m, g: g / m, b: b / m };
}

/** Luminance of direct sunlight relative to the sun overhead, adapted (0 – 1). */
export function sunLuminance(elevation: number): number {
  const [r, g, b] = transmitted(elevation);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Direct sun as a DirectionalLight intensity: 2.8 at Tokyo's October noon (~50°), as before. The
 * square root of the luminance keeps a warm key light at sunset (photos expose for it), and the disc
 * sinks between +1.5° and −0.8° (refraction lifts it about half a degree).
 */
export function sunIntensity(elevation: number, overcast: number): number {
  const disc = smoothstep(elevation, -0.8, 1.5);
  const clear = 2.85 * Math.sqrt(sunLuminance(elevation)) * disc;
  // Cloud takes the direct beam; what is left is the bright patch of the deck around the sun.
  return clear * mix(1, 0.32, overcast);
}

/**
 * Skylight on the ground relative to noon, adapted: diffuse illuminance grows roughly as sin(h)^0.6
 * with the sun's elevation and falls about a hundredfold through civil twilight (0 … −6°); the eye
 * takes a third of the exponent by day (0.2) and the square root through twilight.
 */
export function skylight(elevation: number): number {
  const high = Math.pow(Math.max(Math.sin(Math.max(elevation, 0.5) * DEG), 0), 0.2);
  const atNoon = Math.pow(Math.sin(50 * DEG), 0.2);
  const day = Math.min(1.05, high / atNoon);
  // Twilight: the log of the light falls linearly from +0.5° to −6°.
  const below = Math.pow(10, (Math.min(elevation, 0.5) - 0.5) / 6.5);
  return day * Math.min(1, below);
}

// Palette (sRGB hex as Color stores it, so the noon values are exactly the old ones).
const SKY_NOON = hex(0xbfd9ff);
const SKY_LOW = hex(0x86a8f0); // the blue of the sky away from a low sun: the shade turns blue
const SKY_TWILIGHT = hex(0x4c62b4);
const SKY_NIGHT = hex(0x5a544e); // the city's own light, grey-orange
const SKY_RAIN = hex(0xc4cfdc);
const GROUND_DAY = hex(0x4a4036);
const GROUND_NIGHT = hex(0x2e2824);
const GROUND_RAIN = hex(0x45484c);
const RAIN_TINT = { r: 0.86, g: 0.92, b: 1 }; // the sun's patch through the deck: cool, colourless

/**
 * Haze radiances. Noon and rain keep the old colours, which now show as they were meant (display
 * ~0.8/0.85/0.88 at noon, the pale horizon; three's chunk used to mix them in raw, darker); the low
 * sun's away from the sun (towards it: fogSun) and the blue hour's show ~0.5 and ~0.2 grey-blue.
 */
const FOG_NOON = hex(0xbfd2e4);
const FOG_LOW = { r: 0.13, g: 0.15, b: 0.24 };
const FOG_TWILIGHT = { r: 0.03, g: 0.038, b: 0.068 };
const FOG_RAIN = hex(0x9aa3ab);

/**
 * Tokyo's sky glow (linear radiance at the horizon; overhead about a fifth of it): LED and sodium
 * light scattered back by the air, grey-orange. Clouds reflect it down: under a deck the whole sky
 * glows nearly as bright as a clear night's horizon, some four times its zenith.
 */
export const GLOW_CLEAR: Rgb = { r: 0.08, g: 0.062, b: 0.05 };
export const GLOW_CLOUD: Rgb = { r: 0.095, g: 0.076, b: 0.062 };

/**
 * The whole balance for a sun elevation (degrees) and a cloud cover, 0 (clear) – 1 (raining deck).
 * At noon on a clear day it gives the values the game had before (sun 2.8, hemisphere 1.5 of
 * 0xbfd9ff over 0x4a4036, exposure 1).
 */
export function lightBalance(elevation: number, overcast: number): LightBalance {
  const night = nightFactorAt(elevation);
  const cloud = clamp01(overcast);
  // 1 while the sun is low (golden hour), 0 from about 25° up.
  const low = 1 - smoothstep(elevation, 4, 25);
  const twilight = smoothstep(elevation, -9, -2.5) * (1 - smoothstep(elevation, -0.5, 2.5));

  const sunColor = mixRgb(sunTint(elevation), RAIN_TINT, cloud * 0.85);

  const sky = skylight(elevation);
  const lowSky = mixRgb(SKY_NOON, SKY_LOW, low);
  const duskSky = mixRgb(lowSky, SKY_TWILIGHT, smoothstep(-elevation, -1, 5));
  const clearSky = mixRgb(duskSky, SKY_NIGHT, night);
  const hemiSky = mixRgb(clearSky, mixRgb(SKY_RAIN, SKY_NIGHT, night), cloud);
  // The ground bounces the sun: warm while it is low.
  const groundDay = mixRgb(GROUND_DAY, hex(0x5a4232), low * (1 - night));
  const hemiGround = mixRgb(mixRgb(groundDay, GROUND_RAIN, cloud), GROUND_NIGHT, night);
  // Daylight down to the night floor (0.45: street level at night is lit by the city, not the sky).
  // Overcast diffuses the sun's share into the sky: brighter, flatter ambient by day.
  const dayAmbient = 1.5 * sky * mix(1, 1.12, cloud);
  const hemiIntensity = mix(dayAmbient, 0.45, night);

  const fogClear = mixRgb(
    mixRgb(mixRgb(FOG_NOON, FOG_LOW, low), FOG_TWILIGHT, smoothstep(-elevation, -1, 5)),
    { r: 0, g: 0, b: 0 },
    night,
  );
  // The eye opens up as the light goes: +0.25 for a low sun, more through twilight; 0.8 at night,
  // where the lamps and the bloom carry the scene.
  const dayExposure = mix(1, 0.95, cloud) + 0.25 * low * (1 - 0.6 * cloud) + 0.15 * twilight;
  const exposure = mix(dayExposure, 0.8, night);
  const glow = mixRgb(GLOW_CLEAR, GLOW_CLOUD, cloud);
  // At night the haze is the glow itself (the sky at the horizon: the glow and a little haze).
  const glowFog = scale(glow, 1.15);
  const fogRain = mixRgb(scale(FOG_RAIN, Math.max(0.25, sky)), glowFog, night);
  const fog = mixRgb(
    {
      r: fogClear.r + glowFog.r * night,
      g: fogClear.g + glowFog.g * night,
      b: fogClear.b + glowFog.b * night,
    },
    fogRain,
    cloud,
  );

  return {
    sunColor,
    sunIntensity: sunIntensity(elevation, cloud),
    moonIntensity: 0.3 * smoothstep(-elevation, 4, 9) * mix(1, 0.35, cloud),
    hemiSky,
    hemiGround,
    hemiIntensity,
    // Against the studio map's 0.5 (knowledge/sky-light-and-bloom.md): the sky map is as bright
    // at noon with its ground; the low sun's, the deck's and the night's are far dimmer, and their
    // reflections are the sky's own brightness at ~1.
    envIntensity: mix(mix(mix(0.42, 0.7, low), 0.9, cloud), 1, night),
    exposure,
    fog,
    glow: scale(glow, night),
    stars: night * (1 - smoothstep(cloud, 0.05, 0.4)),
    twilight: twilight * (1 - cloud * 0.7),
    // Preetham's sky burns out to white at 5–15° (rayleigh 2.4) and dims fast below 4°.
    skyGain: mix(1, 0.78, smoothstep(elevation, 25, 8)) * mix(1, 1.6, smoothstep(elevation, 5, -1)),
    ozone: (1 - smoothstep(elevation, 2, 18)) * (1 - cloud),
    // The deck's zenith radiance by day (display ~0.6 grey); at night only the city lights it.
    deck: scale(mixRgb({ r: 0.26, g: 0.27, b: 0.295 }, { r: 0, g: 0, b: 0 }, night), Math.max(0.05, sky)),
    // Concrete and asphalt (~0.4 of the horizon's light), warmer under a low sun or the city's lamps.
    ground: scale(
      mixRgb(
        mixRgb({ r: 1, g: 0.93, b: 0.85 }, { r: 1, g: 0.8, b: 0.62 }, low),
        { r: 1, g: 0.85, b: 0.7 },
        night,
      ),
      0.4,
    ),
  };
}
