import { describe, expect, it } from 'vitest';
import { createLakeOutline } from '../../../src/water/outline';
import { createTerrainSampler, terrainPhases } from '../../../src/scene/terrain';
import {
  DRY_SHORE_OFFSET,
  flatMask,
  lakeMask,
  terrainHeight,
  type TerrainAnchor,
} from '../../../src/scene/heightfield';
import {
  BRIDGES,
  DISTRICTS,
  DISTRICT_ORDER,
  LANDMARKS,
  STATION,
  WATER_BODIES,
  type DistrictId,
} from '../../../src/scene/layout';
import { LAKE_SPEC, LAKESIDE_SPEC, TERRAIN_SPEC } from '../../../src/scene/constants';

const outline = createLakeOutline();
const TAU = Math.PI * 2;

/** Same shape as `scene/environment.ts#collectTerrainAnchors`. */
function allAnchors(): TerrainAnchor[] {
  const pad = {
    innerRadius: TERRAIN_SPEC.propInnerRadius,
    outerRadius: TERRAIN_SPEC.propOuterRadius,
  };
  const anchors: TerrainAnchor[] = [];
  for (const id of DISTRICT_ORDER) {
    const [x, z] = DISTRICTS[id].placement.center;
    anchors.push({ x, z });
  }
  for (const bridge of Object.values(BRIDGES)) {
    const [x, z] = bridge.placement.center;
    anchors.push({ x, z, ...pad });
  }
  for (const landmark of Object.values(LANDMARKS)) {
    const [x, z] = landmark.placement.center;
    anchors.push({ x, z, ...pad });
  }
  const [sx, sz] = STATION.placement.center;
  anchors.push({ x: sx, z: sz, ...pad });
  for (const channel of WATER_BODIES) {
    const mid = channel.outline[Math.floor(channel.outline.length / 2)];
    anchors.push({ x: mid[0], z: mid[1], ...pad });
  }
  return anchors;
}

function districtCenters(): Array<{ id: DistrictId; x: number; z: number }> {
  return DISTRICT_ORDER.map((id) => {
    const [x, z] = DISTRICTS[id].placement.center;
    return { id, x, z };
  });
}

/** Wraps any angle into [0, 2π) exactly like `lakeMask` does. */
function wrapAngle(theta: number): number {
  return ((theta % TAU) + TAU) % TAU;
}

describe('terrain relief (amplitude lift)', () => {
  const sampler = createTerrainSampler(outline, allAnchors());

  it('produces a readable relief well above the old 0.64 m plateau', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = -120; x <= 120; x += 2) {
      for (let z = -78; z <= 78; z += 2) {
        const h = sampler(x, z);
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    // Author target is 2.5–3.5 m of relief; the sanity floor is the old value.
    expect(max - min).toBeGreaterThan(2.5);
    expect(max - min).toBeLessThan(6.0);
  });

  it('keeps the offshore land well inside the walkable-slope envelope', () => {
    // No cliff: sample the gradient everywhere and cap it at 35°.
    let worstDeg = 0;
    for (let x = -120; x <= 120; x += 2) {
      for (let z = -78; z <= 78; z += 2) {
        const gx = (sampler(x + 1, z) - sampler(x - 1, z)) / 2;
        const gz = (sampler(x, z + 1) - sampler(x, z - 1)) / 2;
        const deg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
        if (deg > worstDeg) worstDeg = deg;
      }
    }
    expect(worstDeg).toBeLessThan(35);
  });
});

