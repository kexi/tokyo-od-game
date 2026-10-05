// The teaser's cuts, one per language: which sections go in and in what order, how long each is
// (when not the shot's own length in teaser.mjs), its caption, the title and end cards' words, and
// where the music turns. teaser.mjs films the sections of the chosen cut (--lang) with the same
// staging for every language.
//
// A caption is [main, sub, timing]: timing.at / timing.out are the seconds into the section it
// fades in / out (at null: already up, carried over the cut; out null: stays; a negative out counts
// back from the section's end).

const JA_LAND = ["実在の東京 23 区を走る", "PLATEAU の建物・川・案内標識"];
const JA_TIME = ["時間が流れ、街が灯る", "ゲームの時計は 1 秒で 1 分（ここは早回し）"];
const JA_RED = ["信号無視は、見られている", "パトカー・白バイ・覆面パトカーが追ってくる"];
const JA_CABIN = ["運転席のディテール", "ブレーキで揺れるミラーの飾り、停車中だけ映るナビのテレビ"];
const JA_TAXI = ["自動運転タクシーを呼んで、乗る", "U で配車、Q で乗車"];

/** The Japanese teaser (out/teaser.mp4, 72 s). */
const ja = {
  lang: "ja",
  edit: [
    "cold",
    "title",
    "plateau",
    "river",
    "sign",
    "flare",
    "lapse",
    "red",
    "chase",
    "ticket",
    "y",
    "navi",
    "charm",
    "tv",
    "taxi-call",
    "taxi-come",
    "taxi-ride",
    "gfx",
    "lang",
    "end",
  ],
  seconds: {},
  captions: {
    cold: ["雨の夜の東京駅を、運転席から。", "", { at: 1.6, out: 10.6 }],
    gfx: ["画質は 4 段階、言語は 3 つ", "最高・高・中・低 ／ 日本語・English・中文", { at: 0.2 }],
    navi: ["交差点名で案内するナビ", "交差点の拡大図・レーン・道路名・制限速度", { at: 0.3, out: 4.05 }],
    plateau: [...JA_LAND, { at: 0.25 }],
    sign: [...JA_LAND, { at: null, out: 1.55 }],
    red: [...JA_RED, { at: 0.3 }],
    chase: [...JA_RED, { at: null, out: 2.55 }],
    ticket: ["その場で青切符", "反則金と違反点数は道路交通法どおり", { at: 0.3, out: 4.05 }],
    y: ["その瞬間は Y に投稿される", "目撃者の動画に、返信と拡散が次々と", { at: 0.3, out: 5.05 }],
    charm: [...JA_CABIN, { at: 0.3 }],
    tv: [...JA_CABIN, { at: null, out: 2.55 }],
    "taxi-call": [...JA_TAXI, { at: 0.2 }],
    "taxi-come": [...JA_TAXI, { at: null }],
    "taxi-ride": [...JA_TAXI, { at: null, out: 1.55 }],
    river: [...JA_LAND, { at: null }],
    flare: [...JA_TIME, { at: 0.3 }],
    lapse: [...JA_TIME, { at: null, out: 3.05 }],
  },
  /** The title screen's language buttons pressed in the "lang" section, in order. */
  langs: ["en", "zh", "ja"],
  /** The opening drive's destination, as the navi names it. */
  station: "東京駅 丸の内駅舎",
  /** The robotaxi's destination: the first station in its app's list (a far one may lie beyond the roads loaded). */
  taxiStation: "駅（",
  // The music's turns on the cut: the drop on the title, a break over the navi and the cabin, the
  // outro on the end card.
  music: ["title", "navi", "taxi-call", "end"],
  cards: {},
};

const EN_WARDS = ["The real 23 wards of Tokyo", "PLATEAU 3D buildings, rivers and guide signs"];
const EN_LANDMARKS = [
  "Landmarks, lit up at night",
  "Tokyo Tower and Tokyo Skytree, seen from across the city",
];
const EN_TIME = [
  "Time of day and weather",
  "Dusk turns to night and the city lights up — then the rain comes",
];
const EN_LAWFUL = [
  "Drive by the letter of the law",
  "Stop lines, signals and limits from real regulation data — even idling cites its ordinance",
];
const EN_ORBIS = ["Speed cameras", "Fixed and portable — go too fast and the flash goes off"];
const EN_CHASE = [
  "Run a red light, and they give chase",
  "Patrol cars and police motorcycles — and fleeing is a crime of its own",
];
const EN_Y = [
  "Witnesses post it on Y",
  "The clip goes viral: views, reposts, replies and quote reposts pile up",
];
const EN_CALL = [
  "An accident? Call 119 and 110",
  "From your phone — the ambulance and the patrol car on the radar, with distance and ETA",
];
const EN_NAVI = ["Navigation", "Intersection names, lane guidance, and a destination search with landmarks"];
const EN_TAXI = ["Robotaxi", "Call one from your phone, then ride it"];
const EN_FOOT = ["On foot", "Walk the streets, look up at the towers, talk with the people you meet"];
const EN_CABIN = [
  "Cabin details",
  "Swinging mirror charms, a navi TV that plays only when parked, a look around",
];
const EN_SETTINGS = [
  "Settings",
  "Graphics presets, three languages, gamepads with gyro steering and HD rumble",
];
/** The caption of a run of sections: in on the first, carried over the cuts, out at the last's end. */
const first = (cap) => [...cap, { at: 0.3 }];
const carried = (cap) => [...cap, { at: null }];
const last = (cap) => [...cap, { at: null, out: -0.45 }];
const only = (cap) => [...cap, { at: 0.3, out: -0.45 }];

