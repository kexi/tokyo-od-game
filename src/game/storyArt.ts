import * as i18n from "../i18n";
import type { PanelArt } from "./arrestStory";
import { CHANNELS } from "./tvRules";

/**
 * The illustrations of the story panels (arrestStory.ts), drawn on a 1280×720 canvas with flat
 * shapes: no photographs, no real place, no emblem, no organisation's name or logo, faceless
 * people. Quiet colours and still scenes — the panels tell what the law does next, they do not
 * dramatise it. Words on documents and screens come from src/i18n in the language in force.
 */
export const ART_W = 1280;
export const ART_H = 720;

/** What a panel shows besides its picture. */
export type ArtWords = {
  /** The case's charges (already translated), for documents. */
  charges: string[];
  /** Where it happened (ward and town), for the news and the camera's caption. */
  place: string;
  /** Y's lines about it, in the language in force (newest first). */
  posts: Array<{ name: string; handle: string; text: string }>;
  /** The last panel's stamp (取消 / 停止 30日 / 6点) and its smaller line. */
  stamp: string;
  stampSub: string;
};

const FONT = () =>
  i18n.getLocale() === "zh"
    ? '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
    : '"Noto Sans JP", system-ui, sans-serif';

type Ctx = CanvasRenderingContext2D;

/** Draw one panel; `progress` (0–1) moves it a little (a slow push-in), nothing more. */
export function drawPanel(ctx: Ctx, art: PanelArt, progress: number, words: ArtWords): void {
  ctx.save();
  ctx.clearRect(0, 0, ART_W, ART_H);
  const zoom = 1 + 0.035 * progress;
  ctx.translate(ART_W / 2, ART_H / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-ART_W / 2, -ART_H / 2);
  ctx.textBaseline = "alphabetic";
  DRAW[art](ctx, words, progress);
  ctx.restore();
  vignette(ctx);
}

const DRAW: Record<PanelArt, (ctx: Ctx, w: ArtWords, p: number) => void> = {
  arrested: drawArrested,
  patrolSeat: drawPatrolSeat,
  redTicket: (ctx, w) => drawDocument(ctx, i18n.t("story.art.redTicket"), w.charges, "#c8262c", "red"),
  court: drawCourt,
  fine: drawFine,
  station: drawStation,
  interview: drawInterview,
  transfer: drawTransfer,
  detention: drawDetention,
  release: drawRelease,
  tvNews: drawTvNews,
  yFeed: drawYFeed,
  licence: drawLicence,
  plate: drawPlate,
  home: drawHome,
  warrant: (ctx, w) => drawDocument(ctx, i18n.t("story.art.warrant"), w.charges, "#3a3a3a", "seal"),
};

function vignette(ctx: Ctx): void {
  const g = ctx.createRadialGradient(ART_W / 2, ART_H / 2, ART_H * 0.35, ART_W / 2, ART_H / 2, ART_W * 0.7);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ART_W, ART_H);
}

function sky(ctx: Ctx, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, ART_H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ART_W, ART_H);
}

/** A row of dark buildings with a few lit windows (the same every time: a fixed seed). */
function skyline(ctx: Ctx, base: number, colour: string, lit: string): void {
  let seed = 11;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = -20; x < ART_W + 20;) {
    const w = 60 + r() * 110;
    const h = 120 + r() * 260;
    ctx.fillStyle = colour;
    ctx.fillRect(x, base - h, w - 6, h);
    ctx.fillStyle = lit;
    for (let y = base - h + 14; y < base - 16; y += 22)
      for (let wx = x + 10; wx < x + w - 18; wx += 18) if (r() > 0.62) ctx.fillRect(wx, y, 8, 10);
    x += w;
  }
}

