// Rapier interaction groups: upper 16 bits = membership, lower 16 = which memberships to
// interact with. Thin street furniture (sign posts, signal poles) is solid for the car and
// people, but ground probes (open-ground tests, spawn height) must see through it.
const PROPS = 0x0002;

/** Street furniture: member of PROPS, interacts with everything. */
export const PROP_GROUPS = (PROPS << 16) | 0xffff;

/** Ground probes: ignore PROPS. */
export const GROUND_QUERY_GROUPS = (0xffff << 16) | (0xffff & ~PROPS);
