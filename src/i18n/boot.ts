import { initI18n } from "./index";
import { bindLanguagePickers } from "./picker";

/**
 * Loaded by index.html before main.ts, as a script of its own: its few modules arrive long
 * before the game's (three.js, Rapier, the world), so the title screen is in the player's
 * language from the start instead of switching over once everything has loaded.
 */
initI18n();
bindLanguagePickers(document);
