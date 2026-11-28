/**
 * Why a drive does not count (R1-5 PR A: shared by drive-deck.ts and street-drive.ts, moved out of
 * drive-deck.ts unchanged): blocked before it began or when it stopped, an accident, a blow taken
 * standing (vehicle_bump), a citation or an arrest in the logs since it began, or null.
 */
export function invalidOf(
  before: string | null,
  blocked: string | null | undefined,
  during: (e: string) => string[],
): string | null {
  const wasBlocked = before !== null;
  if (wasBlocked) return `blocked before the drive: ${before}`;
  if (blocked) return `blocked: ${blocked}`;
  // A blow the car took standing is no accident any more (vehicle_bump), but the drive still met it.
  const hadAccident = during("accident").length > 0 || during("vehicle_bump").length > 0;
  if (hadAccident) return "accident during the drive";
  const wasCited = during("violation_cited").length > 0;
  if (wasCited) return "violation cited during the drive";
  const isArrested = during("story_begin").some((l) => l.includes(`"kind":"arrest"`));
  if (isArrested) return "arrest during the drive";
  return null;
}
