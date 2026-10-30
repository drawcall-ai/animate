import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { Pose, type ReadonlyPose } from '../kernel/pose';
import { gazeAsks } from '../hands/person/bend';
import { personHands } from '../hands/person/handling';
import type { Handling } from '../hands/handling';
import { looking } from '../look/gaze';
import type { AnySpecies, Gazer } from '../species/define';
import type { Carrier } from '../kernel/carrier';
import { solveChain } from '../kernel/chain';
import { REACHED, type Goal } from '../kernel/goal';
import { ChainTip } from '../kernel/tip';
import { forwardOf, yawOf } from '../kernel/math';
import { seedOf } from '../kernel/random';
import { Self, type Behaviours, type SelfOptions } from './runtime';
import type { Binding } from './model';
import { resolve, type Hold } from '../things/resolve';
import { bear, bodyOf, carryAlong, checkParents, inHand, move, steadied, worn, type Kept } from '../things/hold';
import type { Thing } from '../things/thing';
import { INDEX, SIDES, sideOf, type Side } from '../species/humanoid/bones';
import { palmOf } from '../species/humanoid/landmarks';
import type { Proportions } from '../species/humanoid/proportions';
import type { Stride } from '../species/humanoid/humanoid';
import { footRotation } from '../legs/person/foot';
import { legOf } from '../legs/person/leg';
import { STANDING_REACH } from '../legs/person/posture';
import { relaxedPose } from '../species/humanoid/relaxed';
import { standingFeet } from '../species/humanoid/stance';
import { driven } from '../legs/person/balance';
import { stride } from '../legs/person/stride';
import { hanging, handStep, HOLD } from '../hands/person/arms';
import { lookAround } from '../look/around';
import type { Floor } from '../legs/floor';
import type { ArmPosture } from '../kernel/poise';

/** an arm posed nowhere off its hang */
const still = (): Required<ArmPosture> => ({ shrug: 0, forward: 0, out: 0, twist: 0, elbow: 0 });

/** Humanoid balance, idle gaze and arms, and held-object fitting. */
export class Person extends Self {
  declare readonly gazer: Gazer;
  /** what its hands carry this sub-step and along which aim: fitted to the wrists after the hands */
  readonly carrying = new Map<Object3D, Carrier>();
  readonly proportions: Proportions;
  readonly stride: Stride;
  /** each arm's pose asked this sub-step (`pose`): the free arm's hang takes it, and clears it */
  readonly armPose: Record<Side, Required<ArmPosture>> = { left: still(), right: still() };

  constructor(species: AnySpecies, options: SelfOptions, binding: Binding) {
    const proportions = species.person;
    if (!proportions || !species.gaze) throw new Error('a person is made of a humanoid species');
    super(species, options, binding, (skeleton, floor) => relaxed(proportions, new Pose(skeleton), floor, options.at ?? new Vector3(), options.face ?? 0));
    this.proportions = proportions;
    this.stride = species.stride ?? {};
  }

  /** a person's hands: both at once, the right leading */
  protected handle(): Handling {
    return personHands(this);
  }

  /** before the head aims at `point`: the body bows and lowers to see low down */
  lead(pose: ReadonlyPose, point: Readonly<Vector3>): void {
    gazeAsks(this, pose, point);
  }

  protected behave(): Behaviours {
    const seed = this.life.seed;
    const arms = { left: new ChainTip('leftArm'), right: new ChainTip('rightArm') }, held = { left: keptOnBody(this, 'left'), right: keptOnBody(this, 'right') };
    const taking: Partial<Record<Side, readonly [Thing, string]>> = {}, noted = new WeakSet<object>(), kept = new WeakMap<Thing, Kept>();
    return {
      balance: this.drive ? driven(this, seed) : stride(this, { seed }),
      // (unseeded, glances vary with where the body was made, as its balance does: a crowd does not look aside in step)
      gaze: looking(this, lookAround(this, seed ?? seedOf('gaze', this.proportions.height, this.pose.position(0).x, this.pose.position(0).z))),
      hands: hanging(this),
      keep: (f, hand) => {
        const side = sideOf(hand), hold = this.holding[side];
        if (!hold) return;
        if (hold.keep) return hold.keep(f);
        const thing = hold.thing;
        // (what hangs from the hand stays where the hand holds it on the body; what the body wears or carries in both hands the hands
        // follow; to keep a hand on what rests where it lies, or on another body, the body comes along — down to it, or after it)
        if (inHand(this, thing)) return handStep(this, f, side, held[side](f), { ...HOLD, lead: false }, arms[side]);
        if (!this.carrying.has(thing.object)) carryAlong(this, f, thing.object);
        handStep(this, f, side, steadied(hold), { on: this.track(thing.object), thing, ...HOLD, lead: bodyOf(thing.object) !== this }, arms[side]);
      },
      things: (f) => {
        checkParents(this, f);
        if (f.dev) checkTaking(this, f, taking);
        move(this, f, this.carrying, kept);
        if (f.dev) checkHeld(this, f, noted);
        this.carrying.clear();
        bear(this, f, this.worn, this.borne);
      },
    };
  }
}

/**
 * An idle holding hand keeps its last pose relative to the root's place and heading while the body walks and turns — not to the pelvis's
 * tilt: between two verbs, the reach's bow let go of for a sub-step tilted a hand held before the body 3–9 mm down with it.
 */
