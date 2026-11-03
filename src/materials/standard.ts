import {
  MeshStandardMaterial,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';

/** Options accepted by {@link createStandardMaterial}. */
export interface StandardMaterialOptions {
  readonly color: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly map?: Texture | null;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly flatShading?: boolean;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly name?: string;
}

/**
 * Creates a glTF-compatible PBR material with the diorama's muted defaults.
 * Prefer this factory over `new MeshStandardMaterial(...)` so roughness and
 * metalness stay consistent across the scene (PROMPT.md §9.1).
 */
export function createStandardMaterial(options: StandardMaterialOptions): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: options.color,
    roughness: options.roughness ?? 0.85,
    metalness: options.metalness ?? 0.04,
    flatShading: options.flatShading ?? false,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
  });

  if (options.map) {
    material.map = options.map;
    material.needsUpdate = true;
  }
  if (options.emissive !== undefined) {
    material.emissive.setHex(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  if (options.name) {
    material.name = options.name;
  }
  return material;
}

/** Sets shadow flags across an object subtree (used for GLB assets). */
export function applyShadowFlags(
  object: Object3D,
  castShadow: boolean,
  receiveShadow: boolean,
): void {
  object.traverse((child) => {
    if ((child as Mesh).isMesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });
}

/** Ensures `frustumCulled` follows a sane default for static sandbox content. */
export function configureStaticMeshes(object: Object3D): void {
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    // Static diorama meshes never move, so per-mesh frustum culling is safe
    // and keeps off-screen content out of the draw list (PROMPT.md §10).
    mesh.frustumCulled = true;
  });
}

/**
 * Disposes the geometries, materials and textures of an object subtree.
 * Textures are disposed explicitly because `material.dispose()` never frees
 * the textures it references.
 */
export function disposeObjectTree(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
    }
  });

  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      disposeMaterial(material);
    }
  });
}

/** Disposes a single material together with any textures it owns. */
export function disposeMaterial(material: Material): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (isTextureLike(value)) value.dispose();
  }
  material.dispose();
}

function isTextureLike(value: unknown): value is Texture {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isTexture?: boolean }).isTexture === true &&
    typeof (value as { dispose?: unknown }).dispose === 'function'
  );
}