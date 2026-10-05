import { Box3, Vector3, type Object3D } from "three";
import type { Voice, VoiceOutput } from "../ai/tts";
import type { AreaIndex } from "../geo/areas";
// A namespace: TvSound calls its time `t`.
import * as i18n from "../i18n";
import { localUtterance } from "../i18n/speech";
import type { GameAudio } from "./audio";
import type { Assist } from "./carControls";
import {
  autoReturn,
  channelLabel,
  CHANNELS,
  mayShowPicture,
  naviView,
  pressChannel,
  pressTv,
  programmeAt,
  programmeBed,
  programmeTitle,
  skyOf,
  skyWord,
  stationName,
  STOP_KMH,
  tickerItems,
  tickerLine,
  trackSetOff,
  TV_OFF,
  type NaviView,
  type Programme,
  type TickerItem,
  type TickerKind,
  type TvDrive,
  type TvInfo,
  type TvState,
} from "./tvRules";

/**
 * ナビのテレビ on the cockpit's centre display (the same canvas as the map, game/carNavi.ts): three
 * fictional channels drawn on the canvas, their sound from the navi's place in the cabin, and the
 * picture lock real navis have — the picture only with the car stopped and parked, 「走行中は映像を
 * 表示できません」 and the sound alone otherwise (the rules are in tvRules.ts).
 */
const W = 640;
const H = 400;
const REDRAW_MS = 66; // ~15 fps: the ticker and the river move, nothing needs more
const INFO_MS = 1000;
const BADGE_MS = 3500;
const NOTICE_MS = 12000;
const NOTICE_KEY = "tod.tvNotice";
// Chinese in Chinese fonts first: Noto Sans JP lacks many simplified forms, and a mix of fallbacks
// is hard to read (the same order as style.css gives html:lang(zh) body).
const FONTS = {
  ja: '"Noto Sans JP", system-ui, sans-serif',
  en: '"Noto Sans JP", system-ui, sans-serif',
  zh: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif',
} as const;
const font = () => FONTS[i18n.getLocale()];
/** The newsreader's pace (ms between items) on the news, and the weather read again. */
const PACE: Partial<Record<Programme, number>> = { news: 12000, weather: 25000 };
/** The bed under the voice, into the navi's speaker 60 cm from the ear: quiet, as TV in a car is. */
const BED_LEVEL: Record<Programme, number> = { news: 0.05, weather: 0.06, nature: 0.09, colorBars: 0.02 };
const SPEECH_LEVEL = 0.45;
const TICKER_PX_PER_MS = 0.07;
/** The parking brake is Space in both key layouts (input.ts reads it directly, not as an action). */
const PARKING_BRAKE_KEY = "Space";

export type TvFrame = {
  now: number;
  drive: TvDrive;
  assist: Assist;
  routeActive: boolean;
  /** The driver is in the car (the navi has power; leaving the car takes the key). */
  inCar: boolean;
  /** Heard from the driver's seat: speechSynthesis cannot be placed in the cabin, so only then. */
  inCabin: boolean;
};

type Deps = {
  audio: GameAudio;
  voice: Voice;
  areas: AreaIndex | null;
  info: () => TvInfo;
  /** Where the navi's screen is in the car's frame (its speaker plays from there). */
  speakerAt: () => Vector3;
  /** Nobody else is talking (a conversation, a call): the newsreader waits. */
  canSpeak: () => boolean;
};

/** The navi's screen in the car's frame; a dash-centre guess without the cockpit model. */
export function displayOffset(root: Object3D | null, car: Object3D): Vector3 {
  const display = root?.getObjectByName("Display_Center");
  if (!display) return new Vector3(0, 0.2, 0.62);
  car.updateWorldMatrix(true, true);
  const centre = new Box3().setFromObject(display).getCenter(new Vector3());
  return car.worldToLocal(centre);
}

export class NaviTv {
  state: TvState = TV_OFF;
  private drive: TvDrive = { kmh: 0, parkingBrake: false, engineOff: false };
  private assist: Assist = "easy";
  private armed = true;
  private drawnAt = -Infinity;
  private shown: NaviView = "map";
  private now = 0;
  private tunedAt = -Infinity;
  private noticeUntil = 0;
  private hasNoticed = readNoticed();
  private hasWarnedMoving = false;
  private info: TvInfo | null = null;
  private infoAt = -Infinity;
  private items: TickerItem[] = [];
  private line = -1;
  private lineAt = -Infinity;
  private sound: TvSound | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private wardMap: WardMap | null = null;

