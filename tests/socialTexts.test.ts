import { describe, expect, it } from "vitest";
import {
  fillSlots,
  fitsMoment,
  momentAt,
  NO_REPEAT_WINDOW,
  slotsOf,
  SocialFeed,
  type Moment,
  type SocialChatter,
  type SocialWorld,
} from "../src/game/social";
import { accountFor, FOLLOWED, PICTURE_MOTIFS, personaSeeds, type Persona } from "../src/game/socialAccounts";
import {
  ANSWERS,
  CHATTER,
  CHATTER_ANSWERS,
  CHATTER_REPLIES,
  CHASE_FALLBACK,
  CHASE_OPENERS,
  CHASE_TAGS,
  STOP_FALLBACK,
  STOP_OPENERS,
  STOP_TAGS,
  DASHCAM_LEADS,
  MEDIA_WORDS,
  NEWS_IDENTIFIED,
  NEWS_QUOTE,
  OPENERS,
  QUOTES,
  REPLIES,
  REPLY_GROUP,
  SOURCE_TAGS,
  TAGS,
  WORDS,
  type ChatterTemplate,
  type Cue,
  type LineLike,
} from "../src/game/socialTexts";
import { VIOLATIONS, type ViolationKind, type ViolationRecord } from "../src/game/traffic";
import { BANNED } from "./socialBanned";

const KINDS = [...Object.keys(VIOLATIONS), "speed"] as ViolationKind[];
const textOf = (l: LineLike) => (typeof l === "string" ? l : l.text);
const fitsKind = (l: LineLike, kind: ViolationKind) =>
  typeof l === "string" || !l.kinds || l.kinds.includes(kind);
const ALL_CUES = new Set<Cue>(CHATTER.flatMap((t) => (t.cue ? [t.cue] : [])));
const SLOT_LEFT = /\{\w+\}/;
const strip = (t: string) => DASHCAM_LEADS.reduce((s, lead) => s.replace(lead, ""), t);

const record = (kind: ViolationKind): ViolationRecord => ({
  ...(kind === "speed"
    ? { kind, label: "速度超過（25km/h超過）", article: "道路交通法 第22条", points: 3, fine: 18000 }
    : VIOLATIONS[kind]),
  at: 0,
  status: "uncaught",
  context: {
    clock: "10/5(月) 9:30",
    place: "港区 芝公園四丁目 （芝公園交差点付近）",
    lat: 35.656,
    lon: 139.748,
    kmh: 65,
    limit: 40,
    limitKind: "sign",
  },
});

/** Everything the game can tell the feed, in Chiyoda with all three landmarks in sight. */
const world = (raining = false, more: Partial<SocialWorld> = {}): SocialWorld => ({
  ward: "千代田区",
  town: "丸の内二丁目",
  nearWards: ["中央区", "港区"],
  lat: 35.681,
  lon: 139.767,
  raining,
  tempC: 19,
  landmarks: [
    { name: "東京タワー", km: 3.2 },
    { name: "東京スカイツリー", km: 6.5 },
    { name: "東京駅丸の内駅舎", km: 0.4 },
  ],
  parks: ["日比谷公園"],
  river: "神田川",
  bridge: "飯田橋",
  signs: [{ ja: "銀座", en: "Ginza" }],
  buses: 1,
  jammed: true,
  ...more,
});

// Moments over a year: 8 days a month, every hour, rain or not, four temperatures.
const MOMENTS: Moment[] = [];
for (let month = 0; month < 12; month++)
  for (const day of [1, 5, 10, 12, 15, 20, 24, 28])
    for (let hour = 0; hour < 24; hour++)
      for (const raining of [false, true])
        for (const tempC of [4, 12, 19, 33])
          MOMENTS.push(
            momentAt(Date.UTC(2026, month, day, hour - 9, 30), world(raining, { tempC }), ALL_CUES),
          );

