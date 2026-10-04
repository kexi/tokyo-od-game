import type { ViolationRecord } from "./traffic";

/**
 * つぶやき (a fictional social app on the in-game phone): what happens when bystanders or a
 * dashcam film a violation. A post appears with the clip's still, hashtags and the place; over
 * game time it gathers reposts, quotes, likes and replies (やべー, こいつやべー, 通報しました …),
 * and once it spreads far enough the police trace the driver from the video, so a notice to
 * appear follows. Nothing here imitates a real service: names, handles and terms are generic.
 */
export type SocialReply = { author: string; handle: string; text: string; atMinute: number };
export type SocialPost = {
  id: number;
  author: string;
  handle: string;
  text: string;
  tags: string[];
  image?: string;
  record: ViolationRecord;
  severity: number;
  /** Game time (epoch ms) of the post. */
  postedAt: number;
  /** Final reach (reposts) this post is heading for. */
  reach: number;
  reposts: number;
  quotes: number;
  likes: number;
  views: number;
  replies: SocialReply[];
  quotePosts: SocialReply[];
  /** The police have seen it (it becomes a notice to appear). */
  isReported: boolean;
};

// How shocking each kind is to watch (0–1): what makes people film, post and share it.
const SEVERITY: Record<string, number> = {
  hitAndRun: 1,
  injury: 0.95,
  safeDriving: 0.75,
  pedestrianCrossing: 0.7,
  signal: 0.6,
  noEntry: 0.6,
  phoneDanger: 0.7,
  keepLeft: 0.4,
  stopSign: 0.35,
  closedRoad: 0.3,
  phone: 0.3,
  uturn: 0.3,
  laneChange: 0.2,
  unlicensed: 0.2,
};

function severityOf(r: ViolationRecord): number {
  if (r.kind === "speed") {
    const over = Number(/（(\d+)km\/h超過）/.exec(r.label)?.[1] ?? 0);
    return over >= 30 ? 0.75 : over >= 20 ? 0.45 : over >= 15 ? 0.25 : 0.1;
  }
  return SEVERITY[r.kind] ?? (r.kind.startsWith("injury") ? 0.95 : 0.15);
}

const PEOPLE = [
  ["通勤ドライバー", "commute_driver"],
  ["ドラレコ民", "dashcam_watch"],
  ["丸の内の会社員", "office_marunouchi"],
  ["交通安全おじさん", "anzen_ojisan"],
  ["夜勤明けの看護師", "night_nurse"],
  ["子育て中", "kosodate_days"],
  ["自転車通学の学生", "bike_student"],
  ["配達ドライバー", "delivery_run"],
  ["タクシー乗務員", "taxi_crew"],
  ["散歩が趣味", "sanpo_daily"],
  ["東京観光中", "tokyo_trip"],
  ["元教習所勤務", "ex_instructor"],
] as const;

const OPENERS: Record<string, string[]> = {
  signal: ["{place}で赤信号を突っ切っていった車がいた…", "信号無視の車、目の前を通過。{place}"],
  speed: ["{place}で明らかにスピード出しすぎの車。{kmh}キロくらい出てたと思う", "制限速度どこいった…{place}"],
  noEntry: ["一方通行を逆走してくる車がいた。{place}", "逆走車、普通に怖い。{place}"],
  keepLeft: ["対向車線にはみ出して走ってきた車、ぶつかるかと思った。{place}"],
  stopSign: ["「止まれ」で一切止まらない車。{place}", "一時停止ガン無視…{place}"],
  pedestrianCrossing: ["横断歩道を渡ってる人がいるのに止まらない車。{place}"],
  closedRoad: ["通学路の時間帯なのに車が入ってきた。{place}"],
  phone: ["運転しながらずっとスマホ見てる人がいた…{place}"],
  phoneDanger: ["スマホ見ながら運転してて事故。{place}"],
  safeDriving: ["{place}で事故。車同士がぶつかった音がすごかった"],
  injury: ["{place}で人身事故。車が人をはねた…救急車が来てる"],
  hitAndRun: ["ひき逃げ！{place}。車は逃げていった。ナンバー見た人いませんか"],
  uturn: ["転回禁止なのにUターンしてた車。{place}"],
};
const TAGS: Record<string, string[]> = {
  signal: ["#信号無視", "#危険運転"],
  speed: ["#スピード違反", "#危険運転"],
  noEntry: ["#逆走", "#危険運転"],
  hitAndRun: ["#ひき逃げ", "#拡散希望"],
  injury: ["#事故", "#拡散希望"],
  safeDriving: ["#事故"],
  phone: ["#ながら運転"],
  phoneDanger: ["#ながら運転", "#事故"],
};

const REPLIES = [
  "やべー",
  "こいつやべー",
  "危なすぎる",
  "これは酷い",
  "見てて冷や汗出た",
  "子どもがいたらと思うとゾッとする",
  "ドラレコ有能",
  "通報案件",
  "通報しました",
  "警察仕事して",
  "これは免停でしょ",
  "免許返納してほしい",
  "運転向いてないと思う",
  "最近こういうの多すぎ",
  "東京の運転マナーどうなってるの",
  "ナンバー映ってるね",
  "保存した",
  "同じ交差点で自分も危ない目にあった",
  "人の命をなんだと思ってるんだ",
  "急いでたのかもしれないけど、ダメなものはダメ",
  "動画だけだと前後がわからないけど、これはアウト",
  "教習所からやり直してほしい",
];
const QUOTES = [
  "これはアウト",
  "こわ…",
  "{place}を通る人は気をつけて",
  "こういうのが一番危ない",
  "警察に情報提供した方がいい",
  "拡散。自分も気をつけよう",
];

