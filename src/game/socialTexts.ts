import type { Locale } from "../i18n";
import type { FollowedKey, Persona, PictureMotif } from "./socialAccounts";
import { SOCIAL_EN } from "./socialTextsEn";
import { SOCIAL_ZH } from "./socialTextsZh";
import type { ViolationKind } from "./traffic";
import { CHANNELS, PROGRAMME_TITLE } from "./tvRules";

/**
 * Every word Y (the in-game SNS) writes by itself: what bystanders post about the player's driving
 * (openers, hashtags, replies, quotes, the poster's answers), everyone's everyday posts (chatter)
 * and the replies under them, and the words the slots are filled with. social.ts only picks and
 * fills; nothing here decides when or how often.
 *
 * The Japanese text is the source. A translation is a table from that source text to the text in
 * another language (gettext style: the source is the key): TRANSLATIONS.en (socialTextsEn.ts) and
 * .zh (socialTextsZh.ts). Slots in braces ({ward}, {kmh} …) stay as they are in a translation;
 * social.ts fills them after translating, with the slot's word in the same language (WARD_NAMES,
 * LANDMARK_WORDS, KIND_WORDS, TIME_WORDS_IN, or the word's own entry in TRANSLATIONS).
 *
 * Rules for the texts: no real brands, shops, people or organisations (places, streets, rivers,
 * parks and the game's own landmarks are fine), no politics, nothing that mocks a group of people.
 * The tests check a list of banned words.
 */

/** The UI's languages (src/i18n): the feed is shown in the one the player chose. */
export type SocialLang = Locale;
/**
 * Translations keyed by the Japanese source text: posts, replies, hashtags, the slot words and
 * the bios. Why separate files: about 1,050 pairs per language would bury the Japanese source
 * these tables follow.
 */
export const TRANSLATIONS: Record<Exclude<SocialLang, "ja">, Readonly<Record<string, string>>> = {
  en: SOCIAL_EN,
  zh: SOCIAL_ZH,
};

/**
 * A source text in `lang`, and the language it ended up in (its slots are filled in that one).
 * A visitor's own post or answer (English, Chinese) stays as they wrote it in every language;
 * Japanese without a translation stays Japanese.
 */
export function textIn(source: string, lang: SocialLang): { text: string; lang: SocialLang } {
  const own = languageOf(source);
  const isAsWritten = own !== "ja" || lang === "ja";
  if (isAsWritten) return { text: source, lang: own };
  const translated = TRANSLATIONS[lang][source];
  return translated ? { text: translated, lang } : { text: source, lang: "ja" };
}
/** The text in `lang` (the source when there is no translation). */
export const localize = (source: string, lang: SocialLang): string => textIn(source, lang).text;

const KANA = /[\p{sc=Hiragana}\p{sc=Katakana}]/u;
let asWritten: ReadonlyMap<string, SocialLang> | null = null;
/**
 * The language a source text is written in: Japanese, except the visitors' own posts, their
 * answers and the English or Chinese replies people leave them. How: one pass over those tables,
 * kept after the first call (CHATTER is defined further down).
 */
export function languageOf(source: string): SocialLang {
  if (!asWritten) {
    const map = new Map<string, SocialLang>();
    const VISITORS: Partial<Record<ChatterVoice, SocialLang>> = { touristEn: "en", touristZh: "zh" };
    for (const t of CHATTER) {
      const lang = VISITORS[t.who];
      if (lang) map.set(t.text, lang);
    }
    for (const lang of ["en", "zh"] as const) for (const text of CHATTER_ANSWERS[lang]) map.set(text, lang);
    // Replies to the visitors: in their language unless written in Japanese (with kana).
    for (const text of [...CHATTER_REPLIES.touristEn, ...CHATTER_REPLIES.touristZh]) {
      if (KANA.test(text)) continue;
      map.set(text, /[A-Za-z]/.test(text) ? "en" : "zh");
    }
    asWritten = map;
  }
  return asWritten.get(source) ?? "ja";
}

// ---------- posts about the player's driving ----------

/** What a post carries: the poster's video, a still from it, or words only. */
export type PostMedia = "video" | "photo" | "text";
/**
 * A line, and what it fits (anything when absent): the media (「動画見て」 only goes with a video),
 * the violation kinds within its group (a seat-belt reply is not for a post about lights), and
 * `foot` for what only someone on foot could write (never under a dashcam's clip).
 */
export type Line = {
  text: string;
  media?: readonly PostMedia[];
  kinds?: readonly ViolationKind[];
  foot?: boolean;
};
export type LineLike = string | Line;
const vid = (text: string): Line => ({ text, media: ["video"] });
const shot = (text: string): Line => ({ text, media: ["video", "photo"] });
const plain = (text: string): Line => ({ text, media: ["text"] });
const foot = (text: string): Line => ({ text, foot: true });
const only = (kinds: readonly ViolationKind[], line: LineLike): Line => ({
  ...(typeof line === "string" ? { text: line } : line),
  kinds,
});

/**
 * The first line of a post, by violation kind. Slots: {place} 区と町（「千代田区丸の内二丁目」）,
 * {ward}, {town}, {kmh} the car's speed, {limit} the limit, {over} by how much, {color} {car} the
 * player's car (「青い」「ハッチバック」), {time} 「11時半ごろ」.
 */
export const OPENERS: Record<ViolationKind, readonly LineLike[]> = {
  signal: [
    "{place}で赤信号を突っ切っていった車がいた…",
    "信号無視の車、目の前を通過。{place}",
    "{place}の交差点、完全に赤なのに突っ込んでいった車…",
    "え、今の赤だったよね？{color}{car}がそのまま交差点に入っていった。{place}",
    foot("歩行者側が青になった瞬間に車が突っ込んできた。こっちは止まってて無事。{place}"),
    vid("{time}、{place}で信号無視。動画見てもらえばわかるけど、黄色じゃなくて完全に赤"),
    shot("赤で交差点に入る車が撮れてしまった。{place}"),
    "{place}で信号無視の車。右折待ちの車が急ブレーキ。誰もけがしなくてよかった",
    "信号って守るためにあるんですよ…{place}",
    "{place}、赤信号で止まってた自転車の人もびっくりしてた。信号無視の{car}",
    plain("とっさで撮れなかったけど、{place}で信号無視の車がいた。通る人は気をつけて"),
  ],
  speed: [
    "{place}で明らかにスピード出しすぎの車。{kmh}キロくらい出てたと思う",
    "制限速度どこいった…{place}",
    "{place}、{limit}キロ制限の道を{color}{car}がかっ飛ばしていった",
    "住宅街でそのスピードはないって。{place}",
    vid("ドラレコの速度表示と比べても明らかに速い。{place}"),
    "抜かれたと思ったらもう見えなくなってた。{place}、{time}",
    "{place}をすごい勢いで走っていく車。音でわかるレベル",
    "スピード出てる車って、横にいると本当に怖い。{place}",
    "{place}。あの速度で人が飛び出してきたら止まれないと思う",
    plain("撮る間もなかった。{place}をものすごいスピードで抜けていった車がいた"),
  ],
  pedestrianCrossing: [
    "横断歩道を渡ってる人がいるのに止まらない車。{place}",
    "横断歩道でお年寄りが渡ろうとしてたのに、スピードも落とさず通過していった車。{place}",
    "横断歩道の前で手を挙げてる子がいたのに、{color}{car}が素通り。{place}",
    "信号のない横断歩道、止まってくれたのは後ろの車だけだった。{place}",
    foot("ベビーカーで渡ろうとしたら目の前を通過された…{place}"),
    "横断歩道は歩行者優先ですよ。{place}",
    "{place}の横断歩道、渡ってる途中の人のすぐ前を車が抜けていった",
    foot("{time}、{place}の横断歩道で。渡り始めてたのに減速なし"),
  ],
  noEntry: [
    "一方通行を逆走してくる車がいた。{place}",
    "逆走車、普通に怖い。{place}",
    "{place}の一方通行、{color}{car}が逆から入ってきた",
    "一方通行の出口から入ってくる車を初めて見た。{place}",
    "{place}、標識見えてなかったのかな…逆走してた",
    "細い一方通行で正面から車が来て、自転車の人が壁ぎわに避けてた。{place}",
    "ナビ通りに走ったのかもしれないけど、そこは進入禁止です。{place}",
    vid("{time}、{place}で一方通行の逆走。動画の最後で向きがわかると思う"),
  ],
  turnBan: [
    "{place}の交差点、曲がっちゃいけない方向に曲がっていった車",
    "矢印の標識が出てるのに、その方向以外に曲がる車…{place}",
    "{place}で進行方向の指定を無視して曲がる{color}{car}",
    "曲がれない交差点で曲がっていった車。対向車がクラクション鳴らしてた。{place}",
    "{place}、ここ時間帯で曲がれないんだけどな…",
    "標識、ちゃんと見てほしい。{place}の交差点で指定方向外に進行",
  ],
  closedRoad: [
    "通学路の時間帯なのに車が入ってきた。{place}",
    "{place}、通行止めの時間なのに車が入ってきた。子どもたちが端に寄ってた",
    "歩行者用道路を車が普通に走ってる…{place}",
    foot("{time}、{place}の通学路。見守りの人が止めようとしてたけど行っちゃった"),
    "朝の通学路に車が来ると本当にヒヤッとする。{place}",
    "{place}の通行止め区間に{color}{car}。標識あるのにな",
    "ここ、時間帯で車は入れない道なんですよ。{place}",
  ],
  uturn: [
    "転回禁止なのにUターンしてた車。{place}",
    "{place}でいきなりUターン。後ろの車が急ブレーキ",
    "Uターン禁止の標識の前で堂々とUターン…{place}",
    "{place}、転回禁止の場所でぐるっと回っていった{color}{car}",
    "対向車線をふさいでUターンするの、やめてほしい。{place}",
    "{time}、{place}でUターン。周り見てなかったと思う",
  ],
  slow: [
    "徐行の標識がある道を普通のスピードで抜けていった車。{place}",
    "{place}、子どもが多い道なのにまったく徐行してなかった",
    "「徐行」の文字、見えてなかったのかな。{place}",
    "{place}の細い道、すれ違いざまにけっこうなスピードで来られて怖かった",
    "徐行って、すぐ止まれる速さのことなんですよ…{place}",
    "{place}。曲がり角の先が見えないのに、その速度は危ない",
  ],
  laneChange: [
    "黄色い線をまたいで車線変更していった車。{place}",
    "{place}で進路変更禁止のところを割り込み",
    "黄色の車線、変更しちゃダメなやつです。{place}",
    "{place}、強引な車線変更で後ろの車がブレーキ踏んでた",
    "ウインカーと同時に入ってくるの怖い。{place}",
    "{color}{car}が黄色い線をまたいで割り込み。{place}",
  ],
  laneUse: [
    "右の車線をずっと走り続けてる車。{place}",
    "{place}、追い越し車線に居座る車のせいで流れが悪い",
    "通行帯は左から。{place}の右車線をのんびり走る車がいた",
    "右車線をずっと走るのも違反って知らない人多そう。{place}",
    "{place}で右端の車線をひたすら走る{color}{car}",
    "右の車線は追い越しと右折のための車線なんですよね。{place}",
  ],
  laneDirection: [
    "左折専用レーンから直進していった車。{place}",
    "{place}、車線の矢印と違う方向に行く車がいて危なかった",
    "路面の矢印、見てないのかな…{place}",
    "{place}の交差点で直進レーンから右折。横の車がびっくりしてた",
    "車線ごとの行き先、守らないと横の車とぶつかるよ。{place}",
    "{place}でレーンと違う方向に曲がる{color}{car}",
  ],
  phone: [
    "運転しながらずっとスマホ見てる人がいた…{place}",
    "スマホ見ながら走ってる車、ふらふらしてた。{place}",
    "信号が青になっても動かないと思ったら、運転手がスマホ見てた。{place}",
    "{place}、片手でスマホ持ちながら運転してる人…危ないって",
    "横に並んだ車の運転手、画面ばっかり見てた。{place}",
    "{color}{car}の運転手、ずっと下向いてた。たぶんスマホ。{place}",
    "ながら運転、本当にやめてほしい。{place}",
    "{place}。スマホ見ながら交差点を曲がっていった。歩行者がいたらどうするの",
  ],
  phoneDanger: [
    "スマホ見ながら運転してて事故。{place}",
    "{place}で事故。運転手がスマホ持ってるのが見えた",
    "ながら運転で事故るの、一番もったいない。{place}",
    "{place}、スマホいじりながら走ってた車がぶつかった。けが人がいないといいけど",
    "{time}、{place}で事故。直前までスマホ見てたっぽい",
    "画面見ながら運転するとこうなる…{place}",
  ],
  signalOmission: [
    "ウインカー出さずに曲がる車、多すぎ。{place}",
    "{place}、合図なしでいきなり左折。自転車の人が危なかった",
    "ウインカーは曲がる30m手前から。{place}の{color}{car}…",
    "{place}で合図なしの車線変更。どっちに行くかわからなくて怖い",
    "ウインカー出すのってそんなに面倒かな…{place}",
    "{place}、ウインカーなしで右折。対向車が止まってた",
  ],
  noLights: [
    "夜なのにライトつけてない車がいた。{place}",
    "{place}、無灯火の車が暗い道から出てきて見えなかった",
    "ライト、つけ忘れてますよ…{place}",
    "{time}、{place}で無灯火の{color}{car}。街灯の少ない道だと本当に見えない",
    "夜の無灯火、歩行者からはほぼ見えないんですよ。{place}",
    "{place}。ヘッドライト消したまま走ってる車、気づくのが遅れた",
  ],
  hornMisuse: [
    "{place}で意味もなくクラクション鳴らしてる車",
    "なんで今クラクション…？{place}",
    "{place}、前の車が止まった瞬間にクラクション。歩行者がびっくりしてた",
    "クラクションって危険を知らせるためのものでは…{place}",
    "{time}、{place}で長いクラクション。何もなかったのに",
    foot("住宅街でクラクション鳴らすのやめてほしい。赤ちゃん起きた。{place}"),
  ],
  seatBelt: [
    "シートベルトしてない運転手、窓から見えた。{place}",
    "{place}、ベルトしてない人がいて心配になった",
    "シートベルトは自分を守るためのものだよ。{place}",
    "{place}で見かけた{color}{car}、運転席の人がベルトしてなかった",
    "ベルトなしでぶつかったら…考えたくない。{place}",
    "{place}。シートベルト、近所への買い物でも締めようね",
  ],
  keepLeft: [
    "対向車線にはみ出して走ってきた車、ぶつかるかと思った。{place}",
    "センターラインはみ出してくる車、正面から来て本当に怖かった。{place}",
    "{place}、右側を走ってくる車がいて急いで避けた",
    "{color}{car}がずっと道の右側を走ってた。{place}",
    "{place}でセンターラインを越えて走る車。対向のバイクがよけてた",
    "右側通行は海外だけにして…{place}",
    "{time}、{place}。対向車線を逆走みたいに走ってきた",
    "{place}のカーブではみ出してくる車、見通し悪いから本当に危ない",
  ],
  safeDriving: [
    "{place}で事故。車同士がぶつかった音がすごかった",
    "目の前で事故。{place}。ぶつけた方、前を見てなかったと思う",
    "{place}で事故。電柱にぶつかってた",
    "{time}、{place}で物損事故。けが人はいなさそう",
    "{place}、ドンって音がして振り向いたら車がぶつかってた",
    "前方不注意っぽい事故を見た。{place}。みんな気をつけて",
    "{place}で事故。後ろの車が渋滞し始めてる",
  ],
  injury: [
    "{place}で人身事故。車が人をはねた…救急車が来てる",
    "{place}で車が歩行者をはねるのを見てしまった…救急車呼びました",
    "{place}で事故。人が倒れてて、周りの人が声をかけてた",
    "{place}で人身事故。運転手は降りてきてた。救急車を待ってる",
    "目の前で人がはねられた…{place}。手が震えてる",
    "{place}で歩行者との事故。大けがじゃないといいけど",
    "{time}、{place}。車と歩行者の事故。通る人は気をつけて",
  ],
  hitAndRun: [
    "ひき逃げ！{place}。車は逃げていった。ナンバー見た人いませんか",
    "{place}で人をはねた車がそのまま走り去った。見た人は警察へ",
    vid("ひき逃げの瞬間を撮ってしまった…{place}。けが人がいます"),
    "{place}で人をはねて逃げた{color}{car}。見た人は警察に連絡を",
    "ひき逃げを見た。{place}。けが人は通りかかった人が救護してる",
    shot("{time}、{place}でひき逃げ。ナンバー、映ってるかも"),
    "信じられない。人をはねてそのまま走っていった。{place}",
    "{place}。止まらずに逃げた車がいます。拡散お願いします",
  ],
  unlicensed: [
    "{place}、運転がずいぶんぎこちない車がいた。大丈夫かな",
    "{place}、ふらふら走る車。運転慣れてない感じだった",
    "免許持ってるのかな、って運転の車を見た。{place}",
    "{place}でよろよろ走る{color}{car}。周りの車が距離とってた",
    "{time}、{place}。危なっかしい運転の車がいた",
    "{place}。ブレーキのタイミングがおかしい車がいて、後ろがひやひやしてた",
  ],
  ignoredStop: [
    "{place}でパトカーの停止を無視して逃げた車",
    "止まれって言われてるのに走り去った車がいた。{place}",
    "{place}、サイレン鳴らしたパトカーが追いかけてた",
    "警察の停止に従わず逃げるとか…{place}",
    "{place}で警察から逃げる車を見た。映画じゃないんだから",
    "{time}、{place}。パトカーを振り切っていった{color}{car}",
  ],
  parking: [
    "{place}の道に車が置きっぱなし。運転手どこ行った",
    "駐禁の場所にずっと止まってる車。{place}",
    "{place}、路上駐車の車をよけるのに対向車線に出なきゃいけない",
    shot("{color}{car}が{place}に放置されてた。確認標章が貼られてた"),
    "{place}の路駐、自転車が車道の真ん中に押し出されて危ない",
    "ちょっとだけ、のつもりの路駐が一番迷惑。{place}",
  ],
  parkingNoStop: [
    "交差点のすぐ近くに車を止めて行っちゃった人がいた。{place}",
    "{place}、横断歩道の前に駐車…見通し悪くなって危ない",
    "{place}の交差点の角に放置車両。曲がる車から歩行者が見えない",
    "駐停車禁止の場所に止めないで。{place}",
    "{place}、交差点ぎりぎりに止まった{color}{car}。バスが曲がれなくて困ってた",
    "{time}、{place}。横断歩道の上に止める人、初めて見た",
  ],
  // The charges of a pursuit (pursuitLaw.ts): what people around saw of them.
  negligentInjury: [
    "{place}でパトカーに追われてた車が歩行者をはねた…",
    "追跡中の車が人をはねたっぽい。{place}。救急車が呼ばれてる",
    "{time}、{place}。逃げてた車が横断中の人に当たった。けがしてる",
    "{place}、パトカーから逃げてた{color}{car}が人をはねた",
    "目の前で人がはねられた。追いかけられてた車。{place}",
    "{place}で事故。サイレンを鳴らしたパトカーのすぐ前の車が歩行者に…",
  ],
  dangerousInjury: [
    "{place}で、ものすごいスピードの車が人をはねた。パトカーに追われてた",
    "赤信号を突っ切った車が横断中の人をはねた…{place}",
    "{place}。逃げる車が赤で交差点に入って、歩いてた人に当たった",
    "{time}、{place}で信号無視の車が人をはねた。あれは危険運転だと思う",
    "{place}、とんでもない速度で走ってた{color}{car}が人をはねた。けが人が心配",
    vid("{place}で暴走した車が歩行者をはねる瞬間が映ってた。警察に提供します"),
  ],
  obstruction: [
    "{place}で車がパトカーにぶつかっていった…わざと？",
    "パトカーに体当たりする車を見た。{place}",
    "{place}、検問の警察官に向かって車が突っ込んでいった。危ない",
    "{time}、{place}。止めに入った警察の車に車をぶつけてた",
    vid("{place}でパトカーに車をぶつけて逃げようとする瞬間。ドラレコに残ってた"),
    "{place}で警察の車にぶつけていった{color}{car}。信じられない",
  ],
  propertyDamage: [
    "{place}、パトカーのバンパーがへこんでた。ぶつけた車がいるらしい",
    "{place}でパトカーに当てていった車。パトカー、けっこう壊れてる",
    "パトカーにぶつけるとか…{place}",
    "{time}、{place}。警察の車両が傷だらけ。逃げた車がぶつけたって",
    "{place}、白バイが倒れてた。車にぶつけられたみたい",
    shot("{place}でぶつけられたパトカー。ライトが割れてる"),
  ],
  stopSign: [
    "「止まれ」で一切止まらない車。{place}",
    "一時停止ガン無視…{place}",
    "{place}の「止まれ」、{color}{car}がそのまま通過",
    "一時停止の線、見えてないのかな。{place}",
    "{place}、止まれの標識の前でスピードも落とさず。出会い頭が怖い",
    "{time}、{place}の一時停止。止まったのは自転車の方だった",
    "減速しただけで止まってない。それ一時停止じゃないです。{place}",
    plain("写真はないけど、{place}の一時停止で止まらない車がいた。自転車の人がびっくりしてた"),
  ],
};

