import { AUXILIARY } from "./auxiliary";
import { GUIDE } from "./guide";
import { INSTRUCTION } from "./instruction";
import { NONSTATUTORY } from "./nonstatutory";
import { REGULATORY } from "./regulatory";
import { WARNING } from "./warning";

export { LANE_RENDERS } from "./lanes";

/** Every sign definition: 別表第一 in its order, then the 法定外 ones (the order catalog.json lists). */
export const SIGN_DEFS = [...GUIDE, ...WARNING, ...REGULATORY, ...INSTRUCTION, ...AUXILIARY, ...NONSTATUTORY];