const fill = (t: string, r: ViolationRecord) =>
  t
    .replace("{place}", r.context?.place?.split(" ").slice(0, 2).join("") || "都内")
    .replace("{kmh}", String(Math.round(r.context?.kmh ?? 0)));

/**
 * Words from the on-device LLM, when it is on: the post and its first replies are rewritten in a
 * bystander's own voice. Null (or no writer) keeps the template text, so the feed works without it.
 */
export type SocialWriter = (
  role: "post" | "reply" | "quote",
  post: SocialPost,
  seed: number,
) => Promise<string | null>;
const LLM_REPLIES = 6;

export class SocialFeed {
  readonly posts: SocialPost[] = [];
  writer: SocialWriter | null = null;
  private seed = 12345;
  private nextId = 1;

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return (this.seed >>> 8) / 0x1000000;
  }

  /**
   * Maybe someone filmed it: the more people around and the worse it looked, the likelier a
   * post. Returns the post if one was made.
   */
  maybePost(record: ViolationRecord, witnesses: number, gameNow: number): SocialPost | null {
    const severity = severityOf(record);
    const chance = Math.min(0.95, severity * Math.min(1, witnesses / 3) * 1.2);
    if (witnesses === 0 || this.rand() > chance) return null;
    const [author, handle] = PEOPLE[Math.floor(this.rand() * PEOPLE.length)];
    const openers = OPENERS[record.kind] ??
      OPENERS[record.kind.replace(/\d+$/, "")] ?? ["{place}で危ない運転の車がいた"];
    const text = fill(openers[Math.floor(this.rand() * openers.length)], record);
    const area = record.context?.place?.split(" ")[0];
    const tags = [...(TAGS[record.kind] ?? ["#危険運転"]), "#ドラレコ", ...(area ? [`#${area}`] : [])];
    // Reach spans from a few reposts to tens of thousands for the worst.
    const reach = Math.round(10 ** (0.8 + 3.6 * severity * (0.55 + 0.45 * this.rand())));
    const post: SocialPost = {
      id: this.nextId++,
      author,
      handle: `${handle}_${Math.floor(this.rand() * 9000 + 1000)}`,
      text,
      tags,
      image: record.context?.snapshot,
      record,
      severity,
      postedAt: gameNow,
      reach,
      reposts: 0,
      quotes: 0,
      likes: 0,
      views: 0,
      replies: [],
      quotePosts: [],
      isReported: false,
    };
    this.posts.unshift(post);
    void this.writer?.("post", post, 0).then((text) => {
      if (text) post.text = text;
    });
    return post;
  }

  /** Grow every post with game time; returns posts the police have just noticed. */
  update(gameNow: number): SocialPost[] {
    const noticed: SocialPost[] = [];
    for (const p of this.posts) {
      p.image ??= p.record.context?.snapshot;
      const minutes = Math.max(0, (gameNow - p.postedAt) / 60_000);
      // Shares spread over the first minutes, then level off (compressed from hours for play).
      const spread = 1 - Math.exp(-minutes / (2 + 6 * (1 - p.severity)));
      p.reposts = Math.round(p.reach * spread);
      p.quotes = Math.round(p.reposts * 0.12);
      p.likes = Math.round(p.reposts * (3 + p.severity * 2));
      p.views = Math.round(p.likes * 38 + p.reposts * 15);
      const wantReplies = Math.min(14, Math.floor(Math.log2(1 + p.reposts) * 1.6));
      while (p.replies.length < wantReplies) {
        const r = this.reply(REPLIES, p, minutes);
        p.replies.push(r);
        if (p.replies.length <= LLM_REPLIES)
          void this.writer?.("reply", p, p.replies.length).then((text) => {
            if (text) r.text = text;
          });
      }
      const wantQuotes = Math.min(5, Math.floor(Math.log10(1 + p.quotes) * 2));
      while (p.quotePosts.length < wantQuotes) {
        const q = this.reply(QUOTES, p, minutes);
        p.quotePosts.push(q);
        if (p.quotePosts.length <= 2)
          void this.writer?.("quote", p, 100 + p.quotePosts.length).then((text) => {
            if (text) q.text = text;
          });
      }
      // Widely shared clips get to the police, who trace the car from the video.
      const isWide = p.reposts > 2000 || (p.severity >= 0.9 && p.reposts > 50);
      if (isWide && !p.isReported) {
        p.isReported = true;
        noticed.push(p);
      }
    }
    return noticed;
  }

  private reply(pool: readonly string[], p: SocialPost, minutes: number): SocialReply {
    const [author, handle] = PEOPLE[Math.floor(this.rand() * PEOPLE.length)];
    return {
      author,
      handle: `${handle}_${Math.floor(this.rand() * 9000 + 1000)}`,
      text: fill(pool[Math.floor(this.rand() * pool.length)], p.record),
      atMinute: Math.round(minutes),
    };
  }
}

/** 1.2万 / 3,456 style counts. */
export function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return n.toLocaleString();
}
