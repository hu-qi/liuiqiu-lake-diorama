import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = resolve(HERE, '../visual/artifacts');

const DISTRICT_NAMES = [
  'DISTRICT_A_HILLTOP',
  'DISTRICT_B_WATERTOWN',
  'DISTRICT_C_URBAN_AXIS',
  'DISTRICT_D_COLLEGE',
  'DISTRICT_E_FOREST_TOWN',
  'DISTRICT_F_PLAZA_TOWN',
  'DISTRICT_G_URBAN_BLOCKS',
  'DISTRICT_H_URBAN_AXIS',
];

const LANDMARK_NAMES = [
  'LANDMARK_MOON_BRIDGE',
  'LANDMARK_RAINBOW_BRIDGE',
  'LANDMARK_ARCH_BRIDGE',
  'LANDMARK_CAPSULE_CENTER',
];

const RAILWAY_NAMES = ['RAIL_BALLAST', 'RAIL_STEEL', 'RAIL_SLEEPERS'];

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__DIORAMA__), undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__DIORAMA__?.ready === true, undefined, { timeout: 60_000 });
  // Let a couple of frames land so the lazy district / railway / UI phases run.
  const start = await page.evaluate(() => window.__DIORAMA__?.getStats().frameCount ?? 0);
  await page.waitForFunction(
    (from) => (window.__DIORAMA__?.getStats().frameCount ?? 0) > from + 3,
    start,
    { timeout: 40_000 },
  );
}

async function settle(page: Page, ms: number): Promise<void> {
  await page.evaluate((duration) => new Promise((r) => setTimeout(r, duration)), ms);
  const start = await page.evaluate(() => window.__DIORAMA__?.getStats().frameCount ?? 0);
  await page.waitForFunction(
    (from) => (window.__DIORAMA__?.getStats().frameCount ?? 0) > from + 2,
    start,
    { timeout: 40_000 },
  );
}

