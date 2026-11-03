/**
 * 组团装饰：实例化森林、道路网、水道支流。
 *
 * 视觉目标（用户偏好：重视美术质量）：
 *  - 树木由 manifest 资产 `ENV_TREE_CLUSTER`（5 类树）派生原型，
 *    用 `InstancedMesh` 批量散布，并做**随机缩放 / 旋转 / 叶色扰动**，
 *    避免出现"完全一致的绿球"。
 *  - 只保留 5 个 draw call（按材质），而不是数百个独立网格。
 */

import {
  Box3,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { PALETTE } from '../materials/palette';
import { createRng, hashSeed } from '../utils/random';
import { clamp } from '../utils/math';
import { createLogger } from '../utils/logger';
import { isInsideLake, type LakeOutline } from '../water';
import { RAILWAY, ROADS } from '../scene/layout';
import { createTerrainRibbon } from '../scene/ribbon';
import { mergeByMaterial } from './geometry';

const log = createLogger('districts:decor');

/** Attempts per grid cell before a scatter point is abandoned. */
const TREE_SCATTER_RETRIES = 4;

/**
 * Forest scatter tuning.
 *
 * Every instance gets its own scale, height stretch, yaw and leaf hue so a
 * 150-instance field never reads as one copied tree. Ranges are wide enough to
 * be visible from the default camera, narrow enough to stay plausible.
 */
export interface ForestOptions {
  /** Cluster instance count (each cluster prototype holds 5 trees). */
  readonly count: number;
  /** Deterministic seed — the same forest on every reload. */
  readonly seed: number;
  /** Planar scale range per instance. */
  readonly scaleRange: readonly [number, number];
  /** Vertical stretch range, relative to the planar scale. */
  readonly heightRange: readonly [number, number];
  /** Hue offset range (radians, HSL hue 0–1) applied to foliage instances. */
  readonly hueJitter: readonly [number, number];
  /** Saturation range for foliage tinting. */
  readonly satRange: readonly [number, number];
  /** Lightness range for foliage tinting. */
  readonly lightRange: readonly [number, number];
  /**
   * Scatter jitter as a fraction of the mean grid cell. 0 = regular grid,
   * 1 = positions may move by a full cell (breaks every row/column alignment).
   */
  readonly gridJitter: number;
  /** Mean spacing between clusters when the scatter grid is built (metres). */
  readonly spacing: number;
  /** Probability that a grid cell is skipped, opening lawns and clearings. */
  readonly skipChance: number;
}

export const DEFAULT_FOREST_OPTIONS: ForestOptions = {
  count: 220,
  seed: 90210,
  // The default camera fits the whole 260 x 170 pedestal, so a ~6 m
  // prototype must be scaled up to read as a tree at overview distance.
  // The wide 1 : 1.55 planar to height ratio keeps the size spread obvious.
  scaleRange: [0.46, 0.82],
  heightRange: [0.7, 1.62],
  // Wide enough to spread the canopy across yellow-green → blue-green →
  // deep green instead of clustering into one repeated swatch.
  hueJitter: [-0.085, 0.075],
  satRange: [0.18, 0.52],
  lightRange: [0.3, 0.64],
  gridJitter: 0.85,
  spacing: 8,
  skipChance: 0.06,
};

export interface ForestResult {
  readonly group: Group;
  readonly instances: number;
  /** Prototype geometry count (= draw calls). */
  readonly drawCalls: number;
  readonly dispose: () => void;
}

/**
 * Builds the instanced forest from the `ENV_TREE_CLUSTER` prototype.
 *
 * The GLB holds 5 different trees in a row. After merging by material each
 * material becomes one `InstancedMesh` and the whole cluster is scattered as a
 * single instance — a handful of draw calls for ~150 trees.
 *
 * Randomisation per instance:
 *  - planar scale ∈ `scaleRange`, vertical stretch ∈ `heightRange`;
 *  - full 0–2π yaw;
 *  - foliage hue / saturation / lightness jitter (`instanceColor`);
 *  - grid jitter + random cell skipping, so the scatter has no rows.
 *
 * `sampleHeight` grounds every instance on the undulating terrain and tilts it
 * slightly toward the local slope so trunk bases never float.
 */
export function buildInstancedForest(
  clusterRoot: Object3D,
  outline: LakeOutline,
  obstacles: readonly Box3[],
  sampleHeight: (x: number, z: number) => number,
  options: ForestOptions = DEFAULT_FOREST_OPTIONS,
): ForestResult | null {
  // 1) Merge the cluster by material: one prototype geometry per material.
  const stats = mergeByMaterial(clusterRoot);
  if (stats.meshesAfter === 0) return null;

  // 2) Normalise each prototype to a local bbox whose base sits at y = 0.
  const meshes: Mesh[] = [];
  clusterRoot.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });
  const bounds = new Box3();
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox);
  }
  const center = bounds.getCenter(new Vector3());
  for (const mesh of meshes) {
    mesh.geometry.translate(-center.x, -bounds.min.y, -center.z);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }

  // 3) Deterministic scatter.
  const rng = createRng(options.seed);
  const positions = scatterPositions(rng, outline, obstacles, sampleHeight, options);
  if (positions.length === 0) return null;

  const group = new Group();
  group.name = 'DISTRICT_FOREST';

  const matrix = new Matrix4();
  const tint = new Color();

  const tiltAxis = new Vector3();
  const tiltQuat = new Quaternion();
  let drawCalls = 0;

  for (const mesh of meshes) {
    const material = mesh.material as MeshStandardMaterial;
    // Foliage materials accept per-instance tinting; bark keeps its own colour.
    const foliage = /FOLIAGE|BLOSSOM/i.test(material.name ?? '');
    const instance = new InstancedMesh(mesh.geometry, material, positions.length);
    instance.name = `env-tree-${(material.name ?? 'MAT').toLowerCase()}`;
    instance.castShadow = true;
    instance.receiveShadow = true;
    instance.frustumCulled = true;

    for (let i = 0; i < positions.length; i += 1) {
      const row = positions[i];
      // Small lean opposite the uphill direction so trunks do not sink into
      // the slope on one side.
      tiltAxis.set(row.tiltZ, 0, -row.tiltX);
      const tiltLength = tiltAxis.length();
      if (tiltLength > 1e-6) {
        tiltAxis.multiplyScalar(1 / tiltLength);
        tiltQuat.setFromAxisAngle(tiltAxis, Math.min(row.tiltAngle, 0.09));
      } else {
        tiltQuat.identity();
      }
      const yawQuat = new Quaternion().setFromEuler(new Euler(0, row.rotY, 0));
      matrix.compose(
        new Vector3(row.x, row.y, row.z),
        yawQuat.multiply(tiltQuat),
        new Vector3(row.scaleXZ, row.scaleY, row.scaleXZ),
      );
      instance.setMatrixAt(i, matrix);
      if (foliage) {
        tint.setHSL(row.hue, row.saturation, row.lightness);
        instance.setColorAt(i, tint);
      }
    }
    instance.instanceMatrix.needsUpdate = true;
    if (instance.instanceColor) instance.instanceColor.needsUpdate = true;
    instance.computeBoundingSphere();
    group.add(instance);
    drawCalls += 1;
  }

  // The prototype meshes are now instanced: detach them from the loaded cluster
  // but keep the cluster node itself so `getObjectByName` still resolves.
  for (const mesh of meshes) mesh.removeFromParent();
  clusterRoot.visible = false;
  clusterRoot.updateMatrixWorld(true);

  const dispose = (): void => {
    for (const child of group.children) {
      (child as InstancedMesh).geometry.dispose();
    }
    group.removeFromParent();
  };

  log.info(
    `instanced forest: ${positions.length} clusters × ${meshes.length} materials → ${drawCalls} draw calls ` +
      `(replaces ${stats.meshesBefore} meshes)`,
  );

  return { group, instances: positions.length, drawCalls, dispose };
}

