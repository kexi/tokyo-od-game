import { getLocale, t, type MessageKey, type Params } from "../i18n";
import { inJapanese } from "../i18n/reverse";

/**
 * Emergency call operators (119 fire/ambulance, 110 police) for the in-game smartphone.
 * Gemma voices the operator when available; the game itself decides when enough has been said
 * (a location and what happened) so dispatch never depends on the model's wording.
 */
export type Line = "119" | "110";

/**
 * An operator's line in the language in force (`text`, shown) and in Japanese (`ja`, what the
 * Japanese voice says: the operators are Tokyo's, and sanoTTS-jp speaks Japanese only).
 */
export type Said = { text: string; ja: string };

const said = (key: MessageKey, params?: Params, jaParams: Params | undefined = params): Said => ({
  text: t(key, params),
  ja: inJapanese(key, jaParams),
});

const OPENING_KEY: Record<Line, MessageKey> = { "119": "call.opening.119", "110": "call.opening.110" };
const DISPATCHED_KEY: Record<Line, MessageKey> = {
  "119": "call.dispatched.119",
  "110": "call.dispatched.110",
};
const NON_URGENT_KEY: Record<Line, MessageKey> = { "119": "call.nonUrgent.119", "110": "call.nonUrgent.110" };
const ASK_WHAT_KEY: Record<Line, MessageKey> = { "119": "call.askWhat.119", "110": "call.askWhat.110" };
const ACK_KEY: Record<Line, MessageKey> = { "119": "call.ack.119", "110": "call.ack.110" };

/** 「119番消防です。火事ですか、救急ですか。」 */
export const opening = (line: Line): Said => said(OPENING_KEY[line]);
/** The ambulance or the patrol car is on its way. */
export const dispatched = (line: Line): Said => said(DISPATCHED_KEY[line]);
/** Help was already sent on an earlier call. */
export const alreadyDispatched = (): Said => said("call.already");

/**
 * The operator's system prompt. In English and Chinese the brief stays in Japanese (the model
 * reads it, the place is a Japanese name) and the reply's language goes last, in that language.
 */
export function operatorPrompt(line: Line, location: string): string {
  const isJapanese = getLocale() === "ja";
  const role = line === "119" ? "東京消防庁で119番通報を受ける指令員" : "警視庁で110番通報を受ける担当者";
  const goal =
    line === "119"
      ? "場所（住所や目印）、何が起きたか、けが人の様子（意識・呼吸・出血）を一つずつ短く質問し、通報者を落ち着かせてください。"
      : "場所、何が起きたか、けが人の有無と救急車を呼んだかどうかを一つずつ短く質問してください。";
  const answer = isJapanese
    ? `あなたはゲームの中で${role}です。通報者の発言に、日本語で1〜2文、50文字以内で答えてください。`
    : `あなたはゲームの中で${role}です。通報者の発言に短く答えてください。`;
  const lines = [
    answer,
    goal,
    `参考: 通報者の携帯電話の位置情報は「東京都${location}付近」を示しています。`,
    "出動の判断はシステムが行うので、あなたから「向かいます」とは言わないでください。人を責める言い方、政治・宗教の話、刺激の強い表現はしないでください。",
  ];
  if (!isJapanese) lines.push(t("call.replyLanguage"));
  return lines.join("\n");
}

// What the caller says, in Japanese, English or Chinese (the quick replies are in the language in
// force, and people type in theirs).
const PLACE =
  /(区|町|丁目|番地|駅|交差点|通り|付近|近く|ここ|現在地|前|\bnear\b|\bstreet\b|\bavenue\b|\bstation\b|intersection|crossing|junction|address|\bward\b|chome|in front of|outside|corner|\bhere\b|附近|路口|车站|地址|这里|前面|门口)/i;
const SITUATION =
  /(事故|はね|撥ね|轢|ひい|ひか|ぶつか|衝突|接触|けが|怪我|倒れ|意識|血|救急|人身|動けな|accident|\bhit\b|crash|collid|knocked|injur|hurt|bleed|blood|unconscious|collaps|ambulance|can'?t move|cannot move|run over|ran over|撞|碰|受伤|伤者|流血|昏迷|晕倒|倒在|动不了|救护车|急救)/i;

/** True once the caller has given both a place and what happened. */
export function hasEnoughInfo(callerText: string): boolean {
  return PLACE.test(callerText) && SITUATION.test(callerText);
}

/** Scripted operator used without Gemma: asks for whatever is still missing. */
export function scriptedOperator(line: Line, callerText: string, hasIncident: boolean): Said {
  const nonUrgent = said(NON_URGENT_KEY[line]);
  if (!hasIncident && !SITUATION.test(callerText)) return nonUrgent;
  if (!hasIncident && hasEnoughInfo(callerText)) {
    return said("call.noIncident", { nonUrgent: nonUrgent.text }, { nonUrgent: nonUrgent.ja });
  }
  if (!PLACE.test(callerText)) return said("call.askPlace");
  if (!SITUATION.test(callerText)) return said(ASK_WHAT_KEY[line]);
  return said(ACK_KEY[line]);
}

/** A quick reply: `location` stands for the caller's place, said with it (call.location). */
export type QuickReply = { key: MessageKey; location?: true };

export const QUICK_REPLIES: Record<Line, readonly QuickReply[]> = {
  "119": [
    { key: "call.quick.ambulance" },
    { key: "call.quick.location", location: true },
    { key: "call.quick.hitPedestrian" },
    { key: "call.quick.cannotMove" },
  ],
  "110": [
    { key: "call.quick.accident" },
    { key: "call.quick.location", location: true },
    { key: "call.quick.injury" },
    { key: "call.quick.calledAmbulance" },
  ],
};
