import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `import.meta.url` keeps this working whether Vite loads the config as ESM or CJS.
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST_FILE = 'assets-manifest.json';
const MANIFEST_MOUNT = '/assets-manifest.json';

/**
 * Vite plugin that keeps the project-root `assets-manifest.json` reachable at
 * runtime.
 *
 * The manifest lives at the repository root (per PROMPT.md §7.6 / §13) rather
 * than inside `public/`, so Vite would otherwise neither serve it in dev nor
 * copy it into `dist/`. This plugin closes that gap without forcing the asset
 * pipeline team to duplicate the file:
 *  - dev: serves the root file through a dev-server middleware (404 → the
 *    loader tolerates the miss and falls back to "waiting for assets" mode).
 *  - build: emits the root file into the output directory.
 */
function rootManifestPlugin(): Plugin {
  return {
    name: 'lianqiu-lake:root-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== MANIFEST_MOUNT) {
          next();
          return;
        }
        readFile(resolve(PROJECT_ROOT, MANIFEST_FILE), 'utf-8')
          .then((body) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(body);
          })
          .catch(() => {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'assets-manifest.json not found' }));
          });
      });
    },
    async generateBundle() {
      try {
        const body = await readFile(resolve(PROJECT_ROOT, MANIFEST_FILE), 'utf-8');
        this.emitFile({
          type: 'asset',
          fileName: MANIFEST_FILE,
          source: body,
        });
      } catch {
        this.warn(
          `[lianqiu-lake] ${MANIFEST_FILE} not found at project root; the built site will start in "waiting for assets" mode.`,
        );
      }
    },
  };
}

/**
 * Public base path for the deployed site.
 *
 * GitHub Pages project sites are served from `https://<user>.github.io/<repo>/`,
 * NOT from the domain root, so every emitted asset URL must be prefixed with the
 * repository name or the browser will 404 on `/assets/*`.
 *
 * The value is overridable through `VITE_BASE_PATH` so the same build can be
 * pointed at a custom domain (`VITE_BASE_PATH=/`) without touching this file.
 */
const BASE_PATH = process.env.VITE_BASE_PATH || '/liuiqiu-lake-diorama/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [rootManifestPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});