import { Quaternion, Vector3 } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Skeleton } from '../../kernel/skeleton';
import type { Gazer } from '../../look/gaze';
import { needing, type BoneNames, type Having, type Species } from '../define';
import { BONES, CHILD_BONES, PARENT, createRest, perBone, type BoneName, type ChildBone, type Side } from './bones';
import { pointsOf } from './landmarks';
import { NECK_PITCH, ranges } from './limits';
import { derive, type Proportions } from './proportions';
import { CHAINS, massFor, skeletonOf } from './skeleton';
import { gazeAsks } from '../../hands/person/bend';
import { personOf } from '../../body/person';

/** the bones a person's skeleton names: every humanoid bone but the toes, which a foot without them is given at its ball */
export type HumanoidBone = Exclude<BoneName, 'leftToes' | 'rightToes'>;

/**
 * A person of a skeleton (as rigged with @drawcall/rig, `as const`): its bones named as `HumanoidBone` (camelCase: `hips`, `spine`,
 * `leftUpperArm`, …), its proportions measured off where they stand — limbs straight or bent (an A-pose) — and the standing height
 * off the crown (an end bone above the head), else off the head. Its masses are Dempster's shares of a body of that height; its
 * hands are `left` and `right`.
 */
export function humanoid<const S extends readonly SkeletonBone[]>(skeleton: S & Having<S, HumanoidBone>): Species<BoneNames<S>, Side> {
  needing(skeleton, BONES.filter((bone) => bone !== 'leftToes' && bone !== 'rightToes'), 'humanoid');
  const at = new Map(skeleton.map((bone) => [bone.name, new Vector3(...bone.position)]));
  const parents = new Map(skeleton.map((bone) => [bone.name, bone.parent]));
  for (const bone of CHILD_BONES) {
    if (!at.has(bone)) continue;
    let up = parents.get(bone);
    while (up !== undefined && up !== PARENT[bone]) up = parents.get(up);
    if (up === undefined) throw new Error(`humanoid: "${bone}" does not hang from "${PARENT[bone]}"`);
  }
  const { proportions, turns } = measure(perBone((bone) => at.get(bone) ?? null), crownOf(skeleton));
  return {
    bones: skeleton,
    skeleton: new Skeleton(skeletonOf(proportions), { limits: ranges(), chains: CHAINS }),
    turns: new Map(BONES.map((bone) => [bone, turns[bone]])),
    gaze: humanGaze(proportions),
    hands: new Map([['left', 'leftArm'], ['right', 'rightArm']]),
    inertia: INERTIA,
    scale: proportions.scale,
    mass: massFor(proportions.height),
    person: proportions,
  };
}

/** the crown's height (m): the highest end of the head (a bone above it, as rig's end bones are), if the skeleton has one */
function crownOf(skeleton: readonly SkeletonBone[]): number | undefined {
  const head = skeleton.find((bone) => bone.name === 'head');
  const above = skeleton.filter((bone) => bone.parent === 'head').map((bone) => bone.position[1]);
  return head && above.length && Math.max(...above) > head.position[1] ? Math.max(...above) : undefined;
}

/**
 * The limb segments a person moves straight, each with its T-pose axis: a skeleton bends them a little (knees and elbows a few
 * degrees, legs splayed, arms down in an A-pose), but the joint ranges and the solvers' rest are straight. Each is measured for its
 * length only; the bone above it turns the skeleton's segment onto the straight one (its rest turn).
 */
const STRAIGHT: Partial<Record<ChildBone, Vector3>> = {
  leftLowerLeg: new Vector3(0, -1, 0), leftFoot: new Vector3(0, -1, 0), rightLowerLeg: new Vector3(0, -1, 0), rightFoot: new Vector3(0, -1, 0),
  leftLowerArm: new Vector3(1, 0, 0), leftHand: new Vector3(1, 0, 0), rightLowerArm: new Vector3(-1, 0, 0), rightHand: new Vector3(-1, 0, 0),
};

/** the proportions of a skeleton standing at `at` (its limbs straightened), and each bone's turn from straight onto it */
function measure(at: Record<BoneName, Vector3 | null>, height?: number): { proportions: Proportions; turns: Record<BoneName, Quaternion> } {
  const rest = createRest();
  rest.hips.copy(need(at.hips, 'hips'));
  const turns = perBone(() => new Quaternion());
  for (const bone of CHILD_BONES) {
    const p = at[bone], offset = rest.offsets[bone];
    if (!p) continue;
    offset.subVectors(p, need(at[PARENT[bone]], PARENT[bone]));
    const axis = STRAIGHT[bone];
    if (!axis) continue;
    turns[PARENT[bone]].setFromUnitVectors(axis, offset.clone().normalize());
    const length = offset.length();
    offset.copy(axis).multiplyScalar(length);
  }
  return { proportions: derive(rest, height), turns };
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

/**
 * How far the eyes turn in the head comfortably (rad): down, the preferred declination of the line
 * of sight below the head's (29° sitting upright, 34° over all postures, 38° for a near target: Hill
 * & Kroemer 1986, Human Factors 28:127); up and aside, where the eyes end a head-free gaze shift
 * (half the customary ocular motor range, 44° wide on average, and of the eye-only range, 36°:
 * Stahl 1999, Exp Brain Res 126:41; measured horizontally, taken for up as well)
 */
const EYES = { down: (30 * Math.PI) / 180, up: (20 * Math.PI) / 180, side: (20 * Math.PI) / 180 };

/** a person's gaze: the neck chain turns the head, the eyes the rest; looking low, the body bows */
function humanGaze(p: Proportions): Gazer {
  const { eyes } = pointsOf(p);
  return {
    neck: 'neck',
    eyes: (pose, out) => pose.point(eyes.bone, eyes.at, out),
    range: EYES,
    pitch: NECK_PITCH * Math.PI / 180,
    lead: (self, pose, point) => gazeAsks(personOf(self), pose, point),
  };
}

function need<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`humanoid: the skeleton has no ${what}`);
  return value;
}