describe("Y texts: posts about the player's driving", () => {
  it("has 6–11 openers, several hashtags and replies for every kind the law module can emit", () => {
    for (const kind of KINDS) {
      expect(OPENERS[kind].length, kind).toBeGreaterThanOrEqual(6);
      expect(OPENERS[kind].length, kind).toBeLessThanOrEqual(11);
      expect(TAGS[kind].length, kind).toBeGreaterThanOrEqual(2);
      const group = REPLY_GROUP[kind];
      expect(REPLIES[group].filter((l) => fitsKind(l, kind)).length, kind).toBeGreaterThanOrEqual(3);
      expect(QUOTES[group].filter((l) => fitsKind(l, kind)).length, kind).toBeGreaterThanOrEqual(1);
      expect(ANSWERS[group].filter((l) => fitsKind(l, kind)).length, kind).toBeGreaterThanOrEqual(1);
    }
  });

  it("fills every slot of the posts, replies and quotes it writes, for every kind", () => {
    for (const kind of KINDS) {
      const feed = new SocialFeed();
      for (let i = 0; i < 400 && feed.posts.length < 14; i++) feed.maybePost(record(kind), 6, i * 60_000);
      feed.update(400 * 60_000);
      expect(feed.posts.length, kind).toBeGreaterThan(5);
      for (const p of feed.posts) {
        expect(p.text, kind).not.toMatch(SLOT_LEFT);
        for (const r of [...p.replies, ...p.quotePosts]) expect(r.text, kind).not.toMatch(SLOT_LEFT);
      }
    }
  });

  it("goes through a kind's openers before using one again", () => {
    for (const kind of KINDS) {
      const feed = new SocialFeed();
      for (let i = 0; i < 600 && feed.posts.length < 6; i++) feed.maybePost(record(kind), 6, 0);
      const texts = feed.posts.map((p) => strip(p.text));
      expect(new Set(texts).size, kind).toBe(texts.length);
    }
  });

  it("writes a words-only post without promising a video, and never under a dashcam", () => {
    const feed = new SocialFeed();
    let shots = 0;
    feed.camera = () => shots++;
    for (let i = 0; i < 400; i++) feed.maybePost(record("laneUse"), 6, 0);
    const words = feed.posts.filter((p) => p.media === "text");
    const pictured = feed.posts.filter((p) => p.media !== "text");
    expect(words.length).toBeGreaterThan(0);
    expect(feed.posts.some((p) => p.media === "photo")).toBe(true);
    expect(shots).toBe(pictured.length);
    for (const p of words) {
      expect(p.text).not.toMatch(/動画|撮れ|撮っ|映って/);
      expect(p.tags).not.toContain(SOURCE_TAGS.dashcam);
    }
  });

  it("keeps a pedestrian's own words out of a dashcam's clip", () => {
    const feed = new SocialFeed();
    for (let i = 0; i < 400; i++) feed.maybePost(record("pedestrianCrossing"), 6, 0);
    const dashcam = feed.posts.filter((p) => p.tags.includes(SOURCE_TAGS.dashcam));
    expect(dashcam.length).toBeGreaterThan(0);
    for (const p of dashcam) expect(p.text).not.toMatch(/ベビーカーで渡ろう|渡り始めてた/);
  });
});

