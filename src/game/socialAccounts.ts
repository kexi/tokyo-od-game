import type { HumanColors } from "../world/human";
import { SOCIAL_APP_NAME } from "./socialTheme";

/**
 * The people on Y (SOCIAL_APP_NAME): accounts (display name, @handle, bio, join date, follow counts) and the
 * look of their profile image and banner, all derived from a seed, so the same person looks the
 * same every time they turn up. Pure data — socialAvatars.ts paints the pictures and witnessShot.ts
 * shoots their photos with the device described by cameraFor.
 *
 * Profile images mix the way real users' do: about 40 % photos of themselves (portraits of the
 * game's own pedestrian model), 25 % pictures of a thing they like (a cat, a sunset, ramen …), 20 %
 * an initial on a colour and 15 % the default silhouette of a new account — the throwaway
 * accounts that post the 晒し.
 */

export type PictureMotif = "cat" | "sunset" | "skyline" | "car" | "ramen" | "flower" | "fuji" | "coffee";
export const PICTURE_MOTIFS: readonly PictureMotif[] = [
  "cat",
  "sunset",
  "skyline",
  "car",
  "ramen",
  "flower",
  "fuji",
  "coffee",
];

export type AvatarSpec =
  | {
      kind: "portrait";
      colors: HumanColors;
      /** Hair style (createHuman's variant). */
      variant: number;
      /** Backdrop gradient, top to bottom. */
      backdrop: readonly [string, string];
      /** Head turn, radians. */
      yaw: number;
    }
  | { kind: "illustration"; motif: PictureMotif; hue: number }
  | { kind: "initial"; background: string; letter?: string }
  | { kind: "default" };

export type BannerSpec =
  | { kind: "none" }
  | { kind: "gradient"; from: string; to: string }
  | { kind: "picture"; motif: PictureMotif; hue: number };

export type SocialAccount = {
  /** Stable key: seeds the pictures and the camera. */
  id: string;
  name: string;
  /** Without the @; letters, digits and _ only, at most 15 characters. */
  handle: string;
  bio: string;
  location: string;
  joined: { year: number; month: number };
  following: number;
  followers: number;
  /** Carries the game's own badge (an account the app vouches for). */
  isVouched: boolean;
  /** Made this month, nothing set up: the default picture, no banner, a handful of followers. */
  isNew: boolean;
  /** Drives for a living or for fun: what they post is often their dashcam's footage. */
  drives: boolean;
  avatar: AvatarSpec;
  banner: BannerSpec;
};

/** FNV-1a with a murmur3 finish (FNV alone leaves the low bits of similar ids correlated). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A number in [0, 1) fixed by the id and what it is for. */
export const unitOf = (id: string, salt: string): number => hashString(`${id}:${salt}`) / 0x100000000;
const pickOf = <T>(arr: readonly T[], id: string, salt: string): T =>
  arr[Math.floor(unitOf(id, salt) * arr.length)];

// The pedestrians' palettes (src/world/pedestrians.ts), so portraits look like the people on the
// street. Why a copy: importing pedestrians.ts would pull the crowd simulation (and rapier) into
// this pure module and its tests.
const SHIRTS = [
  0xd94f45, 0x3d6fd9, 0xf2c14e, 0x4caf7a, 0xeeeeee, 0x333842, 0x9c5fd1, 0xf08bb0, 0x5aa9c9, 0xc98a4b,
];
const PANTS = [0x2b3445, 0x1e1e22, 0x5b4b3a, 0x7a8696, 0x3f5e3a];
const HAIR = [0x1a1410, 0x3b2a1f, 0x6b4a2f, 0x888888, 0xb08a5a];
const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68b62];
const BACKDROPS: readonly (readonly [string, string])[] = [
  ["#8ec5f0", "#e6f3fc"],
  ["#f6b993", "#fde7d6"],
  ["#c3bdf0", "#efedfd"],
  ["#a8d8a9", "#ecf7ec"],
  ["#34465a", "#6f8399"],
  ["#f3d26b", "#fff3c9"],
  ["#d9d9d9", "#f7f7f7"],
  ["#6fa8dc", "#c9e3c1"],
  ["#e9a3b8", "#fbe3ea"],
];
const INITIAL_COLORS = [
  "#e0245e",
  "#f45d22",
  "#ffad1f",
  "#17bf63",
  "#1da1a1",
  "#794bc4",
  "#3b5bdb",
  "#8d6e63",
];

