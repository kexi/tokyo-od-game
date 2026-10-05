import { getLocale } from "../i18n";
import { st, stCount, type SocialMessageKey } from "../i18n/socialMessages";
import {
  followLocale,
  formatCount,
  joinedLabel,
  jstParts,
  originalOf,
  postTimestamp,
  relativeTime,
  replyCountOf,
  type SocialChatter,
  type SocialEvent,
  type SocialFeed,
  type SocialPost,
  type SocialReply,
} from "./social";
import { FOLLOWED_LIST, hashString, type PictureMotif, type SocialAccount } from "./socialAccounts";
import { avatarElement, bannerUrl, pictureUrl } from "./socialAvatars";
import { icon, pathIcon, type IconName } from "./socialIcons";
import { localize, WARD_NAMES } from "./socialTexts";
import { SOCIAL_APP_NAME, SOCIAL_BADGE_PATHS, SOCIAL_LOGO_PATH, SOCIAL_THEME } from "./socialTheme";

/**
 * Y on the phone, laid out the way people know microblogging apps: a dark timeline
 * (おすすめ / フォロー中) of rows — avatar on the left, name, @handle · time, text, the clip or
 * photo, a quoted post in a card, and the reply / repost / like / views / bookmark / share row —
 * a floating post button, a tab bar (home, search, notifications, messages), opened posts with
 * their thread of replies, profile pages with banner and bio, and notifications. The name, logo,
 * badge and icons are the game's own (socialTheme.ts, socialIcons.ts).
 *
 * The app keeps its DOM between refreshes: rows are kept by key and only their counts, times and
 * text are updated, so scrolling, images and the like animation survive the once-a-second refresh.
 *
 * Its words follow the UI's language (src/i18n/socialMessages.ts), and so do the posts (the feed
 * writes them again, social.ts followLocale): a switch rebuilds the screen on show, keeping the
 * scroll. An opened post that was translated says so and can show its Japanese original.
 */

const T = SOCIAL_THEME;
const HOUR = 3_600_000;
const APP = { app: SOCIAL_APP_NAME };
const readOnly = () => st("readOnly");
/** A bio or a place someone wrote, in the UI's language (wards by their names, the rest translated). */
const ownWords = (text: string) => {
  const lang = getLocale();
  const isJapanese = lang === "ja";
  if (isJapanese) return text;
  return WARD_NAMES[text]?.[lang] ?? localize(text, lang);
};
/**
 * A template with a slot for an element (a bold name, a link): the text around the slot as text
 * nodes, so the element sits where each language puts it (「{name}さんが…」, "{name} posted …").
 */
function around(template: string, slot: string, el: Node): (Node | string)[] {
  const [before, after = ""] = template.split(`{${slot}}`);
  return [before, el, after].filter((part) => part !== "");
}

type Stats = {
  replies: number;
  reposts: number;
  quotes: number;
  likes: number;
  views: number;
  bookmarks: number;
};
type Media =
  | {
      kind: "clip";
      src: () => string | undefined;
      aspect: () => number;
      seconds: number;
      /** A still from the poster's camera (a photo post): no ▶, no length, never played. */
      still?: boolean;
    }
  | { kind: "picture"; key: string; motif: PictureMotif; hue: number };
type Target =
  | { kind: "post"; post: SocialPost }
  | { kind: "reply"; post: SocialPost; reply: SocialReply }
  | { kind: "quote"; post: SocialPost; quote: SocialReply }
  | { kind: "chatter"; chatter: SocialChatter }
  | { kind: "chatterReply"; chatter: SocialChatter; reply: SocialReply };
/** One post as the app shows it, whatever it came from. */
type Card = {
  key: string;
  account: SocialAccount;
  at: number;
  text: () => string;
  tags: () => readonly string[];
  /** The Japanese it was translated from (with its tags); null when shown as written. */
  original: () => { text: string; tags: readonly string[] } | null;
  media?: Media;
  quoted?: Card;
  replyingTo?: SocialAccount;
  stats: () => Stats;
  target: Target;
};
type Row = { el: HTMLElement; update: (now: number) => void };
type Entry = { key: string; at: number; score: number; account?: SocialAccount; make: () => Row };
type RowOptions = {
  repostedBy?: SocialAccount;
  threadUp?: boolean;
  threadDown?: () => boolean;
  replyingTo?: boolean;
};

type HomeTab = "foryou" | "following";
type NoteTab = "all" | "vouched" | "mentions";
type ProfileTab = "posts" | "replies" | "media" | "likes";
type Route =
  | { page: "home"; tab: HomeTab; scroll: number; order?: string[] }
  | { page: "search"; tab: number; scroll: number }
  | { page: "notifications"; tab: NoteTab; scroll: number }
  | { page: "messages"; scroll: number }
  | { page: "post"; target: Target; scroll: number; order?: string[] }
  | { page: "engagements"; post: SocialPost; tab: "quotes" | "reposts"; scroll: number }
  | { page: "profile"; account: SocialAccount; tab: ProfileTab; scroll: number };
type Page = { el: HTMLElement; sync: (now: number) => void };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...children);
  return e;
}

const setText = (e: Element, t: string) => {
  if (e.textContent !== t) e.textContent = t;
};
/** Counts as the action row shows them: nothing at zero. */
const countText = (n: number) => (n > 0 ? formatCount(n) : "");
const clipLength = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const toggleIn = (set: Set<string>, key: string) => {
  const isOn = set.has(key);
  if (isOn) set.delete(key);
  else set.add(key);
  return !isOn;
};

/** The original of a text with no tags of its own (replies, quotes, everyday posts). */
const untagged = (item: SocialReply | SocialChatter) => () => {
  const text = originalOf(item);
  return text === null ? null : { text, tags: [] };
};
const noTags = () => [];