  constructor(private readonly deps: Deps) {}

  /** テレビ: returns what to tell the driver. */
  press(): string {
    const isOperating = Math.abs(this.drive.kmh) >= STOP_KMH;
    this.setState(pressTv(this.state));
    if (!this.state.on) return i18n.t("tv.off");
    return this.tuneMessage(isOperating);
  }

  /** チャンネル (also closes the 受信料 notice). */
  channelUp(): string {
    const isOperating = Math.abs(this.drive.kmh) >= STOP_KMH;
    this.noticeUntil = 0;
    this.setState(pressChannel(this.state));
    return this.tuneMessage(isOperating);
  }

  /** Leaving the car takes the key: the navi goes dark (the channel is remembered). */
  switchOff(): void {
    if (this.state.on) this.setState({ ...this.state, on: false, screen: "map" });
  }

  /** ♪ on the map while the TV plays behind it (null: no TV sound). */
  get badge(): string | null {
    const isBehindMap = this.state.on && this.state.screen === "map";
    return isBehindMap ? `♪ ${CHANNELS[this.state.channel].number}ch` : null;
  }

  /** Once a frame: the picture lock's inputs, 簡単操作's return to the map, the sound and the newsreader. */
  update(f: TvFrame): string | null {
    this.now = f.now;
    this.drive = f.drive;
    this.assist = f.assist;
    if (!f.inCar) {
      this.switchOff();
      this.sound?.play(null);
      return null;
    }
    const setOff = trackSetOff(this.armed, f.drive.kmh);
    this.armed = setOff.armed;
    const next = autoReturn(this.state, {
      assist: f.assist,
      routeActive: f.routeActive,
      setOff: setOff.setOff,
    });
    const isReturned = next !== this.state;
    this.state = next;
    if (f.now - this.infoAt > INFO_MS) {
      this.infoAt = f.now;
      this.info = this.deps.info();
    }
    const programme = this.state.on ? this.programme() : null;
    this.ensureSound()?.play(programme);
    this.read(programme, f);
    const isMutedNow = this.deps.audio.muted || !f.inCabin;
    if (isMutedNow && this.utterance) this.hush();
    return isReturned ? i18n.t("tv.backToMap") : null;
  }

  /** Draw the TV on the navi's canvas; false when the map should be drawn instead. */
  draw(canvas: HTMLCanvasElement, now: number): boolean {
    const view = naviView(this.state, this.drive);
    if (view === "map") {
      this.shown = "map";
      return false;
    }
    const isFresh = view === this.shown && now - this.drawnAt < REDRAW_MS;
    if (isFresh) return true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    this.shown = view;
    this.drawnAt = now;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    if (view === "blocked") this.drawBlocked(ctx);
    else this.drawPicture(ctx, now);
    ctx.restore();
    return true;
  }

  /** State for the dev hook and headless checks. */
  describe(): Record<string, unknown> {
    return {
      ...this.state,
      view: naviView(this.state, this.drive),
      programme: this.state.on ? this.programme() : null,
      drive: this.drive,
      line: this.items[this.line]?.text ?? null,
      sound: this.sound?.describe() ?? null,
    };
  }

  // ---------- state ----------

  private setState(next: TvState): void {
    const isTuned = next.on && (!this.state.on || next.channel !== this.state.channel);
    this.state = next;
    if (isTuned) {
      this.tunedAt = this.now;
      // The first item a moment after tuning in, then at the programme's pace.
      this.line = -1;
      this.lineAt = -Infinity;
      this.hush();
    }
    if (!next.on) this.hush();
  }

  private programme(): Programme {
    return programmeAt(this.state.channel, this.info?.hour ?? 12);
  }

