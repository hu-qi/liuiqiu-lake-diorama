/**
 * Terrain evidence shots: three camera angles onto the same live diorama.
 *
 * Shot 1 reproduces the **default framing** so it is directly comparable with
 * `evidence/visual-polish/after.png`; shots 2–3 keep the *default orbit target*
 * (the pedestal centre, `y ≈ −14.6`) and only change the view direction and
 * zoom. Re-targeting at the origin instead puts the camera nearly inside the
 * grass and yields an empty frame.
 *
 * Usage: node scripts/pw-terrain-shots.mjs http://localhost:4173/liuiqiu-lake-diorama/
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/liuiqiu-lake-diorama/';
const outDir = process.argv[3] || 'evidence/terrain-polish';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__DIORAMA__ && window.__DIORAMA__.ready === true, { timeout: 60000 });
await page.waitForTimeout(2000);

/** Orbit the default camera: new direction, same target, optional zoom. */
async function orbit({ dir, zoom, distanceScale = 1 }) {
  await page.evaluate(
    ({ dir, zoom, distanceScale }) => {
      const d = window.__DIORAMA__;
      d.setAutoOrbit(false);
      const target = d.controls.target.clone();
      const offset = d.camera.position.clone().sub(target);
      const distance = offset.length() * distanceScale;
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      d.camera.position.set(
        target.x + (dir.x / len) * distance,
        target.y + (dir.y / len) * distance,
        target.z + (dir.z / len) * distance,
      );
      if (zoom !== undefined) d.camera.zoom = zoom;
      d.camera.updateProjectionMatrix();
      d.controls.update();
    },
    { dir, zoom, distanceScale },
  );
  await page.waitForTimeout(900);
}

// 1) Default framing — identical rig to the baseline shot.
await page.evaluate(() => window.__DIORAMA__.resetCamera());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/after-terrain.png` });

// 2) Oblique, lower, tighter — silhouettes the relief across the park.
await orbit({ dir: { x: 0.3, y: 0.62, z: 1 }, zoom: 1.7 });

await page.screenshot({ path: `${outDir}/terrain-relief-profile.png` });

// 3) Low and close to the waterline — reads the bank slope and the stone seam.
await orbit({ dir: { x: -0.45, y: 0.3, z: 1 }, zoom: 2.8 });

await page.screenshot({ path: `${outDir}/lakeshore-slope.png` });

const state = await page.evaluate(() => {
  const d = window.__DIORAMA__;
  return { pos: d.camera.position.toArray().map((v) => +v.toFixed(1)), zoom: d.camera.zoom };
});
console.log(JSON.stringify({ outDir, state, errors: errors.slice(0, 10) }, null, 2));
await browser.close();