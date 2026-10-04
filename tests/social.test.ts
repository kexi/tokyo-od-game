import { describe, expect, it } from "vitest";
import { SocialFeed } from "../src/game/social";
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
