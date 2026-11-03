import { Box3, Group, Vector3 } from 'three';
import type { UpdateCallback, WorldBundle } from '../core/types';
import { createLogger } from '../utils/logger';
import { createPedestal, type PedestalBundle } from './base';
import { createTerrain, type TerrainBundle, type TerrainFlattenAnchor } from './terrain';
import { createLakesideGround, type LakesideBundle } from './lakeside';
import {
  BRIDGES,
  DISTRICTS,
  DISTRICT_ORDER,
  LANDMARKS,
  STATION,
  WATER_BODIES,
} from './layout';

import { createLake, createLakeOutline, type LakeBundle, type LakeOutline } from '../water';

const log = createLogger('scene:environment');

/** The built-in diorama: pedestal + terrain + shoreline + procedural lake. */
export interface EnvironmentBundle extends WorldBundle {
  readonly pedestal: PedestalBundle;
  readonly terrain: TerrainBundle;
  readonly lakeside: LakesideBundle;
  readonly lake: LakeBundle;
  readonly outline: LakeOutline;
  /** Alias kept for readability by interaction code. */
  readonly lakeOutline: LakeOutline;
}

/**
 * Assembles the default composition: the thick pedestal, the landscaped top
 * surface, the lakeside stone apron and the procedurally animated Lianqiu Lake.
 *
 * This is the baseline world mounted by `createApp`; district, bridge, railway
 * and landmark GLBs are layered on top by the integration modules.
 */
export function createEnvironment(): EnvironmentBundle {
  const group = new Group();
  group.name = 'SCENE_ENVIRONMENT';

  const outline = createLakeOutline();
  const anchors = collectTerrainAnchors();

  const pedestal = createPedestal();
  const terrain = createTerrain(outline, anchors);
  const lakeside = createLakesideGround(outline);
  const lake = createLake(outline);

  group.add(pedestal.group, terrain.mesh, lakeside.mesh, lake.group);

  // The lake surface animates every frame; the sun direction is synced on the
  // first frame from the app's directional light so the specular highlight is
  // physically consistent with the shadow direction.
  let sunSynced = false;
  const update: UpdateCallback = (context) => {
    lake.update(context);
    if (!sunSynced) {
      const sun = context.app.lighting.sun;
      const direction = new Vector3()
        .copy(sun.position)
        .sub(sun.target.position)
        .normalize();
      lake.setSunDirection(direction);
      sunSynced = true;
    }
  };

  const prepareFrame: NonNullable<WorldBundle['prepareFrame']> = (renderer, scene, camera) => {
    lake.renderReflection(renderer, scene, camera);
  };

  const bounds = new Box3().copy(pedestal.bounds);
  bounds.expandByScalar(2);

  const dispose = (): void => {
    pedestal.dispose();
    terrain.dispose();
    lakeside.dispose();
    lake.dispose();
    log.debug('environment disposed');
  };

  log.info('environment built', {
    lakeRadius: [outline.minRadius, outline.maxRadius].map((v) => Math.round(v)),
    terrainAnchors: anchors.length,
    bounds: bounds.getSize(new Vector3()).toArray(),
  });

  return {
    group,
    bounds,
    update,
    prepareFrame,
    dispose,
    pedestal,
    terrain,
    lakeside,
    lake,
    outline,
    lakeOutline: outline,
  };
}

/**
 * World-space XZ points the terrain must stay flat around.
 *
 * Buildings are grounded on `y = 0` by `resolvePlacement`, so any undulation
 * beneath a footprint (or within a few metres of its wall) would expose a gap.
 * Districts dominate the list; bridges / the station / the capsule landmark are
 * added too so their approach ramps stay flat.
 */
function collectTerrainAnchors(): TerrainFlattenAnchor[] {
  const anchors: TerrainFlattenAnchor[] = [];

  for (const id of DISTRICT_ORDER) {
    const [x, z] = DISTRICTS[id].placement.center;
    anchors.push({ x, z });
  }
  for (const bridge of Object.values(BRIDGES)) {
    const [x, z] = bridge.placement.center;
    anchors.push({ x, z });
  }
  for (const landmark of Object.values(LANDMARKS)) {
    const [x, z] = landmark.placement.center;
    anchors.push({ x, z });
  }
  const [sx, sz] = STATION.placement.center;
  anchors.push({ x: sx, z: sz });

  // Water channels carve through the flat band between the lake and a district:
  // keep their banks flat so the ribbon never floats above rising grass.
  for (const channel of WATER_BODIES) {
    const mid = channel.outline[Math.floor(channel.outline.length / 2)];
    anchors.push({ x: mid[0], z: mid[1] });
  }

  return anchors;
}

/** Re-export so callers can inject extra anchors (tests / future assets). */
export type { TerrainFlattenAnchor };