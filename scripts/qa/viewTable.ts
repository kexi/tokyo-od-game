import { z } from "zod";

/**
 * The view tables of the multi-view review (scripts/qa/views/<name>.json, knowledge/review-loop.md):
 * which page loads to make (a session: one start and its URL parameters, shot once per look — 昼・
 * 夜・雨 …) and, in each, which views to shoot. scripts/qa/views.ts reads a table through this
 * schema, so a mistyped key fails before Chrome starts (strict objects).
 *
 * Coordinates are [lat, lon]. Bearings are compass degrees (0 = north, 90 = east) from the target
 * to the eye; `angleDeg` turns the eye round a target that faces somewhere (a sign plate, a signal
 * head, a deck), 0 being square in front of it and positive clockwise seen from above.
 *
 * A shot is named `<session>--<view>`, or `<session>.<look>--<view>` when the session has looks
 * (shotKeys): the reviewers' findings name the shot they were seen in by that key.
 */

const latLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const kebab = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "ids are kebab-case (they name the files)")
  .max(60);

/** "ground": metres above the DEM there; "tp": T.P. (orthometric); "ellipsoid": WGS84. */
export const HeightRefSchema = z.enum(["ground", "tp", "ellipsoid"]);

export const GeoPointSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  h: z.number().default(0),
  ref: HeightRefSchema.default("ground"),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

/**
 * What a view looks at. Each picks the nearest match to `near` (the session's start if not given).
 * One kind per target: an object with two kinds' keys (or a misspelt key) matches none of these.
 */
export const TargetSchema = z.union([
  z.strictObject({
    landmark: z.string().min(1),
    /** 0 (foot) – 1 (top) of the drawn model: where the camera aims. */
    heightShare: z.number().min(0).max(1).default(0.5),
  }),
  z.strictObject({
    /** 別表第一 number as the game draws it (323, 326-A, 311-A, x-hydrant …); "*": any. */
    sign: z.string().min(1),
    /** true: only plates with a 補助標識 under them; a string: a 補助標識 containing it. */
    note: z.union([z.boolean(), z.string().min(1)]).optional(),
    near: latLon.optional(),
    /** Which match, nearest first. */
    index: z.number().int().nonnegative().default(0),
  }),
  z.strictObject({
    signal: z.strictObject({
      near: latLon.optional(),
      /** true: only heads with a right-arrow section. */
      arrow: z.boolean().optional(),
      index: z.number().int().nonnegative().default(0),
    }),
  }),
  z.strictObject({
    /** A chunk id of public/data/expressway (`<run>:<k>`). */
    expressway: z.string().min(1),
    /** Where on the chunk, 0 (first station) – 1 (last). */
    share: z.number().min(0).max(1).default(0.5),
  }),
  z.strictObject({ point: GeoPointSchema }),
]);
export type TargetSpec = z.infer<typeof TargetSchema>;

/** What the frame holds still: the signal's 現示 by its step index in the plan, or by what it shows. */
export const StateSchema = z.strictObject({
  signalStep: z
    .union([z.number().int().nonnegative(), z.enum(["green", "yellow", "red", "arrow"])])
    .optional(),
  /**
   * The time of day the signals read ("HH:MM", T4: the night plans — 夜間点滅, 夜間の押ボタン), held
   * apart from the look's sky; without it, the game's clock.
   */
  signalClock: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  /**
   * With signalClock: run the signals' clock only until the target's controller changes plan (the
   * moment of a change: into the night flash, or its way out), then hold the step there.
   */
  signalClockToChange: z.boolean().optional(),
});
export type ViewState = z.infer<typeof StateSchema>;

/** Things moved out of the frame while it is shot (the moving traffic, the people on foot). */
export const HideSchema = z.array(z.enum(["traffic", "pedestrians"]));

/** A place and heading to stand at when a view has no target. */
const StandSchema = z.strictObject({
  lat: z.number(),
  lon: z.number(),
  headingDeg: z.number(),
  /** m ahead along the heading the eye looks at. */
  lookAheadM: z.number().positive().default(40),
});

/**
 * A pixel probe: a rectangle of the frame (fractions of the width and height, x right and y down)
 * whose luminance the runner measures in the saved image (pixelProbes.ts): e.g. the road ahead of a
 * driver's eye. Measured, not judged: the table's metrics turn the numbers into limits.
 */
export const ProbeSchema = z.strictObject({
  name: kebab,
  rect: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ])
    .refine(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0, {
      message: "rect is [x0, y0, x1, y1] with x1 > x0, y1 > y0",
    }),
});
export type Probe = z.infer<typeof ProbeSchema>;

const common = {
  id: kebab,
  probes: z.array(ProbeSchema).optional(),
  /** Degrees (vertical field of view). Not given: the table's default. */
  fov: z.number().min(5).max(120).optional(),
  /** What the reviewer should see in this frame (copied into the frame's JSON as `expect`). */
  expect: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
  state: StateSchema.optional(),
  hide: HideSchema.optional(),
};