/** Hashtags by kind: the first goes on every post, one or two of the rest are added. */
export const TAGS: Record<ViolationKind, readonly string[]> = {
  signal: ["#信号無視", "#危険運転", "#赤信号", "#交差点"],
  speed: ["#スピード違反", "#危険運転", "#速度超過", "#スピード出しすぎ"],
  pedestrianCrossing: ["#横断歩道", "#歩行者優先", "#危険運転"],
  noEntry: ["#逆走", "#危険運転", "#一方通行"],
  turnBan: ["#交通違反", "#指定方向外進行禁止", "#標識見て"],
  closedRoad: ["#通学路", "#通行止め", "#交通違反"],
  uturn: ["#Uターン", "#転回禁止", "#交通違反"],
  slow: ["#徐行", "#生活道路", "#交通違反"],
  laneChange: ["#割り込み", "#進路変更禁止", "#黄色線"],
  laneUse: ["#通行帯違反", "#右車線", "#交通マナー"],
  laneDirection: ["#車線", "#交通違反", "#通行区分"],
  phone: ["#ながら運転", "#スマホ", "#危険運転"],
  phoneDanger: ["#ながら運転", "#事故", "#スマホ"],
  signalOmission: ["#ウインカー", "#合図不履行", "#交通マナー"],
  noLights: ["#無灯火", "#ライトつけて", "#夜道"],
  hornMisuse: ["#クラクション", "#交通マナー"],
  seatBelt: ["#シートベルト", "#交通安全"],
  keepLeft: ["#はみ出し", "#危険運転", "#センターライン"],
  safeDriving: ["#事故", "#前方不注意", "#交通情報"],
  injury: ["#事故", "#拡散希望", "#人身事故"],
  hitAndRun: ["#ひき逃げ", "#拡散希望", "#情報求む"],
  unlicensed: ["#危険運転", "#交通安全"],
  ignoredStop: ["#パトカー", "#逃走", "#拡散希望"],
  parking: ["#路上駐車", "#迷惑駐車", "#放置車両"],
  parkingNoStop: ["#迷惑駐車", "#駐停車禁止", "#交差点"],
  stopSign: ["#一時停止", "#止まれ", "#危険運転"],
  negligentInjury: ["#人身事故", "#拡散希望", "#パトカー"],
  dangerousInjury: ["#危険運転", "#人身事故", "#拡散希望"],
  obstruction: ["#パトカー", "#公務執行妨害", "#危険運転"],
  propertyDamage: ["#パトカー", "#事故", "#拡散希望"],
};

/** Where the clip came from: a dashcam or someone who saw it. */
export const SOURCE_TAGS = { dashcam: "#ドラレコ", witness: "#目撃情報" } as const;

/** How a dashcam clip is introduced now and then (the opener follows). */
export const DASHCAM_LEADS = [
  "ドラレコに残ってた。",
  "ドラレコ確認したら映ってた。",
  "【ドラレコ】",
] as const;

/** Replies and quotes are drawn by what kind of thing happened. */
export type ReplyGroup =
  | "signal"
  | "speed"
  | "pedestrian"
  | "phone"
  | "crash"
  | "hitAndRun"
  | "flee"
  | "wrongWay"
  | "lane"
  | "stop"
  | "manner"
  | "parking"
  // A car pulled over by the police (SocialFeed.postStop): not one of the violation kinds.
  | "pulledOver";
export const REPLY_GROUP: Record<ViolationKind, ReplyGroup> = {
  signal: "signal",
  speed: "speed",
  pedestrianCrossing: "pedestrian",
  slow: "pedestrian",
  closedRoad: "pedestrian",
  phone: "phone",
  phoneDanger: "phone",
  safeDriving: "crash",
  injury: "crash",
  hitAndRun: "hitAndRun",
  ignoredStop: "flee",
  noEntry: "wrongWay",
  keepLeft: "wrongWay",
  uturn: "wrongWay",
  turnBan: "wrongWay",
  laneChange: "lane",
  laneUse: "lane",
  laneDirection: "lane",
  signalOmission: "lane",
  stopSign: "stop",
  hornMisuse: "manner",
  noLights: "manner",
  seatBelt: "manner",
  unlicensed: "manner",
  parking: "parking",
  parkingNoStop: "parking",
  negligentInjury: "crash",
  dangerousInjury: "crash",
  obstruction: "flee",
  propertyDamage: "flee",
};

/**
 * Replies under a post: those for its group and those that fit any (`common`). Agreeing, angry
 * but civil, nuanced or disagreeing, jokes, and locals adding what they know.
 */