  private tuneMessage(isOperating: boolean): string {
    const ch = CHANNELS[this.state.channel];
    const label = i18n.t("tv.tuned", {
      n: ch.number,
      station: stationName(this.state.channel),
      title: programmeTitle(this.programme()),
    });
    const isStopped = Math.abs(this.drive.kmh) < STOP_KMH;
    const isLocked = !mayShowPicture(this.drive);
    const isBrakeHint = isLocked && isStopped && this.assist !== "easy";
    const told =
      isLocked && !isStopped
        ? i18n.t("tv.tunedMoving", { label })
        : isBrakeHint
          ? i18n.t("tv.tunedBrake", { label, key: PARKING_BRAKE_KEY })
          : label;
    // Working a fitted navi is not 保持 and shows nothing to 注視 (第71条第5号の5), but it takes the
    // eyes off the road for a moment: said once.
    const isFirstWhileMoving = isOperating && !this.hasWarnedMoving;
    if (isFirstWhileMoving) this.hasWarnedMoving = true;
    return isFirstWhileMoving ? i18n.t("tv.tunedCaution", { text: told }) : told;
  }

  // ---------- sound ----------

  private ensureSound(): TvSound | null {
    if (this.sound) return this.sound;
    const ctx = this.deps.audio.context;
    if (!ctx || !this.state.on) return null;
    const speaker = this.deps.audio.spatial.cabinSpeaker(this.deps.speakerAt());
    if (!speaker) return null;
    this.sound = new TvSound(ctx, speaker);
    return this.sound;
  }

  /** The newsreader: the next item at the programme's pace, when nobody else is talking. */
  private read(programme: Programme | null, f: TvFrame): void {
    const pace = programme ? PACE[programme] : undefined;
    if (!pace || !this.info) return;
    const isDue = f.now - this.lineAt >= pace || (this.line < 0 && f.now - this.tunedAt > 1500);
    if (!isDue) return;
    this.lineAt = f.now;
    const all = tickerItems(this.info);
    this.items = programme === "weather" ? all.filter((i) => i.kind === "weather") : all;
    if (this.items.length === 0) return;
    this.line = (this.line + 1) % this.items.length;
    const item = this.items[this.line];
    const isSpoken = item !== undefined && item.speech !== "";
    if (isSpoken && this.deps.canSpeak()) this.say(item.speech, f.inCabin);
  }

  private say(text: string, inCabin: boolean): void {
    const { audio, voice } = this.deps;
    const sound = this.sound;
    // Muted, nothing is read (why not let the master gain hush it: the lines would still be
    // synthesised and queue in front of the people's).
    const isSilent = audio.muted || audio.volume <= 0;
    if (isSilent) return;
    // The on-device voice (sanoTTS-jp) plays through WebAudio, from the navi's speaker under the
    // 音量 — but it speaks Japanese only, so in English and Chinese the browser's voice reads.
    const isJapaneseVoice = voice.enabled && sound !== null && i18n.getLocale() === "ja";
    if (isJapaneseVoice) {
      voice.speak(text, () => sound.speechOut());
      return;
    }
    if (!inCabin) return;
    // In the language in force, with a voice that speaks it (none: the ticker alone).
    const u = localUtterance(text);
    if (!u) return;
    u.rate = 1.05;
    u.volume = Math.min(1, audio.volume * 0.6);
    u.addEventListener("end", () => {
      if (this.utterance === u) this.utterance = null;
    });
    this.utterance = u;
    speechSynthesis.speak(u);
  }

  /** Stop the newsreader's speechSynthesis line, unless someone else's line is queued behind it. */
  private hush(): void {
    const isOnlyOurs = this.utterance !== null && "speechSynthesis" in window && !speechSynthesis.pending;
    if (isOnlyOurs) speechSynthesis.cancel();
    this.utterance = null;
  }

  // ---------- pictures ----------

