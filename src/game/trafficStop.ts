import type { MessageKey } from "../i18n";
import type { Assist } from "./carControls";
import type { PursuitEnd } from "./pursuitEscalation";
import type { Disposal } from "./pursuitLaw";

/**
 * The roadside stop: what the driver should do when called over, how well it was done, and the
 * scene at the window. Pure (the scene in pursuitScene.ts draws it, main.ts measures the place):
 *
 * 1. Called over: signal left, pull over to the kerb where stopping is safe — not in a junction or
 *    within 5 m of one, not on or within 5 m of a crosswalk, not where 駐停車禁止 is posted
 *    (道路交通法 第44条; 第40条 asks the same of a driver giving way to an emergency vehicle) —
 *    stop, hazards on. 簡単操作 signals and turns the hazards on by itself.
 * 2. The patrol car stops behind with its lights on; the officer walks to the driver's window.
 * 3. At the window: the licence, the offence and its moment (the replay clip), the driver's word,
 *    then the ticket (blue) or what follows (red, 任意同行, arrest).
 */

/** What main.ts measured where the car stopped. */
export type StopSite = {
  /** In a junction or within 5 m of its side edge (第44条第1項第1号・第2号). */
  junction: boolean;
  /** On a crosswalk or within 5 m of it (第44条第1項第3号). */
  crossing: boolean;
  /** A 駐停車禁止 section in force (JARTIC 65). */
  noStopping: boolean;
  /** Metres from the car's left side to the kerb (Infinity: not on a street). */
  kerbGap: number;
  /** Stopped in a lane right of the leftmost (on a multi-lane road). */
  rightLane: boolean;
};

export type PullOverInput = {
  site: StopSite;
  /** The left indicator was on in the seconds before the stop. */
  signalled: boolean;
  /** Hazards on at the stop (or before the officer reaches the window). */
  hazards: boolean;
  /** Seconds from the first call to standing still. */
  secondsToStop: number;
  end: PursuitEnd;
  assist: Assist;
};

export type PullOverIssue = "junction" | "crossing" | "noStopping" | "notAtKerb" | "rightLane";
export type PullOverVerdict = {
  /** Stopped where stopping is allowed and at the kerb. */
  safe: boolean;
  issues: PullOverIssue[];
  signalled: boolean;
  hazards: boolean;
  /** Stopped within PROMPT_S of the call. */
  prompt: boolean;
  /** 0–3: prompt, hazards, signal (the window is opened at the window, see politeAtWindow). */
  courtesy: number;
};

export const PROMPT_S = 15;
/** At the kerb: the car's left side within this of it. */
export const KERB_GAP_M = 1.2;

export function judgePullOver(i: PullOverInput): PullOverVerdict {
  const issues: PullOverIssue[] = [];
  if (i.site.junction) issues.push("junction");
  if (i.site.crossing) issues.push("crossing");
  if (i.site.noStopping) issues.push("noStopping");
  if (i.site.rightLane) issues.push("rightLane");
  const isAtKerb = i.site.kerbGap <= KERB_GAP_M;
  if (!isAtKerb && !i.site.rightLane) issues.push("notAtKerb");
  const isComplied = i.end === "pulledOver";
  const prompt = isComplied && i.secondsToStop <= PROMPT_S;
  const courtesy = [prompt, i.hazards, i.signalled].filter(Boolean).length;
  return { safe: issues.length === 0, issues, signalled: i.signalled, hazards: i.hazards, prompt, courtesy };
}

/** The officer's word on how the car was pulled over (a key of src/i18n). */
export function pullOverRemark(v: PullOverVerdict, fled: boolean): MessageKey {
  if (fled) return "stop.remark.fled";
  const where = v.issues.find((x) => x !== "notAtKerb");
  if (where === "junction") return "stop.remark.junction";
  if (where === "crossing") return "stop.remark.crossing";
  if (where === "noStopping") return "stop.remark.noStopping";
  if (where === "rightLane") return "stop.remark.rightLane";
  if (v.issues.includes("notAtKerb")) return "stop.remark.notAtKerb";
  if (!v.signalled) return "stop.remark.noSignal";
  if (v.courtesy >= 3) return "stop.remark.perfect";
  return "stop.remark.good";
}

/** Thanked for: prompt, hazards and the window opened at the knock. */
export function politeAtWindow(v: PullOverVerdict, windowOpened: boolean, fled: boolean): boolean {
  return !fled && v.prompt && v.hazards && windowOpened;
}

/**
 * The guide on screen while called over: each step and whether it is done. In 簡単操作 the car
 * signals and puts the hazards on itself, so those steps say so instead of naming a key.
 */