/** Eye placements in front of a target (or standing at `at` with a heading). */
const facing = {
  target: TargetSchema.optional(),
  at: StandSchema.optional(),
  /** m from the target along the ground (on a deck: along the deck). */
  distanceM: z.number().positive().optional(),
  angleDeg: z.number().min(-180).max(180).default(0),
  /** Absolute compass bearing from the target to the eye (overrides the target's facing). */
  bearingDeg: z.number().optional(),
  /** m to the eye's right (+) or left (−) as it faces the target. */
  lateralM: z.number().default(0),
};

export const ViewSchema = z
  .discriminatedUnion("camera", [
    /** 運転席: 1.2 m above the road. */
    z.strictObject({
      ...common,
      ...facing,
      camera: z.literal("driver"),
      eyeHeightM: z.number().default(1.2),
    }),
    /** 歩行者目線: 1.6 m, nearer. */
    z.strictObject({
      ...common,
      ...facing,
      camera: z.literal("pedestrian"),
      eyeHeightM: z.number().default(1.6),
    }),
    /** 後方追従: the car (shown) at `distanceM` from the target, the eye behind and above it. */
    z.strictObject({
      ...common,
      ...facing,
      camera: z.literal("chase"),
      backM: z.number().positive().default(7),
      heightM: z.number().positive().default(2.8),
      showCar: z.boolean().default(true),
    }),
    /** 俯瞰: `altitudeM` above the target, looking down at `pitchDeg` (90 = straight down). */
    z.strictObject({
      ...common,
      camera: z.literal("overhead"),
      target: TargetSchema,
      altitudeM: z.number().positive(),
      pitchDeg: z.number().min(5).max(90),
      angleDeg: z.number().min(-180).max(180).default(0),
      bearingDeg: z.number().optional(),
    }),
    /** 自由カメラ: an eye and a point to look at, both geodetic; `target` only for the frame's facts. */
    z.strictObject({
      ...common,
      camera: z.literal("free"),
      eye: GeoPointSchema,
      lookAt: GeoPointSchema,
      target: TargetSchema.optional(),
    }),
  ])
  .superRefine((v, ctx) => {
    const isPlaced =
      v.camera === "overhead" || v.camera === "free" || v.target !== undefined || v.at !== undefined;
    if (!isPlaced) ctx.addIssue({ code: "custom", message: `view ${v.id}: give a target or at` });
    const isSignalHeld = v.state?.signalStep !== undefined;
    const isSignalTarget = v.target !== undefined && "signal" in v.target;
    if (isSignalHeld && !isSignalTarget)
      ctx.addIssue({ code: "custom", message: `view ${v.id}: state.signalStep needs a signal target` });
  });
export type View = z.infer<typeof ViewSchema>;

/** The look of a page load: fixed so two rounds shoot the same picture. */
const lookShape = {
  /** The game's preset (?time=). */
  time: z.enum(["morning", "day", "evening", "night"]).optional(),
  /** ?weather=: clear or rain (not おまかせ, which turns by itself). */
  weather: z.enum(["clear", "rain"]).optional(),
  /** The page's Math.random seed (?seed=): traffic, pedestrians, weather spells. */
  seed: z.number().int().nonnegative().optional(),
  /**
   * A fixed moment (ISO 8601 with offset) for the sun and sky: the season and hour. The game clock
   * (timed rules, landmark light-up schedules) still runs from `time`.
   */
  moment: z.iso.datetime({ offset: true }).optional(),
};

/** One column of the look matrix (昼・夜・雨 …): its keys over the session's and the table's. */
export const LookSchema = z.strictObject({ id: kebab, ...lookShape });
export type Look = z.infer<typeof LookSchema>;

/** A measured probe every round must report (a sign's text height at 30 m …), with its limits. */
export const RequiredMetricSchema = z
  .strictObject({
    name: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().optional(),
    note: z.string().optional(),
    /**
     * Computed by the runner from a probe (pixelProbes.ts deriveMetrics): the statistic of `probe`
     * in `view` under `look`, divided by the same under `over` when given (a night / day ratio).
     * Without it the reviewer measures and reports the metric.
     */
    from: z
      .strictObject({
        view: kebab,
        probe: kebab,
        stat: z.enum(["mean", "p50", "p95", "p99", "contrast"]),
        look: kebab.optional(),
        over: kebab.optional(),
      })
      .optional(),
  })
  .refine((m) => m.min !== undefined || m.max !== undefined, { message: "a metric needs min or max" });
export type RequiredMetric = z.infer<typeof RequiredMetricSchema>;

export const SessionSchema = z.strictObject({
  id: kebab,
  /**
   * ?start= of the page: the world streams around it. Streets, signs and signals are built within
   * about 300 m of it; a landmark (a tall model, drawn far) may stand further off.
   */
  start: latLon,
  ...lookShape,
  /** The look matrix of this session (one page load each); not given: the table's, or one look. */
  looks: z.array(LookSchema).min(1).optional(),
  /** More URL parameters (expressway: "" for ?expressway). */
  params: z.record(z.string(), z.string()).optional(),
  hide: HideSchema.optional(),
  views: z.array(ViewSchema).min(1),
});
export type Session = z.infer<typeof SessionSchema>;