export const AVATAR_MIX = { portrait: 0.4, illustration: 0.25, initial: 0.2, default: 0.15 } as const;

/** The profile image an account id gets (see AVATAR_MIX). */
export function avatarFor(id: string): AvatarSpec {
  const u = unitOf(id, "avatar");
  if (u < AVATAR_MIX.portrait) {
    return portraitAvatar(id, {
      shirt: pickOf(SHIRTS, id, "shirt"),
      pants: pickOf(PANTS, id, "pants"),
      skin: pickOf(SKIN, id, "skin"),
      hair: pickOf(HAIR, id, "hair"),
      umbrella: 0x223355,
    });
  }
  if (u < AVATAR_MIX.portrait + AVATAR_MIX.illustration)
    return {
      kind: "illustration",
      motif: pickOf(PICTURE_MOTIFS, id, "motif"),
      hue: Math.floor(unitOf(id, "hue") * 360),
    };
  if (u < 1 - AVATAR_MIX.default)
    return { kind: "initial", background: pickOf(INITIAL_COLORS, id, "initial") };
  return { kind: "default" };
}

/** A portrait in given clothes (a pedestrian who filmed the player, say). */
export function portraitAvatar(id: string, colors: HumanColors, variant?: number): AvatarSpec {
  return {
    kind: "portrait",
    colors,
    variant: variant ?? Math.floor(unitOf(id, "style") * 3),
    backdrop: pickOf(BACKDROPS, id, "backdrop"),
    yaw: (unitOf(id, "yaw") - 0.5) * 0.9,
  };
}

function bannerFor(id: string, avatar: AvatarSpec): BannerSpec {
  if (avatar.kind === "default") return { kind: "none" };
  const u = unitOf(id, "banner");
  if (u < 0.15) return { kind: "none" };
  const hue = Math.floor(unitOf(id, "banner-hue") * 360);
  if (u < 0.55)
    return { kind: "gradient", from: `hsl(${hue} 55% 38%)`, to: `hsl(${(hue + 50) % 360} 65% 62%)` };
  // A hobby account's banner is more of the same thing; others pick a view.
  const motif =
    avatar.kind === "illustration"
      ? avatar.motif
      : pickOf(["sunset", "skyline", "fuji"] as const, id, "view");
  return { kind: "picture", motif, hue };
}

type Person = { name: string; handle: string; bio: string; location?: string; drives?: boolean };
const person = (name: string, handle: string, bio: string, location?: string, drives?: boolean): Person => ({
  name,
  handle,
  bio,
  location,
  drives,
});

