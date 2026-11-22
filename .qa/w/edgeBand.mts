// PR W, review0 追記 2 C3: a small network where the load extent's 60 m band crosses a chain of
// strict returns and propagation-only returns, and the same network with the band far away.
// What it checks: the inner segments' answer (two-way or not) is the same in both networks.
// Run (from the worktree, with regulations.exp.ts built): pnpm exec tsx .qa/w/edgeBand.mts
const W = "/Users/kei/ghq/github.com/kexi/tokyo-od-game/.claude/worktrees/agent-a5195e3853739145f";
const { LocalFrame } = await import(`${W}/src/geo/frame.ts`);
const { RoadGraph } = await import(`${W}/src/world/roads.ts`);
const exp = await import(`${W}/src/world/regulations.exp.ts`);
const frame = new LocalFrame(35.68, 139.76, 40);
const LAT = 1 / 110_950;
const LON = 1 / (111_320 * Math.cos((35.68 * Math.PI) / 180));
const coords = (pts: Array<[number, number]>) => pts.flatMap(([x, y]) => [139.76 + x * LON, 35.68 + y * LAT]);
const line = (pts: Array<[number, number]>, width: number) => ({
  coords: coords(pts),
  width,
  oneway: 0,
  kind: "local",
});
const ALL_DAY = [1, 0, 1440, 0, 0];
const way = (fwd: number, pts: Array<[number, number]>) => [fwd, 0, 1, 0, 0, ...coords(pts)];

/**
 * An east–west street, 30 m wide, x 0..400 in five segments (cross streets at 80/160/240/320). A
 * JARTIC one-way (westbound only: coords in the permitted travel order, east → west) along it 1.5 m off
 * the centre, a one-way OSM way each way 7 m off. A 4.3 m GSI line 3 m beyond the westbound way
 * over x 0..80 takes that way (mutual nearest): segment 0 returns only by propagation.
 */
function build(withFar: boolean) {
  const lines: any[] = [
    line(
      [
        [0, 0],
        [80, 0],
        [160, 0],
        [240, 0],
        [320, 0],
        [400, 0],
      ],
      30,
    ),
  ];
  for (const x of [80, 160, 240, 320])
    lines.push(
      line(
        [
          [x, -200],
          [x, 0],
          [x, 200],
        ],
        9,
      ),
    );
  lines.push(
    line(
      [
        [0, 10.2],
        [80, 10.2],
      ],
      4.3,
    ),
  );
  lines.push(
    line(
      [
        [0, 10.2],
        [0, 40],
      ],
      4.3,
    ),
  );
  if (withFar) {
    lines.push(
      line(
        [
          [-400, -400],
          [-400, 400],
        ],
        9,
      ),
    );
    lines.push(
      line(
        [
          [800, -400],
          [800, 400],
        ],
        9,
      ),
    );
  }
  const graph = new RoadGraph(lines as any, frame, () => {});
  const data: any = {
    speed: [],
    speedZone: [],
    crosswalk: [],
    stopLine: [],
    stopSign: [],
    sections: [],
    turns: [],
    closures: [],
    noOvertake: [],
    lanes: [
      [
        2,
        ...coords([
          [0, 0],
          [400, 0],
        ]),
      ],
    ],
    noLaneChange: [],
    laneArrows: [],
    signals: [],
    junctions: [],
    footbridges: [],
    turnlanes: [],
    // The tile's one-way is in the permitted travel order (RegulationData.oneway): westbound.
    oneway: [
      [
        ...ALL_DAY,
        ...coords([
          [400, 1.5],
          [0, 1.5],
        ]),
      ],
    ],
    roadlanes: [
      way(2, [
        [0, -7],
        [400, -7],
      ]),
      way(2, [
        [400, 7],
        [0, 7],
      ]),
    ],
  };
  return { graph, data };
}
const answers: Record<string, string[]> = {};
for (const [name, withFar] of [
  ["band-crosses", false],
  ["band-far", true],
] as const)
  for (const row of [
    { a2: true, d: true },
    { a2: true, d: false },
    { a2: false, d: false },
  ]) {
    Object.assign(exp.EXP, { a: false, a2: row.a2, d: row.d, copy: false, narrow: true, L: false });
    const { graph, data } = build(withFar);
    exp.applyRegulations(graph, data, frame, () => {});
    const main = graph.segments
      .filter((s: any) => s.line.width === 30)
      .toSorted((a: any, b: any) => a.pts[0].x - b.pts[0].x);
    const key = `${row.a2 ? "a2" : "now"}${row.d ? "+d" : ""}`;
    answers[`${key} ${name}`] = main.map((s: any) =>
      s.onewayRule
        ? `one-way${s.onewayRule.dir}`
        : `two-way ${s.lanes}/${Math.round((s.section?.median ?? 0) * 100) / 100}`,
    );
  }
console.log(JSON.stringify(answers, null, 1));
for (const key of ["now", "a2", "a2+d"]) {
  const a = answers[`${key} band-crosses`];
  const b = answers[`${key} band-far`];
  const inner = [1, 2, 3].filter((i) => a[i] !== b[i]);
  console.log(
    key,
    inner.length === 0 ? "inner segments 1-3 agree" : `inner segments differ: ${inner.join(",")}`,
  );
}