  private drawBlocked(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#05070b";
    ctx.fillRect(0, 0, W, H);
    // A speaker with sound waves: the programme goes on as sound.
    ctx.strokeStyle = "#8fa3bf";
    ctx.fillStyle = "#8fa3bf";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(268, 112);
    ctx.lineTo(284, 112);
    ctx.lineTo(304, 94);
    ctx.lineTo(304, 158);
    ctx.lineTo(284, 140);
    ctx.lineTo(268, 140);
    ctx.closePath();
    ctx.fill();
    for (const r of [18, 32, 46]) {
      ctx.beginPath();
      ctx.arc(306, 126, r, -0.7, 0.7);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 34px ${font()}`;
    ctx.fillText(i18n.t("tv.blocked"), W / 2, 236, W - 40);
    ctx.fillStyle = "#aab6c8";
    ctx.font = `500 22px ${font()}`;
    ctx.fillText(i18n.t("tv.blockedSub", { channel: channelLabel(this.state.channel) }), W / 2, 280, W - 40);
  }

  private drawPicture(ctx: CanvasRenderingContext2D, now: number): void {
    const programme = this.programme();
    const info = this.info ?? this.deps.info();
    if (programme === "news") this.drawNews(ctx, now, info);
    else if (programme === "weather") this.drawWeather(ctx, info);
    else if (programme === "nature") drawNature(ctx, now, info.weather.night);
    else drawColorBars(ctx);
    const isTuning = now - this.tunedAt < BADGE_MS;
    if (isTuning) this.drawBadge(ctx);
    // The 受信料 notice, the first time a picture shows in this browser.
    if (!this.hasNoticed) {
      this.hasNoticed = true;
      saveNoticed();
      this.noticeUntil = now + NOTICE_MS;
    }
    if (now < this.noticeUntil) drawNotice(ctx, info.violations.length);
  }

  private drawBadge(ctx: CanvasRenderingContext2D): void {
    const ch = CHANNELS[this.state.channel];
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(W - 232, 8, 214, 70, 10);
    ctx.fill();
    ctx.fillStyle = "#7dff9a";
    ctx.textAlign = "left";
    ctx.font = `700 40px ${font()}`;
    ctx.fillText(`${ch.number}`, W - 218, 58);
    ctx.font = `700 18px ${font()}`;
    ctx.fillText("ch", W - 168, 58);
    ctx.fillStyle = "#ffffff";
    ctx.font = `500 17px ${font()}`;
    ctx.fillText(stationName(this.state.channel), W - 140, 38, 116);
    ctx.fillText(programmeTitle(this.programme()), W - 140, 62, 116);
  }

  /** The studio: a skyline behind glass, the desk, a faceless newsreader, a lower third and the ticker. */
  private drawNews(ctx: CanvasRenderingContext2D, now: number, info: TvInfo): void {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0d2a52");
    bg.addColorStop(1, "#163d6e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // The city through the studio window: the same blocks every frame (a fixed seed).
    let seed = 7;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let x = 0; x < W;) {
      const w = 24 + r() * 40;
      const h = 60 + r() * 130;
      ctx.fillStyle = "#0a1f3d";
      ctx.fillRect(x, 250 - h, w - 3, h);
      ctx.fillStyle = "rgba(255,214,120,0.55)";
      for (let wy = 250 - h + 8; wy < 240; wy += 12)
        for (let wx = x + 4; wx < x + w - 8; wx += 9) if (r() > 0.55) ctx.fillRect(wx, wy, 4, 5);
      x += w;
    }
    // A monitor beside the reader, with a picture for the item being read.
    const item = this.items[this.line] ?? tickerItems(info)[0];
    ctx.fillStyle = "#04101f";
    ctx.fillRect(388, 62, 222, 150);
    ctx.fillStyle = "#1f5aa0";
    ctx.fillRect(394, 68, 210, 138);
    drawItemIcon(ctx, item.kind, 499, 137, info);
    // The newsreader: a figure, no face (nobody real).
    ctx.fillStyle = "#1c2433";
    ctx.beginPath();
    ctx.ellipse(208, 258, 92, 70, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#f2f2f2";
    ctx.beginPath();
    ctx.moveTo(190, 192);
    ctx.lineTo(226, 192);
    ctx.lineTo(208, 236);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d9b48f";
    ctx.beginPath();
    ctx.ellipse(208, 158, 30, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1d14";
    ctx.beginPath();
    ctx.ellipse(208, 140, 32, 22, 0, Math.PI, 0);
    ctx.fill();
    // The desk with the programme's name.
    ctx.fillStyle = "#e8edf5";
    ctx.beginPath();
    ctx.moveTo(40, 250);
    ctx.lineTo(380, 250);
    ctx.lineTo(400, 288);
    ctx.lineTo(20, 288);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0d2a52";
    ctx.textAlign = "center";
    ctx.font = `700 20px ${font()}`;
    ctx.fillText(programmeTitle("news"), 210, 278, 340);
    // Corner: the channel's mark (text only) and the time.
    const { h, m } = { h: Math.floor(info.hour) % 24, m: Math.floor((info.hour % 1) * 60) };
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `700 18px ${font()}`;
    ctx.fillText(i18n.t("tv.mark", { n: CHANNELS[0].number }), 18, 34);
    ctx.textAlign = "right";
    ctx.font = `700 24px ${font()}`;
    ctx.fillText(`${h}:${String(m).padStart(2, "0")}`, W - 18, 36);
    // Lower third: the item being read.
    ctx.fillStyle = "#d8232a";
    ctx.fillRect(0, 298, 168, 40);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillRect(168, 298, W - 168, 40);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 19px ${font()}`;
    ctx.fillText(item.tag, 84, 325, 156);
    ctx.textAlign = "left";
    ctx.fillStyle = "#10213d";
    ctx.font = `700 19px ${font()}`;
    ctx.fillText(item.text, 180, 325, W - 196);
    // The ticker: everything at once, scrolling right to left.
    ctx.fillStyle = "#0a1a33";
    ctx.fillRect(0, 352, W, 48);
    const text = tickerLine(tickerItems(info));
    ctx.font = `500 20px ${font()}`;
    const width = ctx.measureText(text).width;
    const x = W - (((now - this.tunedAt) * TICKER_PX_PER_MS) % (width + W));
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x, 384);
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(0, 352, 96, 48);
    ctx.fillStyle = "#0a1a33";
    ctx.textAlign = "center";
    ctx.font = `700 18px ${font()}`;
    ctx.fillText(i18n.t("tv.newsBadge"), 48, 383, 88);
  }

