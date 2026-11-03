import { App } from './app';
import { createEnvironment, type EnvironmentBundle } from '../scene/environment';
import { createLogger } from '../utils/logger';
import { Vector3 } from 'three';
import type { DioramaModule, WorldBundle } from './types';

const log = createLogger('core:createApp');

/**
 * Optional integration points. `import.meta.glob` returns `{}` when no file
 * matches, so the base diorama boots standalone even while `src/districts`,
 * `src/railway`, `src/interactions` and `src/ui` are still being built by the
 * integration team. Each matched module may export `install(app)`.
 */
const OPTIONAL_MODULES: Record<string, () => Promise<unknown>> = import.meta.glob([
  '../districts/index.ts',
  '../railway/index.ts',
  '../interactions/index.ts',
  '../ui/index.ts',
]);

export interface CreateAppOptions {
  /** DOM element the canvas is appended to. */
  readonly container: HTMLElement;
  /** Mount the built-in pedestal + terrain + lake. Defaults to true. */
  readonly includeDefaultWorld?: boolean;
  /** Probe the optional district/railway/interaction/UI modules. Defaults to true. */
  readonly includeOptionalModules?: boolean;
  /** Start the render loop immediately. Defaults to true. */
  readonly autoStart?: boolean;
}

export interface CreateAppResult {
  readonly app: App;
  readonly environment: EnvironmentBundle | null;
  /** Names of optional modules that were installed during boot. */
  readonly installedModules: string[];
}

/**
 * Composition root: builds the core runtime, mounts the default environment,
 * fits the camera, installs any optional modules, then starts the loop.
 *
 * Mirrors the PROMPT.md §8 contract: `createApp(container)` → an `App` object
 * carrying `scene / renderer / camera / controls / clock / start / dispose`.
 */
export async function createApp(options: CreateAppOptions): Promise<CreateAppResult> {
  const { container } = options;
  if (!container) {
    throw new Error('createApp: a container element is required');
  }

  const app = new App(container);

  let environment: EnvironmentBundle | null = null;
  if (options.includeDefaultWorld !== false) {
    environment = createEnvironment();
    app.mountWorld(environment);
  }

  // Fit the camera to the default composition so the whole pedestal is visible
  // from the very first frame (PROMPT.md §8.4 / §16).
  app.fitToBox(environment ? environment.bounds : undefined);

  const installedModules =
    options.includeOptionalModules === false ? [] : await installOptionalModules(app);

  app.refreshLighting();

  if (options.autoStart !== false) {
    app.start();
  }

  log.info('createApp ready', {
    installedModules,
    bounds: environment ? environment.bounds.getSize(new Vector3()).toArray() : null,
  });

  return { app, environment, installedModules };
}

async function installOptionalModules(app: App): Promise<string[]> {
  const installed: string[] = [];

  for (const [path, loader] of Object.entries(OPTIONAL_MODULES)) {
    try {
      const loaded = (await loader()) as DioramaModule;
      if (typeof loaded?.install !== 'function') continue;
      await loaded.install(app);
      installed.push(loaded.name ?? path);
      log.info(`installed optional module: ${loaded.name ?? path}`);
    } catch (error) {
      // A broken integration module must never take down the base diorama.
      log.error(`failed to install optional module ${path}`, error);
    }
  }

  return installed;
}

/** Type guard used by integration modules when mounting extra world bundles. */
export function isWorldBundle(value: unknown): value is WorldBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'group' in value &&
    'bounds' in value &&
    typeof (value as { group?: { isObject3D?: boolean } }).group?.isObject3D === 'boolean'
  );
}