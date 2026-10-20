import { Quaternion, Vector3 } from 'three';
import { NECK_PITCH } from './profile/limits';
import type { CharacterModel } from '@pmndrs/viverse';
import { Body, type BodyOptions } from '../core/body';
import { solveChain } from '../core/chain';
import type { Gazer } from '../core/gaze';
import type { Behaviour } from '../core/goal';
import { Pose } from '../core/pose';
import type { Dressed } from '../core/worn';
import { footRotation, type Foot } from './balance/foot';
import { legOf } from './balance/legs';
import { STANDING_REACH } from './balance/posture';
import { INDEX, SIDES } from './bones';
import { forwardOf, leftOf } from '../core/math';
import { relaxedPose } from './profile/relaxed';
import type { Proportions } from './proportions';
import { gazeAsks } from './reach-posture';
import { Rig } from './rig';
import { defaultStance, footYaw, stanceFeet } from './stance';
import { followHeld } from './hands/hold';

export interface HumanoidOptions extends Pick<BodyOptions, 'dev'> {
  /** where the body stands (on the floor, y = 0) */
  position?: { x: number; z: number };
  /** its facing about +Y (0 faces +Z) */
  yaw?: number;
  /** what it wears from the start, placed for its proportions (`BodyOptions.wearing`) */
  wearing?: (p: Proportions) => readonly Dressed[];
}

/**
 * A @pmndrs/viverse character model as a body stepping `behaviour` (made for this humanoid: it
 * may read the rig and the proportions), the model posed after every update. The body starts
 * standing relaxed in its stance where `options` puts it, its hands `left` and `right`. One
 * Humanoid per model.
 */
export class Humanoid extends Body {
  readonly rig: Rig;
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  /** where the feet stand or, stepping, land [left, right]: `balance`'s output */
  readonly feet: [Foot, Foot];
  declare readonly gazer: Gazer;

  constructor(
    readonly model: CharacterModel,
    behaviour: (h: Humanoid) => Behaviour,
    options: HumanoidOptions = {},
  ) {
    const rig = new Rig(model);
    const p = rig.proportions, yaw = options.yaw ?? 0;
    const start = standing(p, new Pose(rig.skeleton), options.position ?? { x: 0, z: 0 }, yaw);
    const eyes = rig.points.eyes;
    let made: Behaviour | null = null;
    super({ skeleton: rig.skeleton, gaze: humanGaze(eyes), hands: { left: 'leftArm', right: 'rightArm' } }, function* () {
      if (!made) throw new Error('the humanoid is not made yet');
      yield* made();
    }, {
      dev: options.dev, pose: start.pose, scale: p.scale, wearing: options.wearing?.(p),
      hold: (body) => followHeld(humanoid(body)),
    });
    // (facing as given, not as read back off the pose)
    this.locomotion.facing = yaw;
    this.rig = rig;
    this.proportions = p;
    this.feet = start.feet;
    made = behaviour(this);
    rig.write(this.pose, 0);
  }

  /** Advances the body by `dt` seconds and poses the model; a VRM is updated by `dt` too. */
  update(dt: number) {
    super.update(dt);
    this.rig.write(this.pose, dt);
  }
}

/** a person's gaze: the neck chain turns the head, the eyes the rest; looking low, the body bows */
const humanGaze = (eyes: Rig['points']['eyes']): Gazer => ({ neck: 'neck', eyes: (pose, out) => pose.point(eyes.bone, eyes.at, out),
  range: EYES, pitch: NECK_PITCH * Math.PI / 180, lead: (body, pose, point) => gazeAsks(humanoid(body), pose, point) });

/** `body` as the humanoid it is */
function humanoid(body: Body): Humanoid {
  if (!(body instanceof Humanoid)) throw new Error('not a humanoid');
  return body;
}

/**
 * How far the eyes turn in the head comfortably (rad): down, the preferred declination of the line
 * of sight below the head's (29° sitting upright, 34° over all postures, 38° for a near target: Hill
 * & Kroemer 1986, Human Factors 28:127); up and aside, where the eyes end a head-free gaze shift
 * (half the customary ocular motor range, 44° wide on average, and of the eye-only range, 36°:
 * Stahl 1999, Exp Brain Res 126:41; measured horizontally, taken for up as well)
 */
const EYES = { down: (30 * Math.PI) / 180, up: (20 * Math.PI) / 180, side: (20 * Math.PI) / 180 };

/**
 * `pose` standing relaxed at `floor` facing `yaw`: the feet flat where the default stance puts them,
 * the pelvis as high as they reach, the legs solved down to them; and the feet
 */
function standing(p: Proportions, pose: Pose, floor: { x: number; z: number }, yaw: number): { pose: Pose; feet: [Foot, Foot] } {
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  pose.setRoot(new Vector3(floor.x, p.hipHeight, floor.z));
  const stance = defaultStance(p);
  const ankles: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  stanceFeet(floor.x, floor.z, forwardOf(yaw), leftOf(yaw), p, stance, ankles);
  // (no higher than the legs reach)
  const reach = STANDING_REACH * p.legLength;
  let y = p.hipHeight;
  SIDES.forEach((side, s) => {
    const hip = pose.position(INDEX[`${side}UpperLeg`]);
    y = Math.min(y, ankles[s].y + Math.sqrt(reach * reach - (hip.x - ankles[s].x) ** 2 - (hip.z - ankles[s].z) ** 2) + p.hipHeight - hip.y);
  });
  pose.setRoot(new Vector3(floor.x, y, floor.z));
  const feet = SIDES.map((side, s): Foot => {
    const heading = footYaw(yaw, s === 0 ? 1 : -1, stance);
    const foot = footRotation(heading, 0);
    const knee = forwardOf(heading).add(pose.position(INDEX[`${side}UpperLeg`]));
    solveChain({ current: pose }, legOf(side), { tip: { position: ankles[s], quaternion: foot }, pole: knee });
    return { position: ankles[s], yaw: heading, phase: 'planted' };
  });
  return { pose, feet: [feet[0], feet[1]] };
}
