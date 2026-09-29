import {
  Camera,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { BODY25_COLORS, BODY25_KEYPOINTS, BODY25_PAIRS, type Pose } from '@prohuman/core';

export interface OpenPoseSkeletonOptions {
  /** limb thickness in metres */
  limbRadius?: number;
  jointRadius?: number;
  /** OpenPose blends the skeleton at 0.6 alpha */
  opacity?: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);

/**
 * A 3D OpenPose BODY_25 skeleton: each limb is an elongated ellipsoid in the
 * colour of its child keypoint (as in OpenPose's renderer), each keypoint a
 * sphere.
 */
export class OpenPoseSkeleton extends Group {
  private limbs: Mesh[] = [];
  private joints: Mesh[] = [];
  private limbRadius: number;

  constructor(opts: OpenPoseSkeletonOptions = {}) {
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

  update(pose: Pose) {
    BODY25_PAIRS.forEach(([i, j], k) => {
      const a = _a.copy(pose[BODY25_KEYPOINTS[i]]);
      const b = _b.copy(pose[BODY25_KEYPOINTS[j]]);
      const m = this.limbs[k];
      const len = a.distanceTo(b);
      m.position.addVectors(a, b).multiplyScalar(0.5);
      _dir.subVectors(b, a).normalize();
      m.quaternion.setFromUnitVectors(_up, _dir);
      const face = k >= 13 && k <= 17;
      const r = this.limbRadius * (face ? 0.6 : 1);
      m.scale.set(r, Math.max(len / 2, 1e-4), r);
    });
    BODY25_KEYPOINTS.forEach((name, i) => this.joints[i].position.copy(pose[name]));
  }
}

/** Project a pose to pixel coordinates (BODY_25 order), as OpenPose/ControlNet expects. */
export function projectBody25(pose: Pose, camera: Camera, width: number, height: number): [number, number][] {
  return BODY25_KEYPOINTS.map((name) => {
    const v = _a.copy(pose[name]).project(camera);
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
  });
}

/**
 * Draw projected BODY_25 keypoints the way OpenPose renders them: ellipse limbs
 * in the child keypoint colour at 0.6 alpha, then keypoint discs.
 */
export function drawOpenPose2D(ctx: CanvasRenderingContext2D, points: [number, number][], opts: { thickness?: number } = {}) {
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

