import { describe, expect, it } from 'vitest';
import { createLakeOutline, isInsideLake } from '../../../src/water/outline';
import { createLakeSurfaceGeometry } from '../../../src/water/geometry';

const outline = createLakeOutline();

describe('createLakeOutline', () => {
  it('is deterministic (same lake on every reload)', () => {
    const other = createLakeOutline();
    expect(other.points.length).toBe(outline.points.length);
    for (let i = 0; i < outline.points.length; i += 1) {
      expect(other.points[i].x).toBeCloseTo(outline.points[i].x, 9);
      expect(other.points[i].y).toBeCloseTo(outline.points[i].y, 9);
    }
  });

  it('stays within a plausible radius band', () => {
    expect(outline.minRadius).toBeGreaterThan(20);
    expect(outline.maxRadius).toBeLessThan(90);
    expect(outline.maxRadius).toBeGreaterThan(outline.minRadius);
  });

  it('is irregular rather than a perfect circle', () => {
    const radii = Array.from({ length: outline.sectors }, (_, i) =>
      outline.radiusAt((i / outline.sectors) * Math.PI * 2),
    );
    const spread = Math.max(...radii) - Math.min(...radii);
    expect(spread).toBeGreaterThan(2);
  });

  it('returns a positive radius for every angle', () => {
    for (let i = 0; i < 720; i += 1) {
      expect(outline.radiusAt((i / 720) * Math.PI * 2)).toBeGreaterThan(0);
    }
  });
});

describe('isInsideLake', () => {
  it('treats the centre as inside', () => {
    expect(isInsideLake(outline, outline.center.x, outline.center.y)).toBe(true);
  });

  it('treats a point far outside as outside', () => {
    expect(isInsideLake(outline, 500, 500)).toBe(false);
  });

  it('reports the waterline point as on the boundary', () => {
    const theta = 0.7;
    const radius = outline.radiusAt(theta);
    const x = outline.center.x + Math.cos(theta) * radius;
    const z = outline.center.y + Math.sin(theta) * radius;
    expect(isInsideLake(outline, x, z)).toBe(true);
    // With a positive epsilon the same point falls outside (used for shore
    // placement so objects sit exactly on land).
    expect(isInsideLake(outline, x, z, 1)).toBe(false);
  });
});

describe('createLakeSurfaceGeometry', () => {
  it('builds a polar grid whose outer ring matches the outline', () => {
    const rings = 8;
    const geometry = createLakeSurfaceGeometry(outline, { rings, sectors: outline.sectors });
    const position = geometry.getAttribute('position');
    expect(position.count).toBe((rings + 1) * outline.sectors);

    // Sample the outermost ring at a few angles and compare with the outline.
    for (const theta of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const i = Math.round((theta / (Math.PI * 2)) * outline.sectors) % outline.sectors;
      const index = rings * outline.sectors + i;
      const x = position.getX(index);
      const z = position.getZ(index);
      const radius = Math.hypot(x - outline.center.x, z - outline.center.y);
      expect(radius).toBeCloseTo(outline.radiusAt(theta), 3);
    }
    expect(geometry.getIndex()?.count).toBeGreaterThan(0);
  });
});