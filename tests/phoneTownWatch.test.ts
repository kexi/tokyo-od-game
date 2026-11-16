import { describe, expect, it } from "vitest";
import { defaultGraphics } from "../src/graphics";
import { detectQuality, PHONE_TOWN_DEFAULT, phoneKindOf, readPhoneTownParam, VIEW } from "../src/device";
import {
  openWatch,
  parseWatch,
  readWatch,
  runAfter,
  WATCH_KEY,
  writeWatch,
  type PageEvent,
  type PhoneTown,
  type WatchRecord,
} from "../src/phoneTownWatch";

const MIB = 1024 ** 2;

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

/**
 * One page from open to its last event, as device.ts and armWatch run it on a stored record:
 * the town it streamed, and the record it left behind.
 */
function runPage(
  storage: ReturnType<typeof fakeStorage>,
  events: PageEvent[],
  byDefault: PhoneTown = "full",
  param: PhoneTown | null = null,
) {
  const opened = openWatch(readWatch(storage), param, byDefault, true);
  if (opened.next) writeWatch(storage, opened.next);
  const isWatched = opened.next?.run != null;
  for (const event of isWatched ? events : []) {
    const isVisible = event === "visible" || event === "pageshow";
    writeWatch(storage, { run: runAfter(event, isVisible), demoted: opened.next?.demoted ?? false });
  }
  return opened;
}

describe("a phone's town by kind", () => {
  const views = ["near", "medium", "far"] as const;

  it("tells Android, iPhone and iPad (iPadOS says Macintosh, with touch) and other devices apart", () => {
    expect(phoneKindOf("Mozilla/5.0 (Linux; Android 16; Pixel 11 Pro) Chrome/142.0 Mobile", 5)).toBe(
      "android",
    );
    expect(phoneKindOf("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Safari/604.1", 5)).toBe("ios");
    expect(phoneKindOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 5)).toBe("ios");
    expect(phoneKindOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0)).toBe("other");
    expect(phoneKindOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0", 10)).toBe("other");
  });

  /**
   * The defaults as decided (U12): a kind tried on the published build streams `full`, the others
   * the light town until they are tried; a touch device of another kind was never tried.
   */
  it("gives each kind its decided default, and nothing but the light town to a kind never tried", () => {
    expect(PHONE_TOWN_DEFAULT).toEqual({ android: "low", ios: "low", other: "low" });
  });

  it("streams 256 MiB out to 1.6 km on `full` and 24 MiB out to the 描画距離 on `low`, and leaves a PC as it was", () => {
    const phone = defaultGraphics(true);
    for (const viewDistance of views) {
      const full = detectQuality({ ...phone, viewDistance }, true, "full");
      expect(full.buildingCacheBytes).toBe(256 * MIB);
      expect(full.buildingLoadRadius).toBe(VIEW.near.buildingLoadRadius);
      const low = detectQuality({ ...phone, viewDistance }, true, "low");
      expect(low.buildingCacheBytes).toBe(24 * MIB);
      expect(low.buildingLoadRadius).toBe(VIEW[viewDistance].buildingLoadRadius);
    }
    const pc = defaultGraphics(false);
    for (const viewDistance of views) {
      for (const town of ["full", "low", null] as const) {
        const q = detectQuality({ ...pc, viewDistance }, false, town);
        expect(q.buildingCacheBytes).toBe(VIEW[viewDistance].buildingCacheBytes);
        expect(q.buildingLoadRadius).toBe(VIEW[viewDistance].buildingLoadRadius);
      }
    }
  });

  it("reads ?phoneTown=full and ?phoneTown=low, and treats any other value as absent", () => {
    expect(readPhoneTownParam("?phoneTown=full&start=35.6896,139.7006")).toBe("full");
    expect(readPhoneTownParam("?phoneTown=low")).toBe("low");
    expect(readPhoneTownParam("?phoneTown=half")).toBeNull();
    expect(readPhoneTownParam("")).toBeNull();
  });

  it("lets the URL win over the default either way", () => {
    expect(openWatch(parseWatch(null), "low", "full", true).town).toBe("low");
    expect(openWatch(parseWatch(null), "full", "low", true).town).toBe("full");
    expect(openWatch(parseWatch(null), null, "full", true).town).toBe("full");
    expect(openWatch(parseWatch(null), null, "low", true).town).toBe("low");
  });
});

