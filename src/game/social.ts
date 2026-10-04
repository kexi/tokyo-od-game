import type { HumanColors } from "../world/human";
import {
  accountFor,
  avatarFor,
  cameraFor,
  FOLLOWED,
  FOLLOWED_LIST,
  hashString,
  PLAYER_ACCOUNT,
  witnessAccount,
  type FollowedKey,
  type PictureMotif,
  type SocialAccount,
} from "./socialAccounts";
import type { ViolationRecord } from "./traffic";

/**
 * Y (SOCIAL_APP_NAME, a fictional social app on the in-game phone): what happens when bystanders or a
 * dashcam film a violation. A post appears with the poster's own shot, hashtags and the place; over
 * game time it gathers reposts, quotes, likes and replies (やべー, こいつやべー, 通報しました …),
 * and once it spreads far enough the police trace the driver from the video, so a notice to
 * appear follows. Around those posts runs everyone else's everyday timeline (chatter), and the
 * notifications the player gets. Nothing here imitates a real service: names, handles and terms
 * are generic.
 */
export type SocialReply = {
  id: number;
  account: SocialAccount;
  /** account.name and account.handle (kept for older readers). */
  author: string;
  handle: string;
  text: string;
  /** Minutes after the post. */
  atMinute: number;
  /** Game time (epoch ms). */
  postedAt: number;
  /** Its share of the post's likes (they grow together). */
  weight: number;
  likes: number;
  /** The reply this answers (the poster answering someone); absent when it answers the post. */
  replyTo?: number;
};
export type SocialPost = {
  id: number;
  account: SocialAccount;
  author: string;
  handle: string;
  text: string;
  tags: string[];
  /** The driver's own view at the moment (the fallback when no bystander shot could be taken). */
  image?: string;
  /** The poster's own shot from where they stood (witnessShot.ts), a JPEG data URL. */
  photo?: string;
  /** Width / height of `photo`. */
  photoAspect?: number;
  /** Length of the clip, seconds. */
  clipSeconds: number;
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
  /** Accounts the player follows who reposted it, and when. */
  reposters: { account: SocialAccount; at: number }[];
  /** The police have seen it (it becomes a notice to appear). */
  isReported: boolean;
};

/** An everyday post of someone else: the rest of the timeline. */
export type SocialChatter = {
  id: number;
  account: SocialAccount;
  text: string;
  picture?: { motif: PictureMotif; hue: number };
  postedAt: number;
  /** Likes it is heading for. */
  reach: number;
  likes: number;
  reposts: number;
  views: number;
};

/** What the notifications tab lists. */
export type SocialEvent =
  | { kind: "trend"; at: number; post: SocialPost }
  | { kind: "milestone"; at: number; post: SocialPost; count: number }
  | { kind: "news"; at: number; post: SocialPost; quote: SocialReply }
  | { kind: "follow"; at: number; account: SocialAccount };

/** A pedestrian who filmed it: the post's author is then that person, in their own clothes. */
export type SocialWitness = { id?: number; colors: HumanColors; variant?: number };

/** Takes the poster's own shot of what they saw, at the moment of posting (sets photo). */
export type SocialCamera = (post: SocialPost) => void;

const MINUTE = 60_000;
const HOUR = 3_600_000;

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

/** How shocking it looked (0–1): sets the chance of a post here and who films it (witnessPhones). */
export function severityOf(r: ViolationRecord): number {
  if (r.kind === "speed") {
    const over = Number(/（(\d+)km\/h超過）/.exec(r.label)?.[1] ?? 0);
    return over >= 30 ? 0.75 : over >= 20 ? 0.45 : over >= 15 ? 0.25 : 0.1;
  }
  return SEVERITY[r.kind] ?? (r.kind.startsWith("injury") ? 0.95 : 0.15);
}

