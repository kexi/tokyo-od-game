import { SOCIAL_APP_NAME } from "./socialTheme";
import { CHANNELS, PROGRAMME_TITLE } from "./tvRules";

/**
 * English for Y (TRANSLATIONS.en in socialTexts.ts), keyed by the Japanese source text: what
 * people in Tokyo post, shown the way the app would show it translated. Written as posts, not
 * word for word: short, casual, civil; US spelling; hashtags in CamelCase without spaces.
 *
 * Slots stay as in the source. {place} comes in as 「芝公園四丁目, Minato」 (the town keeps its
 * Japanese), {time} as "around 11:30am", {color} {car} as "blue" "hatchback" (write "a {color}
 * {car}"), {kmh} {limit} as numbers (write "km/h"), {landmark} as "Tokyo Tower", {ward} as
 * "Chiyoda". Sentences do not start with {time} or {color}: they are lower case.
 *
 * The TV programmes are called what the navi's TV calls them (src/i18n/en.ts tv.programme.*).
 */
const TV_NEWS = PROGRAMME_TITLE.news;
const TV_WEATHER = PROGRAMME_TITLE.weather;
const TV_NATURE = PROGRAMME_TITLE.nature;
const NATURE_CH = CHANNELS[2];

export const SOCIAL_EN: Readonly<Record<string, string>> = {
  // ---------- openers: signal ----------
  "{place}で赤信号を突っ切っていった車がいた…": "A car just blew straight through a red light at {place}…",
  "信号無視の車、目の前を通過。{place}": "A car ran the red right in front of me. {place}",
  "{place}の交差点、完全に赤なのに突っ込んでいった車…":
    "The light at {place} was totally red and this car just went for it…",
  "え、今の赤だったよね？{color}{car}がそのまま交差点に入っていった。{place}":
    "Wait, that was red, right? A {color} {car} drove straight into the intersection. {place}",
  "歩行者側が青になった瞬間に車が突っ込んできた。こっちは止まってて無事。{place}":
    "The walk signal had just turned green when a car came barreling through. I'd stopped, so I'm fine. {place}",
  "{time}、{place}で信号無視。動画見てもらえばわかるけど、黄色じゃなくて完全に赤":
    "Red-light runner at {place}, {time}. Watch the video: not yellow, fully red.",
  "赤で交差点に入る車が撮れてしまった。{place}":
    "Ended up catching a car entering the intersection on red. {place}",
  "{place}で信号無視の車。右折待ちの車が急ブレーキ。誰もけがしなくてよかった":
    "Someone ran a red at {place}. A car waiting to turn right had to slam on the brakes. Glad nobody got hurt.",
  "信号って守るためにあるんですよ…{place}": "Traffic lights are there to be obeyed, you know… {place}",
  "{place}、赤信号で止まってた自転車の人もびっくりしてた。信号無視の{car}":
    "{place}: even the cyclist waiting at the red got a fright. A {car} running the light.",
  "とっさで撮れなかったけど、{place}で信号無視の車がいた。通る人は気をつけて":
    "Happened too fast to film, but a car ran a red at {place}. Careful if you're passing through.",

  // ---------- openers: speed ----------
  "{place}で明らかにスピード出しすぎの車。{kmh}キロくらい出てたと思う":
    "A car going way too fast at {place}. Must have been doing about {kmh} km/h.",
  "制限速度どこいった…{place}": "What happened to the speed limit… {place}",
  "{place}、{limit}キロ制限の道を{color}{car}がかっ飛ばしていった":
    "{place}: a {color} {car} tore down a {limit} km/h road.",
  "住宅街でそのスピードはないって。{place}": "That speed in a residential area? No way. {place}",
  "ドラレコの速度表示と比べても明らかに速い。{place}":
    "Even against my dashcam's speed readout it was clearly way faster. {place}",
  "抜かれたと思ったらもう見えなくなってた。{place}、{time}":
    "It passed me and was gone a second later. {place}, {time}",
  "{place}をすごい勢いで走っていく車。音でわかるレベル":
    "A car flying through {place}. You could tell just from the sound.",
  "スピード出てる車って、横にいると本当に怖い。{place}":
    "Being next to a speeding car is genuinely scary. {place}",
  "{place}。あの速度で人が飛び出してきたら止まれないと思う":
    "{place}. If someone stepped out at that speed, there's no way it could stop.",
  "撮る間もなかった。{place}をものすごいスピードで抜けていった車がいた":
    "No time to film it. A car went through {place} at a crazy speed.",

  // ---------- openers: pedestrianCrossing ----------
  "横断歩道を渡ってる人がいるのに止まらない車。{place}":
    "Someone was on the crosswalk and the car didn't stop. {place}",
  "横断歩道でお年寄りが渡ろうとしてたのに、スピードも落とさず通過していった車。{place}":
    "An elderly person was about to cross and the car went by without even slowing down. {place}",
  "横断歩道の前で手を挙げてる子がいたのに、{color}{car}が素通り。{place}":
    "A kid was waiting at the crosswalk with a hand up, and a {color} {car} just drove past. {place}",
  "信号のない横断歩道、止まってくれたのは後ろの車だけだった。{place}":
    "Crosswalk with no lights, and only the car behind stopped. {place}",
  "ベビーカーで渡ろうとしたら目の前を通過された…{place}":
    "Was about to cross with the stroller and a car shot right past in front of us… {place}",
  "横断歩道は歩行者優先ですよ。{place}": "Pedestrians have the right of way at crosswalks. {place}",
  "{place}の横断歩道、渡ってる途中の人のすぐ前を車が抜けていった":
    "At the crosswalk at {place}, a car cut right in front of someone halfway across.",
  "{time}、{place}の横断歩道で。渡り始めてたのに減速なし":
    "Crosswalk at {place}, {time}. I'd already started crossing and it didn't slow down at all.",

  // ---------- openers: noEntry ----------
  "一方通行を逆走してくる車がいた。{place}": "A car came the wrong way down a one-way street. {place}",
  "逆走車、普通に怖い。{place}": "Wrong-way drivers are seriously scary. {place}",
  "{place}の一方通行、{color}{car}が逆から入ってきた":
    "A {color} {car} came into the one-way street at {place} from the wrong end.",
  "一方通行の出口から入ってくる車を初めて見た。{place}":
    "First time I've seen a car drive in through the exit of a one-way street. {place}",
  "{place}、標識見えてなかったのかな…逆走してた":
    "{place}: guess they didn't see the sign… going the wrong way.",
  "細い一方通行で正面から車が来て、自転車の人が壁ぎわに避けてた。{place}":
    "A car came head-on down a narrow one-way street and a cyclist had to squeeze against the wall. {place}",
  "ナビ通りに走ったのかもしれないけど、そこは進入禁止です。{place}":
    "Maybe the navi sent you that way, but that's a no-entry street. {place}",
  "{time}、{place}で一方通行の逆走。動画の最後で向きがわかると思う":
    "Wrong way down a one-way street at {place}, {time}. You can see the direction at the end of the video.",

  // ---------- openers: turnBan ----------
  "{place}の交差点、曲がっちゃいけない方向に曲がっていった車":
    "A car at the intersection at {place} turned where you're not allowed to turn.",
  "矢印の標識が出てるのに、その方向以外に曲がる車…{place}":
    "There's an arrow sign right there, and the car turned the other way… {place}",
  "{place}で進行方向の指定を無視して曲がる{color}{car}":
    "A {color} {car} ignoring the turn restriction at {place}.",
  "曲がれない交差点で曲がっていった車。対向車がクラクション鳴らしてた。{place}":
    "A car turned at an intersection where turning isn't allowed. Oncoming traffic was honking. {place}",
  "{place}、ここ時間帯で曲がれないんだけどな…": "{place}: you can't turn here at this time of day…",
  "標識、ちゃんと見てほしい。{place}の交差点で指定方向外に進行":
    "Please actually read the signs. Illegal turn at the intersection at {place}.",

  // ---------- openers: closedRoad ----------
  "通学路の時間帯なのに車が入ってきた。{place}":
    "A car drove onto the school route during school hours. {place}",
  "{place}、通行止めの時間なのに車が入ってきた。子どもたちが端に寄ってた":
    "{place}: a car came in while the road was closed. The kids had to move to the side.",
  "歩行者用道路を車が普通に走ってる…{place}": "A car casually driving down a pedestrian-only street… {place}",
  "{time}、{place}の通学路。見守りの人が止めようとしてたけど行っちゃった":
    "School route at {place}, {time}. The crossing volunteer tried to stop it but it just kept going.",
  "朝の通学路に車が来ると本当にヒヤッとする。{place}":
    "A car on the school route in the morning really gives me chills. {place}",
  "{place}の通行止め区間に{color}{car}。標識あるのにな":
    "A {color} {car} in the closed section at {place}. There's a sign and everything.",
  "ここ、時間帯で車は入れない道なんですよ。{place}":
    "Cars aren't allowed on this road at this time of day. {place}",

  // ---------- openers: uturn ----------
  "転回禁止なのにUターンしてた車。{place}": "A car pulled a U-turn where U-turns are banned. {place}",
  "{place}でいきなりUターン。後ろの車が急ブレーキ":
    "Sudden U-turn at {place}. The car behind had to slam on the brakes.",
  "Uターン禁止の標識の前で堂々とUターン…{place}":
    "A U-turn right in front of the No U-Turn sign, bold as you like… {place}",
  "{place}、転回禁止の場所でぐるっと回っていった{color}{car}":
    "{place}: a {color} {car} swung right around where U-turns are banned.",
  "対向車線をふさいでUターンするの、やめてほしい。{place}":
    "Please stop blocking the oncoming lane to make U-turns. {place}",
  "{time}、{place}でUターン。周り見てなかったと思う":
    "U-turn at {place}, {time}. Don't think they checked around at all.",

  // ---------- openers: slow ----------
  "徐行の標識がある道を普通のスピードで抜けていった車。{place}":
    "A car went down a road with a SLOW sign at its usual speed. {place}",
  "{place}、子どもが多い道なのにまったく徐行してなかった":
    "{place}: lots of kids on this street and the car didn't slow down at all.",
  "「徐行」の文字、見えてなかったのかな。{place}": "Did they not see the word “SLOW”? {place}",
  "{place}の細い道、すれ違いざまにけっこうなスピードで来られて怖かった":
    "On a narrow street at {place}, a car came past me pretty fast. Scary.",
  "徐行って、すぐ止まれる速さのことなんですよ…{place}":
    "“Slow” means slow enough to stop right away, you know… {place}",
  "{place}。曲がり角の先が見えないのに、その速度は危ない":
    "{place}. You can't see around that corner, so that speed is dangerous.",

  // ---------- openers: laneChange ----------
  "黄色い線をまたいで車線変更していった車。{place}":
    "A car changed lanes right across the yellow line. {place}",
  "{place}で進路変更禁止のところを割り込み": "Cut in where lane changes are banned at {place}.",
  "黄色の車線、変更しちゃダメなやつです。{place}": "A yellow lane line means no changing lanes. {place}",
  "{place}、強引な車線変更で後ろの車がブレーキ踏んでた":
    "{place}: a pushy lane change made the car behind hit the brakes.",
  "ウインカーと同時に入ってくるの怖い。{place}":
    "Signaling and cutting in at the same moment is scary. {place}",
  "{color}{car}が黄色い線をまたいで割り込み。{place}":
    "A {color} {car} cut in across the yellow line. {place}",

  // ---------- openers: laneUse ----------
  "右の車線をずっと走り続けてる車。{place}": "A car cruising in the right lane the whole way. {place}",
  "{place}、追い越し車線に居座る車のせいで流れが悪い":
    "{place}: traffic is crawling because a car is camping in the passing lane.",
  "通行帯は左から。{place}の右車線をのんびり走る車がいた":
    "Keep to the left lane. A car was dawdling in the right lane at {place}.",
  "右車線をずっと走るのも違反って知らない人多そう。{place}":
    "Lots of people don't seem to know that staying in the right lane is a violation too. {place}",
  "{place}で右端の車線をひたすら走る{color}{car}":
    "A {color} {car} sticking to the far right lane at {place}.",
  "右の車線は追い越しと右折のための車線なんですよね。{place}":
    "The right lane is for passing and turning right, you know. {place}",

  // ---------- openers: laneDirection ----------
  "左折専用レーンから直進していった車。{place}": "A car went straight from the left-turn-only lane. {place}",
  "{place}、車線の矢印と違う方向に行く車がいて危なかった":
    "{place}: a car went a different way from its lane arrow. That was close.",
  "路面の矢印、見てないのかな…{place}": "Do people not look at the arrows on the road… {place}",
  "{place}の交差点で直進レーンから右折。横の車がびっくりしてた":
    "Right turn from the straight-only lane at {place}. The car beside it got a shock.",
  "車線ごとの行き先、守らないと横の車とぶつかるよ。{place}":
    "Follow your lane's arrows or you'll hit the car next to you. {place}",
  "{place}でレーンと違う方向に曲がる{color}{car}":
    "A {color} {car} turning the wrong way for its lane at {place}.",

  // ---------- openers: phone ----------
  "運転しながらずっとスマホ見てる人がいた…{place}":
    "Saw someone staring at their phone the whole time they were driving… {place}",
  "スマホ見ながら走ってる車、ふらふらしてた。{place}": "A driver on their phone, weaving all over. {place}",
  "信号が青になっても動かないと思ったら、運転手がスマホ見てた。{place}":
    "The light turned green and the car didn't move. Driver was on their phone. {place}",
  "{place}、片手でスマホ持ちながら運転してる人…危ないって":
    "{place}: someone driving with their phone in one hand… that's dangerous.",
  "横に並んだ車の運転手、画面ばっかり見てた。{place}":
    "The driver next to me was glued to the screen. {place}",
  "{color}{car}の運転手、ずっと下向いてた。たぶんスマホ。{place}":
    "The driver of a {color} {car} was looking down the whole time. Phone, probably. {place}",
  "ながら運転、本当にやめてほしい。{place}": "Please, just stop driving distracted. {place}",
  "{place}。スマホ見ながら交差点を曲がっていった。歩行者がいたらどうするの":
    "{place}. Turned at the intersection while looking at a phone. What if someone had been crossing?",

  // ---------- openers: phoneDanger ----------
  "スマホ見ながら運転してて事故。{place}": "Crash caused by driving while on the phone. {place}",
  "{place}で事故。運転手がスマホ持ってるのが見えた":
    "Crash at {place}. I could see the driver holding a phone.",
  "ながら運転で事故るの、一番もったいない。{place}":
    "Crashing because you were on your phone is the most pointless way to crash. {place}",
  "{place}、スマホいじりながら走ってた車がぶつかった。けが人がいないといいけど":
    "{place}: a car whose driver was fiddling with a phone hit something. Hope nobody's hurt.",
  "{time}、{place}で事故。直前までスマホ見てたっぽい":
    "Crash at {place}, {time}. Looked like they were on their phone right up until it happened.",
  "画面見ながら運転するとこうなる…{place}":
    "This is what happens when you drive looking at a screen… {place}",

  // ---------- openers: signalOmission ----------
  "ウインカー出さずに曲がる車、多すぎ。{place}": "Way too many cars turning without signaling. {place}",
  "{place}、合図なしでいきなり左折。自転車の人が危なかった":
    "{place}: sudden left turn with no signal. The cyclist nearly got hit.",
  "ウインカーは曲がる30m手前から。{place}の{color}{car}…":
    "Signal 30 m before you turn. Looking at you, {color} {car} at {place}…",
  "{place}で合図なしの車線変更。どっちに行くかわからなくて怖い":
    "Lane change without signaling at {place}. Scary when you can't tell where they're going.",
  "ウインカー出すのってそんなに面倒かな…{place}": "Is signaling really that much effort… {place}",
  "{place}、ウインカーなしで右折。対向車が止まってた":
    "{place}: right turn with no signal. An oncoming car had to stop.",

  // ---------- openers: noLights ----------
  "夜なのにライトつけてない車がいた。{place}": "A car driving at night with no lights on. {place}",
  "{place}、無灯火の車が暗い道から出てきて見えなかった":
    "{place}: a car with no lights came out of a dark street and I couldn't see it.",
  "ライト、つけ忘れてますよ…{place}": "You forgot your headlights… {place}",
  "{time}、{place}で無灯火の{color}{car}。街灯の少ない道だと本当に見えない":
    "A {color} {car} with no lights at {place}, {time}. On a road with few streetlights you really can't see it.",
  "夜の無灯火、歩行者からはほぼ見えないんですよ。{place}":
    "No lights at night means pedestrians can barely see you. {place}",
  "{place}。ヘッドライト消したまま走ってる車、気づくのが遅れた":
    "{place}. A car driving with its headlights off. I noticed it way too late.",

  // ---------- openers: hornMisuse ----------
  "{place}で意味もなくクラクション鳴らしてる車": "A car honking for no reason at {place}.",
  "なんで今クラクション…？{place}": "Why honk right now…? {place}",
  "{place}、前の車が止まった瞬間にクラクション。歩行者がびっくりしてた":
    "{place}: honked the second the car in front stopped. Startled the pedestrians.",
  "クラクションって危険を知らせるためのものでは…{place}": "Isn't the horn for warning of danger… {place}",
  "{time}、{place}で長いクラクション。何もなかったのに":
    "Long blast of the horn at {place}, {time}. Nothing was even happening.",
  "住宅街でクラクション鳴らすのやめてほしい。赤ちゃん起きた。{place}":
    "Please don't honk in residential areas. You woke the baby. {place}",

  // ---------- openers: seatBelt ----------
  "シートベルトしてない運転手、窓から見えた。{place}":
    "Could see through the window the driver wasn't wearing a seat belt. {place}",
  "{place}、ベルトしてない人がいて心配になった": "{place}: saw someone without a seat belt. Got me worried.",
  "シートベルトは自分を守るためのものだよ。{place}": "Seat belts are there to protect you. {place}",
  "{place}で見かけた{color}{car}、運転席の人がベルトしてなかった":
    "Saw a {color} {car} at {place}. The driver had no seat belt on.",
  "ベルトなしでぶつかったら…考えたくない。{place}":
    "Crashing without a seat belt… don't want to think about it. {place}",
  "{place}。シートベルト、近所への買い物でも締めようね":
    "{place}. Buckle up, even for a quick trip to the shops.",

  // ---------- openers: keepLeft ----------
  "対向車線にはみ出して走ってきた車、ぶつかるかと思った。{place}":
    "A car drifted into my lane coming the other way. Thought we were going to collide. {place}",
  "センターラインはみ出してくる車、正面から来て本当に怖かった。{place}":
    "A car over the center line, coming straight at me. Terrifying. {place}",
  "{place}、右側を走ってくる車がいて急いで避けた":
    "{place}: a car was driving on the right side and I had to swerve out of the way.",
  "{color}{car}がずっと道の右側を走ってた。{place}":
    "A {color} {car} was on the right side of the road the whole time. {place}",
  "{place}でセンターラインを越えて走る車。対向のバイクがよけてた":
    "A car over the center line at {place}. An oncoming motorbike had to dodge it.",
  "右側通行は海外だけにして…{place}": "Save driving on the right for when you're abroad… {place}",
  "{time}、{place}。対向車線を逆走みたいに走ってきた":
    "{place}, {time}. It came down the oncoming lane like a wrong-way driver.",
  "{place}のカーブではみ出してくる車、見通し悪いから本当に危ない":
    "Cars drifting over on the curve at {place}. You can't see ahead there, so it's really dangerous.",

  // ---------- openers: safeDriving ----------
  "{place}で事故。車同士がぶつかった音がすごかった":
    "Crash at {place}. The sound of the two cars hitting was awful.",
  "目の前で事故。{place}。ぶつけた方、前を見てなかったと思う":
    "Crash right in front of me. {place}. I don't think the one who hit was watching the road.",
  "{place}で事故。電柱にぶつかってた": "Crash at {place}. It ran into a utility pole.",
  "{time}、{place}で物損事故。けが人はいなさそう":
    "Fender bender at {place}, {time}. Doesn't look like anyone's hurt.",
  "{place}、ドンって音がして振り向いたら車がぶつかってた":
    "{place}: heard a bang, turned around, and a car had crashed.",
  "前方不注意っぽい事故を見た。{place}。みんな気をつけて":
    "Saw a crash that looked like someone not watching the road. {place}. Be careful, everyone.",
  "{place}で事故。後ろの車が渋滞し始めてる": "Crash at {place}. Traffic's starting to back up behind it.",

  // ---------- openers: injury ----------
  "{place}で人身事故。車が人をはねた…救急車が来てる":
    "Crash with injuries at {place}. A car hit someone… the ambulance is here.",
  "{place}で車が歩行者をはねるのを見てしまった…救急車呼びました":
    "I saw a car hit a pedestrian at {place}… I called an ambulance.",
  "{place}で事故。人が倒れてて、周りの人が声をかけてた":
    "Accident at {place}. Someone was on the ground and people were talking to them.",
  "{place}で人身事故。運転手は降りてきてた。救急車を待ってる":
    "Crash with injuries at {place}. The driver got out. Waiting for the ambulance.",
  "目の前で人がはねられた…{place}。手が震えてる":
    "Someone got hit right in front of me… {place}. My hands are shaking.",
  "{place}で歩行者との事故。大けがじゃないといいけど":
    "A car hit a pedestrian at {place}. Hope it's nothing serious.",
  "{time}、{place}。車と歩行者の事故。通る人は気をつけて":
    "{place}, {time}. A car and a pedestrian. Careful if you're passing by.",

  // ---------- openers: hitAndRun ----------
  "ひき逃げ！{place}。車は逃げていった。ナンバー見た人いませんか":
    "Hit-and-run! {place}. The car took off. Did anyone get the plate?",
  "{place}で人をはねた車がそのまま走り去った。見た人は警察へ":
    "A car hit someone at {place} and just drove off. If you saw it, contact the police.",
  "ひき逃げの瞬間を撮ってしまった…{place}。けが人がいます":
    "I filmed the moment of a hit-and-run… {place}. Someone's injured.",
  "{place}で人をはねて逃げた{color}{car}。見た人は警察に連絡を":
    "A {color} {car} hit someone at {place} and fled. If you saw it, please call the police.",
  "ひき逃げを見た。{place}。けが人は通りかかった人が救護してる":
    "Saw a hit-and-run. {place}. Passers-by are helping the injured person.",
  "{time}、{place}でひき逃げ。ナンバー、映ってるかも":
    "Hit-and-run at {place}, {time}. The plate might be in the shot.",
  "信じられない。人をはねてそのまま走っていった。{place}":
    "Unbelievable. Hit someone and just kept going. {place}",
  "{place}。止まらずに逃げた車がいます。拡散お願いします":
    "{place}. A car hit someone and fled without stopping. Please share.",

  // ---------- openers: unlicensed ----------
  "{place}、運転がずいぶんぎこちない車がいた。大丈夫かな":
    "{place}: a car driving really awkwardly. Hope they're OK.",
  "{place}、ふらふら走る車。運転慣れてない感じだった":
    "{place}: a car weaving around. Didn't seem used to driving.",
  "免許持ってるのかな、って運転の車を見た。{place}":
    "Saw driving that made me wonder if they even have a license. {place}",
  "{place}でよろよろ走る{color}{car}。周りの車が距離とってた":
    "A {color} {car} wobbling along at {place}. Other cars were keeping their distance.",
  "{time}、{place}。危なっかしい運転の車がいた": "{place}, {time}. A car driving pretty precariously.",
  "{place}。ブレーキのタイミングがおかしい車がいて、後ろがひやひやしてた":
    "{place}. A car braking at all the wrong moments. Everyone behind it was on edge.",

  // ---------- openers: ignoredStop ----------
  "{place}でパトカーの停止を無視して逃げた車":
    "A car ignored a police car's order to stop at {place} and fled.",
  "止まれって言われてるのに走り去った車がいた。{place}":
    "Police told a car to stop and it just drove off. {place}",
  "{place}、サイレン鳴らしたパトカーが追いかけてた":
    "{place}: a police car was chasing it with the siren on.",
  "警察の停止に従わず逃げるとか…{place}": "Running from the police when they tell you to stop… {place}",
  "{place}で警察から逃げる車を見た。映画じゃないんだから":
    "Saw a car running from the police at {place}. This isn't a movie.",
  "{time}、{place}。パトカーを振り切っていった{color}{car}":
    "{place}, {time}. A {color} {car} shook off a police car.",

  // ---------- openers: parking ----------
  "{place}の道に車が置きっぱなし。運転手どこ行った":
    "A car just left on the street at {place}. Where'd the driver go?",
  "駐禁の場所にずっと止まってる車。{place}":
    "A car that's been sitting in a no-parking spot forever. {place}",
  "{place}、路上駐車の車をよけるのに対向車線に出なきゃいけない":
    "{place}: you have to pull into the oncoming lane to get around a parked car.",
  "{color}{car}が{place}に放置されてた。確認標章が貼られてた":
    "A {color} {car} left parked at {place}. It's got a parking violation sticker on it.",
  "{place}の路駐、自転車が車道の真ん中に押し出されて危ない":
    "The street parking at {place} pushes cyclists into the middle of the road. Dangerous.",
  "ちょっとだけ、のつもりの路駐が一番迷惑。{place}":
    "“Just for a minute” parking is the most annoying kind. {place}",

  // ---------- openers: parkingNoStop ----------
  "交差点のすぐ近くに車を止めて行っちゃった人がいた。{place}":
    "Someone parked right by the intersection and walked off. {place}",
  "{place}、横断歩道の前に駐車…見通し悪くなって危ない":
    "{place}: parked right in front of a crosswalk… it blocks the view. Dangerous.",
  "{place}の交差点の角に放置車両。曲がる車から歩行者が見えない":
    "A car left on the corner of the intersection at {place}. Turning drivers can't see pedestrians.",
  "駐停車禁止の場所に止めないで。{place}": "Don't stop where stopping is banned. {place}",
  "{place}、交差点ぎりぎりに止まった{color}{car}。バスが曲がれなくて困ってた":
    "{place}: a {color} {car} parked right at the intersection. A bus couldn't make the turn.",
  "{time}、{place}。横断歩道の上に止める人、初めて見た":
    "{place}, {time}. First time I've seen someone park on a crosswalk.",

  // ---------- openers: stopSign ----------
  "「止まれ」で一切止まらない車。{place}": "A car that didn't stop at all at a stop sign. {place}",
  "一時停止ガン無視…{place}": "Totally blew through the stop sign… {place}",
  "{place}の「止まれ」、{color}{car}がそのまま通過":
    "A {color} {car} rolled straight through the stop sign at {place}.",
  "一時停止の線、見えてないのかな。{place}": "Do they not see the stop line? {place}",
  "{place}、止まれの標識の前でスピードも落とさず。出会い頭が怖い":
    "{place}: didn't even slow down at the stop sign. That's how side-impact crashes happen.",
  "{time}、{place}の一時停止。止まったのは自転車の方だった":
    "Stop sign at {place}, {time}. The one who stopped was the cyclist.",
  "減速しただけで止まってない。それ一時停止じゃないです。{place}":
    "Slowing down isn't stopping. That's not a full stop. {place}",
  "写真はないけど、{place}の一時停止で止まらない車がいた。自転車の人がびっくりしてた":
    "No photo, but a car didn't stop at the stop sign at {place}. A cyclist got a real fright.",

  // ---------- hashtags ----------
  "#信号無視": "#RedLightRunning",
  "#危険運転": "#DangerousDriving",
  "#赤信号": "#RedLight",
  "#交差点": "#Intersection",
  "#スピード違反": "#Speeding",
  "#速度超過": "#OverTheLimit",
  "#スピード出しすぎ": "#WayTooFast",
  "#横断歩道": "#Crosswalk",
  "#歩行者優先": "#PedestriansFirst",
  "#逆走": "#WrongWay",
  "#一方通行": "#OneWay",
  "#交通違反": "#TrafficViolation",
  "#指定方向外進行禁止": "#NoTurn",
  "#標識見て": "#ReadTheSigns",
  "#通学路": "#SchoolRoute",
  "#通行止め": "#RoadClosed",
  "#Uターン": "#UTurn",
  "#転回禁止": "#NoUTurn",
  "#徐行": "#SlowDown",
  "#生活道路": "#ResidentialStreet",
  "#割り込み": "#CuttingIn",
  "#進路変更禁止": "#NoLaneChange",
  "#黄色線": "#YellowLine",
  "#通行帯違反": "#LaneViolation",
  "#右車線": "#RightLane",
  "#交通マナー": "#RoadManners",
  "#車線": "#Lanes",
  "#通行区分": "#LaneArrows",
  "#ながら運転": "#DistractedDriving",
  "#スマホ": "#PhoneWhileDriving",
  "#事故": "#Crash",
  "#ウインカー": "#TurnSignal",
  "#合図不履行": "#NoSignal",
  "#無灯火": "#NoHeadlights",
  "#ライトつけて": "#LightsOn",
  "#夜道": "#NightRoads",
  "#クラクション": "#Honking",
  "#シートベルト": "#SeatBelt",
  "#交通安全": "#RoadSafety",
  "#はみ出し": "#CrossingTheLine",
  "#センターライン": "#CenterLine",
  "#前方不注意": "#EyesOnTheRoad",
  "#交通情報": "#TrafficInfo",
  "#拡散希望": "#PleaseShare",
  "#人身事故": "#InjuryCrash",
  "#ひき逃げ": "#HitAndRun",
  "#情報求む": "#WitnessesWanted",
  "#パトカー": "#PoliceCar",
  "#逃走": "#Fleeing",
  "#路上駐車": "#StreetParking",
  "#迷惑駐車": "#BadParking",
  "#放置車両": "#AbandonedCar",
  "#駐停車禁止": "#NoStopping",
  "#一時停止": "#StopSign",
  "#止まれ": "#Stop",
  "#ドラレコ": "#Dashcam",
  "#目撃情報": "#Eyewitness",

  // ---------- replies: any kind ----------
  やべー: "Yikes",
  こいつやべー: "This driver is unreal",
  危なすぎる: "Way too dangerous",
  これは酷い: "This is awful",
  見てて冷や汗出た: "Broke into a cold sweat just watching",
  子どもがいたらと思うとゾッとする: "Gives me chills thinking what if a kid had been there",
  撮ってくれてありがとう: "Thanks for filming this",
  通報案件: "This needs reporting",
  通報しました: "Reported it",
  警察仕事して: "Police, do your job",
  運転向いてないと思う: "Some people just aren't cut out for driving",
  最近こういうの多すぎ: "There's way too much of this lately",
  東京の運転マナーどうなってるの: "What's going on with driving manners in Tokyo",
  ナンバー映ってるね: "You can see the plate",
  保存した: "Saved",
  同じ交差点で自分も危ない目にあった: "I had a close call at the same intersection",
  人の命をなんだと思ってるんだ: "Do they not care about people's lives",
  "急いでたのかもしれないけど、ダメなものはダメ": "Maybe they were in a hurry, but wrong is wrong",
  "動画だけだと前後がわからないけど、これはアウト":
    "Can't see what came before from just the video, but that's a clear no",
  教習所からやり直してほしい: "Back to driving school with them",
  "地元民だけど、ここほんとに多いんだよ": "I'm a local, and this happens here all the time",
  ここ見通し悪いんだよね: "The visibility there is bad",
  "{place}ってこういうの多い気がする": "Feels like {place} gets a lot of this",
  "これ何時ごろですか？": "What time was this?",
  自分も気をつけようと思った: "Makes me want to be more careful myself",
  晒すより警察に届けた方がいいと思う: "Better to take it to the police than to put it online",
  運転してる人の顔は出さない方がいいよ: "Probably shouldn't show the driver's face",
  うちの近所じゃん: "That's my neighborhood",
  "通勤でいつも通る道だ…": "That's the road I take to work…",
  "誰でもうっかりはあるけど、これは…": "Everyone slips up, but this…",

  // ---------- replies: signal ----------
  "黄色だったんじゃない？と思ったけど、これは完全に赤":
    "Thought it might have been yellow, but no, that's fully red",
  "赤信号は止まれ。それだけのことなのに": "Red means stop. It's that simple",
  "歩行者用の信号、青だったよね": "The pedestrian light was green, right?",
  "{place}の信号、変わるの早いのはわかるけど…": "I know the lights at {place} change fast, but…",
  "信号無視って反則金9,000円だっけ": "Running a red is a ¥9,000 fine, isn't it?",
  一瞬の差で大事故だよ: "A split second either way and it's a major crash",
  "動画の最後、右折車が止まってくれてなかったらと思うと怖い":
    "The end of the video: scary to think what if the car turning right hadn't stopped",
  "交差点の向こうの人、よく止まったね": "Good thing the person across the intersection stopped",
  うちの子もこの交差点渡るから本当に怖い: "My kid crosses at this intersection too. Really scary",
  "信号が見えにくい交差点ではあるけど、言い訳にはならない":
    "The lights are hard to see at that intersection, but that's no excuse",

  // ---------- replies: speed ----------
  住宅街でこれは本当にダメ: "This in a residential area is just not OK",
  "体感だけど{kmh}キロじゃ済まない気がする": "Just my feeling, but that was more than {kmh} km/h",
  メーター見てないのかな: "Do they not look at the speedometer?",
  急いでも数分しか変わらないのにね: "Rushing only saves a few minutes anyway",
  "この道、子どもが飛び出してくるんだよ": "Kids dart out on this road, you know",
  オービスがあるとこでやったら一発だね: "Do that past a speed camera and you're done",
  スピード出したいならサーキットへどうぞ: "If you want to go fast, go to a racetrack",
  "目測の速度ってあてにならないけど、それでも速い": "Eyeballed speeds aren't reliable, but that's still fast",
  "制限{limit}キロの道だよね、ここ": "This road has a {limit} km/h limit, right?",
  夜だとこういう車増えるよね: "You get more cars like this at night",

  // ---------- replies: pedestrian ----------
  "横断歩道は歩行者優先。教習所で最初に習うやつ":
    "Pedestrians first at crosswalks. First thing they teach you at driving school",
  "止まってくれる車、ほんとに少ない": "So few cars actually stop",
  "手を挙げて渡るの、子どもに教えてるのに…": "And I teach my kids to raise a hand when crossing…",
  これで止まらないのはさすがにひどい: "Not stopping for that is really bad",
  "{place}のあの横断歩道、見通し悪いんだよね": "That crosswalk at {place} is hard to see",
  "渡ってる人がいたら止まる。それだけ": "Someone's crossing, you stop. That's all",
  ベビーカーの前を通過されると本当に怖い: "Having a car pass right in front of the stroller is terrifying",
  "歩く側も気をつけないと、と思うけど、これは車が悪い":
    "Pedestrians should be careful too, but this one's on the car",
  通学路でこれはダメでしょ: "This on a school route? Not OK",
  "後ろから追突されそうで止まれない、って言う人もいるけど…止まって":
    "Some say they can't stop for fear of being rear-ended… stop anyway",
  通学路の時間帯だけは本当にやめてほしい: "Please, not during school route hours",
  "通行止めの時間、標識の下に書いてあるよ": "The closure hours are written under the sign",
  "ナビが通学路を案内することもあるから、標識は自分で見ないとね":
    "Navis sometimes route you down school roads, so you have to check the signs yourself",
  "徐行って、すぐ止まれる速さのことなんだよね": "“Slow” means slow enough to stop right away",
  生活道路でこのスピードは怖い: "That speed on a residential street is scary",
  "{place}のあの道、角から自転車が急に出てくるんだよ":
    "On that street at {place}, bikes shoot out from the corners",

  // ---------- replies: phone ----------
  "スマホ見ながらの運転は、目をつぶって走ってるのと同じ":
    "Driving while looking at your phone is like driving with your eyes closed",
  "2秒見てたらもう何十メートルも進んでる": "Look away for 2 seconds and you've gone dozens of meters",
  "ホルダーに付けて見ないならまだしも、手持ちはダメ":
    "In a holder and not looking is one thing, but holding it is a no",
  ながら運転は罰則が重くなってるのに: "And the penalties for distracted driving have gotten tougher",
  "前の車が青で進まないとき、だいたいこれ": "When the car ahead doesn't go on green, it's usually this",
  通知なんて後で見ればいいのに: "Notifications can wait",
  "運転中のスマホは本当にやめよう。自分も気をつける":
    "Let's all quit the phone while driving. I'll be careful too",
  "片手運転でハンドルふらふら…見てて怖い": "One-handed and weaving… scary to watch",
  画面見てて歩行者に気づかなかったらと思うと:
    "Imagine missing a pedestrian because you were looking at a screen",
  事故の相手の方が無事だといいけど: "Hope the other party is OK",
  ながら運転で事故だと一発で免停だよね:
    "A crash while on your phone means an instant license suspension, right?",

  // ---------- replies: crash ----------
  けが人がいないといいけど: "Hope nobody's hurt",
  "通る人は気をつけて。渋滞してる": "Careful if you're going that way. It's backed up",
  "ぶつかる直前、ブレーキ踏んでなかったよね": "They didn't brake right before impact, did they?",
  事故った人も大丈夫かな: "Hope the driver's OK too",
  "{place}、よく事故あるよね": "There are a lot of crashes at {place}",
  前方不注意が一番多いんだよね: "Not watching the road is the most common cause",
  救急車の音が聞こえたのこれか: "So that's what the ambulance siren was",
  "近くにいた。すごい音だった": "I was nearby. It was so loud",
  こういうの見ると車間距離ちゃんととろうって思う:
    "Seeing this makes me want to keep a proper following distance",
  はねられた方が無事でありますように: "Praying the person who was hit is OK",
  "救急車、早く来てほしい": "Hope the ambulance gets there fast",
  "運転手が降りてきて救護してたなら、それはせめてもの救い":
    "If the driver got out and helped, that's something at least",

  // ---------- replies: hitAndRun ----------
  逃げたらもっと罪が重くなるのに: "Running only makes it worse for them",
  けがをした方が無事でありますように: "Hoping the injured person is OK",
  ナンバー見えた人いないかな: "Did anyone see the plate?",
  警察に映像を提供した方がいい: "You should give the footage to the police",
  救護義務って知らないのかな: "Do they not know you're required to help the injured?",
  "すぐ戻ってきて、自分から警察に行ってほしい": "Come back and turn yourself in",
  これは拡散: "Sharing this",
  近くの人が救急車呼んでくれててよかった: "Glad someone nearby called an ambulance",
  ひき逃げは本当に許せない: "Hit-and-runs are unforgivable",
  防犯カメラにも映ってるはず: "Security cameras must have caught it too",

  // ---------- replies: flee ----------
  逃げ切れると思ってるのかな: "Do they really think they'll get away?",
  ナンバーはもう控えられてると思う: "I bet the plate's already been noted",
  パトカーとのカーチェイスは映画だけで十分: "Car chases with the police belong in movies",
  逃げる方が罪重くなるのに: "Fleeing just makes it worse",
  巻き込まれた人がいなくてよかった: "Glad nobody got caught up in it",
  このあと事故にならないといいけど: "Hope it doesn't end in a crash",

  // ---------- replies: wrongWay ----------
  正面から来られたら避けようがない: "If they come at you head-on, there's no getting out of the way",
  "標識、見えにくいのかな": "Maybe the signs are hard to see?",
  "ナビの案内どおりに走ったら逆走、って話もあるけど…":
    "I've heard of navis leading people the wrong way, but…",
  "{place}の一方通行、わかりにくいって地元では有名":
    "The one-way at {place} is known locally for being confusing",
  対向車からしたら本当に恐怖: "Absolutely terrifying for oncoming drivers",
  慣れてない道ならなおさらゆっくり走ってほしい: "If you don't know the road, all the more reason to go slow",
  "Uターンするなら、できる場所まで行けばいいのに":
    "If you need a U-turn, just go on to where you're allowed to make one",
  後ろの車がよく止まれたね: "Impressive that the car behind managed to stop",
  "うっかりでも、気づいたらすぐ止まってほしい": "Even if it was a mistake, stop as soon as you notice",
  "曲がれない時間帯、標識の下に小さく書いてあるんだよね":
    "The no-turn hours are in small print under the sign",
  "駐車車両を避けたあと戻らない車、けっこういる":
    "Lots of cars swing out around a parked car and never move back",

  // ---------- replies: lane ----------
  "ウインカー出さない車、多すぎ": "Way too many cars don't signal",
  割り込みは事故のもと: "Cutting in causes crashes",
  "車線の矢印、意外と見てない人多いよね": "A surprising number of people don't look at lane arrows",
  "{place}の交差点、車線が急に分かれるからわかりにくい":
    "The lanes at the intersection at {place} split suddenly. Confusing",
  迷ったら無理せずそのまま行けばいいのに: "If you're unsure, just keep going instead of forcing it",
  "黄色い線はまたいじゃダメ、意外と知らない人いる":
    "You can't cross a yellow line. Surprising how many don't know",
  右車線ずっと走るのも違反なんだよね: "Staying in the right lane is a violation too",
  "左の車線、空いてるのにね": "And the left lane is wide open",
  合図は自分のためじゃなくて周りのため: "Signals aren't for you, they're for everyone around you",
  "急な車線変更、こっちがブレーキ踏まされる": "Sudden lane changes make the rest of us hit the brakes",
  "これくらいで目くじら立てなくても、という気もするけど、事故のもとではある":
    "Maybe it's not worth getting worked up over, but it does cause crashes",

  // ---------- replies: stop ----------
  "止まれ、の標識は飾りじゃない": "Stop signs aren't decorations",
  "一時停止って、タイヤが完全に止まるまでだよね": "A stop means until the wheels stop completely",
  "{place}のあの角、見通し悪いんだよね": "That corner at {place} has terrible visibility",
  "止まったつもり、が一番多いらしい": "Apparently “I thought I stopped” is the most common one",
  "自転車も止まらないけど、車はもっと止まって": "Bikes don't stop either, but cars need to stop even more",
  "ここで出会い頭の事故、前にもあった": "There's been a side-impact crash here before",
  ゆっくり通過は止まったことにならないんだよな: "Rolling through slowly doesn't count as stopping",
  "止まるだけで防げる事故、多いのに": "So many crashes could be avoided just by stopping",

  // ---------- replies: manner ----------
  マナーの問題だよね: "It's a matter of manners",
  ライトは早めにつけてほしい: "Turn your lights on early, please",
  "夜の無灯火、ほんとに見えない": "No lights at night, you really can't see them",
  "街が明るいと、ライトつけ忘れても気づかないんだよね":
    "The city's so bright you don't notice when you forget your lights",
  クラクションでびっくりして転んだ人を見たことある:
    "I once saw someone fall over because a horn startled them",
  "お礼のクラクションも、本当はダメなんだよね": "Even a thank-you honk isn't actually allowed",
  シートベルトは後ろの席もね: "Seat belts in the back seat too",
  ベルトは数秒で締められるのに: "A seat belt takes seconds to put on",
  "体調悪かったのかな。心配": "Maybe they weren't feeling well. Worried",
  ふらふら運転は本当に怖い: "Weaving drivers are really scary",
  "ちょっとしたことだけど、事故のもとになる": "Small thing, but it causes crashes",
  "これくらいなら…と思ったけど、やっぱりダメか": "Thought it wasn't a big deal… but yeah, it's not OK",
  自分もうっかりしないように気をつけよう: "I'll make sure I don't slip up either",

  // ---------- replies: parking ----------
  路駐のせいで見通し悪くなるんだよね: "Street parking really blocks the view",
  "{place}って路駐多いよね": "There's so much street parking at {place}",
  "ちょっとだけ、が一番迷惑": "“Just a minute” is the worst",
  駐車監視員さん来てほしい: "Wish the parking enforcement folks would come by",
  荷下ろしなら仕方ない面もあるけど: "If they're unloading, I get it to a point",
  交差点の近くは本当にやめてほしい: "Please, not near intersections",
  自転車が車道の真ん中に押し出されてた: "Cyclists were getting pushed into the middle of the road",
  "放置違反金、高いよ": "Those parking fines aren't cheap",
  バスが曲がれなくなるやつ: "The kind that stops buses from turning",

  // ---------- quotes ----------
  これはアウト: "That's a no",
  "こわ…": "Scary…",
  "{place}を通る人は気をつけて": "Careful if you're passing through {place}",
  こういうのが一番危ない: "This is the most dangerous kind",
  警察に情報提供した方がいい: "Should give this to the police",
  "拡散。自分も気をつけよう": "Sharing. I'll be careful too",
  "明日は我が身。自分も気をつけます": "Could be any of us tomorrow. I'll be careful",
  撮った人が無事でよかった: "Glad the person filming is OK",
  "地元だ…": "That's my area…",
  よく撮れてるな: "Great footage",
  これを見て運転を見直す人が増えますように: "Hope this makes more people rethink how they drive",
  "赤は止まれ。子どもでも知ってる": "Red means stop. Even kids know that",
  "{place}の交差点、要注意": "Watch out at the intersection at {place}",
  "信号無視、ダメ絶対": "Never run a red. Ever",
  スピードは命を削る: "Speed costs lives",
  "{place}、この速度はない": "{place}: that speed is a no",
  メーターを見る習慣を: "Make a habit of checking the speedometer",
  横断歩道は歩行者優先です: "Pedestrians have the right of way at crosswalks",
  子どもを連れて歩く身としては本当に怖い: "As someone who walks with kids, this is really scary",
  "止まる、それだけでいい": "Just stop. That's all it takes",
  "通学路の通行止め、守ろう": "Respect the school route closures",
  生活道路はゆっくり: "Take it slow on residential streets",
  スマホは運転前にしまう: "Put the phone away before you drive",
  "ながら運転、ダメ絶対": "Never drive distracted",
  "2秒の脇見が事故になる": "Two seconds looking away is all it takes",
  けが人がいませんように: "Hoping no one's hurt",
  "{place}付近、渋滞に注意": "Expect traffic near {place}",
  事故は一瞬: "Crashes happen in an instant",
  けがをした方の回復を祈ります: "Wishing the injured person a full recovery",
  "情報求む。{place}付近": "Witnesses wanted. Near {place}",
  逃げずに戻ってきて: "Don't run. Come back",
  見かけた人は警察へ: "If you saw it, go to the police",
  警察から逃げても状況は悪くなるだけ: "Running from the police only makes things worse",
  "{place}付近、パトカーが走ってます": "Police cars out near {place}",
  "逆走・はみ出しは正面衝突のもと": "Wrong-way driving and crossing the line lead to head-on crashes",
  "{place}付近の人は気をつけて": "Careful if you're near {place}",
  標識は最後まで読もう: "Read the whole sign",
  合図は早めに: "Signal early",
  割り込みダメ: "Don't cut in",
  車線は余裕をもって選ぼう: "Pick your lane early",
  止まれは止まれ: "Stop means stop",
  "一時停止、完全に止まろう": "Come to a full stop",
  ちょっとしたマナーが事故を防ぐ: "Small courtesies prevent crashes",
  ライトは早めに: "Lights on early",
  路駐は迷惑のもと: "Street parking causes trouble",
  "{place}付近、通行注意": "Take care around {place}",

  // ---------- the poster's answers ----------
  警察には情報提供しました: "I've passed it on to the police",
  "映像は加工なしです。撮ったそのまま": "The footage is unedited. Exactly as I filmed it",
  "場所は{place}です。通る人は気をつけて": "It was at {place}. Careful if you pass through",
  ほんとそれです: "Exactly",
  "思ったより広まっててびっくりしてる…": "Surprised how far this has spread…",
  "{time}です": "It was {time}",
  地元の人は知ってる道なんですよね: "Locals know this road",
  "完全に赤でした。歩行者側が青だったので": "It was fully red. The pedestrian light was green",
  "体感ですけど、周りの車の倍くらい出てました":
    "Just my impression, but it was going about twice as fast as everyone else",
  "渡ってた人は無事でした。よかった": "The person crossing was OK. Thank goodness",
  子どもたちはみんな無事です: "The kids are all fine",
  "あの角、先がほんとに見えないんです": "You really can't see past that corner",
  横に並んだときに見えました: "I saw it when we were side by side",
  救急車と警察はもう来てます: "The ambulance and police are already here",
  けが人はいなかったみたいです: "Looks like nobody was hurt",
  けがをした方には近くの人がついてくれてます: "People nearby are staying with the injured person",
  パトカーはそのまま追いかけていきました: "The police car went after it",
  こっちは止まれたので無事です: "I managed to stop, so I'm fine",
  後ろの車がうまく避けてくれました: "The car behind managed to avoid it",
  "止まったように見えて、実は止まってないんですよね": "It looks like they stopped, but they actually didn't",
  悪気はなかったのかもしれないけど: "They might not have meant any harm, but",
  しばらくしたら監視員さんが来てました: "Parking enforcement showed up a while later",

  // ---------- the news account's quote, media, dashcam leads ----------
  "【話題】{place}で撮影された「{what}」の車の{media}が拡散しています。警察も情報を把握しているとみられます":
    "[Trending] A {media} of a car at {place} ({what}) is going viral. Police are believed to be aware of it.",
  動画: "video",
  写真: "photo",
  投稿: "post",
  "ドラレコに残ってた。": "Caught on my dashcam.",
  "ドラレコ確認したら映ってた。": "Checked my dashcam and there it was.",
  "【ドラレコ】": "[Dashcam]",

  // ---------- everyday posts: the accounts the player follows ----------
  "おはようございます。今朝の東京、富士山まで見えました":
    "Good morning. You could see all the way to Mt. Fuji from Tokyo this morning",
  "夕焼けがきれいでした。今日もおつかれさまでした": "Beautiful sunset tonight. Great work today, everyone",
  "今夜の東京。空気が澄んでて遠くまで見える": "Tokyo tonight. The air is so clear you can see for miles",
  "雨の{ward}。足元に気をつけてお出かけください": "Rain in {ward}. Watch your step if you're heading out",
  "雨が上がりました。路面はまだ濡れているので、運転する方はスリップに注意":
    "The rain has stopped. Roads are still wet, so drivers, watch out for skids",
  "急に降ってきました☔ 傘をお持ちでない方は少し雨宿りを":
    "Sudden downpour ☔ No umbrella? Best to shelter for a bit",
  "{hour}時の東京は{temp}℃。過ごしやすい一日になりそうです":
    "{temp}°C in Tokyo at {hour}:00. Looks like a pleasant day ahead",
  "{hour}時の気温は{temp}℃。上着が一枚あると安心です":
    "{temp}°C at {hour}:00. An extra layer would be a good idea",
  "{hour}時の時点で{temp}℃。こまめに水分をとってください":
    "Already {temp}°C at {hour}:00. Keep drinking water",
  "秋の空。うろこ雲が出ています": "Autumn sky. Mackerel clouds out today",
  "入道雲がもくもく。夕方は急な雨に注意":
    "Towering thunderheads building up. Watch for sudden showers this evening",
  "梅雨空の東京。紫陽花がきれいな季節です": "Rainy-season skies over Tokyo. Hydrangea season is here",
  "冬の朝。空が高くて、富士山がくっきり": "Winter morning. Big clear sky, and Mt. Fuji looks crisp",
  "春がすみの東京。遠くのビルがやさしくかすんでいます":
    "Spring haze over Tokyo. The distant towers are softly blurred",
  "日が短くなりました。{hour}時でもう暗くなってきています":
    "The days are getting shorter. Already getting dark at {hour}:00",
  "台風が近づいています。最新の情報を確認して、無理な外出は控えてください":
    "A typhoon is approaching. Check the latest updates and avoid going out unless you must",
  "{landmark}と夕焼け。今日もいい一日でした": "{landmark} and the sunset. Another good day",
  月がきれいな夜です: "Lovely moon tonight",

  "【安全運転のコツ】右折するときは、対向車の陰から来るバイクや自転車に注意。見えないところに誰かいるかも、と考えるのが基本です":
    "[Safe driving tip] When turning right, watch for motorbikes and bicycles coming out from behind oncoming cars. Always assume someone might be where you can't see",
  "【安全運転のコツ】横断歩道を渡ろうとしている人がいたら、必ず手前で一時停止（道路交通法 第38条）":
    "[Safe driving tip] If someone is about to cross at a crosswalk, always stop before it (Road Traffic Act Art. 38)",
  "【安全運転のコツ】スマホは運転前にしまう。手に持って見ながらの運転は違反、事故を起こせば一発で免許停止です":
    "[Safe driving tip] Put your phone away before you drive. Holding it while driving is a violation, and causing a crash means an instant license suspension",
  "黄色信号は「止まれ」。安全に止まれないときだけ進めます（道路交通法施行令 第2条）":
    "A yellow light means “stop”. You may go on only if you can't stop safely (Road Traffic Act Enforcement Order Art. 2)",
  "【安全運転のコツ】雨の日は止まるまでの距離が延びます。車間距離はいつもの倍を目安に":
    "[Safe driving tip] Stopping distances get longer in the rain. Aim for twice your usual following distance",
  "【安全運転のコツ】降り始めの路面は特に滑りやすいです。ゆっくり、早めのブレーキを":
    "[Safe driving tip] Roads are especially slippery when the rain first starts. Go slow and brake early",
  "【安全運転のコツ】日が暮れるのが早い季節。ライトは早めに点灯しましょう（道路交通法 第52条）":
    "[Safe driving tip] It gets dark early this time of year. Turn your lights on early (Road Traffic Act Art. 52)",
  "【安全運転のコツ】「止まれ」の標識では、停止線の直前で一度完全に止まります（道路交通法 第43条）":
    "[Safe driving tip] At a stop sign, come to a complete stop just before the stop line (Road Traffic Act Art. 43)",
  "【安全運転のコツ】通学路の時間帯の通行止めに注意。標識の下の補助標識で時間を確かめましょう":
    "[Safe driving tip] Watch for school-route closures. Check the hours on the plate under the sign",
  "【安全運転のコツ】オービスが光ったら、速度を見直すきっかけに。制限速度は「出してよい速度」ではなく「上限」です":
    "[Safe driving tip] If a speed camera flashes, take it as a cue to rethink your speed. The limit isn't a target, it's a maximum",
  "【安全運転のコツ】ウインカーは右左折の30m手前から（道路交通法施行令 第21条）":
    "[Safe driving tip] Signal 30 m before you turn (Road Traffic Act Enforcement Order Art. 21)",
  "【安全運転のコツ】路線バスが発車の合図をしたら、進路を譲りましょう（道路交通法 第31条の2）":
    "[Safe driving tip] When a route bus signals to pull out, let it in (Road Traffic Act Art. 31-2)",
  "【安全運転のコツ】夕暮れどきは歩行者が見えにくくなる時間帯。交差点では特に注意":
    "[Safe driving tip] Pedestrians are harder to see at dusk. Take extra care at intersections",
  "【安全運転のコツ】渋滞の最後尾では、ハザードランプで後ろの車に知らせると追突を防げます":
    "[Safe driving tip] At the back of a jam, flash your hazard lights to warn the cars behind and avoid being rear-ended",
  "【安全運転のコツ】白バイやパトカーを見たときだけ安全運転、ではなく、いつも同じ運転を":
    "[Safe driving tip] Don't just drive safely when you see a police bike or patrol car. Drive the same way all the time",
  "【安全運転のコツ】自動運転の車も周りの動きを見て走っています。急な割り込みはしないように":
    "[Safe driving tip] Self-driving cars react to what's around them too. Don't cut in on them suddenly",

  "【交通】都心の主要道路は夕方にかけて混雑する見込みです。時間に余裕をもってお出かけください":
    "[Traffic] Major roads in central Tokyo are expected to be congested into the evening. Allow extra time",
  "【交通】歩行者が巻き込まれる事故の多くは、道路を横断している時に起きています。横断歩道の手前では速度を落として":
    "[Traffic] Most crashes involving pedestrians happen while they're crossing the road. Slow down before crosswalks",
  "【交通】{ward}付近で事故があったもようです。周辺は混雑しています":
    "[Traffic] There appears to have been a crash near {ward}. Traffic is heavy in the area",
  "【交通】雨の影響で、都内の一般道は各地で流れが悪くなっています":
    "[Traffic] Rain is slowing traffic on surface roads across Tokyo",
  "【交通】{ward}周辺で交通の取り締まりが行われているもようです":
    "[Traffic] Traffic enforcement appears to be underway around {ward}",
  "【交通】{ward}付近、白バイが巡回中との情報があります。安全運転で":
    "[Traffic] Reports of police motorcycles patrolling near {ward}. Drive safely",
  "【交通】朝の通勤時間帯、都心に向かう道路で混雑が続いています":
    "[Traffic] Morning rush hour: roads into central Tokyo remain congested",
  "【交通】週末の行楽の車で、郊外へ向かう道路が混み合っています":
    "[Traffic] Weekend getaway traffic is clogging roads out of the city",
  "【交通】{ward}周辺で渋滞が発生しています。迂回も検討してください":
    "[Traffic] Congestion around {ward}. Consider a detour",
  "【交通】年末の帰省ラッシュが始まっています。時間に余裕をもってお出かけください":
    "[Traffic] The year-end holiday rush has begun. Allow extra time",
  "【交通】連休中は観光地の周辺が混雑します。公共交通機関の利用もご検討ください":
    "[Traffic] Tourist areas get crowded over the holidays. Consider public transit",
  "【交通】台風の接近に伴い、強い雨と風が予想されます。不要不急の外出は控えてください":
    "[Traffic] Heavy rain and strong winds are expected as the typhoon approaches. Avoid non-essential trips",
  "【交通】{ward}で自動運転タクシーが走っています。歩行者・自転車はふだんどおり注意を":
    "[Traffic] Self-driving taxis are running in {ward}. Pedestrians and cyclists, stay as alert as usual",
  "【交通】今夜は雨。夜は路面が光って白線が見えにくくなります":
    "[Traffic] Rain tonight. Wet roads shine at night and the white lines get hard to see",
  "【交通】通学路での事故を防ぐため、朝の通行止めの時間を守りましょう":
    "[Traffic] To prevent crashes on school routes, respect the morning closure hours",
  "【交通】{ward}付近でパトカーが車を追跡しているとの情報。周辺の方は気をつけて":
    "[Traffic] Reports of a police car pursuing a vehicle near {ward}. Take care if you're in the area",

  "今日の一杯。醤油ラーメン、スープまで完飲": "Today's bowl. Shoyu ramen, drank every last drop of the soup",
  夜ラーメンは背徳の味: "Late-night ramen tastes like sin",
  "雨の日は行列が短いので狙い目。今日は塩": "Rainy days mean shorter lines. Went with shio today",
  "{ward}で一杯。煮干しの香りがたまらない": "A bowl in {ward}. That dried-sardine aroma is irresistible",
  寒くなってきたので味噌の季節: "Getting colder, so it's miso season",
  暑い日はつけ麺一択: "On a hot day it has to be tsukemen",
  "替え玉、我慢しました（えらい）": "Resisted the extra noodles (proud of myself)",

  "うちの猫、窓から車を眺めるのが好き": "My cat loves watching the cars from the window",
  寝てる写真しか撮れない: "All my photos are of her sleeping",
  雨の音を聞きながら丸くなってる: "Curled up listening to the rain",
  日なたの場所取りが上手すぎる: "An expert at claiming the sunny spot",
  外の救急車のサイレンに耳だけ反応してた: "Only her ears reacted to the ambulance siren outside",
  "猫、こたつから出てこない": "The cat won't come out from under the kotatsu",
  夜の運動会が始まった: "The nightly zoomies have begun",

  "首都高、今日もそこそこ混んでる": "The Shuto Expressway is fairly busy again today",
  "車間距離をとるだけで、ブレーキを踏む回数がぜんぜん違う":
    "Just keeping a following distance makes a huge difference in how often you brake",
  "雨の日の首都高、みんな車間とってて偉い":
    "Shuto Expressway in the rain, and everyone's keeping their distance. Nice",
  "金曜の夕方はどこも混む。のんびり帰ります":
    "Friday evenings are busy everywhere. Taking it easy on the way home",
  月曜の朝はなぜか流れがいい気がする:
    "Traffic always seems to flow better on Monday mornings for some reason",
  "白バイが流してた。こういう日はみんな制限速度ぴったり":
    "A police bike was cruising along. On days like this everyone sticks right to the limit",
  "前の車のブレーキランプが一斉に赤くなる瞬間、渋滞の始まり":
    "That moment all the brake lights ahead go red at once: the start of a jam",
  "今日は{ward}経由。下道も悪くない": "Going via {ward} today. Surface roads aren't bad",
  "覆面パトカー、見た目じゃほんとにわからない": "You really can't tell an unmarked police car by looking",

  "教習所で習ったこと、忘れてる人多いよね。左折は左に寄せてから":
    "Lots of people forget what they learned at driving school. Move to the left before turning left",
  "「だろう運転」じゃなくて「かもしれない運転」。何年たっても基本はこれ":
    "Don't drive assuming “they'll be fine”; drive assuming “someone might be there”. After all these years, that's still the basics",
  "雨の日の右折は、対向車のライトで歩行者が見えにくくなります。ゆっくりね":
    "Turning right in the rain, oncoming headlights make pedestrians hard to see. Take it slow",
  "教え子から「横断歩道で止まったら会釈された」と報告。うれしいね":
    "A former student told me someone bowed to them after they stopped at a crosswalk. Love that",
  "車間距離は「前の車が通った所を2秒後に通る」くらいが目安":
    "For following distance, aim to pass a point about 2 seconds after the car ahead",
  "夕方は「もう見えてる」と思わずに、ライトを早めにね":
    "At dusk, don't assume you can still see fine. Lights on early",
  "新年度。初心者マークの車にはやさしくね": "New school year. Be kind to new drivers with beginner badges",

  "朝のコーヒー☕ 今日もがんばろう": "Morning coffee ☕ Let's do this",
  "午後の休憩。ラテアートかわいい": "Afternoon break. Cute latte art",
  "雨の日のカフェ、窓際の席が特等席": "Rainy-day café: the window seat is the best seat",
  ホットの季節がやってきた: "Hot drink season is here",
  アイスラテがおいしい季節: "Iced latte season",
  週末の朝はゆっくりモーニング: "Slow breakfast on a weekend morning",
  "{ward}の喫茶店でひと休み": "Taking a break at a coffee shop in {ward}",

  // ---------- everyday posts: office workers, students, parents ----------
  "月曜の満員電車、もう少しなんとかならないものか": "Monday's packed trains. Can't something be done",
  "やっと金曜。今週もおつかれ自分": "Finally Friday. Good job this week, me",
  "ランチは{lunch}。午後もがんばる": "Lunch: {lunch}. Ready for the afternoon",
  "外回りで{ward}まで来た。歩くといい運動になる": "Out on sales calls in {ward}. Walking is good exercise",
  "傘忘れた。会社から駅まで走るしかない":
    "Forgot my umbrella. Guess I'm running from the office to the station",
  "残業おわり。{ward}の夜景で元気出す": "Overtime done. Recharging with the night view of {ward}",
  "在宅勤務の日は通勤時間がまるごと自由。最高": "Work-from-home days give me my whole commute back. The best",
  "今日のお弁当。昨日の残りを詰めただけ": "Today's bento. Just yesterday's leftovers",
  "{ward}のオフィス街、昼休みは人がどっと出てくる":
    "The office district in {ward} floods with people at lunchtime",
  定時で帰れる日の空は青い: "The sky looks bluer on days you leave on time",
  "社用車で移動中。安全運転で行きます": "Out in the company car. Driving safe",

  "1限に間に合う気がしない": "No way I'm making my first class",
  "課題終わらない…カフェで粘る": "This assignment won't end… camping out at a café",
  "学食の{lunch}、安くてうまい": "The cafeteria {lunch} is cheap and tasty",
  "バイト帰り、{ward}の夜道は静か": "Heading home from my part-time job. {ward} is quiet at night",
  テスト期間なのに部屋の掃除がはかどる: "Exam season and suddenly my room is spotless",
  "夏休み入った！なにしよう": "Summer break! What to do",
  "ゼミの発表、なんとか終わった": "Got through my seminar presentation somehow",
  "自転車で{nearWard}まで行ってみた。意外と近い": "Biked over to {nearWard}. Closer than I thought",
  学園祭の準備で毎日遅くまで残ってる: "Staying late every day to get ready for the school festival",

  "ベビーカーで{park}まで散歩。いい天気": "Stroller walk to {park}. Lovely weather",
  "保育園のお迎え、雨だとレインカバーと格闘":
    "Daycare pickup in the rain means wrestling with the stroller rain cover",
  "子どもが路線バスに手を振ったら、運転手さんが振り返してくれた。神":
    "My kid waved at a bus and the driver waved back. Legend",
  "横断歩道で止まってくれる車にはお辞儀するようにしてる。子どもも真似するようになった":
    "I always bow to cars that stop at crosswalks. Now my kid does it too",
  "運動会の場所取り、朝から戦い": "Saving a spot for sports day. A battle from early morning",
  "子どもが白バイを見て大興奮。かっこいいもんね":
    "My kid went wild seeing a police motorcycle. They are cool",
  "ベビーカーだと段差の多い道はつらい。{town}は歩道が広くて助かる":
    "Bumpy streets are tough with a stroller. The wide sidewalks in {town} are a lifesaver",
  "公園で{flower}が咲いてた。子どもが「きれい」って":
    "The {flower} were out in the park. My kid said “pretty!”",
  "寝かしつけ完了。今日もおつかれさま、自分": "Kids are asleep. Good job today, me",
  "ハロウィンの衣装、手作りに挑戦中": "Trying my hand at a homemade Halloween costume",

  // ---------- everyday posts: people who drive, ride and walk for a living ----------
  "今日の配達ルート、{ward}から{nearWard}へ。坂が多い":
    "Today's delivery route: {ward} to {nearWard}. Lots of hills",
  "雨の日の荷物、濡らさないのが一番気をつかう": "On rainy days the hardest part is keeping the parcels dry",
  再配達ゼロの日は気分がいい: "Zero redeliveries today. Feels good",
  "路駐してる車が多くて、荷物を下ろす場所がない…": "So many parked cars there's nowhere to unload…",
  "年末の荷物の量、すごい": "The amount of parcels at year-end is insane",
  "暑すぎる。水分とってがんばる": "Way too hot. Drinking water and pushing on",
  "自動運転タクシーとすれ違った。運転席が空っぽなの、まだ慣れない":
    "Passed a self-driving taxi. Still not used to the empty driver's seat",

  "雨の日はお客さんが多い。安全運転で稼ぎます": "Lots of fares on rainy days. Earning it safely",
  "今日は{landmark}の近くまでお客さんを。観光の方でした": "Took a fare out near {landmark} today. A tourist",
  "深夜の{ward}、静か。週末だけは別": "{ward} late at night is quiet. Except on weekends",
  渋滞にはまるとお客さんに申し訳なくなる: "Getting stuck in traffic makes me feel bad for the passenger",
  "自動運転のタクシーを見かけた。商売敵だけど、運転は丁寧だった":
    "Spotted a self-driving taxi. The competition, but it drove politely",
  "白バイがいる日はみんな行儀がいい。毎日そうならいいのに":
    "Everyone behaves when the police bikes are out. Wish it were like that every day",
  "海外からのお客さん、{landmark}を見て大喜びしてた":
    "A passenger from overseas was thrilled to see {landmark}",
  "朝の駅前、タクシー待ちの行列がすごい": "Huge taxi line at the station this morning",
  金曜の夜は終電後が勝負: "Friday nights, it's all about after the last train",

  "{ward}で路線バスとすれ違った。今日もちゃんと走ってる":
    "Passed a route bus in {ward}. Running right on schedule",
  "バスの一番前の席、景色が最高": "The front seat of the bus has the best view",
  "雨の日のバス、窓の水滴ごしの街がいい": "Buses on rainy days: the city through raindrops on the window",
  バス停の時刻表を見るだけで一時間つぶせる: "I could spend an hour just looking at a bus stop timetable",
  "夜のバス、車内の明かりがきれい": "Night buses: the light inside is beautiful",
  電車の見える部屋に住みたい: "I want an apartment with a view of the trains",
  "{river}を渡る電車、いい音": "A train crossing {river}. Great sound",

  向かい風の日は修行: "Headwind days are training",
  "雨の日はさすがに電車。カッパで走るのはもう卒業":
    "Rainy days I take the train. I've graduated from riding in a raincoat",
  "自転車レーン、路駐の車でふさがれてる…": "Bike lane blocked by parked cars…",
  "{river}沿いを走ると気持ちいい": "Riding along {river} feels great",
  "自転車も車両。信号は守ろう、自分も含めて": "Bikes are vehicles too. Let's obey the lights, me included",
  "ヘルメット、慣れるとかぶらないと落ち着かない":
    "Once you're used to a helmet, riding without one feels wrong",
  秋は自転車がいちばん気持ちいい季節: "Autumn is the best season for cycling",

  "今朝も{park}まで散歩しました。{flower}がきれいに咲いていました":
    "Walked to {park} again this morning. The {flower} were in full bloom",
  "孫にスマホの使い方を教わりました。こうして書き込めるようになりました":
    "My grandchild taught me to use a smartphone. Now I can post like this",
  "横断歩道で車が止まってくれました。ありがたいことです": "A car stopped for me at the crosswalk. Very kind",
  "金木犀のよい香りがします。秋ですね": "The fragrant olive smells lovely. Autumn is here",
  "今日は暑いので、散歩は夕方にします": "Too hot today, so I'll take my walk in the evening",
  "{river}の土手を歩きました。風が気持ちいいです": "Walked along the bank of {river}. The breeze was lovely",
  [`雨なので家で「${TV_NATURE}」を見ています。きれいな映像です`]:
    "It's raining, so I'm watching “Nature Journeys” at home. Beautiful footage",
  "年の瀬ですね。大掃除はほどほどにします": "The year's almost over. I'll keep the big clean-up modest",

  "初めての東京。{landmark}が見えてテンション上がる":
    "My first time in Tokyo. Seeing {landmark} has me so excited",
  "{ward}の街並み、テレビで見たとおり": "The streets of {ward} look just like on TV",
  "東京の人、歩くの速い": "People in Tokyo walk so fast",
  "案内標識に「{sign}」って出てた。行ってみようかな": "The road sign said “{sign}”. Maybe I'll go",
  "赤レンガの駅舎、本物は迫力がすごい": "The red-brick station building is so impressive in person",

  // ---------- everyday posts: cameras, food, nights ----------
  "{landmark}、今日は空気が澄んでて輪郭がくっきり":
    "{landmark} today: the air's so clear its outline is razor sharp",
  "雨の夜の路面に映る信号の色。この季節の楽しみ":
    "Traffic light colors reflected on the wet road at night. One of this season's joys",
  "{bridge}からの{river}。夕方の光がちょうどいい": "{river} from {bridge}. The evening light is just right",
  "うろこ雲。秋の空は撮っていて飽きない": "Mackerel clouds. Never get tired of shooting autumn skies",
  "横断歩道の白と影のコントラスト、好き": "Love the contrast of crosswalk white and shadow",
  傘の花が咲く交差点: "An intersection blooming with umbrellas",
  "紅葉、色づき始めました": "The autumn leaves are starting to turn",
  "夜の{ward}。ビルの窓明かりが星みたい": "{ward} at night. The office windows look like stars",
  "{park}の木漏れ日": "Sunlight through the trees at {park}",
  "夕焼けと{landmark}のシルエット": "The sunset and the silhouette of {landmark}",

  "今日のおやつは{snack}": "Today's snack: {snack}",
  "{ward}で見つけた定食屋さん、ご飯おかわり自由で最高":
    "Found a set-meal place in {ward} with free rice refills. The best",
  "新米の季節。白いご飯だけで幸せ": "New-crop rice season. Plain white rice is all I need",
  "夕飯は{dinner}を作った。うまくできた": "Made {dinner} for dinner. Turned out great",
  "雨の日は家で{dinner}": "Rainy day, so {dinner} at home",
  かき氷の季節がやってきた: "Shaved ice season is here",
  "焼き芋の屋台の声が聞こえた。寒くなってきたなあ":
    "Heard the roasted sweet potato vendor calling out. It's getting cold",
  "お弁当作った。彩りはがんばった": "Made a bento. Put some effort into the colors",

  "夜勤明け。朝日がまぶしい": "Off the night shift. The morning sun is blinding",
  "夜勤入ります。{ward}の夜は意外と救急車が多い":
    "Starting the night shift. Surprisingly many ambulances in {ward} at night",
  "深夜の休憩。静かな街で信号だけが変わり続けてる":
    "Late-night break. The city's silent, only the traffic lights keep changing",
  夜勤明けのラーメンは罪の味: "Ramen after a night shift tastes like sin",
  "明け方の空のグラデーション、夜勤の特権": "The gradient of the dawn sky. A night-shift perk",
  [`寝る前に「${TV_NEWS}」をつけてる`]: "Putting “Abide News” on before bed",

  "S字とクランク、今でも夢に出るって元教習生に言われた":
    "A former student told me the S-curve and crank course still show up in their dreams",
  "雨の日の教習は、ワイパーの使い方から": "Rainy-day lessons start with how to use the wipers",
  "初心者のうちは、知ってる道でもナビの声に頼りすぎないこと":
    "When you're new, don't lean too hard on the navi voice, even on roads you know",
  "教習所の外周、紅葉がきれいな季節": "The driving school's outer course is lovely with autumn leaves",
  "一時停止の練習。止まる位置は停止線の手前ですよ":
    "Stop sign practice. You stop before the stop line, remember",

  "深夜の幹線道路、トラックばっかり": "Main roads late at night: nothing but trucks",
  "{sign}方面へ。今日も長距離": "Heading toward {sign}. Long haul again today",
  "雨の日は特に、大型車の死角に気をつけてほしい":
    "Especially in the rain, please mind big trucks' blind spots",
  "高い運転席から見ると、無理な割り込みがよく見える": "From a high cab you see every reckless cut-in",
  朝焼けの中を走るのが好き: "I love driving into the sunrise",

  "朝ラン。{river}沿いは信号がなくて走りやすい":
    "Morning run. No traffic lights along {river}, so it's easy going",
  "雨の日はお休み。ストレッチだけ": "Rest day for the rain. Just stretching",
  走るにはちょうどいい気温: "Perfect temperature for a run",
  "夜ランは反射材が必須。車から見えないので":
    "Reflective gear is a must for night runs. Drivers can't see you otherwise",
  ツーリング日和: "Perfect day for a ride",
  雨の日のバイクは修行: "Riding a motorbike in the rain is pure training",
  すり抜けはしない派です: "I'm firmly against lane splitting",
  "秋の夜はバイクだと寒い。ジャケット出した": "Autumn nights get cold on a bike. Got my jacket out",

  "朝の散歩。うちの子は{park}が大好き": "Morning walk. My dog loves {park}",
  "雨で散歩に行けず、ふてくされてる": "No walk because of the rain, and she's sulking",
  暑いのでアスファルトが冷めてから散歩: "Too hot, so we walk once the asphalt cools down",
  "横断歩道で待ってたら車が止まってくれて、犬もお辞儀（したように見えた）":
    "A car stopped for us at the crosswalk and my dog bowed too (or seemed to)",
  落ち葉の上を歩くのが好きらしい: "Apparently she loves walking on fallen leaves",
  猫が窓辺で雨を見てる: "The cat's watching the rain from the window",
  "保護猫の譲渡会、今週末あります": "Rescue cat adoption event this weekend",
  "ひざの上から動いてくれない。在宅勤務の日でよかった":
    "Won't get off my lap. Good thing I'm working from home today",

  "洗濯物、外に干したら降ってきた": "Hung the laundry out and it started raining",
  "今日の夕飯は{dinner}": "Dinner tonight: {dinner}",
  "買い物の帰りに{ward}の商店街をぶらぶら":
    "Wandering the shopping street in {ward} on the way back from errands",
  ベランダのミニトマトが赤くなった: "The cherry tomatoes on the balcony have turned red",
  衣替えをしないといけない季節: "Time to swap out the wardrobe for the season",
  "商店街にハロウィンの飾りつけ。子どもたちが喜んでる":
    "Halloween decorations on the shopping street. The kids love it",
  雨の日は店の前に傘立てを出します: "On rainy days I put an umbrella stand out front",
  "今日も開店。{ward}の朝は早い": "Open for business. Mornings start early in {ward}",
  "年末の売り出しの準備中。今年もありがとうございました":
    "Getting ready for the year-end sale. Thank you for this year",

  洗車した日に限って雨: "Of course it rains the day I wash the car",
  "週末ドライブ。{sign}方面へ": "Weekend drive. Heading toward {sign}",
  "{landmark}が見える道を走るのが好き": "I love roads where you can see {landmark}",
  安全運転してる車ってかっこいい: "Cars driven safely just look cool",
  "オービスが光るのを初めて見た。前の車…": "Saw a speed camera flash for the first time. The car in front…",
  冬用タイヤの準備しないと: "Need to get the winter tires ready",

  "今朝も通学路の見守り。子どもたちのあいさつが元気":
    "School-route watch again this morning. The kids' greetings are so cheerful",
  "通学路の時間帯に車が入ってきて、ヒヤッとしました。標識を守ってください":
    "A car came onto the school route during the closure hours. Gave me a fright. Please follow the signs",
  "雨の日の登校は傘で前が見えにくいので、車の方は特に注意を":
    "On rainy school mornings umbrellas block the kids' view, so drivers please take extra care",
  "下校の時間です。子どもが急に飛び出すことがあります": "School's letting out. Kids may dart out suddenly",

  // ---------- everyday posts: everyone else ----------
  "電車遅れてる…": "Train's delayed…",
  "東京タワー見えた🗼": "Spotted Tokyo Tower 🗼",
  "桜が咲いてた🌸": "The cherry blossoms are out 🌸",
  "新しい車きた！大事に乗る🚗": "New car arrived! Gonna take good care of it 🚗",
  "今日めちゃくちゃ歩いた。2万歩": "Walked a ton today. 20,000 steps",
  "渋滞にハマった。音楽聴きながら気長に待つ": "Stuck in traffic. Just listening to music and waiting it out",
  "横断歩道で止まってくれる車が増えた気がする。ありがたい":
    "Feels like more cars stop at crosswalks these days. Grateful",
  富士山くっきり: "Mt. Fuji crystal clear",
  ランチはラーメン: "Ramen for lunch",
  "{ward}、パトカーがサイレン鳴らして走っていった。何かあったのかな":
    "{ward}: a police car just went by with its siren on. Wonder what happened",
  "近くでオービスが光ったのを見た。昼でもけっこう明るい":
    "Saw a speed camera flash nearby. Pretty bright even in daylight",
  "救急車のサイレンが近い。{ward}で事故かな": "Ambulance siren close by. A crash in {ward}?",
  "白バイを見かけた。かっこいい": "Spotted a police motorcycle. So cool",
  "パトカーとすれ違った。何もしてないのにドキッとする":
    "Passed a police car. Haven't done anything, but my heart still skipped",
  "さっきの車、たぶん覆面パトカーだった。後ろの窓のあたりが怪しかった":
    "That car just now was probably an unmarked police car. Something about the rear window",
  [`${NATURE_CH.number}ch、もう放送休止のカラーバーになってた。夜ふかししすぎ`]: `Channel ${NATURE_CH.number} is already on the off-air color bars. Way too late to be up`,
  [`「${TV_NATURE}」、今日の回よかった`]: "Today's “Nature Journeys” episode was great",
  [`ナビの${TV_WEATHER}で{ward}の天気を確認。便利`]:
    "Checked the weather for {ward} on “23 Wards Now” on the navi. Handy",
  "雨やんだ！傘いらなかった": "Rain stopped! Didn't need the umbrella after all",
  "降ってきた〜傘持ってない": "It's raining~ and no umbrella",
  金木犀の香りがすると秋だなって思う: "The scent of fragrant olive means autumn is here",
  "花粉がつらい。目がかゆい": "Pollen is brutal. My eyes are so itchy",
  "梅雨、洗濯物が乾かない": "Rainy season. The laundry never dries",
  暑すぎて溶けそう: "So hot I'm melting",
  "急に寒くなった。上着出さなきゃ": "Suddenly cold. Time to dig out a jacket",
  ハロウィンの仮装の人をちらほら見かける: "Seeing a few people in Halloween costumes",
  "年末の空気、なんか好き": "Something about the year-end atmosphere. I like it",
  "あけましておめでとうございます。今年も安全運転で": "Happy New Year. Safe driving again this year",
  "桜、満開！": "Cherry blossoms in full bloom!",
  "{ward}から{landmark}が見えるの、地味にうれしい": "Being able to see {landmark} from {ward} is a small joy",
  "{town}のあたり、夜は静かでいい": "The area around {town} is nice and quiet at night",
  "日曜の夕方の、明日が来る感じ…": "That Sunday-evening feeling of Monday coming…",
  "帰りに{snack}買って帰る": "Grabbing some {snack} on the way home",
  "近くの交差点の信号、待ち時間が長い": "The light at the intersection near me takes forever",
  "今日の空、雲が面白い形してる": "Funny-shaped clouds in the sky today",
  "雨の日の交差点、傘がいっぱい": "Rainy-day intersection, full of umbrellas",
  "{river}の水面がきらきら": "{river} is sparkling",
  "バスが来ない…と思ったら2台まとめて来た": "Bus wasn't coming… then two showed up at once",
  "救急車に道を譲る車がきれいに左に寄ってた。すごい":
    "Cars pulled neatly to the left to let an ambulance through. Impressive",
  "自動運転タクシー、本当に運転席に誰もいないまま曲がっていった":
    "A self-driving taxi just turned the corner with literally nobody in the driver's seat",
  "この時間の{ward}、人が少なくて好き": "I love {ward} at this hour, hardly anyone around",
  "{nearWard}まで歩いてみた。東京、区の境目がわからない":
    "Walked over to {nearWard}. In Tokyo you can't tell where one ward ends and the next begins",

  // ---------- everyday posts: the small hours ----------
  "夜の病棟は静か。ナースコールが鳴らない夜はありがたい":
    "The hospital is quiet tonight. Grateful for nights when the call button doesn't ring",
  "夜勤の休憩におにぎり。具は鮭": "Rice ball on my night-shift break. Salmon filling",
  "見回り中。ビルの窓から見える首都高の明かりがきれい":
    "On my rounds. The expressway lights through the building's windows are beautiful",
  "深夜は道が空いてる。でも飛ばさない": "Roads are empty late at night. Still not speeding",
  雨の深夜は特にお客さんが多い: "Rainy late nights bring especially many fares",
  "夜中に乗ったお客さん、すぐ寝ちゃった。起こすのが一番むずかしい":
    "Late-night passenger fell asleep right away. Waking them is the hardest part",
  "夜明け前の湾岸、トラックの列": "Before dawn on the bayside roads: lines of trucks",
  "仮眠明け。コーヒーで目を覚ます": "Up from a nap. Waking up with coffee",
  レポートの締め切りまであと3時間: "Three hours until the paper is due",
  夜中のラーメン動画は罪: "Ramen videos at midnight should be illegal",
  眠れない夜: "Can't sleep tonight",
  "夜中の{ward}、遠くで救急車の音がする": "{ward} at midnight, an ambulance somewhere in the distance",
  "この時間の信号、誰もいないのに律儀に変わってる":
    "At this hour the lights keep changing faithfully for nobody",
  夜風が気持ちいい: "The night breeze feels great",
  夜中に顔の上を歩かれた: "Got walked across the face in the middle of the night",
  "【交通】深夜は速度超過による事故が増える傾向があります。制限速度を守りましょう":
    "[Traffic] Speeding-related crashes tend to rise late at night. Keep to the speed limit",
  "【交通】夜間は歩行者が見えにくくなります。ライトは早めに、上向きも使い分けて":
    "[Traffic] Pedestrians are harder to see at night. Lights on early, and use your high beams when appropriate",
  "最終バスを見送った。今日もおつかれさまでした": "Watched the last bus go. Thanks for another day's work",
  夜食はお茶漬け: "Late-night snack: ochazuke",
  "深夜の幹線道路、空いてて気持ちいい（制限速度で）":
    "Main roads late at night, empty and pleasant (at the speed limit)",
  "雨上がりの夜、路面に信号の色が映ってた":
    "After the rain tonight, the traffic lights were reflected in the road",

  // ---------- everyday posts: about the player's good driving ----------
  "ベビーカーで横断歩道の前にいたら、{color}{car}がちゃんと止まってくれた。ありがとうございます":
    "I was at the crosswalk with the stroller and a {color} {car} stopped for us. Thank you",
  "{town}の横断歩道で、車が止まって待っていてくれました。ゆっくり渡れました":
    "A car stopped and waited for me at the crosswalk in {town}. I could cross at my own pace",
  "横断歩道で止まってくれた車の人、会釈したら手を挙げてくれた。いい人":
    "The driver who stopped at the crosswalk raised a hand when I nodded. Nice person",
  "信号のない横断歩道で止まってくれる車、{town}にもいた。えらい":
    "A car that stops at a crosswalk with no lights: found one in {town}. Respect",
  "犬と横断歩道で待ってたら、{color}{car}が止まってくれた。助かります":
    "Waiting at the crosswalk with my dog, a {color} {car} stopped for us. Much appreciated",
  "横断歩道の手前できちんと止まる車を見た。教習所のお手本みたいだった":
    "Saw a car stop properly before the crosswalk. Like a driving-school demo",
  "子どもたちが渡りきるまで待ってくれた車がいました。ありがとうございます":
    "A car waited until all the kids had crossed. Thank you",
  "「止まれ」で完全に止まってから左右を見る車がいた。見本みたいだった":
    "Saw a car come to a full stop at a stop sign and then look both ways. Textbook",
  "一時停止でちゃんと止まる車、久しぶりに見た気がする。{town}の角で":
    "Haven't seen a car actually stop at a stop sign in ages. On a corner in {town}",
  "一時停止で止まってくれる車がいると、自転車も安心して通れる":
    "When cars stop at stop signs, cyclists can get through without worrying",
  "今の{color}{car}の一時停止、きれいだった。見習わないと":
    "That {color} {car} just made a perfect stop. I should learn from that",
  "角で車がきちんと止まってくれるので、安心して歩けます":
    "Cars stop properly at the corner, so I can walk without worry",
  "停止線の手前でぴたっと止まる車。こういう運転が増えてほしい":
    "A car stopping dead before the stop line. Want to see more driving like this",

  // ---------- replies under everyday posts ----------
  こっちも止まってる: "Mine's stopped too",
  今日は早めに出て正解だった: "Glad I left early today",
  "きれい…": "Beautiful…",
  同じ空を見てました: "I was looking at the same sky",
  こっちからも見えました: "Could see it from here too",
  空の写真いいなあ: "Love sky photos",
  "今日の空、ほんとにいいですよね": "Today's sky really is something",
  こっちも降ってきた: "Started raining here too",
  "傘持ってない…": "Don't have an umbrella…",
  足元に気をつけて: "Watch your step",
  "雨の日の運転、気をつけましょう": "Let's drive carefully in the rain",
  早く止むといいですね: "Hope it stops soon",
  "溶ける…": "Melting…",
  水分補給しましょう: "Stay hydrated",
  外に出たくない暑さ: "Too hot to go outside",
  日傘が手放せない: "Can't go anywhere without my parasol",
  "寒い！": "So cold!",
  上着出しました: "Got my jacket out",
  あったかくしてくださいね: "Stay warm",
  朝晩冷えますね: "Mornings and evenings are chilly",
  季節を感じますね: "You can feel the season",
  もうそんな時期か: "Already that time of year",
  いい季節ですね: "Lovely time of year",
  毎年あっという間: "Every year it flies by",
  おいしそう: "Looks delicious",
  "飯テロ…": "Food torture…",
  お腹すいた: "Now I'm hungry",
  "どこのお店ですか？": "Where's this place?",
  今日それにしよう: "That's what I'm having today",
  いい時間: "Nice moment",
  落ち着きますね: "So relaxing",
  朝のコーヒー大事: "Morning coffee is essential",
  真似したい: "Want to do the same",
  かわいい: "So cute",
  癒された: "That made my day",
  "お名前は？": "What's their name?",
  うちの子も同じことしてる: "Mine does the same thing",
  毎日見に来てます: "I check in every day",
  わかる: "I know, right",
  おつかれさまです: "Good work today",
  それな: "So true",
  明日もがんばりましょう: "Let's do our best tomorrow too",
  通勤ほんとにしんどい: "Commuting is exhausting",
  情報助かります: "Thanks for the info",
  迂回します: "I'll take a detour",
  今そこ通ってる: "Driving through there right now",
  "混んでますね…": "Pretty congested…",
  ありがとうございます: "Thank you",
  勉強になります: "Good to know",
  意外と知らなかった: "Didn't actually know that",
  気をつけます: "I'll be careful",
  保存しました: "Saved this",
  条文まで書いてあるのありがたい: "Love that you cite the article",
  了解です: "Got it",
  "通る予定だった、助かる": "Was going to drive through there, thanks",
  情報ありがとうございます: "Thanks for the update",
  何があったんだろう: "Wonder what happened",
  "近くにいる。サイレンすごい": "I'm nearby. The sirens are loud",
  気をつけて: "Be careful",
  白バイかっこいい: "Police bikes are so cool",
  自分も安全運転しよう: "I'll drive safely too",
  バスいいですよね: "Buses are great",
  "わかる、一番前の席": "Yes, the front seat",
  運転手さんに感謝: "Thanks to the drivers",
  バス好きとして同意: "Agreed, as a bus lover",
  えらい: "Well done",
  無理しないでね: "Don't overdo it",
  応援してます: "Rooting for you",
  "がんばれ〜": "You got this~",
  懐かしい: "Brings back memories",
  単位は大事: "Credits matter",
  ほっこりした: "That warmed my heart",
  うちもです: "Same here",
  子どもって真似するよね: "Kids copy everything",
  きれいな夜: "Beautiful night",
  夜ふかし仲間: "Fellow night owl",
  気をつけて帰ってね: "Get home safe",
  静かな夜っていいですよね: "Quiet nights are the best",
  いい眺め: "Great view",
  見えると得した気分: "Seeing it feels like a bonus",
  今日はよく見えますね: "It's really clear today",
  "{landmark}好き": "Love {landmark}",
  "見てた！": "I was watching too!",
  あの番組いいよね: "That show is great",
  録画しよう: "Gonna record it",
  ナビで音だけ聞いてた: "Was listening on my navi, sound only",
  安全運転で: "Ride safe",
  自転車が気持ちいい季節: "Perfect cycling weather",
  ヘルメット大事: "Helmets matter",
  いい散歩: "Nice walk",
  健康的: "So healthy",
  気持ちよさそう: "Looks refreshing",
  歩くの大事: "Walking is important",
  いい写真: "Great shot",
  構図が好き: "Love the composition",
  "どうやって撮ってるんですか？": "How do you take these?",
  未来だ: "The future is here",
  見てみたい: "I want to see one",
  乗ってみたい: "I want to ride one",
  "運転席が空っぽなの、不思議な感じ": "An empty driver's seat feels so strange",
  "こういう運転、増えてほしい": "Want to see more driving like this",
  "当たり前だけど、その当たり前がうれしいよね":
    "It's just the basics, but it's nice when people do the basics",
  止まってくれると思わず会釈しちゃう: "When a car stops I can't help bowing",
  お手本みたいな運転: "Textbook driving",
  やさしい世界: "Such a kind world",
  "止まってくれる車、最近ちょっと増えた気がする": "Feels like more cars stop lately",
  "止まるのは義務だけど、ちゃんと守る人は好き":
    "Stopping is required, but I still appreciate people who do it",
  教習所の動画に使えそう: "This could be in a driving-school video",
  こういうポストがもっと伸びてほしい: "Want posts like this to get more attention",
  "楽しんでください！": "Have fun!",
  東京へようこそ: "Welcome to Tokyo",
  いい旅を: "Have a good trip",
  "{landmark}おすすめです": "I recommend {landmark}",
  "楽しんでね！": "Enjoy!",
  いいね: "Nice",
  ほんとそれ: "Exactly",

  // ---------- the poster's thanks under an everyday post ----------
  "ありがとうございます！": "Thank you!",
  ですよね: "Right?",
  うれしいです: "That makes me happy",
  "ありがとうございます😊": "Thank you 😊",
  お互い気をつけましょう: "Let's both stay safe",

  // ---------- slot words: food, flowers, the car ----------
  生姜焼き定食: "ginger pork set",
  カレー: "curry",
  オムライス: "omurice",
  そば: "soba",
  うどん: "udon",
  親子丼: "oyakodon",
  ナポリタン: "Napolitan spaghetti",
  焼き魚定食: "grilled fish set",
  冷やし中華: "chilled ramen",
  鍋焼きうどん: "nabeyaki udon",
  どら焼き: "dorayaki",
  たい焼き: "taiyaki",
  大福: "daifuku",
  せんべい: "rice crackers",
  プリン: "pudding",
  みたらし団子: "mitarashi dango",
  焼き芋: "roasted sweet potato",
  栗まんじゅう: "chestnut manju",
  アイス: "ice cream",
  みかん: "mandarins",
  桜もち: "sakura mochi",
  肉じゃが: "nikujaga",
  餃子: "gyoza",
  ハンバーグ: "hamburg steak",
  焼き魚: "grilled fish",
  鍋: "hot pot",
  おでん: "oden",
  そうめん: "somen",
  秋刀魚の塩焼き: "salt-grilled saury",
  菜の花: "rapeseed blossoms",
  チューリップ: "tulips",
  ツツジ: "azaleas",
  紫陽花: "hydrangeas",
  ひまわり: "sunflowers",
  朝顔: "morning glories",
  コスモス: "cosmos",
  金木犀: "fragrant olive blossoms",
  椿: "camellias",
  水仙: "daffodils",
  青い: "blue",
  青っぽい: "bluish",
  ブルーの: "blue",
  コンパクトカー: "compact car",
  ハッチバック: "hatchback",
  乗用車: "car",

  // ---------- bios and places on profiles ----------
  危ない運転を記録しています: "Recording dangerous driving",
  "250ccで休日ツーリング": "Weekend touring on a 250cc",
  季節の花を撮っています: "Photographing the flowers of each season",
  "営業で都内をぐるぐる。社用車と電車": "Sales rep circling Tokyo. Company car and trains",
  創業50年の町の電気屋です: "Neighborhood electronics shop, 50 years and counting",
  東京の街を歩いて記録しています: "Walking and documenting Tokyo's streets",
  自転車で片道12km通勤: "12 km each way to work by bike",
  バスの一番前の席が好き: "Front seat of the bus, always",
  ベイエリアの景色: "Bay area views",
  おにぎりはおかか派: "Team bonito-flake rice ball",
  "4歳と1歳の母": "Mom of a 4-year-old and a 1-year-old",
  純喫茶が好き: "Lover of old-school coffee shops",
  週末は山へ: "Mountains on weekends",
  危険運転の動画を載せています: "Posting videos of dangerous driving",
  ふわふわの家族: "Our fluffy family member",
  "醤油派。週3ラーメン": "Team shoyu. Ramen three times a week",
  "猫と珈琲と週末。": "Cats, coffee and weekends.",
  線路沿いに住んでいます: "Living right by the tracks",
  "元・自動車教習所の指導員": "Former driving-school instructor",
  家族のごはんと節約: "Family meals and saving money",
  夜景と街の写真: "Night views and city photos",
  ドラレコ映像で安全運転を考える: "Thinking about safe driving through dashcam footage",
  出勤前に川沿いを走ってます: "Running by the river before work",
  家事と夕飯の記録: "Housework and dinner diary",
  ゆるく生きてます: "Taking life easy",
  デザイン専門学校1年: "First year at design college",
  写真を撮って歩く人: "Walks around taking photos",
  トマト育ててます: "Growing tomatoes",
  "教習所で指導員をしています。安全確認はしつこく": "Driving-school instructor. I nag about safety checks",
  交差点と雨の日の写真が好き: "Love photographing intersections and rainy days",
  乗り物全般が好き: "Into anything with wheels",
  皇居ラン週3: "Running around the Imperial Palace 3x a week",
  "長距離トラック乗り。道路事情をポストします": "Long-haul trucker. Posting about road conditions",
  "原付で通勤。二段階右折は守る派": "Scooter commuter. I always do the two-stage right turn",
  替え玉は2回まで: "Two noodle refills, max",
  ラーメンとサウナ: "Ramen and saunas",
  "春が好き。二児の母": "Love spring. Mom of two",
  ロードバイク歴15年: "15 years on a road bike",
  "黒猫のクロ（5歳）": "Kuro the black cat (5)",
  湾岸エリアの暮らし: "Life by the bay",
  都内の路線バスに乗って記録しています: "Riding and documenting Tokyo's route buses",
  "週末ドライブが趣味。安全運転第一": "Weekend drives are my hobby. Safety first",
  旅行で東京に来てます: "Visiting Tokyo on a trip",
  孫にスマホを習いました: "My grandchild taught me to use a smartphone",
  "看護師。夜勤明けのポスト多め": "Nurse. Lots of posts after night shifts",
  夕焼けと空の写真: "Sunsets and sky photos",
  "大学生。カフェ巡り": "University student. Café hopping",
  乗るのが好き: "I just like riding",
  年に一度の東京旅行: "My once-a-year Tokyo trip",
  大型トラックで関東を回ってます: "Driving a big rig around the Kanto region",
  "定年後のんびり。散歩が日課": "Retired and taking it easy. Daily walks",
  安全運転で行こう: "Let's drive safe",
  軽バンで都内を配達中: "Delivering around Tokyo in a mini van",
  旧車と国産スポーツが好き: "Into classic cars and Japanese sports cars",
  夜のビルを見回っています: "Patrolling office buildings at night",
  "個人タクシー。安全・丁寧がモットー": "Independent taxi driver. Safe and courteous is my motto",
  "丸の内で働く会社員。電車通勤": "Office worker in Marunouchi. Commute by train",
  東京から富士山が見えた日を記録: "Logging the days Mt. Fuji is visible from Tokyo",
  交通安全を呼びかけています: "Spreading the word on road safety",
  毎日の空を記録: "Recording the sky every day",
  自転車で料理を運んでます: "Delivering food by bike",
  "娘ラブ。子連れのおでかけ記録": "Love my daughter. Outings with the kids",
  空の写真を撮るのが好き: "Love taking photos of the sky",
  経済学部: "Economics major",
  季節の野菜あります: "Seasonal vegetables in stock",
  "都内でタクシー乗務。道のことなら": "Taxi driver in Tokyo. Ask me about roads",
  朝夕の通学路で旗を持っています: "Holding the flag on the school route mornings and afternoons",
  保護猫2匹と暮らしています: "Living with two rescue cats",
  "柴犬（7歳）と朝夕の散歩": "Morning and evening walks with my Shiba (7)",
  コスメと美容の話: "Talking cosmetics and beauty",
  "首都圏の道路と交通の話題をお届けします。": "Road and traffic news for the Tokyo area.",
  "安全運転のコツを毎日ひとつ。道路交通法の条文つきで。":
    "One safe-driving tip a day, with the Road Traffic Act article.",
  "東京の空を毎日撮っています。": "Photographing Tokyo's sky every day.",
  "年間300杯。都内のラーメン記録": "300 bowls a year. A Tokyo ramen log",
  猫との毎日: "Every day with my cat",
  "首都高で通勤20年。渋滞情報と運転のこと":
    "20 years commuting on the Shuto Expressway. Traffic updates and driving talk",
  "教習指導員を30年。基本がいちばん大事": "30 years as a driving instructor. The basics matter most",
  朝のコーヒーが生きがい: "Morning coffee is what I live for",
  [`東京をドライブ中。${SOCIAL_APP_NAME}は見る専`]: `Driving around Tokyo. Just here to read ${SOCIAL_APP_NAME}`,
  八王子市: "Hachioji",
  東京: "Tokyo",
  東京都: "Tokyo",
  旅行中: "Traveling",
  全国: "All over Japan",
  埼玉: "Saitama",
  // ---------- the pursuit and its charges (pursuitDirector.ts) ----------
  "{place}でパトカーに追われてた車が歩行者をはねた…":
    "A car being chased by the police just hit a pedestrian at {place}…",
  "追跡中の車が人をはねたっぽい。{place}。救急車が呼ばれてる":
    "Looks like the car the police were chasing hit someone. {place}. An ambulance has been called.",
  "{time}、{place}。逃げてた車が横断中の人に当たった。けがしてる":
    "{place}, {time}: the car that was fleeing hit someone crossing. They're hurt.",
  "{place}、パトカーから逃げてた{color}{car}が人をはねた":
    "{place}: a {color} {car} running from the police hit someone.",
  "目の前で人がはねられた。追いかけられてた車。{place}":
    "Someone got hit right in front of me. It was the car being chased. {place}",
  "{place}で事故。サイレンを鳴らしたパトカーのすぐ前の車が歩行者に…":
    "Accident at {place}. The car just ahead of a patrol car with its siren on hit a pedestrian…",
  "{place}で、ものすごいスピードの車が人をはねた。パトカーに追われてた":
    "A car going insanely fast hit someone at {place}. The police were chasing it.",
  "赤信号を突っ切った車が横断中の人をはねた…{place}":
    "A car tore through a red light and hit someone crossing… {place}",
  "{place}。逃げる車が赤で交差点に入って、歩いてた人に当たった":
    "{place}. The fleeing car went into the intersection on red and hit someone walking.",
  "{time}、{place}で信号無視の車が人をはねた。あれは危険運転だと思う":
    "A car ran a red and hit someone at {place}, {time}. That's dangerous driving if anything is.",
  "{place}、とんでもない速度で走ってた{color}{car}が人をはねた。けが人が心配":
    "{place}: a {color} {car} doing a crazy speed hit someone. Worried about them.",
  "{place}で暴走した車が歩行者をはねる瞬間が映ってた。警察に提供します":
    "My camera caught the moment a car out of control hit a pedestrian at {place}. Giving it to the police.",
  "{place}で車がパトカーにぶつかっていった…わざと？":
    "A car just rammed a patrol car at {place}… on purpose?",
  "パトカーに体当たりする車を見た。{place}": "Saw a car ram a patrol car. {place}",
  "{place}、検問の警察官に向かって車が突っ込んでいった。危ない":
    "{place}: a car drove straight at the officer at the checkpoint. So dangerous.",
  "{time}、{place}。止めに入った警察の車に車をぶつけてた":
    "{place}, {time}: a car smashed into the police car trying to stop it.",
  "{place}でパトカーに車をぶつけて逃げようとする瞬間。ドラレコに残ってた":
    "My dashcam caught a car ramming a patrol car to get away at {place}.",
  "{place}で警察の車にぶつけていった{color}{car}。信じられない":
    "A {color} {car} crashed into a police car at {place}. Unbelievable.",
  "{place}、パトカーのバンパーがへこんでた。ぶつけた車がいるらしい":
    "{place}: a patrol car with a dented bumper. Apparently someone rammed it.",
  "{place}でパトカーに当てていった車。パトカー、けっこう壊れてる":
    "A car hit a patrol car at {place}. The patrol car's pretty banged up.",
  "パトカーにぶつけるとか…{place}": "Hitting a patrol car… really? {place}",
  "{time}、{place}。警察の車両が傷だらけ。逃げた車がぶつけたって":
    "{place}, {time}: a police vehicle all scratched up. They say the fleeing car hit it.",
  "{place}、白バイが倒れてた。車にぶつけられたみたい":
    "{place}: a police motorcycle on its side. Looks like a car hit it.",
  "{place}でぶつけられたパトカー。ライトが割れてる":
    "The patrol car that got hit at {place}. Its lights are smashed.",
  "#公務執行妨害": "#ObstructingPolice",
  "#ヘリ": "#Helicopter",
  "【交通】{ward}付近で緊急配備。パトカーや白バイが集まっています。緊急車両には道を譲ってください":
    "[Traffic] Police are mobilizing around {ward}, with patrol cars and motorcycles converging. Please give way to emergency vehicles.",
  "【交通】{ward}の上空で警察のヘリコプターが旋回しています":
    "[Traffic] A police helicopter is circling over {ward}.",
  "【交通】{ward}付近の交差点で検問が行われています。時間に余裕をもってお出かけください":
    "[Traffic] Police are running a checkpoint at an intersection near {ward}. Allow extra time.",
  "{ward}、パトカーと白バイが次々に走っていった。何事？":
    "Patrol cars and police bikes going past one after another in {ward}. What's going on?",
  "ヘリの音がずっと近い。{ward}で何かあったのかな":
    "That helicopter's been overhead forever. Something happening in {ward}?",
  "{ward}の交差点で検問してた。今日なにかあったの？":
    "There's a police checkpoint at an intersection in {ward}. What happened today?",
  "{place}でパトカーが何台も1台の車を追いかけてる": "Several patrol cars are chasing one car at {place}",
  "サイレンがすごい。{place}でパトカーと白バイが車を追ってる":
    "Sirens everywhere. Patrol cars and police bikes are chasing a car at {place}",
  "{place}、逃げる車をパトカーが追跡中。巻き込まれないように":
    "{place}: the police are chasing a car. Stay clear, everyone.",
  "{place}でパトカーに追われてる車を撮った。かなりのスピード":
    "Filmed a car being chased by the police at {place}. Going really fast.",
  "{time}、{place}。パトカー何台かが同じ車を追いかけていった":
    "{place}, {time}: a few patrol cars just went by after the same car.",
  "{place}でパトカーとヘリが車を追ってる": "Patrol cars and a helicopter are chasing a car at {place}",
  "上空にヘリ、地上にパトカー。{place}で逃げる車を追跡中みたい":
    "Helicopter above, patrol cars on the ground. Looks like they're chasing a car at {place}.",
  "{place}の先で検問やってる。追われてる車がいるらしい":
    "There's a checkpoint up ahead past {place}. Apparently they're after a car.",
  "{place}でパトカーとヘリが車を追う様子。ニュースになりそう":
    "Patrol cars and a helicopter chasing a car at {place}. This'll be on the news.",
  "{time}、{place}。ヘリの音がずっとしてる。逃げてる車がいるって":
    "{place}, {time}: the helicopter hasn't stopped. They say a car is running from the police.",
  "{place}でパトカーが車を追いかけてる": "Patrol cars are chasing a car at {place}",
  "【続報】{place}付近でパトカーの停止に従わず走り去った車について、警察はナンバーや投稿された動画などから運転者を特定したもようです":
    "[Update] The police appear to have identified the driver of the car that ignored a patrol car's order to stop near {place}, from its plate and videos people posted.",
  // ---------- a car pulled over at the roadside (SocialFeed.postStop) ----------
  "ちゃんと止まったなら、それだけでえらい": "If they actually stopped, that's something at least",
  取り締まりを見ると気が引き締まる: "Seeing a traffic stop makes me drive more carefully",
  何の違反だったんだろう: "Wonder what they did",
  "あそこ、取り締まりよくやってるよね": "They do traffic stops there a lot",
  "晒すのはやめておこう。ナンバーは消してね": "Let's not pile on. Blur the plate, please",
  "切符を切られたら、次から気をつければいい": "Get a ticket, be more careful next time. That's all",
  "後ろの車の邪魔にならない所に止めてて、えらい":
    "Good on them for stopping where they weren't blocking anyone",
  赤色灯って遠くからでも目立つね: "You can see those red lights from a long way off",
  逃げなかっただけ立派: "At least they didn't run",
  "{place}で取り締まり中。安全運転で": "Traffic stop going on at {place}. Drive safe",
  "止められてる車を見ると、自分の運転を見直す": "Seeing someone pulled over makes me rethink my own driving",
  ナンバーと顔は映らないようにしてます: "I made sure no plates or faces are visible",
  しばらくしたら車は走っていきました: "The car drove off after a while",
  "{place}で白黒パトカーに止められてる車いる": "There's a car pulled over by a patrol car at {place}",
  "{place}、パトカーが後ろについて車を止めてた。何があったんだろう":
    "{place}: a patrol car pulled up behind a car and stopped it. Wonder what happened",
  "{place}でお巡りさんが運転席の窓のところで話してる":
    "An officer is talking to the driver through the window at {place}",
  "{time}、{place}。パトカーの赤色灯がずっと回ってる。取り締まりかな":
    "{place}, {time}: the patrol car's red lights have been flashing for a while. Traffic stop, probably",
  "{place}の路肩で{color}{car}がパトカーに止められてる":
    "A {color} {car} is pulled over by the police at the curb at {place}",
  "{place}、歩道から見えた。パトカーに止められてる車":
    "{place}: saw it from the sidewalk. A car pulled over by the police",
  "{place}で白バイに止められてる車いる": "There's a car pulled over by a police motorcycle at {place}",
  "白バイの隊員さんが車の横で話してる。{place}":
    "A motorcycle officer is talking to the driver beside the car. {place}",
  "{time}、{place}。白バイが車を路肩に止めさせてた":
    "{place}, {time}: a police motorcycle had a car pull over to the curb",
  "{place}、白バイの取り締まり。歩道から": "{place}: a police motorcycle traffic stop. From the sidewalk",
  "切符切られてるっぽい。{place}": "Looks like someone's getting a ticket. {place}",
  "{place}、パトカーに止められた車。青切符かな。自分も気をつけよう":
    "{place}: a car stopped by the police. Probably a ticket. Note to self: be careful",
  "{place}で取り締まり。ちゃんと路肩に寄せて止まってた":
    "Traffic stop at {place}. They pulled over properly to the curb",
  "{time}、{place}。お巡りさんが何か書いてる。切符だろうな":
    "{place}, {time}: the officer's writing something. A ticket, I guess",
  "{place}、運転手さんがパトカーの後ろの席に乗せられてる":
    "{place}: the driver is getting into the back of the patrol car",
  "{place}で止められた車、けっこう長く話してる。赤切符かな":
    "The car pulled over at {place} has been there a while. Something serious, maybe",
  "パトカーの中で書類を書いてるっぽい。{place}。重めの違反なのかな":
    "Looks like they're doing paperwork in the patrol car. {place}. A bigger violation, maybe",
  "{time}、{place}。止められてた車の運転手がパトカーに乗った":
    "{place}, {time}: the driver of the car that was stopped got into the patrol car",
  "{place}で運転手が警察に連れて行かれた…": "The police just took a driver away at {place}…",
  "{place}、パトカーが何台も止まってて、運転手が乗せられていった":
    "{place}: several patrol cars, and the driver was taken away in one",
  "逮捕されたっぽい。{place}。何をしたんだろう": "Looks like an arrest. {place}. Wonder what they did",
  "{place}で運転手がパトカーに乗せられるところ。顔は映してません":
    "The driver being put into a patrol car at {place}. No faces shown",
  "{time}、{place}。警察官に囲まれた車から運転手が降りてきた":
    "{place}, {time}: the driver got out of a car surrounded by officers",
  "さっきの逃げてた車、{place}でやっと止まったみたい":
    "The car that was running from the police finally stopped at {place}, it seems",
  "{place}、パトカーに追われてた車が止められてる。周りに警察官がたくさん":
    "{place}: the car the police were chasing has been stopped. Officers everywhere",
  "追跡、{place}で終わったっぽい。けが人がいないといいけど":
    "Looks like the chase ended at {place}. Hope nobody got hurt",
  "#取り締まり": "#TrafficStop",
  "{place}でパトカーが車を止めてる": "The police have pulled a car over at {place}",
};
