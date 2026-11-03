/**
 * Terrain amplitude / flatten-radius numerical audit (temporary tool).
 * Reproduces the exact noise + mask stack from src/scene/heightfield.ts and
 * measures:
 *   1. actual height swing inside each district footprint at amplitude 2.8
 *   2. lake-mask leak (terrain above water level Y) at various transition widths
 *   3. grid Nyquist check for detailFrequency
 */
import { smoothstep } from '../src/utils/math';
import { createLakeOutline } from '../src/water/outline';
import { DISTRICTS, DISTRICT_ORDER, BRIDGES, LANDMARKS, STATION, WATER_BODIES } from '../src/scene/layout';
import { createRng } from '../src/utils/random';

const LAKE = { surfaceY: 0.06, bandWidth: 6.5 };
const BASE_LENGTH = 260, BASE_WIDTH = 170, INSET = 3;

const rng = createRng(771);
const phases = {
  p1: rng.range(0, Math.PI * 2), p2: rng.range(0, Math.PI * 2), p3: rng.range(0, Math.PI * 2),
  d1: rng.range(0, Math.PI * 2), d2: rng.range(0, Math.PI * 2),
};

function landform(x: number, z: number): number {
  return 0.6 * Math.sin(x * 0.035 + phases.p1) * Math.cos(z * 0.03 + phases.p2)
    + 0.3 * Math.sin((x + z) * 0.055 + phases.p3)
    + 0.15 * Math.cos((x - z) * 0.08 - phases.p2);
}
function detail(x: number, z: number, f: number): number {
  return 0.6 * Math.sin(x * 0.145 * f + phases.d1) * Math.cos(z * 0.121 * f + phases.d2)
    + 0.4 * Math.sin((x - z) * 0.093 * f + phases.p2);
}

const outline = createLakeOutline();
function lakeMask(x: number, z: number, inner: number, outer: number): number {
  const dx = x - outline.center.x, dz = z - outline.center.y;
  const d = Math.hypot(dx, dz);
  const th = Math.atan2(dz, dx);
  const r = outline.radiusAt(th < 0 ? th + Math.PI * 2 : th);
  return smoothstep(r + inner, r + outer, d);
}
function flatMask(anchors: { x: number; z: number }[], inner: number, outer: number, x: number, z: number): number {
  let best = Infinity;
  for (const a of anchors) best = Math.min(best, Math.hypot(x - a.x, z - a.z));
  return smoothstep(inner, outer, best);
}

const anchors: { x: number; z: number }[] = [];
for (const id of DISTRICT_ORDER) anchors.push({ x: DISTRICTS[id].placement.center[0], z: DISTRICTS[id].placement.center[1] });
for (const b of Object.values(BRIDGES)) anchors.push({ x: b.placement.center[0], z: b.placement.center[1] });
for (const l of Object.values(LANDMARKS)) anchors.push({ x: l.placement.center[0], z: l.placement.center[1] });
anchors.push({ x: STATION.placement.center[0], z: STATION.placement.center[1] });
for (const c of WATER_BODIES) { const m = c.outline[Math.floor(c.outline.length / 2)]; anchors.push({ x: m[0], z: m[1] }); }

function height(x: number, z: number, amp: number, dAmp: number, dFreq: number, flatIn: number, flatOut: number, lakeIn: number, lakeOut: number): number {
  const m = lakeMask(x, z, lakeIn, lakeOut) * flatMask(anchors, flatIn, flatOut, x, z);
  return 0.02 + (landform(x, z) * amp + detail(x, z, dFreq) * dAmp) * m;
}

console.log('=== noise range (raw, unmasked) ===');
let lo = Infinity, hi = -Infinity;
for (let x = -127; x <= 127; x += 1) for (let z = -82; z <= 82; z += 1) {
  const v = landform(x, z); lo = Math.min(lo, v); hi = Math.max(hi, v);
}
console.log(`landform ∈ [${lo.toFixed(3)}, ${hi.toFixed(3)}]  → ×2.8 = [${(lo * 2.8).toFixed(2)}, ${(hi * 2.8).toFixed(2)}] m`);
let dlo = Infinity, dhi = -Infinity;
for (let x = -127; x <= 127; x += 1) for (let z = -82; z <= 82; z += 1) {
  const v = detail(x, z, 3.4); dlo = Math.min(dlo, v); dhi = Math.max(dhi, v);
}
console.log(`detail(3.4) ∈ [${dlo.toFixed(3)}, ${dhi.toFixed(3)}]`);