  /** The 23 wards with the car's ward picked out, the sky as a symbol and the observed numbers. */
  private drawWeather(ctx: CanvasRenderingContext2D, info: TvInfo): void {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#1b4f8c");
    bg.addColorStop(1, "#2a77b8");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.font = `700 26px ${font()}`;
    ctx.fillText(programmeTitle("weather"), 22, 40);
    ctx.font = `500 15px ${font()}`;
    ctx.fillText(channelLabel(1), 24, 62);
    const map = this.wardMapFor(info.ward);
    if (map) {
      ctx.drawImage(map.canvas, 18, 74);
      const [x, y] = map.project(info.lon, info.lat);
      const isOnMap = x > 0 && y > 0 && x < MAP_W && y < MAP_H;
      if (isOnMap) {
        ctx.fillStyle = "#e3262f";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(18 + x, 74 + y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 15px ${font()}`;
        ctx.textAlign = "center";
        ctx.fillText(i18n.t("tv.here"), 18 + x, 74 + y - 14);
      }
    }
    const w = info.weather;
    const sky = skyOf(w);
    drawSky(ctx, sky, w.night, 470, 128, 1.25);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 28px ${font()}`;
    const skyText = skyWord(sky);
    ctx.fillText(skyText.charAt(0).toUpperCase() + skyText.slice(1), 470, 212, 300);
    ctx.font = `700 46px ${font()}`;
    const temp = w.temp !== null ? `${w.temp.toFixed(1)}℃` : "—";
    ctx.fillText(temp, 470, 266);
    ctx.font = `500 18px ${font()}`;
    const rows = [
      w.humidity !== null ? i18n.t("tv.screen.humidity", { n: Math.round(w.humidity) }) : "",
      w.wind !== null ? i18n.t("tv.screen.wind", { n: w.wind.toFixed(1) }) : "",
      w.fixedSky ? i18n.t("tv.screen.fixedSky") : i18n.t("tv.screen.rain10", { n: w.precip10m ?? 0 }),
    ].filter(Boolean);
    rows.forEach((row, i) => ctx.fillText(row, 470, 298 + i * 24, 300));
    ctx.font = `400 14px ${font()}`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const hasNumbers = w.temp !== null || w.humidity !== null;
    ctx.fillText(hasNumbers ? i18n.t("tv.screen.observed") : "", 470, 374, 330);
    ctx.textAlign = "left";
    ctx.fillText(i18n.t("tv.screen.next"), 22, 392, 330);
  }

  /** The wards drawn once into a canvas (again when the car's ward changes, to pick it out). */
  private wardMapFor(ward: string): WardMap | null {
    if (this.wardMap?.ward === ward) return this.wardMap;
    const areas = this.deps.areas;
    if (!areas) return null;
    const canvas = this.wardMap?.canvas ?? document.createElement("canvas");
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    const g = canvas.getContext("2d");
    if (!g) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    areas.forEachRing((_, ring) => {
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]);
        maxX = Math.max(maxX, ring[i]);
        minY = Math.min(minY, ring[i + 1]);
        maxY = Math.max(maxY, ring[i + 1]);
      }
    });
    // Equirectangular, east–west shrunk by cos(latitude) so the wards keep their shapes.
    const kx = Math.cos((((minY + maxY) / 2) * 1e-5 * Math.PI) / 180);
    const scale = Math.min((MAP_W - 12) / ((maxX - minX) * kx), (MAP_H - 12) / (maxY - minY));
    const offX = (MAP_W - (maxX - minX) * kx * scale) / 2;
    const offY = (MAP_H - (maxY - minY) * scale) / 2;
    const projectQ = (x: number, y: number): [number, number] => [
      offX + (x - minX) * kx * scale,
      offY + (maxY - y) * scale,
    ];
    g.clearRect(0, 0, MAP_W, MAP_H);
    g.lineJoin = "round";
    const index = new Map<string, number>();
    areas.forEachRing((name, ring) => {
      if (!index.has(name)) index.set(name, index.size);
      const isHere = name === ward;
      // Neighbouring ward codes are mostly neighbours on the map: four tints keep them apart.
      const tint = isHere ? "#ffe28a" : WARD_TINTS[(index.get(name) ?? 0) % WARD_TINTS.length];
      g.beginPath();
      for (let i = 0; i < ring.length; i += 2) {
        const [x, y] = projectQ(ring[i], ring[i + 1]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = tint;
      // Stroked in its own colour: no hairline seams between the towns of one ward.
      g.strokeStyle = tint;
      g.lineWidth = 1;
      g.fill();
      g.stroke();
    });
    const project = (lon: number, lat: number) => projectQ(lon * 1e5, lat * 1e5);
    this.wardMap = { canvas, ward, project };
    return this.wardMap;
  }
}

type WardMap = {
  canvas: HTMLCanvasElement;
  ward: string;
  project: (lon: number, lat: number) => [number, number];
};

const MAP_W = 330;
const MAP_H = 300;
const WARD_TINTS = ["#8fc98f", "#a9d6a0", "#7dbb86", "#b8dca8"];

/** The speaker's side of the sound: the bed of the programme on air, the newsreader, the TV's volume. */
class TvSound {
  private readonly out: GainNode;
  private readonly speech: GainNode;
  private bed: { src: AudioBufferSourceNode; gain: GainNode; programme: Programme } | null = null;
  private readonly buffers = new Map<Programme, AudioBuffer>();

  constructor(
    private readonly ctx: AudioContext,
    speaker: AudioNode,
  ) {
    this.out = new GainNode(ctx, { gain: 0 });
    this.out.connect(speaker);
    this.speech = new GainNode(ctx, { gain: SPEECH_LEVEL });
    this.speech.connect(this.out);
  }

  /** Play a programme's bed (null: silence), fading from the one before. */
  play(p: Programme | null): void {
    const t = this.ctx.currentTime;
    if (this.bed?.programme === p) return;
    this.out.gain.setTargetAtTime(p ? 1 : 0, t, 0.05);
    const old = this.bed;
    if (old) {
      old.gain.gain.setTargetAtTime(0, t, 0.05);
      old.src.stop(t + 0.4);
      old.src.addEventListener("ended", () => old.gain.disconnect());
      this.bed = null;
    }
    if (!p) return;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer(p), loop: true });
    const gain = new GainNode(this.ctx, { gain: 0 });
    src.connect(gain).connect(this.out);
    gain.gain.setTargetAtTime(BED_LEVEL[p], t + 0.15, 0.08);
    src.start(t);
    this.bed = { src, gain, programme: p };
  }

