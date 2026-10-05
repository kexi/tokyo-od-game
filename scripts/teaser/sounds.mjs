// The teaser's sound scenes: for each section of a cut, the game's own sounds that its picture had
// (the car's engine and tyres, the rain, the traffic, the sirens, the seal's thud, the navi TV …),
// as data. sfxPage.mjs plays them through the game's own audio code (GameAudio, SpatialAudio, the
// stamps' thud, the TV's sound) in an OfflineAudioContext, one section at a time; sound.mjs lays
// the sections on the cut and mixes them with the music.
//
// Why data and not a recording of the filming: the frames were filmed without sound (the virtual
// clock does not drive an AudioContext), and filming again would not give the same pictures. What
// each shot staged is in teaser.mjs; the times of what happened in it (a seal, a flash, a car
// stopping) were read off the filmed frames (out/teaser-frames-en, out/teaser-frames). The rest is
// assumed and marked so: where the traffic was, how fast a car went before the shot, the distance
// of a siren.
//
// The world of a scene: the player's car drives along +z at x = 0 (the left of travel is +x, as in
// the game), y = 0 is its body's centre (0.9 m over the road). Times are seconds into the section
// (negative: before it; the renderer runs 1.5 s ahead so every sound has settled at the cut).
//
//   ear      "seat" (the driver's seat: through the cabin), "chase" (a camera by the car, `cam` in
//            the car's frame), "fixed" (a camera at `cam`, looking at `look`, world; keyframed
//            [[t, x, y, z] …], `rel` true: relative to the car), "foot" (as fixed, the player out of
//            the car), "silent" (the title screen: the game's sound has not started).
//   car      { kmh, throttle } numbers or keyframes [[t, value] …]; `off`: the engine off from that
//            time (true: all along; the game stops it after 20 s standing, and when the player is out).
//   rain     mm/h (the game's steady rain is 8), or [[t, mm] …] steps.
//   traffic  the cars nearby (their engine and tyre hum): { kind, x, v } with v in m/s along z
//            (negative: oncoming) and `pass`, when it is level with the player's car (with a fixed
//            camera not riding the car: with z = 0).
//   sirens   { kind: "police" | "ambulance", path: [[t, x, y, z] …], rel, from, to }.
//   calls    the crosswalk's accessible-signal calls: { at: [x, y, z], across: [ax, az], side }.
//   events   [[t, what]]: "stamp" (a seal pressed: its thud lands 0.12 s later, as in stamp.ts),
//            "chime" (a spot found).
//   tv       the navi TV's programme bed in the cabin ("news").
//   duck     [[t0, t1] …]: the music steps back (−6 dB) for what is heard then.
//   gain     dB on the section's sounds in the teaser's mix (the game's own levels otherwise): the
//            rain brought up as it comes, the passing cars at the speed cameras, the sirens down.

/** Seconds of the car's speed for a stop: from `kmh` at `from` to standing at `to`. */
const brake = (kmh, from, to) => [
  [0, kmh],
  [from, kmh],
  [to, 0],
];
/** A car passing the other way in the next lane, level with the player's car at `pass` s. */
const oncoming = (pass, v = 11, kind = "car", x = -3.6) => ({ kind, x, v: -v, pass });
/** A car in the lane to the left going the same way, level at `pass`. */
const alongside = (pass, v = 9, kind = "car", x = 3.4) => ({ kind, x, v, pass });

/** The rainy night drive to 東京駅 (autopilot held at 7.5 m/s, wipers on): the opening, the title. */
const NIGHT_DRIVE = {
  ear: "seat",
  car: { kmh: 27, throttle: 0.2 },
  rain: 8,
  traffic: [oncoming(1.5, 10), oncoming(5.2, 12, "taxi"), oncoming(9.5, 9, "bus", -4.2)],
};
/** 設定 over the night town in the rain (the game paused: the rain goes on, heard from outside). */
const PAUSED_RAIN = { ear: "chase", cam: [2, 2.4, -12], car: { kmh: 0, throttle: 0, off: true }, rain: 8 };
/** The phone or a dialog at the kerb, in the driver's seat, the street going by. */
const AT_KERB = (off = false) => ({
  ear: "seat",
  car: { kmh: 0, throttle: 0, off },
  traffic: [oncoming(0.8, 10), oncoming(3.6, 12, "car", -6.8), alongside(2.2, 8, "bus", 3.6)],
});