// ---- 1. District footprint swing at amplitude 2.8
console.log('\n=== 1. district centre patch swing (radius 20 m, amp=2.8, detail=0.35) ===');
for (const id of DISTRICT_ORDER) {
  const [cx, cz] = DISTRICTS[id].placement.center;
  for (const flatIn of [25, 30, 34]) {
    let min = Infinity, max = -Infinity;
    for (let dx = -20; dx <= 20; dx += 1) for (let dz = -20; dz <= 20; dz += 1) {
      if (Math.hypot(dx, dz) > 20) continue;
      const h = height(cx + dx, cz + dz, 2.8, 0.35, 3.4, flatIn, flatIn + 11, 6.5 - 1, 6.5 + 7);
      min = Math.min(min, h); max = Math.max(max, h);
    }
    if (flatIn !== 34) continue;
    console.log(`  ${id} r20  flatIn=${flatIn}: swing ${(max - min).toFixed(3)} m`);
  }
}

// swing vs flatInnerRadius averaged over districts
console.log('\ndistrict swing vs flatInnerRadius (avg / worst):');
for (const flatIn of [25, 28, 30, 32, 34, 36]) {
  let sum = 0, worst = 0;
  for (const id of DISTRICT_ORDER) {
    const [cx, cz] = DISTRICTS[id].placement.center;
    let min = Infinity, max = -Infinity;
    for (let dx = -20; dx <= 20; dx += 1) for (let dz = -20; dz <= 20; dz += 1) {
      if (Math.hypot(dx, dz) > 20) continue;
      const h = height(cx + dx, cz + dz, 2.8, 0.35, 3.4, flatIn, flatIn + 11, 6.5 - 1, 6.5 + 7);
      min = Math.min(min, h); max = Math.max(max, h);
    }
    sum += max - min; worst = Math.max(worst, max - min);
  }
  console.log(`  flatIn=${flatIn}: avg ${(sum / 8).toFixed(3)} m, worst ${worst.toFixed(3)} m`);
}

// ---- 2. lake leak
console.log('\n=== 2. lake leak (terrain above water surfaceY=0.06 at distance < radius) ===');
for (const [inner, outer] of [[6.5 - 1, 6.5 + 7], [-(10) + 6.5, 3 + 6.5], [-10, 3]]) {
  let worst = -Infinity;
  for (let x = -60; x <= 60; x += 0.5) for (let z = -60; z <= 60; z += 0.5) {
    const th = Math.atan2(z, x); const r = outline.radiusAt(th < 0 ? th + Math.PI * 2 : th);
    const d = Math.hypot(x, z);
    if (d > r) continue; // only inside waterline
    worst = Math.max(worst, height(x, z, 2.8, 0.35, 3.4, 30, 41, inner, outer));
  }
  console.log(`  lakeMask ramp offset [${inner.toFixed(2)}, ${outer.toFixed(2)}]: max terrain Y inside lake = ${worst.toFixed(4)}`);
}

// ---- 3. grid nyquist
console.log('\n=== 3. grid Nyquist ===');
for (const [sx, sz] of [[120, 84], [180, 126], [200, 140]]) {
  const cellX = 254 / sx, cellZ = 164 / sz;
  // highest detail spatial wavenumber: 0.145*f in x, 0.121*f in z, 0.093*f in diag
  const kx = 0.145 * 3.4, kz = 0.121 * 3.4, kd = 0.093 * 3.4 * Math.SQRT2;
  const lx = (2 * Math.PI) / kx, lz = (2 * Math.PI) / kz, ld = (2 * Math.PI) / kd;
  console.log(`  ${sx}x${sz}: cell ${cellX.toFixed(2)}×${cellZ.toFixed(2)} m | detail λ min ${Math.min(lx, lz, ld).toFixed(2)} m → ${(Math.min(lx, lz, ld) / Math.max(cellX, cellZ)).toFixed(1)} cells/λ`);
}