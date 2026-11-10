// Moved to src/time/ruleTime.ts (G2): src/signs reads the 規制時間 too and must not depend on
// src/world. Why keep this re-export: the world, the game and the tests import it from here, and
// rewriting 28 imports while other work edits main.ts would only make conflicts. New code imports
// src/time/ruleTime.ts.
export * from "../time/ruleTime";
