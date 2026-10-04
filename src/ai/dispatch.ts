/**
 * Emergency call operators (119 fire/ambulance, 110 police) for the in-game smartphone.
 * Gemma voices the operator when available; the game itself decides when enough has been said
 * (a location and what happened) so dispatch never depends on the model's wording.
 */
export type Line = "119" | "110";

export const OPENING: Record<Line, string> = {
  "119": "119番消防です。火事ですか、救急ですか。",
  "110": "110番警察です。事件ですか、事故ですか。",
};

export const DISPATCHED: Record<Line, string> = {
  "119": "救急車が向かいます。けが人のそばにいて、動かさずに待っていてください。",
  "110": "パトカーが向かいます。安全な場所で、現場にとどまってください。",
};

const NON_URGENT: Record<Line, string> = {
  "119": "緊急でなければ、救急相談センターの「#7119」もご利用ください。",
  "110": "急ぎでない相談は、警察相談専用電話の「#9110」をご利用ください。",
};

export function operatorPrompt(line: Line, location: string): string {
  const role = line === "119" ? "東京消防庁で119番通報を受ける指令員" : "警視庁で110番通報を受ける担当者";
  const goal =
    line === "119"
      ? "場所（住所や目印）、何が起きたか、けが人の様子（意識・呼吸・出血）を一つずつ短く質問し、通報者を落ち着かせてください。"
      : "場所、何が起きたか、けが人の有無と救急車を呼んだかどうかを一つずつ短く質問してください。";
  return [
    `あなたはゲームの中で${role}です。通報者の発言に、日本語で1〜2文、50文字以内で答えてください。`,
    goal,
    `参考: 通報者の携帯電話の位置情報は「東京都${location}付近」を示しています。`,
    "出動の判断はシステムが行うので、あなたから「向かいます」とは言わないでください。人を責める言い方、政治・宗教の話、刺激の強い表現はしないでください。",
  ].join("\n");
}

const PLACE = /(区|町|丁目|番地|駅|交差点|通り|付近|近く|ここ|現在地|前)/;
const SITUATION = /(事故|はね|撥ね|轢|ひい|ひか|ぶつか|衝突|接触|けが|怪我|倒れ|意識|血|救急|人身|動けな)/;

/** True once the caller has given both a place and what happened. */
export function hasEnoughInfo(callerText: string): boolean {
  return PLACE.test(callerText) && SITUATION.test(callerText);
}

/** Scripted operator used without Gemma: asks for whatever is still missing. */
export function scriptedOperator(line: Line, callerText: string, hasIncident: boolean): string {
  if (!hasIncident && !SITUATION.test(callerText)) return NON_URGENT[line];
  if (!hasIncident && hasEnoughInfo(callerText)) {
    return `その付近で事故の情報は確認できません。${NON_URGENT[line]}`;
  }
  if (!PLACE.test(callerText)) return "場所はどこですか。住所か、近くの目印を教えてください。";
  if (!SITUATION.test(callerText)) {
    return line === "119"
      ? "何がありましたか。けが人の様子を教えてください。"
      : "何がありましたか。けが人はいますか。";
  }
  return line === "119" ? "わかりました。けが人に意識はありますか。" : "わかりました。救急車は呼びましたか。";
}

export const QUICK_REPLIES: Record<Line, string[]> = {
  "119": ["救急です", "現在地を伝える", "車で歩行者をはねてしまいました", "倒れていて動けません"],
  "110": ["事故です", "現在地を伝える", "歩行者との人身事故です", "救急車はもう呼びました"],
};
