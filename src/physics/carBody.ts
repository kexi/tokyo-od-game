/**
 * The player's car's body: half its width (x), height (y) and length (z) in metres, the chassis
 * cuboid vehicle.ts builds. Kept here, apart from vehicle.ts, so that what is built for the car to
 * meet (expresswayDeck.ts: a run "ends here" when its dead end lies within one car's length of an
 * end face, R1-1b 追記 4 D3) reads the same number. Why not export it from vehicle.ts: that module
 * imports the car's model (game/carModel.ts) and its Rapier body, and the world's deck builder (and
 * the Node probes that build it) would then depend on the game's drawing of the car.
 */
export const CAR_HALF = { x: 0.92, y: 0.38, z: 2.15 } as const;