function keptOnBody(person: Person, side: Side): (f: Frame) => Goal {
  const bone = person.hands[side], kept = { position: new Vector3(), quaternion: new Quaternion() };
  const heading = (pose: ReadonlyPose) => _heading.setFromAxisAngle(_up, yawOf(pose.rotation(0)));
  let time = -Infinity;
  return (f) => {
    // (let be since the last sub-step it was kept: from where it is now)
    if (f.time - time > 1.5 * f.dt) {
      const back = _q.copy(heading(f.prev)).invert();
      kept.position.copy(f.prev.position(bone)).sub(f.prev.position(0)).applyQuaternion(back);
      kept.quaternion.copy(back).multiply(f.prev.rotation(bone));
    }
    time = f.time;
    const turn = heading(f.current);
    return { position: kept.position.clone().applyQuaternion(turn).add(f.current.position(0)), quaternion: turn.clone().multiply(kept.quaternion) };
  };
}

export function personOf(self: Self): Person {
  if (!(self instanceof Person)) throw new Error('not a person');
  return self;
}

/**
 * How far a hand may be from a grip it starts holding (m): a reach ends once the wrist is within `REACHED.distance`, and the same frame's
 * hold step and fit have an additional 2 cm allowance: artistic calibration for apparent contact during acquisition, not measured anatomy.
 */
const GRIP_TAKEN = REACHED.distance + 0.02;
/** How far a palm may be from the grip it holds on what the body carries (m; tuned: a load carried at the body as it walks and turns
 * lags its turn, the hands up to ~4 cm off their grips) */
const HELD = 0.05;

/** how far hand `side`'s palm is from `hold`'s grip as the body is posed now (read afresh: a thing hanging from a hand moves with it after the hands) */
function gripGap(person: Person, f: Frame, side: Side, hold: Hold): number {
  const at = resolve(person, hold.thing.object, _placed);
  const palm = f.current.point(person.hands[side], _palm.copy(palmOf(person.proportions, side)), _palm);
  return palm.distanceTo(_grip.copy(hold.thing.grip(hold.grip).at.position).applyQuaternion(at.quaternion).add(at.position));
}

/** development: each grip a hand has just taken, its palm as near it as a grip taken is */
function checkTaking(person: Person, f: Frame, taking: Partial<Record<Side, readonly [Thing, string]>>): void {
  for (const side of SIDES) {
    const hold = person.holding[side], was = taking[side];
    taking[side] = hold ? [hold.thing, hold.grip] : undefined;
    if (!hold || (was?.[0] === hold.thing && was[1] === hold.grip)) continue;
    const value = gripGap(person, f, side, hold);
    if (value > GRIP_TAKEN) f.dev?.append(f.time, { check: 'grip activation distance (m)', value, limit: GRIP_TAKEN, where: `${hold.thing.object.name} ${side} ${hold.grip}` });
  }
}

/** Check final grip distance after fitting. Report carried-load separation once per hold.
 * Worn grips have one rigid owner; unreachable carries draw the wrists together and off their grips. */
function checkHeld(person: Person, f: Frame, noted: WeakSet<object>): void {
  for (const side of SIDES) {
    const hold = person.holding[side];
    if (!hold || !bodyOf(hold.thing.object)) continue;
    const carried = !worn(hold.thing), value = gripGap(person, f, side, hold), limit = carried ? HELD : REACHED.distance;
    if (value <= limit || (carried && noted.has(hold))) continue;
    if (carried) noted.add(hold);
    f.dev?.append(f.time, { check: 'held grip distance (m)', value, limit, where: `${hold.thing.object.name} ${side}` });
  }
}

/** Start relaxed on `floor` at `at` (its x and z), facing `yaw`, with flat feet each on the floor under it and the pelvis within standing reach. */
function relaxed(proportions: Proportions, pose: Pose, floor: Floor, at: Vector3, yaw: number): Pose {
  for (const { bone, rotation } of relaxedPose()) pose.setLocal(bone, rotation);
  pose.setLocal(0, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  const standing = floor(at.x, at.z) + proportions.hipHeight;
  pose.setRoot(new Vector3(at.x, standing, at.z));
  pose.facing = yaw;
  const feet = standingFeet(proportions, at.x, at.z, yaw), reach = STANDING_REACH * proportions.legLength;
  for (const foot of feet) foot.position.y += floor(foot.position.x, foot.position.z);
  // (no higher than the legs reach)
  let y = standing;
  SIDES.forEach((side, s) => {
    const hip = pose.position(INDEX[`${side}UpperLeg`]), ankle = feet[s].position;
    y = Math.min(y, ankle.y + Math.sqrt(reach * reach - (hip.x - ankle.x) ** 2 - (hip.z - ankle.z) ** 2) + standing - hip.y);
  });
  pose.setRoot(new Vector3(at.x, y, at.z));
  SIDES.forEach((side, s) => {
    const { position, yaw: heading } = feet[s];
    const knee = forwardOf(heading).add(pose.position(INDEX[`${side}UpperLeg`]));
    solveChain({ current: pose }, legOf(side), { tip: { position, quaternion: footRotation(heading, 0) }, pole: knee });
  });
  return pose;
}

const _palm = new Vector3(), _q = new Quaternion(), _heading = new Quaternion(), _up = new Vector3(0, 1, 0), _grip = new Vector3(), _placed = { position: new Vector3(), quaternion: new Quaternion() };
