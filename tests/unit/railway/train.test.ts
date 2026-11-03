import { describe, expect, it } from 'vitest';
import { Object3D, Quaternion, Vector3 } from 'three';
import { createTrack } from '../../../src/railway/track';
import { DioramaTrain } from '../../../src/railway/train';
import { RAILWAY } from '../../../src/scene/layout';

const CAR_SCALE = RAILWAY.trainScale;
const SPACING = RAILWAY.carSpacing;

function buildTrain(withStationStop = true): {
  train: DioramaTrain;
  cars: Object3D[];
  track: ReturnType<typeof createTrack>;
} {
  const track = createTrack();
  const cars = Array.from({ length: 4 }, (_, index) => {
    const car = new Object3D();
    car.name = `CAR_${index}`;
    car.scale.setScalar(CAR_SCALE);
    return car;
  });
  const train = new DioramaTrain(cars, track.curve, {
    spacing: SPACING,
    cruiseSpeed: RAILWAY.cruiseSpeed,
    railTopY: track.railTopY,
    stationU: track.stationU,
    wheelY: 0.4,
    // Short dwell / brake windows keep the unit test fast.
    dwellSeconds: withStationStop ? 0.1 : 0,
    brakeDistance: withStationStop ? 8 : 2,
  });
  return { train, cars, track };
}

function distanceToCurve(track: ReturnType<typeof createTrack>, point: Vector3): number {
  const sample = new Vector3();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3000; i += 1) {
    track.curve.getPointAt(i / 3000, sample);
    best = Math.min(best, Math.hypot(sample.x - point.x, sample.z - point.z));
  }
  return best;
}

describe('DioramaTrain — arc-length sampling', () => {
  it('starts dwelling at STATION_MAIN with four coupled vehicles', () => {
    const { train, cars } = buildTrain();
    expect(train.carCount).toBe(4);
    expect(train.isDwelling).toBe(true);
    expect(train.isRunning).toBe(false);
    expect(train.currentSpeed).toBe(0);
    for (const car of cars) expect(car.parent).toBe(train.group);
  });

  it('runs, staying glued to the curve with equal car spacing', () => {
    const { train, track } = buildTrain();
    train.start();
    for (let i = 0; i < 80; i += 1) train.update(0.1);

    expect(train.isRunning).toBe(true);
    expect(train.currentSpeed).toBeGreaterThan(0.5);

    const positions = train.carPositions();
    expect(positions).toHaveLength(4);

    // 1) Every car centre sits on the rails.
    for (const position of positions) {
      // Residual is our own arc-length LUT discretisation (~cm), not derailment.
      expect(distanceToCurve(track, position)).toBeLessThan(0.1);
    }

    // 2) Cars are spaced by the configured centre-to-centre distance.
    for (let i = 1; i < positions.length; i += 1) {
      const gap = Math.hypot(
        positions[i].x - positions[i - 1].x,
        positions[i].z - positions[i - 1].z,
      );
      expect(gap).toBeGreaterThan(SPACING - 1);
      expect(gap).toBeLessThan(SPACING + 1);
    }

    // 3) Wheels ride just above the rail head (no visible clipping).
    const expectedY = track.railTopY + 0.02 - 0.4 * CAR_SCALE;
    for (const position of positions) expect(position.y).toBeCloseTo(expectedY, 5);
  });

  it('bends with the curve instead of behaving like one rigid box', () => {
    const { train, cars } = buildTrain();
    train.start();
    for (let i = 0; i < 80; i += 1) train.update(0.1);

    let maxAngleDeg = 0;
    for (let i = 1; i < cars.length; i += 1) {
      const dot = Math.abs(cars[i - 1].quaternion.dot(cars[i].quaternion));
      const angle = 2 * Math.acos(Math.min(1, dot));
      maxAngleDeg = Math.max(maxAngleDeg, (angle * 180) / Math.PI);
    }
    // Not a tautological check: a merged railcar would share one quaternion.
    expect(maxAngleDeg).toBeGreaterThan(0.2);
  });

  it('can be paused and resumed without losing its position on the loop', () => {
    const { train, track } = buildTrain();
    train.start();
    for (let i = 0; i < 60; i += 1) train.update(0.1);
    const before = train.headPosition.clone();

    train.pause();
    expect(train.isRunning).toBe(false);
    expect(train.currentSpeed).toBe(0);
    const paused = train.headPosition.clone();
    for (let i = 0; i < 10; i += 1) train.update(0.1);
    expect(train.headPosition.distanceTo(paused)).toBeLessThan(0.001);
    expect(distanceToCurve(track, train.headPosition)).toBeLessThan(0.1);

    train.start();
    for (let i = 0; i < 40; i += 1) train.update(0.1);
    expect(train.headPosition.distanceTo(before)).toBeGreaterThan(0.5);
    expect(train.headPosition.distanceTo(paused)).toBeGreaterThan(0.5);
  });

  it('returns a fresh quaternion per car (no shared instance)', () => {
    const { train, cars } = buildTrain();
    train.update(0.1);
    for (const car of cars) {
      expect(car.quaternion).toBeInstanceOf(Quaternion);
    }
    const unique = new Set(cars.map((car) => car.quaternion.toArray().join(',')));
    expect(unique.size).toBeGreaterThan(1);
  });
});