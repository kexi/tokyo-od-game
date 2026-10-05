import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedStart, saveStart, savedVoice, saveVoice } from "../src/game/titlePrefs";

const store = new Map<string, string>();
const fake = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe("the title screen's choices are remembered", () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", fake);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the start place chosen last, the default place included", () => {
    expect(savedStart()).toBeNull();
    saveStart("35.710063,139.8107");
    expect(savedStart()).toBe("35.710063,139.8107");
    saveStart("");
    expect(savedStart()).toBe("");
  });

  it("has the pedestrians' voices on until they are turned off, and remembers either", () => {
    expect(savedVoice()).toBe(true);
    saveVoice(false);
    expect(savedVoice()).toBe(false);
    saveVoice(true);
    expect(savedVoice()).toBe(true);
  });

  it("falls back to the defaults when storage is blocked, without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveStart("here")).not.toThrow();
    expect(savedStart()).toBeNull();
    expect(savedVoice()).toBe(true);
  });
});
