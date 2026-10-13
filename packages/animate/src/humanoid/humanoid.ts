import { Quaternion, Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import type { ReusableTimeline } from '@pmndrs/timeline';
import { Body, type Frame } from '../core/body';
import { Pose } from '../core/pose';
import type { Skeleton } from '../core/skeleton';
import { INDEX } from './bones';
import { relaxedPose } from './profile/relaxed';
import type { Proportions } from './proportions';
import { Rig, yawOf } from './rig';
import { defaultStance } from './stance';
import { createStatus, type Foot, type Status } from './status';

export interface HumanoidOptions<W> {
  world?: W;
  /** where the body stands (on the floor, y = 0) */
  position?: { x: number; z: number };
  /** its facing about +Y (0 faces +Z) */
  yaw?: number;
}

/**
 * A @pmndrs/viverse character model as a body stepping `behaviour` (made for this humanoid: it
 * reads the rig and writes the status), the model posed after every update. The body starts
 * standing relaxed where `options` puts it. One Humanoid per model.
 */
export class Humanoid<W = unknown> {
  readonly rig: Rig;
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  /** what the behaviours report: footing, seated, mounted, intent */
  readonly status: Status;
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
    const foot = (bone: number) => ({ position: start.position(bone).clone(), yaw });
    // (the status first: the behaviour starts as the body is made)
    this.status = createStatus([foot(INDEX.leftFoot), foot(INDEX.rightFoot)], defaultStance(p));
    this.body = new Body(rig.skeleton, behaviour(this), { world: options.world, pose: start });
    rig.write(this.body.pose, 0);
  }

  /** the last final pose */
  get pose(): Pose {
    return this.body.pose;
  }

  /** [left, right]; read-only */
  get feet(): readonly [Readonly<Foot>, Readonly<Foot>] {
    return this.status.feet;
  }

  /** how far the body is seated (0 standing … 1 seated) */
  get seated(): number {
    return this.status.seated;
  }

  /** riding a mount */
  get mounted(): boolean {
    return this.status.mounted;
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