describe("Y texts: everyday posts", () => {
  it("has well over 200 everyday templates across many personas", () => {
    expect(CHATTER.length).toBeGreaterThanOrEqual(200);
    expect(new Set(CHATTER.map((t) => t.text)).size).toBe(CHATTER.length);
    expect(new Set(CHATTER.map((t) => t.who)).size).toBeGreaterThanOrEqual(25);
  });

  it("knows every slot a template uses, and each template fits some moment of the year with all filled", () => {
    const known = new Set(Object.keys(MOMENTS[0].values));
    for (const t of CHATTER) {
      for (const s of slotsOf(t.text)) expect(known, `${s} in ${t.text}`).toContain(s);
      const m = MOMENTS.find((x) => fitsMoment(t, x));
      expect(m, t.text).toBeDefined();
      if (m) expect(fillSlots(t.text, m.values, Math.random), t.text).not.toMatch(SLOT_LEFT);
    }
    for (const lines of Object.values(CHATTER_REPLIES))
      for (const l of lines) for (const s of slotsOf(l)) expect(known).toContain(s);
  });

  it("only uses picture motifs the app can paint, and most of them", () => {
    const used = new Set(CHATTER.flatMap((t) => (t.picture ? [t.picture] : [])));
    for (const m of used) expect(PICTURE_MOTIFS).toContain(m);
    expect(used.size).toBeGreaterThanOrEqual(PICTURE_MOTIFS.length - 1);
  });

  it("gives every persona a few different people in the pool", () => {
    const personas = new Set(CHATTER.map((t) => t.who).filter((w) => !(w in FOLLOWED)));
    for (const p of personas) {
      const seeds = personaSeeds(p as Persona);
      const names = new Set(seeds.map((s) => accountFor(s, 0).name));
      expect(seeds.length, p).toBeGreaterThanOrEqual(10);
      expect(names.size, p).toBeGreaterThanOrEqual(2);
    }
  });

  it("is never told to the wrong time, season, weather or light (a week of game time)", () => {
    const { chatter, worlds, feed } = simulate(7 * 24 * 60, 60);
    expect(chatter.length).toBeGreaterThan(200);
    for (const c of chatter) {
      const t = feed.templateOf(c) as ChatterTemplate;
      const m = momentAt(c.postedAt, worlds.get(c.id) ?? null, ALL_CUES);
      expect(fitsMoment(t, m), `${t.text} at ${new Date(c.postedAt + 9 * 3_600_000).toISOString()}`).toBe(
        true,
      );
      const isFollowed = t.who in FOLLOWED;
      if (isFollowed) expect(c.account).toBe(FOLLOWED[t.who as keyof typeof FOLLOWED]);
      else expect(c.account.persona).toBe(t.who);
      expect(c.text).not.toMatch(SLOT_LEFT);
    }
  });

  it(`never shows the same everyday post twice within ${NO_REPEAT_WINDOW} posts, at either clock speed`, () => {
    for (const [minutes, scale] of [
      [7 * 24 * 60, 60],
      [8 * 60, 1],
    ] as const) {
      const { chatter, feed } = simulate(minutes, scale);
      const texts = chatter.map((c) => feed.templateOf(c)?.text);
      for (let i = 0; i + NO_REPEAT_WINDOW <= texts.length; i++)
        expect(new Set(texts.slice(i, i + NO_REPEAT_WINDOW)).size).toBe(NO_REPEAT_WINDOW);
    }
  });

  it("puts a few fitting replies under everyday posts, and the poster sometimes answers", () => {
    const { chatter } = simulate(24 * 60, 60);
    const replied = chatter.filter((c) => c.replies.length > 0);
    expect(replied.length).toBeGreaterThan(chatter.length / 5);
    expect(
      chatter.some((c) => c.replies.some((r) => r.replyTo !== undefined && r.account === c.account)),
    ).toBe(true);
    for (const c of replied) {
      expect(new Set(c.replies.map((r) => r.text)).size).toBe(c.replies.length);
      for (const r of c.replies) {
        expect(r.text).not.toMatch(SLOT_LEFT);
        expect(r.postedAt).toBeGreaterThanOrEqual(c.postedAt);
        // People chatting under an everyday post are not throwaway accounts.
        if (r.replyTo === undefined) expect(r.account.isNew).toBe(false);
      }
    }
  });

  it("talks about what just happened nearby within the next couple of posts", () => {
    for (const kind of ["orbis", "robotaxi", "crash", "shirobai", "pursuit"] as const) {
      const feed = new SocialFeed();
      feed.world = () => world(false, { buses: 0, jammed: false });
      const t0 = Date.UTC(2026, 9, 5, 2); // 11:00 JST
      feed.update(t0);
      const before = feed.chatter.length;
      feed.note(kind, t0);
      for (let s = 1; s <= 120; s++) feed.update(t0 + s * 60_000);
      const next = feed.chatter
        .slice(0, feed.chatter.length - before)
        .toReversed()
        .slice(0, 2);
      expect(
        next.some((c) => feed.templateOf(c)?.cue === kind),
        kind,
      ).toBe(true);
    }
  });

  it("thanks the player now and then for stopping where people could see", () => {
    const feed = new SocialFeed();
    feed.world = () => world();
    const t0 = Date.UTC(2026, 9, 5, 3); // 12:00 JST
    feed.update(t0);
    expect(feed.maybePraise("yieldPedestrian", 0, t0)).toBeNull();
    let praise: SocialChatter | null = null;
    for (let i = 0; i < 20 && !praise; i++) praise = feed.maybePraise("yieldPedestrian", 8, t0);
    expect(praise?.aboutPlayer).toBe("yieldPedestrian");
    expect(feed.templateOf(praise as SocialChatter)?.cue).toBe("yieldPedestrian");
    expect(feed.events.some((e) => e.kind === "praise" && e.chatter === praise)).toBe(true);
    // Not again at once (90 real seconds at least).
    for (let i = 0; i < 20; i++) expect(feed.maybePraise("fullStop", 8, t0 + 30 * 60_000)).toBeNull();
    let stop: SocialChatter | null = null;
    for (let i = 0; i < 20 && !stop; i++) stop = feed.maybePraise("fullStop", 8, t0 + 2 * 3_600_000);
    expect(feed.templateOf(stop as SocialChatter)?.cue).toBe("fullStop");
  });
});

