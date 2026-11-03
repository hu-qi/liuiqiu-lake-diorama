import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Object3D,
  type Texture,
} from 'three';
import { PALETTE } from '../materials/palette';
import {
  createNameplateTexture,
  createSandstoneTexture,
  createStratifiedTexture,
} from '../materials/textures';
import { disposeObjectTree } from '../materials/standard';
import { createRng } from '../utils/random';
import { BASE_LAYERS, NAMEPLATE_SPEC, SCENE_OBJECT_NAMES, WORLD_GEOMETRY } from './constants';

export interface PedestalBundle {
  readonly group: Group;
  readonly bounds: Box3;
  readonly nameplate: Object3D | null;
  readonly materials: readonly MeshStandardMaterial[];
  readonly dispose: () => void;
}

/**
 * Builds the thick architectural-model pedestal (PROMPT.md §8.2).
 *
 * Structure, top → bottom, all centred on the origin:
 *   - light sandstone cap   (the visible top rim; the terrain sits inset on it)
 *   - green + grey geological band with a slight inset (reads as a cut-through)
 *   - deep grey base
 *
 * A brushed-metal nameplate is mounted on the +Z (front) face.
 */
export function createPedestal(): PedestalBundle {
  const group = new Group();
  group.name = SCENE_OBJECT_NAMES.PEDESTAL;

  const rng = createRng(4_707);
  const layers: Mesh[] = [];
  const materials: MeshStandardMaterial[] = [];
  const textures: Texture[] = [];

  let runningTop = WORLD_GEOMETRY.BASE_TOP_Y;

  for (const spec of BASE_LAYERS) {
    const width = WORLD_GEOMETRY.BASE_LENGTH - spec.inset * 2;
    const depth = WORLD_GEOMETRY.BASE_WIDTH - spec.inset * 2;
    const height = spec.height;
    const centerY = runningTop - height / 2;

    const texture = resolveLayerTexture(spec.texture, rng);
    if (texture) textures.push(texture);

    const material = new MeshStandardMaterial({
      name: `${spec.name}_MAT`,
      // A colour map already carries the stratum tint; keep the base white so
      // it is not multiplied down twice.
      color: texture ? 0xffffff : spec.color,
      roughness: spec.texture === 'sandstone' ? 0.92 : 0.86,
      metalness: 0.02,
      map: texture ?? undefined,
    });
    materials.push(material);

    const geometry = new BoxGeometry(width, height, depth);
    const mesh = new Mesh(geometry, material);
    mesh.name = spec.name;
    mesh.position.set(0, centerY, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    layers.push(mesh);

    runningTop -= height;
  }

  const nameplate = createNameplate();
  if (nameplate) {
    group.add(nameplate);

  }

  const bounds = new Box3(
    new Vector3(
      -WORLD_GEOMETRY.BASE_LENGTH / 2,
      WORLD_GEOMETRY.BASE_BOTTOM_Y,
      -WORLD_GEOMETRY.BASE_WIDTH / 2,
    ),
    new Vector3(
      WORLD_GEOMETRY.BASE_LENGTH / 2,
      WORLD_GEOMETRY.BASE_TOP_Y,
      WORLD_GEOMETRY.BASE_WIDTH / 2,
    ),
  );

  const dispose = (): void => {
    for (const mesh of layers) {
      mesh.geometry.dispose();
    }
    for (const material of materials) {
      material.dispose();
    }
    for (const texture of textures) {
      texture.dispose();
    }
    if (nameplate) disposeObjectTree(nameplate);
  };

  return { group, bounds, nameplate, materials, dispose };
}

function resolveLayerTexture(
  kind: 'sandstone' | 'green' | 'grey' | null,
  rng: ReturnType<typeof createRng>,
): Texture | null {
  if (kind === 'sandstone') return createSandstoneTexture(rng);
  if (kind === 'green') return createStratifiedTexture(rng, '#8b966f');
  if (kind === 'grey') return createStratifiedTexture(rng, '#a3a9a4');
  return null;
}

/**
 * Front-face metal nameplate. Returns `null` in non-DOM environments where the
 * canvas texture cannot be generated.
 *
 * The plaque is deliberately low and wide so it fits inside the 3.6 m sandstone
 * stratum and reads as an engraved plate rather than a free-standing panel.
 */
function createNameplate(): Object3D | null {
  const texture = createNameplateTexture({
    title: 'HUAWEI LIANQIU LAKE · 练秋湖研发中心',
    width: 1840,
    height: 68,
  });
  if (!texture) return null;

  const plateWidth = NAMEPLATE_SPEC.width;
  const plateHeight = NAMEPLATE_SPEC.height;
  const frontZ = WORLD_GEOMETRY.BASE_WIDTH / 2;

  const material = new MeshStandardMaterial({
    name: 'BASE_NAMEPLATE_MAT',
    // The canvas texture carries the full dark-bronze plate + light engraved
    // lettering, so the base tint stays white.
    color: 0xffffff,
    map: texture,
    roughness: 0.45,
    metalness: 0.5,
  });

  const geometry = new PlaneGeometry(plateWidth, plateHeight);
  const plate = new Mesh(geometry, material);
  plate.name = SCENE_OBJECT_NAMES.NAMEPLATE;
  plate.position.set(0, NAMEPLATE_SPEC.y, frontZ + 0.16);
  plate.castShadow = false;
  plate.receiveShadow = false;

  // Dark bronze frame, mostly embedded in the sandstone face, so the plaque
  // reads as a mounted metal plate with clear contrast against the stone.
  // Depth is kept shallow and its front face sits *behind* the plate — if the
  // frame protrudes further it occludes the plaque entirely (caught during
  // visual verification).
  const backingGeometry = new BoxGeometry(plateWidth + 3.4, NAMEPLATE_SPEC.height + 0.6, 0.3);
  const backingMaterial = new MeshStandardMaterial({
    name: 'BASE_NAMEPLATE_BACKING_MAT',
    color: PALETTE.NAMEPLATE_FRAME,
    roughness: 0.5,
    metalness: 0.4,
  });
  const backing = new Mesh(backingGeometry, backingMaterial);
  backing.position.set(0, NAMEPLATE_SPEC.y, frontZ - 0.02);
  backing.castShadow = true;
  backing.receiveShadow = false;

  const holder = new Group();
  holder.name = 'BASE_NAMEPLATE_GROUP';
  holder.add(backing, plate);
  return holder;
}