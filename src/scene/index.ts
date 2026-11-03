export {
  BASE_LAYERS,
  LAKE_SPEC,
  LAKESIDE_SPEC,
  NAMEPLATE_SPEC,
  SCENE_OBJECT_NAMES,
  TERRAIN_SPEC,
  WORLD_GEOMETRY,
  type BaseLayerSpec,
} from './constants';
export { createPedestal, type PedestalBundle } from './base';
export { createTerrain, type TerrainBundle } from './terrain';
export { createLakesideGround, type LakesideBundle } from './lakeside';
export { createEnvironment, type EnvironmentBundle } from './environment';