/**
 * Clamp a number to the provided [min, max] range. If min or max are
 * undefined, only the defined bound(s) are applied.
 */
export function clamp(n: number, min?: number, max?: number): number {
  let out = n;
  if (typeof min === "number" && out < min) {
    out = min;
  }
  if (typeof max === "number" && out > max) {
    out = max;
  }
  return out;
}
