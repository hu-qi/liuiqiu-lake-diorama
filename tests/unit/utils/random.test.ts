import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../../src/utils/random';

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const sequenceA = Array.from({ length: 8 }, () => a.next());
    const sequenceB = Array.from({ length: 8 }, () => b.next());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it('keeps `next` within [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 500; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('honours range and int bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.range(-5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);

      const integer = rng.int(2, 4);
      expect(Number.isInteger(integer)).toBe(true);
      expect(integer).toBeGreaterThanOrEqual(2);
      expect(integer).toBeLessThanOrEqual(4);
    }
  });

  it('picks only from the provided array and throws when empty', () => {
    const rng = createRng(31);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 50; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow();
  });

  it('normalises non-finite seeds instead of producing NaN', () => {
    const rng = createRng(Number.NaN);
    expect(Number.isFinite(rng.next())).toBe(true);
  });
});

describe('hashSeed', () => {
  it('is stable and returns unsigned 32-bit integers', () => {
    expect(hashSeed('DISTRICT_A_HILLTOP')).toBe(hashSeed('DISTRICT_A_HILLTOP'));
    const value = hashSeed('练秋湖');
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
  });
});