export type GuideStep = { key: MessageKey; done: boolean; auto: boolean };
export function guideSteps(s: {
  assist: Assist;
  signalling: boolean;
  atKerb: boolean;
  safePlace: boolean;
  stopped: boolean;
  hazards: boolean;
}): GuideStep[] {
  const isEasy = s.assist === "easy";
  return [
    { key: "stop.guide.signal", done: s.signalling || s.stopped, auto: isEasy },
    { key: "stop.guide.kerb", done: s.atKerb && s.safePlace, auto: false },
    { key: "stop.guide.stop", done: s.stopped, auto: false },
    { key: "stop.guide.hazards", done: s.hazards, auto: isEasy },
  ];
}

// ---------------------------------------------------------------- the scene at the roadside

/**
 * The shots before the window: the patrol car behind with its lights on (seen from behind the
 * player's car), then the officer walking up to the driver's window (right-hand drive: the car's
 * right side). Seconds.
 */
export const SHOT_PATROL_S = 3.2;
export const OFFICER_WALK_SPEED = 1.3;
/** The officer's door to the driver's window, roughly (patrol car 7.5 m behind). */
export const WALK_M = 7.2;
export const SHOT_WALK_S = WALK_M / OFFICER_WALK_SPEED + 0.6;
export const FAREWELL_S = 3.5;

export type StopPhase = "patrolShot" | "walk" | "window" | "farewell" | "done";

/** The phase of the arrival `t` seconds after the stop (the window phase lasts until the dialogue ends). */
export function arrivalPhase(t: number): StopPhase {
  if (t < SHOT_PATROL_S) return "patrolShot";
  if (t < SHOT_PATROL_S + SHOT_WALK_S) return "walk";
  return "window";
}

// ---------------------------------------------------------------- the dialogue at the window

export type ChoiceId =
  | "openWindow"
  | "showLicence"
  | "watch"
  | "seen"
  | "agree"
  | "disagree"
  | "understood"
  | "next"
  | "thanks";
export type DialogueStep = {
  id: "knock" | "licence" | "offence" | "confirm" | "objection" | "dispose" | "farewell";
  /** The officer's line (src/i18n), filled by the scene. */
  line: MessageKey;
  choices: ChoiceId[];
};

/**
 * The window conversation for a disposal. The offence step offers the replay of its moment when
 * there is one; a driver who does not agree is told how to contest it (no 反則金 paid → the
 * criminal procedure, where they can argue it: 道路交通法 第130条・第128条第2項).
 */
export function dialogueSteps(d: {
  disposal: Disposal;
  hasClip: boolean;
  /** The licence check shows the suspension (無免許). */
  unlicensed: boolean;
}): DialogueStep[] {
  const steps: DialogueStep[] = [
    { id: "knock", line: "stop.line.knock", choices: ["openWindow"] },
    { id: "licence", line: "stop.line.licence", choices: ["showLicence"] },
    {
      id: "offence",
      line: d.unlicensed ? "stop.line.offenceUnlicensed" : "stop.line.offence",
      choices: d.hasClip ? ["watch", "seen"] : ["seen"],
    },
  ];
  const isArgued = d.disposal === "blue" || d.disposal === "red";
  if (isArgued) steps.push({ id: "confirm", line: "stop.line.confirm", choices: ["agree", "disagree"] });
  steps.push({ id: "dispose", line: DISPOSE_LINE[d.disposal], choices: ["next"] });
  if (d.disposal === "blue") steps.push({ id: "farewell", line: "stop.line.farewell", choices: ["thanks"] });
  return steps;
}

const DISPOSE_LINE: Record<Disposal, MessageKey> = {
  blue: "stop.line.blue",
  red: "stop.line.red",
  voluntary: "stop.line.voluntary",
  arrest: "stop.line.arrest",
};

const OBJECTION: DialogueStep = { id: "objection", line: "stop.line.objection", choices: ["understood"] };

/**
 * Where the conversation goes after a choice: on to the next step; 「納得できません」 first hears
 * how to contest it (the objection step, put in after the current one, once).
 */
export function afterChoice(
  steps: readonly DialogueStep[],
  at: number,
  choice: ChoiceId,
): { steps: DialogueStep[]; at: number } {
  const hasObjection = steps.some((s) => s.id === "objection");
  if (choice === "disagree" && !hasObjection) {
    return { steps: [...steps.slice(0, at + 1), OBJECTION, ...steps.slice(at + 1)], at: at + 1 };
  }
  return { steps: [...steps], at: at + 1 };
}

/** The officer's tone: kind, neutral or stern (fled), for the voice and the panel's colour. */
export type Tone = "kind" | "plain" | "stern";
export function toneOf(fled: boolean, polite: boolean): Tone {
  if (fled) return "stern";
  return polite ? "kind" : "plain";
}