export const ViewTableSchema = z
  .strictObject({
    $schema: z.string().optional(),
    name: kebab,
    description: z.string(),
    defaults: z.strictObject({
      ...lookShape,
      /** Required: the sun and the sky must not follow the day the round happens to be shot. */
      moment: z.iso.datetime({ offset: true }),
      looks: z.array(LookSchema).min(1).optional(),
      params: z.record(z.string(), z.string()).optional(),
      hide: HideSchema.optional(),
      width: z.number().int().min(320).default(1280),
      height: z.number().int().min(240).default(720),
      fov: z.number().min(5).max(120).default(50),
      /** s to wait at most for the world to settle (debug.settled) before a shot fails. */
      settleTimeoutS: z.number().positive().default(90),
    }),
    /** Probes every review round must report (missing or outside: not converged). */
    metrics: z.array(RequiredMetricSchema).default([]),
    sessions: z.array(SessionSchema).min(1),
  })
  .superRefine((t, ctx) => {
    // View ids are unique in the whole table: a finding names its view, and two sessions' "front"
    // would be the same finding.
    const views = new Set<string>();
    const sessions = new Set<string>();
    for (const s of t.sessions) {
      if (sessions.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate session ${s.id}` });
      sessions.add(s.id);
      for (const v of s.views) {
        if (views.has(v.id)) ctx.addIssue({ code: "custom", message: `duplicate view ${v.id} (in ${s.id})` });
        views.add(v.id);
      }
      const looks = (s.looks ?? t.defaults.looks ?? []).map((l) => l.id);
      if (new Set(looks).size !== looks.length)
        ctx.addIssue({ code: "custom", message: `duplicate look in ${s.id}` });
    }
    // A computed metric must name a probe that exists (a typo would report it missing every round).
    for (const m of t.metrics) {
      if (!m.from) continue;
      const from = m.from;
      const session = t.sessions.find((s) => s.views.some((v) => v.id === from.view));
      const view = session?.views.find((v) => v.id === from.view);
      const hasProbe = view?.probes?.some((p) => p.name === from.probe) ?? false;
      if (!hasProbe)
        ctx.addIssue({
          code: "custom",
          message: `metric ${m.name}: no probe ${from.probe} in view ${from.view}`,
        });
      const looks = (session?.looks ?? t.defaults.looks ?? []).map((l) => l.id);
      for (const look of [from.look, from.over]) {
        const isUnknownLook = look !== undefined && !looks.includes(look);
        if (isUnknownLook)
          ctx.addIssue({ code: "custom", message: `metric ${m.name}: no look ${look} in ${session?.id}` });
      }
    }
  });
export type ViewTable = z.infer<typeof ViewTableSchema>;

/** The table read from its JSON, with the defaults filled in. Throws with every issue listed. */
export function parseViewTable(json: unknown): ViewTable {
  const parsed = ViewTableSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  throw new Error(`view table: ${z.prettifyError(parsed.error)}`);
}

/** One page load: a session under one look (null: the session has no look matrix). */
export type Load = { session: Session; look: Look | null; prefix: string };

/** The page loads of a table, in order: each session once per look. */
export function loadsOf(table: ViewTable): Load[] {
  return table.sessions.flatMap((session): Load[] => {
    const looks = session.looks ?? table.defaults.looks ?? null;
    if (!looks) return [{ session, look: null, prefix: session.id }];
    return looks.map((look) => ({ session, look, prefix: `${session.id}.${look.id}` }));
  });
}

/** The file stem and finding key of a shot. */
export const shotKey = (load: Load, view: View) => `${load.prefix}--${view.id}`;

/** Every shot a complete round of the table has. */
export function shotKeys(table: ViewTable): string[] {
  return loadsOf(table).flatMap((load) => load.session.views.map((v) => shotKey(load, v)));
}

/** The look a load is shot with: the look's keys over the session's over the table's defaults. */
export function loadLook(table: ViewTable, load: Load) {
  const { session: s, look: l } = load;
  return {
    look: l?.id ?? null,
    time: l?.time ?? s.time ?? table.defaults.time ?? "day",
    weather: l?.weather ?? s.weather ?? table.defaults.weather ?? "clear",
    seed: l?.seed ?? s.seed ?? table.defaults.seed ?? 20261110,
    moment: l?.moment ?? s.moment ?? table.defaults.moment,
    params: { ...table.defaults.params, ...s.params },
    hide: s.hide ?? table.defaults.hide ?? [],
  };
}

/** The page URL of a load (start, time, weather, seed and the extra parameters). */
export function loadUrl(base: string, table: ViewTable, load: Load): string {
  const look = loadLook(table, load);
  const url = new URL(base);
  url.searchParams.set("start", `${load.session.start[0]},${load.session.start[1]}`);
  url.searchParams.set("time", look.time);
  url.searchParams.set("weather", look.weather);
  url.searchParams.set("seed", String(look.seed));
  for (const [k, v] of Object.entries(look.params)) url.searchParams.set(k, v);
  return url.href;
}