export const SCENES = {
  cold: NIGHT_DRIVE,
  title: NIGHT_DRIVE,
  // PLATEAU's towers from low beside the car (autopilot at 8 m/s), the street's traffic.
  plateau: {
    ear: "chase",
    cam: [2.6, -0.25, -6.5],
    car: { kmh: 29, throttle: 0.3 },
    traffic: [oncoming(0.9, 11), alongside(1.6, 7)],
  },
  // Over the Sumida by 両国橋 (the player's car far off): one bus on the bridge (assumed).
  river: {
    ear: "fixed",
    cam: [0, 3, 0],
    look: [0, 3, 50],
    inCar: true,
    car: { kmh: 0, throttle: 0, off: true, z0: -260 },
    traffic: [{ kind: "bus", x: 40, v: 9, pass: 1.2 }],
  },
  // The road before an overhead guide sign: the player's car coming up behind (assumed 40 m).
  sign: {
    ear: "fixed",
    cam: [2.5, 0.7, 0],
    look: [-3.5, 4.5, 15],
    car: { kmh: 29, throttle: 0.3, z0: -40 },
    traffic: [oncoming(0.6, 12), alongside(1.4, 10)],
  },
  // The towers from 90 m and 20 m up, 1–1.5 km off: nothing of the game is within earshot.
  tower: { ear: "silent" },
  skytree: { ear: "silent" },
  flare: { ear: "silent" },
  lapse: { ear: "silent" },
  // The rain picked in the HUD at 0.5 s: from the driver's seat of the car standing (engine stopped
  // long since), the drops coming on the roof (the game eases rain in over ~0.5 s).
  rain: {
    ear: "seat",
    car: { kmh: 0, throttle: 0, off: true },
    rain: [
      [-9, 0],
      [0.5, 8],
    ],
    duck: [[0.4, -0.01]],
    gain: 8,
  },
  // Up to the 止まれ line at 25 km/h and a full stop (frames: braking from ~1.2 s, standing ~2.3 s).
  stopline: {
    ear: "seat",
    car: {
      kmh: brake(25, 1.2, 2.3),
      throttle: [
        [0, 0.3],
        [1.2, 0],
      ],
    },
    traffic: [oncoming(0.6, 9)],
  },
  // Standing at the line: 20 s on, the game switches the engine off (the toast at ~0.3 s).
  idle: {
    ear: "seat",
    car: { kmh: 0, throttle: 0, off: 0.3 },
    traffic: [{ kind: "car", x: -30, v: 0, pass: 0 }],
    duck: [[0, 1.2]],
    gain: 3,
  },
  // Through the red at 40 km/h; the stop line crossed at 3.03 s (the seal's frame), a patrol car
  // 20 m behind lights up and gives chase. The Japanese teaser's build pressed no seal there.
  red: {
    ear: "seat",
    car: { kmh: 40, throttle: 0.35 },
    traffic: [oncoming(1.4, 11)],
    sirens: [
      {
        kind: "police",
        rel: true,
        from: 3.05,
        path: [
          [3, 0, 0, -20],
          [6, 0, 0, -16],
        ],
      },
    ],
    events: [[3.03, "stamp", "en"]],
    duck: [[2.9, -0.01]],
  },
  // The gantry over 第一京浜 from the road past it: 98 km/h through it (the flash and the seal at
  // 2.2 s, the line at z = 0), past the camera 14 m on, 5 m to its side.
  orbis: {
    ear: "fixed",
    cam: [-4.3, 2.3, 13.5],
    look: [0, 0, -40],
    car: { kmh: 98, throttle: 0.6, z0: -2.2 * 27.2 },
    events: [[2.2, "stamp"]],
    duck: [[1.6, -0.01]],
    gain: 4,
  },
  // The portable one on a 30 km/h street: 55 km/h past the tripod (the flash at 2.37 s), the
  // camera 7 m on by the kerb.
  portable: {
    ear: "fixed",
    cam: [-1.9, 0.4, 7],
    look: [0.4, 0, -16],
    car: { kmh: 55, throttle: 0.5, z0: -2.37 * 15.3 },
    events: [[2.37, "stamp"]],
    duck: [[1.8, -0.01]],
    gain: 5,
  },
  // Behind the patrol car on the car's tail: its siren 7 m from the camera, the car 15 m ahead.
  chase: {
    ear: "fixed",
    rel: true,
    cam: [
      [0, 1.2, 1.2, -22.5],
      [3, 1.2, 1.2, -21],
    ],
    look: [[0, 0, 0, 0]],
    car: { kmh: 28, throttle: 0.2 },
    sirens: [
      {
        kind: "police",
        rel: true,
        path: [
          [0, 0, 0, -15],
          [3, 0, 0, -14],
        ],
      },
    ],
    duck: [[0, -0.01]],
    gain: -4,
  },
  // Behind the police motorcycle, the car 12 m ahead at 36 km/h; backup coming from far behind
  // (one more unit 200 m back, assumed).
  flee: {
    ear: "fixed",
    rel: true,
    cam: [
      [0, 1.2, 1.3, -18.5],
      [3.5, 1.2, 1.3, -17],
    ],
    look: [[0, 0, 0, 10]],
    car: { kmh: 36, throttle: 0.4 },
    sirens: [
      {
        kind: "police",
        rel: true,
        path: [
          [0, 0, 0, -12],
          [3.5, 0, 0, -11.5],
        ],
      },
      {
        kind: "police",
        rel: true,
        path: [
          [0, -3.5, 0, -200],
          [3.5, -3.5, 0, -170],
        ],
      },
    ],
    traffic: [oncoming(1.8, 12)],
    duck: [[0, -0.01]],
    gain: -4,
  },
  // Pulled over: the officer at the window (the patrol car's lights on, its siren off), the
  // engine idling, cars going by. (The officer's voice is not rendered.)
  stop: { ...AT_KERB(), ear: "chase", cam: [-2.2, 1.6, -4.5] },
  ticket: AT_KERB(),
  // The phone at the kerb: long enough standing for the game to have stopped the engine.
  y: AT_KERB(true),
  "y-quotes": AT_KERB(true),
  // 20 km/h into someone standing in the lane (frames: the hit at 2.2 s, two seals: 安全運転義務違反
  // and 人身事故), braking to a stop.
  accident: {
    ear: "seat",
    car: {
      kmh: brake(20, 2.2, 2.75),
      throttle: [
        [0, 0.2],
        [2.2, 0],
      ],
    },
    events: [
      [2.2, "stamp"],
      [2.2, "stamp"],
    ],
    duck: [[2.0, -0.01]],
  },
  // 119 on the phone; the ambulance dispatched at ~2.3 s, 260 m off.
  call: {
    ear: "seat",
    car: { kmh: 0, throttle: 0 },
    sirens: [
      {
        kind: "ambulance",
        from: 2.3,
        path: [
          [2.3, 60, 0, 252],
          [5, 50, 0, 225],
        ],
      },
    ],
  },
  // The ambulance (230 m) and the patrol car (350 m) on their way, as the panel says.
  radar: {
    ear: "seat",
    car: { kmh: 0, throttle: 0 },
    sirens: [
      {
        kind: "ambulance",
        path: [
          [0, 50, 0, 224],
          [2.5, 45, 0, 197],
        ],
      },
      {
        kind: "police",
        path: [
          [0, -80, 0, 340],
          [2.5, -75, 0, 311],
        ],
      },
    ],
    duck: [[0, -0.01]],
  },
  // The autopilot moving off from the kerb in 大手町 (to 8 m/s), the navi up close.
  navi: {
    ear: "seat",
    car: {
      kmh: [
        [0, 0],
        [0.6, 0],
        [4, 29],
      ],
      throttle: [
        [0, 0],
        [0.6, 0.55],
        [4, 0.3],
      ],
    },
    traffic: [oncoming(2.2, 11), alongside(3.4, 10)],
  },
  search: { ear: "seat", car: { kmh: 29, throttle: 0.3 }, traffic: [oncoming(1.2, 12)] },
  autopilot: {
    ear: "chase",
    cam: [1.5, 3.2, -9.5],
    car: { kmh: 29, throttle: 0.3 },
    traffic: [oncoming(1.4, 11), oncoming(2.5, 10, "taxi")],
  },
  // On foot at the kerb of 行幸通り, the robotaxi coming (its own drive makes no sound in the game).
  "taxi-call": {
    ear: "foot",
    cam: [5, 1.4, -3],
    look: [0, 1, 10],
    car: { kmh: 0, throttle: 0, off: true, z0: -120 },
    traffic: [oncoming(0.6, 10, "car", -2), alongside(1.4, 9, "car", 1.5)],
  },
  // Behind the taxi pulling in, the signal ahead sounding for those crossing (assumed: the hour is
  // in the speakers' 8–19 h).
  "taxi-come": {
    ear: "foot",
    cam: [2, 1.9, -6],
    look: [0, 0.6, 7],
    car: { kmh: 0, throttle: 0, off: true, z0: -150 },
    traffic: [oncoming(1.5, 9, "car", -6)],
    calls: [{ at: [6, 1.5, 24], across: [1, 0], side: 1 }],
  },
  "taxi-ride": {
    ear: "foot",
    rel: false,
    cam: [
      [0, 1.5, 2.6, -8],
      [2, 1.5, 2.6, 8],
    ],
    look: [
      [0, 0, 0.8, 8],
      [2, 0, 0.8, 24],
    ],
    car: { kmh: 0, throttle: 0, off: true, z0: -200 },
    traffic: [oncoming(0.9, 10, "car", -4)],
  },
  // Out of the car (the game stops its engine), walking up the pavement by the parked car.
  walk: {
    ear: "foot",
    cam: [0.5, 1.6, -3],
    look: [0, 1.5, 10],
    car: { kmh: 0, throttle: 0, off: true },
    traffic: [oncoming(1.6, 10, "car", -5)],
  },
  talk: {
    ear: "foot",
    cam: [3, 1.6, 4],
    look: [3, 1.5, 8],
    car: { kmh: 0, throttle: 0, off: true },
    traffic: [oncoming(1.2, 9, "car", -5), alongside(2.4, 8, "bus", 1.5)],
  },
  // A hard stop from 48 km/h at 0.7 s (the charms swing): standing at ~2.1 s.
  charm: {
    ear: "seat",
    car: {
      kmh: brake(48, 0.7, 2.1),
      throttle: [
        [0, 0.35],
        [0.7, 0],
      ],
    },
    traffic: [oncoming(1.3, 11)],
  },
  // Parked with the brake on: the news on the navi TV, in the cabin. (Its reader's voice is the
  // browser's speech, which cannot be rendered here.)
  tv: { ear: "seat", car: { kmh: 0, throttle: 0 }, tv: "news" },
  look: { ear: "seat", car: { kmh: 0, throttle: 0 }, tv: "news", traffic: [oncoming(0.9, 10)] },
  gfx: PAUSED_RAIN,
  // The title screen, before the start: the game makes no sound yet.
  lang: { ear: "silent" },
  pad: PAUSED_RAIN,
  // Up from behind the car to the floodlit station in the rain (the car rolling to its stop).
  end: {
    ear: "chase",
    cam: [2, 2.4, -12],
    camTo: [2, 12.4, -9],
    car: {
      kmh: [
        [0, 15],
        [4.5, 0],
      ],
      throttle: 0.1,
    },
    rain: 8,
    traffic: [oncoming(2.4, 8, "taxi", -6)],
  },
};

/**
 * The sections of a filmed cut (WORK/done.json: when each starts) with their scenes, for the
 * language `lang` (events marked for one language only are dropped for the other).
 */
export function timeline(done, edit, lang) {
  const ids = edit.filter((id) => id in done.starts);
  return ids.map((id, i) => {
    const start = done.starts[id];
    const end = i + 1 < ids.length ? done.starts[ids[i + 1]] : done.seconds;
    const scene = SCENES[id] ?? { ear: "silent" };
    const seconds = end - start;
    const at = (t) => (t < 0 ? seconds + t : t);
    const events = (scene.events ?? []).filter((e) => !e[2] || e[2] === lang).map((e) => [at(e[0]), e[1]]);
    const duck = (scene.duck ?? []).map(([a, b]) => [start + at(a), start + at(b)]);
    return { id, start, seconds, scene: { ...scene, events }, duck, gain: scene.gain ?? 0 };
  });
}
