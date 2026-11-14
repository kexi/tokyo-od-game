import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quietSpeech } from "../scripts/qa/browser.mjs";

/** An utterance as the page sees one: an EventTarget with text and rate, and `on*` handlers. */
class FakeUtterance extends EventTarget {
  rate = 1;
  constructor(public text: string) {
    super();
  }
}

/** The page's speechSynthesis before the QA shim: its own speak() would reach the OS synthesiser. */
function installSynth() {
  const native = { speak: vi.fn(), cancel: vi.fn() };
  const synth = { ...native, speaking: false, pending: false };
  vi.stubGlobal("speechSynthesis", synth);
  quietSpeech();
  return { synth: synth as unknown as SpeechSynthesis, native };
}

function eventsOf(u: FakeUtterance): string[] {
  const seen: string[] = [];
  for (const type of ["start", "end", "error"]) u.addEventListener(type, () => seen.push(type));
  return seen;
}

describe("QA pages' speechSynthesis (scripts/qa/browser.mjs quietSpeech)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("never calls the native speak, yet fires start then end so callers waiting on end go on", () => {
    const { native } = installSynth();
    const u = new FakeUtterance("次の交差点を右です");
    const seen = eventsOf(u);
    speechSynthesis.speak(u as unknown as SpeechSynthesisUtterance);
    expect(speechSynthesis.speaking).toBe(true);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(seen).toEqual(["start"]);
    vi.runAllTimers();
    expect(seen).toEqual(["start", "end"]);
    expect(speechSynthesis.speaking).toBe(false);
    expect(native.speak).not.toHaveBeenCalled();
  });

  it("reads queued lines one after another, with pending while one waits", () => {
    const { synth } = installSynth();
    const a = new FakeUtterance("一");
    const b = new FakeUtterance("二");
    const seenA = eventsOf(a);
    const seenB = eventsOf(b);
    synth.speak(a as unknown as SpeechSynthesisUtterance);
    synth.speak(b as unknown as SpeechSynthesisUtterance);
    expect(synth.pending).toBe(true);
    vi.advanceTimersByTime(0);
    expect(seenA).toEqual(["start"]);
    expect(seenB).toEqual([]);
    vi.runAllTimers();
    expect(seenA).toEqual(["start", "end"]);
    expect(seenB).toEqual(["start", "end"]);
    expect(synth.pending).toBe(false);
  });

  it("cancel() stops the line and the queue with Chrome's errors, and never ends them", () => {
    const { synth, native } = installSynth();
    const a = new FakeUtterance("一");
    const b = new FakeUtterance("二");
    const seenA = eventsOf(a);
    const seenB = eventsOf(b);
    synth.speak(a as unknown as SpeechSynthesisUtterance);
    synth.speak(b as unknown as SpeechSynthesisUtterance);
    vi.advanceTimersByTime(0);
    synth.cancel();
    expect(synth.speaking).toBe(false);
    vi.runAllTimers();
    expect(seenA).toEqual(["start", "error"]);
    expect(seenB).toEqual(["error"]);
    expect(native.cancel).toHaveBeenCalled();
  });
});
