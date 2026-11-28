/**
 * The player's car's body: half its width (x), height (y) and length (z) in metres, the chassis
 * cuboid vehicle.ts builds. Kept here, apart from vehicle.ts, so that what is built for the car to
 * meet (expresswayDeck.ts: a run "ends here" when its dead end lies within one car's length of an
 * end face, R1-1b 追記 4 D3) reads the same number. Why not export it from vehicle.ts: that module
 * imports the car's model (game/carModel.ts) and its Rapier body, and the world's deck builder (and
 * the Node probes that build it) would then depend on the game's drawing of the car.
 */
export const CAR_HALF = { x: 0.92, y: 0.38, z: 2.15 } as const;
/**
 * The car's body centre (the chassis origin, what vehicle.position() answers) over the road it is
 * placed at, metres (game/carModel.ts: "the ground sits ~0.86 m below it"). On its springs it settles
 * 0.07–0.08 m lower, about 0.79 m over the road (the deck drives' dy, P2.7 R1-4a-1). The callers of
 * RoadGraph.nearestOnSurface / locate pass that point, and roads.ts reads from it which road the car
 * stands on (P2.7 R1-4a-1); the robotaxi and the police patrol place their cars by it.
 */
export const CAR_RIDE_HEIGHT = 0.86;
