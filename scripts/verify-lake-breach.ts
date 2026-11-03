/**
 * 数值核验：检查湖面水线以内是否存在地形穿出水面。
 *
 * `terrainHeight = y + basinOffset + noise * (lakeMask * flatMask)`。
 * 湖内 lakeMask 应为 0，高度应恒等于 y + basinOffset，必须低于水面。
 */
import { LAKE_SPEC, LAKESIDE_SPEC, TERRAIN_SPEC } from '../src/scene/constants';
import { terrainHeight } from '../src/scene/heightfield';
import { terrainPhases } from '../src/scene/terrain';
import { createLakeOutline } from '../src/water';

const outline = createLakeOutline();
const TAU = Math.PI * 2;
const phases = terrainPhases();

const waterY = LAKE_SPEC.surfaceY;
const baseline = TERRAIN_SPEC.y + TERRAIN_SPEC.basinOffset;

console.log('水面 Y =', waterY, '| 地形基线 Y =', baseline, '| amplitude =', TERRAIN_SPEC.amplitude);

let worstInside = -Infinity;
let worstInsideAt = '';
let firstAboveMin = Infinity;

for (let a = 0; a < 720; a++) {
  const theta = (a / 720) * TAU;
  const radius = outline.radiusAt(((theta % TAU) + TAU) % TAU);
  for (let d = 0.5; d < radius + 40; d += 0.25) {
    const x = Math.cos(theta) * d;
    const z = Math.sin(theta) * d;
    const h = terrainHeight(x, z, phases, outline, []);
    if (d < radius - 0.5) {
      if (h > worstInside) { worstInside = h; worstInsideAt = `theta=${theta.toFixed(3)} d=${d.toFixed(1)} R=${radius.toFixed(1)}`; }
    }
    if (h > waterY && d >= radius - 0.5 && d - radius < firstAboveMin) firstAboveMin = d - radius;
  }
}

console.log('湖线以内地形最高点 Y =', worstInside.toFixed(4), '@', worstInsideAt);
console.log('是否穿出水面 =', worstInside > waterY ? '❌ 是（缺陷）' : '✅ 否');
console.log('首次高出水面距岸 =', firstAboveMin.toFixed(2), 'm | 石板带宽 =', LAKESIDE_SPEC.bandWidth);
