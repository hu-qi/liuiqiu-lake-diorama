/**
 * Small math / coordinate helpers shared across the diorama.
 *
 * Project convention: Three.js Y-up, 1 world unit = 1 metre. Blender exports
 * already convert Z-up to Y-up, so no per-model axis-compensation rotation is
 * ever applied here.
 */

/** Clamps `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between `a` and `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep between edges, returning 0–1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Converts degrees to radians. */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Converts radians to degrees. */
export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Rounds `value` to a sane precision for logging / manifest output. */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Approximate midpoint-radius "distance" that keeps a rectangle of the given
 * aspect inside a target aspect. Returns the { width, height } that fit.
 */
export function fitAspect(
  width: number,
  height: number,
  targetAspect: number,
): { width: number; height: number } {
  const aspect = width / height;
  if (aspect > targetAspect) {
    return { width: height * targetAspect, height };
  }
  return { width, height: width / targetAspect };
}