export const REPLIES: Record<ReplyGroup | "common", readonly LineLike[]> = {
  common: [
    "やべー",
    "こいつやべー",
    "危なすぎる",
    "これは酷い",
    "見てて冷や汗出た",
    "子どもがいたらと思うとゾッとする",
    shot("撮ってくれてありがとう"),
    "通報案件",
    "通報しました",
    "警察仕事して",
    "運転向いてないと思う",
    "最近こういうの多すぎ",
    "東京の運転マナーどうなってるの",
    shot("ナンバー映ってるね"),
    shot("保存した"),
    "同じ交差点で自分も危ない目にあった",
    "人の命をなんだと思ってるんだ",
    "急いでたのかもしれないけど、ダメなものはダメ",
    vid("動画だけだと前後がわからないけど、これはアウト"),
    "教習所からやり直してほしい",
    "地元民だけど、ここほんとに多いんだよ",
    "ここ見通し悪いんだよね",
    "{place}ってこういうの多い気がする",
    "これ何時ごろですか？",
    "自分も気をつけようと思った",
    "晒すより警察に届けた方がいいと思う",
    "運転してる人の顔は出さない方がいいよ",
    "うちの近所じゃん",
    "通勤でいつも通る道だ…",
    "誰でもうっかりはあるけど、これは…",
  ],
  signal: [
    "黄色だったんじゃない？と思ったけど、これは完全に赤",
    "赤信号は止まれ。それだけのことなのに",
    "歩行者用の信号、青だったよね",
    "{place}の信号、変わるの早いのはわかるけど…",
    "信号無視って反則金9,000円だっけ",
    "一瞬の差で大事故だよ",
    vid("動画の最後、右折車が止まってくれてなかったらと思うと怖い"),
    "交差点の向こうの人、よく止まったね",
    "うちの子もこの交差点渡るから本当に怖い",
    "信号が見えにくい交差点ではあるけど、言い訳にはならない",
  ],
  speed: [
    "住宅街でこれは本当にダメ",
    "体感だけど{kmh}キロじゃ済まない気がする",
    "メーター見てないのかな",
    "急いでも数分しか変わらないのにね",
    "この道、子どもが飛び出してくるんだよ",
    "オービスがあるとこでやったら一発だね",
    "スピード出したいならサーキットへどうぞ",
    "目測の速度ってあてにならないけど、それでも速い",
    "制限{limit}キロの道だよね、ここ",
    "夜だとこういう車増えるよね",
  ],
  pedestrian: [
    only(["pedestrianCrossing"], "横断歩道は歩行者優先。教習所で最初に習うやつ"),
    only(["pedestrianCrossing"], "止まってくれる車、ほんとに少ない"),
    only(["pedestrianCrossing"], "手を挙げて渡るの、子どもに教えてるのに…"),
    "これで止まらないのはさすがにひどい",
    only(["pedestrianCrossing"], "{place}のあの横断歩道、見通し悪いんだよね"),
    only(["pedestrianCrossing"], "渡ってる人がいたら止まる。それだけ"),
    only(["pedestrianCrossing"], "ベビーカーの前を通過されると本当に怖い"),
    "歩く側も気をつけないと、と思うけど、これは車が悪い",
    only(["pedestrianCrossing", "closedRoad"], "通学路でこれはダメでしょ"),
    only(["pedestrianCrossing"], "後ろから追突されそうで止まれない、って言う人もいるけど…止まって"),
    only(["closedRoad"], "通学路の時間帯だけは本当にやめてほしい"),
    only(["closedRoad"], "通行止めの時間、標識の下に書いてあるよ"),
    only(["closedRoad"], "ナビが通学路を案内することもあるから、標識は自分で見ないとね"),
    only(["slow"], "徐行って、すぐ止まれる速さのことなんだよね"),
    only(["slow", "closedRoad"], "生活道路でこのスピードは怖い"),
    only(["slow"], "{place}のあの道、角から自転車が急に出てくるんだよ"),
  ],
  phone: [
    "スマホ見ながらの運転は、目をつぶって走ってるのと同じ",
    "2秒見てたらもう何十メートルも進んでる",
    "ホルダーに付けて見ないならまだしも、手持ちはダメ",
    "ながら運転は罰則が重くなってるのに",
    only(["phone"], "前の車が青で進まないとき、だいたいこれ"),
    "通知なんて後で見ればいいのに",
    "運転中のスマホは本当にやめよう。自分も気をつける",
    only(["phone"], "片手運転でハンドルふらふら…見てて怖い"),
    only(["phone"], "画面見てて歩行者に気づかなかったらと思うと"),
    only(["phoneDanger"], "事故の相手の方が無事だといいけど"),
    only(["phoneDanger"], "ながら運転で事故だと一発で免停だよね"),
  ],
  crash: [
    only(["safeDriving"], "けが人がいないといいけど"),
    "通る人は気をつけて。渋滞してる",
    vid("ぶつかる直前、ブレーキ踏んでなかったよね"),
    only(["safeDriving"], "事故った人も大丈夫かな"),
    "{place}、よく事故あるよね",
    "前方不注意が一番多いんだよね",
    "救急車の音が聞こえたのこれか",
    "近くにいた。すごい音だった",
    "こういうの見ると車間距離ちゃんととろうって思う",
    only(["injury"], "はねられた方が無事でありますように"),
    only(["injury"], "救急車、早く来てほしい"),
    only(["injury"], "運転手が降りてきて救護してたなら、それはせめてもの救い"),
  ],
  hitAndRun: [
    "逃げたらもっと罪が重くなるのに",
    "けがをした方が無事でありますように",
    "ナンバー見えた人いないかな",
    shot("警察に映像を提供した方がいい"),
    "救護義務って知らないのかな",
    "すぐ戻ってきて、自分から警察に行ってほしい",
    "これは拡散",
    "近くの人が救急車呼んでくれててよかった",
    "ひき逃げは本当に許せない",
    "防犯カメラにも映ってるはず",
  ],
  flee: [
    "逃げ切れると思ってるのかな",
    "ナンバーはもう控えられてると思う",
    "パトカーとのカーチェイスは映画だけで十分",
    "逃げる方が罪重くなるのに",
    "巻き込まれた人がいなくてよかった",
    "このあと事故にならないといいけど",
  ],
  pulledOver: [
    "ちゃんと止まったなら、それだけでえらい",
    "取り締まりを見ると気が引き締まる",
    "何の違反だったんだろう",
    "あそこ、取り締まりよくやってるよね",
    "晒すのはやめておこう。ナンバーは消してね",
    "切符を切られたら、次から気をつければいい",
    "後ろの車の邪魔にならない所に止めてて、えらい",
    "赤色灯って遠くからでも目立つね",
    "逃げなかっただけ立派",
  ],
  wrongWay: [
    only(["noEntry", "keepLeft"], "正面から来られたら避けようがない"),
    only(["noEntry", "turnBan", "uturn"], "標識、見えにくいのかな"),
    only(["noEntry", "turnBan"], "ナビの案内どおりに走ったら逆走、って話もあるけど…"),
    only(["noEntry"], "{place}の一方通行、わかりにくいって地元では有名"),
    only(["noEntry", "keepLeft"], "対向車からしたら本当に恐怖"),
    "慣れてない道ならなおさらゆっくり走ってほしい",
    only(["uturn"], "Uターンするなら、できる場所まで行けばいいのに"),
    only(["uturn"], "後ろの車がよく止まれたね"),
    "うっかりでも、気づいたらすぐ止まってほしい",
    only(["turnBan"], "曲がれない時間帯、標識の下に小さく書いてあるんだよね"),
    only(["keepLeft"], "駐車車両を避けたあと戻らない車、けっこういる"),
  ],
  lane: [
    only(["signalOmission"], "ウインカー出さない車、多すぎ"),
    only(["laneChange"], "割り込みは事故のもと"),
    only(["laneDirection"], "車線の矢印、意外と見てない人多いよね"),
    only(["laneDirection"], "{place}の交差点、車線が急に分かれるからわかりにくい"),
    only(["laneDirection", "laneChange"], "迷ったら無理せずそのまま行けばいいのに"),
    only(["laneChange"], "黄色い線はまたいじゃダメ、意外と知らない人いる"),
    only(["laneUse"], "右車線ずっと走るのも違反なんだよね"),
    only(["laneUse"], "左の車線、空いてるのにね"),
    only(["signalOmission"], "合図は自分のためじゃなくて周りのため"),
    only(["laneChange", "signalOmission"], "急な車線変更、こっちがブレーキ踏まされる"),
    "これくらいで目くじら立てなくても、という気もするけど、事故のもとではある",
  ],
  stop: [
    "止まれ、の標識は飾りじゃない",
    "一時停止って、タイヤが完全に止まるまでだよね",
    "{place}のあの角、見通し悪いんだよね",
    "止まったつもり、が一番多いらしい",
    "自転車も止まらないけど、車はもっと止まって",
    "ここで出会い頭の事故、前にもあった",
    "ゆっくり通過は止まったことにならないんだよな",
    "止まるだけで防げる事故、多いのに",
  ],
  manner: [
    only(["noLights", "hornMisuse", "seatBelt"], "マナーの問題だよね"),
    only(["noLights"], "ライトは早めにつけてほしい"),
    only(["noLights"], "夜の無灯火、ほんとに見えない"),
    only(["noLights"], "街が明るいと、ライトつけ忘れても気づかないんだよね"),
    only(["hornMisuse"], "クラクションでびっくりして転んだ人を見たことある"),
    only(["hornMisuse"], "お礼のクラクションも、本当はダメなんだよね"),
    only(["seatBelt"], "シートベルトは後ろの席もね"),
    only(["seatBelt"], "ベルトは数秒で締められるのに"),
    only(["unlicensed"], "体調悪かったのかな。心配"),
    only(["unlicensed"], "ふらふら運転は本当に怖い"),
    "ちょっとしたことだけど、事故のもとになる",
    "これくらいなら…と思ったけど、やっぱりダメか",
    "自分もうっかりしないように気をつけよう",
  ],
  parking: [
    "路駐のせいで見通し悪くなるんだよね",
    "{place}って路駐多いよね",
    "ちょっとだけ、が一番迷惑",
    "駐車監視員さん来てほしい",
    "荷下ろしなら仕方ない面もあるけど",
    "交差点の近くは本当にやめてほしい",
    "自転車が車道の真ん中に押し出されてた",
    "放置違反金、高いよ",
    "バスが曲がれなくなるやつ",
  ],
};

/** A line added when someone quotes the post (these show up in the timeline as posts of their own). */
export const QUOTES: Record<ReplyGroup | "common", readonly LineLike[]> = {
  common: [
    "これはアウト",
    "こわ…",
    "{place}を通る人は気をつけて",
    "こういうのが一番危ない",
    "警察に情報提供した方がいい",
    "拡散。自分も気をつけよう",
    "明日は我が身。自分も気をつけます",
    "撮った人が無事でよかった",
    "地元だ…",
    shot("よく撮れてるな"),
    "これを見て運転を見直す人が増えますように",
  ],
  signal: ["赤は止まれ。子どもでも知ってる", "{place}の交差点、要注意", "信号無視、ダメ絶対"],
  speed: ["スピードは命を削る", "{place}、この速度はない", "メーターを見る習慣を"],
  pedestrian: [
    only(["pedestrianCrossing"], "横断歩道は歩行者優先です"),
    "子どもを連れて歩く身としては本当に怖い",
    only(["pedestrianCrossing"], "止まる、それだけでいい"),
    only(["closedRoad"], "通学路の通行止め、守ろう"),
    only(["slow"], "生活道路はゆっくり"),
  ],
  phone: ["スマホは運転前にしまう", "ながら運転、ダメ絶対", "2秒の脇見が事故になる"],
  crash: [
    only(["safeDriving"], "けが人がいませんように"),
    "{place}付近、渋滞に注意",
    "事故は一瞬",
    only(["injury"], "けがをした方の回復を祈ります"),
  ],
  hitAndRun: ["情報求む。{place}付近", "逃げずに戻ってきて", "見かけた人は警察へ"],
  flee: ["警察から逃げても状況は悪くなるだけ", "{place}付近、パトカーが走ってます"],
  pulledOver: ["{place}で取り締まり中。安全運転で", "止められてる車を見ると、自分の運転を見直す"],
  wrongWay: [
    only(["noEntry", "keepLeft"], "逆走・はみ出しは正面衝突のもと"),
    "{place}付近の人は気をつけて",
    only(["turnBan", "uturn"], "標識は最後まで読もう"),
  ],
  lane: [
    only(["signalOmission"], "合図は早めに"),
    only(["laneChange"], "割り込みダメ"),
    "車線は余裕をもって選ぼう",
  ],
  stop: ["止まれは止まれ", "一時停止、完全に止まろう"],
  manner: ["ちょっとしたマナーが事故を防ぐ", only(["noLights"], "ライトは早めに")],
  parking: ["路駐は迷惑のもと", "{place}付近、通行注意"],
};

/** The poster answering a reply under their own post. */
export const ANSWERS: Record<ReplyGroup | "common", readonly LineLike[]> = {
  common: [
    "警察には情報提供しました",
    vid("映像は加工なしです。撮ったそのまま"),
    "場所は{place}です。通る人は気をつけて",
    "ほんとそれです",
    "思ったより広まっててびっくりしてる…",
    "{time}です",
    "地元の人は知ってる道なんですよね",
  ],
  signal: ["完全に赤でした。歩行者側が青だったので"],
  speed: ["体感ですけど、周りの車の倍くらい出てました"],
  pedestrian: [
    only(["pedestrianCrossing"], "渡ってた人は無事でした。よかった"),
    only(["closedRoad"], "子どもたちはみんな無事です"),
    only(["slow"], "あの角、先がほんとに見えないんです"),
  ],
  phone: ["横に並んだときに見えました"],
  crash: [
    only(["injury", "negligentInjury", "dangerousInjury"], "救急車と警察はもう来てます"),
    only(["safeDriving"], "けが人はいなかったみたいです"),
  ],
  hitAndRun: ["けがをした方には近くの人がついてくれてます"],
  flee: ["パトカーはそのまま追いかけていきました"],
  pulledOver: ["ナンバーと顔は映らないようにしてます", "しばらくしたら車は走っていきました"],
  wrongWay: ["こっちは止まれたので無事です"],
  lane: ["後ろの車がうまく避けてくれました"],
  stop: ["止まったように見えて、実は止まってないんですよね"],
  manner: ["悪気はなかったのかもしれないけど"],
  parking: ["しばらくしたら監視員さんが来てました"],
};

