import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietSpeech } from "../scripts/qa/browser.mjs";

/** An utterance as the page sees one: an EventTarget with text, lang and rate. */
class FakeUtterance extends EventTarget {
  rate = 1;
  lang = "ja-JP";
  constructor(public text: string) {
    super();
  }
}

/** The error event as Chrome builds it: the kind of error rides on the event. */
class FakeErrorEvent extends Event {
  error: string;
  constructor(type: string, init: { error: string }) {
    super(type);
    this.error = init.error;
  }
}

/** The page's speechSynthesis before the QA shim: its own speak() would reach the OS synthesiser. */
function installSynth() {
  const native = { speak: vi.fn(), cancel: vi.fn() };
  const synth = { ...native, speaking: false, pending: false };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisErrorEvent", FakeErrorEvent);
  quietSpeech();
  return { synth: synth as unknown as SpeechSynthesis, native };
}

const asUtterance = (u: FakeUtterance) => u as unknown as SpeechSynthesisUtterance;

/** The events `u` receives, an error as `error:<kind>`. */
function eventsOf(u: FakeUtterance): string[] {
  const seen: string[] = [];
  for (const type of ["start", "end"]) u.addEventListener(type, () => seen.push(type));
  u.addEventListener("error", (e) => seen.push(`error:${(e as FakeErrorEvent).error}`));
  return seen;
}

describe("QA pages' speechSynthesis (scripts/qa/browser.mjs quietSpeech)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never calls the native speak, yet fires start then end so callers waiting on end go on", () => {
    const { synth, native } = installSynth();
    const u = new FakeUtterance("次の交差点を右です");
    const seen = eventsOf(u);
    synth.speak(asUtterance(u));
    expect(synth.speaking).toBe(true);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(seen).toEqual(["start"]);
    vi.runAllTimers();
    expect(seen).toEqual(["start", "end"]);
    expect(synth.speaking).toBe(false);
    expect(native.speak).not.toHaveBeenCalled();
  });

  it("takes about as long as the macOS voices: ~240 ms a character in Japanese, ~75 in English", () => {
    const { synth } = installSynth();
    const ja = new FakeUtterance("およそ300メートル先、芝公園出口です。斜め左方向です。");
    ja.rate = 1.05;
    const en = new FakeUtterance("In about 300 metres, the Shibakoen exit.");
    en.lang = "en-US";
    en.rate = 1.05;
    for (const [u, measuredMs] of [
      [ja, 6800],
      [en, 3200],
    ] as const) {
      const seen = eventsOf(u);
      synth.speak(asUtterance(u));
      vi.advanceTimersByTime(0);
      vi.advanceTimersByTime(measuredMs * 0.85);
      expect(seen).toEqual(["start"]);
      vi.advanceTimersByTime(measuredMs * 0.3);
      expect(seen).toEqual(["start", "end"]);
    }
  });

  it("reads queued lines one after another, with pending while one waits", () => {
    const { synth } = installSynth();
    const a = new FakeUtterance("一");
    const b = new FakeUtterance("二");
    const seenA = eventsOf(a);
    const seenB = eventsOf(b);
    synth.speak(asUtterance(a));
    synth.speak(asUtterance(b));
    expect(synth.pending).toBe(true);
    vi.advanceTimersByTime(0);
    expect(seenA).toEqual(["start"]);
    expect(seenB).toEqual([]);
    vi.runAllTimers();
    expect(seenA).toEqual(["start", "end"]);
    expect(seenB).toEqual(["start", "end"]);
    expect(synth.pending).toBe(false);
  });

  it("inside an end handler, speaking is false with nothing behind and a speak() there starts once", () => {
    const { synth } = installSynth();
    const a = new FakeUtterance("一");
    const b = new FakeUtterance("二");
    const seenB = eventsOf(b);
    const speakingInEnd: boolean[] = [];
    a.addEventListener("end", () => {
      speakingInEnd.push(synth.speaking);
      synth.speak(asUtterance(b));
    });
    synth.speak(asUtterance(a));
    vi.runAllTimers();
    expect(speakingInEnd).toEqual([false]);
    expect(seenB).toEqual(["start", "end"]);
  });

  it("inside an end handler, the next queued line is already the one being read", () => {
    const { synth } = installSynth();
    const a = new FakeUtterance("一");
    const b = new FakeUtterance("二");
    const seenB = eventsOf(b);
    const inEnd: Array<{ speaking: boolean; pending: boolean }> = [];
    a.addEventListener("end", () => inEnd.push({ speaking: synth.speaking, pending: synth.pending }));
    synth.speak(asUtterance(a));
    synth.speak(asUtterance(b));
    vi.runAllTimers();
    expect(inEnd).toEqual([{ speaking: true, pending: false }]);
    expect(seenB).toEqual(["start", "end"]);
  });

  it("cancel() interrupts the line being read and drops the ones behind it without an event", () => {
    const { synth } = installSynth();
    const a = new FakeUtterance("一");
    const b = new FakeUtterance("二");
    const c = new FakeUtterance("三");
    const seenA = eventsOf(a);
    const seenB = eventsOf(b);
    const seenC = eventsOf(c);
    synth.speak(asUtterance(a));
    synth.speak(asUtterance(b));
    synth.speak(asUtterance(c));
    vi.advanceTimersByTime(0);
    synth.cancel();
    expect(synth.speaking).toBe(false);
    expect(synth.pending).toBe(false);
    vi.runAllTimers();
    expect(seenA).toEqual(["start", "error:interrupted"]);
    expect(seenB).toEqual([]);
    expect(seenC).toEqual([]);
  });
});
