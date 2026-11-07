/** A number of points as players read it: "1 punto", "3 puntos". */
export function pointsLabel(points: number): string {
  return points === 1 ? '1 punto' : `${String(points)} puntos`;
}

/** A change of points with its sign, as the ledger shows it: "+3", "−1", "0". */
export function signedPoints(points: number): string {
  return points > 0 ? `+${String(points)}` : points < 0 ? `−${String(-points)}` : '0';
}