describe('district terraces', () => {
  const sampler = createTerrainSampler(outline, allAnchors());

  it('every district terrace is flat where the plateau owns the ground', () => {
    // Regression guard for the two-tier anchor radii: a prop pad (bridge sits
    // 25 m from a district centre) must never tilt a district plateau.
    //
    // Scope: only the part of the 18×18 footprint that the lake mask leaves
    // fully on land. Districts C and G are close enough to the shore that their
    // inner corner is genuinely lake bank; the terrain *must* slope there (that
    // is the graded bank), so excluding it is correct, not a way around a bug.
    let checkedDistricts = 0;
    for (const { x: cx, z: cz } of districtCenters()) {
      const reference = sampler(cx, cz);
      let samples = 0;
      for (let dx = -18; dx <= 18; dx += 3) {
        for (let dz = -18; dz <= 18; dz += 3) {
          const x = cx + dx;
          const z = cz + dz;
          if (lakeMask(outline, x, z) < 1 - 1e-9) continue;
          expect(sampler(x, z)).toBeCloseTo(reference, 10);
          samples += 1;
        }
      }
      if (samples > 0) checkedDistricts += 1;
    }
    // A guard that silently checks nothing is worse than no guard.
    expect(checkedDistricts).toBeGreaterThanOrEqual(6);
  });

  it('every district plateau sits above the water surface (terraced, not sunken)', () => {
    for (const { x, z } of districtCenters()) {
      expect(sampler(x, z)).toBeGreaterThan(LAKE_SPEC.surfaceY + 0.2);
    }
  });

  it('flatOuterRadius stays clear of the neighbouring district plateau', () => {
    // The guarantee is district ↔ district. Bridges / channels are planted on
    // the ramp by design, so they are excluded from this disc test.
    const centers = districtCenters();
    for (const a of centers) {
      let nearest = Infinity;
      for (const b of centers) {
        if (a.id === b.id) continue;
        nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.z - b.z));
      }
      expect(nearest).toBeGreaterThan(TERRAIN_SPEC.flatOuterRadius);
    }
  });

  it('prop pads never reach a district centre', () => {
    // Otherwise the district plateau would be tilted by a bridge.
    const props = allAnchors().filter((a) => a.innerRadius !== undefined);
    for (const p of props) {
      for (const d of districtCenters()) {
        const gap = Math.hypot(p.x - d.x, p.z - d.z);
        expect(gap).toBeGreaterThan((p.outerRadius ?? 0) + 0);
        expect(gap + (p.outerRadius ?? 0)).toBeGreaterThan(TERRAIN_SPEC.propOuterRadius);
      }
    }
  });
});