/**
 * Posts about a pursuit going on near the player (SocialFeed.postChase), by its stage: 2 when the
 * units gather (緊急配備), 3 with the helicopter and the 検問. Fleeing an ordinary stop is not an
 * offence in itself, so these are about what people see, not a violation.
 */
export const CHASE_OPENERS: Record<2 | 3, readonly LineLike[]> = {
  2: [
    "{place}でパトカーが何台も1台の車を追いかけてる",
    "サイレンがすごい。{place}でパトカーと白バイが車を追ってる",
    "{place}、逃げる車をパトカーが追跡中。巻き込まれないように",
    vid("{place}でパトカーに追われてる車を撮った。かなりのスピード"),
    "{time}、{place}。パトカー何台かが同じ車を追いかけていった",
  ],
  3: [
    "{place}でパトカーとヘリが車を追ってる",
    "上空にヘリ、地上にパトカー。{place}で逃げる車を追跡中みたい",
    "{place}の先で検問やってる。追われてる車がいるらしい",
    vid("{place}でパトカーとヘリが車を追う様子。ニュースになりそう"),
    "{time}、{place}。ヘリの音がずっとしてる。逃げてる車がいるって",
  ],
};
export const CHASE_TAGS = ["#パトカー", "#逃走", "#ヘリ", "#拡散希望"] as const;
/**
 * Posts by passers-by and drivers going past while the police deal with a car at the roadside
 * (SocialFeed.postStop), by what they see: the car pulled over (by a patrol car or a 白バイ), the
 * officer writing (a ticket), the driver taken into the patrol car (赤切符・同行), an arrest, and the
 * end of a chase. From the pavement or a passing car: no plate, no face.
 */
export type StopPhase = "stopped" | "stoppedBike" | "ticket" | "red" | "arrest" | "fledCaught";
export const STOP_OPENERS: Record<StopPhase, readonly LineLike[]> = {
  stopped: [
    "{place}で白黒パトカーに止められてる車いる",
    "{place}、パトカーが後ろについて車を止めてた。何があったんだろう",
    "{place}でお巡りさんが運転席の窓のところで話してる",
    "{time}、{place}。パトカーの赤色灯がずっと回ってる。取り締まりかな",
    "{place}の路肩で{color}{car}がパトカーに止められてる",
    shot("{place}、歩道から見えた。パトカーに止められてる車"),
  ],
  stoppedBike: [
    "{place}で白バイに止められてる車いる",
    "白バイの隊員さんが車の横で話してる。{place}",
    "{time}、{place}。白バイが車を路肩に止めさせてた",
    shot("{place}、白バイの取り締まり。歩道から"),
  ],
  ticket: [
    "切符切られてるっぽい。{place}",
    "{place}、パトカーに止められた車。青切符かな。自分も気をつけよう",
    "{place}で取り締まり。ちゃんと路肩に寄せて止まってた",
    "{time}、{place}。お巡りさんが何か書いてる。切符だろうな",
  ],
  red: [
    "{place}、運転手さんがパトカーの後ろの席に乗せられてる",
    "{place}で止められた車、けっこう長く話してる。赤切符かな",
    "パトカーの中で書類を書いてるっぽい。{place}。重めの違反なのかな",
    "{time}、{place}。止められてた車の運転手がパトカーに乗った",
  ],
  arrest: [
    "{place}で運転手が警察に連れて行かれた…",
    "{place}、パトカーが何台も止まってて、運転手が乗せられていった",
    "逮捕されたっぽい。{place}。何をしたんだろう",
    vid("{place}で運転手がパトカーに乗せられるところ。顔は映してません"),
    "{time}、{place}。警察官に囲まれた車から運転手が降りてきた",
  ],
  fledCaught: [
    "さっきの逃げてた車、{place}でやっと止まったみたい",
    "{place}、パトカーに追われてた車が止められてる。周りに警察官がたくさん",
    "追跡、{place}で終わったっぽい。けが人がいないといいけど",
  ],
};
export const STOP_TAGS = ["#取り締まり", "#パトカー", "#交通安全"] as const;
/** The opener when none of STOP_OPENERS fits. */
export const STOP_FALLBACK = "{place}でパトカーが車を止めてる";

/** The opener when none of CHASE_OPENERS fits (its slots cannot be filled). */
export const CHASE_FALLBACK = "{place}でパトカーが車を追いかけてる";
/** The news account's follow-up once the driver who got away is identified. {place} where it was. */
export const NEWS_IDENTIFIED =
  "【続報】{place}付近でパトカーの停止に従わず走り去った車について、警察はナンバーや投稿された動画などから運転者を特定したもようです";

/** The news account's quote of a clip the police now know of. {what} the offence, {media} 動画/写真. */
export const NEWS_QUOTE =
  "【話題】{place}で撮影された「{what}」の車の{media}が拡散しています。警察も情報を把握しているとみられます";
export const MEDIA_WORDS: Record<PostMedia, string> = { video: "動画", photo: "写真", text: "投稿" };
/**
 * When it happened, as people write it ({h} the hour; 24-hour in Japanese and Chinese, "11am" in
 * English, with "noon" and "midnight").
 */
export const TIME_WORDS = { about: "{h}時ごろ", half: "{h}時半ごろ", before: "{h}時前" } as const;
export const TIME_WORDS_IN: Record<Exclude<SocialLang, "ja">, Record<keyof typeof TIME_WORDS, string>> = {
  en: { about: "around {h}", half: "around {h}", before: "just before {h}" },
  zh: { about: "{h}点左右", half: "{h}点半左右", before: "快{h}点的时候" },
};
export const WEEKDAY_WORDS = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;
export const WEEKDAY_WORDS_IN: Record<Exclude<SocialLang, "ja">, readonly string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
};

/**
 * The offence as the news account names it in English and Chinese ({what}); Japanese uses the
 * record's own label. By kind, so a label's detail in brackets never needs translating.
 */
export const KIND_WORDS: Record<ViolationKind, Record<Exclude<SocialLang, "ja">, string>> = {
  signal: { en: "running a red light", zh: "闯红灯" },
  stopSign: { en: "ignoring a stop sign", zh: "不按规定停车" },
  noEntry: { en: "wrong way down a one-way street", zh: "单行道逆行" },
  turnBan: { en: "illegal turn", zh: "违反指定行驶方向" },
  closedRoad: { en: "driving on a closed road", zh: "驶入禁行道路" },
  uturn: { en: "illegal U-turn", zh: "违规掉头" },
  slow: { en: "not slowing down where required", zh: "未按规定慢行" },
  laneChange: { en: "illegal lane change", zh: "违规变道" },
  laneUse: { en: "hogging the passing lane", zh: "违规占用超车道" },
  laneDirection: { en: "wrong lane for the turn", zh: "不按导向车道行驶" },
  phoneDanger: { en: "phone use that caused danger", zh: "开车玩手机引发危险" },
  signalOmission: { en: "not signaling", zh: "未打转向灯" },
  noLights: { en: "driving without lights", zh: "夜间未开车灯" },
  hornMisuse: { en: "needless honking", zh: "乱按喇叭" },
  seatBelt: { en: "no seat belt", zh: "未系安全带" },
  keepLeft: { en: "driving on the wrong side", zh: "逆向行驶" },
  speed: { en: "speeding", zh: "超速" },
  pedestrianCrossing: { en: "not stopping for pedestrians", zh: "不礼让行人" },
  safeDriving: { en: "careless driving", zh: "违反安全驾驶义务" },
  injury: { en: "a crash with injuries", zh: "致人受伤的事故" },
  hitAndRun: { en: "hit-and-run", zh: "肇事逃逸" },
  unlicensed: { en: "unlicensed driving", zh: "无证驾驶" },
  ignoredStop: { en: "fleeing the police", zh: "拒不停车逃避警察" },
  phone: { en: "using a phone while driving", zh: "开车玩手机" },
  parking: { en: "illegal parking", zh: "违章停车" },
  parkingNoStop: { en: "parking where stopping is banned", zh: "在禁停区域停车" },
  negligentInjury: { en: "injuring someone while fleeing the police", zh: "逃避警察时撞伤行人" },
  dangerousInjury: { en: "dangerous driving causing injury", zh: "危险驾驶致人受伤" },
  obstruction: { en: "obstructing police officers", zh: "妨碍警察执行公务" },
  propertyDamage: { en: "damaging a police vehicle", zh: "损坏警车" },
};

// ---------- everyday posts (chatter) ----------

export type Season = "spring" | "rainy" | "summer" | "autumn" | "winter";
/** Times of the year people post about (social.ts decides from the game date which hold). */
export type Period =
  | "pollen"
  | "sakura"
  | "newFiscal"
  | "goldenWeek"
  | "koromogae"
  | "exams"
  | "summerBreak"
  | "obon"
  | "typhoon"
  | "kinmokusei"
  | "undokai"
  | "gakusai"
  | "halloween"
  | "koyo"
  | "christmas"
  | "yearEnd"
  | "newYear"
  | "school";
/** From the sun over the player: day, dusk (evening twilight), dark, dawn (morning twilight). */
export type Light = "day" | "dusk" | "dark" | "dawn";
/** Things that happen in the game, noted by it (SocialFeed.note) or seen in the weather. */
export type HappeningKind =
  | "orbis"
  | "crash"
  | "patrol"
  | "shirobai"
  | "unmarked"
  | "pursuit"
  | "manhunt"
  | "heli"
  | "checkpoint"
  | "robotaxi"
  | "closure"
  | "rainStart"
  | "rainStop";
/** The player driving well in front of people (SocialFeed.maybePraise). */
export type PraiseKind = "yieldPedestrian" | "fullStop";
/** What a template reacts to: something that just happened, or what is around now. */
export type Cue = HappeningKind | PraiseKind | "bus" | "jam";
/** What a post is about, for the replies people leave under it (CHATTER_REPLIES). */
export type ChatterTopic =
  | "sky"
  | "rain"
  | "heat"
  | "cold"
  | "season"
  | "food"
  | "cafe"
  | "animal"
  | "commute"
  | "traffic"
  | "tip"
  | "news"
  | "police"
  | "bus"
  | "work"
  | "school"
  | "kids"
  | "night"
  | "landmark"
  | "tv"
  | "bike"
  | "walk"
  | "photo"
  | "future"
  | "praise"
  | "tourist"
  | "touristEn"
  | "touristZh"
  | "misc";
/** Who posts it: one of the accounts the player follows, or anyone with that persona. */
export type ChatterVoice = FollowedKey | Persona;

/**
 * An everyday post. Slots: {ward} {town} {nearWard} (wards around), {landmark} (one in sight:
 * 東京タワー・スカイツリー・東京駅), {park} {river} {bridge} (near the player), {sign} {signEn}
 * (a place on a guide sign nearby), {temp} (AMeDAS ℃), {hour} {weekday}, {wardEn}, and the
 * word lists of WORDS ({lunch} {snack} {dinner} {flower} {color} {car}). A template whose slots
 * cannot all be filled is not used.
 */
export type ChatterTemplate = {
  who: ChatterVoice;
  topic: ChatterTopic;
  text: string;
  picture?: PictureMotif;
  /** JST hours [from, to); wraps past midnight when from > to. */
  hours?: readonly [number, number];
  days?: "weekday" | "weekend";
  /** Days of the week (0 = Sunday). */
  dow?: readonly number[];
  seasons?: readonly Season[];
  /** Any one of them. */
  periods?: readonly Period[];
  light?: readonly Light[];
  sky?: "rain" | "dry";
  /** ℃: observed, else the month's usual for the hour. */
  temp?: readonly [number, number];
  cue?: Cue;
  /** A landmark (its game name) that must be in sight. */
  landmark?: string;
  /** Relative chance among those that fit (1 when absent). */
  weight?: number;
  /** Replies of its own, besides the topic's. */
  replies?: readonly string[];
};
type More = Omit<ChatterTemplate, "who" | "topic" | "text">;

/**
 * When each kind of person is up and posting, for templates without hours of their own: nobody's
 * grandmother posts at 3 a.m.; the night-shift nurse, the taxi and truck drivers and the news
 * account may (they have none here).
 */
export const ACTIVE_HOURS: Partial<Record<ChatterVoice, readonly [number, number]>> = {
  weather: [5, 23],
  lab: [6, 23],
  commute: [5, 23],
  teacher: [6, 22],
  cafe: [6, 21],
  office: [6, 1],
  student: [7, 3],
  parent: [6, 24],
  courier: [7, 22],
  busfan: [5, 1],
  cyclist: [5, 24],
  elder: [5, 21],
  tourist: [7, 24],
  touristEn: [7, 24],
  touristZh: [7, 24],
  photographer: [5, 2],
  foodie: [7, 1],
  instructor: [7, 22],
  runner: [4, 23],
  rider: [6, 24],
  dogwalker: [5, 22],
  catlover: [7, 2],
  homemaker: [6, 24],
  shopkeeper: [6, 22],
  carfan: [6, 2],
  volunteer: [6, 19],
  local: [6, 2],
};
const c = (who: ChatterVoice, topic: ChatterTopic, text: string, more: More = {}): ChatterTemplate => ({
  who,
  topic,
  text,
  ...more,
});

