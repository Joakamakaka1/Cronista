/** A number of points as players read it: "1 punto", "3 puntos". */
export function pointsLabel(points: number): string {
  return points === 1 ? '1 punto' : `${String(points)} puntos`;
}
