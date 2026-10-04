import { describe, expect, it } from "vitest";
import { formatCount, postTimestamp, relativeTime, SocialFeed } from "../src/game/social";
import { cameraFor } from "../src/game/socialAccounts";
import { VIOLATIONS, type ViolationRecord } from "../src/game/traffic";

const record = (kind: keyof typeof VIOLATIONS): ViolationRecord => ({
  ...VIOLATIONS[kind],
  at: 0,
  status: "uncaught",
  context: {
    clock: "10/4(日) 11:30",
    place: "千代田区 丸の内二丁目",
    lat: 35.68,
    lon: 139.76,
    kmh: 50,
    limit: 40,
    limitKind: "sign",
  },
});

describe("つぶやき: posts about the player's driving", () => {
  it("is never posted when nobody saw it", () => {
    const feed = new SocialFeed();
    for (let i = 0; i < 20; i++) expect(feed.maybePost(record("hitAndRun"), 0, 0)).toBeNull();
  });

  it("usually gets posted when a hit-and-run happens in front of people", () => {
    const feed = new SocialFeed();
    let posted = 0;
    for (let i = 0; i < 20; i++) if (feed.maybePost(record("hitAndRun"), 6, 0)) posted++;
    expect(posted).toBeGreaterThan(15);
  });

  it("spreads with game time and gathers replies and quotes", () => {
    const feed = new SocialFeed();
    let post = null;
    for (let i = 0; i < 20 && !post; i++) post = feed.maybePost(record("signal"), 6, 0);
    expect(post).not.toBeNull();
    feed.update(0);
    const early = post!.reposts;
    feed.update(30 * 60_000);
    expect(post!.reposts).toBeGreaterThan(early);
    expect(post!.likes).toBeGreaterThan(post!.reposts);
    expect(post!.replies.length).toBeGreaterThan(0);
  });

  it("reaches the police once a severe clip has spread", () => {
    const feed = new SocialFeed();
    let post = null;
    for (let i = 0; i < 20 && !post; i++) post = feed.maybePost(record("hitAndRun"), 6, 0);
    const noticed = feed.update(60 * 60_000);
    expect(noticed).toContain(post);
    expect(post!.isReported).toBe(true);
  });

  it("uses the LLM's words when a writer is set, and the template otherwise", async () => {
    const feed = new SocialFeed();
    feed.writer = async (role) => (role === "post" ? "目の前で信号無視の車が突っ込んできた…怖すぎる" : null);
    let post = null;
    for (let i = 0; i < 20 && !post; i++) post = feed.maybePost(record("signal"), 6, 0);
    await new Promise((r) => setTimeout(r, 0));
    expect(post!.text).toBe("目の前で信号無視の車が突っ込んできた…怖すぎる");
  });
});

const firstPost = (feed: SocialFeed, kind: keyof typeof VIOLATIONS, at = 0) => {
  let post = null;
  for (let i = 0; i < 40 && !post; i++) post = feed.maybePost(record(kind), 6, at);
  if (!post) throw new Error("nobody posted");
  return post;
};

