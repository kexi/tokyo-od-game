import { describe, expect, it } from "vitest";
import { accountFor, AVATAR_MIX, avatarFor, cameraFor } from "../src/game/socialAccounts";
import { frameSize, verticalFov, viewpointFor } from "../src/game/witnessShot";

const NOW = Date.UTC(2026, 9, 5, 3);
const ids = Array.from({ length: 6000 }, (_, i) => `u${i}`);

describe("つぶやき accounts: who they are and how they look", () => {
  it("gives an account the same picture every time", () => {
    for (const id of ["u1", "u42", "p17", "u3999"]) expect(avatarFor(id)).toEqual(avatarFor(id));
    expect(accountFor(123, NOW)).toEqual(accountFor(123, NOW));
  });

  it("mixes pictures like real users: photos, things they like, initials, the default", () => {
    const share = (kind: string) => ids.filter((id) => avatarFor(id).kind === kind).length / ids.length;
    expect(share("portrait")).toBeCloseTo(AVATAR_MIX.portrait, 1);
    expect(share("illustration")).toBeCloseTo(AVATAR_MIX.illustration, 1);
    expect(share("initial")).toBeCloseTo(AVATAR_MIX.initial, 1);
    expect(share("default")).toBeCloseTo(AVATAR_MIX.default, 1);
  });

  it("leaves only new (throwaway) accounts with the default picture, no banner and few followers", () => {
    for (let seed = 0; seed < 600; seed++) {
      const a = accountFor(seed, NOW);
      expect(a.isNew).toBe(a.avatar.kind === "default");
      if (!a.isNew) continue;
      expect(a.banner.kind).toBe("none");
      expect(a.followers).toBeLessThan(10);
      expect(a.joined).toEqual({ year: 2026, month: 10 });
    }
  });

  it("gives handles the app allows (letters, digits, _; 15 at most) and a name", () => {
    for (let seed = 0; seed < 600; seed++) {
      const a = accountFor(seed, NOW);
      expect(a.handle).toMatch(/^[A-Za-z0-9_]{1,15}$/);
      expect(a.name.length).toBeGreaterThan(0);
    }
  });
});

describe("each poster's own camera", () => {
  const accounts = Array.from({ length: 800 }, (_, i) => accountFor(i, NOW));

  it("is fixed per account: lens, aspect, tilt, exposure", () => {
    for (const a of accounts.slice(0, 50)) expect(cameraFor(a)).toEqual(cameraFor(a));
  });

  it("is a dashcam only for people who drive, and mostly so for them", () => {
    const drivers = accounts.filter((a) => a.drives);
    const dashcams = accounts.filter((a) => cameraFor(a).kind === "dashcam");
    expect(dashcams.every((a) => a.drives)).toBe(true);
    expect(dashcams.length / drivers.length).toBeGreaterThan(0.6);
  });

  it("uses phone lenses from ultra-wide to tele, and all three frame shapes", () => {
    const phones = accounts.map(cameraFor).filter((c) => c.kind === "phone");
    expect(new Set(phones.map((c) => (c.focal >= 48 ? "tele" : c.focal <= 13 ? "wide" : "main")))).toEqual(
      new Set(["wide", "main", "tele"]),
    );
    expect(new Set(phones.map((c) => c.aspect))).toEqual(new Set(["16:9", "4:3", "9:16"]));
  });

  it("frames a 24 mm video like a phone's main camera, wider for 13 mm, narrower zoomed in", () => {
    expect(verticalFov(24, "16:9")).toBeCloseTo(44.2, 0);
    expect(verticalFov(24, "4:3")).toBeCloseTo(56.8, 0);
    expect(verticalFov(13, "16:9")).toBeGreaterThan(verticalFov(24, "16:9"));
    expect(verticalFov(77, "16:9")).toBeLessThan(verticalFov(48, "16:9"));
    // A story is the same lens turned upright: taller than it is wide.
    expect(verticalFov(24, "9:16")).toBeGreaterThan(verticalFov(24, "16:9"));
    expect(frameSize("9:16")).toEqual({ w: 360, h: 640 });
    expect(frameSize("16:9")).toEqual({ w: 640, h: 360 });
  });

  it("stands each poster somewhere of their own, and a dashcam on the road", () => {
    const spots = new Set(accounts.slice(0, 200).map((a, i) => viewpointFor(a, i, true)));
    expect(spots.size).toBeGreaterThan(5);
    for (const [i, a] of accounts.entries()) {
      const spot = viewpointFor(a, i, false);
      expect(spot).not.toBe("witness");
      const isDashcam = cameraFor(a).kind === "dashcam";
      expect(spot === "behind" || spot === "oncoming").toBe(isDashcam);
    }
    expect(viewpointFor(accounts[3], 7, true)).toBe(viewpointFor(accounts[3], 7, true));
  });
});