const OPENERS: Record<string, string[]> = {
  signal: [
    "{place}で赤信号を突っ切っていった車がいた…",
    "信号無視の車、目の前を通過。{place}",
    "{place}の交差点、完全に赤なのに突っ込んでいった車…",
  ],
  speed: ["{place}で明らかにスピード出しすぎの車。{kmh}キロくらい出てたと思う", "制限速度どこいった…{place}"],
  noEntry: ["一方通行を逆走してくる車がいた。{place}", "逆走車、普通に怖い。{place}"],
  keepLeft: [
    "対向車線にはみ出して走ってきた車、ぶつかるかと思った。{place}",
    "センターラインはみ出してくる車、正面から来て本当に怖かった。{place}",
  ],
  stopSign: ["「止まれ」で一切止まらない車。{place}", "一時停止ガン無視…{place}"],
  pedestrianCrossing: [
    "横断歩道を渡ってる人がいるのに止まらない車。{place}",
    "横断歩道でお年寄りが渡ろうとしてたのに、スピードも落とさず通過していった車。{place}",
  ],
  closedRoad: ["通学路の時間帯なのに車が入ってきた。{place}"],
  phone: [
    "運転しながらずっとスマホ見てる人がいた…{place}",
    "スマホ見ながら走ってる車、ふらふらしてた。{place}",
  ],
  phoneDanger: ["スマホ見ながら運転してて事故。{place}"],
  safeDriving: [
    "{place}で事故。車同士がぶつかった音がすごかった",
    "目の前で事故。{place}。ぶつけた方、前を見てなかったと思う",
  ],
  injury: [
    "{place}で人身事故。車が人をはねた…救急車が来てる",
    "{place}で車が歩行者をはねるのを見てしまった…救急車呼びました",
  ],
  hitAndRun: [
    "ひき逃げ！{place}。車は逃げていった。ナンバー見た人いませんか",
    "{place}で人をはねた車がそのまま走り去った。見た人は警察へ",
    "ひき逃げの瞬間を撮ってしまった…{place}。けが人がいます",
  ],
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
  "撮ってくれてありがとう",
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
// The poster answering a reply under their own post.
const ANSWERS = [
  "警察には情報提供しました",
  "映像は加工なしです。撮ったそのまま",
  "場所は{place}です。通る人は気をつけて",
  "ほんとそれです",
  "思ったより広まっててびっくりしてる…",
];

/** Everyday posts: who (an account the player follows, or anyone), what, and at what hours (JST). */
type Chat = { who: FollowedKey | null; text: string; picture?: PictureMotif; hours?: [number, number] };
const CHATTER: readonly Chat[] = [
  {
    who: "weather",
    text: "おはようございます。今朝の東京、富士山まで見えました",
    picture: "fuji",
    hours: [5, 11],
  },
  {
    who: "weather",
    text: "夕焼けがきれいでした。今日もおつかれさまでした",
    picture: "sunset",
    hours: [16, 19],
  },
  { who: "weather", text: "今夜の東京。空気が澄んでて遠くまで見える", picture: "skyline", hours: [19, 24] },
  {
    who: "lab",
    text: "【安全運転のコツ】右折するときは、対向車の陰から来るバイクや自転車に注意。見えないところに誰かいるかも、と考えるのが基本です",
  },
  {
    who: "lab",
    text: "【安全運転のコツ】横断歩道を渡ろうとしている人がいたら、必ず手前で一時停止（道路交通法 第38条）",
  },
  {
    who: "lab",
    text: "【安全運転のコツ】スマホは運転前にしまう。手に持って見ながらの運転は違反、事故を起こせば一発で免許停止です",
  },
  { who: "lab", text: "黄色信号は「止まれ」。安全に止まれないときだけ進めます（道路交通法施行令 第2条）" },
  {
    who: "news",
    text: "【交通】都心の主要道路は夕方にかけて混雑する見込みです。時間に余裕をもってお出かけください",
    hours: [11, 18],
  },
  {
    who: "news",
    text: "【交通】歩行者が巻き込まれる事故の多くは、道路を横断している時に起きています。横断歩道の手前では速度を落として",
  },
  { who: "ramen", text: "今日の一杯。醤油ラーメン、スープまで完飲", picture: "ramen", hours: [11, 15] },
  { who: "ramen", text: "夜ラーメンは背徳の味", picture: "ramen", hours: [20, 24] },
  { who: "cat", text: "うちの猫、窓から車を眺めるのが好き", picture: "cat" },
  { who: "cat", text: "寝てる写真しか撮れない", picture: "cat" },
  { who: "commute", text: "首都高、今日もそこそこ混んでる", hours: [7, 20] },
  { who: "commute", text: "車間距離をとるだけで、ブレーキを踏む回数がぜんぜん違う" },
  { who: "teacher", text: "教習所で習ったこと、忘れてる人多いよね。左折は左に寄せてから" },
  { who: "teacher", text: "「だろう運転」じゃなくて「かもしれない運転」。何年たっても基本はこれ" },
  { who: "cafe", text: "朝のコーヒー☕ 今日もがんばろう", picture: "coffee", hours: [6, 11] },
  { who: "cafe", text: "午後の休憩。ラテアートかわいい", picture: "coffee", hours: [13, 18] },
  { who: null, text: "電車遅れてる…", hours: [6, 23] },
  { who: null, text: "東京タワー見えた🗼", picture: "skyline" },
  { who: null, text: "花が咲いてた🌸", picture: "flower", hours: [6, 18] },
  { who: null, text: "新しい車きた！大事に乗る🚗", picture: "car" },
  { who: null, text: "今日めちゃくちゃ歩いた。2万歩" },
  { who: null, text: "渋滞にハマった。音楽聴きながら気長に待つ" },
  { who: null, text: "横断歩道で止まってくれる車が増えた気がする。ありがたい" },
  { who: null, text: "富士山くっきり", picture: "fuji", hours: [6, 16] },
  { who: null, text: "ランチはラーメン", picture: "ramen", hours: [11, 14] },
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
// Seeds of the accounts people are drawn from (accountFor).
const ACCOUNT_POOL = 4000;
// Posters of the 晒し are often accounts made for it.
const POSTER_NEW_SHARE = 0.4;
const MAX_CHATTER = 40;
const MAX_EVENTS = 60;
const MILESTONES = [100, 1000, 10000, 100000];

export class SocialFeed {
  readonly posts: SocialPost[] = [];
  /** Everyone else's everyday posts, newest first. */
  readonly chatter: SocialChatter[] = [];
  /** What the notifications tab lists, oldest first. */
  readonly events: SocialEvent[] = [];
  /** Everyone met so far, by id. */
  readonly accounts = new Map<string, SocialAccount>();
  readonly player: SocialAccount = { ...PLAYER_ACCOUNT };
  writer: SocialWriter | null = null;
  camera: SocialCamera | null = null;
  private seed = 12345;
  // A stream of its own, so the everyday timeline does not change who posts the player's clips.
  private chatterSeed = 777;
  private nextId = 1;
  private nextReplyId = 1;
  private nextChatterId = 1;
  private nextChatterAt: number | null = null;
  private nextFollowAt: number | null = null;
  private readonly milestones = new WeakMap<SocialPost, number>();
  // Violations the news account has covered (once each, however many posted it).
  private readonly covered = new WeakSet<ViolationRecord>();

  constructor() {
    for (const a of [this.player, ...FOLLOWED_LIST]) this.accounts.set(a.id, a);
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    return (this.seed >>> 8) / 0x1000000;
  }

  private crand(): number {
    this.chatterSeed = (this.chatterSeed * 1103515245 + 12345) >>> 0;
    return (this.chatterSeed >>> 8) / 0x1000000;
  }

  /**
   * Maybe someone filmed it: the more people around and the worse it looked, the likelier a
   * post. Returns the post if one was made. `filmedBy` makes that pedestrian the author.
   */
  maybePost(
    record: ViolationRecord,
    witnesses: number,
    gameNow: number,
    filmedBy?: SocialWitness,
  ): SocialPost | null {
    const severity = severityOf(record);
    const chance = Math.min(0.95, severity * Math.min(1, witnesses / 3) * 1.2);
    if (witnesses === 0 || this.rand() > chance) return null;
    const account = filmedBy
      ? this.register(witnessAccount(filmedBy, gameNow))
      : this.someone(() => this.rand(), gameNow, POSTER_NEW_SHARE);
    const openers = OPENERS[record.kind] ??
      OPENERS[record.kind.replace(/\d+$/, "")] ?? ["{place}で危ない運転の車がいた"];
    const opener = fill(openers[Math.floor(this.rand() * openers.length)], record);
    const area = record.context?.place?.split(" ")[0];
    // A dashcam's clip is tagged (and often introduced) as one; a phone's is what someone saw.
    const isDashcam = cameraFor(account).kind === "dashcam";
    const text = isDashcam && this.nextId % 2 === 0 ? `ドラレコに残ってた。${opener}` : opener;
    const source = isDashcam ? "#ドラレコ" : "#目撃情報";
    const tags = [...(TAGS[record.kind] ?? ["#危険運転"]), source, ...(area ? [`#${area}`] : [])];
    // Reach spans from a few reposts to tens of thousands for the worst.
    const reach = Math.round(10 ** (0.8 + 3.6 * severity * (0.55 + 0.45 * this.rand())));
    const id = this.nextId++;
    const post: SocialPost = {
      id,
      account,
      author: account.name,
      handle: account.handle,
      text,
      tags,
      clipSeconds: 6 + (hashString(`${account.id}/${id}`) % 28),
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
      reposters: [],
      isReported: false,
    };
    this.posts.unshift(post);
    this.camera?.(post);
    void this.writer?.("post", post, 0).then((written) => {
      if (written) post.text = written;
    });
    return post;
  }

  /** Grow every post with game time; returns posts the police have just noticed. */
  update(gameNow: number): SocialPost[] {
    const noticed: SocialPost[] = [];
    for (const p of this.posts) {
      const minutes = Math.max(0, (gameNow - p.postedAt) / MINUTE);
      // Shares spread over the first minutes, then level off (compressed from hours for play).
      const spread = 1 - Math.exp(-minutes / spreadMinutes(p));
      p.reposts = Math.round(p.reach * spread);
      p.quotes = Math.round(p.reposts * 0.12);
      p.likes = Math.round(p.reposts * (3 + p.severity * 2));
      p.views = Math.round(p.likes * 38 + p.reposts * 15);
      const wantReplies = Math.min(14, Math.floor(Math.log2(1 + p.reposts) * 1.6));
      while (p.replies.length < wantReplies) {
        // When the k-th reply came: the moment the shares were enough for k of them.
        const at = whenReposts(p, 2 ** ((p.replies.length + 1) / 1.6) - 1, gameNow);
        const r = this.line(
          this.someone(() => this.rand(), gameNow),
          REPLIES,
          p,
          at,
        );
        p.replies.push(r);
        if (p.replies.length <= LLM_REPLIES)
          void this.writer?.("reply", p, p.replies.length).then((text) => {
            if (text) r.text = text;
          });
        this.maybeAnswer(p, r, gameNow);
      }
      for (const r of p.replies) r.likes = Math.round(p.likes * r.weight);
      const wantQuotes = Math.min(5, Math.floor(Math.log10(1 + p.quotes) * 2));
      while (p.quotePosts.length < wantQuotes) {
        const at = whenReposts(p, (10 ** ((p.quotePosts.length + 1) / 2) - 1) / 0.12, gameNow);
        const q = this.line(
          this.someone(() => this.rand(), gameNow),
          QUOTES,
          p,
          at,
        );
        p.quotePosts.push(q);
        if (p.quotePosts.length <= 2)
          void this.writer?.("quote", p, 100 + p.quotePosts.length).then((text) => {
            if (text) q.text = text;
          });
      }
      for (const q of p.quotePosts) q.likes = Math.round(p.likes * q.weight);
      this.spreadAmongFollowed(p, gameNow);
      this.markMilestones(p, gameNow);
      // Widely shared clips get to the police, who trace the car from the video.
      const isWide = p.reposts > 2000 || (p.severity >= 0.9 && p.reposts > 50);
      if (isWide && !p.isReported) {
        p.isReported = true;
        noticed.push(p);
        this.reportNews(p, gameNow);
      }
    }
    this.chat(gameNow);
    this.follow(gameNow);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return noticed;
  }

  /** Someone from the pool; with `newShare`, that share of the time a new (throwaway) account. */
  private someone(rand: () => number, gameNow: number, newShare = 0): SocialAccount {
    const wantsNew = newShare > 0 && rand() < newShare;
    let seed = Math.floor(rand() * ACCOUNT_POOL);
    // New accounts are the ones the avatar mix leaves with the default picture: walk to the next.
    if (wantsNew)
      for (let i = 0; i < 60 && avatarFor(`u${seed}`).kind !== "default"; i++)
        seed = (seed + 1) % ACCOUNT_POOL;
    return this.accounts.get(`u${seed}`) ?? this.register(accountFor(seed, gameNow));
  }

  private register(a: SocialAccount): SocialAccount {
    const known = this.accounts.get(a.id);
    if (known) return known;
    this.accounts.set(a.id, a);
    return a;
  }

  private line(account: SocialAccount, pool: readonly string[], p: SocialPost, at: number): SocialReply {
    return {
      id: this.nextReplyId++,
      account,
      author: account.name,
      handle: account.handle,
      text: fill(pool[Math.floor(this.rand() * pool.length)], p.record),
      atMinute: Math.round((at - p.postedAt) / MINUTE),
      postedAt: at,
      // Most replies get a few likes, one or two get many.
      weight: 0.002 + 0.04 * this.rand() ** 3,
      likes: 0,
    };
  }

  /** Now and then the poster answers a reply (twice at most). */
  private maybeAnswer(p: SocialPost, r: SocialReply, gameNow: number): void {
    const isPoster = r.account === p.account;
    const answered = p.replies.filter((x) => x.account === p.account).length;
    if (isPoster || answered >= 2 || this.rand() > 0.3) return;
    const at = Math.min(gameNow, r.postedAt + (1 + this.rand() * 6) * MINUTE);
    p.replies.push({ ...this.line(p.account, ANSWERS, p, at), replyTo: r.id });
  }

  /** People the player follows repost it as it spreads (one per tenfold). */
  private spreadAmongFollowed(p: SocialPost, gameNow: number): void {
    const want = Math.min(3, Math.floor(Math.log10(1 + p.reposts)));
    while (p.reposters.length < want) {
      const pool = FOLLOWED_LIST.filter(
        (a) => a !== FOLLOWED.news && !p.reposters.some((r) => r.account === a),
      );
      const account = pool[Math.floor(this.rand() * pool.length)];
      p.reposters.push({ account, at: whenReposts(p, 10 ** (p.reposters.length + 1) - 1, gameNow) });
    }
  }

  private markMilestones(p: SocialPost, gameNow: number): void {
    const shown = this.milestones.get(p) ?? 0;
    for (const n of MILESTONES) {
      const isNew = n > shown && p.reposts >= n;
      if (!isNew) continue;
      this.milestones.set(p, n);
      const at = whenReposts(p, n, gameNow);
      this.events.push(
        n === MILESTONES[0] ? { kind: "trend", at, post: p } : { kind: "milestone", at, post: p, count: n },
      );
    }
  }

  /** The news account picks up a clip the police now know of. */
  private reportNews(p: SocialPost, gameNow: number): void {
    if (this.covered.has(p.record)) return;
    this.covered.add(p.record);
    const place = p.record.context?.place?.split(" ").slice(0, 2).join("") || "都内";
    const what = p.record.label.replace(/（.*?）/g, "");
    const news = FOLLOWED.news;
    const quote: SocialReply = {
      id: this.nextReplyId++,
      account: news,
      author: news.name,
      handle: news.handle,
      text: `【話題】${place}で撮影された「${what}」の車の動画が拡散しています。警察も情報を把握しているとみられます`,
      atMinute: Math.round((gameNow - p.postedAt) / MINUTE),
      postedAt: gameNow,
      weight: 0.06,
      likes: 0,
    };
    p.quotePosts.push(quote);
    this.events.push({ kind: "news", at: gameNow, post: p, quote });
  }

  /** Everyone else's posts: a few hours' worth at first, then one every few minutes. */
  private chat(gameNow: number): void {
    const isJump = this.nextChatterAt !== null && Math.abs(gameNow - this.nextChatterAt) > 3 * HOUR;
    if (this.nextChatterAt === null || isJump) {
      // Game time can be set back (a new day, a time preset): what is "later" than now goes.
      for (let i = this.chatter.length - 1; i >= 0; i--)
        if (this.chatter[i].postedAt > gameNow) this.chatter.splice(i, 1);
      this.nextChatterAt = Math.max(gameNow - 3 * HOUR, this.chatter[0]?.postedAt ?? -Infinity) + 5 * MINUTE;
    }
    while (this.nextChatterAt <= gameNow) {
      this.chatOnce(this.nextChatterAt);
      this.nextChatterAt += (4 + this.crand() * 10) * MINUTE;
    }
    if (this.chatter.length > MAX_CHATTER) this.chatter.length = MAX_CHATTER;
    for (const c of this.chatter) {
      const spread = 1 - Math.exp(-Math.max(0, gameNow - c.postedAt) / (45 * MINUTE));
      c.likes = Math.round(c.reach * spread);
      c.reposts = Math.round(c.likes * 0.08);
      c.views = Math.round(c.likes * 40 + c.reach * 6 * spread);
    }
  }

  private chatOnce(at: number): void {
    const hour = jstParts(at).hour;
    const fits = CHATTER.filter((c) => !c.hours || (hour >= c.hours[0] && hour < c.hours[1]));
    let c = fits[Math.floor(this.crand() * fits.length)];
    if (c.text === this.chatter[0]?.text) c = fits[(fits.indexOf(c) + 1) % fits.length];
    const account = c.who ? FOLLOWED[c.who] : this.someone(() => this.crand(), at);
    this.chatter.unshift({
      id: this.nextChatterId++,
      account,
      text: c.text,
      picture: c.picture ? { motif: c.picture, hue: Math.floor(this.crand() * 360) } : undefined,
      postedAt: at,
      reach: Math.round(Math.max(2, account.followers * (0.003 + this.crand() * 0.02))),
      likes: 0,
      reposts: 0,
      views: 0,
    });
  }

  /** Now and then someone follows the player (people follow anyone). */
  private follow(gameNow: number): void {
    const isJump = this.nextFollowAt !== null && Math.abs(gameNow - this.nextFollowAt) > 3 * HOUR;
    if (this.nextFollowAt === null || isJump) this.nextFollowAt = gameNow + (5 + this.crand() * 20) * MINUTE;
    while (this.nextFollowAt <= gameNow) {
      const account = this.someone(() => this.crand(), this.nextFollowAt);
      this.player.followers++;
      this.events.push({ kind: "follow", at: this.nextFollowAt, account });
      this.nextFollowAt += (15 + this.crand() * 40) * MINUTE;
    }
  }
}

/** Minutes for a post's shares to get most of the way (worse clips spread faster). */
const spreadMinutes = (p: SocialPost) => 2 + 6 * (1 - p.severity);

/** Game time when a post's reposts reached `n` (no later than now). */
function whenReposts(p: SocialPost, n: number, gameNow: number): number {
  const share = Math.max(0, n) / p.reach;
  if (share >= 1) return gameNow;
  const at = p.postedAt - spreadMinutes(p) * Math.log(1 - share) * MINUTE;
  return Math.min(gameNow, at);
}

/** Replies a post shows it has: those written out plus the many nobody opens. */
export const replyCountOf = (p: SocialPost) => p.replies.length + Math.round(p.reposts * 0.2);

/**
 * Counts the way the app shows them: 3,456 / 1.2万 / 12.3万 / 123万 / 1.2億. Cut, not rounded
 * (99,999 is 9.9万, never 10.0万).
 */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.floor(n));
  // Why a fixed locale: the grouping must not depend on the machine (tests, players abroad).
  if (v < 10_000) return v.toLocaleString("en-US");
  const [unit, size] = v >= 100_000_000 ? (["億", 100_000_000] as const) : (["万", 10_000] as const);
  const tenths = Math.floor((v * 10) / size);
  const shown = tenths < 1000 ? tenths / 10 : Math.floor(tenths / 10);
  return `${shown}${unit}`;
}

/** Year … second of a game time in Japan (JST, no daylight saving). */
export function jstParts(ms: number) {
  const d = new Date(ms + 9 * HOUR);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** たった今 / 3分 / 2時間 / 10月4日 / 2025年12月31日, as a timeline row shows a post's age. */
export function relativeTime(thenMs: number, nowMs: number): string {
  const s = Math.floor((nowMs - thenMs) / 1000);
  if (s < 60) return "たった今";
  if (s < 3600) return `${Math.floor(s / 60)}分`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間`;
  const d = jstParts(thenMs);
  const isThisYear = d.year === jstParts(nowMs).year;
  return isThisYear ? `${d.month}月${d.day}日` : `${d.year}年${d.month}月${d.day}日`;
}

/** 午前11:30 · 2026年10月5日, as an opened post shows its time. */
export function postTimestamp(ms: number): string {
  const d = jstParts(ms);
  const half = d.hour < 12 ? "午前" : "午後";
  return `${half}${d.hour % 12}:${String(d.minute).padStart(2, "0")} · ${d.year}年${d.month}月${d.day}日`;
}