/**
 * The English introduction (out/teaser.en.mp4, under 2 minutes): the features one by one, the
 * game's UI in English. Every caption and card in English; the title card is the game's own
 * English title and tagline. The longest looks go to what matters most: driving by the law, the
 * ticket, and the violation catching fire on Y.
 */
const en = {
  lang: "en",
  edit: [
    "cold",
    "title",
    "plateau",
    "river",
    "sign",
    "tower",
    "skytree",
    "flare",
    "lapse",
    "rain",
    "stopline",
    "idle",
    "red",
    "orbis",
    "portable",
    "chase",
    "flee",
    "stop",
    "ticket",
    "y",
    "y-quotes",
    "accident",
    "call",
    "radar",
    "navi",
    "search",
    "autopilot",
    "taxi-call",
    "taxi-come",
    "taxi-ride",
    "walk",
    "talk",
    "charm",
    "tv",
    "look",
    "gfx",
    "lang",
    "pad",
    "end",
  ],
  seconds: {
    cold: 6,
    river: 2,
    tower: 2.5,
    skytree: 2,
    flare: 2,
    lapse: 2.6,
    rain: 2.7,
    red: 4.5,
    orbis: 3,
    portable: 2.8,
    flee: 3.5,
    ticket: 5.6,
    "y-quotes": 3,
    accident: 2.8,
    call: 3,
    radar: 2.3,
    navi: 4,
    search: 2.8,
    autopilot: 2.7,
    "taxi-call": 1.8,
    "taxi-come": 2.2,
    "taxi-ride": 1.8,
    walk: 2.6,
    talk: 2.8,
    tv: 2.4,
    look: 1.8,
    gfx: 2.6,
    lang: 2.3,
    pad: 2.8,
    end: 4.6,
  },
  captions: {
    cold: [
      "Tokyo Station on a rainy night",
      "From the driver's seat — rain on the windscreen, the wipers on",
      { at: 1, out: -0.9 },
    ],
    plateau: first(EN_WARDS),
    river: carried(EN_WARDS),
    sign: last(EN_WARDS),
    tower: first(EN_LANDMARKS),
    skytree: last(EN_LANDMARKS),
    flare: first(EN_TIME),
    lapse: carried(EN_TIME),
    rain: last(EN_TIME),
    stopline: first(EN_LAWFUL),
    idle: last(EN_LAWFUL),
    red: only(["Break a rule, and it's stamped", "Every violation is named the moment it happens"]),
    orbis: first(EN_ORBIS),
    portable: last(EN_ORBIS),
    chase: first(EN_CHASE),
    flee: last(EN_CHASE),
    ticket: only([
      "A ticket, on the spot",
      "The fine and penalty points per the Road Traffic Act, summed up in English",
    ]),
    y: first(EN_Y),
    "y-quotes": last(EN_Y),
    accident: first(EN_CALL),
    call: carried(EN_CALL),
    radar: last(EN_CALL),
    navi: first(EN_NAVI),
    search: last(EN_NAVI),
    autopilot: only(["Autopilot", "Press J and the car drives itself to the destination"]),
    "taxi-call": first(EN_TAXI),
    "taxi-come": carried(EN_TAXI),
    "taxi-ride": last(EN_TAXI),
    walk: first(EN_FOOT),
    talk: last(EN_FOOT),
    charm: first(EN_CABIN),
    tv: carried(EN_CABIN),
    look: last(EN_CABIN),
    gfx: first(EN_SETTINGS),
    lang: carried(EN_SETTINGS),
    pad: last(EN_SETTINGS),
  },
  langs: ["ja", "zh", "en"],
  station: "Tokyo Station (Marunouchi)",
  // The app lists places by their Japanese names, "{name} ({km} km)" in English.
  taxiStation: "駅 (",
  // The drop on the title, the break (the pad alone) over the accident and the calls, the second
  // drop with its arpeggio from the navi on, the outro on the end card.
  music: ["title", "accident", "navi", "end"],
  // The badge and the tagline: the game's own (title.badge, title.tagline in src/i18n/en.ts).
  cards: {
    badge: null,
    tag: null,
    endTag: "Play it right in your browser",
    url: "kexi.github.io/tokyo-od-game",
    credits:
      "Data: 3D City Models (Project PLATEAU) · Tokyo open data · © OpenStreetMap contributors · GSI Tiles · Traffic Regulation Information (JARTIC)",
    captionBand: true,
  },
  // No controller of the machine's reaches the page; the settings shot plugs in a generic one.
  pads: true,
  // The game's own sounds over the music (sound.mjs, the scenes in sounds.mjs).
  sfx: true,
};

export const CUTS = { ja, en };