/** Text with #tags and @handles in the accent colour (all through textContent). */
function richText(target: HTMLElement, text: string, tags: readonly string[]): void {
  const full = tags.length > 0 ? `${text}\n${tags.join(" ")}` : text;
  const parts = full.split(/([#＃][^\s#＃]+|@[A-Za-z0-9_]{1,15})/u);
  target.replaceChildren(
    ...parts.map((s, i) => (i % 2 === 1 ? h("span", "sns-link", s) : document.createTextNode(s))),
  );
}

// ---------- cards ----------

function postCard(p: SocialPost): Card {
  // Only the poster's own shot (a passer-by's eye), never the driver's screen; an empty frame
  // until it is developed. A words-only post has none.
  const media: Media | undefined =
    p.media === "text"
      ? undefined
      : {
          kind: "clip",
          src: () => p.photo,
          aspect: () => (p.photo ? (p.photoAspect ?? 16 / 9) : 16 / 9),
          seconds: p.clipSeconds,
          still: p.media === "photo",
        };
  return {
    key: `p${p.id}`,
    account: p.account,
    at: p.postedAt,
    text: () => p.text,
    tags: () => p.tags,
    original: () => {
      const text = originalOf(p);
      return text === null ? null : { text, tags: p.tagsJa };
    },
    media,
    stats: () => ({
      replies: replyCountOf(p),
      reposts: p.reposts,
      likes: p.likes,
      views: p.views,
      bookmarks: Math.round(p.likes * 0.04),
      quotes: p.quotes,
    }),
    target: { kind: "post", post: p },
  };
}

function quoteCard(p: SocialPost, q: SocialReply): Card {
  return {
    key: `q${p.id}-${q.id}`,
    account: q.account,
    at: q.postedAt,
    text: () => q.text,
    tags: noTags,
    original: untagged(q),
    quoted: postCard(p),
    stats: () => ({
      replies: Math.round(q.likes * 0.04),
      reposts: Math.round(q.likes * 0.12),
      likes: q.likes,
      views: q.likes * 36 + 40,
      bookmarks: Math.round(q.likes * 0.02),
      quotes: Math.round(q.likes * 0.01),
    }),
    target: { kind: "quote", post: p, quote: q },
  };
}

function replyCard(p: SocialPost, r: SocialReply): Card {
  const parent = r.replyTo === undefined ? undefined : p.replies.find((x) => x.id === r.replyTo);
  return {
    key: `r${p.id}-${r.id}`,
    account: r.account,
    at: r.postedAt,
    text: () => r.text,
    tags: noTags,
    original: untagged(r),
    replyingTo: parent?.account ?? p.account,
    stats: () => ({
      replies: p.replies.filter((x) => x.replyTo === r.id).length,
      reposts: Math.round(r.likes * 0.05),
      likes: r.likes,
      views: r.likes * 30 + 25 + ((r.id * 37) % 200),
      bookmarks: 0,
      quotes: 0,
    }),
    target: { kind: "reply", post: p, reply: r },
  };
}

function chatterCard(c: SocialChatter): Card {
  return {
    key: `c${c.id}`,
    account: c.account,
    at: c.postedAt,
    text: () => c.text,
    tags: noTags,
    original: untagged(c),
    media: c.picture
      ? { kind: "picture", key: `c${c.id}`, motif: c.picture.motif, hue: c.picture.hue }
      : undefined,
    stats: () => ({
      replies: c.replies.length,
      reposts: c.reposts,
      likes: c.likes,
      views: c.views,
      bookmarks: Math.round(c.likes * 0.03),
      quotes: Math.round(c.likes * 0.01),
    }),
    target: { kind: "chatter", chatter: c },
  };
}

function chatterReplyCard(c: SocialChatter, r: SocialReply): Card {
  const parent = r.replyTo === undefined ? undefined : c.replies.find((x) => x.id === r.replyTo);
  return {
    key: `cr${c.id}-${r.id}`,
    account: r.account,
    at: r.postedAt,
    text: () => r.text,
    tags: noTags,
    original: untagged(r),
    replyingTo: parent?.account ?? c.account,
    stats: () => ({
      replies: c.replies.filter((x) => x.replyTo === r.id).length,
      reposts: Math.round(r.likes * 0.05),
      likes: r.likes,
      views: r.likes * 30 + 12 + ((r.id * 37) % 90),
      bookmarks: 0,
      quotes: 0,
    }),
    target: { kind: "chatterReply", chatter: c, reply: r },
  };
}

function cardOf(t: Target): Card {
  if (t.kind === "post") return postCard(t.post);
  if (t.kind === "reply") return replyCard(t.post, t.reply);
  if (t.kind === "quote") return quoteCard(t.post, t.quote);
  if (t.kind === "chatterReply") return chatterReplyCard(t.chatter, t.reply);
  return chatterCard(t.chatter);
}

/** Replies to `parentId` (the post itself when undefined) by others than the poster. */
const repliesTo = (p: SocialPost, parentId: number | undefined) =>
  p.replies.filter((r) => r.replyTo === parentId && r.account !== p.account);
/** Everything that answers reply `r`. */
const answersTo = (p: SocialPost, r: SocialReply) => p.replies.filter((a) => a.replyTo === r.id);

/** おすすめ order: liked and recent first, and what is about the player's driving most of all. */
const scoreOf = (likes: number, at: number, now: number, bonus: number) =>
  bonus + Math.log10(1 + likes) * 0.6 - ((now - at) / HOUR) * 0.8;

/**
 * Keeps `list` showing `entries` in order: rows are made once per key and updated after that, and
 * the DOM is only reordered when the order changed.
 */
function syncList(list: HTMLElement, rows: Map<string, Row>, entries: readonly Entry[], now: number): void {
  const seen = new Set<string>();
  const els = entries.map((e) => {
    seen.add(e.key);
    let row = rows.get(e.key);
    if (!row) {
      row = e.make();
      rows.set(e.key, row);
    }
    row.update(now);
    return row.el;
  });
  for (const key of rows.keys()) if (!seen.has(key)) rows.delete(key);
  const isSame = els.length === list.children.length && els.every((el, i) => list.children[i] === el);
  if (!isSame) list.replaceChildren(...els);
}

const staticRow = (el: HTMLElement): Row => ({ el, update: () => undefined });

/** The tab bar: page, icon, label. */
const NAV = [
  ["home", "home", "nav.home"],
  ["search", "search", "nav.search"],
  ["notifications", "bell", "nav.notifications"],
  ["messages", "mail", "nav.messages"],
] as const satisfies readonly (readonly [string, IconName, SocialMessageKey])[];

function emptyEntry(title: string, body: string): Entry {
  return {
    key: "empty",
    at: 0,
    score: 0,
    make: () => staticRow(h("div", "sns-empty", h("h3", "", title), h("p", "", body))),
  };
}

export class SocialApp {
  /** Plays a post's video in the game (its replay from the poster's spot); false when it cannot. */
  playVideo: ((postId: number) => boolean) | null = null;
  private readonly stage = h("div", "sns-stage");
  private readonly clock = h("span", "sns-clock");
  private readonly nav = h("nav", "sns-nav");
  private readonly navButtons = new Map<string, { b: HTMLButtonElement; name: IconName }>();
  private readonly bellBadge = h("span", "sns-nav-badge");
  private stack: Route[] = [];
  private page: Page | null = null;
  private readonly liked = new Set<string>();
  private readonly likedCards = new Map<string, Card>();
  private readonly reposted = new Set<string>();
  private readonly bookmarked = new Set<string>();
  private readonly followed = new Set<string>(FOLLOWED_LIST.map((a) => a.id));
  private readonly hiddenKeys = new Set<string>();
  private notesSeenAt = -Infinity;
  private snackTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly feed: SocialFeed,
    private readonly now: () => number,
  ) {
    root.classList.add("sns");
    const vars: Record<string, string> = {
      "--sns-bg": T.background,
      "--sns-surface": T.surface,
      "--sns-line": T.hairline,
      "--sns-text": T.text,
      "--sns-sub": T.secondary,
      "--sns-accent": T.accent,
      "--sns-like": T.like,
      "--sns-repost": T.repost,
      "--sns-badge": T.badge,
      "--sns-notice": T.notice,
      "--sns-raised": T.raised,
      "--sns-font": T.font,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    const status = h(
      "div",
      "sns-status",
      this.clock,
      h("span", "sns-status-icons", icon("signal"), icon("wifi"), icon("battery")),
    );
    for (const [page, name, label] of NAV) {
      const b = h("button", "sns-nav-item");
      b.type = "button";
      b.setAttribute("aria-label", st(label));
      b.addEventListener("click", () => this.tab(page));
      if (page === "notifications") b.append(this.bellBadge);
      this.navButtons.set(page, { b, name });
      this.nav.append(b);
    }
    root.replaceChildren(status, this.stage, this.nav);
    followLocale(feed, () => this.relabel());
  }

  /**
   * After a language switch (the feed has rewritten its posts): the tab bar's labels, and the
   * screen built again where the player was. Why rebuild rather than relabel each node: every
   * screen is built from its route in one place, so building it again covers all of its words.
   */
  private relabel(): void {
    for (const [page, , label] of NAV) this.navButtons.get(page)?.b.setAttribute("aria-label", st(label));
    if (!this.page) return;
    this.route.scroll = this.page.el.scrollTop;
    this.show();
  }

  /** Opens the app on the home timeline (top, newest order). */
  open(): void {
    this.stack = [{ page: "home", tab: "foryou", scroll: 0 }];
    this.show();
  }

  /** A post's own screen (from a notification), with the timeline under it for ←. */
  openPost(post: SocialPost): void {
    this.stack = [
      { page: "home", tab: "foryou", scroll: 0 },
      { page: "post", target: { kind: "post", post }, scroll: 0 },
    ];
    this.show();
  }

  /** Re-reads the feed (counts, times, new posts); call while the app is on screen. */
  refresh(): void {
    if (!this.page) return this.open();
    const now = this.now();
    this.page.sync(now);
    this.chrome(now);
  }

  /** One screen back; false when already at a tab's first screen. */
  back(): boolean {
    if (this.stack.length <= 1) return false;
    this.stack.pop();
    this.show();
    return true;
  }

  // ---------- navigation ----------

  private get route(): Route {
    return this.stack[this.stack.length - 1];
  }

  private go(route: Route): void {
    if (this.page) this.route.scroll = this.page.el.scrollTop;
    this.stack.push(route);
    this.show();
  }

  private tab(page: "home" | "search" | "notifications" | "messages"): void {
    const isSameTab = this.stack.length === 1 && this.route.page === page;
    // Tapping the tab you are on scrolls back to the top, as the app does.
    if (isSameTab && this.page) return this.page.el.scrollTo({ top: 0, behavior: "smooth" });
    const fresh: Route =
      page === "home"
        ? { page, tab: "foryou", scroll: 0 }
        : page === "search"
          ? { page, tab: 0, scroll: 0 }
          : page === "notifications"
            ? { page, tab: "all", scroll: 0 }
            : { page, scroll: 0 };
    this.stack = [fresh];
    this.show();
  }

  private openCard(card: Card): void {
    const t = card.target;
    const isSame =
      this.route.page === "post" && cardOf(this.route.target).key === card.key && this.stack.length > 0;
    if (isSame) return;
    this.go({ page: "post", target: t, scroll: 0 });
  }

  private openProfile(account: SocialAccount): void {
    const isSame = this.route.page === "profile" && this.route.account.id === account.id;
    if (isSame) return;
    this.go({ page: "profile", account, tab: "posts", scroll: 0 });
  }

  private show(): void {
    const route = this.route;
    const overlays: HTMLElement[] = [];
    this.page = this.build(route, overlays);
    this.stage.replaceChildren(this.page.el, ...overlays);
    const now = this.now();
    this.page.sync(now);
    this.page.el.scrollTop = route.scroll;
    if (route.page === "notifications") this.notesSeenAt = now;
    this.chrome(now);
  }

  /** Status bar clock, the tab bar's active tab and the notifications count. */
  private chrome(now: number): void {
    const d = jstParts(now);
    setText(this.clock, `${d.hour}:${String(d.minute).padStart(2, "0")}`);
    const root = this.stack[0]?.page;
    for (const [page, { b, name }] of this.navButtons) {
      const isOn = page === root;
      const wasOn = b.classList.contains("on");
      if (isOn === wasOn && b.firstElementChild?.tagName === "svg") continue;
      b.classList.toggle("on", isOn);
      const badge = page === "notifications" ? [this.bellBadge] : [];
      b.replaceChildren(icon(name, isOn), ...badge);
    }
    if (this.route.page === "notifications") this.notesSeenAt = now;
    const unseen = this.feed.events.filter((e) => e.at > this.notesSeenAt && e.at <= now).length;
    this.bellBadge.hidden = unseen === 0;
    setText(this.bellBadge, unseen > 20 ? "20+" : String(unseen));
  }

  private build(route: Route, overlays: HTMLElement[]): Page {
    switch (route.page) {
      case "home":
        return this.homePage(route, overlays);
      case "post":
        return this.postPage(route);
      case "engagements":
        return this.engagementsPage(route);
      case "profile":
        return this.profilePage(route, overlays);
      case "notifications":
        return this.notificationsPage(route, overlays);
      case "search":
        return this.searchPage(route, overlays);
      case "messages":
        return this.messagesPage();
    }
  }

  // ---------- pages ----------

  private homePage(route: Extract<Route, { page: "home" }>, overlays: HTMLElement[]): Page {
    const bar = h("div", "sns-topbar home", this.avatarButton(this.feed.player, 32));
    const logo = pathIcon(SOCIAL_LOGO_PATH, "sns-logo");
    logo.setAttribute("aria-label", SOCIAL_APP_NAME);
    bar.append(logo);
    const header = h(
      "header",
      "sns-header",
      bar,
      this.tabs(
        [
          ["foryou", st("home.forYou")],
          ["following", st("home.following")],
        ],
        route.tab,
        (t) => {
          route.tab = t;
          route.order = undefined;
          route.scroll = 0;
          this.show();
        },
      ),
    );
    const el = h("div", "sns-page", header);
    const list = h("div", "sns-list");
    list.id = "social-feed";
    el.append(list);
    const pill = h("button", "sns-new-pill");
    pill.type = "button";
    pill.hidden = true;
    overlays.push(pill, this.fab());
    const rows = new Map<string, Row>();
    let pending: Entry[] = [];
    let pillKeys = "";
    const sync = (now: number) => {
      const entries = this.homeEntries(route.tab, now);
      const byKey = new Map(entries.map((e) => [e.key, e]));
      route.order ??= entries
        .toSorted((a, b) => (route.tab === "foryou" ? b.score - a.score : b.at - a.at))
        .map((e) => e.key);
      const known = new Set(route.order);
      const fresh = entries.filter((e) => !known.has(e.key)).toSorted((a, b) => b.at - a.at);
      // New posts slot in at the top while you are there; further down they wait behind the pill.
      const isAtTop = el.scrollTop < 8;
      if (fresh.length > 0 && isAtTop) route.order = [...fresh.map((e) => e.key), ...route.order];
      pending = isAtTop ? [] : fresh;
      pill.hidden = pending.length === 0;
      const keys = pending.map((e) => e.key).join();
      if (keys !== pillKeys) {
        pillKeys = keys;
        const faces = [
          ...new Set(pending.map((e) => e.account).filter((a): a is SocialAccount => !!a)),
        ].slice(0, 3);
        pill.replaceChildren(
          icon("up"),
          h("span", "sns-pill-faces", ...faces.map((a) => avatarElement(a, 22))),
          st("home.newPosts"),
        );
      }
      const shown = route.order.map((k) => byKey.get(k)).filter((e): e is Entry => !!e);
      const empty =
        route.tab === "following"
          ? emptyEntry(st("home.emptyFollowing"), st("home.emptyFollowingBody"))
          : emptyEntry(st("home.welcome", APP), st("home.welcomeBody"));
      syncList(list, rows, shown.length > 0 ? shown : [empty], now);
    };
    pill.addEventListener("click", () => {
      if (route.order) route.order = [...pending.map((e) => e.key), ...route.order];
      pending = [];
      el.scrollTo({ top: 0, behavior: "smooth" });
      sync(this.now());
    });
    return { el, sync };
  }

  private homeEntries(tab: HomeTab, now: number): Entry[] {
    const out: Entry[] = [];
    const row = (card: Card, score: number, at = card.at, opts: RowOptions = {}) =>
      out.push({ key: card.key, at, score, account: card.account, make: () => this.timelineRow(card, opts) });
    if (tab === "foryou") {
      for (const p of this.feed.posts) {
        const card = postCard(p);
        row(card, scoreOf(p.likes, p.postedAt, now, 2.5), p.postedAt, {
          repostedBy: p.reposters.at(-1)?.account,
        });
        for (const q of p.quotePosts) row(quoteCard(p, q), scoreOf(q.likes, q.postedAt, now, 1));
      }
      for (const c of this.feed.chatter) row(chatterCard(c), scoreOf(c.likes, c.postedAt, now, 0));
    } else {
      for (const c of this.feed.chatter) if (this.followed.has(c.account.id)) row(chatterCard(c), 0);
      for (const p of this.feed.posts) {
        const by = p.reposters.filter((r) => this.followed.has(r.account.id)).at(-1);
        const isOwn = this.followed.has(p.account.id);
        if (by || isOwn)
          row(postCard(p), 0, by?.at ?? p.postedAt, { repostedBy: isOwn ? undefined : by?.account });
        for (const q of p.quotePosts) if (this.followed.has(q.account.id)) row(quoteCard(p, q), 0);
      }
    }
    return out.filter((e) => !this.hiddenKeys.has(e.key));
  }

  private postPage(route: Extract<Route, { page: "post" }>): Page {
    const el = h("div", "sns-page", h("header", "sns-header", this.subbar(st("post.title"))));
    const list = h("div", "sns-list");
    el.append(list);
    const rows = new Map<string, Row>();
    return { el, sync: (now) => syncList(list, rows, this.threadEntries(route), now) };
  }

  /** An opened post: what it answers (with the thread line), the post itself, then its replies. */
  private threadEntries(route: Extract<Route, { page: "post" }>): Entry[] {
    const t = route.target;
    const out: Entry[] = [];
    const add = (key: string, make: () => Row) => out.push({ key, at: 0, score: 0, make });
    const focus = cardOf(t);
    if (t.kind === "reply") {
      const p = t.post;
      const parent =
        t.reply.replyTo === undefined ? undefined : p.replies.find((r) => r.id === t.reply.replyTo);
      add(`up-p${p.id}`, () => this.timelineRow(postCard(p), { threadDown: () => true }));
      if (parent)
        add(`up-r${parent.id}`, () =>
          this.timelineRow(replyCard(p, parent), { threadUp: true, threadDown: () => true }),
        );
    }
    if (t.kind === "chatterReply") {
      const c = t.chatter;
      const parent =
        t.reply.replyTo === undefined ? undefined : c.replies.find((r) => r.id === t.reply.replyTo);
      add(`up-c${c.id}`, () => this.timelineRow(chatterCard(c), { threadDown: () => true }));
      if (parent)
        add(`up-r${parent.id}`, () =>
          this.timelineRow(chatterReplyCard(c, parent), { threadUp: true, threadDown: () => true }),
        );
    }
    const isReply = t.kind === "reply" || t.kind === "chatterReply";
    add("focus", () => this.detailRow(focus, isReply));
    if (t.kind === "post")
      add("engage", () => {
        const b = h("button", "sns-linkrow", st("post.engagementsLink"), icon("back"));
        b.type = "button";
        b.addEventListener("click", () =>
          this.go({ page: "engagements", post: t.post, tab: "quotes", scroll: 0 }),
        );
        return staticRow(b);
      });
    add("composer", () => this.composer());
    if (t.kind === "post") {
      const p = t.post;
      const top = p.replies.filter((r) => r.replyTo === undefined);
      // The most liked first when opened; later replies go below (no reshuffling while you read).
      route.order ??= top.toSorted((a, b) => b.likes - a.likes).map((r) => `r${r.id}`);
      const known = new Set(route.order);
      for (const r of top) if (!known.has(`r${r.id}`)) route.order.push(`r${r.id}`);
      for (const key of route.order) {
        const r = top.find((x) => `r${x.id}` === key);
        if (!r) continue;
        add(key, () => this.timelineRow(replyCard(p, r), { threadDown: () => answersTo(p, r).length > 0 }));
        for (const a of answersTo(p, r))
          add(`r${a.id}`, () => this.timelineRow(replyCard(p, a), { threadUp: true }));
      }
      if (top.length === 0) out.push(emptyEntry(st("post.noReplies"), st("post.noRepliesBody")));
    }
    if (t.kind === "reply")
      for (const a of [...repliesTo(t.post, t.reply.id), ...answersTo(t.post, t.reply)].filter(
        (x, i, all) => all.indexOf(x) === i,
      ))
        add(`r${a.id}`, () => this.timelineRow(replyCard(t.post, a)));
    if (t.kind === "chatter") this.chatterThread(t.chatter, add);
    if (t.kind === "chatterReply")
      for (const a of t.chatter.replies.filter((x) => x.replyTo === t.reply.id))
        add(`r${a.id}`, () => this.timelineRow(chatterReplyCard(t.chatter, a)));
    return out;
  }

  /** The replies under an everyday post, each with the poster's answer below it. */
  private chatterThread(c: SocialChatter, add: (key: string, make: () => Row) => void): void {
    const top = c.replies.filter((r) => r.replyTo === undefined).toSorted((a, b) => a.postedAt - b.postedAt);
    for (const r of top) {
      const answers = c.replies.filter((a) => a.replyTo === r.id);
      add(`r${r.id}`, () =>
        this.timelineRow(chatterReplyCard(c, r), {
          threadDown: () => c.replies.some((a) => a.replyTo === r.id),
        }),
      );
      for (const a of answers)
        add(`r${a.id}`, () => this.timelineRow(chatterReplyCard(c, a), { threadUp: true }));
    }
    if (top.length === 0)
      add("none", () => emptyEntry(st("post.noReplies"), st("post.noRepliesBody")).make());
  }

  private engagementsPage(route: Extract<Route, { page: "engagements" }>): Page {
    const header = h(
      "header",
      "sns-header",
      this.subbar(st("engage.title")),
      this.tabs(
        [
          ["quotes", st("engage.quotes")],
          ["reposts", st("engage.reposts")],
        ],
        route.tab,
        (t) => {
          route.tab = t;
          route.scroll = 0;
          this.show();
        },
      ),
    );
    const el = h("div", "sns-page", header);
    const list = h("div", "sns-list");
    el.append(list);
    const rows = new Map<string, Row>();
    const p = route.post;
    return {
      el,
      sync: (now) => {
        const entries: Entry[] =
          route.tab === "quotes"
            ? p.quotePosts.map((q) => {
                const card = quoteCard(p, q);
                return { key: card.key, at: q.postedAt, score: 0, make: () => this.timelineRow(card) };
              })
            : this.repostersOf(p).map((a) => ({ key: a.id, at: 0, score: 0, make: () => this.personRow(a) }));
        const empty =
          route.tab === "quotes"
            ? emptyEntry(st("engage.noQuotes"), st("engage.noQuotesBody"))
            : emptyEntry(st("engage.noReposts"), st("engage.noRepostsBody"));
        syncList(list, rows, entries.length > 0 ? entries.toSorted((a, b) => b.at - a.at) : [empty], now);
      },
    };
  }

  /** Who reposted: the people the player follows, then a sample of everyone else. */
  private repostersOf(p: SocialPost): SocialAccount[] {
    const others = [...this.feed.accounts.values()]
      .filter((a) => a !== this.feed.player && a !== p.account && !p.reposters.some((r) => r.account === a))
      .toSorted((a, b) => hashString(`${p.id}/${a.id}`) - hashString(`${p.id}/${b.id}`));
    const count = Math.min(p.reposts, 12);
    return [...p.reposters.map((r) => r.account), ...others].slice(0, count);
  }

  private profilePage(route: Extract<Route, { page: "profile" }>, overlays: HTMLElement[]): Page {
    const a = route.account;
    const isMe = a === this.feed.player;
    const banner = h("div", "sns-banner");
    const url = bannerUrl(a);
    if (url) banner.style.backgroundImage = `url("${url}")`;
    if (this.stack.length > 1)
      banner.append(this.roundButton("back", st("back"), () => this.back(), "sns-float-back"));
    const actions = h(
      "div",
      "sns-profile-actions",
      this.roundButton("more", st("more"), () => this.moreSheet(null, a)),
    );
    if (isMe) {
      const edit = h("button", "sns-pill outline", st("profile.edit"));
      edit.type = "button";
      edit.addEventListener("click", () => this.snack(readOnly()));
      actions.append(edit);
    }
    const follow = isMe ? null : this.followButton(a);
    if (follow) actions.append(follow.el);
    const face = avatarElement(a, 80);
    face.classList.add("big");
    const nameLine = h("div", "sns-profile-name", a.name);
    if (a.isVouched) nameLine.append(this.badge());
    const meta = h("div", "sns-profile-meta");
    if (a.location) meta.append(h("span", "", icon("pin"), ownWords(a.location)));
    meta.append(h("span", "", icon("calendar"), joinedLabel(a)));
    const following = h("b");
    const followers = h("b");
    const followersLabel = h("span");
    const counts = h(
      "div",
      "sns-profile-counts",
      h("span", "", following, " ", st("profile.following")),
      h("span", "", followers, " ", followersLabel),
    );
    const info = h(
      "div",
      "sns-profile-info",
      nameLine,
      h("div", "sns-handle", `@${a.handle}`),
      ...(a.bio ? [h("div", "sns-profile-bio", ownWords(a.bio))] : []),
      meta,
      counts,
    );
    const tabItems: [ProfileTab, string][] = [
      ["posts", st("profile.posts")],
      ["replies", st("profile.replies")],
      ["media", st("profile.media")],
    ];
    if (isMe) tabItems.push(["likes", st("profile.likes")]);
    const tabs = this.tabs(tabItems, route.tab, (t) => {
      route.tab = t;
      route.scroll = this.page?.el.scrollTop ?? 0;
      this.show();
    });
    tabs.classList.add("sticky");
    const el = h("div", "sns-page profile", banner, h("div", "sns-profile-top", face, actions), info, tabs);
    const list = h("div", "sns-list");
    el.append(list);
    overlays.push(this.fab());
    const rows = new Map<string, Row>();
    return {
      el,
      sync: (now) => {
        setText(following, formatCount(a.following + (isMe ? this.followed.size - FOLLOWED_LIST.length : 0)));
        setText(followers, formatCount(a.followers));
        setText(followersLabel, stCount("profile.followers", a.followers));
        follow?.update();
        const entries = this.profileEntries(a, route.tab).toSorted((x, y) => y.at - x.at);
        const empty = {
          posts: emptyEntry(
            isMe ? st("profile.noPostsMe") : st("profile.noPosts", { handle: a.handle }),
            st("profile.noPostsBody"),
          ),
          replies: emptyEntry(st("profile.noReplies"), st("profile.noRepliesBody")),
          media: emptyEntry(st("profile.noMedia"), st("profile.noMediaBody")),
          likes: emptyEntry(st("profile.noLikes"), st("profile.noLikesBody")),
        }[route.tab];
        syncList(list, rows, entries.length > 0 ? entries : [empty], now);
      },
    };
  }

  private profileEntries(a: SocialAccount, tab: ProfileTab): Entry[] {
    const out: Entry[] = [];
    const add = (card: Card, at = card.at, opts: RowOptions = {}) =>
      out.push({
        key: `${card.key}${opts.repostedBy ? "-rp" : ""}`,
        at,
        score: 0,
        make: () => this.timelineRow(card, opts),
      });
    const posts = this.feed.posts;
    if (tab === "likes") {
      for (const card of this.likedCards.values()) if (this.liked.has(card.key)) add(card);
      return out;
    }
    for (const p of posts) {
      const isMine = p.account === a;
      if (tab === "replies") {
        for (const r of p.replies)
          if (r.account === a) add(replyCard(p, r), r.postedAt, { replyingTo: true });
        continue;
      }
      // A words-only post has nothing for the media tab.
      const isShown = isMine && (tab !== "media" || p.media !== "text");
      if (isShown) add(postCard(p));
      if (tab === "media") continue;
      for (const q of p.quotePosts) if (q.account === a) add(quoteCard(p, q));
      const repost = p.reposters.find((r) => r.account === a);
      if (repost) add(postCard(p), repost.at, { repostedBy: a });
    }
    if (tab === "replies") {
      for (const c of this.feed.chatter)
        for (const r of c.replies)
          if (r.account === a) add(chatterReplyCard(c, r), r.postedAt, { replyingTo: true });
      return out;
    }
    for (const c of this.feed.chatter) {
      const isShown = c.account === a && (tab === "posts" || c.picture);
      if (isShown) add(chatterCard(c));
    }
    return out;
  }

  private notificationsPage(route: Extract<Route, { page: "notifications" }>, overlays: HTMLElement[]): Page {
    const header = h(
      "header",
      "sns-header",
      this.rootbar(st("notes.title")),
      this.tabs(
        [
          ["all", st("notes.all")],
          ["vouched", st("notes.vouched")],
          ["mentions", st("notes.mentions")],
        ],
        route.tab,
        (t) => {
          route.tab = t;
          route.scroll = 0;
          this.show();
        },
      ),
    );
    const el = h("div", "sns-page", header);
    const list = h("div", "sns-list");
    el.append(list);
    overlays.push(this.fab());
    const rows = new Map<string, Row>();
    return {
      el,
      sync: (now) => {
        const events = route.tab === "mentions" ? [] : this.feed.events.filter((e) => e.at <= now);
        const shown = route.tab === "vouched" ? events.filter((e) => this.actorOf(e).isVouched) : events;
        const entries: Entry[] = shown
          .map((e) => ({
            key: `${e.kind}:${e.at}:${this.actorOf(e).id}`,
            at: e.at,
            score: 0,
            make: () => this.noteRow(e),
          }))
          .toSorted((a, b) => b.at - a.at);
        const empty = {
          all: emptyEntry(st("notes.empty"), st("notes.emptyBody")),
          vouched: emptyEntry(st("notes.emptyVouched"), st("notes.emptyVouchedBody")),
          mentions: emptyEntry(st("notes.emptyMentions"), st("notes.emptyMentionsBody")),
        }[route.tab];
        syncList(list, rows, entries.length > 0 ? entries : [empty], now);
      },
    };
  }

  private actorOf(e: SocialEvent): SocialAccount {
    if (e.kind === "follow") return e.account;
    if (e.kind === "news") return e.quote.account;
    if (e.kind === "praise") return e.chatter.account;
    return e.post.account;
  }

  private searchPage(route: Extract<Route, { page: "search" }>, overlays: HTMLElement[]): Page {
    const box = h("div", "sns-search", icon("search"), h("span", "", st("search.placeholder", APP)));
    box.addEventListener("click", () => this.snack(readOnly()));
    const bar = h(
      "div",
      "sns-topbar",
      this.avatarButton(this.feed.player, 32),
      box,
      this.roundButton("gear", st("settings"), () => this.snack(readOnly())),
    );
    const names = (
      ["search.forYou", "search.trending", "search.news", "search.sports", "search.entertainment"] as const
    ).map((key) => st(key));
    const tabs = this.tabs(
      names.map((n, i) => [String(i), n] as [string, string]),
      String(route.tab),
      (t) => {
        route.tab = Number(t);
        this.show();
      },
    );
    tabs.classList.add("scroll");
    const el = h("div", "sns-page", h("header", "sns-header", bar, tabs));
    const list = h("div", "sns-list");
    el.append(list);
    overlays.push(this.fab());
    const rows = new Map<string, Row>();
    return {
      el,
      sync: (now) => {
        const entries = this.trends(now).map((t, i): Entry => ({
          key: t.name,
          at: 0,
          score: 0,
          make: () => {
            const count = h("div", "sns-trend-meta");
            const meta = h("div", "sns-trend-meta");
            const row = h(
              "div",
              "sns-trend",
              h("div", "sns-trend-text", meta, h("div", "sns-trend-name", t.name), count),
              this.roundButton("more", st("more"), () => this.snack(st("search.hideTrend"))),
            );
            return {
              el: row,
              update: () => {
                const current = this.trends(this.now()).find((x) => x.name === t.name) ?? t;
                setText(meta, `${i + 1} · ${current.topic}`);
                setText(count, stCount("search.posts", current.count, { count: formatCount(current.count) }));
              },
            };
          },
        }));
        syncList(list, rows, entries, now);
      },
    };
  }

  /** What is trending: the tags on clips of the player's driving rise among Tokyo's usual topics. */
  private trends(now: number): { name: string; topic: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const p of this.feed.posts)
      for (const tag of p.tags)
        counts.set(tag, (counts.get(tag) ?? 0) + Math.round(p.reposts * 2 + p.likes * 0.1) + 1);
    const hourSeed = Math.floor(now / HOUR);
    const usual: [SocialMessageKey, SocialMessageKey][] = [
      ["trend.expressway", "trend.traffic"],
      ["trend.lunch", "trend.japan"],
      ["trend.jam", "trend.traffic"],
      ["trend.cats", "trend.japan"],
      ["trend.ramen", "trend.food"],
      ["trend.tokyo", "trend.japan"],
      ["trend.sunset", "trend.japan"],
    ];
    const list = [...counts].map(([name, count]) => ({ name, topic: st("trend.nearYou"), count }));
    // Seeded by the key, so a trend's count stays the same in every language.
    for (const [name, topic] of usual)
      list.push({
        name: st(name),
        topic: st(topic),
        count: 800 + (hashString(`${name}/${hourSeed}`) % 30000),
      });
    return list.toSorted((a, b) => b.count - a.count).slice(0, 12);
  }

  private messagesPage(): Page {
    const write = h("button", "sns-pill accent", st("messages.write"));
    write.type = "button";
    write.addEventListener("click", () => this.snack(readOnly()));
    const empty = h(
      "div",
      "sns-empty",
      h("h3", "", st("messages.welcome")),
      h("p", "", st("messages.welcomeBody", APP)),
      write,
    );
    const el = h("div", "sns-page", h("header", "sns-header", this.rootbar(st("messages.title"))), empty);
    return { el, sync: () => undefined };
  }

  // ---------- rows ----------

  private timelineRow(card: Card, opts: RowOptions = {}): Row {
    const row = h("article", "social-post sns-row");
    row.addEventListener("click", () => this.openCard(card));
    if (opts.repostedBy) row.append(this.contextLine(opts.repostedBy));
    const time = h("span", "sns-time");
    const body = h("div", "sns-body", this.headLine(card, time));
    if (opts.replyingTo && card.replyingTo) body.append(this.replyingLine(card.replyingTo));
    const text = h("div", "sns-text");
    body.append(text);
    const media = card.media ? this.mediaBox(card, card.media, true) : null;
    if (media) body.append(media.el);
    const quote = card.quoted ? this.quoteBox(card.quoted) : null;
    if (quote) body.append(quote.el);
    const actions = this.actionBar(card, "timeline");
    body.append(actions.el);
    row.append(h("div", "sns-row-main", h("div", "sns-side", this.avatarButton(card.account, 40)), body));
    if (opts.threadUp) row.classList.add("thread-up");
    let shownText: string | null = null;
    return {
      el: row,
      update: (now) => {
        setText(time, relativeTime(card.at, now));
        const t = card.text();
        if (t !== shownText) {
          shownText = t;
          richText(text, t, card.tags());
        }
        row.classList.toggle("thread-down", opts.threadDown?.() ?? false);
        media?.update(now);
        quote?.update(now);
        actions.update();
      },
    };
  }

  /**
   * An opened post: bigger text, the full time and views (午後11:30 · 2026年10月5日 · 12.3万 件の
   * 表示), the counts in their own row (リポスト, 引用, いいね, ブックマーク), then the actions. A
   * translated post says so under its text, with a button that shows the Japanese original.
   */
  private detailRow(card: Card, threadUp: boolean): Row {
    const wrap = h("article", "sns-detail");
    if (threadUp) wrap.classList.add("thread-up");
    const name = h("span", "sns-name", card.account.name);
    name.addEventListener("click", () => this.openProfile(card.account));
    const nameLine = h("div", "sns-head", name);
    if (card.account.isVouched) nameLine.append(this.badge());
    const follow = card.account === this.feed.player ? null : this.followButton(card.account);
    const who = h(
      "div",
      "sns-detail-who",
      this.avatarButton(card.account, 40),
      h("div", "sns-detail-names", nameLine, h("div", "sns-handle", `@${card.account.handle}`)),
      ...(follow ? [follow.el] : []),
      this.roundButton("more", st("more"), () => this.moreSheet(card, card.account)),
    );
    wrap.append(who);
    if (card.replyingTo) wrap.append(this.replyingLine(card.replyingTo));
    const text = h("div", "sns-text big");
    wrap.append(text);
    // 「日本語から翻訳 · 原文を表示」: hidden while the text is shown as written.
    let showsOriginal = false;
    let shownText: string | null = null;
    const toggle = h("button", "sns-translated-toggle");
    toggle.type = "button";
    const translated = h("div", "sns-translated", h("span", "", st("post.translatedFrom")), " · ", toggle);
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      showsOriginal = !showsOriginal;
      shownText = null;
      update(this.now());
    });
    wrap.append(translated);
    const media = card.media ? this.mediaBox(card, card.media, true) : null;
    if (media) wrap.append(media.el);
    const quote = card.quoted ? this.quoteBox(card.quoted) : null;
    if (quote) wrap.append(quote.el);
    const views = h("b");
    const viewsLabel = h("span");
    wrap.append(h("div", "sns-detail-meta", postTimestamp(card.at), " · ", views, " ", viewsLabel));
    const stats = h("div", "sns-detail-stats");
    const t0 = card.target;
    const engage =
      t0.kind === "post"
        ? (tab: "quotes" | "reposts") => this.go({ page: "engagements", post: t0.post, tab, scroll: 0 })
        : null;
    const stat = (key: SocialMessageKey, tab?: "quotes" | "reposts") => {
      const n = h("b");
      const label = h("span");
      const el = h("span", "", n, " ", label);
      if (tab && engage) {
        el.classList.add("link");
        el.addEventListener("click", () => engage(tab));
      }
      return { el, n, label, key };
    };
    const statRows = {
      reposts: stat("count.reposts", "reposts"),
      quotes: stat("count.quotes", "quotes"),
      likes: stat("count.likes"),
      bookmarks: stat("count.bookmarks"),
    };
    stats.append(...Object.values(statRows).map((x) => x.el));
    wrap.append(stats);
    const actions = this.actionBar(card, "detail");
    wrap.append(actions.el);
    const update = (now: number) => {
      const original = card.original();
      const isTranslated = original !== null;
      translated.hidden = !isTranslated;
      const showing = showsOriginal && original ? original : { text: card.text(), tags: card.tags() };
      if (showing.text !== shownText) {
        shownText = showing.text;
        richText(text, showing.text, showing.tags);
        setText(toggle, st(showsOriginal ? "post.showTranslation" : "post.showOriginal"));
      }
      const s = card.stats();
      setText(views, formatCount(s.views));
      setText(viewsLabel, stCount("count.views", s.views));
      const own = {
        reposts: s.reposts + (this.reposted.has(card.key) ? 1 : 0),
        quotes: s.quotes,
        likes: s.likes + (this.liked.has(card.key) ? 1 : 0),
        bookmarks: s.bookmarks + (this.bookmarked.has(card.key) ? 1 : 0),
      };
      // Like the app, a count of nothing is left out (and the row with it).
      for (const [k, row] of Object.entries(statRows)) {
        const n = own[k as keyof typeof own];
        row.el.hidden = n === 0;
        setText(row.n, formatCount(n));
        setText(row.label, stCount(row.key, n));
      }
      stats.hidden = Object.values(own).every((n) => n === 0);
      media?.update(now);
      quote?.update(now);
      follow?.update();
      actions.update();
    };
    return { el: wrap, update };
  }

  /** Name, badge, @handle · time and the ⋯ of a timeline row. */
  private headLine(card: Card, time: HTMLElement): HTMLElement {
    const a = card.account;
    const name = h("span", "sns-name", a.name);
    name.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openProfile(a);
    });
    const line = h("div", "sns-head", name);
    if (a.isVouched) line.append(this.badge());
    line.append(
      h("span", "sns-handle", `@${a.handle}`),
      h("span", "sns-dot", "·"),
      time,
      this.roundButton("more", st("more"), () => this.moreSheet(card, a), "sns-more"),
    );
    return line;
  }

  private quoteBox(card: Card): Row {
    const box = h("div", "sns-quote");
    box.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openCard(card);
    });
    const time = h("span", "sns-time");
    const head = h(
      "div",
      "sns-head small",
      avatarElement(card.account, 20),
      h("span", "sns-name", card.account.name),
    );
    if (card.account.isVouched) head.append(this.badge());
    head.append(h("span", "sns-handle", `@${card.account.handle}`), h("span", "sns-dot", "·"), time);
    const text = h("div", "sns-text clamp");
    box.append(head, text);
    const media = card.media ? this.mediaBox(card, card.media, false) : null;
    if (media) box.append(media.el);
    let shownText: string | null = null;
    return {
      el: box,
      update: (now) => {
        setText(time, relativeTime(card.at, now));
        const t = card.text();
        if (t !== shownText) {
          shownText = t;
          richText(text, t, card.tags());
        }
        media?.update(now);
      },
    };
  }

  /** The clip (still, ▶ and its length) or photo; tapping it opens the viewer. */
  private mediaBox(card: Card, media: Media, opensViewer: boolean): Row {
    const box = h("div", "sns-media");
    const img = h("img");
    img.draggable = false;
    box.append(img);
    if (opensViewer)
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        this.viewer(card);
      });
    if (media.kind === "picture") {
      img.alt = st("media.image");
      img.src = pictureUrl(media.key, media.motif, media.hue);
      box.style.aspectRatio = "16 / 9";
      return staticRow(box);
    }
    img.alt = st(media.still ? "media.image" : "media.video");
    box.classList.add("clip");
    // A photo post shows its still as a picture: no ▶ and no length.
    if (!media.still)
      box.append(h("span", "sns-play", icon("play")), h("span", "sns-duration", clipLength(media.seconds)));
    let shown: string | undefined;
    let shape = "";
    return {
      el: box,
      update: () => {
        const src = media.src();
        if (src && src !== shown) {
          shown = src;
          img.src = src;
        }
        box.classList.toggle("empty", !src);
        // Upright clips show cropped to 4:5 in the timeline, as the app does.
        const ratio = String(Math.max(0.8, media.aspect()));
        if (ratio !== shape) {
          shape = ratio;
          box.style.aspectRatio = ratio;
        }
      },
    };
  }

  private actionBar(
    card: Card,
    variant: "timeline" | "detail" | "viewer",
  ): { el: HTMLElement; update: () => void } {
    const bar = h("div", `sns-actions ${variant}`);
    const make = (name: IconName, cls: string, label: string, onClick: () => void) => {
      const b = h("button", `sns-act ${cls}`);
      b.type = "button";
      b.setAttribute("aria-label", label);
      const ic = h("span", "sns-act-icon", icon(name));
      const n = h("span", "sns-count");
      b.append(ic, n);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      return { b, ic, n };
    };
    let likedShown: boolean | null = null;
    let markedShown: boolean | null = null;
    // An opened post shows its counts in the stats row above, not beside the icons.
    const shows = (n: number) => (variant === "detail" ? "" : countText(n));
    const update = () => {
      const s = card.stats();
      const isLiked = this.liked.has(card.key);
      const isReposted = this.reposted.has(card.key);
      const isMarked = this.bookmarked.has(card.key);
      setText(reply.n, shows(s.replies));
      setText(repost.n, shows(s.reposts + (isReposted ? 1 : 0)));
      setText(like.n, shows(s.likes + (isLiked ? 1 : 0)));
      if (views) setText(views.n, shows(s.views));
      repost.b.classList.toggle("on", isReposted);
      like.b.classList.toggle("on", isLiked);
      mark.b.classList.toggle("on", isMarked);
      if (isLiked !== likedShown) {
        likedShown = isLiked;
        like.ic.replaceChildren(icon("like", isLiked));
      }
      if (isMarked !== markedShown) {
        markedShown = isMarked;
        mark.ic.replaceChildren(icon("bookmark", isMarked));
      }
    };
    const reply = make("reply", "reply", st("action.reply"), () => this.openCard(card));
    const repost = make("repost", "repost", st("action.repost"), () => this.repostSheet(card, update));
    const like = make("like", "like", st("action.like"), () => {
      const isOn = toggleIn(this.liked, card.key);
      if (isOn) this.likedCards.set(card.key, card);
      like.b.classList.remove("pop");
      // Restart the pop animation (a reflow between removing and adding the class).
      void like.b.offsetWidth;
      if (isOn) like.b.classList.add("pop");
      update();
    });
    const views =
      variant === "detail"
        ? null
        : make("views", "views", st("action.views"), () => this.snack(st("snack.views")));
    const mark = make("bookmark", "bookmark", st("action.bookmark"), () => {
      const isOn = toggleIn(this.bookmarked, card.key);
      this.snack(st(isOn ? "snack.bookmarked" : "snack.unbookmarked"));
      update();
    });
    const share = make("share", "share", st("action.share"), () => this.snack(st("snack.linkCopied")));
    bar.append(
      reply.b,
      repost.b,
      like.b,
      ...(views ? [views.b] : []),
      h("div", "sns-act-tail", mark.b, share.b),
    );
    return { el: bar, update };
  }

  private noteRow(e: SocialEvent): Row {
    const kind: Record<SocialEvent["kind"], [IconName, string]> = {
      trend: ["star", "trend"],
      milestone: ["repost", "repost"],
      news: ["star", "trend"],
      follow: ["person", "follow"],
      praise: ["like", "praise"],
    };
    const [name, cls] = kind[e.kind];
    const faces: SocialAccount[] =
      e.kind === "follow"
        ? [e.account]
        : e.kind === "news"
          ? [e.quote.account]
          : e.kind === "praise"
            ? [e.chatter.account]
            : e.kind === "milestone"
              ? [e.post.account, ...e.post.reposters.map((r) => r.account)].slice(0, 5)
              : [e.post.account];
    const who = h("b", "", this.actorOf(e).name);
    const text = h("div", "sns-note-text");
    const preview = h("div", "sns-note-preview");
    // The name goes where each language puts it ({name} in the message).
    const say = (key: SocialMessageKey, params?: Record<string, string>) =>
      text.append(...around(st(key, params), "name", who));
    if (e.kind === "trend") {
      say("notes.trend");
      preview.textContent = e.post.text;
    } else if (e.kind === "milestone") {
      say("notes.milestone", { count: formatCount(e.count) });
      preview.textContent = e.post.text;
    } else if (e.kind === "news") {
      say("notes.news");
      preview.textContent = e.quote.text;
    } else if (e.kind === "praise") {
      say("notes.praise");
      preview.textContent = e.chatter.text;
    } else {
      say("notes.follow");
      preview.textContent = e.account.bio ? ownWords(e.account.bio) : "";
    }
    const time = h("span", "sns-time");
    const row = h(
      "article",
      "sns-note",
      h("div", `sns-note-icon ${cls}`, icon(name)),
      h(
        "div",
        "sns-note-body",
        h("div", "sns-note-faces", ...faces.map((a) => this.avatarButton(a, 32)), time),
        text,
        ...(preview.textContent ? [preview] : []),
      ),
    );
    row.addEventListener("click", () => {
      if (e.kind === "follow") return this.openProfile(e.account);
      if (e.kind === "news") return this.openCard(quoteCard(e.post, e.quote));
      if (e.kind === "praise") return this.openCard(chatterCard(e.chatter));
      this.openCard(postCard(e.post));
    });
    return { el: row, update: (now) => setText(time, relativeTime(e.at, now)) };
  }

  /** Someone in a list (reposters): picture, name, handle, bio and a follow button. */
  private personRow(a: SocialAccount): Row {
    const name = h("div", "sns-head", h("span", "sns-name", a.name));
    if (a.isVouched) name.append(this.badge());
    const follow = a === this.feed.player ? null : this.followButton(a);
    const row = h(
      "div",
      "sns-person",
      this.avatarButton(a, 40),
      h(
        "div",
        "sns-person-body",
        name,
        h("div", "sns-handle", `@${a.handle}`),
        ...(a.bio ? [h("div", "sns-person-bio", ownWords(a.bio))] : []),
      ),
      ...(follow ? [follow.el] : []),
    );
    row.addEventListener("click", () => this.openProfile(a));
    return { el: row, update: () => follow?.update() };
  }

  private composer(): Row {
    const send = h("button", "sns-pill accent dim", st("composer.send"));
    send.type = "button";
    const row = h(
      "div",
      "sns-composer",
      avatarElement(this.feed.player, 32),
      h("span", "sns-composer-input", st("composer.placeholder")),
      send,
    );
    row.addEventListener("click", () => this.snack(readOnly()));
    return staticRow(row);
  }

  // ---------- small parts ----------

  private avatarButton(a: SocialAccount, size: number): HTMLElement {
    const el = avatarElement(a, size);
    el.classList.add("link");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openProfile(a);
    });
    return el;
  }

  private badge(): SVGSVGElement {
    const svg = pathIcon(SOCIAL_BADGE_PATHS.shape, "sns-badge", {
      d: SOCIAL_BADGE_PATHS.tick,
      stroke: T.background,
    });
    svg.setAttribute("aria-label", st("badge", APP));
    return svg;
  }

  private contextLine(a: SocialAccount): HTMLElement {
    const label = h("span", "sns-context-label", st("reposted", { name: a.name }));
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openProfile(a);
    });
    return h("div", "sns-context", h("span", "sns-context-icon", icon("repost")), label);
  }

  private replyingLine(a: SocialAccount): HTMLElement {
    const link = h("span", "sns-link", `@${a.handle}`);
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openProfile(a);
    });
    return h("div", "sns-replying", ...around(st("replyingTo"), "handle", link));
  }

  private followButton(a: SocialAccount): { el: HTMLButtonElement; update: () => void } {
    const b = h("button", "sns-pill");
    b.type = "button";
    let isHover = false;
    const update = () => {
      const isOn = this.followed.has(a.id);
      setText(b, st(isOn ? (isHover ? "follow.unfollow" : "follow.following") : "follow.follow"));
      b.classList.toggle("light", !isOn);
      b.classList.toggle("outline", isOn);
      b.classList.toggle("danger", isOn && isHover);
    };
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleIn(this.followed, a.id);
      isHover = false;
      update();
    });
    b.addEventListener("mouseenter", () => {
      isHover = true;
      update();
    });
    b.addEventListener("mouseleave", () => {
      isHover = false;
      update();
    });
    update();
    return { el: b, update };
  }

  private roundButton(
    name: IconName,
    label: string,
    onClick: () => void,
    className = "sns-round",
  ): HTMLButtonElement {
    const b = h("button", className, icon(name));
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  /** A tab's top bar: your picture, the title, settings. */
  private rootbar(title: string): HTMLElement {
    return h(
      "div",
      "sns-topbar",
      this.avatarButton(this.feed.player, 32),
      h("div", "sns-title", title),
      this.roundButton("gear", st("settings"), () => this.snack(readOnly())),
    );
  }

  /** A pushed screen's top bar: back and the title. */
  private subbar(title: string): HTMLElement {
    return h(
      "div",
      "sns-topbar sub",
      this.roundButton("back", st("back"), () => this.back()),
      h("div", "sns-title", title),
    );
  }

  private tabs<K extends string>(items: [K, string][], current: K, onPick: (k: K) => void): HTMLElement {
    const bar = h("div", "sns-tabs");
    for (const [key, label] of items) {
      const b = h("button", `sns-tab${key === current ? " on" : ""}`, h("span", "", label));
      b.type = "button";
      b.addEventListener("click", () => {
        if (key !== current) onPick(key);
      });
      bar.append(b);
    }
    return bar;
  }

  private fab(): HTMLElement {
    const b = h("button", "sns-fab", icon("plus"));
    b.type = "button";
    b.setAttribute("aria-label", st("compose"));
    b.addEventListener("click", () => this.snack(readOnly()));
    return b;
  }

  // ---------- overlays ----------

  private snack(text: string): void {
    this.stage.querySelector(".sns-snack")?.remove();
    const s = h("div", "sns-snack", text);
    this.stage.append(s);
    clearTimeout(this.snackTimer);
    this.snackTimer = window.setTimeout(() => s.remove(), 2600);
  }

  private sheet(items: { icon: IconName; label: string; danger?: boolean; onPick: () => void }[]): void {
    this.stage.querySelector(".sns-sheet-backdrop")?.remove();
    const backdrop = h("div", "sns-sheet-backdrop");
    const panel = h("div", "sns-sheet", h("div", "sns-sheet-grip"));
    for (const it of items) {
      const b = h(
        "button",
        `sns-sheet-item${it.danger ? " danger" : ""}`,
        icon(it.icon),
        h("span", "", it.label),
      );
      b.type = "button";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        backdrop.remove();
        it.onPick();
      });
      panel.append(b);
    }
    const cancel = h("button", "sns-sheet-cancel", st("sheet.cancel"));
    cancel.type = "button";
    panel.append(cancel);
    backdrop.append(panel);
    backdrop.addEventListener("click", (e) => {
      const isOutside = e.target === backdrop || e.target === cancel;
      if (isOutside) backdrop.remove();
    });
    this.stage.append(backdrop);
  }

  private repostSheet(card: Card, update: () => void): void {
    const isOn = this.reposted.has(card.key);
    this.sheet([
      {
        icon: "repost",
        label: st(isOn ? "sheet.undoRepost" : "sheet.repost"),
        onPick: () => {
          toggleIn(this.reposted, card.key);
          update();
        },
      },
      { icon: "pen", label: st("sheet.quote"), onPick: () => this.snack(readOnly()) },
    ]);
  }

  private moreSheet(card: Card | null, a: SocialAccount): void {
    const isMe = a === this.feed.player;
    const isFollowing = this.followed.has(a.id);
    const items: { icon: IconName; label: string; danger?: boolean; onPick: () => void }[] = [];
    if (card)
      items.push({
        icon: "close",
        label: st("sheet.notInterested"),
        onPick: () => {
          this.hiddenKeys.add(card.key);
          this.snack(st("sheet.hidden"));
          this.refresh();
        },
      });
    if (!isMe)
      items.push({
        icon: "person",
        label: st(isFollowing ? "sheet.unfollow" : "sheet.follow", { handle: a.handle }),
        onPick: () => {
          toggleIn(this.followed, a.id);
          this.refresh();
        },
      });
    if (card)
      items.push({
        icon: "star",
        label: st("sheet.report"),
        danger: true,
        onPick: () => this.snack(st("sheet.reported")),
      });
    if (items.length === 0) return this.snack(readOnly());
    this.sheet(items);
  }

  /** The clip or photo full screen, playing (a progress bar over the clip's length). */
  private viewer(card: Card): void {
    const media = card.media;
    if (!media) return;
    // A post's video plays for real: the game replays the moment from where the poster stood.
    const postId = card.key.startsWith("p") ? Number(card.key.slice(1)) : Number.NaN;
    const isVideo = media.kind === "clip" && !media.still;
    const isPlayed = isVideo && Number.isFinite(postId) && (this.playVideo?.(postId) ?? false);
    if (isPlayed) return;
    const v = h("div", "sns-viewer");
    const img = h("img");
    img.alt = st(isVideo ? "media.video" : "media.image");
    img.src = media.kind === "clip" ? (media.src() ?? "") : pictureUrl(media.key, media.motif, media.hue);
    const close = this.roundButton("close", st("close"), () => v.remove(), "sns-viewer-close");
    v.append(close, img);
    if (isVideo) {
      const bar = h("div", "sns-viewer-bar", h("i"));
      bar.style.setProperty("--sns-clip", `${media.seconds}s`);
      v.append(bar);
    }
    const actions = this.actionBar(card, "viewer");
    actions.update();
    v.append(actions.el);
    v.addEventListener("click", (e) => e.stopPropagation());
    this.stage.append(v);
  }
}

/**
 * The app's tile on the phone's home screen: the logo on black, the name under it. Keeps the
 * button's other children (the unread badge).
 */
export function appTile(button: HTMLElement): void {
  const badge = button.querySelector("#social-badge");
  const tile = h("span", "sns-app-icon", pathIcon(SOCIAL_LOGO_PATH, "sns-app-logo"));
  if (badge) tile.append(badge);
  button.classList.add("sns-app-tile");
  button.setAttribute("aria-label", SOCIAL_APP_NAME);
  button.replaceChildren(tile, h("span", "sns-app-name", SOCIAL_APP_NAME));
}