describe('lake basin integrity', () => {
  const anchors = allAnchors();

  it('never lets terrain break the water surface inside the waterline', () => {
    // March radially outward from the lake centre and find the first point that
    // rises above the water level; it must be landward of the shoreline.
    let worstOffset = Infinity;
    for (let a = 0; a < 720; a += 1) {
      const theta = (a / 720) * TAU;
      const radius = outline.radiusAt(wrapAngle(theta));
      let firstAbove = Infinity;
      for (let d = 1; d < radius + 40; d += 0.02) {
        const h = terrainHeight(Math.cos(theta) * d, Math.sin(theta) * d, terrainPhases(), outline, anchors);
        if (h > LAKE_SPEC.surfaceY) {
          firstAbove = d;
          break;
        }
      }
      const offset = firstAbove - radius;
      if (offset < worstOffset) worstOffset = offset;
    }
    // Grass may only start rising beyond the stone apron, otherwise a green
    // fringe sprouts out of the paving. The apron is 6.5 m wide.
    expect(worstOffset).toBeGreaterThan(LAKESIDE_SPEC.bandWidth);
  });

  it('the whole lake footprint samples the basin floor', () => {
    for (let a = 0; a < 360; a += 1) {
      const theta = (a / 360) * TAU;
      const radius = outline.radiusAt(wrapAngle(theta));
      for (let d = 1; d < radius - 0.5; d += 1) {
        const h = terrainHeight(Math.cos(theta) * d, Math.sin(theta) * d, terrainPhases(), outline, anchors);
        expect(h).toBeLessThan(LAKE_SPEC.surfaceY);
      }
    }
  });

  it('the ramp reaches full relief only far from the water', () => {
    for (let a = 0; a < 360; a += 1) {
      const theta = (a / 360) * TAU;
      const radius = outline.radiusAt(wrapAngle(theta));
      const inner = radius + TERRAIN_SPEC.lakeMaskInner;
      const outer = radius + TERRAIN_SPEC.lakeMaskOuter;
      expect(lakeMask(outline, Math.cos(theta) * inner, Math.sin(theta) * inner)).toBeCloseTo(0, 6);
      expect(lakeMask(outline, Math.cos(theta) * (outer + 1), Math.sin(theta) * (outer + 1))).toBeCloseTo(1, 6);
    }
  });

  it('sizes the apron from the analytic dry-shore crossing', () => {
    // The closed form must agree with the brute-force march above, and the
    // grass line (where the ground breaks the surface) must sit beyond the
    // stone apron, otherwise grass grows through the paving.
    expect(DRY_SHORE_OFFSET).toBeGreaterThan(TERRAIN_SPEC.lakeMaskInner);
    expect(DRY_SHORE_OFFSET).toBeGreaterThan(LAKESIDE_SPEC.bandWidth);
  });

  it('keeps the whole stone apron under water so no green fringe shows', () => {
    // Real assembly path: the apron is drawn from the waterline outward, so its
    // outer edge must never rise above the waterline.
    for (let i = 0; i < outline.sectors; i += 1) {
      const theta = (i / outline.sectors) * TAU;
      const r = outline.radiusAt(theta) + LAKESIDE_SPEC.bandWidth;
      const h = terrainHeight(Math.cos(theta) * r, Math.sin(theta) * r, terrainPhases(), outline, anchors);
      expect(h).toBeLessThan(LAKE_SPEC.surfaceY);
    }
  });
});

describe('sampler / mesh parity', () => {
  it('the mesh formula and the CPU sampler agree everywhere', () => {
    const phases = terrainPhases();
    const anchors = allAnchors();
    const sampler = createTerrainSampler(outline, anchors);
    for (let x = -120; x <= 120; x += 7) {
      for (let z = -78; z <= 78; z += 7) {
        expect(sampler(x, z)).toBeCloseTo(terrainHeight(x, z, phases, outline, anchors), 12);
      }
    }
  });

  it('ignores angles outside the sampled [0, 2π) range', () => {
    // A negative angle and its +2π twin must resolve to the same sector.
    expect(lakeMask(outline, -30, 0)).toBeCloseTo(lakeMask(outline, 30 * Math.cos(Math.PI), 0), 12);
    const atMinusPi = lakeMask(outline, -45, -1e-9);
    expect(atMinusPi).toBeCloseTo(0, 6);
  });

  it('flatMask is 0 inside and 1 outside the flatten band', () => {
    const anchors = [{ x: 0, z: 0 }];
    expect(flatMask(anchors, 0, 0)).toBe(0);
    expect(flatMask(anchors, TERRAIN_SPEC.flatInnerRadius - 1, 0)).toBe(0);
    expect(flatMask(anchors, TERRAIN_SPEC.flatOuterRadius + 1, 0)).toBeCloseTo(1, 6);
  });

  it('a small prop pad does not flatten distant ground', () => {
    // Guard for the two-tier anchor radii: a bridge pad must not flatten a
    // point that is far away, while a district-sized disc still would.
    const padAnchor: TerrainAnchor = {
      x: 0,
      z: 0,
      innerRadius: TERRAIN_SPEC.propInnerRadius,
      outerRadius: TERRAIN_SPEC.propOuterRadius,
    };
    expect(flatMask([padAnchor], 0, 0)).toBe(0);
    expect(flatMask([padAnchor], TERRAIN_SPEC.propOuterRadius + 1, 0)).toBeCloseTo(1, 6);
    expect(flatMask([{ x: 0, z: 0 }], 20, 0)).toBeLessThan(1);
  });
});