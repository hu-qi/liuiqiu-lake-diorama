import {
  Color,
  FrontSide,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type BufferAttribute,
  type BufferGeometry,
  type IUniform,
  type OrthographicCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../materials/palette';
import { LAKE_SPEC, SCENE_OBJECT_NAMES, WATER_SPEC } from '../scene/constants';
import type { UpdateCallback } from '../core/types';
import { createLakeSurfaceGeometry } from './geometry';
import { createLakeOutline, type LakeOutline } from './outline';

/**
 * Lianqiu Lake surface.
 *
 * Three ingredients make the water read as water rather than a tinted plane:
 *
 *  1. **Fresnel** — grazing views blend toward the sky tint / mirrored scene,
 *     straight-down views keep the deep body colour.
 *  2. **Depth gradient** — a per-vertex `depthFactor` bakes the shoreline →
 *     centre gradient (bright shallow green → dark blue-green) into the mesh.
 *  3. **Ripples** — low-amplitude wave trains displace the surface
 *     (≤ `WATER_SPEC.rippleAmplitude`, hard ceiling 0.06 m) and derive a normal
 *     that both shades the body and distorts the mirrored reflection.
 *
 * The reflection is a *planar mirror*: one extra scene render per frame from a
 * camera mirrored across the water plane. It is a single bounded pass — never
 * a per-object CubeCamera probe.
 */

const WATER_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uRippleAmplitude;
uniform float uRippleScale;
uniform mat4 uTextureMatrix;

attribute float depthFactor;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec4 vMirrorCoord;
varying float vDepthFactor;

float waveHeight(vec2 p, float t) {
  float s = uRippleScale;
  float h = 0.0;
  // Long, mutually incommensurate waves: short wavelengths interfered into a
  // regular plaid pattern during visual verification.
  h += sin(p.x * 0.052 * s + t * 0.62) * 0.55;
  h += sin(p.y * 0.071 * s - t * 0.51) * 0.38;
  h += sin((p.x * 0.033 + p.y * 0.047) * s + t * 0.88) * 0.24;
  // Gentle domain warp removes any residual lattice alignment.
  h += sin(p.x * 0.019 * s - p.y * 0.026 * s + t * 1.15) * 0.14;
  return h;
}

void main() {
  vDepthFactor = depthFactor;

  vec4 world = modelMatrix * vec4(position, 1.0);
  float t = uTime;

  float h = waveHeight(world.xz, t);
  world.y += h * uRippleAmplitude;
  vWorldPosition = world.xyz;

  // Finite-difference normal (object rotation is identity, so world == local).
  float e = 1.4;
  float hx = waveHeight(world.xz + vec2(e, 0.0), t);
  float hz = waveHeight(world.xz + vec2(0.0, e), t);
  vec3 tangentX = vec3(e, (hx - h) * uRippleAmplitude, 0.0);
  vec3 tangentZ = vec3(0.0, (hz - h) * uRippleAmplitude, e);
  vec3 n = normalize(cross(tangentZ, tangentX));
  if (n.y < 0.0) n = -n;
  vWorldNormal = n;

  vMirrorCoord = uTextureMatrix * world;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform sampler2D uMirrorSampler;
uniform float uTime;
uniform float uFresnelPower;
uniform float uReflectionStrength;
uniform float uDistortion;
uniform float uNormalScale;
uniform float uGlitterPower;
uniform float uGlitterStrength;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec4 vMirrorCoord;
varying float vDepthFactor;

/** Cheap multi-sine ripple field used to wobble the mirrored reflection. */
float rippleField(vec2 p, float t) {
  return
    sin(p.x * 1.7 + t * 0.38) * 0.5 +
    sin(p.y * 2.1 - t * 0.29) * 0.35 +
    sin((p.x + p.y) * 1.3 + t * 0.22) * 0.15;
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPosition);

  // Fresnel: reflection dominates at grazing angles, body colour head-on.
  float facing = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = clamp(pow(1.0 - facing, uFresnelPower), 0.0, 1.0);

  // Depth gradient: thin water near the bank reads bright, the basin is deep.
  vec3 body = mix(uShallowColor, uDeepColor, smoothstep(0.05, 0.85, vDepthFactor));

  // Mirror reflection, distorted by the ripple field so it breathes.
  vec2 proj = vMirrorCoord.xy / max(vMirrorCoord.w, 1e-4);
  float wobble = rippleField(vWorldPosition.xz * uNormalScale, uTime) * uDistortion;
  vec2 mirrorUv = clamp(proj + vec2(wobble), 0.002, 0.998);
  vec3 reflection = texture2D(uMirrorSampler, mirrorUv).rgb;

  vec3 water = mix(body, reflection, fresnel * uReflectionStrength);
  // A little sky tint at grazing angles keeps the lake low-saturation.
  water = mix(water, uSkyColor, fresnel * 0.16);

  // Warm sun glitter.
  vec3 H = normalize(uSunDirection + V);
  float specular = pow(max(dot(N, H), 0.0), uGlitterPower);
  water += uSunColor * specular * uGlitterStrength;

  // Low-frequency drift so the surface is never a flat colour field.
  float drift =
    sin(dot(vWorldPosition.xz, vec2(0.21, 0.13)) + uTime * 0.33) * 0.5 +
    sin(dot(vWorldPosition.xz, vec2(-0.11, 0.26)) - uTime * 0.21) * 0.5;
  water += vec3(0.011, 0.017, 0.019) * drift;

  gl_FragColor = vec4(water, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface LakeBundle {
  readonly group: Group;
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly outline: LakeOutline;
  /** Per-frame hook registered with the app (uniform time only). */
  readonly update: UpdateCallback;
  /** Points the water's specular highlight at the actual sun. */
  readonly setSunDirection: (direction: Vector3) => void;
  /**
   * Renders the planar reflection. Called by `App` immediately before the main
   * pass, so the mirror image is at most one frame old — invisible here.
   */
  readonly renderReflection: (
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
  ) => void;
  readonly dispose: () => void;
}

/**
 * Creates the procedural Lianqiu Lake surface (PROMPT.md §5.1).
 *
 * The water is fully runtime-generated — no high-poly static lake mesh is
 * exported from Blender; only the surrounding static shoreline is modelled.
 */
export function createLake(outline: LakeOutline = createLakeOutline()): LakeBundle {
  const geometry = createLakeSurfaceGeometry(outline, {
    rings: LAKE_SPEC.rings,
    sectors: LAKE_SPEC.sectors,
    y: 0,
  });
  attachDepthFactor(geometry, outline);

  const mirror = createPlanarMirror();

  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uRippleAmplitude: { value: WATER_SPEC.rippleAmplitude },
    uRippleScale: { value: WATER_SPEC.rippleScale },
    uDeepColor: { value: new Color(PALETTE.WATER_DEEP) },
    uShallowColor: { value: new Color(PALETTE.WATER_SHALLOW) },
    uSkyColor: { value: new Color(WATER_SPEC.skyTint) },
    uSunColor: { value: new Color(PALETTE.SUN_COLOR) },
    uSunDirection: { value: new Vector3(0.5, 1, 0.4).normalize() },
    uMirrorSampler: { value: mirror.target.texture },
    uTextureMatrix: { value: mirror.textureMatrix },
    uFresnelPower: { value: WATER_SPEC.fresnelPower },
    uReflectionStrength: { value: WATER_SPEC.reflectionStrength },
    uDistortion: { value: WATER_SPEC.distortionScale },
    uNormalScale: { value: WATER_SPEC.normalScale },
    uGlitterPower: { value: WATER_SPEC.glitterPower },
    uGlitterStrength: { value: WATER_SPEC.glitterStrength },
  };

  const material = new ShaderMaterial({
    name: 'LK_WATER_MATERIAL',
    uniforms,
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: false,
    side: FrontSide,
    fog: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = `${SCENE_OBJECT_NAMES.LAKE}_${SCENE_OBJECT_NAMES.WATER}`;
  mesh.position.set(LAKE_SPEC.center.x, LAKE_SPEC.surfaceY, LAKE_SPEC.center.z);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.frustumCulled = true;
  mesh.renderOrder = 1;

  const group = new Group();
  group.name = SCENE_OBJECT_NAMES.LAKE;
  group.add(mesh);

  const update: UpdateCallback = (context) => {
    uniforms.uTime.value = context.elapsed;
  };

  const setSunDirection = (direction: Vector3): void => {
    (uniforms.uSunDirection.value as Vector3).copy(direction).normalize();
  };

  const renderReflection = (
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera | OrthographicCamera,
  ): void => {
    renderPlanarReflection(renderer, scene, camera, mesh, mirror);
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    mirror.target.dispose();
  };

  return { group, mesh, material, outline, update, setSunDirection, renderReflection, dispose };
}

// ---------------------------------------------------------------------------
// Depth gradient attribute
// ---------------------------------------------------------------------------

/**
 * Bakes the shore → centre depth gradient into a per-vertex `depthFactor`:
 * 0 at the waterline, 1 from ~65 % of the local radius inward.
 *
 * The polar grid's `uv` is a world-space projection, so the radial fraction is
 * recomputed here from the outline; the shader then needs no lake lookup.
 */
function attachDepthFactor(geometry: BufferGeometry, outline: LakeOutline): void {
  const position = geometry.getAttribute('position') as BufferAttribute;
  const count = position.count;
  const factors = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const dx = position.getX(i) - outline.center.x;
    const dz = position.getZ(i) - outline.center.y;
    const distance = Math.hypot(dx, dz);
    const theta = Math.atan2(dz, dx);
    const normalized = theta < 0 ? theta + Math.PI * 2 : theta;
    const radius = Math.max(0.001, outline.radiusAt(normalized));
    const radial = 1 - Math.min(1, distance / radius);
    // Ramp 0 → 1 over the outer 35 % of the radius; the core stays full depth.
    factors[i] = Math.min(1, Math.max(0, radial / 0.35));
  }

  geometry.setAttribute('depthFactor', new (position.constructor as new (
    array: Float32Array,
    itemSize: number,
  ) => BufferAttribute)(factors, 1));
}

// ---------------------------------------------------------------------------
// Planar mirror
// ---------------------------------------------------------------------------

interface PlanarMirror {
  readonly target: WebGLRenderTarget;
  readonly textureMatrix: Matrix4;
  readonly camera: PerspectiveCamera;
}

function createPlanarMirror(): PlanarMirror {
  const size = WATER_SPEC.reflectionTextureSize;
  const target = new WebGLRenderTarget(size, size, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  target.texture.name = 'LK_MIRROR_TARGET';

  return { target, textureMatrix: new Matrix4(), camera: new PerspectiveCamera() };
}

// Scratch objects reused every frame (no per-frame allocation).
const MIRROR_NORMAL = new Vector3(0, 1, 0);
const MIRROR_POSITION = new Vector3();
const MIRROR_CAM_POS = new Vector3();
const MIRROR_ROTATION = new Matrix4();
const MIRROR_LOOK_AT = new Vector3(0, 0, -1);
const MIRROR_TARGET = new Vector3();
const MIRROR_VIEW = new Vector3();
const MIRROR_PLANE = new Plane();
const MIRROR_CLIP = new Vector4();
const MIRROR_Q = new Vector4();

/**
 * Renders the scene from a camera mirrored across the lake plane.
 *
 * Ported from three's `examples/jsm/objects/Water`, including Lengyel's oblique
 * near-plane trick, but driven explicitly from the render loop rather than a
 * per-material `onBeforeRender`: base and orthographic cameras both work, and
 * the water mesh is hidden for the duration of the pass.
 */
function renderPlanarReflection(
  renderer: WebGLRenderer,
  scene: Scene,
  mainCamera: PerspectiveCamera | OrthographicCamera,
  water: Mesh,
  mirror: PlanarMirror,
): void {
  // The water is (almost) planar: mirror everything across its own y plane.
  MIRROR_POSITION.setFromMatrixPosition(water.matrixWorld);
  MIRROR_CAM_POS.setFromMatrixPosition(mainCamera.matrixWorld);

  MIRROR_ROTATION.extractRotation(water.matrixWorld);
  // The water plane is flat: its world normal is +Y regardless of its XZ
  // translation, so no rotation extraction is needed.
  MIRROR_NORMAL.set(0, 1, 0);
  void MIRROR_ROTATION;
  MIRROR_VIEW.copy(MIRROR_POSITION).sub(MIRROR_CAM_POS);
  if (MIRROR_VIEW.dot(MIRROR_NORMAL) > 0) return; // Camera below the water.

  MIRROR_VIEW.reflect(MIRROR_NORMAL).negate();
  MIRROR_VIEW.add(MIRROR_POSITION);

  MIRROR_ROTATION.extractRotation(mainCamera.matrixWorld);
  MIRROR_LOOK_AT.set(0, 0, -1).applyMatrix4(MIRROR_ROTATION).add(MIRROR_CAM_POS);
  MIRROR_TARGET.copy(MIRROR_POSITION).sub(MIRROR_LOOK_AT);
  MIRROR_TARGET.reflect(MIRROR_NORMAL).negate();
  MIRROR_TARGET.add(MIRROR_POSITION);

  const camera = mirror.camera;
  camera.position.copy(MIRROR_VIEW);
  camera.up.set(0, 1, 0).applyMatrix4(MIRROR_ROTATION).reflect(MIRROR_NORMAL);
  camera.lookAt(MIRROR_TARGET);
  camera.far = mainCamera.far;
  camera.near = mainCamera.near;
  camera.updateMatrixWorld();
  camera.projectionMatrix.copy(mainCamera.projectionMatrix);

  // Project the mirrored view into the water's texture space.
  const textureMatrix = mirror.textureMatrix;
  textureMatrix.set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0,
  );
  textureMatrix.multiply(camera.projectionMatrix);
  textureMatrix.multiply(camera.matrixWorldInverse);

  // Oblique near plane: clip everything below the waterline.
  MIRROR_PLANE.setFromNormalAndCoplanarPoint(MIRROR_NORMAL, MIRROR_POSITION);
  MIRROR_PLANE.applyMatrix4(camera.matrixWorldInverse);
  MIRROR_CLIP.set(MIRROR_PLANE.normal.x, MIRROR_PLANE.normal.y, MIRROR_PLANE.normal.z, MIRROR_PLANE.constant);

  const projection = camera.projectionMatrix;
  const e = projection.elements;
  MIRROR_Q.x = (Math.sign(MIRROR_CLIP.x) + e[8]) / e[0];
  MIRROR_Q.y = (Math.sign(MIRROR_CLIP.y) + e[9]) / e[5];
  MIRROR_Q.z = -1.0;
  MIRROR_Q.w = (1.0 + e[10]) / e[14];
  MIRROR_CLIP.multiplyScalar(2.0 / MIRROR_CLIP.dot(MIRROR_Q));

  e[2] = MIRROR_CLIP.x;
  e[6] = MIRROR_CLIP.y;
  e[10] = MIRROR_CLIP.z + 1.0 - WATER_SPEC.clipBias;
  e[14] = MIRROR_CLIP.w;

  // Save/restore renderer state so the pass is invisible to the main loop.
  const previousTarget = renderer.getRenderTarget();
  const previousXr = renderer.xr.enabled;
  const previousShadowAuto = renderer.shadowMap.autoUpdate;

  water.visible = false;
  renderer.xr.enabled = false;
  // Reusing the main pass's shadow map avoids a second shadow render.
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(mirror.target);
  renderer.state.buffers.depth.setMask(true);
  renderer.clear();
  renderer.render(scene, camera);
  water.visible = true;

  renderer.setRenderTarget(previousTarget);
  renderer.xr.enabled = previousXr;
  renderer.shadowMap.autoUpdate = previousShadowAuto;
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
}