  /** Where the on-device voice connects for the newsreader. */
  speechOut(): VoiceOutput {
    return { attach: () => this.speech, release: () => {} };
  }

  describe(): Record<string, unknown> {
    return {
      programme: this.bed?.programme ?? null,
      out: this.out.gain.value,
      bed: this.bed?.gain.gain.value ?? 0,
    };
  }

  private buffer(p: Programme): AudioBuffer {
    let b = this.buffers.get(p);
    if (!b) {
      const data = programmeBed(p, this.ctx.sampleRate);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.buffers.set(p, b);
    }
    return b;
  }
}

/** The monitor's picture for a news item: a clock, a pin, the sky, a warning sign, a crossing. */
function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  kind: TickerKind,
  x: number,
  y: number,
  info: TvInfo,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  if (kind === "time") {
    const { h, m } = { h: info.hour % 12, m: (info.hour % 1) * 60 };
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();
    const hand = (a: number, len: number) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len);
      ctx.stroke();
    };
    hand((h / 12) * Math.PI * 2, 26);
    hand((m / 60) * Math.PI * 2, 40);
  } else if (kind === "place") {
    ctx.fillStyle = "#e3262f";
    ctx.beginPath();
    ctx.arc(0, -14, 26, Math.PI, 0);
    ctx.lineTo(0, 46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, -14, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "weather") {
    drawSky(ctx, skyOf(info.weather), info.weather.night, 0, 0, 0.9);
  } else if (kind === "violations") {
    // A warning triangle (yellow, black rim) with "!".
    ctx.fillStyle = "#ffd400";
    ctx.strokeStyle = "#111111";
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(54, 44);
    ctx.lineTo(-54, 44);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#111111";
    ctx.font = `900 58px ${font()}`;
    ctx.textAlign = "center";
    ctx.fillText("!", 0, 36);
  } else {
    // 交通安全: a zebra crossing seen from above.
    for (let i = -2; i <= 2; i++) ctx.fillRect(i * 22 - 7, -40, 14, 80);
  }
  ctx.restore();
}