// People with a photo or an initial for a picture. Handles get a suffix per account.
const PEOPLE: readonly Person[] = [
  person("ゆうき🚗", "yuki_drive", "週末ドライブが趣味。安全運転第一", "東京都", true),
  person("まるこ", "maruko_wknd", "猫と珈琲と週末。", "世田谷区"),
  person("しんご｜都内勤務", "shingo_tk", "丸の内で働く会社員。電車通勤", "千代田区"),
  person("タクシー歴20年", "taxi_veteran", "都内でタクシー乗務。道のことなら", "東京", true),
  person("みー🍜", "mii_ramen", "ラーメンとサウナ", "豊島区"),
  person("Kenta", "kenta_jp", "Engineer / Tokyo", "Tokyo"),
  person("さくら🌸", "sakura_0401", "春が好き。二児の母", "練馬区"),
  person("通勤チャリダー", "bike_commute", "自転車で片道12km通勤", "江東区"),
  person("パパ3年目", "papa_3rd_year", "娘ラブ。子連れのおでかけ記録", "杉並区"),
  person("ドラレコ班長", "dorareko_boss", "ドラレコ映像で安全運転を考える", "", true),
  person("夜勤明けの看護師", "night_nurse_k", "看護師。夜勤明けのポスト多め", "東京"),
  person("とうふ", "tofu_tofu", "ゆるく生きてます"),
  person("あおい☁️", "aoi_sora", "空の写真を撮るのが好き", "港区"),
  person("ひでお", "hideo1962", "定年後のんびり。散歩が日課", "葛飾区"),
  person("Mika", "mika_tokyo", "Tokyo life / cafe hopping", "渋谷区"),
  person("なお｜ママ", "nao_mama", "4歳と1歳の母", "板橋区"),
  person("交通安全おじさん", "anzen_ojisan", "交通安全を呼びかけています"),
  person("東京散歩🚶", "tokyo_sanpo", "東京の街を歩いて記録しています", "東京"),
  person("ゆず🍋", "yuzu_lemon", "大学生。カフェ巡り", "目黒区"),
  person("ごん", "gon_gon", ""),
  person("鉄道と車が好き", "train_car_fan", "乗り物全般が好き", "大田区", true),
  person("あやか💄", "ayaka_beauty", "コスメと美容の話", "新宿区"),
  person("りょう🏃", "ryo_runner", "皇居ラン週3", "中央区"),
  person("はるき", "haruki_s", "", "台東区"),
  person("おかか", "okaka_onigiri", "おにぎりはおかか派"),
  person("そら", "sora_blue", ""),
  person("ちひろ📷", "chihiro_photo", "写真を撮って歩く人", "墨田区"),
  person("トラック運転手のケン", "ken_trucker", "長距離トラック乗り。道路事情をポストします", "全国", true),
  person("下町の電気屋", "denkiya_shita", "創業50年の町の電気屋です", "荒川区"),
  person("大学生(3年)", "univ_3rd", "経済学部"),
  person("むぎ", "mugi_wheat", ""),
  person("千代田区民", "chiyoda_min", "", "千代田区"),
  person("江東区在住", "koto_life", "湾岸エリアの暮らし", "江東区"),
  person("ちゃりおじ", "chari_oji", "ロードバイク歴15年"),
  person("のんびり主婦", "nonbiri_home", "家族のごはんと節約"),
  person("元教習所勤務", "ex_instructor", "元・自動車教習所の指導員", "東京", true),
  person("配達ドライバー", "delivery_run", "軽バンで都内を配達中", "東京", true),
  person("丸の内の会社員", "office_mrnc", "", "千代田区"),
  person("東京観光中✈️", "tokyo_trip", "旅行で東京に来てます"),
  person("Daiki", "daiki_0812", ""),
  person("バイク乗りのまさ", "masa_rider", "250ccで休日ツーリング", "八王子市"),
  person("しろくま", "shirokuma_z", ""),
];

// People whose picture is a thing they love (by motif).
const HOBBY: Record<PictureMotif, readonly Person[]> = {
  cat: [
    person("ねこと暮らす🐈", "neko_kurashi", "保護猫2匹と暮らしています"),
    person("黒猫のいる部屋", "kuroneko_room", "黒猫のクロ（5歳）"),
  ],
  sunset: [
    person("夕焼けハンター", "yuyake_hunter", "夕焼けと空の写真"),
    person("空ログ", "sora_log", "毎日の空を記録"),
  ],
  skyline: [
    person("東京夜景さんぽ", "tokyo_yakei", "夜景と街の写真", "東京"),
    person("湾岸ビュー", "wangan_view", "ベイエリアの景色", "江東区"),
  ],
  car: [
    person("車好きのたけし", "takeshi_cars", "旧車と国産スポーツが好き", "", true),
    person("週末ドライバー", "wknd_driver", "安全運転で行こう", "", true),
  ],
  ramen: [
    person("麺活中", "menkatsu", "醤油派。週3ラーメン"),
    person("ラーメン部長", "ramen_bucho", "替え玉は2回まで"),
  ],
  flower: [
    person("花と緑の記録🌷", "hana_midori", "季節の花を撮っています"),
    person("ベランダ菜園", "veranda_farm", "トマト育ててます"),
  ],
  fuji: [
    person("富士山が見える日", "fuji_mieru", "東京から富士山が見えた日を記録"),
    person("山とカメラ", "yama_camera", "週末は山へ"),
  ],
  coffee: [person("喫茶店めぐり", "kissaten_meguri", "純喫茶が好き"), person("珈琲と本", "coffee_hon", "")],
};

// Throwaway accounts: no picture, made to post a clip.
const THROWAWAY: readonly Person[] = [
  person("通りすがり", "toorisugari", ""),
  person("名無しのドラレコ", "dorareko", "", "", true),
  person("ドラレコ晒し", "sarashi", "危ない運転を記録しています", "", true),
  person("危険運転まとめ", "kiken_matome", "危険運転の動画を載せています", "", true),
  person("見た人", "mitahito", ""),
  person("匿名希望", "tokumei", ""),
  person("交通マナー監視", "manner_watch", ""),
  person("user", "user", ""),
];
const SUFFIXES = ["", "_88", "0315", "_jp", "2", "1987", "_01", "__", "7", "_tk"];

