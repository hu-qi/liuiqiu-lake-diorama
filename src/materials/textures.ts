import {
  CanvasTexture,
  Color,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Rng } from '../utils/random';

/**
 * Procedural canvas textures.
 *
 * The diorama must not depend on external image downloads at boot, so the
 * pedestal, terrain and nameplate textures are generated in-memory from a
 * seeded RNG. They are intentionally low-contrast to match the muted art
 * direction.
 */

interface CanvasHandle {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
}

function canUseCanvas(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Creates an offscreen canvas of the given square size. */
function createCanvas(size: number): CanvasHandle | null {
  if (!canUseCanvas()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

function finalizeTexture(canvas: HTMLCanvasElement, repeat = 1): Texture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Speckled stone texture for the sandstone pedestal top.
 * Returns `null` in non-DOM environments (unit tests) so callers can fall back
 * to a flat colour.
 */
export function createSandstoneTexture(rng: Rng, size = 256): Texture | null {
  const handle = createCanvas(size);
  if (!handle) return null;
  const { canvas, ctx } = handle;

  ctx.fillStyle = '#d9d0bd';
  ctx.fillRect(0, 0, size, size);

  const speckles = Math.floor(size * size * 0.06);
  for (let i = 0; i < speckles; i += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const radius = rng.range(0.4, 1.8);
    const shade = rng.int(0, 2);
    ctx.fillStyle =
      shade === 0
        ? 'rgba(160,148,124,0.35)'
        : shade === 1
          ? 'rgba(255,250,238,0.30)'
          : 'rgba(120,110,92,0.22)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return finalizeTexture(canvas, 6);
}

/** Subtle mottled grass texture for the terrain surface. */
export function createGrassTexture(rng: Rng, size = 256): Texture | null {
  const handle = createCanvas(size);
  if (!handle) return null;
  const { canvas, ctx } = handle;

  ctx.fillStyle = '#8d9a70';
  ctx.fillRect(0, 0, size, size);

  const blades = Math.floor(size * size * 0.025);
  for (let i = 0; i < blades; i += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const length = rng.range(1.5, 4.5);
    ctx.strokeStyle = rng.chance(0.5) ? 'rgba(113,128,90,0.5)' : 'rgba(160,172,132,0.45)';
    ctx.lineWidth = rng.range(0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1, 1), y - length);
    ctx.stroke();
  }

  return finalizeTexture(canvas, 8);
}

/** Stratified rock texture for the geological layers of the pedestal. */
export function createStratifiedTexture(
  rng: Rng,
  baseColor: string,
  size = 256,
): Texture | null {
  const handle = createCanvas(size);
  if (!handle) return null;
  const { canvas, ctx } = handle;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  const strata = 26;
  for (let i = 0; i < strata; i += 1) {
    const y = (i / strata) * size + rng.range(-2, 2);
    // Very light strata lines: strong lines darkened the whole band and made
    // the geological layers indistinguishable from each other.
    ctx.strokeStyle =
      rng.chance(0.5) ? 'rgba(255,255,255,0.10)' : 'rgba(30,30,30,0.06)';
    ctx.lineWidth = rng.range(0.6, 2.0);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + rng.range(-3, 3));
    ctx.stroke();
  }

  return finalizeTexture(canvas, 3);
}

export interface NameplateOptions {
  readonly title?: string;
  readonly subtitle?: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Engraved metal nameplate texture mounted on the front face of the pedestal.
 * Renders a brushed-metal gradient with a light-etched title.
 *
 * The canvas may be a wide banner (e.g. 1000 × 90) to match a low, wide
 * plaque that fits inside the sandstone stratum.
 */
export function createNameplateTexture(options: NameplateOptions = {}): Texture | null {
  const width = options.width ?? 1000;
  const height = options.height ?? 90;
  if (!canUseCanvas()) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#7a6832');
  gradient.addColorStop(0.5, '#6b5a2a');
  gradient.addColorStop(1, '#52451f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Brushed-metal micro-lines.
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#f4ead2';
  for (let y = 0; y < height; y += 2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const inset = Math.max(4, Math.round(height * 0.08));
  ctx.strokeStyle = 'rgba(244,234,210,0.45)';
  ctx.lineWidth = Math.max(2, Math.round(height * 0.04));
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const title = options.title ?? 'HUAWEI LIANQIU LAKE';
  const subtitle = options.subtitle;
  // Light engraving on the dark bronze plate.
  ctx.fillStyle = '#f2e8d0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!subtitle) {
    // Single-line banner: use the full height for one legible line.
    ctx.font = `600 ${Math.round(height * 0.5)}px "PingFang SC", "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(title, width / 2, height * 0.5);
  } else {
    const titleSize = Math.round(height * 0.42);
    const subtitleSize = Math.round(height * 0.26);
    ctx.font = `600 ${titleSize}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(title, width / 2, height * 0.35);
    ctx.font = `400 ${subtitleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(subtitle, width / 2, height * 0.72);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Small helper for callers that only want a solid-colour fallback. */
export function colorFromHex(hex: number): Color {
  return new Color(hex);
}

export type { Texture };