// Rapier interaction groups: upper 16 bits = membership, lower 16 = which memberships to
// interact with. Thin street furniture (sign posts, signal poles) is solid for the car and
// people, but ground probes (open-ground tests, spawn height) must see through it.
const PROPS = 0x0002;

/** Street furniture: member of PROPS, interacts with everything. */
export const PROP_GROUPS = (PROPS << 16) | 0xffff;

/** Ground probes: ignore PROPS. */
export const GROUND_QUERY_GROUPS = (0xffff << 16) | (0xffff & ~PROPS);

// PLATEAU buildings' trimeshes, in a group of their own so the car can ask whether it overlaps one
// (Vehicle.overlapsBuilding). Those standing into an expressway deck are cut below it (P4,
// buildings.ts cutAboveDecks); P3 let a car on a deck pass through them instead.
const BUILDINGS = 0x0010;

/** A PLATEAU building tile's collider: member of BUILDINGS, interacts with everything. */
export const BUILDING_GROUPS = (BUILDINGS << 16) | 0xffff;

/** Everything (Rapier's default). */
export const ALL_GROUPS = 0xffffffff;

// Solver groups (contact forces only; contacts and collision events still happen). The cars'
// chassis are members of VEHICLES; the kinematic bodies with a mass (traffic, pedestrians, 路上駐車)
// leave VEHICLES out, so the solver never treats them as infinitely heavy walls for a car:
// physics/massContacts.ts does that exchange from both masses.
const VEHICLES = 0x0004;
const MASSIVE = 0x0008;

/** A car's chassis (Vehicle): member of VEHICLES, solves against everything. */
export const VEHICLE_SOLVER_GROUPS = (VEHICLES << 16) | 0xffff;

/** A kinematic body with a mass: no solver contacts with the cars. */
export const MASSIVE_SOLVER_GROUPS = (MASSIVE << 16) | (0xffff & ~VEHICLES);
