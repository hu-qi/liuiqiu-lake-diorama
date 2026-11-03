import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { PALETTE } from '../materials/palette';
import { RENDER_CONSTANTS } from './constants';
import { createLogger } from '../utils/logger';

const log = createLogger('core:renderer');

/**
 * Creates and configures the WebGLRenderer.
 *
 * Configuration follows PROMPT.md §8.1:
 *  - WebGLRenderer + antialias
 *  - ACES filmic tone mapping
 *  - sRGB output colour space
 *  - soft PCF shadow maps
 *  - device pixel ratio capped for predictable fill-rate cost
 */
export function createRenderer(container: HTMLElement): WebGLRenderer {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      // Keeps the drawing buffer readable so Playwright/`toDataURL` screenshots
      // capture a fully composited frame.
      preserveDrawingBuffer: true,
    });
  } catch (error) {
    log.error('Failed to create WebGLRenderer (WebGL unavailable?)', error);
    throw new Error(
      'WebGL is not available in this browser/environment; the diorama cannot initialise.',
    );
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER_CONSTANTS.MAX_PIXEL_RATIO));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER_CONSTANTS.TONE_MAPPING_EXPOSURE;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setClearColor(PALETTE.SCENE_BACKGROUND, 1);
  renderer.autoClear = true;

  renderer.domElement.setAttribute('aria-label', '练秋湖数字沙盘画布');
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  return renderer;
}

/** Reads the container's CSS pixel size, falling back to the window. */
export function readElementSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : window.innerWidth;
  const height = rect.height > 0 ? rect.height : window.innerHeight;
  return { width, height };
}