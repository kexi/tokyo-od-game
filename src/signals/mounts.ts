import { z } from "zod";

/**
 * How a signal head is held up (取付). The game uses `arm` (車両用, hung over the lane) and
 * `pole` (歩行者用, on its pole beside the crosswalk); 歩道橋添架 and 標識との共架 are declared so
 * later phases can add them without a new shape.
 *
 * The heights and the drawing scale are the game's values since 2026-10-04, not a standard's:
 * `verified: false` until the 道路交通法施行規則 (信号機の構造) is read from e-Gov.
 */
export const SignalMountSchema = z.strictObject({
  kind: z.enum(["arm", "pole", "footbridge", "signal-share"]),
  /** Height of the main housing's centre above the ground under it. */
  centreHeightM: z.number().positive(),
  /** How far the head stands out from its pole (pole mounts). */
  offsetM: z.number().nonnegative(),
  /** The game draws heads this much larger than life so they read at driving distance. */
  drawScale: z.number().positive(),
  verified: z.boolean(),
});
export type SignalMount = z.output<typeof SignalMountSchema>;

/** 車両用灯器 on its arm: 5.2 m to the housing's centre, drawn 1.3 times life size. */
export const ARM_MOUNT = SignalMountSchema.parse({
  kind: "arm",
  centreHeightM: 5.2,
  offsetM: 0,
  drawScale: 1.3,
  verified: false,
});

/** 歩行者用灯器 on its pole: 2.75 m above the pavement, 0.3 m out from the pole. */
export const PED_POLE_MOUNT = SignalMountSchema.parse({
  kind: "pole",
  centreHeightM: 2.75,
  offsetM: 0.3,
  drawScale: 1,
  verified: false,
});

/** The mounts by the name a head's `mount` gives (src/signals/heads.ts). */
export const SIGNAL_MOUNTS: Record<"arm" | "pole", SignalMount> = { arm: ARM_MOUNT, pole: PED_POLE_MOUNT };
