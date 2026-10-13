import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import type { ReusableTimeline } from '@pmndrs/timeline';
import { Body, type Frame } from '../core/body';
import { Pose, type ReadonlyPose } from '../core/pose';
import type { Skeleton } from '../core/skeleton';
import { INDEX } from './bones';
import { relaxedPose } from './profile/relaxed';
import type { Proportions } from './proportions';
import { Rig, yawOf } from './rig';

export interface HumanoidOptions<W> {
  world?: W;
  /** where the body stands (on the floor, y = 0) */
  position?: { x: number; z: number };
  /** its facing about +Y (0 faces +Z) */
  yaw?: number;
}

/**
 * A @pmndrs/viverse character model as a body stepping `behaviour` (made for this humanoid: it
 * may read the rig and the proportions), the model posed after every update. The body starts
 * standing relaxed where `options` puts it. One Humanoid per model.
 */
export class Humanoid<W = unknown> {
  readonly rig: Rig;
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  private readonly body: Body<W>;
  private readonly ground = new Vector3();

  constructor(
    readonly model: CharacterModel,
    behaviour: (h: Humanoid<W>) => ReusableTimeline<Frame<W>>,
    options: HumanoidOptions<W> = {},
  ) {
    const rig = (this.rig = new Rig(model));
    const p = (this.proportions = rig.proportions);
    const yaw = options.yaw ?? 0;
    const start = standing(rig.skeleton, p, options.position ?? { x: 0, z: 0 }, yaw);
    this.body = new Body(rig.skeleton, behaviour(this), { world: options.world, pose: start });
    rig.write(this.body.pose, 0);
  }

  /** the last final pose */
  get pose(): ReadonlyPose {
    return this.body.pose;
  }

  /** the body's facing about +Y (0 faces +Z): the hips' */
  get yaw(): number {
    return yawOf(this.pose.local(0));
  }

  /** the body's ground velocity over the last sub-step: its centre of mass's, horizontal (m/s); read-only */
  get velocity(): Readonly<Vector3> {
    const { prev, prev2, dt } = this.body.frame;
    const v = prev.com(this.ground).sub(prev2.com(_v)).divideScalar(dt);
    return v.setY(0);
  }

  /** a copy of the last final pose, as other bodies read it */
  snapshot(): Pose {
    return new Pose(this.rig.skeleton).copy(this.pose);
  }

  /** Advances the body by `dt` seconds and poses the model; a VRM is updated by `dt` too. */
  update(dt: number) {
    this.body.update(dt);
    this.rig.write(this.body.pose, dt);
  }
}

const _v = new Vector3();

/** the relaxed pose standing at `floor` facing `yaw`, the soles on the floor */
function standing(skeleton: Skeleton, p: Proportions, floor: { x: number; z: number }, yaw: number): Pose {
  const pose = new Pose(skeleton);
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  pose.setRoot(new Vector3(floor.x, p.hipHeight, floor.z));
  const ankle = pose.position(INDEX.leftFoot).y;
  pose.setRoot(new Vector3(floor.x, p.hipHeight + p.ankleHeight - ankle, floor.z));
  return pose;
}