/** Weather symbols: sun (or moon at night), cloud, rain. */
function drawSky(
  ctx: CanvasRenderingContext2D,
  sky: string,
  night: boolean,
  x: number,
  y: number,
  s: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const cloud = (cx: number, cy: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(cx - 22, cy + 6, 20, 0, Math.PI * 2);
    ctx.arc(cx + 2, cy - 8, 26, 0, Math.PI * 2);
    ctx.arc(cx + 26, cy + 6, 18, 0, Math.PI * 2);
    ctx.rect(cx - 22, cy + 6, 48, 20);
    ctx.fill();
  };
  const isClear = sky === "晴れ" || sky === "雨なし";
  if (isClear && night) {
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b4f8c";
    ctx.beginPath();
    ctx.arc(16, -10, 30, 0, Math.PI * 2);
    ctx.fill();
  } else if (isClear) {
    ctx.fillStyle = "#ffb52e";
    ctx.strokeStyle = "#ffb52e";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 38, Math.sin(a) * 38);
      ctx.lineTo(Math.cos(a) * 52, Math.sin(a) * 52);
      ctx.stroke();
    }
  } else if (sky === "くもり") {
    cloud(0, 0, "#e6ebf2");
  } else {
    cloud(0, -10, "#c9d2de");
    ctx.strokeStyle = "#7fc4ff";
    ctx.lineWidth = 5;
    for (const dx of [-24, 0, 24]) {
      ctx.beginPath();
      ctx.moveTo(dx, 28);
      ctx.lineTo(dx - 8, 50);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 自然紀行: hills, a wood and a river by day (or under the moon), birds crossing, ripples drifting. */
function drawNature(ctx: CanvasRenderingContext2D, now: number, night: boolean): void {
  const sky = ctx.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, night ? "#0b1530" : "#5aa7e6");
  sky.addColorStop(1, night ? "#24365e" : "#cfe8f7");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  if (night) {
    ctx.fillStyle = "#fff6d6";
    ctx.beginPath();
    ctx.arc(520, 70, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  const ridge = (base: number, amp: number, k: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16)
      ctx.lineTo(x, base - amp * (0.6 * Math.sin(x * k + 1) + 0.4 * Math.sin(x * k * 2.7 + 2)));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  };
  ridge(190, 40, 0.008, night ? "#1d2b45" : "#7c9fb8");
  ridge(230, 30, 0.013, night ? "#14261f" : "#3f7a4a");
  // A wood along the bank.
  ctx.fillStyle = night ? "#0e1d16" : "#2d6138";
  for (let x = -10; x < W; x += 26) {
    const h = 40 + 18 * Math.sin(x * 0.37);
    ctx.beginPath();
    ctx.moveTo(x, 262);
    ctx.lineTo(x + 14, 262 - h);
    ctx.lineTo(x + 28, 262);
    ctx.closePath();
    ctx.fill();
  }
  // The river, with ripples drifting downstream.
  ctx.fillStyle = night ? "#1a2c4d" : "#4f93c7";
  ctx.fillRect(0, 262, W, 92);
  ctx.strokeStyle = night ? "rgba(255,246,214,0.35)" : "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  for (let row = 0; row < 6; row++) {
    const y = 272 + row * 14;
    const shift = (now * (0.02 + row * 0.006)) % 80;
    for (let x = -80 + shift + row * 13; x < W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 22 + row * 3, y);
      ctx.stroke();
    }
  }
  // Birds crossing by day.
  if (!night) {
    ctx.strokeStyle = "#1d2b45";
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const x = ((now * 0.03 + i * 60) % (W + 80)) - 40;
      const y = 80 + i * 18 + 6 * Math.sin(now * 0.004 + i);
      const flap = 6 * Math.sin(now * 0.012 + i * 2);
      ctx.beginPath();
      ctx.moveTo(x - 10, y - flap);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 10, y - flap);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 354, W, 46);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `700 20px ${font()}`;
  ctx.fillText(i18n.t("tv.nature.caption", { title: programmeTitle("nature") }), 18, 384, 440);
  ctx.textAlign = "right";
  ctx.font = `400 14px ${font()}`;
  ctx.fillText(i18n.t("tv.nature.illustrative"), W - 16, 384, 150);
  ctx.textAlign = "left";
  ctx.font = `700 18px ${font()}`;
  ctx.fillText(i18n.t("tv.mark", { n: CHANNELS[2].number }), 18, 34);
}