const DAYTIME: readonly Light[] = ["day"];
const DARK: readonly Light[] = ["dark"];
const DUSK: readonly Light[] = ["dusk"];
const LIT: readonly Light[] = ["day", "dusk", "dawn"];
const TV_NEWS = PROGRAMME_TITLE.news;
const TV_WEATHER = PROGRAMME_TITLE.weather;
const TV_NATURE = PROGRAMME_TITLE.nature;
const NATURE_CH = CHANNELS[2];

export const CHATTER: readonly ChatterTemplate[] = [
  // --- the accounts the player follows ---
  c("weather", "sky", "おはようございます。今朝の東京、富士山まで見えました", {
    picture: "fuji",
    hours: [5, 11],
    sky: "dry",
    seasons: ["autumn", "winter", "spring"],
  }),
  c("weather", "sky", "夕焼けがきれいでした。今日もおつかれさまでした", {
    picture: "sunset",
    light: DUSK,
    sky: "dry",
  }),
  c("weather", "night", "今夜の東京。空気が澄んでて遠くまで見える", {
    picture: "skyline",
    light: DARK,
    sky: "dry",
  }),
  c("weather", "rain", "雨の{ward}。足元に気をつけてお出かけください", {
    picture: "rainStreet",
    sky: "rain",
    light: LIT,
  }),
  c("weather", "rain", "雨が上がりました。路面はまだ濡れているので、運転する方はスリップに注意", {
    picture: "clouds",
    cue: "rainStop",
  }),
  c("weather", "rain", "急に降ってきました☔ 傘をお持ちでない方は少し雨宿りを", {
    picture: "umbrella",
    cue: "rainStart",
  }),
  c("weather", "sky", "{hour}時の東京は{temp}℃。過ごしやすい一日になりそうです", {
    temp: [15, 25],
    hours: [6, 11],
  }),
  c("weather", "cold", "{hour}時の気温は{temp}℃。上着が一枚あると安心です", { temp: [-10, 14] }),
  c("weather", "heat", "{hour}時の時点で{temp}℃。こまめに水分をとってください", { temp: [29, 45] }),
  c("weather", "sky", "秋の空。うろこ雲が出ています", {
    picture: "clouds",
    seasons: ["autumn"],
    sky: "dry",
    light: DAYTIME,
  }),
  c("weather", "sky", "入道雲がもくもく。夕方は急な雨に注意", {
    picture: "clouds",
    seasons: ["summer"],
    sky: "dry",
    light: DAYTIME,
  }),
  c("weather", "season", "梅雨空の東京。紫陽花がきれいな季節です", { picture: "flower", seasons: ["rainy"] }),
  c("weather", "sky", "冬の朝。空が高くて、富士山がくっきり", {
    picture: "fuji",
    seasons: ["winter"],
    hours: [6, 10],
    sky: "dry",
  }),
  c("weather", "sky", "春がすみの東京。遠くのビルがやさしくかすんでいます", {
    picture: "skyline",
    seasons: ["spring"],
    sky: "dry",
    light: DAYTIME,
  }),
  c("weather", "season", "日が短くなりました。{hour}時でもう暗くなってきています", {
    picture: "sunset",
    seasons: ["autumn", "winter"],
    light: DUSK,
    hours: [16, 19],
  }),
  c("weather", "rain", "台風が近づいています。最新の情報を確認して、無理な外出は控えてください", {
    picture: "clouds",
    periods: ["typhoon"],
    sky: "rain",
    weight: 0.6,
  }),
  c("weather", "landmark", "{landmark}と夕焼け。今日もいい一日でした", {
    picture: "sunset",
    light: DUSK,
    sky: "dry",
  }),
  c("weather", "night", "月がきれいな夜です", { picture: "nightCity", light: DARK, sky: "dry", weight: 0.6 }),

  c(
    "lab",
    "tip",
    "【安全運転のコツ】右折するときは、対向車の陰から来るバイクや自転車に注意。見えないところに誰かいるかも、と考えるのが基本です",
  ),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】横断歩道を渡ろうとしている人がいたら、必ず手前で一時停止（道路交通法 第38条）",
  ),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】スマホは運転前にしまう。手に持って見ながらの運転は違反、事故を起こせば一発で免許停止です",
  ),
  c("lab", "tip", "黄色信号は「止まれ」。安全に止まれないときだけ進めます（道路交通法施行令 第2条）"),
  c("lab", "tip", "【安全運転のコツ】雨の日は止まるまでの距離が延びます。車間距離はいつもの倍を目安に", {
    sky: "rain",
  }),
  c("lab", "tip", "【安全運転のコツ】降り始めの路面は特に滑りやすいです。ゆっくり、早めのブレーキを", {
    cue: "rainStart",
  }),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】日が暮れるのが早い季節。ライトは早めに点灯しましょう（道路交通法 第52条）",
    {
      seasons: ["autumn", "winter"],
      light: ["dusk", "dark"],
    },
  ),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】「止まれ」の標識では、停止線の直前で一度完全に止まります（道路交通法 第43条）",
  ),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】通学路の時間帯の通行止めに注意。標識の下の補助標識で時間を確かめましょう",
    {
      days: "weekday",
      hours: [6, 9],
      periods: ["school"],
    },
  ),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】オービスが光ったら、速度を見直すきっかけに。制限速度は「出してよい速度」ではなく「上限」です",
    {
      cue: "orbis",
    },
  ),
  c("lab", "tip", "【安全運転のコツ】ウインカーは右左折の30m手前から（道路交通法施行令 第21条）"),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】路線バスが発車の合図をしたら、進路を譲りましょう（道路交通法 第31条の2）",
    {
      cue: "bus",
    },
  ),
  c("lab", "tip", "【安全運転のコツ】夕暮れどきは歩行者が見えにくくなる時間帯。交差点では特に注意", {
    light: DUSK,
  }),
  c("lab", "tip", "【安全運転のコツ】渋滞の最後尾では、ハザードランプで後ろの車に知らせると追突を防げます", {
    cue: "jam",
  }),
  c("lab", "tip", "【安全運転のコツ】白バイやパトカーを見たときだけ安全運転、ではなく、いつも同じ運転を", {
    cue: "shirobai",
  }),
  c(
    "lab",
    "tip",
    "【安全運転のコツ】自動運転の車も周りの動きを見て走っています。急な割り込みはしないように",
    {
      cue: "robotaxi",
    },
  ),

  c(
    "news",
    "traffic",
    "【交通】都心の主要道路は夕方にかけて混雑する見込みです。時間に余裕をもってお出かけください",
    {
      hours: [11, 18],
    },
  ),
  c(
    "news",
    "news",
    "【交通】歩行者が巻き込まれる事故の多くは、道路を横断している時に起きています。横断歩道の手前では速度を落として",
  ),
  c("news", "traffic", "【交通】{ward}付近で事故があったもようです。周辺は混雑しています", { cue: "crash" }),
  c("news", "traffic", "【交通】雨の影響で、都内の一般道は各地で流れが悪くなっています", {
    sky: "rain",
    hours: [6, 22],
  }),
  c("news", "police", "【交通】{ward}周辺で交通の取り締まりが行われているもようです", { cue: "patrol" }),
  c("news", "police", "【交通】{ward}付近、白バイが巡回中との情報があります。安全運転で", {
    cue: "shirobai",
  }),
  c("news", "traffic", "【交通】朝の通勤時間帯、都心に向かう道路で混雑が続いています", {
    days: "weekday",
    hours: [7, 10],
  }),
  c("news", "traffic", "【交通】週末の行楽の車で、郊外へ向かう道路が混み合っています", {
    days: "weekend",
    hours: [9, 13],
  }),
  c("news", "traffic", "【交通】{ward}周辺で渋滞が発生しています。迂回も検討してください", { cue: "jam" }),
  c("news", "traffic", "【交通】年末の帰省ラッシュが始まっています。時間に余裕をもってお出かけください", {
    periods: ["yearEnd"],
  }),
  c("news", "traffic", "【交通】連休中は観光地の周辺が混雑します。公共交通機関の利用もご検討ください", {
    periods: ["goldenWeek", "obon"],
  }),
  c("news", "news", "【交通】台風の接近に伴い、強い雨と風が予想されます。不要不急の外出は控えてください", {
    periods: ["typhoon"],
    sky: "rain",
    weight: 0.6,
  }),
  c("news", "future", "【交通】{ward}で自動運転タクシーが走っています。歩行者・自転車はふだんどおり注意を", {
    cue: "robotaxi",
  }),
  c("news", "news", "【交通】今夜は雨。夜は路面が光って白線が見えにくくなります", {
    sky: "rain",
    light: DARK,
  }),
  c("news", "news", "【交通】通学路での事故を防ぐため、朝の通行止めの時間を守りましょう", {
    days: "weekday",
    hours: [6, 9],
    periods: ["school"],
  }),
  c(
    "news",
    "police",
    "【交通】{ward}付近で緊急配備。パトカーや白バイが集まっています。緊急車両には道を譲ってください",
    { cue: "manhunt" },
  ),
  c("news", "police", "【交通】{ward}の上空で警察のヘリコプターが旋回しています", { cue: "heli" }),
  c(
    "news",
    "police",
    "【交通】{ward}付近の交差点で検問が行われています。時間に余裕をもってお出かけください",
    {
      cue: "checkpoint",
    },
  ),
  c("news", "police", "【交通】{ward}付近でパトカーが車を追跡しているとの情報。周辺の方は気をつけて", {
    cue: "pursuit",
  }),

  c("ramen", "food", "今日の一杯。醤油ラーメン、スープまで完飲", { picture: "ramen", hours: [11, 15] }),
  c("ramen", "food", "夜ラーメンは背徳の味", { picture: "ramen", hours: [20, 24] }),
  c("ramen", "food", "雨の日は行列が短いので狙い目。今日は塩", {
    picture: "ramen",
    sky: "rain",
    hours: [11, 15],
  }),
  c("ramen", "food", "{ward}で一杯。煮干しの香りがたまらない", { picture: "ramen", hours: [11, 15] }),
  c("ramen", "food", "寒くなってきたので味噌の季節", { picture: "ramen", temp: [-10, 15] }),
  c("ramen", "food", "暑い日はつけ麺一択", { picture: "ramen", temp: [27, 45] }),
  c("ramen", "food", "替え玉、我慢しました（えらい）", { picture: "ramen", hours: [18, 23] }),

  c("cat", "animal", "うちの猫、窓から車を眺めるのが好き", { picture: "cat" }),
  c("cat", "animal", "寝てる写真しか撮れない", { picture: "cat" }),
  c("cat", "animal", "雨の音を聞きながら丸くなってる", { picture: "cat", sky: "rain" }),
  c("cat", "animal", "日なたの場所取りが上手すぎる", { picture: "cat", sky: "dry", light: DAYTIME }),
  c("cat", "animal", "外の救急車のサイレンに耳だけ反応してた", { picture: "cat", cue: "crash" }),
  c("cat", "animal", "猫、こたつから出てこない", { picture: "cat", seasons: ["winter"] }),
  c("cat", "animal", "夜の運動会が始まった", { picture: "cat", hours: [22, 2] }),

  c("commute", "traffic", "首都高、今日もそこそこ混んでる", { hours: [7, 20] }),
  c("commute", "tip", "車間距離をとるだけで、ブレーキを踏む回数がぜんぜん違う"),
  c("commute", "commute", "雨の日の首都高、みんな車間とってて偉い", { sky: "rain", days: "weekday" }),
  c("commute", "commute", "金曜の夕方はどこも混む。のんびり帰ります", { dow: [5], hours: [16, 20] }),
  c("commute", "commute", "月曜の朝はなぜか流れがいい気がする", { dow: [1], hours: [6, 10] }),
  c("commute", "police", "白バイが流してた。こういう日はみんな制限速度ぴったり", { cue: "shirobai" }),
  c("commute", "traffic", "前の車のブレーキランプが一斉に赤くなる瞬間、渋滞の始まり", { cue: "jam" }),
  c("commute", "commute", "今日は{ward}経由。下道も悪くない", { hours: [7, 20] }),
  c("commute", "police", "覆面パトカー、見た目じゃほんとにわからない", { cue: "unmarked" }),

  c("teacher", "tip", "教習所で習ったこと、忘れてる人多いよね。左折は左に寄せてから"),
  c("teacher", "tip", "「だろう運転」じゃなくて「かもしれない運転」。何年たっても基本はこれ"),
  c("teacher", "tip", "雨の日の右折は、対向車のライトで歩行者が見えにくくなります。ゆっくりね", {
    sky: "rain",
  }),
  c("teacher", "tip", "教え子から「横断歩道で止まったら会釈された」と報告。うれしいね"),
  c("teacher", "tip", "車間距離は「前の車が通った所を2秒後に通る」くらいが目安"),
  c("teacher", "tip", "夕方は「もう見えてる」と思わずに、ライトを早めにね", { light: DUSK }),
  c("teacher", "tip", "新年度。初心者マークの車にはやさしくね", { periods: ["newFiscal"] }),

  c("cafe", "cafe", "朝のコーヒー☕ 今日もがんばろう", { picture: "coffee", hours: [6, 11] }),
  c("cafe", "cafe", "午後の休憩。ラテアートかわいい", { picture: "coffee", hours: [13, 18] }),
  c("cafe", "cafe", "雨の日のカフェ、窓際の席が特等席", { picture: "coffee", sky: "rain", hours: [8, 18] }),
  c("cafe", "cafe", "ホットの季節がやってきた", { picture: "coffee", temp: [-10, 18], hours: [7, 17] }),
  c("cafe", "cafe", "アイスラテがおいしい季節", { picture: "coffee", temp: [24, 45], hours: [7, 18] }),
  c("cafe", "cafe", "週末の朝はゆっくりモーニング", { picture: "coffee", days: "weekend", hours: [7, 11] }),
  c("cafe", "cafe", "{ward}の喫茶店でひと休み", { picture: "coffee", hours: [9, 18] }),

  // --- office workers ---
  c("office", "commute", "月曜の満員電車、もう少しなんとかならないものか", { dow: [1], hours: [7, 10] }),
  c("office", "work", "やっと金曜。今週もおつかれ自分", { dow: [5], hours: [17, 23] }),
  c("office", "food", "ランチは{lunch}。午後もがんばる", { hours: [11, 14], days: "weekday" }),
  c("office", "work", "外回りで{ward}まで来た。歩くといい運動になる", { days: "weekday", hours: [10, 17] }),
  c("office", "rain", "傘忘れた。会社から駅まで走るしかない", {
    sky: "rain",
    days: "weekday",
    hours: [17, 21],
  }),
  c("office", "night", "残業おわり。{ward}の夜景で元気出す", {
    picture: "nightCity",
    hours: [20, 24],
    days: "weekday",
  }),
  c("office", "work", "在宅勤務の日は通勤時間がまるごと自由。最高", { days: "weekday", hours: [8, 11] }),
  c("office", "food", "今日のお弁当。昨日の残りを詰めただけ", {
    picture: "bento",
    hours: [11, 14],
    days: "weekday",
  }),
  c("office", "work", "{ward}のオフィス街、昼休みは人がどっと出てくる", { hours: [12, 13], days: "weekday" }),
  c("office", "sky", "定時で帰れる日の空は青い", {
    hours: [17, 19],
    light: ["day", "dusk"],
    sky: "dry",
    days: "weekday",
  }),
  c("office", "work", "社用車で移動中。安全運転で行きます", { days: "weekday", hours: [9, 17] }),

  // --- students ---
  c("student", "school", "1限に間に合う気がしない", { days: "weekday", hours: [7, 9], periods: ["school"] }),
  c("student", "school", "課題終わらない…カフェで粘る", { hours: [13, 22] }),
  c("student", "food", "学食の{lunch}、安くてうまい", {
    hours: [11, 14],
    days: "weekday",
    periods: ["school"],
  }),
  c("student", "night", "バイト帰り、{ward}の夜道は静か", { hours: [21, 2] }),
  c("student", "school", "テスト期間なのに部屋の掃除がはかどる", { periods: ["exams"] }),
  c("student", "school", "夏休み入った！なにしよう", { periods: ["summerBreak"], weight: 0.6 }),
  c("student", "school", "ゼミの発表、なんとか終わった", {
    days: "weekday",
    hours: [15, 20],
    periods: ["school"],
  }),
  c("student", "bike", "自転車で{nearWard}まで行ってみた。意外と近い", { sky: "dry", light: DAYTIME }),
  c("student", "school", "学園祭の準備で毎日遅くまで残ってる", { periods: ["gakusai"] }),

  // --- parents ---
  c("parent", "kids", "ベビーカーで{park}まで散歩。いい天気", {
    picture: "park",
    sky: "dry",
    light: DAYTIME,
  }),
  c("parent", "rain", "保育園のお迎え、雨だとレインカバーと格闘", {
    sky: "rain",
    days: "weekday",
    hours: [16, 19],
  }),
  c("parent", "bus", "子どもが路線バスに手を振ったら、運転手さんが振り返してくれた。神", { cue: "bus" }),
  c("parent", "kids", "横断歩道で止まってくれる車にはお辞儀するようにしてる。子どもも真似するようになった"),
  c("parent", "kids", "運動会の場所取り、朝から戦い", {
    periods: ["undokai"],
    days: "weekend",
    hours: [6, 12],
  }),
  c("parent", "police", "子どもが白バイを見て大興奮。かっこいいもんね", { cue: "shirobai" }),
  c("parent", "kids", "ベビーカーだと段差の多い道はつらい。{town}は歩道が広くて助かる", { light: LIT }),
  c("parent", "kids", "公園で{flower}が咲いてた。子どもが「きれい」って", {
    picture: "flower",
    light: DAYTIME,
  }),
  c("parent", "kids", "寝かしつけ完了。今日もおつかれさま、自分", { hours: [20, 23] }),
  c("parent", "kids", "ハロウィンの衣装、手作りに挑戦中", { periods: ["halloween"] }),

  // --- couriers ---
  c("courier", "work", "今日の配達ルート、{ward}から{nearWard}へ。坂が多い", {
    days: "weekday",
    hours: [9, 19],
  }),
  c("courier", "rain", "雨の日の荷物、濡らさないのが一番気をつかう", { sky: "rain", hours: [9, 20] }),
  c("courier", "work", "再配達ゼロの日は気分がいい", { hours: [17, 21] }),
  c("courier", "work", "路駐してる車が多くて、荷物を下ろす場所がない…", { hours: [9, 18] }),
  c("courier", "work", "年末の荷物の量、すごい", { periods: ["yearEnd", "christmas"] }),
  c("courier", "heat", "暑すぎる。水分とってがんばる", { temp: [29, 45], light: DAYTIME }),
  c("courier", "future", "自動運転タクシーとすれ違った。運転席が空っぽなの、まだ慣れない", {
    cue: "robotaxi",
  }),

  // --- taxi drivers ---
  c("taxi", "work", "雨の日はお客さんが多い。安全運転で稼ぎます", { sky: "rain" }),
  c("taxi", "landmark", "今日は{landmark}の近くまでお客さんを。観光の方でした"),
  c("taxi", "night", "深夜の{ward}、静か。週末だけは別", { hours: [0, 4] }),
  c("taxi", "traffic", "渋滞にはまるとお客さんに申し訳なくなる", { cue: "jam" }),
  c("taxi", "future", "自動運転のタクシーを見かけた。商売敵だけど、運転は丁寧だった", { cue: "robotaxi" }),
  c("taxi", "police", "白バイがいる日はみんな行儀がいい。毎日そうならいいのに", { cue: "shirobai" }),
  c("taxi", "landmark", "海外からのお客さん、{landmark}を見て大喜びしてた", { weight: 0.7 }),
  c("taxi", "work", "朝の駅前、タクシー待ちの行列がすごい", { hours: [7, 9], days: "weekday" }),
  c("taxi", "night", "金曜の夜は終電後が勝負", { dow: [5, 6], hours: [23, 3] }),

  // --- bus and train fans ---
  c("busfan", "bus", "{ward}で路線バスとすれ違った。今日もちゃんと走ってる", { cue: "bus", picture: "bus" }),
  c("busfan", "bus", "バスの一番前の席、景色が最高", { picture: "bus", light: DAYTIME }),
  c("busfan", "bus", "雨の日のバス、窓の水滴ごしの街がいい", { sky: "rain", picture: "bus" }),
  c("busfan", "bus", "バス停の時刻表を見るだけで一時間つぶせる"),
  c("busfan", "bus", "夜のバス、車内の明かりがきれい", { cue: "bus", light: DARK, picture: "bus" }),
  c("busfan", "bus", "電車の見える部屋に住みたい", { picture: "train" }),
  c("busfan", "bus", "{river}を渡る電車、いい音", { picture: "train", light: LIT }),

  // --- cyclists ---
  c("cyclist", "bike", "向かい風の日は修行", { sky: "dry" }),
  c("cyclist", "bike", "雨の日はさすがに電車。カッパで走るのはもう卒業", {
    sky: "rain",
    days: "weekday",
    hours: [6, 9],
  }),
  c("cyclist", "bike", "自転車レーン、路駐の車でふさがれてる…", { hours: [7, 20] }),
  c("cyclist", "bike", "{river}沿いを走ると気持ちいい", { light: DAYTIME, sky: "dry" }),
  c("cyclist", "bike", "自転車も車両。信号は守ろう、自分も含めて"),
  c("cyclist", "bike", "ヘルメット、慣れるとかぶらないと落ち着かない"),
  c("cyclist", "bike", "秋は自転車がいちばん気持ちいい季節", { seasons: ["autumn"], sky: "dry" }),

  // --- older people out walking ---
  c("elder", "walk", "今朝も{park}まで散歩しました。{flower}がきれいに咲いていました", {
    picture: "flower",
    hours: [5, 10],
    sky: "dry",
  }),
  c("elder", "misc", "孫にスマホの使い方を教わりました。こうして書き込めるようになりました", { weight: 0.4 }),
  c("elder", "walk", "横断歩道で車が止まってくれました。ありがたいことです"),
  c("elder", "season", "金木犀のよい香りがします。秋ですね", { periods: ["kinmokusei"] }),
  c("elder", "heat", "今日は暑いので、散歩は夕方にします", { temp: [28, 45] }),
  c("elder", "walk", "{river}の土手を歩きました。風が気持ちいいです", { light: DAYTIME, sky: "dry" }),
  c("elder", "tv", `雨なので家で「${TV_NATURE}」を見ています。きれいな映像です`, {
    sky: "rain",
    hours: [6, 22],
  }),
  c("elder", "season", "年の瀬ですね。大掃除はほどほどにします", { periods: ["yearEnd"] }),

  // --- visitors ---
  c("tourist", "tourist", "初めての東京。{landmark}が見えてテンション上がる"),
  c("tourist", "tourist", "{ward}の街並み、テレビで見たとおり", { light: LIT }),
  c("tourist", "tourist", "東京の人、歩くの速い", { light: DAYTIME }),
  c("tourist", "tourist", "案内標識に「{sign}」って出てた。行ってみようかな"),
  c("tourist", "tourist", "赤レンガの駅舎、本物は迫力がすごい", { landmark: "東京駅丸の内駅舎" }),
  c("touristEn", "touristEn", "Tokyo Tower from {wardEn}! Can't stop taking pictures 🗼", {
    landmark: "東京タワー",
    picture: "skyline",
  }),
  c("touristEn", "touristEn", "The streets in {wardEn} are so clean. And so quiet!", { light: LIT }),
  c("touristEn", "touristEn", "Road signs here have English too. Following the ones to {signEn} 👍"),
  c("touristEn", "touristEn", "Rainy Tokyo is still beautiful. Umbrellas everywhere ☔", {
    sky: "rain",
    picture: "umbrella",
  }),
  c("touristEn", "touristEn", "Just saw a taxi with nobody in the driver's seat. The future is here.", {
    cue: "robotaxi",
  }),
  c("touristEn", "touristEn", "Cars actually stop for you at crosswalks here. Love it."),
  c("touristEn", "touristEn", "Tokyo at night is something else.", { picture: "nightCity", light: DARK }),
  c("touristZh", "touristZh", "第一次在{ward}看到东京塔，太美了！", {
    landmark: "東京タワー",
    picture: "skyline",
  }),
  c("touristZh", "touristZh", "东京的街道好干净，过马路的时候车都会停下来"),
  c("touristZh", "touristZh", "下雨的东京也很有感觉", { sky: "rain", picture: "umbrella" }),
  c("touristZh", "touristZh", "晴空塔真的好高！从{ward}都看得到", { landmark: "東京スカイツリー" }),
  c("touristZh", "touristZh", "看到了没有司机的出租车，太神奇了", { cue: "robotaxi" }),
  c("touristZh", "touristZh", "晚上的东京好漂亮", { picture: "nightCity", light: DARK }),

  // --- people with a camera ---
  c("photographer", "photo", "{landmark}、今日は空気が澄んでて輪郭がくっきり", {
    sky: "dry",
    light: DAYTIME,
  }),
  c("photographer", "photo", "雨の夜の路面に映る信号の色。この季節の楽しみ", {
    picture: "rainStreet",
    sky: "rain",
    light: DARK,
  }),
  c("photographer", "photo", "{bridge}からの{river}。夕方の光がちょうどいい", {
    picture: "river",
    light: DUSK,
    sky: "dry",
  }),
  c("photographer", "photo", "うろこ雲。秋の空は撮っていて飽きない", {
    picture: "clouds",
    seasons: ["autumn"],
    sky: "dry",
    light: DAYTIME,
  }),
  c("photographer", "photo", "横断歩道の白と影のコントラスト、好き", {
    picture: "crossing",
    light: DAYTIME,
    sky: "dry",
  }),
  c("photographer", "photo", "傘の花が咲く交差点", { picture: "umbrella", sky: "rain", light: LIT }),
  c("photographer", "photo", "紅葉、色づき始めました", { picture: "leaves", periods: ["koyo"] }),
  c("photographer", "night", "夜の{ward}。ビルの窓明かりが星みたい", { picture: "nightCity", light: DARK }),
  c("photographer", "photo", "{park}の木漏れ日", { picture: "park", light: DAYTIME, sky: "dry" }),
  c("photographer", "photo", "夕焼けと{landmark}のシルエット", {
    picture: "sunset",
    light: DUSK,
    sky: "dry",
  }),

  // --- food lovers ---
  c("foodie", "food", "今日のおやつは{snack}", { picture: "snack", hours: [14, 18] }),
  c("foodie", "food", "{ward}で見つけた定食屋さん、ご飯おかわり自由で最高", { hours: [11, 14] }),
  c("foodie", "food", "新米の季節。白いご飯だけで幸せ", { seasons: ["autumn"], picture: "bento" }),
  c("foodie", "food", "夕飯は{dinner}を作った。うまくできた", { hours: [18, 22] }),
  c("foodie", "food", "雨の日は家で{dinner}", { sky: "rain", hours: [17, 22] }),
  c("foodie", "food", "かき氷の季節がやってきた", { seasons: ["summer"], picture: "snack", temp: [26, 45] }),
  c("foodie", "food", "焼き芋の屋台の声が聞こえた。寒くなってきたなあ", {
    temp: [-10, 14],
    seasons: ["autumn", "winter"],
  }),
  c("foodie", "food", "お弁当作った。彩りはがんばった", { picture: "bento", hours: [6, 9] }),

  // --- night shift ---
  c("nightshift", "work", "夜勤明け。朝日がまぶしい", { hours: [6, 9], light: ["dawn", "day"], sky: "dry" }),
  c("nightshift", "work", "夜勤入ります。{ward}の夜は意外と救急車が多い", { hours: [20, 23] }),
  c("nightshift", "night", "深夜の休憩。静かな街で信号だけが変わり続けてる", {
    hours: [1, 5],
    picture: "nightCity",
  }),
  c("nightshift", "food", "夜勤明けのラーメンは罪の味", { hours: [7, 11], picture: "ramen" }),
  c("nightshift", "sky", "明け方の空のグラデーション、夜勤の特権", {
    light: ["dawn"],
    picture: "clouds",
    sky: "dry",
  }),
  c("nightshift", "tv", `寝る前に「${TV_NEWS}」をつけてる`, { hours: [5, 10] }),

  // --- driving instructors ---
  c("instructor", "tip", "S字とクランク、今でも夢に出るって元教習生に言われた"),
  c("instructor", "tip", "雨の日の教習は、ワイパーの使い方から", { sky: "rain" }),
  c("instructor", "tip", "初心者のうちは、知ってる道でもナビの声に頼りすぎないこと"),
  c("instructor", "season", "教習所の外周、紅葉がきれいな季節", { periods: ["koyo"], picture: "leaves" }),
  c("instructor", "tip", "一時停止の練習。止まる位置は停止線の手前ですよ"),

  // --- truck drivers ---
  c("trucker", "night", "深夜の幹線道路、トラックばっかり", { hours: [0, 5] }),
  c("trucker", "work", "{sign}方面へ。今日も長距離", { hours: [4, 10] }),
  c("trucker", "tip", "雨の日は特に、大型車の死角に気をつけてほしい", { sky: "rain" }),
  c("trucker", "tip", "高い運転席から見ると、無理な割り込みがよく見える"),
  c("trucker", "sky", "朝焼けの中を走るのが好き", { light: ["dawn"], sky: "dry" }),

  // --- runners and riders ---
  c("runner", "walk", "朝ラン。{river}沿いは信号がなくて走りやすい", { hours: [5, 8] }),
  c("runner", "rain", "雨の日はお休み。ストレッチだけ", { sky: "rain" }),
  c("runner", "walk", "走るにはちょうどいい気温", { temp: [10, 20], sky: "dry" }),
  c("runner", "night", "夜ランは反射材が必須。車から見えないので", { light: DARK }),
  c("rider", "bike", "ツーリング日和", { days: "weekend", sky: "dry", light: DAYTIME }),
  c("rider", "rain", "雨の日のバイクは修行", { sky: "rain" }),
  c("rider", "bike", "すり抜けはしない派です"),
  c("rider", "cold", "秋の夜はバイクだと寒い。ジャケット出した", { seasons: ["autumn"], light: DARK }),

  // --- dog and cat people ---
  c("dogwalker", "animal", "朝の散歩。うちの子は{park}が大好き", {
    picture: "dog",
    hours: [5, 9],
    sky: "dry",
  }),
  c("dogwalker", "animal", "雨で散歩に行けず、ふてくされてる", { picture: "dog", sky: "rain" }),
  c("dogwalker", "animal", "暑いのでアスファルトが冷めてから散歩", { temp: [27, 45], hours: [17, 21] }),
  c("dogwalker", "animal", "横断歩道で待ってたら車が止まってくれて、犬もお辞儀（したように見えた）"),
  c("dogwalker", "animal", "落ち葉の上を歩くのが好きらしい", {
    picture: "dog",
    seasons: ["autumn"],
    light: LIT,
  }),
  c("catlover", "animal", "猫が窓辺で雨を見てる", { picture: "cat", sky: "rain" }),
  c("catlover", "animal", "保護猫の譲渡会、今週末あります", { days: "weekday", weight: 0.5 }),
  c("catlover", "animal", "ひざの上から動いてくれない。在宅勤務の日でよかった", {
    picture: "cat",
    days: "weekday",
    hours: [9, 18],
  }),

  // --- at home and in the shops ---
  c("homemaker", "rain", "洗濯物、外に干したら降ってきた", { cue: "rainStart" }),
  c("homemaker", "food", "今日の夕飯は{dinner}", { hours: [16, 20] }),
  c("homemaker", "walk", "買い物の帰りに{ward}の商店街をぶらぶら", { hours: [10, 18] }),
  c("homemaker", "season", "ベランダのミニトマトが赤くなった", { seasons: ["summer"], picture: "flower" }),
  c("homemaker", "season", "衣替えをしないといけない季節", { periods: ["koromogae"] }),
  c("shopkeeper", "season", "商店街にハロウィンの飾りつけ。子どもたちが喜んでる", { periods: ["halloween"] }),
  c("shopkeeper", "rain", "雨の日は店の前に傘立てを出します", { sky: "rain", hours: [9, 19] }),
  c("shopkeeper", "work", "今日も開店。{ward}の朝は早い", { hours: [7, 10] }),
  c("shopkeeper", "season", "年末の売り出しの準備中。今年もありがとうございました", { periods: ["yearEnd"] }),

  // --- people who love cars ---
  c("carfan", "rain", "洗車した日に限って雨", { sky: "rain" }),
  c("carfan", "commute", "週末ドライブ。{sign}方面へ", { days: "weekend" }),
  c("carfan", "landmark", "{landmark}が見える道を走るのが好き"),
  c("carfan", "praise", "安全運転してる車ってかっこいい"),
  c("carfan", "police", "オービスが光るのを初めて見た。前の車…", { cue: "orbis" }),
  c("carfan", "season", "冬用タイヤの準備しないと", { seasons: ["winter"], weight: 0.5 }),

  // --- the school-road volunteers ---
  c("volunteer", "kids", "今朝も通学路の見守り。子どもたちのあいさつが元気", {
    days: "weekday",
    hours: [7, 9],
    periods: ["school"],
  }),
  c("volunteer", "kids", "通学路の時間帯に車が入ってきて、ヒヤッとしました。標識を守ってください", {
    cue: "closure",
  }),
  c("volunteer", "rain", "雨の日の登校は傘で前が見えにくいので、車の方は特に注意を", {
    sky: "rain",
    days: "weekday",
    hours: [7, 9],
    periods: ["school"],
  }),
  c("volunteer", "kids", "下校の時間です。子どもが急に飛び出すことがあります", {
    days: "weekday",
    hours: [14, 17],
    periods: ["school"],
  }),

  // --- everyone else ---
  c("local", "commute", "電車遅れてる…", {
    hours: [6, 23],
    replies: ["こっちも止まってる", "今日は早めに出て正解だった"],
  }),
  c("local", "landmark", "東京タワー見えた🗼", { picture: "skyline", landmark: "東京タワー" }),
  c("local", "season", "桜が咲いてた🌸", { picture: "flower", periods: ["sakura"], hours: [6, 18] }),
  c("local", "misc", "新しい車きた！大事に乗る🚗", { picture: "car", hours: [9, 21] }),
  c("local", "walk", "今日めちゃくちゃ歩いた。2万歩", { hours: [17, 24] }),
  c("local", "traffic", "渋滞にハマった。音楽聴きながら気長に待つ", { cue: "jam" }),
  c("local", "praise", "横断歩道で止まってくれる車が増えた気がする。ありがたい"),
  c("local", "sky", "富士山くっきり", { picture: "fuji", hours: [6, 16], sky: "dry" }),
  c("local", "food", "ランチはラーメン", { picture: "ramen", hours: [11, 14] }),
  c("local", "police", "{ward}、パトカーと白バイが次々に走っていった。何事？", { cue: "manhunt" }),
  c("local", "police", "ヘリの音がずっと近い。{ward}で何かあったのかな", { cue: "heli" }),
  c("local", "police", "{ward}の交差点で検問してた。今日なにかあったの？", { cue: "checkpoint" }),
  c("local", "police", "{ward}、パトカーがサイレン鳴らして走っていった。何かあったのかな", {
    cue: "pursuit",
  }),
  c("local", "police", "近くでオービスが光ったのを見た。昼でもけっこう明るい", { cue: "orbis" }),
  c("local", "police", "救急車のサイレンが近い。{ward}で事故かな", { cue: "crash" }),
  c("local", "police", "白バイを見かけた。かっこいい", { cue: "shirobai" }),
  c("local", "police", "パトカーとすれ違った。何もしてないのにドキッとする", { cue: "patrol" }),
  c("local", "police", "さっきの車、たぶん覆面パトカーだった。後ろの窓のあたりが怪しかった", {
    cue: "unmarked",
  }),
  c("local", "tv", `${NATURE_CH.number}ch、もう放送休止のカラーバーになってた。夜ふかししすぎ`, {
    hours: [1, 5],
  }),
  c("local", "tv", `「${TV_NATURE}」、今日の回よかった`, { hours: [19, 24] }),
  c("local", "tv", `ナビの${TV_WEATHER}で{ward}の天気を確認。便利`, { hours: [6, 22] }),
  c("local", "rain", "雨やんだ！傘いらなかった", { cue: "rainStop" }),
  c("local", "rain", "降ってきた〜傘持ってない", { cue: "rainStart" }),
  c("local", "season", "金木犀の香りがすると秋だなって思う", { periods: ["kinmokusei"] }),
  c("local", "season", "花粉がつらい。目がかゆい", { periods: ["pollen"] }),
  c("local", "season", "梅雨、洗濯物が乾かない", { seasons: ["rainy"] }),
  c("local", "heat", "暑すぎて溶けそう", { temp: [30, 45] }),
  c("local", "cold", "急に寒くなった。上着出さなきゃ", { temp: [-10, 14], seasons: ["autumn", "winter"] }),
  c("local", "season", "ハロウィンの仮装の人をちらほら見かける", { periods: ["halloween"], hours: [17, 24] }),
  c("local", "season", "年末の空気、なんか好き", { periods: ["yearEnd"] }),
  c("local", "season", "あけましておめでとうございます。今年も安全運転で", { periods: ["newYear"] }),
  c("local", "season", "桜、満開！", { periods: ["sakura"], picture: "flower", sky: "dry" }),
  c("local", "landmark", "{ward}から{landmark}が見えるの、地味にうれしい"),
  c("local", "night", "{town}のあたり、夜は静かでいい", { light: DARK }),
  c("local", "misc", "日曜の夕方の、明日が来る感じ…", { dow: [0], hours: [16, 21] }),
  c("local", "food", "帰りに{snack}買って帰る", { hours: [15, 23] }),
  c("local", "traffic", "近くの交差点の信号、待ち時間が長い"),
  c("local", "sky", "今日の空、雲が面白い形してる", { picture: "clouds", sky: "dry", light: DAYTIME }),
  c("local", "rain", "雨の日の交差点、傘がいっぱい", { picture: "umbrella", sky: "rain", light: LIT }),
  c("local", "walk", "{river}の水面がきらきら", { picture: "river", light: DAYTIME, sky: "dry" }),
  c("local", "bus", "バスが来ない…と思ったら2台まとめて来た", { cue: "bus" }),
  c("local", "praise", "救急車に道を譲る車がきれいに左に寄ってた。すごい", { weight: 0.6 }),
  c("local", "future", "自動運転タクシー、本当に運転席に誰もいないまま曲がっていった", { cue: "robotaxi" }),
  c("local", "walk", "この時間の{ward}、人が少なくて好き", { hours: [5, 7] }),
  c("local", "walk", "{nearWard}まで歩いてみた。東京、区の境目がわからない", { light: LIT }),

  // --- the small hours ---
  c("nightshift", "work", "夜の病棟は静か。ナースコールが鳴らない夜はありがたい", { hours: [0, 5] }),
  c("nightshift", "food", "夜勤の休憩におにぎり。具は鮭", { hours: [0, 5] }),
  c("nightshift", "night", "見回り中。ビルの窓から見える首都高の明かりがきれい", {
    hours: [22, 5],
    picture: "nightCity",
  }),
  c("taxi", "night", "深夜は道が空いてる。でも飛ばさない", { hours: [0, 5] }),
  c("taxi", "rain", "雨の深夜は特にお客さんが多い", { hours: [22, 4], sky: "rain" }),
  c("taxi", "work", "夜中に乗ったお客さん、すぐ寝ちゃった。起こすのが一番むずかしい", { hours: [0, 5] }),
  c("trucker", "work", "夜明け前の湾岸、トラックの列", { hours: [3, 6] }),
  c("trucker", "work", "仮眠明け。コーヒーで目を覚ます", { hours: [2, 6] }),
  c("student", "school", "レポートの締め切りまであと3時間", { hours: [0, 4] }),
  c("student", "food", "夜中のラーメン動画は罪", { hours: [23, 3] }),
  c("local", "night", "眠れない夜", { hours: [1, 4] }),
  c("local", "night", "夜中の{ward}、遠くで救急車の音がする", { hours: [0, 5] }),
  c("local", "night", "この時間の信号、誰もいないのに律儀に変わってる", { hours: [1, 5] }),
  c("local", "night", "夜風が気持ちいい", { hours: [21, 3], sky: "dry", seasons: ["summer", "autumn"] }),
  c("cat", "animal", "夜中に顔の上を歩かれた", { picture: "cat", hours: [2, 6] }),
  c("news", "news", "【交通】深夜は速度超過による事故が増える傾向があります。制限速度を守りましょう", {
    hours: [0, 5],
  }),
  c("news", "news", "【交通】夜間は歩行者が見えにくくなります。ライトは早めに、上向きも使い分けて", {
    light: DARK,
  }),
  c("busfan", "bus", "最終バスを見送った。今日もおつかれさまでした", { hours: [23, 1] }),
  c("foodie", "food", "夜食はお茶漬け", { hours: [22, 2] }),
  c("rider", "bike", "深夜の幹線道路、空いてて気持ちいい（制限速度で）", { hours: [22, 3], sky: "dry" }),
  c("photographer", "photo", "雨上がりの夜、路面に信号の色が映ってた", {
    picture: "rainStreet",
    light: DARK,
    cue: "rainStop",
  }),

  // --- about the player, when they drive well in front of people (SocialFeed.maybePraise) ---
  c(
    "parent",
    "praise",
    "ベビーカーで横断歩道の前にいたら、{color}{car}がちゃんと止まってくれた。ありがとうございます",
    {
      cue: "yieldPedestrian",
    },
  ),
  c("elder", "praise", "{town}の横断歩道で、車が止まって待っていてくれました。ゆっくり渡れました", {
    cue: "yieldPedestrian",
  }),
  c("student", "praise", "横断歩道で止まってくれた車の人、会釈したら手を挙げてくれた。いい人", {
    cue: "yieldPedestrian",
  }),
  c("local", "praise", "信号のない横断歩道で止まってくれる車、{town}にもいた。えらい", {
    cue: "yieldPedestrian",
  }),
  c("dogwalker", "praise", "犬と横断歩道で待ってたら、{color}{car}が止まってくれた。助かります", {
    cue: "yieldPedestrian",
  }),
  c("touristEn", "praise", "A car stopped for me at a crosswalk in {wardEn}. Tokyo drivers are so polite.", {
    cue: "yieldPedestrian",
  }),
  c("touristZh", "praise", "在{ward}过马路，车主动停下来让我先走，好感动", { cue: "yieldPedestrian" }),
  c("instructor", "praise", "横断歩道の手前できちんと止まる車を見た。教習所のお手本みたいだった", {
    cue: "yieldPedestrian",
  }),
  c("volunteer", "praise", "子どもたちが渡りきるまで待ってくれた車がいました。ありがとうございます", {
    cue: "yieldPedestrian",
    hours: [7, 17],
  }),
  c("teacher", "praise", "「止まれ」で完全に止まってから左右を見る車がいた。見本みたいだった", {
    cue: "fullStop",
  }),
  c("local", "praise", "一時停止でちゃんと止まる車、久しぶりに見た気がする。{town}の角で", {
    cue: "fullStop",
  }),
  c("cyclist", "praise", "一時停止で止まってくれる車がいると、自転車も安心して通れる", { cue: "fullStop" }),
  c("taxi", "praise", "今の{color}{car}の一時停止、きれいだった。見習わないと", { cue: "fullStop" }),
  c("elder", "praise", "角で車がきちんと止まってくれるので、安心して歩けます", { cue: "fullStop" }),
  c("instructor", "praise", "停止線の手前でぴたっと止まる車。こういう運転が増えてほしい", {
    cue: "fullStop",
  }),
];