const all = (): string[] => [
  ...Object.values(OPENERS).flatMap((ls) => ls.map(textOf)),
  ...Object.values(TAGS).flat(),
  ...Object.values(REPLIES).flatMap((ls) => ls.map(textOf)),
  ...Object.values(QUOTES).flatMap((ls) => ls.map(textOf)),
  ...Object.values(ANSWERS).flatMap((ls) => ls.map(textOf)),
  ...CHATTER.flatMap((t) => [t.text, ...(t.replies ?? [])]),
  ...Object.values(CHATTER_REPLIES).flat(),
  ...Object.values(CHATTER_ANSWERS).flat(),
  ...Object.values(WORDS).flatMap((ws) => ws.map((w) => w.text)),
  ...Object.values(MEDIA_WORDS),
  ...Object.values(SOURCE_TAGS),
  ...DASHCAM_LEADS,
  NEWS_QUOTE,
  ...Object.values(CHASE_OPENERS).flatMap((ls) => ls.map(textOf)),
  ...CHASE_TAGS,
  CHASE_FALLBACK,
  NEWS_IDENTIFIED,
  ...Object.values(STOP_OPENERS).flatMap((ls) => ls.map(textOf)),
  ...STOP_TAGS,
  STOP_FALLBACK,
];

describe("Y texts: words that must not appear", () => {
  it("names no real service, brand, operator or politics in any text or account", () => {
    const people = Array.from({ length: 4000 }, (_, i) => accountFor(i, 0)).flatMap((a) => [a.name, a.bio]);
    for (const text of [...all(), ...people]) for (const word of BANNED) expect(text).not.toMatch(word);
  });
});

/**
 * The feed run for `minutes` of game time at a clock speed (`scale` game ms per real ms), updated
 * every real second, with the weather turning every few hours. Returns the everyday posts in the
 * order they were written and the world each saw.
 */
function simulate(minutes: number, scale: number) {
  const feed = new SocialFeed();
  feed.timeScale = scale;
  let w = world();
  feed.world = () => w;
  const t0 = Date.UTC(2026, 9, 4, 15); // 0:00 JST, a Monday
  const step = 1000 * scale;
  const seen = new Map<number, SocialChatter>();
  const worlds = new Map<number, SocialWorld>();
  for (let at = t0; at <= t0 + minutes * 60_000; at += step) {
    const hours = Math.floor((at - t0) / 3_600_000);
    w = world(hours % 7 === 3 || hours % 11 === 5, { buses: hours % 3, jammed: hours % 5 === 0 });
    feed.update(at);
    for (const c of feed.chatter)
      if (!seen.has(c.id)) {
        seen.set(c.id, c);
        worlds.set(c.id, w);
      }
  }
  const chatter = [...seen.values()].toSorted((a, b) => a.id - b.id);
  return { chatter, worlds, feed };
}
