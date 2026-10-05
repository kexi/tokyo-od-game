/**
 * The title screen's choices, remembered in this browser so the next visit starts the same way:
 * the start place (the value its picker sends), whether the pedestrians speak (sanoTTS) — the
 * talking AI's own consent flag lives with the model (ai/llm.ts). Storage blocked (a private
 * window): nothing is remembered and the defaults apply, never an error.
 */
const START_KEY = "tod.start";
const VOICE_KEY = "tod.voice";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered when storage is blocked; the choice still holds for this visit.
  }
};

/** The start picker's value chosen last ("" = the default place), or null when none was. */
export const savedStart = (): string | null => read(START_KEY);
export const saveStart = (value: string): void => write(START_KEY, value);

/** Pedestrians' voices: on unless turned off here before. */
export const savedVoice = (): boolean => read(VOICE_KEY) !== "off";
export const saveVoice = (on: boolean): void => write(VOICE_KEY, on ? "on" : "off");