/** Replies people leave under everyday posts, by topic ({landmark} etc. as in the post). */
export const CHATTER_REPLIES: Record<ChatterTopic, readonly string[]> = {
  sky: [
    "きれい…",
    "同じ空を見てました",
    "こっちからも見えました",
    "空の写真いいなあ",
    "今日の空、ほんとにいいですよね",
  ],
  rain: [
    "こっちも降ってきた",
    "傘持ってない…",
    "足元に気をつけて",
    "雨の日の運転、気をつけましょう",
    "早く止むといいですね",
  ],
  heat: ["溶ける…", "水分補給しましょう", "外に出たくない暑さ", "日傘が手放せない"],
  cold: ["寒い！", "上着出しました", "あったかくしてくださいね", "朝晩冷えますね"],
  season: ["季節を感じますね", "もうそんな時期か", "いい季節ですね", "毎年あっという間"],
  food: ["おいしそう", "飯テロ…", "お腹すいた", "どこのお店ですか？", "今日それにしよう"],
  cafe: ["いい時間", "落ち着きますね", "朝のコーヒー大事", "真似したい"],
  animal: ["かわいい", "癒された", "お名前は？", "うちの子も同じことしてる", "毎日見に来てます"],
  commute: ["わかる", "おつかれさまです", "それな", "明日もがんばりましょう", "通勤ほんとにしんどい"],
  traffic: ["情報助かります", "迂回します", "今そこ通ってる", "混んでますね…", "ありがとうございます"],
  tip: [
    "勉強になります",
    "意外と知らなかった",
    "気をつけます",
    "保存しました",
    "条文まで書いてあるのありがたい",
  ],
  news: ["了解です", "気をつけます", "通る予定だった、助かる", "情報ありがとうございます"],
  police: [
    "何があったんだろう",
    "近くにいる。サイレンすごい",
    "気をつけて",
    "白バイかっこいい",
    "自分も安全運転しよう",
  ],
  bus: ["バスいいですよね", "わかる、一番前の席", "運転手さんに感謝", "バス好きとして同意"],
  work: ["おつかれさまです", "えらい", "無理しないでね", "応援してます"],
  school: ["がんばれ〜", "懐かしい", "わかる", "単位は大事"],
  kids: ["かわいい", "ほっこりした", "うちもです", "子どもって真似するよね"],
  night: ["きれいな夜", "夜ふかし仲間", "気をつけて帰ってね", "静かな夜っていいですよね"],
  landmark: ["いい眺め", "見えると得した気分", "今日はよく見えますね", "{landmark}好き"],
  tv: ["見てた！", "あの番組いいよね", "録画しよう", "ナビで音だけ聞いてた"],
  bike: ["安全運転で", "わかる", "自転車が気持ちいい季節", "ヘルメット大事"],
  walk: ["いい散歩", "健康的", "気持ちよさそう", "歩くの大事"],
  photo: ["いい写真", "構図が好き", "保存しました", "どうやって撮ってるんですか？"],
  future: ["未来だ", "見てみたい", "乗ってみたい", "運転席が空っぽなの、不思議な感じ"],
  praise: [
    "こういう運転、増えてほしい",
    "当たり前だけど、その当たり前がうれしいよね",
    "止まってくれると思わず会釈しちゃう",
    "お手本みたいな運転",
    "やさしい世界",
    "止まってくれる車、最近ちょっと増えた気がする",
    "止まるのは義務だけど、ちゃんと守る人は好き",
    "教習所の動画に使えそう",
    "こういうポストがもっと伸びてほしい",
  ],
  tourist: ["楽しんでください！", "東京へようこそ", "いい旅を", "{landmark}おすすめです"],
  touristEn: ["Welcome to Tokyo!", "Enjoy your trip 🙌", "楽しんでね！", "Glad you like it here"],
  touristZh: ["欢迎来东京！", "玩得开心！", "楽しんでください！"],
  misc: ["わかる", "それな", "いいね", "ほんとそれ"],
};

