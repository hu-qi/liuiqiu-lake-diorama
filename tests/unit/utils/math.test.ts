import { describe, expect, it } from 'vitest';
import { clamp, fitAspect, lerp, round, smoothstep } from '../../../src/utils/math';

describe('math helpers', () => {
  it('clamps into the inclusive range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('lerps between two values', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 0, 0.25)).toBe(7.5);
  });

  it('smoothsteps with clamped ends', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
    // Degenerate edges must not divide by zero.
    expect(smoothstep(2, 2, 3)).toBe(1);
    expect(smoothstep(2, 2, 1)).toBe(0);
  });

  it('rounds to a sane precision', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.23456)).toBe(1.235);
  });

  it('shrinks the wider axis to match a target aspect', () => {
    const wide = fitAspect(16, 9, 1);
    expect(wide.width / wide.height).toBeCloseTo(1, 6);
    expect(wide.height).toBe(9);

    const tall = fitAspect(9, 16, 1);
    expect(tall.width / tall.height).toBeCloseTo(1, 6);
    expect(tall.width).toBe(9);
  });
});