/** 放送休止: colour bars (75 % bars, reverse bars, −I / white / +Q / PLUGE) and a caption. */
function drawColorBars(ctx: CanvasRenderingContext2D): void {
  const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
  const reverse = ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"];
  const bw = W / 7;
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw), H * 0.67);
  });
  reverse.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.floor(i * bw), H * 0.67, Math.ceil(bw), H * 0.08);
  });
  const bottom: Array<[string, number]> = [
    ["#00214c", 1.25],
    ["#ffffff", 1.25],
    ["#32006a", 1.25],
    ["#131313", 1.25],
    ["#090909", bw / 3 / bw],
    ["#131313", bw / 3 / bw],
    ["#1d1d1d", bw / 3 / bw],
    ["#131313", 1],
  ];
  let x = 0;
  for (const [c, units] of bottom) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.floor(x), H * 0.75, Math.ceil(units * bw), H * 0.25);
    x += units * bw;
  }
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, 44);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `700 20px ${font()}`;
  ctx.fillText(i18n.t("tv.colorBars.caption", { channel: channelLabel(2) }), 16, 30, W - 32);
}

/**
 * 受信料のお知らせ — a parody, plainly fictional: no organisation, no form, no number to pay to,
 * only the game's joke that keeping the law pays the fee.
 */
function drawNotice(ctx: CanvasRenderingContext2D, violations: number): void {
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "#2f63e6";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(70, 92, W - 140, 186, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2f63e6";
  ctx.textAlign = "center";
  // Lines no wider than the card (an English line runs longer than its Japanese).
  const width = W - 170;
  ctx.font = `700 24px ${font()}`;
  ctx.fillText(i18n.t("tv.fee.title"), W / 2, 132, width);
  ctx.fillStyle = "#10213d";
  ctx.font = `500 19px ${font()}`;
  ctx.fillText(i18n.t("tv.fee.line1"), W / 2, 172, width);
  ctx.fillText(i18n.t("tv.fee.line2", { n: violations }), W / 2, 202, width);
  ctx.fillText(i18n.t("tv.fee.line3"), W / 2, 232, width);
  ctx.fillStyle = "#5a6577";
  ctx.font = `400 14px ${font()}`;
  ctx.fillText(i18n.t("tv.fee.close"), W / 2, 262, width);
}

function readNoticed(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    // Storage blocked: the notice shows once per page load.
    return false;
  }
}

function saveNoticed(): void {
  try {
    localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // Not remembered; it shows once more next time.
  }
}