test.describe('integration — 组团 / 铁路 / 交互 / UI', () => {
  test('exposes every district, landmark, station, train and rail object', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/', { waitUntil: 'load' });
    await waitForReady(page);

    const names = await page.evaluate(() => {
      const found: string[] = [];
      window.__DIORAMA__?.scene.traverse((object) => {
        if (object.name) found.push(object.name);
      });
      return found;
    });

    for (const name of [...DISTRICT_NAMES, ...LANDMARK_NAMES, ...RAILWAY_NAMES]) {
      expect(names, `scene must contain ${name}`).toContain(name);
    }
    expect(names, 'station must exist').toContain('STATION_MAIN');
    expect(names, 'train head must exist').toContain('TRAIN_HEAD');
    for (let i = 1; i <= 4; i += 1) {
      expect(names, `train car ${i} must exist`).toContain(`TRAIN_CAR_0${i}`);
    }
    expect(names, 'instanced forest group must exist').toContain('DISTRICT_FOREST');
    expect(names, 'road network must exist').toContain('DISTRICT_ROADS');

    // getObjectByName contract (PROMPT §8).
    for (const name of ['DISTRICT_D_COLLEGE', 'LANDMARK_MOON_BRIDGE', 'STATION_MAIN', 'TRAIN_HEAD']) {
      const exists = await page.evaluate(
        (target) => Boolean(window.__DIORAMA__?.getObjectByName(target)),
        name,
      );
      expect(exists, `getObjectByName('${name}') must return an object`).toBe(true);
    }

    const stats = await page.evaluate(() => window.__DIORAMA__?.getStats());
    expect(stats!.drawCalls).toBeGreaterThan(0);
    expect(stats!.triangles).toBeGreaterThan(1000);

    expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('selection highlights the picked district and restores on deselect', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForReady(page);

    const result = await page.evaluate(() => {
      const bridge = window.__DIORAMA__;
      if (!bridge) return null;

      const readEmissive = (name: string): number => {
        const object = bridge.getObjectByName(name);
        if (!object) return -1;
        let max = 0;
        object.traverse((child) => {
          const mesh = child as unknown as {
            isMesh?: boolean;
            material?: { emissive?: { getHex(): number } } | Array<{ emissive?: { getHex(): number } }>;
          };
          if (!mesh.isMesh || !mesh.material) return;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials) {
            if (material.emissive) max = Math.max(max, material.emissive.getHex());
          }
        });
        return max;
      };

      const baseline = readEmissive('DISTRICT_D_COLLEGE');
      bridge.select('DISTRICT_D_COLLEGE');
      const selected = readEmissive('DISTRICT_D_COLLEGE');
      // A different district must stay untouched while D is highlighted.
      const other = readEmissive('DISTRICT_A_HILLTOP');
      const selectedName = bridge.getIntegration()?.selected ?? null;

      bridge.select(null);
      const restored = readEmissive('DISTRICT_D_COLLEGE');
      const clearedName = bridge.getIntegration()?.selected ?? null;

      return { baseline, selected, other, restored, selectedName, clearedName };
    });

    expect(result, 'selection probe must run').toBeTruthy();
    expect(result!.selectedName).toBe('DISTRICT_D_COLLEGE');
    expect(result!.selected, 'the picked district must glow').toBeGreaterThan(result!.baseline);
    expect(result!.other, 'a sibling district must not glow').toBeLessThanOrEqual(1);
    expect(result!.restored).toBe(result!.baseline);
    expect(result!.clearedName).toBeNull();
  });

  test('train runs along the rails: multi-car arc sampling, equal spacing, no derailment', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await waitForReady(page);

    // The train starts dwelling at STATION_MAIN; wait until it has accelerated
    // out of the station (software rendering makes the departure slow).
    await page.waitForFunction(
      () => (window.__DIORAMA__?.getTrainState()?.speed ?? 0) > 3,
      undefined,
      { timeout: 90_000 },
    );

    const first = await page.evaluate(() => window.__DIORAMA__?.getTrainState());
    await settle(page, 2500);
    const second = await page.evaluate(() => window.__DIORAMA__?.getTrainState());

    expect(first, 'train state must be available').toBeTruthy();
    expect(second, 'train state must be available').toBeTruthy();
    expect(first!.cars.length, 'train must have 4 vehicles').toBe(4);

    // 1) The head actually moves.
    const moved = Math.hypot(
      second!.head[0] - first!.head[0],
      second!.head[2] - first!.head[2],
    );
    expect(moved, 'train head must advance along the track').toBeGreaterThan(1.5);

    // 2) Every car rides on the rails (max XZ distance to the curve).
    //    The residual is arc-length LUT discretisation noise (~a few cm on a
    //    330 m loop), not derailment.
    expect(second!.railOffset, 'cars must stay on the curve').toBeLessThan(0.15);

    // 3) Cars are evenly spaced along the arc.
    const cars = second!.cars;
    for (let i = 1; i < cars.length; i += 1) {
      const gap = Math.hypot(cars[i][0] - cars[i - 1][0], cars[i][2] - cars[i - 1][2]);
      expect(gap, `car ${i} spacing`).toBeGreaterThan(7.6);
      expect(gap, `car ${i} spacing`).toBeLessThan(9.4);
    }

    // 4) The train is NOT a rigid straight box: successive car segments bend.
    const v1 = [cars[1][0] - cars[0][0], cars[1][2] - cars[0][2]];
    const v2 = [cars[2][0] - cars[1][0], cars[2][2] - cars[1][2]];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const cross = v1[0] * v2[1] - v1[1] * v2[0];
    const bendDeg = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
    expect(bendDeg, 'adjacent cars must bend with the curve').toBeGreaterThan(0.5);
  });

  test('default composition fills the viewport (before/after pixel measurement)', async ({ page }) => {
    const measure = async (url: string) => {
      await page.goto(url, { waitUntil: 'load' });
      await waitForReady(page);
      await settle(page, 800);
      return page.evaluate(() => {
        const bridge = window.__DIORAMA__;
        if (!bridge) return null;
        const source = bridge.renderer.domElement;
        const off = document.createElement('canvas');
        off.width = source.width;
        off.height = source.height;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(source, 0, 0);
        const { width, height } = off;
        const data = ctx.getImageData(0, 0, width, height).data;

        // Reference = average of the four corner patches (= empty background).
        const patch = 8;
        let rr = 0;
        let gg = 0;
        let bb = 0;
        let n = 0;
        const corners: Array<[number, number]> = [
          [0, 0],
          [width - patch, 0],
          [0, height - patch],
          [width - patch, height - patch],
        ];
        for (const [cx, cy] of corners) {
          for (let y = cy; y < cy + patch; y += 1) {
            for (let x = cx; x < cx + patch; x += 1) {
              const i = (y * width + x) * 4;
              rr += data[i];
              gg += data[i + 1];
              bb += data[i + 2];
              n += 1;
            }
          }
        }
        const ref = [rr / n, gg / n, bb / n];

        let subject = 0;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        for (let y = 0; y < height; y += 2) {
          for (let x = 0; x < width; x += 2) {
            const i = (y * width + x) * 4;
            const distance = Math.max(
              Math.abs(data[i] - ref[0]),
              Math.abs(data[i + 1] - ref[1]),
              Math.abs(data[i + 2] - ref[2]),
            );
            if (distance > 16) {
              subject += 1;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        const sampled = Math.ceil(width / 2) * Math.ceil(height / 2);
        return {
          subjectFraction: subject / sampled,
          bboxWidthFraction: (maxX - minX) / width,
          bboxHeightFraction: (maxY - minY) / height,
        };
      });
    };

    // "Before" = the original core framing margin (1.14); "after" = this task's
    // tightened default (0.8).
    const before = await measure('/?framing=1.14');
    const after = await measure('/');

    expect(before, 'before measurement').toBeTruthy();
    expect(after, 'after measurement').toBeTruthy();
    console.info(
      `[e2e] subject fill before=${(before!.subjectFraction * 100).toFixed(1)}% ` +
        `(bbox ${(before!.bboxWidthFraction * 100).toFixed(1)}%×${(before!.bboxHeightFraction * 100).toFixed(1)}%) ` +
        `→ after=${(after!.subjectFraction * 100).toFixed(1)}% ` +
        `(bbox ${(after!.bboxWidthFraction * 100).toFixed(1)}%×${(after!.bboxHeightFraction * 100).toFixed(1)}%)`,
    );
    expect(after!.subjectFraction).toBeGreaterThan(before!.subjectFraction + 0.05);
    expect(after!.bboxWidthFraction).toBeGreaterThan(0.9);
    expect(after!.subjectFraction).toBeGreaterThan(0.5);
  });

  test('captures the required visual states', async ({ page }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });

    await page.goto('/', { waitUntil: 'load' });
    await waitForReady(page);

    // 1) Default three-quarter composition (after the district/railway/UI phases).
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'integration-default-view.png') });

    // 2) Focused view of one district (theme-region switch → smooth focus).
    await page.evaluate(() => window.__DIORAMA__?.selectThemeRegion('D'));
    await settle(page, 1600);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'integration-district-d-focus.png') });

    // 3) Train running with the camera following it.
    await page.evaluate(() => {
      window.__DIORAMA__?.resetCamera();
      window.__DIORAMA__?.setTrainRunning(true);
      window.__DIORAMA__?.setFollowTrain(true);
    });
    await settle(page, 2500);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'integration-train-running.png') });
    await page.evaluate(() => window.__DIORAMA__?.setFollowTrain(false));

    // 4) Clean mode (all UI chrome hidden) — reset the view first, then hide.
    await page.evaluate(() => window.__DIORAMA__?.resetCamera());
    await settle(page, 800);
    await page.evaluate(() => window.__DIORAMA__?.setCleanMode(true));
    await settle(page, 1000);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'integration-clean-mode.png') });

    // 5) Fullscreen — enlarge the viewport first, then trigger the real
    //    Fullscreen API through a trusted toolbar click.
    await page.evaluate(() => window.__DIORAMA__?.setCleanMode(false));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await settle(page, 800);
    await page.click('[data-action="fullscreen"]');
    await settle(page, 1000);
    const fullscreenActive = await page.evaluate(() => Boolean(document.fullscreenElement));
    console.info(`[e2e] fullscreen active: ${fullscreenActive}`);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'integration-fullscreen.png') });
    expect(fullscreenActive, 'Fullscreen API must engage').toBe(true);
    await page.evaluate(() => document.exitFullscreen().catch(() => undefined));

    const integration = await page.evaluate(() => window.__DIORAMA__?.getIntegration());
    expect(integration, 'integration snapshot must be available').toBeTruthy();
  });

  test('performance: draw calls / triangles / fps before vs after batching', async ({ page }) => {
    test.setTimeout(180_000);

    const measure = async (url: string) => {
      await page.goto(url, { waitUntil: 'load' });
      await waitForReady(page);
      await settle(page, 1500);
      const stats = await page.evaluate(() => window.__DIORAMA__?.getStats());
      const report = await page.evaluate(() => window.__DIORAMA__?.getDistrictReport() ?? null);
      return { stats: stats!, report };
    };

    const after = await measure('/');
    const before = await measure('/?nomerge=1');

    const summary = {
      capturedAt: new Date().toISOString(),
      batched: {
        drawCalls: after.stats.drawCalls,
        triangles: after.stats.triangles,
        fps: after.stats.fps,
        meshReport: after.report,
      },
      unbatched: {
        drawCalls: before.stats.drawCalls,
        triangles: before.stats.triangles,
        fps: before.stats.fps,
        meshReport: before.report,
      },
    };

    writeFileSync(resolve(ARTIFACT_DIR, 'performance.json'), JSON.stringify(summary, null, 2));
    console.info(`[perf] batched draws=${after.stats.drawCalls} unbatched draws=${before.stats.drawCalls}`);

    expect(after.stats.drawCalls).toBeGreaterThan(0);
    expect(before.stats.drawCalls).toBeGreaterThan(after.stats.drawCalls);
  });
});