const handleWith = (stem: string, suffix: string) =>
  stem.length + suffix.length <= 15 ? stem + suffix : stem.slice(0, 15 - suffix.length) + suffix;

/** JST year and month of a game time. */
function jstMonth(ms: number): { year: number; month: number } {
  const d = new Date(ms + 9 * 3_600_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * The account behind a seed. Everything about it follows from the seed alone, except a new
 * account's join month, which is the month of `nowMs` (game time) when it is first met.
 */
export function accountFor(seed: number, nowMs: number): SocialAccount {
  const id = `u${seed}`;
  return makeAccount(id, avatarFor(id), nowMs);
}

/** The person a witness filmed it as: a portrait in their own clothes. */
export function witnessAccount(
  witness: { id?: number; colors: HumanColors; variant?: number },
  nowMs: number,
) {
  const c = witness.colors;
  const id = `p${witness.id ?? hashString(`${c.shirt}/${c.pants}/${c.skin}/${c.hair}/${witness.variant ?? 0}`)}`;
  return makeAccount(id, portraitAvatar(id, witness.colors, witness.variant), nowMs);
}

function makeAccount(id: string, avatar: AvatarSpec, nowMs: number): SocialAccount {
  const isNew = avatar.kind === "default";
  if (isNew) {
    const who = pickOf(THROWAWAY, id, "who");
    const digits = String(hashString(`${id}:digits`))
      .padStart(10, "0")
      .slice(0, 8);
    return {
      id,
      name: who.name,
      handle: handleWith(who.handle, digits),
      bio: who.bio,
      location: "",
      joined: jstMonth(nowMs),
      following: Math.floor(unitOf(id, "following") * 30),
      followers: Math.floor(unitOf(id, "followers") * 6),
      isVouched: false,
      isNew,
      drives: who.drives ?? false,
      avatar,
      banner: { kind: "none" },
    };
  }
  const who =
    avatar.kind === "illustration" ? pickOf(HOBBY[avatar.motif], id, "who") : pickOf(PEOPLE, id, "who");
  const isVouched = unitOf(id, "vouched") < 0.06;
  // Followers spread like real ones: most have tens to hundreds, a few have thousands.
  const followers = Math.round(10 ** (1 + 3 * unitOf(id, "followers") ** 1.6) * (isVouched ? 12 : 1));
  return {
    id,
    name: who.name,
    handle: handleWith(who.handle, pickOf(SUFFIXES, id, "suffix")),
    bio: who.bio,
    location: who.location ?? "",
    joined: {
      year: 2009 + Math.floor(unitOf(id, "year") * 17),
      month: 1 + Math.floor(unitOf(id, "month") * 12),
    },
    following: Math.round(20 + unitOf(id, "following") * 900),
    followers,
    isVouched,
    isNew,
    drives: who.drives ?? false,
    avatar,
    banner: bannerFor(id, avatar),
  };
}

const fixed = (
  id: string,
  name: string,
  handle: string,
  bio: string,
  avatar: AvatarSpec,
  more: Partial<SocialAccount> = {},
): SocialAccount => ({
  id,
  name,
  handle,
  bio,
  location: "東京",
  joined: { year: 2012 + (hashString(id) % 10), month: 1 + (hashString(id) % 12) },
  following: 100 + (hashString(id) % 400),
  followers: 2000 + (hashString(id) % 40000),
  isVouched: false,
  isNew: false,
  drives: false,
  avatar,
  banner: bannerFor(id, avatar),
  ...more,
});

/** Accounts the player follows: they post the everyday timeline and repost what goes round. */
export const FOLLOWED = {
  news: fixed(
    "f-news",
    "首都圏交通ニュース",
    "shutoken_news",
    "首都圏の道路と交通の話題をお届けします。",
    { kind: "initial", background: "#b42318", letter: "交" },
    { isVouched: true, followers: 182_000, following: 12 },
  ),
  lab: fixed(
    "f-lab",
    "安全運転ラボ",
    "anzen_lab",
    "安全運転のコツを毎日ひとつ。道路交通法の条文つきで。",
    { kind: "initial", background: "#0f7b4f", letter: "安" },
    { isVouched: true, followers: 48_300 },
  ),
  weather: fixed("f-sky", "きょうの東京の空", "tokyo_sora_now", "東京の空を毎日撮っています。", {
    kind: "illustration",
    motif: "sunset",
    hue: 280,
  }),
  ramen: fixed("f-ramen", "ラーメン食べ歩き🍜", "ramen_aruki", "年間300杯。都内のラーメン記録", {
    kind: "illustration",
    motif: "ramen",
    hue: 30,
  }),
  cat: fixed("f-cat", "うちの猫", "uchineko_days", "猫との毎日", {
    kind: "illustration",
    motif: "cat",
    hue: 250,
  }),
  commute: fixed(
    "f-commute",
    "毎日首都高",
    "shutoko_daily",
    "首都高で通勤20年。渋滞情報と運転のこと",
    portraitAvatar(
      "f-commute",
      { shirt: 0x3d6fd9, pants: 0x2b3445, skin: 0xe0ac86, hair: 0x1a1410, umbrella: 0 },
      0,
    ),
    { drives: true },
  ),
  teacher: fixed(
    "f-teacher",
    "元教習所の先生",
    "ex_kyoshujo",
    "教習指導員を30年。基本がいちばん大事",
    portraitAvatar(
      "f-teacher",
      { shirt: 0xeeeeee, pants: 0x1e1e22, skin: 0xf1c9a5, hair: 0x888888, umbrella: 0 },
      0,
    ),
    { drives: true },
  ),
  cafe: fixed("f-cafe", "朝カフェ部☕", "asacafe_bu", "朝のコーヒーが生きがい", {
    kind: "illustration",
    motif: "coffee",
    hue: 28,
  }),
} as const satisfies Record<string, SocialAccount>;
export type FollowedKey = keyof typeof FOLLOWED;
export const FOLLOWED_LIST: readonly SocialAccount[] = Object.values(FOLLOWED);

/** The player's own account (they read; the game never posts for them). */
export const PLAYER_ACCOUNT: SocialAccount = fixed(
  "me",
  "あなた",
  "you_drive_tokyo",
  `東京をドライブ中。${SOCIAL_APP_NAME}は見る専`,
  { kind: "illustration", motif: "car", hue: 210 },
  {
    followers: 3,
    following: FOLLOWED_LIST.length,
    joined: { year: 2024, month: 4 },
    banner: { kind: "none" },
  },
);

/** 「2019年4月からYを利用しています」 */
export const joinedLabel = (a: SocialAccount) =>
  `${a.joined.year}年${a.joined.month}月から${SOCIAL_APP_NAME}を利用しています`;

/**
 * The camera a person shoots with, fixed per account: which lens they use (35 mm equivalent),
 * how they hold the phone (16:9 video, 4:3 photo or 9:16 for a story), how much they tilt it, and
 * their phone's exposure, white balance and noise. Drivers often post their dashcam's footage.
 */
export type CameraSpec = {
  kind: "phone" | "dashcam";
  /** 35 mm equivalent focal length: 13 ultra-wide, 24–26 main, 48–77 tele. */
  focal: number;
  aspect: "16:9" | "4:3" | "9:16";
  /** Roll, radians (+ turns the picture counter-clockwise). */
  tilt: number;
  /** Exposure bias (1 neutral). */
  exposure: number;
  /** White balance: + warm, − cool. */
  warmth: number;
  /** Sensor noise (0–1). */
  noise: number;
};

export function cameraFor(a: SocialAccount): CameraSpec {
  const isDashcam = a.drives && unitOf(a.id, "dashcam") < 0.75;
  if (isDashcam)
    return {
      kind: "dashcam",
      focal: 14,
      aspect: "16:9",
      tilt: (unitOf(a.id, "tilt") - 0.5) * 0.02,
      exposure: 0.95 + unitOf(a.id, "exposure") * 0.15,
      warmth: (unitOf(a.id, "warmth") - 0.5) * 0.1,
      noise: 0.25 + unitOf(a.id, "noise") * 0.3,
    };
  const lens = unitOf(a.id, "lens");
  const focal =
    lens < 0.15 ? 13 : lens < 0.75 ? 24 + Math.floor(unitOf(a.id, "main") * 3) : lens < 0.93 ? 48 : 77;
  const shape = unitOf(a.id, "aspect");
  return {
    kind: "phone",
    focal,
    aspect: shape < 0.55 ? "16:9" : shape < 0.85 ? "4:3" : "9:16",
    tilt: (unitOf(a.id, "tilt") - 0.5) * 0.14,
    exposure: 0.9 + unitOf(a.id, "exposure") * 0.3,
    warmth: (unitOf(a.id, "warmth") - 0.5) * 0.16,
    noise: unitOf(a.id, "noise") * 0.35,
  };
}