describe("つぶやき: what the app shows", () => {
  it("formats counts the way the app does (cut, not rounded)", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(3456)).toBe("3,456");
    expect(formatCount(10000)).toBe("1万");
    expect(formatCount(12345)).toBe("1.2万");
    expect(formatCount(99999)).toBe("9.9万");
    expect(formatCount(123456)).toBe("12.3万");
    expect(formatCount(1234567)).toBe("123万");
    expect(formatCount(123456789)).toBe("1.2億");
  });

  it("shows a post's age as たった今 / minutes / hours / a date", () => {
    const now = Date.UTC(2026, 9, 5, 2, 30); // 2026-10-05 11:30 JST
    expect(relativeTime(now - 30_000, now)).toBe("たった今");
    expect(relativeTime(now - 3 * 60_000, now)).toBe("3分");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2時間");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("10月3日");
    expect(relativeTime(Date.UTC(2025, 11, 30, 23), now)).toBe("2025年12月31日");
    // A clock set back (a new day) never shows a negative age.
    expect(relativeTime(now + 60_000, now)).toBe("たった今");
  });

  it("shows an opened post's time in Japan time", () => {
    expect(postTimestamp(Date.UTC(2026, 9, 5, 2, 30))).toBe("午前11:30 · 2026年10月5日");
    expect(postTimestamp(Date.UTC(2026, 9, 5, 3, 5))).toBe("午後0:05 · 2026年10月5日");
  });

  it("gives every reply an author and a time between the post and now", () => {
    const feed = new SocialFeed();
    const post = firstPost(feed, "hitAndRun");
    const now = 40 * 60_000;
    feed.update(now);
    expect(post.replies.length).toBeGreaterThan(3);
    for (const r of post.replies) {
      expect(r.account.handle).toBe(r.handle);
      expect(r.postedAt).toBeGreaterThanOrEqual(post.postedAt);
      expect(r.postedAt).toBeLessThanOrEqual(now);
    }
  });

  it("lets the poster answer replies under their own post (at most twice per post)", () => {
    const feed = new SocialFeed();
    for (let i = 0; i < 12; i++) feed.maybePost(record("hitAndRun"), 6, 0);
    feed.update(60 * 60_000);
    const answers = feed.posts.flatMap((p) =>
      p.replies.filter((r) => r.replyTo !== undefined).map((r) => ({ p, r })),
    );
    expect(answers.length).toBeGreaterThan(0);
    for (const { p, r } of answers) {
      expect(r.account).toBe(p.account);
      expect(p.replies.some((x) => x.id === r.replyTo)).toBe(true);
    }
    for (const p of feed.posts)
      expect(p.replies.filter((r) => r.account === p.account).length).toBeLessThanOrEqual(2);
  });

  it("makes a pedestrian who filmed it the author, pictured in their own clothes", () => {
    const feed = new SocialFeed();
    const colors = { shirt: 0xd94f45, pants: 0x2b3445, skin: 0xf1c9a5, hair: 0x1a1410, umbrella: 0 };
    let post = null;
    for (let i = 0; i < 20 && !post; i++)
      post = feed.maybePost(record("hitAndRun"), 6, 0, { id: 42, colors, variant: 2 });
    expect(post?.account.avatar).toMatchObject({ kind: "portrait", colors, variant: 2 });
    expect(feed.accounts.get(post!.account.id)).toBe(post!.account);
  });

  it("asks the camera for each post's own shot as it is posted", () => {
    const feed = new SocialFeed();
    const shot: number[] = [];
    feed.camera = (p) => shot.push(p.id);
    for (let i = 0; i < 10; i++) feed.maybePost(record("hitAndRun"), 6, 0);
    expect(shot).toEqual(feed.posts.map((p) => p.id).reverse());
  });

  it("tags a dashcam's clip as one and a phone's as a sighting", () => {
    const feed = new SocialFeed();
    for (let i = 0; i < 30; i++) feed.maybePost(record("signal"), 6, 0);
    for (const p of feed.posts) {
      const isDashcam = cameraFor(p.account).kind === "dashcam";
      expect(p.tags.includes("#ドラレコ")).toBe(isDashcam);
      expect(p.tags.includes("#目撃情報")).toBe(!isDashcam);
    }
  });

  it("fills the rest of the timeline with the last few hours of everyday posts, newest first", () => {
    const feed = new SocialFeed();
    const now = Date.UTC(2026, 9, 5, 3);
    feed.update(now);
    expect(feed.chatter.length).toBeGreaterThan(5);
    for (const c of feed.chatter) {
      expect(c.postedAt).toBeLessThanOrEqual(now);
      expect(c.postedAt).toBeGreaterThan(now - 3 * 3_600_000);
    }
    const times = feed.chatter.map((c) => c.postedAt);
    expect(times).toEqual(times.toSorted((a, b) => b - a));
    feed.update(now + 60 * 60_000);
    expect(feed.chatter[0].postedAt).toBeGreaterThan(now);
  });

  it("drops everyday posts from the future when the clock is set back", () => {
    const feed = new SocialFeed();
    const evening = Date.UTC(2026, 9, 5, 10);
    feed.update(evening);
    const morning = evening - 10 * 3_600_000;
    feed.update(morning);
    for (const c of feed.chatter) expect(c.postedAt).toBeLessThanOrEqual(morning);
  });

  it("notifies the player as a clip trends, and followed accounts repost it", () => {
    const feed = new SocialFeed();
    const post = firstPost(feed, "hitAndRun");
    feed.update(60 * 60_000);
    expect(post.reposts).toBeGreaterThan(100);
    expect(feed.events.some((e) => e.kind === "trend" && e.post === post)).toBe(true);
    expect(post.reposters.length).toBeGreaterThan(0);
    expect(new Set(post.reposters.map((r) => r.account)).size).toBe(post.reposters.length);
    // The news account quotes the clip the police now know of.
    expect(post.quotePosts.some((q) => q.account.isVouched)).toBe(true);
  });
});
