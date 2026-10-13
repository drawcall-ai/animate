import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Camera, type Object3D } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import { createSkeletonModel } from '@drawcall/animate';
import { BODY25_COLORS, BODY25_KEYPOINTS, BODY25_PAIRS, keypointsOf, toBody25 } from './body25';

export { BODY25_COLORS, BODY25_KEYPOINTS, BODY25_PAIRS, toBody25 } from './body25';

export interface OpenPoseSkeletonOptions {
  /** limb thickness in metres */
  limbRadius?: number;
  jointRadius?: number;
  /** OpenPose blends the skeleton at 0.6 alpha */
  opacity?: number;
}

/**
 * A character model drawn as an OpenPose BODY_25 skeleton: `createSkeletonModel(height)`
 * with an `OpenPoseSkeleton` in its scene. Drive it with a Humanoid like any viverse model.
 */
export function createOpenPoseModel(options: OpenPoseSkeletonOptions & { height?: number } = {}): CharacterModel {
  const model = createSkeletonModel(options.height);
  model.scene.add(new OpenPoseSkeleton(model, options));
  return model;
}

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const _toLocal = new Matrix4();
const _identity = new Matrix4();

/**
 * A 3D OpenPose BODY_25 skeleton over a character model's keypoints: each limb is an
 * elongated ellipsoid in the colour of its child keypoint (as in OpenPose's renderer), each
 * keypoint a sphere. Add it to `model.scene`, after the bones: it follows them whenever the
 * scene's world matrices are updated (as rendering does) — once a Humanoid drives the model
 * (before, the landmarks are missing and it throws).
 */
export class OpenPoseSkeleton extends Group {
  private limbs: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
  private joints: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
  private limbRadius: number;
  /** resolved on first use: the landmarks come with the Humanoid */
  private keypoints: Object3D[] | null = null;

  constructor(
    private readonly model: CharacterModel,
    opts: OpenPoseSkeletonOptions = {},
  ) {
    super();
    this.limbRadius = opts.limbRadius ?? 0.022;
    const jointRadius = opts.jointRadius ?? 0.024;
    const opacity = opts.opacity ?? 0.85;
    const sphere = new SphereGeometry(1, 20, 12);

    BODY25_PAIRS.forEach(([, child]) => {
      const [r, g, b] = BODY25_COLORS[child];
      const mat = new MeshBasicMaterial({ color: new Color(r / 255, g / 255, b / 255), transparent: opacity < 1, opacity });
      const m = new Mesh(sphere, mat);
      this.limbs.push(m);
      this.add(m);
    });
    BODY25_KEYPOINTS.forEach((_, i) => {
      const [r, g, b] = BODY25_COLORS[i];
      const mat = new MeshBasicMaterial({ color: new Color(r / 255, g / 255, b / 255) });
      const m = new Mesh(sphere, mat);
      m.scale.setScalar(i >= 15 && i <= 18 ? jointRadius * 0.7 : jointRadius);
      m.renderOrder = 1;
      this.joints.push(m);
      this.add(m);
    });
  }

  /**
   * Hide some keypoints (BODY_25 indices) and every limb touching them — e.g. a first-person
   * camera hides its own body's face (0 nose, 15–18 eyes and ears).
   */
  setHidden(keypoints: Iterable<number>) {
    const hidden = new Set(keypoints);
    this.joints.forEach((m, i) => (m.visible = !hidden.has(i)));
    BODY25_PAIRS.forEach(([i, j], k) => (this.limbs[k].visible = !hidden.has(i) && !hidden.has(j)));
  }

  /** frees the GPU resources (the shared sphere and the materials) */
  dispose() {
    this.joints[0].geometry.dispose();
    for (const m of [...this.limbs, ...this.joints]) m.material.dispose();
  }

  override updateMatrixWorld(force?: boolean) {
    this.follow();
    super.updateMatrixWorld(force);
  }

  /** places the spheres and limbs on the keypoints (their world matrices are current: they come first) */
  private follow() {
    const keypoints = (this.keypoints ??= keypointsOf(this.model));
    _toLocal.copy(this.parent?.matrixWorld ?? _identity).invert();
    const at = (i: number, out: Vector3) => out.setFromMatrixPosition(keypoints[i].matrixWorld).applyMatrix4(_toLocal);
    BODY25_PAIRS.forEach(([i, j], k) => {
      const a = at(i, _a);
      const b = at(j, _b);
      const m = this.limbs[k];
      const len = a.distanceTo(b);
      m.position.addVectors(a, b).multiplyScalar(0.5);
      _dir.subVectors(b, a).normalize();
      m.quaternion.setFromUnitVectors(_up, _dir);
      const face = k >= 13 && k <= 17;
      const r = this.limbRadius * (face ? 0.6 : 1);
      m.scale.set(r, Math.max(len / 2, 1e-4), r);
    });
    this.joints.forEach((m, i) => at(i, m.position));
  }
}

/** The model's BODY_25 keypoints projected to pixel coordinates, as OpenPose/ControlNet expects. */
export function projectBody25(model: CharacterModel, camera: Camera, width: number, height: number): [number, number][] {
  return toBody25(model).map(([x, y, z]) => {
    const v = _a.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
  });
}

/** What `drawOpenPose2D` draws with: a canvas or an offscreen canvas's 2D context. */
export type Context2D = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'beginPath' | 'ellipse' | 'arc' | 'fill' | 'fillStyle' | 'globalAlpha'> & {
  canvas: { width: number; height: number };
};

/**
 * Draw projected BODY_25 keypoints the way OpenPose renders them: ellipse limbs
 * in the child keypoint colour at 0.6 alpha, then keypoint discs.
 */
export function drawOpenPose2D(ctx: Context2D, points: [number, number][], opts: { thickness?: number } = {}) {
  const area = ctx.canvas.width * ctx.canvas.height;
  const t = opts.thickness ?? Math.max(2, Math.sqrt(area) / 75);
  ctx.save();
  ctx.globalAlpha = 0.6;
  for (const [i, j] of BODY25_PAIRS) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[j];
    const [r, g, b] = BODY25_COLORS[j];
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, len / 2, t * 0.75, Math.atan2(y2 - y1, x2 - x1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  points.forEach(([x, y], i) => {
    const [r, g, b] = BODY25_COLORS[i];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.arc(x, y, t, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}
