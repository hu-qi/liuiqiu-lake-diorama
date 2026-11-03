import { describe, expect, it } from 'vitest';
import { InstancedMesh, Mesh, Vector3 } from 'three';
import { createTrack, findNearestU } from '../../../src/railway/track';
import { RAILWAY, STATION } from '../../../src/scene/layout';

/** 点到轨道曲线的最近 XZ 距离（米）。 */
function distanceToCurve(track: ReturnType<typeof createTrack>, point: Vector3): number {
  const sample = new Vector3();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3000; i += 1) {
    track.curve.getPointAt(i / 3000, sample);
    best = Math.min(best, Math.hypot(sample.x - point.x, sample.z - point.z));
  }
  return best;
}

describe('createTrack', () => {
  const track = createTrack();

  it('builds a closed arc-length curve from the single layout source', () => {
    expect(track.curve.closed).toBe(true);
    expect(track.length).toBeGreaterThan(150);
    expect(track.gauge).toBe(RAILWAY.gauge);
    expect(track.railTopY).toBe(RAILWAY.railTopY);
    expect(track.curve.points).toHaveLength(RAILWAY.controlPoints.length);
    // Arc-length parameterisation: getPointAt(0) === getPointAt(1) on a loop.
    const start = track.curve.getPointAt(0, new Vector3());
    const end = track.curve.getPointAt(1, new Vector3());
    expect(start.distanceTo(end)).toBeLessThan(0.01);
  });

  it('ships ballast, rails and an InstancedMesh sleeper bed (few draw calls)', () => {
    expect(track.group.getObjectByName('RAIL_BALLAST')).toBeInstanceOf(Mesh);
    expect(track.group.getObjectByName('RAIL_STEEL')).toBeInstanceOf(Mesh);
    const sleepers = track.group.getObjectByName('RAIL_SLEEPERS');
    expect(sleepers).toBeInstanceOf(InstancedMesh);
    const instanced = sleepers as InstancedMesh;
    expect(instanced.count).toBeGreaterThan(50);
    expect(instanced.count).toBe(Math.floor(track.length / RAILWAY.sleeperSpacing));
  });

  it('locates STATION_MAIN right beside the loop', () => {
    const station = new Vector3(STATION.placement.center[0], 0, STATION.placement.center[1]);
    expect(distanceToCurve(track, station)).toBeLessThan(6);
    expect(track.stationU).toBeGreaterThanOrEqual(0);
    expect(track.stationU).toBeLessThan(1);
  });

  it('keeps the rails flat on the pedestal top', () => {
    const sample = new Vector3();
    for (let i = 0; i < 60; i += 1) {
      track.curve.getPointAt(i / 60, sample);
      expect(sample.y).toBe(0);
    }
  });
});

describe('findNearestU', () => {
  it('returns the arc-length parameter of the closest point', () => {
    const track = createTrack();
    const target = new Vector3(STATION.placement.center[0], 0, STATION.placement.center[1]);
    const u = findNearestU(track.curve, [target.x, target.z], 2400);
    const point = track.curve.getPointAt(u, new Vector3());
    // STATION_MAIN sits ~4.2 m beside the loop (platform edge, architecture §4.5).
    const distance = Math.hypot(point.x - target.x, point.z - target.z);
    expect(distance).toBeLessThan(5);
    expect(distance).toBeCloseTo(distanceToCurve(track, target), 1);
  });
});