/** A faceless standing figure: `cap` for an officer's cap, `vest` for the reflective vest. */
function figure(
  ctx: Ctx,
  x: number,
  y: number,
  s: number,
  body: string,
  opts: { cap?: boolean; vest?: boolean } = {},
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(-34, -170, 68, 110, 18);
  ctx.fill();
  ctx.fillRect(-28, -64, 24, 64);
  ctx.fillRect(4, -64, 24, 64);
  if (opts.vest) {
    ctx.fillStyle = "rgba(190,230,90,0.85)";
    ctx.fillRect(-30, -160, 60, 70);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(-30, -128, 60, 6);
  }
  ctx.fillStyle = "#d8b593";
  ctx.beginPath();
  ctx.arc(0, -196, 24, 0, Math.PI * 2);
  ctx.fill();
  if (opts.cap) {
    ctx.fillStyle = "#1d2740";
    ctx.beginPath();
    ctx.ellipse(0, -214, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-24, -224, 48, 12);
    ctx.fillStyle = "#c9a54a";
    ctx.beginPath();
    ctx.ellipse(0, -219, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A side view of a saloon; `patrol` paints it black below and white above with a red light bar. */
function car(
  ctx: Ctx,
  x: number,
  y: number,
  s: number,
  colour: string,
  patrol: boolean,
  lightOn: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = patrol ? "#111317" : colour;
  ctx.beginPath();
  ctx.roundRect(-220, -70, 440, 60, 20);
  ctx.fill();
  ctx.fillStyle = patrol ? "#f2f2f0" : colour;
  ctx.beginPath();
  ctx.moveTo(-200, -70);
  ctx.lineTo(-120, -130);
  ctx.lineTo(90, -130);
  ctx.lineTo(170, -70);
  ctx.closePath();
  ctx.fill();
  if (patrol) ctx.fillRect(-210, -84, 420, 18);
  ctx.fillStyle = "#1a2433";
  ctx.beginPath();
  ctx.moveTo(-180, -74);
  ctx.lineTo(-114, -124);
  ctx.lineTo(84, -124);
  ctx.lineTo(150, -74);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0b0b0b";
  for (const wx of [-130, 130]) {
    ctx.beginPath();
    ctx.arc(wx, -10, 36, 0, Math.PI * 2);
    ctx.fill();
  }
  if (patrol) {
    ctx.fillStyle = lightOn ? "#ff2b2b" : "#5a1010";
    ctx.fillRect(-60, -146, 120, 16);
    if (lightOn) {
      const g = ctx.createRadialGradient(0, -138, 4, 0, -138, 260);
      g.addColorStop(0, "rgba(255,40,40,0.55)");
      g.addColorStop(1, "rgba(255,40,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-260, -400, 520, 520);
    }
  }
  ctx.restore();
}

function road(ctx: Ctx, top: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(0, top, ART_W, ART_H - top);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let x = 0; x < ART_W; x += 120) ctx.fillRect(x, top + 70, 60, 6);
}

function label(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  align: CanvasTextAlign = "left",
  max?: number,
): void {
  ctx.fillStyle = colour;
  ctx.font = `700 ${size}px ${FONT()}`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y, max);
}

function drawArrested(ctx: Ctx, _w: ArtWords, p: number): void {
  sky(ctx, "#0b1222", "#1d2a44");
  skyline(ctx, 430, "#0a1120", "rgba(255,214,140,0.5)");
  road(ctx, 430, "#22262d");
  const flash = Math.floor(p * 18) % 2 === 0;
  car(ctx, 820, 640, 1, "#2f4f7f", true, flash);
  car(ctx, 340, 650, 1.05, "#7a8794", false, false);
  figure(ctx, 560, 640, 1, "#1f2c4c", { cap: true });
  figure(ctx, 640, 646, 1, "#1f2c4c", { cap: true });
}

function drawPatrolSeat(ctx: Ctx, _w: ArtWords, p: number): void {
  sky(ctx, "#05080f", "#101826");
  // The windscreen: the street ahead at night, through the glass.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(150, 120);
  ctx.lineTo(1130, 120);
  ctx.lineTo(1210, 430);
  ctx.lineTo(70, 430);
  ctx.closePath();
  ctx.clip();
  sky(ctx, "#101a30", "#2a3550");
  skyline(ctx, 380, "#0c1426", "rgba(255,220,150,0.6)");
  ctx.fillStyle = "#1c2028";
  ctx.fillRect(0, 380, ART_W, 60);
  ctx.restore();
  // Red light on the bonnet, pulsing.
  const glow = 0.25 + 0.2 * Math.sin(p * 30);
  ctx.fillStyle = `rgba(255,40,40,${glow})`;
  ctx.fillRect(70, 400, 1140, 40);
  // The front seats' backs and the officers' shoulders, from behind.
  for (const x of [380, 900]) {
    ctx.fillStyle = "#1a1d24";
    ctx.beginPath();
    ctx.roundRect(x - 170, 330, 340, 420, 50);
    ctx.fill();
    ctx.fillStyle = "#24304e";
    ctx.beginPath();
    ctx.roundRect(x - 120, 250, 240, 140, 40);
    ctx.fill();
    ctx.fillStyle = "#1d2740";
    ctx.beginPath();
    ctx.ellipse(x, 220, 58, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // A clipboard on the back seat.
  ctx.fillStyle = "#6b4f32";
  ctx.fillRect(560, 560, 170, 140);
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(575, 575, 140, 120);
}

/** A form on a desk: title, the charges, a stamp or a red rule. */
function drawDocument(ctx: Ctx, title: string, lines: string[], ink: string, mark: "red" | "seal"): void {
  sky(ctx, "#3a3026", "#2a221b");
  ctx.save();
  ctx.translate(ART_W / 2, ART_H / 2 + 10);
  ctx.rotate(-0.04);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(-300, -300, 620, 620);
  ctx.fillStyle = "#f7f4ec";
  ctx.fillRect(-310, -310, 620, 620);
  ctx.strokeStyle = ink;
  ctx.lineWidth = mark === "red" ? 10 : 3;
  ctx.strokeRect(-290, -290, 580, 580);
  label(ctx, title, 0, -220, 40, ink, "center", 540);
  ctx.strokeStyle = "rgba(60,60,60,0.35)";
  ctx.lineWidth = 2;
  for (let y = -160; y < 260; y += 44) {
    ctx.beginPath();
    ctx.moveTo(-260, y);
    ctx.lineTo(260, y);
    ctx.stroke();
  }
  lines.slice(0, 6).forEach((line, i) => label(ctx, line, -250, -130 + i * 44, 24, "#1a1a1a", "left", 500));
  if (mark === "seal") {
    ctx.strokeStyle = "#c8262c";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(200, 220, 50, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCourt(ctx: Ctx): void {
  sky(ctx, "#8fa8c4", "#d7dfe8");
  ctx.fillStyle = "#b9b4aa";
  ctx.fillRect(200, 180, 880, 420);
  ctx.fillStyle = "#a29d93";
  ctx.fillRect(170, 150, 940, 50);
  ctx.fillStyle = "#8d887f";
  for (let x = 250; x < 1060; x += 110) ctx.fillRect(x, 230, 40, 370);
  ctx.fillStyle = "#cfcac0";
  for (let i = 0; i < 5; i++) ctx.fillRect(220 - i * 20, 600 + i * 22, 840 + i * 40, 22);
  ctx.fillStyle = "#3b3a37";
  ctx.fillRect(590, 470, 100, 130);
  label(ctx, i18n.t("story.art.court"), ART_W / 2, 135, 34, "#2a2a2a", "center");
}

function drawFine(ctx: Ctx): void {
  sky(ctx, "#d9dde3", "#bfc5cd");
  ctx.fillStyle = "#8a9099";
  ctx.fillRect(0, 430, ART_W, 290);
  ctx.fillStyle = "#e9ecf0";
  ctx.fillRect(330, 150, 620, 280);
  ctx.fillStyle = "#4b5563";
  ctx.fillRect(330, 150, 620, 40);
  label(ctx, i18n.t("story.art.counter"), 640, 180, 24, "#ffffff", "center");
  ctx.save();
  ctx.translate(640, 520);
  ctx.rotate(0.05);
  ctx.fillStyle = "#fffdf6";
  ctx.fillRect(-220, -110, 440, 220);
  ctx.strokeStyle = "#2f6f3e";
  ctx.lineWidth = 4;
  ctx.strokeRect(-205, -95, 410, 190);
  label(ctx, i18n.t("story.art.fine"), 0, -40, 34, "#2f6f3e", "center", 400);
  label(ctx, i18n.t("story.art.paid"), 0, 30, 26, "#333333", "center", 400);
  ctx.restore();
}

function drawStation(ctx: Ctx, _w: ArtWords, p: number): void {
  sky(ctx, "#0b1222", "#18243b");
  ctx.fillStyle = "#3a4152";
  ctx.fillRect(260, 140, 760, 460);
  ctx.fillStyle = "rgba(255,226,160,0.55)";
  for (let y = 180; y < 520; y += 60)
    for (let x = 300; x < 980; x += 80) if ((x + y) % 160 !== 0) ctx.fillRect(x, y, 44, 32);
  ctx.fillStyle = "#20252f";
  ctx.fillRect(560, 470, 160, 130);
  // The red lamp over the entrance: a police station's sign everywhere in Japan, no emblem.
  const on = Math.floor(p * 10) % 2 === 0 ? 1 : 0.75;
  const g = ctx.createRadialGradient(640, 440, 4, 640, 440, 120);
  g.addColorStop(0, `rgba(255,50,50,${0.8 * on})`);
  g.addColorStop(1, "rgba(255,50,50,0)");
  ctx.fillStyle = g;
  ctx.fillRect(500, 320, 280, 240);
  ctx.fillStyle = "#ff3b3b";
  ctx.beginPath();
  ctx.arc(640, 440, 16, 0, Math.PI * 2);
  ctx.fill();
  road(ctx, 600, "#1c2028");
}

function drawInterview(ctx: Ctx): void {
  sky(ctx, "#5d6470", "#4a505a");
  // Window with blinds.
  ctx.fillStyle = "#c9d6e2";
  ctx.fillRect(860, 110, 300, 220);
  ctx.fillStyle = "#8b96a3";
  for (let y = 120; y < 330; y += 18) ctx.fillRect(860, y, 300, 8);
  // Table and lamp.
  ctx.fillStyle = "#7a5f44";
  ctx.fillRect(300, 430, 680, 40);
  ctx.fillRect(330, 470, 30, 200);
  ctx.fillRect(920, 470, 30, 200);
  ctx.fillStyle = "#333333";
  ctx.fillRect(620, 360, 10, 70);
  ctx.fillStyle = "#e5d28a";
  ctx.beginPath();
  ctx.moveTo(580, 370);
  ctx.lineTo(670, 370);
  ctx.lineTo(645, 340);
  ctx.lineTo(605, 340);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(470, 405, 120, 24);
  figure(ctx, 250, 600, 1.15, "#2a2f3a");
  figure(ctx, 1040, 600, 1.15, "#24304e");
}

function drawTransfer(ctx: Ctx): void {
  sky(ctx, "#f2c6a0", "#a9b8cf");
  skyline(ctx, 470, "#7b8394", "rgba(255,240,200,0.4)");
  road(ctx, 470, "#565b63");
  // A plain grey van leaving.
  ctx.fillStyle = "#c7cbd1";
  ctx.beginPath();
  ctx.roundRect(400, 420, 520, 170, 24);
  ctx.fill();
  ctx.fillStyle = "#2b3442";
  ctx.fillRect(820, 440, 80, 60);
  ctx.fillStyle = "#0b0b0b";
  for (const x of [500, 820]) {
    ctx.beginPath();
    ctx.arc(x, 595, 40, 0, Math.PI * 2);
    ctx.fill();
  }
  // The papers that go with the case.
  ctx.save();
  ctx.translate(220, 240);
  ctx.rotate(-0.08);
  ctx.fillStyle = "#fbfaf5";
  ctx.fillRect(-90, -110, 180, 220);
  label(ctx, i18n.t("story.art.transfer"), 0, -60, 28, "#333333", "center", 170);
  ctx.restore();
}

function drawDetention(ctx: Ctx): void {
  sky(ctx, "#3d434d", "#2a2f37");
  ctx.fillStyle = "#59606b";
  ctx.fillRect(140, 120, 1000, 480);
  ctx.fillStyle = "#454b55";
  for (const x of [240, 560, 880]) ctx.fillRect(x, 200, 160, 400);
  ctx.fillStyle = "#e9ecf0";
  ctx.fillRect(1010, 150, 110, 110);
  // A calendar of days.
  ctx.fillStyle = "#c8262c";
  ctx.fillRect(1010, 150, 110, 26);
  ctx.fillStyle = "#333333";
  for (let i = 0; i < 12; i++) ctx.fillRect(1020 + (i % 4) * 25, 186 + Math.floor(i / 4) * 24, 14, 14);
}

function drawRelease(ctx: Ctx): void {
  sky(ctx, "#fde6c4", "#c9daf0");
  ctx.fillStyle = "#6c717a";
  ctx.fillRect(0, 0, 420, ART_H);
  ctx.fillStyle = "#fff4dc";
  ctx.fillRect(260, 220, 160, 380);
  figure(ctx, 640, 620, 1.1, "#3a4252");
  road(ctx, 620, "#8a8f96");
}

function drawTvNews(ctx: Ctx, w: ArtWords, p: number): void {
  // The navi TV's fictional news channel: the aerial view of a street at night, captions, no reporter.
  sky(ctx, "#060a14", "#121b2d");
  ctx.save();
  ctx.translate(ART_W / 2, ART_H / 2 - 40);
  ctx.rotate(-0.25);
  ctx.fillStyle = "#1b2130";
  ctx.fillRect(-900, -60, 1800, 120);
  ctx.fillRect(-60, -700, 120, 1400);
  for (let i = 0; i < 14; i++) {
    const x = ((i * 137 + p * 400) % 1800) - 900;
    ctx.fillStyle = i % 3 === 0 ? "#ff3030" : "#fff3c4";
    ctx.fillRect(x, i % 2 ? -30 : 20, 10, 6);
  }
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 26px ${FONT()}`;
  ctx.textAlign = "left";
  ctx.fillText(i18n.t("tv.mark", { n: CHANNELS[0]?.number ?? 1 }), 36, 52);
  ctx.fillStyle = "#d8232a";
  ctx.fillRect(0, 548, 260, 64);
  label(ctx, i18n.t("story.art.newsTag"), 130, 592, 30, "#ffffff", "center", 240);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillRect(260, 548, ART_W - 260, 64);
  label(ctx, i18n.t("story.art.newsLine", { place: w.place }), 284, 592, 28, "#10213d", "left", ART_W - 310);
  ctx.fillStyle = "#0a1a33";
  ctx.fillRect(0, 612, ART_W, 56);
  label(ctx, i18n.t("story.art.newsSub"), 36, 650, 22, "#ffffff", "left", ART_W - 72);
}

function drawYFeed(ctx: Ctx, w: ArtWords): void {
  sky(ctx, "#1d2633", "#0f141c");
  ctx.fillStyle = "#0b0d12";
  ctx.beginPath();
  ctx.roundRect(440, 40, 400, 660, 46);
  ctx.fill();
  ctx.fillStyle = "#f7f8fa";
  ctx.beginPath();
  ctx.roundRect(458, 70, 364, 610, 30);
  ctx.fill();
  label(ctx, "Y", 640, 118, 34, "#111111", "center");
  const posts = w.posts.length ? w.posts : [{ name: "—", handle: "", text: i18n.t("story.art.noPosts") }];
  posts.slice(0, 3).forEach((post, i) => {
    const y = 150 + i * 170;
    ctx.fillStyle = "#e6e9ee";
    ctx.fillRect(474, y, 332, 156);
    ctx.fillStyle = ["#7aa6d8", "#d89a7a", "#8fc49a"][i % 3] ?? "#999999";
    ctx.beginPath();
    ctx.arc(502, y + 30, 18, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, post.name, 530, y + 28, 18, "#111111", "left", 270);
    label(ctx, post.handle, 530, y + 50, 14, "#5b6470", "left", 270);
    ctx.font = `500 17px ${FONT()}`;
    ctx.fillStyle = "#1a1a1a";
    wrap(ctx, post.text, 488, y + 82, 304, 22, 3);
  });
}

function drawLicence(ctx: Ctx, w: ArtWords): void {
  sky(ctx, "#2b2f36", "#1d2026");
  ctx.save();
  ctx.translate(ART_W / 2, ART_H / 2);
  ctx.rotate(-0.05);
  // A plain card, not the real licence's design.
  ctx.fillStyle = "#e8eef2";
  ctx.beginPath();
  ctx.roundRect(-330, -200, 660, 400, 24);
  ctx.fill();
  ctx.fillStyle = "#9db7c9";
  ctx.fillRect(-330, -200, 660, 60);
  label(ctx, i18n.t("story.art.licence"), -300, -158, 30, "#ffffff", "left", 560);
  ctx.fillStyle = "#b8c2cc";
  ctx.fillRect(-300, -110, 180, 230);
  ctx.fillStyle = "#c5ccd4";
  for (let y = -100; y < 120; y += 40) ctx.fillRect(-90, y, 360, 16);
  // The stamp.
  ctx.rotate(-0.2);
  ctx.strokeStyle = "#c8262c";
  ctx.lineWidth = 8;
  ctx.strokeRect(-150, -70, 420, 150);
  label(ctx, w.stamp, 60, 20, 72, "#c8262c", "center", 400);
  ctx.restore();
  label(ctx, w.stampSub, ART_W / 2, 660, 26, "#e6e6e6", "center", ART_W - 120);
}

function drawPlate(ctx: Ctx, w: ArtWords, p: number): void {
  // A street camera's grainy frame with the time and a box round the plate (masked).
  sky(ctx, "#2a2d31", "#1a1c1f");
  car(ctx, 640, 560, 1.25, "#7a8794", false, false);
  ctx.strokeStyle = "#ffd400";
  ctx.lineWidth = 4;
  ctx.strokeRect(560, 470, 160, 60);
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(570, 480, 140, 40);
  label(ctx, "●● ・●-●●", 640, 510, 24, "#1b5e20", "center");
  let seed = 3 + Math.floor(p * 20);
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.05})`;
    ctx.fillRect(r() * ART_W, r() * ART_H, 2, 2);
  }
  label(ctx, `CAM 03  ${w.place}`, 30, 50, 24, "#e6e6e6", "left", 800);
  label(ctx, "● REC", ART_W - 30, 50, 24, "#ff4040", "right");
}

function drawHome(ctx: Ctx): void {
  sky(ctx, "#cfe0f2", "#eef3f8");
  ctx.fillStyle = "#d8cbb5";
  ctx.fillRect(160, 160, 960, 460);
  ctx.fillStyle = "#6b4f32";
  ctx.fillRect(520, 330, 160, 290);
  ctx.fillStyle = "#3b3f46";
  ctx.fillRect(700, 400, 26, 40);
  figure(ctx, 840, 640, 1.05, "#1f2c4c", { cap: true });
  figure(ctx, 940, 640, 1.05, "#2a3550");
  road(ctx, 620, "#9aa0a6");
}

/** Text wrapped to `width`, at most `lines` lines (the last ends with … when cut). */
function wrap(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: number,
): void {
  const isSpaced = /\s/.test(text) && /[A-Za-z]/.test(text);
  const units = isSpaced ? text.split(/(\s+)/) : [...text];
  let line = "";
  let row = 0;
  for (const u of units) {
    const next = line + u;
    if (ctx.measureText(next).width > width && line) {
      const isLast = row === lines - 1;
      ctx.fillText(isLast ? `${line.trimEnd()}…` : line.trimEnd(), x, y + row * height);
      row++;
      if (row >= lines) return;
      line = u.trimStart();
      continue;
    }
    line = next;
  }
  if (line) ctx.fillText(line, x, y + row * height);
}