/**
 * The poster thanking or answering someone under their own everyday post: `careful` under posts
 * about traffic, weather and safety (where 「うれしいです」 would sound odd), `ja` under the rest.
 */
export const CHATTER_ANSWERS: Record<"ja" | "careful" | "en" | "zh", readonly string[]> = {
  ja: ["ありがとうございます！", "ですよね", "うれしいです", "ありがとうございます😊"],
  careful: ["ありがとうございます！", "ですよね", "お互い気をつけましょう"],
  en: ["Thank you!", "Haha, right?", "Will do!"],
  zh: ["谢谢！", "哈哈是的", "好的！"],
};
/** Topics whose posters answer with CHATTER_ANSWERS.careful. */
export const CAREFUL_TOPICS: readonly ChatterTopic[] = [
  "rain",
  "heat",
  "cold",
  "traffic",
  "tip",
  "news",
  "police",
  "commute",
  "work",
  "bike",
];

/** A word for a slot, with the seasons it belongs to (any when absent). */
export type Word = { text: string; seasons?: readonly Season[] };
const word = (text: string, ...seasons: Season[]): Word =>
  seasons.length > 0 ? { text, seasons } : { text };

/** Word lists for the slots of the same name. {color} {car} describe the player's car. */
export const WORDS: Record<"lunch" | "snack" | "dinner" | "flower" | "color" | "car", readonly Word[]> = {
  lunch: [
    word("生姜焼き定食"),
    word("カレー"),
    word("オムライス"),
    word("そば"),
    word("うどん"),
    word("親子丼"),
    word("ナポリタン"),
    word("焼き魚定食"),
    word("冷やし中華", "summer"),
    word("鍋焼きうどん", "winter"),
  ],
  snack: [
    word("どら焼き"),
    word("たい焼き"),
    word("大福"),
    word("せんべい"),
    word("プリン"),
    word("みたらし団子"),
    word("焼き芋", "autumn", "winter"),
    word("栗まんじゅう", "autumn"),
    word("アイス", "summer"),
    word("みかん", "winter"),
    word("桜もち", "spring"),
  ],
  dinner: [
    word("カレー"),
    word("肉じゃが"),
    word("餃子"),
    word("ハンバーグ"),
    word("焼き魚"),
    word("鍋", "autumn", "winter"),
    word("おでん", "autumn", "winter"),
    word("そうめん", "summer"),
    word("秋刀魚の塩焼き", "autumn"),
  ],
  flower: [
    word("菜の花", "spring"),
    word("チューリップ", "spring"),
    word("ツツジ", "spring"),
    word("紫陽花", "rainy"),
    word("ひまわり", "summer"),
    word("朝顔", "summer"),
    word("コスモス", "autumn"),
    word("金木犀", "autumn"),
    word("椿", "winter"),
    word("水仙", "winter"),
  ],
  color: [word("青い"), word("青っぽい"), word("ブルーの")],
  car: [word("コンパクトカー"), word("ハッチバック"), word("乗用車")],
};

