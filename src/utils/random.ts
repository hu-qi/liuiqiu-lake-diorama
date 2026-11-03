/**
 * Deterministic pseudo-random utilities.
 *
 * All procedural content in the diorama (lake outline, terrain undulation,
 * tree scattering by the landscape team) must be reproducible across reloads,
 * so a single seeded PRNG (`mulberry32`) is the only source of randomness.
 * Never call `Math.random()` directly in scene code.
 */

export interface Rng {
  /** Float in [0, 1). */
  readonly next: () => number;
  /** Float in [min, max). */
  readonly range: (min: number, max: number) => number;
  /** Integer in [min, max] inclusive. */
  readonly int: (min: number, max: number) => number;
  /** Random element of a non-empty array. */
  readonly pick: <T>(items: readonly T[]) => T;
  /** True with the given probability (0–1). */
  readonly chance: (probability: number) => boolean;
}

/**
 * Creates a seeded PRNG. `mulberry32` is small, fast and statistically good
 * enough for visual scattering (it is not cryptographic).
 */
export function createRng(seed: number): Rng {
  let state = normalizeSeed(seed);

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number): number => min + next() * (max - min);

  return {
    next,
    range,
    int: (min: number, max: number): number => Math.floor(range(min, max + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error('createRng().pick() called with an empty array');
      }
      return items[Math.floor(next() * items.length) % items.length];
    },
    chance: (probability: number): boolean => next() < probability,
  };
}

/** Hashes an arbitrary string into a 32-bit unsigned integer (stable seed). */
export function hashSeed(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  return Math.floor(seed) >>> 0 || 1;
}