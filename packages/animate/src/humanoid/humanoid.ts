import { Quaternion, Vector3 } from 'three';
import { NECK_PITCH } from './profile/limits';
import type { CharacterModel } from '@pmndrs/viverse';
import { Body, type BodyOptions, type IdleOptions } from '../core/body';
import type { Species } from '../core/species';
import { createSkeletonModel } from './model';
import { personIdle } from './idle';
import { solveChain } from '../core/chain';
import type { Gazer } from '../core/gaze';
import type { Behaviour } from '../core/goal';
import { Pose } from '../core/pose';
import { footRotation, type Foot } from './posture/foot';
import { legOf } from './posture/leg';
import { STANDING_REACH } from './posture/posture';
import { INDEX, SIDES, type Side } from './bones';
import { forwardOf, leftOf } from '../core/math';
import { relaxedPose } from './profile/relaxed';
import type { Proportions } from './proportions';
import { gazeAsks } from './reach-posture';
import { Rig } from './rig';
import { defaultStance, footYaw, stanceFeet } from './stance';
import { followHeld } from './hands/hold';
import type { Carrier, Item } from '../core/carrier';

/**
 * A person, as a species (`new Body(human(model), story, options)`): its skeleton and measures read off a @pmndrs/viverse character
 * model (default a bare one, `createSkeletonModel()`), which its body poses after every update. Its body starts standing relaxed in its
 * stance where the options put it, its hands `left` and `right`; one body per `human()`.
 */
export function human(model: CharacterModel = createSkeletonModel()): Species<Side> {
  const rig = new Rig(model), eyes = rig.points.eyes;
  let embodied = false;
  const species: Species<Side> = { skeleton: rig.skeleton, gaze: humanGaze(eyes), hands: { left: 'leftArm', right: 'rightArm' }, inertia: INERTIA,
    person: { embody: (story, options) => {
      // (its model is posed by its one body: a second would pose the same model)
      if (embodied) throw new Error('one body per human(): make a human() for each person');
      embodied = true;
      return new Humanoid(species, rig, story, options);
    } } };
  return species;
}

/** whether `body` is a person (`human()`): its body is a person's */
export const isPerson = <H extends string>(body: Body<H>): body is Body<H> & Humanoid => !!body.species.person;

/** A person's body (`human()`): the rig its pose drives, its measures, and where its feet stand. */
export class Humanoid extends Body<Side> {
  /** where the feet stand or, stepping, land [left, right]: the base's */
  readonly feet: [Foot, Foot];
  declare readonly gazer: Gazer;
  /** what its hands carry this sub-step and along which aim (`hold` with `to`, `carry`): the hands fit each to its aim after the story */
  readonly carrying = new Map<Item, Carrier>();
  private readonly measured: Proportions;

  constructor(species: Species<Side>, readonly rig: Rig, story: (body: Body<Side>) => Behaviour, options: BodyOptions = {}) {
    const p = rig.proportions, yaw = options.yaw ?? 0;
    const start = standing(p, new Pose(rig.skeleton), options.at ?? { x: 0, z: 0 }, yaw);
    const wearing = options.wearing;
    super(species, story, {
      ...options, pose: start.pose, scale: p.scale, wearing: typeof wearing === 'function' ? wearing(p) : wearing,
      hold: (body) => followHeld(humanoid(body)),
    });
    // (facing as given, not as read back off the pose)
    this.locomotion.facing = yaw;
    this.measured = p;
    this.feet = start.feet;
    rig.write(this.pose, 0);
    this.begin();
  }

  /** measured from the model's rest pose */
  get proportions(): Proportions { return this.measured; }

  /** the character model it poses */
  get model(): CharacterModel { return this.rig.model; }

  protected base(options: IdleOptions): Behaviour { return personIdle(this, options); }

  /** Advances the body by `dt` seconds and poses the model; a VRM is updated by `dt` too. */
  update(dt: number) {
    super.update(dt);
    this.rig.write(this.pose, dt);
  }
}

/**
 * How a person's trunk takes the root's acceleration (`Inertial`). Setting off it leans into it about as far as atan(a / g): ~7° over a
 * walk's first step at ~1 m/s² (read: Leteneur et al. 2013, PLoS ONE 8:e55256: "all subjects lean forward, around 7° on average", the
 * centre of mass at 1.0 m/s by heel strike 0.96 s on — ~1 m/s², atan 6°), a sprinter's 47–51° from vertical at 9.1 m/s² (read: Walker,
 * Bissas et al. 2021, J Biomech 124:110554; atan 43°). Braking, the body leans back but the trunk is held nearly upright (read: Harper
 * et al. 2022, Sports Med 52:2321: a "more upright and posterior trunk" brakes harder, yet a forward trunk lowers the centre of
 * mass): a third of it. Round a bend the body leans in by atan(v² / r g) (read: Churchill et al. 2015, bend sprinting: 12.8° at 13.4°),
 * the trunk taking most of it (tuned: 0.6, a side-step's stop no jolt). The response: felt over about a step, below a low back's ~1 Hz
 * (snippet: van Drunen et al. 2013; tuned: 0.8 Hz, a player's stop no jolt), damped as the head on the trunk is, ζ ≈ 0.5–0.7 (read:
 * Peng, Hain & Peterson 1996, Biol Cybern 75:309: ζ 0.52 at 2.0 Hz with reflexes) — a little overshoot, settled within a second.
 */
const INERTIA = { ahead: 0.9, back: 0.3, roll: 0.6, most: 0.35, frequency: 0.8, damping: 0.7 };

/** a person's gaze: the neck chain turns the head, the eyes the rest; looking low, the body bows */
const humanGaze = (eyes: Rig['points']['eyes']): Gazer => ({ neck: 'neck', eyes: (pose, out) => pose.point(eyes.bone, eyes.at, out),
  range: EYES, pitch: NECK_PITCH * Math.PI / 180, lead: (body, pose, point) => gazeAsks(humanoid(body), pose, point) });

/** `body` as the person it is */
function humanoid(body: Body): Humanoid {
  if (!isPerson(body)) throw new Error('not a person');
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