interface ScatterRow {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scaleXZ: number;
  readonly scaleY: number;
  readonly rotY: number;
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
  /** Local slope direction (uphill) used for the lean tilt. */
  readonly tiltX: number;
  readonly tiltZ: number;
  readonly tiltAngle: number;
}

/**
 * Samples cluster positions on a jittered grid — never a uniform random field.
 *
 * A jittered grid gives natural-looking clumping (some cells skipped → open
 * lawns, some packed → groves) while still guaranteeing coverage; pure uniform
 * sampling looked like noise and, worse, left visible gaps in the grove.
 */
function scatterPositions(
  rng: ReturnType<typeof createRng>,
  outline: LakeOutline,
  obstacles: readonly Box3[],
  sampleHeight: (x: number, z: number) => number,
  options: ForestOptions,
): ScatterRow[] {
  const result: ScatterRow[] = [];
  const halfX = 126;
  const halfZ = 82;
  const railPoints = RAILWAY.controlPoints.map(([x, , z]) => [x, z] as const);
  const spacing = Math.max(3, options.spacing);
  const jitter = clamp(options.gridJitter, 0, 1);

  const cols = Math.ceil((halfX * 2) / spacing);
  const rows = Math.ceil((halfZ * 2) / spacing);
  const steps = Math.max(1, options.count);

  // Density ramp: thin out toward the outer ring so the grove has a natural
  // edge instead of a hard band against the plinth.
  for (let row = 0; row < rows && result.length < steps; row += 1) {
    for (let col = 0; col < cols && result.length < steps; col += 1) {
      const cellX = -halfX + (col + 0.5) * spacing;
      const cellZ = -halfZ + (row + 0.5) * spacing;
      if (rng.chance(options.skipChance)) continue;

      // Rejection sampling: a jittered point can land inside a road, a track or
      // a building. Retrying a few times keeps the grove dense instead of
      // silently dropping whole cells next to the busy parts of the park.
      let x = 0;
      let z = 0;
      let accepted = false;
      for (let attempt = 0; attempt < TREE_SCATTER_RETRIES; attempt += 1) {
        // Shrink the jitter on each retry so the last attempt stays in the cell.
        const shrink = 1 / (attempt + 1);
        x = cellX + rng.range(-0.5, 0.5) * spacing * jitter * shrink;
        z = cellZ + rng.range(-0.5, 0.5) * spacing * jitter * shrink;
        if (isInsideLake(outline, x, z, -3.5)) continue;
        if (tooCloseToPolyline(x, z, railPoints, 4)) continue;
        if (tooCloseToRoads(x, z, 3)) continue;
        if (insideAnyObstacle(x, z, obstacles, 2)) continue;
        accepted = true;
        break;
      }
      if (!accepted) continue;

      const distanceFromCentre = Math.hypot(x, z);
      if (distanceFromCentre > halfX * 0.92 && rng.chance(0.55)) continue;

      const scaleXZ = rng.range(options.scaleRange[0], options.scaleRange[1]);
      const scaleY = scaleXZ * rng.range(options.heightRange[0], options.heightRange[1]);
      const rotY = rng.range(0, Math.PI * 2);
      const hue = 0.245 + rng.range(options.hueJitter[0], options.hueJitter[1]);
      const saturation = clamp(rng.range(options.satRange[0], options.satRange[1]), 0, 1);
      const lightness = clamp(rng.range(options.lightRange[0], options.lightRange[1]), 0, 1);

      const y = sampleHeight(x, z);
      const epsilon = 1.2;
      const gradX = (sampleHeight(x + epsilon, z) - sampleHeight(x - epsilon, z)) / (2 * epsilon);
      const gradZ = (sampleHeight(x, z + epsilon) - sampleHeight(x, z - epsilon)) / (2 * epsilon);
      const slope = Math.hypot(gradX, gradZ);

      result.push({
        x,
        y,
        z,
        scaleXZ,
        scaleY,
        rotY,
        hue,
        saturation,
        lightness,
        tiltX: gradX,
        tiltZ: gradZ,
        tiltAngle: Math.atan(slope) * 0.6,
      });
    }
  }

  // Interleave the grid order so the first `count` samples are not all in the
  // north-west corner (the renderer draws them all, but this keeps a smaller
  // `count` from producing a lopsided forest).
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }

  return result;
}

