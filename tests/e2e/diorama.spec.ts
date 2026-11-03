import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ConsoleMessage } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = resolve(HERE, '../visual/artifacts');

/**
 * Boot + initial-composition smoke test (PROMPT.md §11.2).
 *
 * Verifies that the real bundled build:
 *  - starts a local server and renders the WebGL scene,
 *  - mounts the thick pedestal + procedural lake before any GLB assets exist,
 *  - flags `window.__DIORAMA__.ready`,
 *  - produces no console errors or uncaught page errors,
 *  - and yields a screenshot artefact of the default three-quarter view.
 */
test.describe('Lianqiu Lake diorama — boot & initial composition', () => {
  test('renders the pedestal + lake and reports no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message: ConsoleMessage) => {
      const text = `${message.type()}: ${message.text()}`;
      if (message.type() === 'error') consoleErrors.push(text);
      else if (message.type() === 'warning') consoleWarnings.push(text);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/', { waitUntil: 'load' });

    // The bridge is installed early; readiness only flips after the asset phase.
    await page.waitForFunction(() => Boolean(window.__DIORAMA__), undefined, { timeout: 20_000 });
    await page.waitForFunction(() => window.__DIORAMA__?.ready === true, undefined, { timeout: 45_000 });

    // Let a few more frames land so damping settles before we measure. The CI
// browser rasterises WebGL in software (SwiftShader), so frames are slow —
// wait for a small delta rather than a fixed frame count.
    const startFrame = await page.evaluate(() => window.__DIORAMA__?.getStats().frameCount ?? 0);
    await page.waitForFunction(
      (from) => (window.__DIORAMA__?.getStats().frameCount ?? 0) > from + 4,
      startFrame,
      { timeout: 45_000 },
    );

    const stats = await page.evaluate(() => window.__DIORAMA__?.getStats());

    expect(stats, 'window.__DIORAMA__.getStats() should be available').toBeTruthy();
    expect(stats!.drawCalls).toBeGreaterThan(0);
    expect(stats!.triangles).toBeGreaterThan(1000);
    expect(stats!.frameCount).toBeGreaterThan(startFrame + 4);
    expect(stats!.objects).toBeGreaterThan(0);

    // The loading overlay must have faded out.
    await expect(page.locator('#loading-overlay')).toHaveAttribute('data-hidden', 'true');

    // Capture the default three-quarter view for visual verification.
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'initial-view.png') });

    // Log the asset ledger so a "waiting for assets" run is explicit, not silent.
    const ledger = await page.evaluate(() => window.__DIORAMA__?.assets.summary);
    console.info(`[e2e] asset ledger: ${ledger}`);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('exposes the agreed runtime object names for picking', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__DIORAMA__?.ready === true, undefined, {
      timeout: 45_000,
    });

    const names = await page.evaluate(() => {
      const root = window.__DIORAMA__?.scene;
      if (!root) return [] as string[];
      const found: string[] = [];
      root.traverse((object) => {
        if (object.name) found.push(object.name);
      });
      return found;
    });

    // Environment contract (owned by this task).
    expect(names).toContain('BASE_PEDESTAL');
    expect(names).toContain('BASE_NAMEPLATE');
    expect(names).toContain('TERRAIN_SURFACE');
    expect(names).toContain('LAKESIDE_GROUND');
    expect(names).toContain('LQ_LAKE');

    // District / landmark contract (PROMPT.md §7.4): every asset that actually
    // loaded must be present in the scene under its canonical runtime name, so
    // Raycaster picking and the district modules can find it.
    const ledger = await page.evaluate(() => window.__DIORAMA__?.assets.records ?? []);
    const loadedRecords = ledger.filter((record) => record.status === 'loaded');
    if (loadedRecords.length > 0) {
      for (const record of loadedRecords) {
        expect(record.runtimeName, `loaded asset ${record.assetId} needs a runtime name`).toBeTruthy();
        expect(
          names,
          `runtime name ${record.runtimeName} should exist in the scene`,
        ).toContain(record.runtimeName);
      }
      // District ids must be mapped to the DISTRICT_* convention.
      expect(names).toContain('DISTRICT_A_HILLTOP');
    }
  });

  test('captures a close-up of the pedestal front face (metal nameplate)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__DIORAMA__?.ready === true, undefined, {
      timeout: 45_000,
    });

    // Frame the front (+Z) face straight on and zoom in on the plaque. The polar
// limits must be relaxed first, otherwise OrbitControls.update() clamps a
// straight-on elevation back to the orbit range and the plaque ends up
// edge-on.
    await page.evaluate(() => {
      const bridge = window.__DIORAMA__;
      if (!bridge) return;
      bridge.controls.enabled = false;
      bridge.controls.minPolarAngle = 0;
      bridge.controls.maxPolarAngle = Math.PI;
      bridge.controls.target.set(0, -2, 85.16);
      bridge.camera.up.set(0, 1, 0);
      bridge.camera.position.set(0, -2, 132);
      bridge.camera.zoom = 3.2;
      bridge.camera.updateProjectionMatrix();
      bridge.controls.update();
    });

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'pedestal-nameplate-closeup.png') });

    const nameplateVisible = await page.evaluate(() =>
      Boolean(window.__DIORAMA__?.scene.getObjectByName('BASE_NAMEPLATE')),
    );
    expect(nameplateVisible, 'BASE_NAMEPLATE must exist in the scene graph').toBe(true);
  });
});