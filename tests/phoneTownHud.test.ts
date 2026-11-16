import { describe, expect, it } from "vitest";
import { countLoad, loadCountKey, phoneTownLines } from "../src/debug/phoneTownHud";

/** A Storage that keeps strings in a map, or throws as a blocked one does. */
function fakeStorage(isBlocked = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => {
      if (isBlocked) throw new Error("blocked");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (isBlocked) throw new Error("blocked");
      map.set(k, v);
    },
  };
}

describe("the phoneTown trial readout", () => {
  it("counts each page load of a town under its own key, so a tab the browser reopened shows as a reload", () => {
    const storage = fakeStorage();
    const key = loadCountKey("full");
    expect(countLoad(storage, key)).toBe(1);
    expect(countLoad(storage, key)).toBe(2);
    expect(storage.map.get(key)).toBe("2");
  });

  it("starts again from a stored value that is not a count, and has no count when storage is blocked", () => {
    const storage = fakeStorage();
    storage.setItem(loadCountKey("full"), "abc");
    expect(countLoad(storage, loadCountKey("full"))).toBe(1);
    expect(countLoad(fakeStorage(true), loadCountKey("full"))).toBeNull();
  });

  /** A trial in a private tab must not read as a run with no reloads (PR #91's review, Minor). */
  it("writes `reloads ?` when nothing could be counted", () => {
    const lines = phoneTownLines({
      town: "full",
      elapsedMs: 0,
      loads: null,
      visible: 0,
      heldBytes: 0,
      limitBytes: 256 * 1024 ** 2,
      fullFrames: 0,
    });
    expect(lines[1]).toBe("reloads ?");
  });

  it("writes the time as m:ss, the reloads after the first load, and the near town held of its limit", () => {
    const lines = phoneTownLines({
      town: "full",
      elapsedMs: 605_400,
      loads: 3,
      visible: 33,
      heldBytes: 64 * 1024 ** 2,
      limitBytes: 256 * 1024 ** 2,
      fullFrames: 0,
    });
    expect(lines).toEqual(["phoneTown=full 10:05", "reloads 2", "tiles 33 · 64/256 MB · full 0"]);
  });
});