function insideAnyObstacle(x: number, z: number, obstacles: readonly Box3[], margin: number): boolean {
  for (const box of obstacles) {
    if (
      x >= box.min.x - margin &&
      x <= box.max.x + margin &&
      z >= box.min.z - margin &&
      z <= box.max.z + margin
    ) {
      return true;
    }
  }
  return false;
}

function tooCloseToPolyline(
  x: number,
  z: number,
  points: ReadonlyArray<readonly [number, number]>,
  distance: number,
): boolean {
  for (const [px, pz] of points) {
    if (Math.hypot(px - x, pz - z) < distance) return true;
  }
  return false;
}

function tooCloseToRoads(x: number, z: number, distance: number): boolean {
  for (const road of ROADS) {
    if (tooCloseToPolyline(x, z, road.points, distance + road.widthM / 2)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 道路网 / 水道
// ---------------------------------------------------------------------------

/** Height sampler for perched scenery: world Y of the terrain at (x, z). */
export type GroundSampler = (x: number, z: number) => number;

/**
 * Material separation for the road network.
 *
 * The asphalt is deliberately much darker and rougher than the grass and the
 * paving, so the road ring reads as a distinct surface even in a flat-lit
 * orthographic view. Kerbs stay light stone and glossy, giving a crisp edge
 * against both sides.
 */
const ROAD_MATERIALS = {
  asphalt: { color: 0x3f3e3b, roughness: 0.85, metalness: 0.06 },
  kerb: { color: PALETTE.BASE_CAP_HIGHLIGHT, roughness: 0.7, metalness: 0.05 },
} as const;

/** Ring road + outer loop + 8 radial spurs, draped over the terrain. */
export function buildRoadNetwork(sampleHeight: GroundSampler = () => 0): Group {
  const group = new Group();
  group.name = 'DISTRICT_ROADS';

  const asphalt = new MeshStandardMaterial({
    name: 'ROAD_ASPHALT',
    color: ROAD_MATERIALS.asphalt.color,
    roughness: ROAD_MATERIALS.asphalt.roughness,
    metalness: ROAD_MATERIALS.asphalt.metalness,
  });
  const kerb = new MeshStandardMaterial({
    name: 'ROAD_KERB',
    color: ROAD_MATERIALS.kerb.color,
    roughness: ROAD_MATERIALS.kerb.roughness,
    metalness: ROAD_MATERIALS.kerb.metalness,
  });

  for (const road of ROADS) {
    // Kerb first (wider, lower): the asphalt then covers its inner half and
    // the visible sliver forms a crisp shoulder on both sides.
    const kerbWidth = road.widthM + 1.1;
    const border = new Mesh(
      createTerrainRibbon(road.points, kerbWidth, ROAD_SPEC.kerbLift, sampleHeight, road.closed),
      kerb,
    );
    border.name = `${road.name}_KERB`;
    border.receiveShadow = true;
    group.add(border);

    const surface = new Mesh(
      createTerrainRibbon(road.points, road.widthM, ROAD_SPEC.surfaceLift, sampleHeight, road.closed),
      asphalt,
    );
    surface.name = road.name;
    surface.receiveShadow = true;
    group.add(surface);
  }

  return group;
}

/** Vertical offsets that keep the road above the grass without z-fighting. */
const ROAD_SPEC = {
  surfaceLift: 0.09,
  kerbLift: 0.055,
} as const;

/**
 * Water channels from the lake toward district B / F / A.
 *
 * Channels follow the terrain, so their banks are pre-flattened by the terrain
 * anchor list (`environment.ts`). The material is glossier and reveals a hint
 * of the shore bed through `opacity` — a clear material step from both the lake
 * (mirror-like) and the pavement (rough).
 */
export function buildWaterChannels(
  outlines: ReadonlyArray<{ name: string; outline: ReadonlyArray<readonly [number, number]> }>,
  sampleHeight: GroundSampler = () => 0,
): Group {
  const group = new Group();
  group.name = 'DISTRICT_WATER_CHANNELS';

  const water = new MeshStandardMaterial({
    name: 'CHANNEL_WATER',
    color: PALETTE.WATER_SHALLOW,
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: 0.9,
  });

  for (const channel of outlines) {
    const surface = new Mesh(
      createTerrainRibbon(channel.outline, 7, 0.1, sampleHeight, false),
      water,
    );
    surface.name = channel.name;
    surface.receiveShadow = true;
    group.add(surface);
  }

  return group;
}

/** Builds forest options seeded from a region name (deterministic variant). */
export function forestOptionsFor(region: string, count: number): ForestOptions {
  return { ...DEFAULT_FOREST_OPTIONS, count, seed: hashSeed(region) };
}