/**
 * The 23 wards (and 「都内」, the posts' word for "somewhere in Tokyo") in English and Chinese: the
 * wards' own English names without "City" (as on the guide signs), and the Simplified forms of
 * their kanji. Town names (丸の内二丁目) have no such data and stay Japanese.
 */
export const WARD_NAMES: Readonly<Record<string, Record<Exclude<SocialLang, "ja">, string>>> = {
  千代田区: { en: "Chiyoda", zh: "千代田区" },
  中央区: { en: "Chuo", zh: "中央区" },
  港区: { en: "Minato", zh: "港区" },
  新宿区: { en: "Shinjuku", zh: "新宿区" },
  文京区: { en: "Bunkyo", zh: "文京区" },
  台東区: { en: "Taito", zh: "台东区" },
  墨田区: { en: "Sumida", zh: "墨田区" },
  江東区: { en: "Koto", zh: "江东区" },
  品川区: { en: "Shinagawa", zh: "品川区" },
  目黒区: { en: "Meguro", zh: "目黑区" },
  大田区: { en: "Ota", zh: "大田区" },
  世田谷区: { en: "Setagaya", zh: "世田谷区" },
  渋谷区: { en: "Shibuya", zh: "涩谷区" },
  中野区: { en: "Nakano", zh: "中野区" },
  杉並区: { en: "Suginami", zh: "杉并区" },
  豊島区: { en: "Toshima", zh: "丰岛区" },
  北区: { en: "Kita", zh: "北区" },
  荒川区: { en: "Arakawa", zh: "荒川区" },
  板橋区: { en: "Itabashi", zh: "板桥区" },
  練馬区: { en: "Nerima", zh: "练马区" },
  足立区: { en: "Adachi", zh: "足立区" },
  葛飾区: { en: "Katsushika", zh: "葛饰区" },
  江戸川区: { en: "Edogawa", zh: "江户川区" },
  都内: { en: "Tokyo", zh: "东京都内" },
};
/** The 23 wards in English, for visitors' posts ({wardEn}). */
export const WARD_EN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WARD_NAMES)
    .filter(([ja]) => ja.endsWith("区"))
    .map(([ja, names]) => [ja, names.en]),
);

/** The game's landmarks as people call them, and how far off they are still seen (km). */
export const LANDMARK_WORDS: Readonly<
  Record<string, { ja: string; en: string; zh: string; seenKm: number }>
> = {
  東京タワー: { ja: "東京タワー", en: "Tokyo Tower", zh: "东京塔", seenKm: 7 },
  東京スカイツリー: { ja: "スカイツリー", en: "Tokyo Skytree", zh: "晴空塔", seenKm: 10 },
  東京駅丸の内駅舎: { ja: "東京駅", en: "Tokyo Station", zh: "东京站", seenKm: 1.2 },
};
