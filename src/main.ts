import { createApp } from './core/createApp';
import { installDioramaBridge, type DioramaAssetLedger } from './core/bridge';
import { loadAssetManifest } from './loaders';
import { createLoadingUi } from './utils/dom';
import { createLogger } from './utils/logger';

const log = createLogger('main');

/**
 * Default-composition margin.
 *
 * An orthographic iso projection of an axis-aligned pedestal is a hexagon, so
 * its bounding box can never be filled by the silhouette alone; a margin below
 * 1 zooms past the four empty corner wedges so the pedestal + lake + districts
 * visually fill the viewport (only the outermost corner slivers crop out).
 * Override for comparisons: `?framing=1.14` restores the old loose framing.
 */
const DEFAULT_FRAMING_MARGIN = 0.8;

function resolveFramingMargin(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get('framing');
    if (raw === null) return DEFAULT_FRAMING_MARGIN;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0.3 && value < 3 ? value : DEFAULT_FRAMING_MARGIN;
  } catch {
    return DEFAULT_FRAMING_MARGIN;
  }
}

const EMPTY_LEDGER: DioramaAssetLedger = {
  loaded: 0,
  failed: 0,
  skipped: 0,
  pending: 0,
  summary: 'assets not loaded yet',
  records: [],
};

/**
 * Boot sequence (PROMPT.md §8.3):
 *  1. initialise the core runtime and mount the pedestal/terrain/lake;
 *  2. load the GLB assets described by `assets-manifest.json`, reporting
 *     progress to the loading overlay;
 *  3. re-fit the camera to the finished sandbox and flip `ready`;
 *  4. hand off to the optional district / railway / UI modules.
 */
async function bootstrap(): Promise<void> {
  const ui = createLoadingUi();
  const container = document.querySelector<HTMLElement>('#scene-container');

  if (!container) {
    const message = 'Boot failed: #scene-container was not found in index.html';
    log.error(message);
    ui.showError(message);
    return;
  }

  ui.setProgress(4);
  ui.setStatus('正在初始化渲染器…');

  try {
    const { app, environment } = await createApp({ container });

    // Expose the bridge as early as possible so automation can attach, then
    // flip `ready` once the scene has settled.
    const bridge = installDioramaBridge(app, EMPTY_LEDGER);

    ui.setProgress(14);
    ui.setStatus('正在构建厚底座、地形与练秋湖水面…');
    // Let the overlay paint the pedestal/lake before the (potentially slower)
    // asset phase begins.
    await nextFrame();
    await nextFrame();

    log.info('environment ready', {
      hasPedestal: Boolean(environment),
      outlineRadius: environment ? Math.round(environment.outline.maxRadius) : 0,
    });

    const result = await loadAssetManifest(app, {
      onProgress: ({ percent, loaded, total, currentUrl }) => {
        ui.setProgress(15 + percent * 0.8);
        ui.setStatus(
          total > 0
            ? `加载模型资产 ${loaded}/${total} · ${shortName(currentUrl)}`
            : '正在读取资产清单…',
        );
      },
    });

    const ledger: DioramaAssetLedger = {
      loaded: result.loaded.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
      pending: result.pending.length,
      summary: result.summary,
      records: result.records,
    };
    bridge.assets = ledger;

    if (result.loaded.length > 0) {
      // Reframe on the finished sandbox and re-aim the sun/shadow frustum.
      // Framing contract: the pedestal + lake + districts should FILL the frame.
      // An orthographic iso projection of an axis-aligned box always leaves four
      // empty corner wedges, so the margin is pulled below 1 (0.9) to zoom past
      // those wedges and crop only the pedestal's outermost corner slivers.
      app.fitToBox(app.computeWorldBounds(), { rehome: true, margin: resolveFramingMargin() });
      app.refreshLighting();
    }

    ui.setProgress(98);
    ui.setStatus(
      result.manifestFound
        ? result.summary
        : '等待建模引擎产出 assets-manifest.json · 当前展示底座与练秋湖',
    );

    // HUD: low-frequency diagnostics for humans and Playwright.
    let hudAccumulator = 0;
    app.registerUpdate(({ delta }) => {
      hudAccumulator += delta;
      if (hudAccumulator < 0.5) return;
      hudAccumulator = 0;
      const stats = app.getStats();
      const assetNote = result.manifestFound
        ? `assets ${ledger.loaded}/${ledger.loaded + ledger.failed + ledger.skipped}`
        : 'assets: waiting';
      ui.setDiagnostics(
        `fps ${stats.fps.toFixed(1)} · draws ${stats.drawCalls} · tris ${stats.triangles.toLocaleString()} · ` +
          `objects ${stats.objects} · ${assetNote}`,
      );
    });
    // The diagnostics HUD stays hidden by default; it is revealed by the UI
    // module only when explicitly requested (`?debug=1` or the `D` key).

    // Let a couple of frames land before declaring readiness.
    await nextFrames(3);
    ui.setProgress(100);
    bridge.ready = true;
    ui.hide();

    log.info('diorama ready', { summary: result.summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('fatal boot error', error);
    if (window.__DIORAMA__) window.__DIORAMA__.error = message;
    ui.showError(`启动失败：${message}`);
    ui.setStatus('启动失败，请查看浏览器控制台。');
  }
}

/** Awaits a single animation frame (falls back to a macrotask in tests). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

async function nextFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await nextFrame();
  }
}

function shortName(url: string): string {
  if (!url) return '';
  const clean = url.split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

void bootstrap();