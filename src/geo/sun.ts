const DEG = Math.PI / 180;

/**
 * Low-precision solar position (Astronomical Almanac approximation, ~0.01° accuracy 1950–2050).
 * Returns elevation above the horizon and azimuth clockwise from north, both in degrees.
 */
export function sunPosition(date: Date, lat: number, lon: number): { elevation: number; azimuth: number } {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const eclipticLon = (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;
  const hourAngle = (gmstHours * 15 + lon) * DEG - ra;
  const phi = lat * DEG;
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(hourAngle),
  );
  return { elevation: elevation / DEG, azimuth: (azimuth / DEG + 360) % 360 };
}

/** A Date for today's calendar day in JST at the given local hour (fractional). */
export function jstDateAt(hour: number, base = new Date()): Date {
  const jst = new Date(base.getTime() + 9 * 3600_000);
  const midnightUtc = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3600_000;
  return new Date(midnightUtc + hour * 3600_000);
}

export function jstHour(date: Date): number {
  const jst = new Date(date.getTime() + 9 * 3600_000);
  return jst.getUTCHours() + jst.getUTCMinutes() / 60;
}
