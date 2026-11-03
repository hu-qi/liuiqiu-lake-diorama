import { describe, expect, it } from 'vitest';
import { resolvePlacement, type PlacementResolver } from '../../../src/loaders/placement';
import { isCanonicalRuntimeName, runtimeNameForAssetId } from '../../../src/loaders/runtimeNames';
import type { AssetManifestEntry } from '../../../src/loaders/types';

describe('resolvePlacement', () => {
  it('prefers a placement declared in the manifest', () => {
    const entry: AssetManifestEntry = {
      assetId: 'A_HILLTOP',
      placement: { position: [1, 2, 3] },
    };
    const result = resolvePlacement(entry);
    expect(result.source).toBe('manifest.placement');
    expect(result.placement?.position).toEqual([1, 2, 3]);
  });

  it('falls back to the provisional layout and fits the zone footprint', () => {
    const entry: AssetManifestEntry = {
      assetId: 'A_HILLTOP',
      boundingBox: { min: [-75, -1.2, -55], max: [75, 36.01, 55] },
    };
    const result = resolvePlacement(entry);
    expect(result.source).toBe('loaders/provisional-layout');
    // Zone is 60 × 50 for a 150 × 110 model → scale = min(0.4, 0.4545) = 0.4.
    expect(result.placement?.scale).toBeCloseTo(0.4, 5);
    expect(result.placement?.position?.[0]).toBe(-96);
    expect(result.placement?.position?.[2]).toBe(-56);
    // Lifted so the lowest point (min.y = -1.2) rests on the pedestal top.
    expect(result.placement?.position?.[1]).toBeCloseTo(0.48, 5);
  });

  it('matches the provisional zone even when the entry uses the canonical runtime name', () => {
    // assets-manifest.json 的 assetId 是规范名（DISTRICT_A_HILLTOP），
    // 兜底表必须以同一个 key 命中，否则布局模块缺失时资产会全部堆在原点。
    const entry: AssetManifestEntry = {
      assetId: 'DISTRICT_A_HILLTOP',
      boundingBox: { min: [-75, -1.2, -55], max: [75, 36.01, 55] },
    };
    const result = resolvePlacement(entry);
    expect(result.source).toBe('loaders/provisional-layout');
    expect(result.placement?.position?.[0]).toBe(-96);
    expect(result.placement?.position?.[2]).toBe(-56);
  });

  it('gives an integration resolver priority over the provisional layout', () => {
    const resolver: PlacementResolver = {
      name: 'test/override',
      resolvePlacement: (entry) =>
        entry.assetId === 'A_HILLTOP' ? { position: [5, 5, 5], scale: 1 } : null,
    };
    const entry: AssetManifestEntry = { assetId: 'A_HILLTOP' };
    const result = resolvePlacement(entry, [resolver]);
    expect(result.source).toBe('test/override');
    expect(result.placement?.position).toEqual([5, 5, 5]);
  });

  it('returns a null placement (source "none") for unknown asset ids', () => {
    const result = resolvePlacement({ assetId: 'UNKNOWN_ASSET' });
    expect(result.placement).toBeNull();
    expect(result.source).toBe('none');
  });
});

describe('runtime names', () => {
  it('maps district asset ids to the DISTRICT_* convention', () => {
    expect(runtimeNameForAssetId('A_HILLTOP')).toBe('DISTRICT_A_HILLTOP');
    expect(runtimeNameForAssetId('H_URBAN_AXIS')).toBe('DISTRICT_H_URBAN_AXIS');
  });

  it('maps bridges and landmarks to the LANDMARK_* convention', () => {
    expect(runtimeNameForAssetId('MOON_BRIDGE')).toBe('LANDMARK_MOON_BRIDGE');
    expect(runtimeNameForAssetId('RAINBOW_BRIDGE')).toBe('LANDMARK_RAINBOW_BRIDGE');
    expect(runtimeNameForAssetId('ARCH_BRIDGE')).toBe('LANDMARK_ARCH_BRIDGE');
    expect(runtimeNameForAssetId('CAPSULE_CENTER')).toBe('LANDMARK_CAPSULE_CENTER');
  });

  it('passes through unknown ids unchanged', () => {
    expect(runtimeNameForAssetId('SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
  });

  it('recognises canonical names', () => {
    expect(isCanonicalRuntimeName('DISTRICT_A_HILLTOP')).toBe(true);
    expect(isCanonicalRuntimeName('TRAIN_HEAD')).toBe(true);
    expect(isCanonicalRuntimeName('Scene')).toBe(false);
    expect(isCanonicalRuntimeName('')).toBe(false);
  });
});