describe("the watch over a phone on the full town", () => {
  it("sends a phone back to the light town after a page that ended on screen, and says so once", () => {
    const storage = fakeStorage();
    expect(runPage(storage, []).town).toBe("full");
    const next = runPage(storage, []);
    expect(next).toMatchObject({ town: "low", reason: "demoted", crashed: true, justDemoted: true });
  });

  it("does not count a page hidden before it ended, closed, reloaded or put in and out of the cache", () => {
    const endings: PageEvent[][] = [
      ["hidden"], // the OS cleared a page in the background (an app switch, another tab)
      ["hidden", "pagehide"], // the tab closed
      ["pagehide"], // a reload or a link away
      ["hidden", "visible", "pagehide"], // a tab switch and back, then a reload
      ["pagehide", "pageshow", "hidden"], // back/forward cache, then cleared in the background
    ];
    for (const ending of endings) {
      const storage = fakeStorage();
      runPage(storage, ending);
      expect(runPage(storage, []).town, ending.join(",")).toBe("full");
    }
  });

  it("counts a page that came back on screen (a tab switch, the cache) and then ended without a word", () => {
    for (const ending of [
      ["hidden", "visible"],
      ["pagehide", "pageshow"],
    ] as PageEvent[][]) {
      const storage = fakeStorage();
      runPage(storage, ending);
      expect(runPage(storage, []).town, ending.join(",")).toBe("low");
    }
  });

  it("keeps a phone sent back on the light town on every later open, quietly, until ?phoneTown=full", () => {
    const storage = fakeStorage();
    runPage(storage, []);
    runPage(storage, ["pagehide"]);
    for (let i = 0; i < 3; i++) {
      expect(runPage(storage, ["pagehide"])).toMatchObject({
        town: "low",
        reason: "demoted",
        justDemoted: false,
      });
    }
    expect(runPage(storage, ["pagehide"], "full", "full")).toMatchObject({ town: "full", reason: "param" });
    expect(runPage(storage, ["pagehide"])).toMatchObject({ town: "full", reason: "default" });
  });

  it("forgets a crash under ?phoneTown=full when that page is opened again with it", () => {
    const storage = fakeStorage();
    runPage(storage, [], "full", "full");
    expect(runPage(storage, ["pagehide"], "full", "full").town).toBe("full");
    expect(runPage(storage, []).town).toBe("full");
  });

  it("does not watch the light town: nothing to go back from, and nothing left to count later", () => {
    const storage = fakeStorage();
    expect(runPage(storage, [], "low").next).toEqual({ run: null, demoted: false });
    expect(runPage(storage, [], "full").town).toBe("full");
  });

  it("streams the light town when storage is blocked, as nothing could be remembered", () => {
    const blocked = fakeStorage(true);
    expect(readWatch(blocked)).toBeNull();
    expect(writeWatch(blocked, { run: "front", demoted: false })).toBe(false);
    expect(openWatch(null, null, "full", true)).toMatchObject({
      town: "low",
      reason: "no_storage",
      next: null,
    });
    expect(openWatch(null, "full", "full", true)).toMatchObject({ town: "full", reason: "param" });
  });

  it("starts again from a record that is not one", () => {
    const fresh: WatchRecord = { run: null, demoted: false };
    expect(parseWatch("{")).toEqual(fresh);
    expect(parseWatch('{"run":"crashed","demoted":false}')).toEqual(fresh);
    const storage = fakeStorage();
    storage.setItem(WATCH_KEY, "nonsense");
    expect(runPage(storage, []).town).toBe("full");
  });
});
